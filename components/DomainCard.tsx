import React from 'react';
import { Check, X, Loader2, ExternalLink } from 'lucide-react';
import { DomainCheckResult } from '../types';

interface DomainCardProps {
  result: DomainCheckResult;
}

export const DomainCard: React.FC<DomainCardProps> = ({ result }) => {
  const isAvailable = result.status === 'available';
  const isTaken = result.status === 'taken';

  return (
    <div className={`
      relative overflow-hidden rounded-lg border p-3 flex items-center justify-between
      transition-all duration-200 hover:shadow-md
      ${isAvailable ? 'bg-emerald-50 border-emerald-200' : ''}
      ${isTaken ? 'bg-slate-50 border-slate-200 opacity-75' : ''}
      ${result.status === 'unknown' ? 'bg-amber-50 border-amber-200' : ''}
    `}>
      <div className="flex items-center space-x-3 z-10">
        <div className={`
          p-2 rounded-full 
          ${isAvailable ? 'bg-emerald-100 text-emerald-600' : ''}
          ${isTaken ? 'bg-slate-200 text-slate-500' : ''}
          ${result.status === 'unknown' ? 'bg-amber-100 text-amber-600' : ''}
        `}>
          {isAvailable && <Check size={16} strokeWidth={3} />}
          {isTaken && <X size={16} strokeWidth={3} />}
          {result.status === 'unknown' && <Loader2 size={16} className="animate-spin" />}
        </div>
        <div className="flex flex-col">
           <span className={`font-semibold text-sm ${isTaken ? 'line-through text-slate-400' : 'text-slate-800'}`}>
             {result.baseName}
             <span className="text-slate-500">{result.tld}</span>
           </span>
           <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">
             {isAvailable ? 'Available' : isTaken ? 'Taken' : 'Checking...'}
           </span>
        </div>
      </div>

      {isAvailable && (
        <a 
          href={`https://www.namecheap.com/domains/registration/results/?domain=${result.domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-md transition-all"
        >
          Buy
          <ExternalLink size={12} className="opacity-50 group-hover:opacity-100" />
        </a>
      )}
    </div>
  );
};