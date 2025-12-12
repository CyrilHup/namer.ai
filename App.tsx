import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Menu, Sparkles, AlertCircle, Moon, Sun, PanelLeft } from 'lucide-react';
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

  // Look for patterns like:
  // - "give me 10", "give me only 5", "just 5", "only 7"
  // - "suggest 12 names", "10 domains", "need 5 options".
  const patterns: RegExp[] = [
    // allow small filler words between the verb and the number
    /\b(?:give|suggest|generate|find|need|want|provide|show)\s+(?:me\s+)?(?:only\s+|just\s+)?(\d{1,2})\b/i,
    /\b(?:only|just)\s+(\d{1,2})\b/i,
    /\b(\d{1,2})\s+(?:names|name|domains|domain|options|ideas|suggestions)\b/i
  ];

  // French patterns: "je veux 5 noms", "donne-moi 4", "4 noms", "j'en veux 6".
  patterns.push(
    /\b(?:je\s*veux|j\s*en\s*veux|donne(?:-moi)?|propose(?:-moi)?|genere|g[ée]n[ée]re|trouve|il\s*me\s*faut)\s+(?:seulement\s+|juste\s+|que\s+)?(\d{1,2})\b/i,
    /\b(?:seulement|juste|que)\s+(\d{1,2})\b/i,
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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem('theme');
      if (stored === 'dark' || stored === 'light') return stored;
      return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  
  // UI States
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try {
      return window.matchMedia?.('(min-width: 768px)')?.matches ?? false;
    } catch {
      return false;
    }
  });
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const autosizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Apply theme to the document root so Tailwind dark: classes work.
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    autosizeTextarea();
  }, [inputValue, autosizeTextarea]);

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
    // reset autosize immediately for snappy UX
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = '0px';
    });
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
      // If the user explicitly asks for N names, treat that as a hard cap.
      // If they don't, we use 3 as a minimum target, but we will return *all* available domains we happened to find.
      const hardAvailableCap = desiredAvailableCount ?? null;
      const targetAvailableCount = hardAvailableCap ?? 3;
      const forceAiOnly = userForcesAiTld(userText);
      const explicitTlds = extractExplicitTlds(userText);

      const clearsConstraint = userClearsTldConstraint(userText);
      // Treat short "count-only" followups like "give me only 5" as continuations so we keep
      // previously forced TLDs (e.g. user said ".ai only" earlier, then adjusts the count).
      const countOnlyContinuation =
        desiredAvailableCount != null &&
        !(explicitTlds && explicitTlds.length > 0) &&
        !clearsConstraint &&
        !forceAiOnly &&
        String(userText || '').trim().split(/\s+/).length <= 8;
      const continuation = isContinuationBrainstormRequest(userText) || countOnlyContinuation;

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
        hardAvailableCap,
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
        // We mostly drive the model to emit tool calls / JSON candidates; the UI builds the final answer.
        // Still, being explicit here improves reliability.
        if (hardAvailableCap != null) {
          parts.push(`\nHard requirement: we need EXACTLY ${hardAvailableCap} AVAILABLE domains total. Stop as soon as you have enough.`);
        } else {
          parts.push(`\nRequirement: we need AT LEAST ${targetAvailableCount} AVAILABLE domains total. If your checks produce more, that's fine — do not throw them away.`);
        }
        if (forcedTlds && forcedTlds.length > 0) {
          parts.push(`\nTLD constraint: ONLY use these TLDs: ${forcedTlds.join(', ')}.`);
        }

        const remaining = Math.max(0, targetAvailableCount - availableDomains.size);
        // Heuristic: ask for more candidates when we're aiming for a minimum, but keep it tighter
        // when the user asked for an exact count.
        const multiplier = hardAvailableCap != null ? (forceAiOnly ? 6 : 3) : (forceAiOnly ? 10 : 6);
        const desiredBatch = clamp(Math.ceil(Math.max(MIN_CANDIDATES_PER_CALL, remaining * multiplier)), MIN_CANDIDATES_PER_CALL, MAX_CANDIDATES_PER_CALL);
        parts.push(
          `\nEfficiency requirement: On your NEXT checkDomains tool call, include ${desiredBatch} NEW, unique base names (no TLDs). Avoid repeats. Do not write a final answer yet.`
        );

        parts.push(
          `\nIf you cannot emit tool calls for any reason, output ONLY a valid JSON array of ${desiredBatch} NEW base names (strings), no prose.`
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
          const multiplier = hardAvailableCap != null ? (forceAiOnly ? 6 : 3) : (forceAiOnly ? 10 : 6);
          const desiredBatch = clamp(Math.ceil(Math.max(MIN_CANDIDATES_PER_CALL, remaining * multiplier)), MIN_CANDIDATES_PER_CALL, MAX_CANDIDATES_PER_CALL);

          // Fallback: if the model won't emit tool_calls, ask for strict JSON list and check ourselves.
          const parsedNames = tryParseJsonNameList(result?.text || '');
          if (parsedNames && parsedNames.length > 0) {
            const finalTldsToCheck = forcedTlds && forcedTlds.length > 0 ? forcedTlds : selectedTlds;
            log('Names generated by Mistral (parsed JSON/fallback):', parsedNames);
            for (const base of parsedNames) checkedBaseNames.add(base);

            const availabilityResults = await checkMultipleDomains(parsedNames, finalTldsToCheck);
            for (const r of availabilityResults) {
              log(`Tested ${r.domain}: ${r.status}`);
              if (r?.status === 'available' && r?.domain) {
                if (hardAvailableCap == null || availableDomains.size < hardAvailableCap) {
                  availableDomains.set(r.domain, r);
                }
              }
              if (hardAvailableCap != null && availableDomains.size >= hardAvailableCap) break;
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
                  : `Internal instruction: We still need ${remaining} more AVAILABLE domains. Generate ${desiredBatch} NEW candidate base names (no TLDs) and CALL checkDomains immediately. If you can't call tools, output ONLY JSON.`
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
                  if (hardAvailableCap == null || availableDomains.size < hardAvailableCap) {
                    availableDomains.set(r.domain, r);
                  }
                }
                if (hardAvailableCap != null && availableDomains.size >= hardAvailableCap) break;
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

        // If user asked for an explicit limit, stop immediately once we reach it.
        if (hardAvailableCap != null && availableDomains.size >= hardAvailableCap) break;
      }

      // If we never got a final assistant message without tool calls, fall back to a minimal summary.
      const finalList = hardAvailableCap != null
        ? Array.from(availableDomains.values()).slice(0, hardAvailableCap)
        : Array.from(availableDomains.values());
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
        hardAvailableCap,
        forcedTlds,
        domains: finalList.map(d => d.domain)
      });

      // Update UI: show ALL available domains found across the brainstorm loops.
      // We provide a synthetic tool response so the cards can render everything (no duplicates).
      const allAvailable = hardAvailableCap != null
        ? Array.from(availableDomains.values()).slice(0, hardAvailableCap)
        : Array.from(availableDomains.values());
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

  const setTlds = (tlds: string[]) => {
    const next = Array.from(new Set(tlds)).filter(Boolean);
    setSelectedTlds(next.length > 0 ? next : ['.com']);
  };

  const quickPrompts = useMemo(
    () => [
      {
        label: 'AI tool for busy founders',
        value: 'I need a brand name for an AI tool that helps busy founders turn meeting notes into clear action items. Modern, short, easy to spell.'
      },
      {
        label: 'SaaS B2B (clean & pro)',
        value: 'Suggest names for a B2B SaaS that automates invoice follow-up. Clean, professional, not too playful.'
      },
      {
        label: 'App écolo (FR)',
        value: "Je cherche un nom pour une app qui aide à réduire le gaspillage alimentaire. Style moderne, prononçable, pas trop long."
      },
      {
        label: 'Creator economy',
        value: 'Brand names for a platform that helps creators sell digital products. Trendy but timeless.'
      }
    ],
    []
  );

  return (
    <div className="app-bg flex h-dvh bg-[rgb(var(--c-bg))] text-[rgb(var(--c-fg))] relative overflow-hidden">
      
      {/* Sidebar (Desktop & Mobile) */}
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)}
        selectedTlds={selectedTlds}
        onToggleTld={toggleTld}
        onSetTlds={setTlds}
        onOpenExplanation={() => setIsExplanationOpen(true)}
      />

      {/* Main Content */}
      <main
        className={`flex-1 flex flex-col relative w-full h-full min-h-0 transition-[padding] duration-300 ${
          isSidebarOpen ? 'md:pl-80' : 'md:pl-0'
        }`}
      >

        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-between gap-3 px-6 py-4 sticky top-0 z-20 border-b border-[rgb(var(--c-ink)/0.12)] surface">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(v => !v)}
              className="focus-ring inline-flex items-center justify-center w-10 h-10 rounded-xl surface hover:bg-[rgb(var(--c-surface)/0.9)] transition"
              aria-label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              <PanelLeft size={18} className="text-[rgb(var(--c-muted))]" />
            </button>

            <div className="flex items-center gap-2">
              <div className="brand-badge p-2 rounded-xl">
                <Sparkles className="text-[rgb(12_16_26)]" size={18} />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-display font-bold tracking-tight truncate">Namer.ai</h1>
                <p className="text-xs text-[rgb(var(--c-muted))] truncate">Premium name ideas + real-time domain checks</p>
              </div>
            </div>

            {isBackendConfigured === false && (
              <div className="ml-2 inline-flex items-center gap-2 rounded-full border border-red-200/70 dark:border-red-900/40 bg-red-50/70 dark:bg-red-950/30 px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-200">
                <AlertCircle size={14} />
                Backend not configured
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden lg:flex items-center gap-1 rounded-full border border-[rgb(var(--c-ink)/0.12)] bg-[rgb(var(--c-surface)/0.50)] px-2 py-1">
              <span className="text-xs font-semibold text-[rgb(var(--c-muted))] px-1">Checking</span>
              {selectedTlds.slice(0, 4).map(tld => (
                <span key={tld} className="text-xs font-semibold px-2 py-1 rounded-full bg-[rgb(var(--c-surface)/0.65)] border border-[rgb(var(--c-ink)/0.10)] text-[rgb(var(--c-fg))]">
                  {tld}
                </span>
              ))}
              {selectedTlds.length > 4 && (
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-[rgb(var(--c-surface)/0.65)] border border-[rgb(var(--c-ink)/0.10)] text-[rgb(var(--c-fg))]">
                  +{selectedTlds.length - 4}
                </span>
              )}
            </div>

            <button
              onClick={() => setIsExplanationOpen(true)}
              className="focus-ring inline-flex items-center justify-center rounded-xl surface hover:bg-[rgb(var(--c-surface)/0.9)] transition px-3 h-10 text-sm font-semibold"
            >
              How it works
            </button>

            <button
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
              className="focus-ring inline-flex items-center justify-center w-10 h-10 rounded-xl surface hover:bg-[rgb(var(--c-surface)/0.9)] transition"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun size={18} className="text-[rgb(var(--c-fg))]" />
              ) : (
                <Moon size={18} className="text-[rgb(var(--c-fg))]" />
              )}
            </button>
          </div>
        </header>
        
        {/* Mobile Header */}
        <header className="md:hidden surface border-b border-[rgb(var(--c-ink)/0.12)] px-4 py-3 flex justify-between items-center sticky top-0 z-20 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="brand-badge p-1.5 rounded-lg">
               <Sparkles className="text-[rgb(12_16_26)]" size={16} />
            </div>
            <h1 className="text-lg font-display font-bold tracking-tight">Namer.ai</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
              className="focus-ring p-2 text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface)/0.70)] rounded-xl transition"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="focus-ring p-2 text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface)/0.70)] rounded-xl transition"
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
          </div>
        </header>

        {/* Chat History */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8 pb-28 md:pb-32 scroll-smooth custom-scrollbar">
          <div className="max-w-3xl mx-auto flex flex-col pt-6 md:pt-8">
            {messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            {/* Quick-start (only before the first user message) */}
            {messages.length === 1 && !isLoading && (
              <div className="mt-2 mb-10">
                <div className="rounded-3xl surface shadow-soft p-5 md:p-6">
                  <h2 className="text-sm md:text-base font-display font-bold">Start with a great brief</h2>
                  <p className="mt-1 text-sm text-[rgb(var(--c-muted))]">
                    Click an example to prefill, or just describe your project in one sentence.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {quickPrompts.map(p => (
                      <button
                        key={p.label}
                        onClick={() => {
                          setInputValue(p.value);
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                        className="focus-ring inline-flex items-center rounded-full surface hover:bg-[rgb(var(--c-surface)/0.9)] px-3.5 py-2 text-sm font-semibold transition"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {isLoading && (
              <div className="flex justify-start mb-6">
                 <div className="surface px-4 py-3 rounded-2xl rounded-tl-none shadow-soft flex items-center gap-2">
                   <div className="w-2 h-2 bg-[rgb(var(--c-accent2))] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                   <div className="w-2 h-2 bg-[rgb(var(--c-accent2))] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                   <div className="w-2 h-2 bg-[rgb(var(--c-accent2))] rounded-full animate-bounce"></div>
                 </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="sticky bottom-0 z-20 p-4 md:p-6 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-[rgb(var(--c-ink)/0.12)] surface-strong">
          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-3xl surface shadow-soft">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe your project (tone, audience, constraints)…"
                className="focus-ring w-full bg-transparent rounded-3xl pl-5 pr-14 py-4 resize-none text-[rgb(var(--c-fg))] placeholder:text-[rgb(var(--c-muted))] min-h-[58px] max-h-[160px]"
                rows={1}
                disabled={isLoading}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isLoading}
                className="focus-ring absolute right-3 bottom-3 inline-flex items-center justify-center w-11 h-11 rounded-2xl btn-primary disabled:opacity-50 transition"
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            </div>

            <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1">
              <p className="text-xs text-[rgb(var(--c-muted))]">
                <span className="font-semibold">Tip:</span> Press <span className="font-semibold">Enter</span> to send, <span className="font-semibold">Shift+Enter</span> for a new line.
              </p>
              <p className="text-xs text-[rgb(var(--c-muted))]">
                Checking {selectedTlds.slice(0, 3).join(', ')}{selectedTlds.length > 3 ? ` +${selectedTlds.length - 3} more` : ''}
              </p>
            </div>
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