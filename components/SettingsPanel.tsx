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
    <div className="absolute top-16 right-4 z-50 w-72 bg-white rounded-xl shadow-xl border border-slate-200 animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <Settings2 size={16} />
          <span>Extensions</span>
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X size={18} />
        </button>
      </div>
      
      <div className="p-4">
        <p className="text-xs text-slate-500 mb-3">
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
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' 
                    : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200 hover:text-indigo-600'}
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