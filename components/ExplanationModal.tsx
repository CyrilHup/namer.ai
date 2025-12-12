import React from 'react';
import { X, Globe, Cpu, ShoppingCart } from 'lucide-react';

interface ExplanationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExplanationModal: React.FC<ExplanationModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-md" onClick={onClose} />
      
      <div className="relative surface-strong rounded-3xl shadow-lifted w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[rgb(var(--c-ink)/0.14)]">
        <div className="p-6 flex justify-between items-center brand-hero">
          <div>
            <h3 className="text-lg font-display font-extrabold tracking-tight">How Namer.ai works</h3>
            <p className="text-sm opacity-85 mt-0.5">From idea to available domains—fast.</p>
          </div>
          <button onClick={onClose} className="focus-ring opacity-85 hover:opacity-100 rounded-xl p-2 hover:bg-black/5 transition" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-[rgb(var(--c-surface)/0.70)] text-[rgb(var(--c-accent2))] flex items-center justify-center border border-[rgb(var(--c-ink)/0.12)]">
              <Cpu size={20} />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-1">1) Brainstorm</h4>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                We use Mistral AI models to generate creative, context-aware brand names based on your project description.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-[rgb(var(--c-surface)/0.70)] text-[rgb(var(--c-accent))] flex items-center justify-center border border-[rgb(var(--c-ink)/0.12)]">
              <Globe size={20} />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-1">2) Check availability</h4>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                We check domain availability instantly using Google's DNS-over-HTTPS. We look for 'NXDOMAIN' (Non-Existent Domain) records, which strongly suggests the domain is available.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
             <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-[rgb(var(--c-surface)/0.70)] text-[rgb(var(--c-accent2))] flex items-center justify-center border border-[rgb(var(--c-ink)/0.12)]">
              <ShoppingCart size={20} />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-1">3) Register</h4>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Found a winner? Click "Buy" to go directly to a registrar platform (Namecheap) where you can secure your domain immediately.
              </p>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-[rgb(var(--c-surface)/0.45)] text-center border-t border-[rgb(var(--c-ink)/0.12)]">
           <button 
             onClick={onClose}
             className="focus-ring px-6 py-2.5 btn-primary rounded-2xl text-sm font-bold transition"
           >
             Got it, thanks!
           </button>
        </div>
      </div>
    </div>
  );
};