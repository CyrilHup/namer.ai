export enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface DomainCheckResult {
  domain: string;
  status: 'available' | 'taken' | 'unknown';
  tld: string;
  baseName: string;
}

export interface ToolCallData {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: any;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  toolCalls?: ToolCallData[]; // If the message initiated a tool call
  toolResponses?: ToolCallData[]; // The result of the tool call (usually associated with a separate message conceptually, but we can bundle for UI)
  isError?: boolean;
}

export interface AppState {
  messages: Message[];
  isLoading: boolean;
  selectedTlds: string[];
}

export const AVAILABLE_TLDS = [
  '.com',
  '.io',
  '.ai',
  '.co',
  '.net',
  '.org',
  '.app',
  '.dev',
  '.me',
  '.so',
  '.xyz',
  '.fr',
  '.de',
  '.uk'
];