import { Message } from "../types";

export const sendMessageToBackend = async (messages: Message[], systemInstruction: string) => {
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
