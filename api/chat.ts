/// <reference types="node" />

import { buildChatResponse } from '../server/mistralChat';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { status, json } = await buildChatResponse(req.body, process.env);
    return res.status(status).json(json);
  } catch (error: any) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
