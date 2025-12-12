import { Message } from "../types";

export interface ChatBackendResponse {
  text: string;
  functionCalls?: Array<{ id: string; name: string; args: Record<string, any> }>;
}

export const sendMessageToBackend = async (
  messages: Message[],
  systemInstruction: string
): Promise<ChatBackendResponse> => {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, systemInstruction }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to communicate with server');
  }

  return response.json();
};
