import React, { useMemo, useState } from 'react';
import { Check, X, Loader2, ExternalLink, Copy, CheckCheck } from 'lucide-react';
import { DomainCheckResult } from '../types';

interface DomainCardProps {
  result: DomainCheckResult;
}

export const DomainCard: React.FC<DomainCardProps> = ({ result }) => {
  const isAvailable = result.status === 'available';
  const isTaken = result.status === 'taken';
  const [copied, setCopied] = useState(false);
  const verifyUrl = useMemo(
    () => `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(result.domain)}`,
    [result.domain]
  );

  const fullDomain = `${result.baseName}${result.tld}`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullDomain);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard may fail in some contexts; ignore
    }
  };

  return (
    <div className={`
      group relative overflow-hidden rounded-2xl border p-3.5
      grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3
      transition-all duration-200 hover:shadow-soft
      ${isAvailable ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-800/40' : ''}
      ${isTaken ? 'bg-slate-50/70 dark:bg-slate-900/30 border-slate-200/70 dark:border-slate-800/70 opacity-80' : ''}
      ${result.status === 'unknown' ? 'bg-amber-50/80 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-800/40' : ''}
    `}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`
          p-2.5 rounded-2xl shadow-sm border
          ${isAvailable ? 'bg-emerald-100/80 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-200 border-emerald-200/60 dark:border-emerald-800/40' : ''}
          ${isTaken ? 'bg-slate-200/70 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/40' : ''}
          ${result.status === 'unknown' ? 'bg-amber-100/80 dark:bg-amber-900/25 text-amber-700 dark:text-amber-200 border-amber-200/60 dark:border-amber-800/40' : ''}
        `}>
          {isAvailable && <Check size={16} strokeWidth={3} />}
          {isTaken && <X size={16} strokeWidth={3} />}
          {result.status === 'unknown' && <Loader2 size={16} className="animate-spin" />}
        </div>
        <div className="flex flex-col min-w-0">
           <span className={`font-semibold text-sm ${isTaken ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>
             <span className="block truncate font-mono tracking-tight">{result.baseName}<span className="text-slate-500 dark:text-slate-400 font-mono">{result.tld}</span></span>
           </span>
           <span className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wide">
             {isAvailable ? 'Available' : isTaken ? 'Taken' : 'Checking…'}
           </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <button
          onClick={onCopy}
          className="focus-ring inline-flex items-center justify-center w-10 h-10 rounded-2xl transition surface"
          title={copied ? 'Copied!' : 'Copy domain'}
          aria-label="Copy domain"
        >
          {copied ? <CheckCheck size={16} className="text-emerald-600 dark:text-emerald-300" /> : <Copy size={16} className="text-slate-700 dark:text-slate-200" />}
        </button>

        <a
          href={verifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`focus-ring inline-flex items-center justify-center w-10 h-10 rounded-2xl transition border shadow-sm
            ${isAvailable
              ? 'border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-100/80 dark:bg-emerald-900/25 hover:bg-emerald-200/80 dark:hover:bg-emerald-900/35'
              : 'surface'
            }`}
          title={isAvailable ? 'Buy this domain' : 'Verify on registrar'}
          aria-label={isAvailable ? 'Buy domain' : 'Verify domain'}
        >
          <ExternalLink size={16} className={isAvailable ? 'text-emerald-800 dark:text-emerald-200' : 'text-slate-700 dark:text-slate-200'} />
        </a>
      </div>
    </div>
  );
};