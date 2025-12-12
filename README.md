<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1mZVZ0OjmYQ4ni7d_fSRarEiG6G-A2y-K

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `MISTRAL_API_KEY` in `.env.local` (recommended) to your Mistral API key
   - Optional: set `MISTRAL_MODEL` (defaults to `mistral-small-latest`)
3. Run the app:
   `npm run dev`

### Notes

- The browser never receives your API key. Calls go to `/api/chat`.
- You can verify server configuration via `GET /api/health`.
