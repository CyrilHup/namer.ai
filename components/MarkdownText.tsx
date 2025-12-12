import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownTextProps {
  text: string;
  className?: string;
}

export const MarkdownText: React.FC<MarkdownTextProps> = ({ text, className }) => {
  const content = String(text ?? '');

  return (
    <div className={['space-y-2', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Keep it safe: no raw HTML rendering.
        skipHtml
        components={{
          p: ({ children, ...props }) => (
            <p {...props} className="whitespace-pre-wrap leading-relaxed">
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul {...props} className="list-disc pl-5 whitespace-pre-wrap space-y-1">
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol {...props} className="list-decimal pl-5 whitespace-pre-wrap space-y-1">
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li {...props} className="whitespace-pre-wrap">
              {children}
            </li>
          ),
          a: ({ children, ...props }) => (
            <a
              {...props}
              className="font-semibold underline decoration-[color:rgb(var(--c-accent2)/0.75)] underline-offset-2 hover:decoration-[color:rgb(var(--c-accent)/0.85)]"
              target={props.target ?? '_blank'}
              rel={props.rel ?? 'noopener noreferrer'}
            >
              {children}
            </a>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
