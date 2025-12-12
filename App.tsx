import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Menu, Sparkles, AlertCircle } from 'lucide-react';
import { Message, Role, DomainCheckResult } from './types';
import { sendMessageToBackend } from './services/chatService';
import { checkMultipleDomains } from './services/domainService';
import { ChatMessage } from './components/ChatMessage';
import { Sidebar } from './components/Sidebar';
import { ExplanationModal } from './components/ExplanationModal';

const SYSTEM_INSTRUCTION = `You are Namer.ai, a creative naming expert.
            Your goal is to help users brainstorm concise, modern, and memorable brand names.
            Always ask clarifying questions if the user's idea is vague (e.g., target audience, vibe).
            
            CRITICAL INSTRUCTION:
            When you suggest specific names, ALWAYS call the 'checkDomains' tool with the list of names (base names only, no extension).
            Do this immediately so the user sees availability.
            Don't ask "should I check availability?", just do it for the best suggestions.
            If the user asks to check a specific name or a specific full domain (e.g. "namer.ia"), use the tool.
            If a specific TLD is mentioned by the user, include it in the tool call as { tlds: ['.ia'] } (or the relevant TLD).
            If the user says "check again" / "again" / "recheck", you MUST run another availability check and expand the TLD set beyond the previous check (include multiple additional extensions, not just one).
            `;

const INITIAL_MESSAGE: Message = {
  id: 'init',
  role: Role.MODEL,
  text: "Hi! I'm Namer.ai. Tell me about your project, and I'll help you brainstorm names and check if the domains are available."
};

function App() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTlds, setSelectedTlds] = useState<string[]>(['.com', '.io', '.ai']);
  const [isBackendConfigured, setIsBackendConfigured] = useState<boolean | null>(null);
  
  // UI States
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Lightweight check: tells the UI if the server has MISTRAL_API_KEY configured.
    // (No secrets are exposed to the browser.)
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) {
          if (!cancelled) setIsBackendConfigured(false);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setIsBackendConfigured(Boolean(data?.ok));
      } catch {
        if (!cancelled) setIsBackendConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    // Add User Message
    const userMsg: Message = {
      id: Date.now().toString(),
      role: Role.USER,
      text: userText
    };
    
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    try {
      // Send message to Backend
      let result = await sendMessageToBackend(updatedMessages, SYSTEM_INSTRUCTION);
      
      // Handle Tool Calls if any
      const functionCalls = result.functionCalls;
      let toolResponsesData: any[] = [];
      let finalResponseText = result.text || "";

      if (functionCalls && functionCalls.length > 0) {
        // We have tool calls. Process them.
        const toolResponses = await Promise.all(functionCalls.map(async (call: any) => {
           if (call.name === 'checkDomains') {
              const { names, tlds } = call.args as { names: string[]; tlds?: string[] };
              const tldsToCheck = Array.isArray(tlds) && tlds.length > 0 ? tlds : selectedTlds;
              const availabilityResults = await checkMultipleDomains(names, tldsToCheck);
              
              return {
                 id: call.id,
                 name: call.name,
                 result: availabilityResults
              };
           }
           return { id: call.id, name: call.name, result: { error: 'Unknown tool' } };
        }));
        
        toolResponsesData = toolResponses;

        // Construct the message with tool calls to send back to history
        // We create a combined message that represents the model's call AND the tool's response
        // Our backend will split this into the correct sequence for tool-calling.
        const toolResponseMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: Role.MODEL,
            text: finalResponseText,
            toolCalls: functionCalls,
            toolResponses: toolResponsesData
        };
        
        const messagesWithTool = [...updatedMessages, toolResponseMessage];

        // Send the tool output back to the model
        const postToolResponse = await sendMessageToBackend(messagesWithTool, SYSTEM_INSTRUCTION);
        
        if (postToolResponse.text) {
             if (postToolResponse.text !== finalResponseText) {
                 finalResponseText += "\n\n" + postToolResponse.text;
             }
        }
        
        // Update the UI with the final message (including the new text)
        const finalModelMsg: Message = {
            ...toolResponseMessage,
            text: finalResponseText
        };
        
        setMessages(prev => [...prev, finalModelMsg]);

      } else {
          // No tool calls, just normal response
          const modelMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: Role.MODEL,
            text: finalResponseText
          };
          setMessages(prev => [...prev, modelMsg]);
      }

    } catch (error) {
      console.error("Error in chat loop:", error);
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: Role.MODEL,
        text: "Sorry, I encountered an error connecting to the brain. Please try again.",
        isError: true
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, selectedTlds, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleTld = (tld: string) => {
    setSelectedTlds(prev => 
      prev.includes(tld) 
        ? prev.filter(t => t !== tld)
        : [...prev, tld]
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 relative overflow-hidden">
      
      {/* Sidebar (Desktop & Mobile) */}
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)}
        selectedTlds={selectedTlds}
        onToggleTld={toggleTld}
        onOpenExplanation={() => setIsExplanationOpen(true)}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative w-full h-full">
        
        {/* Mobile Header */}
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex justify-between items-center sticky top-0 z-20 shadow-sm">
          <div className="flex items-center gap-2 text-indigo-700">
            <div className="bg-indigo-600 p-1.5 rounded-lg">
               <Sparkles className="text-white" size={16} />
            </div>
            <h1 className="text-lg font-bold tracking-tight">Namer.ai</h1>
          </div>
          
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
          >
            <Menu size={24} />
          </button>
        </header>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth bg-slate-50/50">
          <div className="max-w-3xl mx-auto flex flex-col pt-4">
            {messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isLoading && (
              <div className="flex justify-start mb-6">
                 <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                 </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-200">
          <div className="max-w-3xl mx-auto relative">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your brand idea (e.g., 'A sustainable coffee shop with a tech vibe')..."
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-5 pr-14 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none shadow-sm text-slate-800 placeholder:text-slate-400 min-h-[60px] max-h-[120px]"
              rows={1}
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="absolute right-3 bottom-3 p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors shadow-sm"
            >
              <Send size={20} />
            </button>
          </div>
          <div className="max-w-3xl mx-auto mt-2 flex justify-between items-center px-2">
             <p className="text-xs text-slate-400">
               Checking: {selectedTlds.slice(0, 3).join(', ')}{selectedTlds.length > 3 ? ` +${selectedTlds.length - 3} more` : ''}
             </p>
             {isBackendConfigured === false && (
               <div className="flex items-center text-xs text-red-500 gap-1 font-medium">
                  <AlertCircle size={12} />
                  <span>Backend not configured</span>
               </div>
             )}
          </div>
        </div>
      </main>

      {/* Explanation Modal */}
      <ExplanationModal 
        isOpen={isExplanationOpen} 
        onClose={() => setIsExplanationOpen(false)} 
      />
    </div>
  );
}

export default App;