import React from 'react';
import { AVAILABLE_TLDS } from '../types';
import { Sparkles, Info, X } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTlds: string[];
  onToggleTld: (tld: string) => void;
  onSetTlds: (tlds: string[]) => void;
  onOpenExplanation: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  isOpen, 
  onClose, 
  selectedTlds, 
  onToggleTld,
  onSetTlds,
  onOpenExplanation 
}) => {
  const presets: Array<{ label: string; tlds: string[] }> = [
    { label: 'Popular', tlds: ['.com', '.io', '.ai', '.co', '.app'] },
    { label: 'Tech', tlds: ['.ai', '.io', '.dev', '.app', '.cloud', '.tech', '.studio'] },
    { label: 'All', tlds: AVAILABLE_TLDS },
  ];

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-80 surface border-r border-[rgb(var(--c-ink)/0.12)] transform transition-all duration-300 ease-in-out
        ${isOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'}
      `}>
        <div className="flex flex-col h-full">
          
          {/* Header */}
          <div className="p-6 border-b border-[rgb(var(--c-ink)/0.12)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="brand-badge p-2 rounded-xl">
                <Sparkles className="text-[rgb(12_16_26)]" size={20} />
              </div>
              <div>
                <h1 className="text-xl font-display font-bold tracking-tight">Namer.ai</h1>
                <p className="text-xs text-[rgb(var(--c-muted))]">Controls</p>
              </div>
            </div>
            <button onClick={onClose} className="md:hidden focus-ring text-[rgb(var(--c-muted))] hover:text-[rgb(var(--c-fg))] rounded-lg">
              <X size={24} />
            </button>
          </div>

          {/* TLD Selection */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="mb-6">
              <p className="text-sm text-[rgb(var(--c-muted))] mb-4 leading-relaxed">
                Choose which extensions are checked during brainstorming.
              </p>

              <div className="flex flex-wrap gap-2 mb-5">
                {presets.map(p => (
                  <button
                    key={p.label}
                    onClick={() => onSetTlds(p.tlds)}
                    className="focus-ring inline-flex items-center rounded-full surface hover:bg-[rgb(var(--c-surface)/0.9)] px-3 py-1.5 text-xs font-bold transition"
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  onClick={() => onSetTlds(['.com', '.io', '.ai'])}
                  className="focus-ring inline-flex items-center rounded-full surface hover:bg-[rgb(var(--c-surface)/0.9)] px-3 py-1.5 text-xs font-bold transition"
                >
                  Reset
                </button>
              </div>
              
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Extensions
              </h2>
              
              <div className="grid grid-cols-2 gap-2">
                {AVAILABLE_TLDS.map(tld => {
                  const isSelected = selectedTlds.includes(tld);
                  return (
                    <button
                      key={tld}
                      onClick={() => onToggleTld(tld)}
                      className={`
                        focus-ring text-sm font-semibold py-2.5 px-3 rounded-xl transition-all border text-left
                        ${isSelected 
                          ? 'bg-[rgb(var(--c-accent2)/0.14)] border-[rgb(var(--c-accent2)/0.32)] text-[rgb(var(--c-fg))] shadow-sm'
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

          {/* Footer / Explanation */}
          <div className="p-4 border-t border-[rgb(var(--c-ink)/0.12)] bg-[rgb(var(--c-surface)/0.35)]">
            <button 
              onClick={onOpenExplanation}
              className="focus-ring flex items-center gap-3 text-sm hover:text-[rgb(var(--c-fg))] font-semibold transition w-full p-3 rounded-2xl hover:bg-[rgb(var(--c-surface)/0.7)] hover:shadow-soft border border-transparent hover:border-[rgb(var(--c-ink)/0.12)]"
            >
              <div className="bg-[rgb(var(--c-surface)/0.75)] p-1.5 rounded-xl shadow-sm border border-[rgb(var(--c-ink)/0.12)] text-[rgb(var(--c-accent2))]">
                <Info size={16} />
              </div>
              <span>How it works</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};