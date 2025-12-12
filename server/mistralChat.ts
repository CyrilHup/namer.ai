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
          out.push({
            role: 'tool',
            tool_call_id: tr.id,
            name: tr.name,
            content: JSON.stringify(tr.result ?? null)
          });
        }
      }
    }
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

  const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: mappedMessages,
      tools: [checkDomainsTool],
      tool_choice: 'auto',
      temperature: 0.9
    })
  });

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
  const msg = data?.choices?.[0]?.message;
  const assistantText: string = msg?.content ?? '';

  const functionCalls = parseMistralToolCalls(msg?.tool_calls ?? []);

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
