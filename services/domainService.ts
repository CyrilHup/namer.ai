import { DomainCheckResult } from '../types';

const normalizeBaseName = (name: string): string | null => {
  const raw = String(name || '').trim();
  if (!raw) return null;
  // lowercase, allow a-z, 0-9 and hyphens, strip everything else
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  if (!cleaned) return null;
  // DNS label length limit (63); keep it safe.
  return cleaned.slice(0, 63);
};

const normalizeTld = (tld: string): string | null => {
  const raw = String(tld || '').trim().toLowerCase();
  if (!raw) return null;
  return raw.startsWith('.') ? raw : `.${raw}`;
};

/**
 * Checks domain availability using Google's DNS-over-HTTPS API.
 * 
 * Logic:
 * - Status 0 (NOERROR) usually means the domain exists (Taken).
 * - Status 3 (NXDOMAIN) usually means the domain does not exist (Available).
 * 
 * This is a frontend-only approximation. For production, use a real WHOIS/RDAP API.
 */
export const checkDomainAvailability = async (baseName: string, tld: string): Promise<DomainCheckResult> => {
  const cleanBase = normalizeBaseName(baseName) || String(baseName || '').toLowerCase();
  const cleanTld = normalizeTld(tld) || String(tld || '').toLowerCase();
  const domain = `${cleanBase}${cleanTld}`;
  const url = `https://dns.google/resolve?name=${domain}&type=A`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // Status 3 = NXDOMAIN (Non-Existent Domain) -> Likely Available
    // Status 0 = NOERROR (Domain exists) -> Taken
    let status: 'available' | 'taken' | 'unknown' = 'unknown';

    if (data.Status === 3) {
      status = 'available';
    } else if (data.Status === 0) {
      status = 'taken';
    }

    return {
      domain,
      status,
      tld: cleanTld,
      baseName: cleanBase
    };
  } catch (error) {
    console.error(`Error checking domain ${domain}:`, error);
    return {
      domain,
      status: 'unknown',
      tld: cleanTld,
      baseName: cleanBase
    };
  }
};

export const checkMultipleDomains = async (baseNames: string[], tlds: string[]): Promise<DomainCheckResult[]> => {
  const names = Array.from(
    new Set((baseNames || []).map(normalizeBaseName).filter((v): v is string => Boolean(v)))
  );
  const exts = Array.from(new Set((tlds || []).map(normalizeTld).filter((v): v is string => Boolean(v))));

  const promises: Promise<DomainCheckResult>[] = [];
  for (const name of names) {
    for (const tld of exts) {
      promises.push(checkDomainAvailability(name, tld));
    }
  }

  return Promise.all(promises);
};