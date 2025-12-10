import { DomainCheckResult } from '../types';

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
  const domain = `${baseName.toLowerCase()}${tld}`;
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
      tld,
      baseName
    };
  } catch (error) {
    console.error(`Error checking domain ${domain}:`, error);
    return {
      domain,
      status: 'unknown',
      tld,
      baseName
    };
  }
};

export const checkMultipleDomains = async (baseNames: string[], tlds: string[]): Promise<DomainCheckResult[]> => {
  const promises: Promise<DomainCheckResult>[] = [];
  
  for (const name of baseNames) {
    // Sanitize name (remove spaces, special chars)
    const cleanName = name.replace(/[^a-zA-Z0-9-]/g, '');
    if (!cleanName) continue;

    for (const tld of tlds) {
      promises.push(checkDomainAvailability(cleanName, tld));
    }
  }

  return Promise.all(promises);
};