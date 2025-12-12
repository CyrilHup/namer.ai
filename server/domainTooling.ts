import { AVAILABLE_TLDS, Message, Role } from '../types';

export type DomainToolArgs = { names: string[]; tlds?: string[] };

const normalizeBaseNameFromText = (raw: string): string | null => {
  const t = String(raw || '').trim();
  if (!t) return null;
  const cleaned = t
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 63);
  return cleaned || null;
};

const extractCandidatesFromText = (
  text: string,
  stopWords: Set<string>
): { names: string[]; tlds: string[] } => {
  const t = String(text || '');
  const names: string[] = [];
  const tlds: string[] = [];
  const seenNames = new Set<string>();
  const seenTlds = new Set<string>();

  // 1) Capture full domains anywhere in the text.
  // Example: "domai.ai", "namerai.ai".
  const domainRe = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z]{2,})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = domainRe.exec(t))) {
    const base = normalizeBaseNameFromText(m[1]);
    const tld = `.${String(m[2] || '').toLowerCase()}`;
    if (base && !stopWords.has(base) && !seenNames.has(base)) {
      names.push(base);
      seenNames.add(base);
    }
    if (tld && !seenTlds.has(tld)) {
      tlds.push(tld);
      seenTlds.add(tld);
    }
    if (names.length >= 16) break;
  }

  // 2) Capture simple list items like:
  // "1. Domai.ai" or "- Domly" or "Namely.ai".
  const lines = t.split(/\r?\n/);
  for (const line of lines) {
    const lm = line.match(/^\s*(?:[-*]|\d+\.|\d+\))\s*([^\s,;:()]{2,80})/);
    if (!lm) continue;
    const token = String(lm[1] || '').trim();
    if (!token) continue;

    // If it looks like a full domain, domainRe already got it.
    const tokenBase = token.includes('.') ? token.split('.')[0] : token;
    const base = normalizeBaseNameFromText(tokenBase);
    if (base && !stopWords.has(base) && !seenNames.has(base)) {
      names.push(base);
      seenNames.add(base);
    }
    if (names.length >= 16) break;
  }

  return { names, tlds };
};

export const extractDomainRequest = (text: string): DomainToolArgs | null => {
  const t = String(text || '').trim();
  if (!t) return null;

  const stopWords = new Set(['the', 'a', 'an', 'name', 'domain', 'again', 'please']);

  // 1) Extract many candidates from the text (domains and list items)
  const extracted = extractCandidatesFromText(t, stopWords);
  if (extracted.names.length > 0) {
    return extracted.tlds.length > 0
      ? { names: extracted.names, tlds: extracted.tlds }
      : { names: extracted.names };
  }

  // 2) Quoted name(s) like "namer" (also explicit)
  const quotedNames: string[] = [];
  const quotedRe = /"([^"\n]{2,64})"|'([^'\n]{2,64})'/g;
  let qm: RegExpExecArray | null;
  while ((qm = quotedRe.exec(t))) {
    const q = String(qm[1] || qm[2] || '').trim();
    const base = normalizeBaseNameFromText(q);
    if (base && !stopWords.has(base)) quotedNames.push(q);
    if (quotedNames.length >= 8) break;
  }
  if (quotedNames.length > 0) return { names: quotedNames };

  // 3) Patterns like "check again namer" (no quotes).
  // Keep conservative to avoid capturing arbitrary words.
  const checkAgainBare = t.match(/\bcheck\s+again\s+([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\b/i);
  if (checkAgainBare) {
    return { names: [checkAgainBare[1]] };
  }

  // 4) Natural phrasing: "check the name namer" / "check name namer" / "check domain namer"
  const checkNamePhrase = t.match(/\bcheck\s+(?:the\s+)?(?:name|domain)\s+([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\b/i);
  if (checkNamePhrase) {
    const candidate = String(checkNamePhrase[1]).toLowerCase();
    if (candidate && !stopWords.has(candidate)) return { names: [checkNamePhrase[1]] };
  }

  // 5) Bare "check X" as a last resort.
  // Avoid grabbing filler words like "the" in "check the name ...".
  const checkBare = t.match(/\bcheck\s+([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\b/i);
  if (checkBare) {
    const candidate = String(checkBare[1]).toLowerCase();
    if (candidate && !stopWords.has(candidate) && candidate !== 'again') {
      return { names: [checkBare[1]] };
    }
  }

  return null;
};

export const expandTldsProgressively = (
  previousTlds: string[] | undefined,
  universe: string[] = AVAILABLE_TLDS
): string[] => {
  const prevUnique = Array.from(new Set((previousTlds || []).filter(Boolean).map(s => s.toLowerCase())));
  const universeUnique = Array.from(new Set((universe || []).filter(Boolean).map(s => s.toLowerCase())));

  // Next tier sizes: first retry -> ~8, second -> ~12, then -> ~16, then -> full list.
  const tiers = [8, 12, 16, universeUnique.length];
  const nextSize = tiers.find(n => n > prevUnique.length) ?? universeUnique.length;

  const out: string[] = [];
  const seen = new Set<string>();

  // Keep previously checked TLDs first (stable).
  for (const tld of prevUnique) {
    if (!seen.has(tld)) {
      out.push(tld);
      seen.add(tld);
    }
  }

  // Append universe to expand.
  for (const tld of universeUnique) {
    if (!seen.has(tld)) {
      out.push(tld);
      seen.add(tld);
    }
    if (out.length >= nextSize) break;
  }

  // Preserve original casing of universe where possible (cosmetic only).
  const byLower = new Map(universe.map(t => [t.toLowerCase(), t] as const));
  return out.map(t => byLower.get(t) ?? t);
};

export const inferLastCheckedFromHistory = (
  messages: Message[]
): { names: string[]; tlds: string[] } | null => {
  for (const m of [...(messages || [])].reverse()) {
    const toolResponses = m?.toolResponses;
    if (!Array.isArray(toolResponses) || toolResponses.length === 0) continue;

    for (const tr of [...toolResponses].reverse()) {
      const results = (tr as any)?.result;
      if (!Array.isArray(results) || results.length === 0) continue;

      const names: string[] = [];
      const tlds: string[] = [];

      for (const r of results as any[]) {
        const baseName = String(r?.baseName || '').trim();
        const tld = String(r?.tld || '').trim();
        if (baseName) names.push(baseName);
        if (tld) tlds.push(tld);
      }

      const uniqNames = Array.from(new Set(names)).slice(0, 6);
      const uniqTlds = Array.from(new Set(tlds.map(s => s.toLowerCase())));
      if (uniqNames.length === 0) continue;

      return { names: uniqNames, tlds: uniqTlds };
    }
  }
  return null;
};

export const shouldAutoCallDomainTool = (
  messages: Message[],
  assistantText: string,
  universe: string[] = AVAILABLE_TLDS
): DomainToolArgs | null => {
  const lastUser = [...(messages || [])].reverse().find(m => m?.role === Role.USER && !m?.isError);
  const userText = String(lastUser?.text || '').trim();

  const trigger = /(\bcheck\b|\bavailable\b|\bavailability\b|\bopen\b|\bdomain\b)/i;
  const retryTrigger = /^(?:again|check\s+again|recheck|retry|more)\b/i;
  const assistantSuggestsChecking = /(let me check|i will check|i\s*'?ll check|i can check|checking)/i.test(
    String(assistantText || '')
  );
  const userAsksCheck = trigger.test(userText);

  // Special case: user asks "again" (often with no domain text). Infer from history.
  if (retryTrigger.test(userText)) {
    const last = inferLastCheckedFromHistory(messages);
    if (last?.names?.length) {
      return { names: last.names, tlds: expandTldsProgressively(last.tlds, universe) };
    }
  }

  if (!assistantSuggestsChecking && !userAsksCheck) return null;

  // Prefer extracting from the user's ask; fall back to assistant text.
  return extractDomainRequest(userText) || extractDomainRequest(String(assistantText || ''));
};

export const generateToolCallId = (): string => {
  // Mistral constraint: tool call id must be [a-zA-Z0-9] with length 9.
  // Use base36 (0-9a-z) and pad/truncate to exactly 9 chars.
  const id = Math.random().toString(36).slice(2, 11);
  return id.padEnd(9, '0').slice(0, 9);
};
