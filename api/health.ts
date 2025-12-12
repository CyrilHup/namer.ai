/// <reference types="node" />

import { sanitizeEnvValue } from '../server/mistralChat';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const hasKey = Boolean(sanitizeEnvValue(process.env.MISTRAL_API_KEY));
  return res.status(hasKey ? 200 : 500).json({
    ok: hasKey,
    configured: hasKey
  });
}
