'use client';

import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { type ToastRecord, useToastStore } from './toast-store';

function toneStyles(tone: ToastRecord['tone']) {
  switch (tone) {
    case 'success':
      return {
        icon: CheckCircle2,
        className: 'border-emerald-200 bg-emerald-50 text-emerald-900 shadow-emerald-900/10',
        iconWrapClassName: 'bg-emerald-100 text-emerald-700',
        dismissClassName: 'text-emerald-700/70 hover:bg-emerald-100 hover:text-emerald-900',
      };
    case 'error':
      return {
        icon: AlertCircle,
        className: 'border-red-200 bg-red-50 text-red-900 shadow-red-900/10',
        iconWrapClassName: 'bg-red-100 text-red-700',
        dismissClassName: 'text-red-700/70 hover:bg-red-100 hover:text-red-900',
      };
    case 'warning':
      return {
        icon: TriangleAlert,
        className: 'border-amber-200 bg-amber-50 text-amber-900 shadow-amber-900/10',
        iconWrapClassName: 'bg-amber-100 text-amber-700',
        dismissClassName: 'text-amber-700/70 hover:bg-amber-100 hover:text-amber-900',
      };
    default:
      return {
        icon: Info,
        className: 'border-sky-200 bg-sky-50 text-sky-900 shadow-sky-900/10',
        iconWrapClassName: 'bg-sky-100 text-sky-700',
        dismissClassName: 'text-sky-700/70 hover:bg-sky-100 hover:text-sky-900',
      };
  }
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 top-4 z-[var(--z-toast,200)] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const {
          icon: Icon,
          className,
          dismissClassName,
          iconWrapClassName,
        } = toneStyles(toast.tone);

        return (
          <div
            key={toast.id}
            role="alert"
            className={cn(
              'pointer-events-auto rounded-2xl border px-3 py-3 shadow-xl backdrop-blur',
              toast.exiting ? 'toast-exit' : 'toast-enter',
              className,
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                  iconWrapClassName,
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                {toast.title && <div className="text-sm font-semibold">{toast.title}</div>}
                <div className="mt-0.5 text-sm leading-5 opacity-90">{toast.message}</div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className={cn('rounded-full p-1 transition', dismissClassName)}
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
