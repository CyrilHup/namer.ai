import React from 'react';
import { AVAILABLE_TLDS } from '../types';
import { Settings2, X } from 'lucide-react';

interface SettingsPanelProps {
  selectedTlds: string[];
  onToggleTld: (tld: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ selectedTlds, onToggleTld, isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="absolute top-16 right-4 z-50 w-72 surface rounded-xl shadow-xl border border-[rgb(var(--c-ink)/0.12)] animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="p-4 border-b border-[rgb(var(--c-ink)/0.10)] flex justify-between items-center">
        <h3 className="font-semibold text-[rgb(var(--c-fg))] flex items-center gap-2">
          <Settings2 size={16} />
          <span>Extensions</span>
        </h3>
        <button onClick={onClose} className="text-[rgb(var(--c-muted))] hover:text-[rgb(var(--c-fg))]">
          <X size={18} />
        </button>
      </div>
      
      <div className="p-4">
        <p className="text-xs text-[rgb(var(--c-muted))] mb-3">
          Select the domain extensions you want the bot to check automatically.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {AVAILABLE_TLDS.map(tld => {
            const isSelected = selectedTlds.includes(tld);
            return (
              <button
                key={tld}
                onClick={() => onToggleTld(tld)}
                className={`
                  text-xs font-medium py-1.5 px-2 rounded-md transition-all border
                  ${isSelected 
                    ? 'bg-[rgb(var(--c-accent2)/0.14)] border-[rgb(var(--c-accent2)/0.35)] text-[rgb(var(--c-fg))] shadow-sm' 
                    : 'bg-[rgb(var(--c-surface)/0.55)] border-[rgb(var(--c-ink)/0.12)] text-[rgb(var(--c-fg))] hover:border-[rgb(var(--c-accent)/0.35)]'}
                `}
              >
                {tld}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};