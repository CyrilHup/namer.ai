import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Menu, Sparkles, AlertCircle } from 'lucide-react';
import { Message, Role, DomainCheckResult } from './types';
import { sendMessageToBackend } from './services/chatService';
import { checkMultipleDomains } from './services/domainService';
import { ChatMessage } from './components/ChatMessage';
import { Sidebar } from './components/Sidebar';
import { ExplanationModal } from './components/ExplanationModal';

const SYSTEM_INSTRUCTION = `You are Namer.ai, a creative naming expert.
Your goal is to help users brainstorm concise, modern, and memorable brand names.

IMPORTANT: Do NOT ask clarifying questions by default.
If the user doesn't specify things like target audience, tone, or style, assume neutral defaults:
- Audience: broad (founders/builders)
- Tone: modern/tech/clean
- Names: short, brandable, easy to pronounce

DOMAIN WORKFLOW (non-negotiable):
1) Reflect on candidate names internally.
2) Call the 'checkDomains' tool with base names ONLY (no TLDs in the names array).
3) After tool results, present ONLY domains that are AVAILABLE.
   - Do NOT list or mention taken/unknown domains.
   - Do NOT show a "Taken" list.

COUNT REQUIREMENT:
- If the user requests a specific number (e.g. "10 names"), you MUST return EXACTLY that many AVAILABLE domains.
- If the first check does not yield enough AVAILABLE domains, generate more fresh candidates and call 'checkDomains' again.
- Avoid repeats.

BATCHING (cost control):
- When brainstorming, prefer generating MANY candidates per tool call (rather than many small calls).
- Each time you call 'checkDomains', include at least 10-20 NEW base names.
- If the user forces a rare TLD like .ai, increase the batch size (20-40) to improve hit-rate.
- Do not output a final answer until you have enough AVAILABLE results.

TLD RULES:
- If the user explicitly mentions a TLD (e.g. .ai), include it in the tool call as { tlds: ['.ai'] }.
- If the user says "check again" / "again" / "recheck", run another availability check and expand the TLD set beyond the previous check.
`;

const extractRequestedCount = (text: string): number | null => {
  const t = String(text || '').toLowerCase();

  // Look for patterns like: "give me 10", "suggest 12 names", "10 domains", "need 5 options".
  const patterns: RegExp[] = [
    /\b(?:give|suggest|generate|find|need|want|provide|show)\s+(\d{1,2})\b/i,
    /\b(\d{1,2})\s+(?:names|name|domains|domain|options|ideas|suggestions)\b/i
  ];

  // French patterns: "je veux 5 noms", "donne-moi 4", "4 noms", "j'en veux 6".
  patterns.push(
    /\b(?:je\s*veux|j\s*en\s*veux|donne(?:-moi)?|propose(?:-moi)?|genere|g[ée]n[ée]re|trouve|il\s*me\s*faut)\s+(\d{1,2})\b/i,
    /\b(\d{1,2})\s+(?:noms|nom|domaines|domaine|options|id[ée]es|suggestions)\b/i
  );

  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return Math.min(n, 50);
    }
  }

  return null;
};

const extractExplicitTlds = (text: string): string[] | null => {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;

  // Capture explicit TLD mentions like ".cloud" in phrases:
  // - "cherche en .cloud"
  // - "only .ai"
  // - "extension .io"
  // Also catches full domains like "foo.cloud" (we'll still extract ".cloud").
  const re = /(^|[^a-z0-9])\.([a-z]{2,})(?=([^a-z0-9]|$))/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const tld = `.${String(m[2] || '').toLowerCase()}`;
    if (tld.length >= 3 && tld.length <= 15) seen.add(tld);
    if (seen.size >= 8) break;
  }

  const out = Array.from(seen);
  return out.length > 0 ? out : null;
};

const isContinuationBrainstormRequest = (text: string): boolean => {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  // Short follow-ups that imply “continue with same constraints”.
  if (/^(?:more|again|retry|recheck|continue)\b/i.test(t)) return true;
  if (/\b(?:more|again|continue)\b/i.test(t) && t.split(/\s+/).length <= 6) return true;

  // French follow-ups: "encore", "de plus", "plus", "donne moi X de plus".
  if (/^(?:encore|plus|recommence|refais)\b/i.test(t)) return true;
  if (/\b(?:de\s+plus|encore|plus)\b/i.test(t) && t.split(/\s+/).length <= 10) return true;

  return false;
};

const userClearsTldConstraint = (text: string): boolean => {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  // Signals user wants to stop forcing a specific TLD.
  return (
    /\b(?:peu\s+importe|n'?importe\s+quelle|toutes?\s+les?\s+extensions|tous\s+les\s+tlds|any\s+tld|all\s+tlds)\b/i.test(t) ||
    /\b(?:pas\s+seulement|not\s+only)\b\s*\.ai\b/i.test(t) ||
    /\b(?:enl[èe]ve|retire|remove|drop)\b[^\n]{0,30}\.([a-z]{2,})\b/i.test(t)
  );
};

const userForcesAiTld = (text: string): boolean => {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  // "en .ai", "extension .ai", or explicit .ai mention.
  return /(^|\W)\.ai(\W|$)/i.test(t) || /\bextension\b[^\n]{0,32}\.ai\b/i.test(t);
};

const isProbablyFrench = (text: string): boolean => {
  const t = String(text || '').toLowerCase();
  return /\b(je|mon|ma|mes|une|un|des|domaine|nom|disponibilit[ée]|v[ée]rifi(?:er|cation)|temps\s*r[ée]el)\b/i.test(t);
};

type ChatMode = 'check' | 'brainstorm';

const looksLikeExplicitNameCheck = (text: string): boolean => {
  const t = String(text || '').trim();
  if (!t) return false;

  // direct domain like foo.ai
  if (/\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,}\b/i.test(t)) return true;

  // explicit "check X" / "is X available" patterns
  if (/\b(check|recheck|verify|availability|available|is)\b/i.test(t)) {
    // If there's a quoted token or a single-ish token, treat as check request
    if (/("[^"\n]{2,64}"|'[^'\n]{2,64}')/.test(t)) return true;
    if (/\bcheck\s+([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\b/i.test(t)) return true;
    if (/\bis\s+([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\s+(?:available|taken|free)\b/i.test(t)) return true;
  }

  // If the message is just a bare token (e.g. "domai") plus a checky verb elsewhere
  const bare = t.match(/^([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)$/i);
  if (bare) return true;

  return false;
};

const looksLikeBrainstormRequest = (text: string): boolean => {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  // idea/project description or explicit brainstorm intent
  if (/(brainstorm|ideas|suggest|generate|names|name ideas|brand name|startup name|for my|my app|my project|tool for|website for)/i.test(t)) {
    return true;
  }
  // longer descriptive prompts usually indicate brainstorm
  if (t.split(/\s+/).length >= 10) return true;
  return false;
};

const detectMode = (userText: string, lastMode: ChatMode): ChatMode => {
  const t = String(userText || '').trim();
  if (!t) return lastMode;

  // For "again" type messages, keep current mode.
  if (/^(?:again|check\s+again|recheck|retry|more)\b/i.test(t)) return lastMode;

  if (looksLikeExplicitNameCheck(t) && !looksLikeBrainstormRequest(t)) return 'check';
  if (looksLikeBrainstormRequest(t) && !looksLikeExplicitNameCheck(t)) return 'brainstorm';

  // Tie-breaker: if explicit domain or "check" verbs exist, prefer check.
  if (looksLikeExplicitNameCheck(t)) return 'check';
  return 'brainstorm';
};

const INITIAL_MESSAGE: Message = {
  id: 'init',
  role: Role.MODEL,
  text: "Hi! I'm Namer.ai. Tell me about your project, and I'll help you brainstorm names and check if the domains are available."
};

function App() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTlds, setSelectedTlds] = useState<string[]>(['.com', '.io', '.ai']);
  const [isBackendConfigured, setIsBackendConfigured] = useState<boolean | null>(null);
  
  // UI States
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastModeRef = useRef<ChatMode>('brainstorm');
  const lastForcedTldsRef = useRef<string[] | null>(null);

  // Simple debug logger (kept local to the component on purpose)
  const DEBUG_LOGS = true;
  const dbg = (...args: any[]) => {
    if (!DEBUG_LOGS) return;
    // eslint-disable-next-line no-console
    console.log('[namer.ai]', ...args);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Lightweight check: tells the UI if the server has MISTRAL_API_KEY configured.
    // (No secrets are exposed to the browser.)
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) {
          if (!cancelled) setIsBackendConfigured(false);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setIsBackendConfigured(Boolean(data?.ok));
      } catch {
        if (!cancelled) setIsBackendConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    const mode = detectMode(userText, lastModeRef.current);
    lastModeRef.current = mode;
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const log = (...args: any[]) => dbg(`[${requestId}]`, ...args);
    // eslint-disable-next-line no-console
    console.groupCollapsed?.(`[namer.ai][${requestId}] ${mode.toUpperCase()} | ${userText.slice(0, 80)}${userText.length > 80 ? '…' : ''}`);
    log('User message:', { text: userText, mode });
    const pendingId = `${Date.now()}-pending`;

    // Add User Message
    const userMsg: Message = {
      id: Date.now().toString(),
      role: Role.USER,
      text: userText
    };
    
    const updatedMessages = [...messages, userMsg];
    // In brainstorm mode, show a dedicated "working" assistant bubble immediately.
    if (mode === 'brainstorm') {
      const pendingMsg: Message = {
        id: pendingId,
        role: Role.MODEL,
        text: 'Brainstorming & checking availability…',
        isPending: true,
        toolDisplayMode: 'availableOnly'
      };
      setMessages([...updatedMessages, pendingMsg]);
    } else {
      setMessages(updatedMessages);
    }

    try {
      // CHECK MODE: old behavior — check exactly what the user asked, show all cards for selected TLDs.
      if (mode === 'check') {
        log('Entering CHECK mode', { selectedTlds });
        // Send message to Backend
        const result = await sendMessageToBackend(updatedMessages, SYSTEM_INSTRUCTION);

        log('Backend response (CHECK):', {
          textPreview: String(result?.text || '').slice(0, 220),
          functionCalls: result?.functionCalls
        });

        const functionCalls = Array.isArray(result.functionCalls) ? result.functionCalls : [];
        let toolResponsesData: any[] = [];
        let finalResponseText = result.text || '';

        if (functionCalls.length > 0) {
          const toolResponses = await Promise.all(
            functionCalls.map(async (call: any) => {
              if (call.name === 'checkDomains') {
                const { names, tlds } = call.args as { names: string[]; tlds?: string[] };
                // If the user asked a specific full domain (e.g. namer.de), the backend extraction will
                // provide tlds. In that case, ignore the sidebar TLDs and check only what was requested.
                const tldsToCheck = Array.isArray(tlds) && tlds.length > 0 ? tlds : selectedTlds;
                log('Tool call (CHECK):', { id: call.id, names, tldsToCheck });
                const availabilityResults = await checkMultipleDomains(names, tldsToCheck);
                log('Tool results (CHECK):', {
                  id: call.id,
                  total: availabilityResults.length,
                  available: availabilityResults.filter(r => r.status === 'available').length,
                  taken: availabilityResults.filter(r => r.status === 'taken').length,
                  unknown: availabilityResults.filter(r => r.status === 'unknown').length
                });
                return {
                  id: call.id,
                  name: call.name,
                  result: availabilityResults
                };
              }
              return { id: call.id, name: call.name, result: { error: 'Unknown tool' } };
            })
          );

          toolResponsesData = toolResponses;

          const toolResponseMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: Role.MODEL,
            text: finalResponseText,
            toolCalls: functionCalls,
            toolResponses: toolResponsesData,
            toolDisplayMode: 'all'
          };

          const messagesWithTool = [...updatedMessages, toolResponseMessage];
          const postToolResponse = await sendMessageToBackend(messagesWithTool, SYSTEM_INSTRUCTION);

          if (postToolResponse.text && postToolResponse.text !== finalResponseText) {
            finalResponseText += "\n\n" + postToolResponse.text;
          }

          const finalModelMsg: Message = {
            ...toolResponseMessage,
            text: finalResponseText,
            toolDisplayMode: 'all'
          };

          setMessages(prev => [...prev, finalModelMsg]);
        } else {
          const modelMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: Role.MODEL,
            text: finalResponseText
          };
          setMessages(prev => [...prev, modelMsg]);
        }

        return;
      }

      // BRAINSTORM MODE: iterative — only show available domains (cards + text), and enforce requested count if provided.
      const desiredAvailableCount = extractRequestedCount(userText);
      const targetAvailableCount = desiredAvailableCount ?? 3;
      const forceAiOnly = userForcesAiTld(userText);
      const explicitTlds = extractExplicitTlds(userText);

      const continuation = isContinuationBrainstormRequest(userText);
      const clearsConstraint = userClearsTldConstraint(userText);

      // Priority:
      // 1) explicit user TLDs in THIS message (e.g. ".cloud")
      // 2) user explicitly clears constraint
      // 3) continuation -> keep previous forced TLDs
      // 4) force .ai if mentioned
      // 5) otherwise none
      let forcedTlds: string[] | null = null;
      if (explicitTlds && explicitTlds.length > 0) {
        forcedTlds = explicitTlds;
      } else if (clearsConstraint) {
        forcedTlds = null;
      } else if (continuation && lastForcedTldsRef.current && lastForcedTldsRef.current.length > 0) {
        forcedTlds = lastForcedTldsRef.current;
      } else if (forceAiOnly) {
        forcedTlds = ['.ai'];
      } else {
        forcedTlds = null;
      }
      // Persist forced TLDs across brainstorm continuations.
      lastForcedTldsRef.current = forcedTlds;

      log('Entering BRAINSTORM mode', {
        selectedTlds,
        targetAvailableCount,
        explicitTlds,
        continuation,
        clearsConstraint,
        forcedTlds
      });

      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
      // Candidate batch sizing: larger batches reduce AI calls.
      // In .ai-only mode, we ask for more candidates per call to improve odds.
      const MIN_CANDIDATES_PER_CALL = forceAiOnly ? 20 : 10;
      const MAX_CANDIDATES_PER_CALL = forceAiOnly ? 40 : 25;

      const checkedBaseNames = new Set<string>();
      const availableDomains = new Map<string, DomainCheckResult>();

      // If Mistral keeps returning no tool calls, fall back to asking for a strict JSON list
      // of names and run the availability checks client-side.
      let noToolCallStreak = 0;

      const tryParseJsonNameList = (raw: string): string[] | null => {
        const txt = String(raw || '').trim();
        if (!txt) return null;
        // Try to isolate JSON if the model wraps it in text.
        const start = txt.indexOf('[');
        const end = txt.lastIndexOf(']');
        const slice = start >= 0 && end > start ? txt.slice(start, end + 1) : txt;
        try {
          const parsed = JSON.parse(slice);
          if (!Array.isArray(parsed)) return null;
          const out: string[] = [];
          const seen = new Set<string>();
          for (const v of parsed) {
            const s = String(v || '').trim().toLowerCase();
            if (!s) continue;
            // keep base-name-ish tokens only
            const cleaned = s
              .replace(/^https?:\/\//, '')
              .split('.')[0]
              .replace(/\s+/g, '')
              .replace(/[^a-z0-9-]/g, '')
              .replace(/^-+/, '')
              .replace(/-+$/, '')
              .slice(0, 63);
            if (!cleaned || seen.has(cleaned)) continue;
            if (checkedBaseNames.has(cleaned)) continue;
            seen.add(cleaned);
            out.push(cleaned);
            if (out.length >= 80) break;
          }
          return out.length > 0 ? out : null;
        } catch {
          return null;
        }
      };

      const startTs = Date.now();
      // Brainstorm should keep trying until it finds enough available domains.
      // Still keep a safety cap to avoid infinite loops if DNS/LLM/network is down.
      const MAX_WALL_TIME_MS = forceAiOnly ? 35_000 : 25_000;
      const MAX_MODEL_CALLS = Math.max(14, Math.min(90, targetAvailableCount * 12));

      let workingMessages: Message[] = [...updatedMessages];

      // We'll add ONE assistant message to the UI at the end, but keep tool-call history in workingMessages.
      // This avoids showing pre-check suggestions that may include taken domains.
      let finalUiMessage: Message | null = null;

      const buildDynamicInstruction = () => {
        const parts: string[] = [SYSTEM_INSTRUCTION];
        parts.push(`\nHard requirement: return EXACTLY ${targetAvailableCount} AVAILABLE domains in your final answer.`);
        if (forcedTlds && forcedTlds.length > 0) {
          parts.push(`\nTLD constraint: ONLY use these TLDs: ${forcedTlds.join(', ')}.`);
        }

        const remaining = Math.max(0, targetAvailableCount - availableDomains.size);
        const desiredBatch = clamp(
          // Heuristic: ask for more names when we still need more availability.
          Math.ceil(Math.max(MIN_CANDIDATES_PER_CALL, remaining * (forceAiOnly ? 10 : 6))),
          MIN_CANDIDATES_PER_CALL,
          MAX_CANDIDATES_PER_CALL
        );
        parts.push(
          `\nEfficiency requirement: On your NEXT checkDomains tool call, include ${desiredBatch} NEW, unique base names (no TLDs). Avoid repeats. Do not write a final answer yet.`
        );

        if (availableDomains.size > 0) {
          const domains = Array.from(availableDomains.keys()).slice(0, 25);
          parts.push(`\nAlready found available (do not repeat, just count them): ${domains.join(', ')}`);
        }
        if (checkedBaseNames.size > 0) {
          const names = Array.from(checkedBaseNames.values()).slice(0, 40);
          parts.push(`\nAvoid rechecking these base names: ${names.join(', ')}`);
        }
        return parts.join('\n');
      };

      let modelCallCount = 0;
      while (
        availableDomains.size < targetAvailableCount &&
        modelCallCount < MAX_MODEL_CALLS &&
        Date.now() - startTs < MAX_WALL_TIME_MS
      ) {
        log('Brainstorm loop tick', {
          modelCallCount,
          availableSoFar: availableDomains.size,
          targetAvailableCount,
          checkedBaseNames: checkedBaseNames.size,
          forcedTlds
        });
        const instruction = buildDynamicInstruction();
        const result = await sendMessageToBackend(workingMessages, instruction);

        const functionCalls = Array.isArray(result.functionCalls) ? result.functionCalls : [];
        const assistantText = functionCalls.length > 0 ? 'Checking domain availability…' : (result.text || '');

        log('Backend response (BRAINSTORM):', {
          toolCalls: functionCalls.map((c: any) => ({
            id: c.id,
            name: c.name,
            namesCount: Array.isArray(c?.args?.names) ? c.args.names.length : 0,
            tlds: c?.args?.tlds
          })),
          textPreview: String(result?.text || '').slice(0, 220)
        });

        const modelMsgId = `${Date.now()}-${modelCallCount}`;
        let modelMsg: Message = {
          id: modelMsgId,
          role: Role.MODEL,
          text: assistantText,
          toolCalls: functionCalls.length > 0 ? functionCalls : undefined
        };

        workingMessages = [...workingMessages, modelMsg];

        if (functionCalls.length === 0) {
          noToolCallStreak += 1;
          // Force the model back onto the tool path.
          const remaining = Math.max(1, targetAvailableCount - availableDomains.size);
          const desiredBatch = clamp(
            Math.ceil(Math.max(MIN_CANDIDATES_PER_CALL, remaining * (forceAiOnly ? 10 : 6))),
            MIN_CANDIDATES_PER_CALL,
            MAX_CANDIDATES_PER_CALL
          );

          // Fallback: if the model won't emit tool_calls, ask for strict JSON list and check ourselves.
          const parsedNames = tryParseJsonNameList(result?.text || '');
          if (parsedNames && parsedNames.length > 0) {
            const finalTldsToCheck = forcedTlds && forcedTlds.length > 0 ? forcedTlds : selectedTlds;
            log('Names generated by Mistral (parsed JSON/fallback):', parsedNames);
            for (const base of parsedNames) checkedBaseNames.add(base);

            const availabilityResults = await checkMultipleDomains(parsedNames, finalTldsToCheck);
            for (const r of availabilityResults) {
              log(`Tested ${r.domain}: ${r.status}`);
              if (r?.status === 'available' && r?.domain) availableDomains.set(r.domain, r);
            }
            modelCallCount += 1;
            // Continue the loop — we may already have enough.
            continue;
          }

          log('No tool calls returned; nudging model', { remaining, desiredBatch, noToolCallStreak });

          workingMessages = [
            ...workingMessages,
            {
              id: `${Date.now()}-nudge-${modelCallCount}`,
              role: Role.USER,
              text:
                noToolCallStreak >= 2
                  ? `Internal instruction: Tool calls are not working. Output ONLY a valid JSON array (no prose) with ${desiredBatch} NEW base names (strings), no TLDs, no dots, no spaces. Example: ["nova", "cloudly"].`
                  : `Internal instruction: We still need ${remaining} more AVAILABLE domains. Generate ${desiredBatch} NEW candidate base names (no TLDs) and CALL checkDomains immediately. Do not output a final answer yet.`
            }
          ];
          modelCallCount += 1;
          continue;
        }

        // If we got tool calls again, reset streak.
        noToolCallStreak = 0;

        const toolResponses = await Promise.all(
          functionCalls.map(async (call: any) => {
            if (call.name === 'checkDomains') {
              const { names, tlds } = call.args as { names: string[]; tlds?: string[] };

              const tldsToCheck = Array.isArray(tlds) && tlds.length > 0 ? tlds : selectedTlds;
              const finalTldsToCheck = forcedTlds && forcedTlds.length > 0 ? forcedTlds : tldsToCheck;

              const incomingList = Array.isArray(names) ? names.map((n: any) => String(n || '').trim()) : [];
              log('Names generated by Mistral (tool_call.names):', incomingList);
              log('Tool call (BRAINSTORM):', {
                id: call.id,
                incomingNamesCount: incomingList.length,
                finalTldsToCheck
              });

              const incoming = Array.isArray(names) ? names : [];
              const normalizedUnique: string[] = [];
              const seen = new Set<string>();
              for (const n of incoming) {
                const base = String(n || '').trim().toLowerCase();
                if (!base) continue;
                if (seen.has(base)) continue;
                seen.add(base);
                // Skip names we've already checked in this brainstorm run.
                if (checkedBaseNames.has(base)) continue;
                normalizedUnique.push(base);
              }

              for (const base of normalizedUnique) checkedBaseNames.add(base);

              const availabilityResults = await checkMultipleDomains(normalizedUnique, finalTldsToCheck);
              for (const r of availabilityResults) {
                log(`Tested ${r.domain}: ${r.status}`);
                if (r?.status === 'available' && r?.domain) {
                  availableDomains.set(r.domain, r);
                }
              }

              log('Tool results (BRAINSTORM):', {
                id: call.id,
                checkedPairs: availabilityResults.length,
                availableNow: Array.from(availableDomains.keys()).slice(0, 12),
                availableCount: availableDomains.size,
                deltaAvailable: availabilityResults.filter(r => r.status === 'available').length,
                taken: availabilityResults.filter(r => r.status === 'taken').length,
                unknown: availabilityResults.filter(r => r.status === 'unknown').length
              });

              return {
                id: call.id,
                name: call.name,
                result: availabilityResults
              };
            }
            return { id: call.id, name: call.name, result: { error: 'Unknown tool' } };
          })
        );

        modelMsg = { ...modelMsg, toolResponses };
        workingMessages = [...workingMessages.slice(0, -1), modelMsg];

        modelCallCount += 1;
      }

      // If we never got a final assistant message without tool calls, fall back to a minimal summary.
      const finalList = Array.from(availableDomains.values()).slice(0, targetAvailableCount);
      const finalLines = finalList.map(r => `- ${r.domain}`);

      const french = isProbablyFrench(userText);
      const header = french
        ? `Voici ${finalList.length} nom${finalList.length > 1 ? 's' : ''} de domaine disponible${finalList.length > 1 ? 's' : ''}${forcedTlds ? ' (en .ai)' : ''} :`
        : `Here are ${finalList.length} available domain${finalList.length !== 1 ? 's' : ''}${forcedTlds ? ' (.ai only)' : ''}:`;

      const notEnough = finalList.length < targetAvailableCount;
      const footer = notEnough
        ? (french
            ? `\n\nJe n'ai pas réussi à trouver ${targetAvailableCount} domaines disponibles avec ces contraintes. Essaie un brief plus large (mots-clés, style) ou autorise d'autres extensions.`
            : `\n\nI couldn't reach ${targetAvailableCount} available domains with the current constraints. Try broadening the brief or allowing more TLDs.`)
        : '';

      finalUiMessage = {
        id: (Date.now() + 4242).toString(),
        role: Role.MODEL,
        text:
          finalLines.length > 0
            ? `${header}\n${finalLines.join('\n')}${footer}`
            : (french
                ? `Je n'ai pas trouvé de domaine disponible dans la limite de sécurité (${modelCallCount}/${MAX_MODEL_CALLS} appels, ~${Math.round((Date.now() - startTs) / 1000)}s). Soit on augmente la limite, soit on change la stratégie (noms plus inventés/courts), soit on autorise d'autres extensions.`
                : `I couldn't find an available domain within the safety limit (${modelCallCount}/${MAX_MODEL_CALLS} calls, ~${Math.round((Date.now() - startTs) / 1000)}s). We can increase the limit, generate more invented/shorter names, or allow more TLDs.`)
      };

      log('Brainstorm final', {
        found: finalList.length,
        targetAvailableCount,
        forcedTlds,
        domains: finalList.map(d => d.domain)
      });

      // Update UI: show ALL available domains found across the brainstorm loops.
      // We provide a synthetic tool response so the cards can render everything (no duplicates).
      const allAvailable = Array.from(availableDomains.values()).slice(0, targetAvailableCount);
      const toolCallId = 'available';
      const toolCallArgs = {
        names: allAvailable.map(r => r.baseName).filter(Boolean),
        tlds: (forcedTlds && forcedTlds.length > 0) ? forcedTlds : selectedTlds
      };
      const uiMsg: Message = {
        ...finalUiMessage,
        toolCalls:
          allAvailable.length > 0
            ? [
                {
                  id: toolCallId,
                  name: 'checkDomains',
                  args: toolCallArgs
                }
              ]
            : undefined,
        toolResponses:
          allAvailable.length > 0
            ? [
                {
                  id: toolCallId,
                  name: 'checkDomains',
                  args: {},
                  result: allAvailable
                }
              ]
            : undefined,
        toolDisplayMode: 'availableOnly'
      };

      // Replace the pending bubble with the final brainstorm message.
      setMessages(prev => prev.map(m => (m.id === pendingId ? uiMsg : m)));

    } catch (error) {
      console.error("Error in chat loop:", error);
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: Role.MODEL,
        text: "Sorry, I encountered an error connecting to the brain. Please try again.",
        isError: true
      };
      // If we created a pending brainstorm bubble, replace it; otherwise append.
      if (mode === 'brainstorm') {
        setMessages(prev => prev.map(m => (m.id === pendingId ? errorMsg : m)));
      } else {
        setMessages(prev => [...prev, errorMsg]);
      }
    } finally {
      setIsLoading(false);
      // eslint-disable-next-line no-console
      console.groupEnd?.();
    }
  }, [inputValue, isLoading, selectedTlds, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleTld = (tld: string) => {
    setSelectedTlds(prev => 
      prev.includes(tld) 
        ? prev.filter(t => t !== tld)
        : [...prev, tld]
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 relative overflow-hidden">
      
      {/* Sidebar (Desktop & Mobile) */}
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)}
        selectedTlds={selectedTlds}
        onToggleTld={toggleTld}
        onOpenExplanation={() => setIsExplanationOpen(true)}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative w-full h-full">
        
        {/* Mobile Header */}
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex justify-between items-center sticky top-0 z-20 shadow-sm">
          <div className="flex items-center gap-2 text-indigo-700">
            <div className="bg-indigo-600 p-1.5 rounded-lg">
               <Sparkles className="text-white" size={16} />
            </div>
            <h1 className="text-lg font-bold tracking-tight">Namer.ai</h1>
          </div>
          
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
          >
            <Menu size={24} />
          </button>
        </header>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth bg-slate-50/50">
          <div className="max-w-3xl mx-auto flex flex-col pt-4">
            {messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isLoading && (
              <div className="flex justify-start mb-6">
                 <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                 </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-200">
          <div className="max-w-3xl mx-auto relative">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your brand idea (e.g., 'A sustainable coffee shop with a tech vibe')..."
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-5 pr-14 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none shadow-sm text-slate-800 placeholder:text-slate-400 min-h-[60px] max-h-[120px]"
              rows={1}
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="absolute right-3 bottom-3 p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors shadow-sm"
            >
              <Send size={20} />
            </button>
          </div>
          <div className="max-w-3xl mx-auto mt-2 flex justify-between items-center px-2">
             <p className="text-xs text-slate-400">
               Checking: {selectedTlds.slice(0, 3).join(', ')}{selectedTlds.length > 3 ? ` +${selectedTlds.length - 3} more` : ''}
             </p>
             {isBackendConfigured === false && (
               <div className="flex items-center text-xs text-red-500 gap-1 font-medium">
                  <AlertCircle size={12} />
                  <span>Backend not configured</span>
               </div>
             )}
          </div>
        </div>
      </main>

      {/* Explanation Modal */}
      <ExplanationModal 
        isOpen={isExplanationOpen} 
        onClose={() => setIsExplanationOpen(false)} 
      />
    </div>
  );
}

export default App;