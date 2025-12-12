import { AVAILABLE_TLDS, Message, Role, ToolCallData } from '../types';
import { generateToolCallId, shouldAutoCallDomainTool } from './domainTooling';

export type ChatBackendResponse = {
  text: string;
  functionCalls?: Array<{ id: string; name: string; args: Record<string, any> }>;
};

type MistralTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, any>;
  };
};

type MistralToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type MistralChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: MistralToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string; name?: string };

export const sanitizeEnvValue = (value: string | undefined): string | undefined => {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  const noBom = trimmed.replace(/^\uFEFF/, '');
  // dotenv values can sometimes include wrapping quotes depending on how they're authored.
  return noBom.replace(/^['"]|['"]$/g, '');
};

export const checkDomainsTool: MistralTool = {
  type: 'function',
  function: {
    name: 'checkDomains',
    description:
      "Check the availability of domain names for specific base brand names. Use this whenever the user asks to check availability or when you generate a list of potential brand names.",
    parameters: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description:
            "A list of base brand names to check (e.g. ['Spotify', 'Google']). Do not include the extension/TLD."
        },
        tlds: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Optional: a list of TLDs to check (e.g. ['.com', '.io']). If omitted, the app will use the user-selected extensions."
        }
      },
      required: ['names']
    }
  }
};

export const mapMessagesToMistral = (messages: Message[], systemInstruction?: string): MistralChatMessage[] => {
  const out: MistralChatMessage[] = [];
  // Track tool call ids that have been introduced to the model so we don't
  // accidentally send orphaned `tool` messages (Mistral rejects those).
  const knownToolCallIds = new Set<string>();

  if (systemInstruction && systemInstruction.trim()) {
    out.push({ role: 'system', content: systemInstruction.trim() });
  }

  for (const m of messages || []) {
    if (m?.isError) continue;
    if (m?.role === Role.SYSTEM) continue;

    if (m?.role === Role.USER) {
      const userContent = String(m?.text ?? '').trim();
      if (userContent) out.push({ role: 'user', content: userContent });
      continue;
    }

    if (m?.role === Role.MODEL) {
      // MODEL -> assistant (+ optional tool calls)
      if (Array.isArray(m?.toolCalls) && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          const id = String(tc?.id ?? '').trim();
          if (id) knownToolCallIds.add(id);
        }
        out.push({
          role: 'assistant',
          content: String(m?.text ?? ''),
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args ?? {})
            }
          }))
        });
      } else {
        const assistantContent = String(m?.text ?? '').trim();
        // Mistral rejects assistant messages with neither tool_calls nor non-empty content.
        if (assistantContent) out.push({ role: 'assistant', content: assistantContent });
      }

      // Tool responses (results) are separate tool-role messages
      if (Array.isArray(m?.toolResponses) && m.toolResponses.length > 0) {
        for (const tr of m.toolResponses) {
          const toolCallId = String(tr?.id ?? '').trim();
          // Only include tool messages if the corresponding tool_call_id was
          // previously sent in an assistant message.
          if (!toolCallId || !knownToolCallIds.has(toolCallId)) continue;
          out.push({
            role: 'tool',
            tool_call_id: toolCallId,
            name: tr.name,
            content: JSON.stringify(tr.result ?? null)
          });
        }
      }
    }
  }

  return out;
};

const ensureMistralValidMessageOrder = (messages: MistralChatMessage[]): MistralChatMessage[] => {
  // Mistral chat/completions requires the last message to be role 'user' or 'tool'
  // (unless using special assistant prefix behavior). In some client flows we may
  // accidentally include a trailing assistant message; trim those defensively.
  const out = [...(messages || [])];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.role === 'assistant') {
      out.pop();
      continue;
    }
    break;
  }
  return out;
};

const parseMistralToolCalls = (toolCalls: any[]): Array<{ id: string; name: string; args: Record<string, any> }> => {
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls
    .filter(tc => tc?.type === 'function')
    .map(tc => {
      let args: any = {};
      try {
        args = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = {};
      }
      return {
        id: String(tc?.id ?? ''),
        name: String(tc?.function?.name ?? ''),
        args
      };
    })
    .filter(fc => Boolean(fc.id) && Boolean(fc.name));
};

export const buildChatResponse = async (
  body: any,
  env: Record<string, string | undefined> = process.env
): Promise<{ status: number; json: ChatBackendResponse | { error: string } }> => {
  const apiKey = sanitizeEnvValue(env.MISTRAL_API_KEY);
  const model = sanitizeEnvValue(env.MISTRAL_MODEL) || 'mistral-small-latest';

  if (!apiKey) {
    return { status: 500, json: { error: 'Server configuration error: Missing MISTRAL_API_KEY' } };
  }

  const { messages, systemInstruction } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: 400, json: { error: 'No messages provided' } };
  }

  const mappedMessages = mapMessagesToMistral(messages as Message[], systemInstruction);
  const safeMessages = ensureMistralValidMessageOrder(mappedMessages);

  if (safeMessages.length === 0) {
    return { status: 400, json: { error: 'Invalid message sequence for Mistral (no user/tool message).' } };
  }

  const lastRole = safeMessages[safeMessages.length - 1]?.role;
  if (lastRole !== 'user' && lastRole !== 'tool') {
    return {
      status: 400,
      json: {
        error: `Invalid message order for Mistral: last role must be user or tool, got ${String(lastRole)}.`
      }
    };
  }

  const callMistral = async (opts?: { toolChoice?: 'auto' | 'any'; temperature?: number }) => {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: safeMessages,
        tools: [checkDomainsTool],
        tool_choice: opts?.toolChoice ?? 'auto',
        temperature: opts?.temperature ?? 0.9
      })
    });
    return res;
  };

  const mistralRes = await callMistral();

  if (!mistralRes.ok) {
    const text = await mistralRes.text().catch(() => '');
    const status = mistralRes.status;
    return {
      status,
      json: {
        error:
          status === 401 || status === 403
            ? 'Mistral authentication failed. Check MISTRAL_API_KEY.'
            : `Mistral API error (${status}). ${text || ''}`.trim()
      }
    };
  }

  const data: any = await mistralRes.json();
  let msg = data?.choices?.[0]?.message;
  let assistantText: string = msg?.content ?? '';
  let functionCalls = parseMistralToolCalls(msg?.tool_calls ?? []);

  // Reliability retry: sometimes the model returns an empty assistant message with no tool calls.
  // That forces the client into extra "nudge" generations. Retry once with a stronger tool bias.
  if (String(assistantText || '').trim() === '' && functionCalls.length === 0) {
    const retryRes = await callMistral({ toolChoice: 'any', temperature: 0.2 }).catch(() => null as any);
    if (retryRes && retryRes.ok) {
      const retryData: any = await retryRes.json().catch(() => null);
      const retryMsg = retryData?.choices?.[0]?.message;
      const retryText: string = retryMsg?.content ?? '';
      const retryCalls = parseMistralToolCalls(retryMsg?.tool_calls ?? []);
      if (String(retryText || '').trim() !== '' || retryCalls.length > 0) {
        msg = retryMsg;
        assistantText = retryText;
        functionCalls = retryCalls;
      }
    }
  }

  // Reliability fallback: if the model "says" it will check but forgets tool_calls,
  // synthesize a checkDomains tool call from the user's message.
  if (functionCalls.length === 0) {
    const autoArgs = shouldAutoCallDomainTool(messages as Message[], assistantText, AVAILABLE_TLDS);
    if (autoArgs && Array.isArray(autoArgs.names) && autoArgs.names.length > 0) {
      functionCalls.push({ id: generateToolCallId(), name: 'checkDomains', args: autoArgs as any });
    }
  }

  return {
    status: 200,
    json: {
      text: assistantText,
      functionCalls
    }
  };
};
