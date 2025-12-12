import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { buildChatResponse, sanitizeEnvValue } from './server/mistralChat';

const readJsonBody = async (req: any): Promise<any> => {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: any) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
};

const localApiPlugin = (): Plugin => {
  return {
    name: 'local-api-middleware',
    configureServer(server) {
      server.middlewares.use('/api/health', async (req, res, next) => {
        try {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
            return;
          }

          const hasKey = Boolean(sanitizeEnvValue(process.env.MISTRAL_API_KEY));
          res.statusCode = hasKey ? 200 : 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: hasKey, configured: hasKey }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e?.message || 'Internal Server Error' }));
        }
      });

      server.middlewares.use('/api/chat', async (req, res, next) => {
        try {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          const body = await readJsonBody(req);

          const { status, json } = await buildChatResponse(body, process.env);
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(json));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e?.message || 'Internal Server Error' }));
        }
      });
    }
  };
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Make .env values available to the dev-server middleware via process.env
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') process.env[k] = v;
    }
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), localApiPlugin()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
