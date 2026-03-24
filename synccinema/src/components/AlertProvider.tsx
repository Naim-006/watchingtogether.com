import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';

type AlertType = 'info' | 'success' | 'warning' | 'error';

interface AlertOptions {
  title?: string;
  message: string;
  type?: AlertType;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  showCancel?: boolean;
}

interface AlertContextType {
  showAlert: (options: AlertOptions) => void;
  showConfirm: (message: string, onConfirm: () => void, title?: string) => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const useAlert = () => {
  const context = useContext(AlertContext);
  if (!context) throw new Error('useAlert must be used within an AlertProvider');
  return context;
};

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeAlert, setActiveAlert] = useState<AlertOptions | null>(null);

  const showAlert = useCallback((options: AlertOptions) => {
    setActiveAlert({
      type: 'info',
      confirmText: 'OK',
      ...options
    });
  }, []);

  const showConfirm = useCallback((message: string, onConfirm: () => void, title?: string) => {
    setActiveAlert({
      title: title || 'Confirmation',
      message,
      type: 'warning',
      confirmText: 'Yes',
      cancelText: 'Cancel',
      showCancel: true,
      onConfirm,
    });
  }, []);

  const handleClose = useCallback(() => {
    if (activeAlert?.onCancel) activeAlert.onCancel();
    setActiveAlert(null);
  }, [activeAlert]);

  const handleConfirm = useCallback(() => {
    if (activeAlert?.onConfirm) activeAlert.onConfirm();
    setActiveAlert(null);
  }, [activeAlert]);

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      <AnimatePresence>
        {activeAlert && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className={cn(
                    "p-2 rounded-xl shrink-0",
                    activeAlert.type === 'error' ? "bg-red-500/10 text-red-500" :
                    activeAlert.type === 'warning' ? "bg-amber-500/10 text-amber-500" :
                    activeAlert.type === 'success' ? "bg-emerald-500/10 text-emerald-500" :
                    "bg-blue-500/10 text-blue-500"
                  )}>
                    {activeAlert.type === 'error' ? <XCircle size={24} /> :
                     activeAlert.type === 'warning' ? <AlertCircle size={24} /> :
                     activeAlert.type === 'success' ? <CheckCircle2 size={24} /> :
                     <Info size={24} />}
                  </div>
                  <div className="flex-1">
                    {activeAlert.title && (
                      <h3 className="text-lg font-bold text-white mb-1">{activeAlert.title}</h3>
                    )}
                    <p className="text-zinc-400 text-sm leading-relaxed">{activeAlert.message}</p>
                  </div>
                  <button onClick={handleClose} className="text-zinc-500 hover:text-white transition-colors">
                    <X size={20} />
                  </button>
                </div>
              </div>
              <div className="flex bg-white/5 p-4 gap-3">
                {activeAlert.showCancel && (
                  <button
                    onClick={handleClose}
                    className="flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
                  >
                    {activeAlert.cancelText || 'Cancel'}
                  </button>
                )}
                <button
                  onClick={handleConfirm}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg",
                    activeAlert.type === 'error' ? "bg-red-600 hover:bg-red-500 text-white" :
                    activeAlert.type === 'warning' ? "bg-amber-600 hover:bg-amber-500 text-white" :
                    "bg-emerald-600 hover:bg-emerald-500 text-white"
                  )}
                >
                  {activeAlert.confirmText || 'OK'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AlertContext.Provider>
  );
};
