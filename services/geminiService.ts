// Backwards-compatible re-export.
// The app now talks to a Mistral-backed `/api/chat`, but keeping this file avoids churn.
export { sendMessageToBackend } from './chatService';
