import React from 'react';
import { Message, Role, DomainCheckResult } from '../types';
import { Bot, User, Cpu, Loader2 } from 'lucide-react';
import { DomainCard } from './DomainCard';
import { MarkdownText } from './MarkdownText';

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === Role.USER;
  const isSystem = message.role === Role.SYSTEM;
  const toolDisplayMode = message.toolDisplayMode ?? 'availableOnly';

  const isPendingAssistant = !isUser && Boolean(message.isPending);

  if (isSystem) return null;

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] md:max-w-[75%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
        
        {/* Avatar */}
        <div className={`
          flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
          ${isUser ? 'btn-primary text-[rgb(12_16_26)] shadow-soft' : 'surface border border-[rgb(var(--c-ink)/0.12)] text-[rgb(var(--c-fg))] shadow-soft'}
        `}>
          {isUser ? <User size={16} /> : <Bot size={16} />}
        </div>

        {/* Bubble */}
        <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
          <div className={`
            px-5 py-3 rounded-2xl text-sm leading-relaxed shadow-soft
            ${isUser 
              ? 'btn-primary text-[rgb(12_16_26)] rounded-tr-none' 
              : 'surface border border-[rgb(var(--c-ink)/0.12)] text-[rgb(var(--c-fg))] rounded-tl-none'}
          `}>
             {isPendingAssistant ? (
               <div className="flex items-center gap-2">
                 <Loader2 size={16} className="animate-spin opacity-70" />
                 <span className="opacity-80">
                   {message.text || 'Working…'}
                 </span>
               </div>
             ) : (
               <MarkdownText text={message.text} className={isUser ? 'text-[rgb(12_16_26)] opacity-90' : 'text-[rgb(var(--c-fg))]'} />
             )}
          </div>

          {/* Tool Results (Domain Cards) */}
          {message.toolResponses && message.toolResponses.length > 0 && (
             <div className="mt-2 w-full">
                 <div className="flex items-center gap-2 mb-2 text-xs font-bold text-[rgb(var(--c-muted))] uppercase tracking-wider">
                  <Cpu size={12} className="opacity-80" />
                  <span>Domain availability</span>
               </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                  {message.toolResponses.map((toolResp, idx) => {
                     // The tool response content is what we returned from our service
                     // It should be an array of DomainCheckResult
                     const results = toolResp.result as DomainCheckResult[];
                     if (!Array.isArray(results)) return null;

                    const displayResults =
                      toolDisplayMode === 'all' ? results : results.filter(r => r?.status === 'available');
                    if (displayResults.length === 0) return null;
                     
                     return (
                        <React.Fragment key={idx}>
                        {displayResults.map((res) => (
                             <DomainCard key={`${res.domain}-${idx}`} result={res} />
                          ))}
                        </React.Fragment>
                     );
                  })}
               </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
};