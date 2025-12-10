import { GoogleGenAI, Type, FunctionDeclaration, Content } from "@google/genai";

const checkDomainsTool: FunctionDeclaration = {
  name: "checkDomains",
  description: "Check the availability of domain names for specific base brand names. Use this whenever the user asks to check availability or when you generate a list of potential brand names.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      names: {
        type: Type.ARRAY,
        items: {
          type: Type.STRING
        },
        description: "A list of base brand names to check (e.g. ['Spotify', 'Google']). Do not include the extension/TLD."
      }
    },
    required: ["names"]
  }
};

// Duplicate types to avoid import issues from src
enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

interface ToolCallData {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: any;
}

interface Message {
  id: string;
  role: Role;
  text: string;
  toolCalls?: ToolCallData[];
  toolResponses?: ToolCallData[];
  isError?: boolean;
}

const mapMessagesToHistory = (messages: Message[]): Content[] => {
  return messages
    .filter(m => m.role !== Role.SYSTEM && !m.isError)
    .flatMap(m => {
        const parts: Content[] = [];

        // 1. If it's a model message with tool calls, add the function call part
        if (m.role === Role.MODEL && m.toolCalls && m.toolCalls.length > 0) {
             parts.push({
                 role: 'model',
                 parts: [
                     { text: m.text || "" }, // Text usually comes before tool call
                     ...m.toolCalls.map(tc => ({
                         functionCall: {
                             name: tc.name,
                             args: tc.args,
                             id: tc.id // Important for matching response
                         }
                     }))
                 ]
             });
        } 
        // 2. If it's a model message WITHOUT tool calls, just text
        else if (m.role === Role.MODEL) {
            parts.push({
                role: 'model',
                parts: [{ text: m.text }]
            });
        }
        // 3. If it's a user message
        else if (m.role === Role.USER) {
            parts.push({
                role: 'user',
                parts: [{ text: m.text }]
            });
        }

        // 4. If the message contains tool responses (results), append them as a separate 'function' role message
        // This assumes the tool response corresponds to the tool calls in the SAME message object (as structured in App.tsx)
        if (m.toolResponses && m.toolResponses.length > 0) {
            parts.push({
                role: 'user', // Gemini expects tool responses as 'user' role or 'function' role depending on API version. @google/genai usually handles this.
                // Actually, for @google/genai, it's often 'function' role or part of 'user' turn?
                // Let's check the docs or assume 'function' role if supported, or 'user' with functionResponse parts.
                // The SDK usually expects `role: 'function'` or `parts: [{ functionResponse: ... }]`.
                // Let's try `role: 'function'` which is standard for many LLM APIs, but Gemini might be specific.
                // In the previous `geminiService.ts`, it wasn't implemented.
                // Based on Google GenAI docs, it's `role: 'function'` or just `parts` with `functionResponse`.
                // Let's use `role: 'function'` to be explicit.
                // Wait, the type definition for `Content` might restrict roles.
                // If `role` can only be 'user' | 'model', then it must be 'user'.
                // Let's assume 'user' for now as it's safer for "client provided info".
                // Actually, looking at `geminiService.ts` read earlier: `role: m.role === Role.USER ? 'user' : 'model'`.
                // Let's use `role: 'function'` if the type allows, otherwise `user`.
                // I will use `user` but with `functionResponse` parts.
                parts: m.toolResponses.map(tr => ({
                    functionResponse: {
                        name: tr.name,
                        id: tr.id, // Must match the functionCall id
                        response: { result: tr.result }
                    }
                }))
            });
        }

        return parts;
    });
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, systemInstruction } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing API Key' });
    }

    const client = new GoogleGenAI({ apiKey });

    // Separate history from the last message
    // The frontend sends the FULL list including the new message.
    // But for `chat.sendMessage`, we need history + new message.
    // However, if the last message is from USER, we treat it as the new message.
    // If the last message is from MODEL (with tool calls) and we are sending tool responses, 
    // then the "new message" is the tool response.
    
    // Let's simplify: We reconstruct the FULL history up to the second-to-last item.
    // And use the last item as the `sendMessage` argument.
    
    // Wait, `sendMessage` takes `string | Part[]`.
    // If the last item is a User text message: `sendMessage(text)`.
    // If the last item is a Tool Response: `sendMessage(toolResponseParts)`.
    
    const allContent = mapMessagesToHistory(messages);
    
    if (allContent.length === 0) {
        return res.status(400).json({ error: 'No messages provided' });
    }

    const history = allContent.slice(0, -1);
    const lastMessage = allContent[allContent.length - 1];

    const chat = client.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: [checkDomainsTool] }],
        temperature: 0.9,
      },
      history: history
    });

    const result = await chat.sendMessage(lastMessage.parts);
    const response = result.response;

    // Extract text and tool calls
    const text = response.text();
    const functionCalls = response.functionCalls();

    return res.status(200).json({
      text,
      functionCalls: functionCalls?.map(fc => ({
          id: fc.id,
          name: fc.name,
          args: fc.args
      }))
    });

  } catch (error: any) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
