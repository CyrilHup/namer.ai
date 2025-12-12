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
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800">How Namer.ai Works</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <Cpu size={20} />
            </div>
            <div>
              <h4 className="font-semibold text-slate-800 mb-1">AI Brainstorming</h4>
              <p className="text-sm text-slate-600 leading-relaxed">
                We use Mistral AI models to generate creative, context-aware brand names based on your project description.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <Globe size={20} />
            </div>
            <div>
              <h4 className="font-semibold text-slate-800 mb-1">Real-time Availability</h4>
              <p className="text-sm text-slate-600 leading-relaxed">
                We check domain availability instantly using Google's DNS-over-HTTPS. We look for 'NXDOMAIN' (Non-Existent Domain) records, which strongly suggests the domain is available.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
             <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <ShoppingCart size={20} />
            </div>
            <div>
              <h4 className="font-semibold text-slate-800 mb-1">Direct Registration</h4>
              <p className="text-sm text-slate-600 leading-relaxed">
                Found a winner? Click "Buy" to go directly to a registrar platform (Namecheap) where you can secure your domain immediately.
              </p>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-slate-50 text-center border-t border-slate-100">
           <button 
             onClick={onClose}
             className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
           >
             Got it, thanks!
           </button>
        </div>
      </div>
    </div>
  );
};