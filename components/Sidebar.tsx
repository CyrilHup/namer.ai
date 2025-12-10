import React from 'react';
import { AVAILABLE_TLDS } from '../types';
import { Sparkles, Info, X } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTlds: string[];
  onToggleTld: (tld: string) => void;
  onOpenExplanation: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  isOpen, 
  onClose, 
  selectedTlds, 
  onToggleTld,
  onOpenExplanation 
}) => {
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
        fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out
        md:translate-x-0 md:static md:h-screen md:shrink-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          
          {/* Header */}
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-700">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <Sparkles className="text-white" size={20} />
              </div>
              <h1 className="text-xl font-bold tracking-tight">Namer.ai</h1>
            </div>
            <button onClick={onClose} className="md:hidden text-slate-400 hover:text-slate-600">
              <X size={24} />
            </button>
          </div>

          {/* TLD Selection */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="mb-6">
              <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                Configure which extensions to check when brainstorming new names.
              </p>
              
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
                        text-sm font-medium py-2 px-3 rounded-lg transition-all border text-left
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

          {/* Footer / Explanation */}
          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <button 
              onClick={onOpenExplanation}
              className="flex items-center gap-3 text-sm text-slate-600 hover:text-indigo-600 font-medium transition-colors w-full p-3 rounded-xl hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-200"
            >
              <div className="bg-white p-1.5 rounded-md shadow-sm border border-slate-100 text-indigo-500">
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