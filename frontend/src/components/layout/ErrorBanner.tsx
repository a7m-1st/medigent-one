import React from 'react';
import { useChatStore } from '@/stores';
import type { ErrorType } from '@/stores/chatStore';
import { AlertTriangle, XCircle, CreditCard, X, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const ERROR_CONFIG: Record<Exclude<ErrorType, null>, {
  icon: React.ReactNode;
  title: string;
  bgClass: string;
  borderClass: string;
  iconClass: string;
  textClass: string;
}> = {
  warming_up: {
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    title: 'Gemma 4 Warming Up',
    bgClass: 'bg-blue-50 dark:bg-blue-950/30',
    borderClass: 'border-blue-200 dark:border-blue-800/40',
    iconClass: 'text-blue-600 dark:text-blue-400',
    textClass: 'text-blue-700 dark:text-blue-300',
  },
  rate_limit: {
    icon: <AlertTriangle className="w-4 h-4" />,
    title: 'Rate Limit Reached',
    bgClass: 'bg-warning-light',
    borderClass: 'border-warning/30',
    iconClass: 'text-warning',
    textClass: 'text-warning',
  },
  budget: {
    icon: <CreditCard className="w-4 h-4" />,
    title: 'Budget Exhausted',
    bgClass: 'bg-error-light',
    borderClass: 'border-error/30',
    iconClass: 'text-error',
    textClass: 'text-error',
  },
  generic: {
    icon: <XCircle className="w-4 h-4" />,
    title: 'Error',
    bgClass: 'bg-error-light',
    borderClass: 'border-error/30',
    iconClass: 'text-error',
    textClass: 'text-error',
  },
};

export const ErrorBanner: React.FC = () => {
  const error = useChatStore((s) => s.error);
  const errorType = useChatStore((s) => s.errorType);
  const clearError = useChatStore((s) => s.clearError);

  const config = errorType ? ERROR_CONFIG[errorType] : null;

  return (
    <AnimatePresence>
      {error && config && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden shrink-0"
        >
          <div
            className={`flex items-center gap-3 px-4 py-2.5 border-b ${config.bgClass} ${config.borderClass}`}
          >
            <span className={config.iconClass}>{config.icon}</span>
            <span className={`text-xs font-bold uppercase tracking-wider ${config.iconClass}`}>
              {config.title}
            </span>
            <span className={`text-xs ${config.textClass} flex-1 truncate opacity-80`}>
              {error}
            </span>
            <button
              onClick={clearError}
              className="p-1 rounded hover:bg-background-secondary transition-colors text-foreground-muted hover:text-foreground"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};