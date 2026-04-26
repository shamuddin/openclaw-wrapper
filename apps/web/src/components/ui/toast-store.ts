'use client';

import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export interface ToastRecord {
  id: string;
  title?: string;
  message: string;
  tone: ToastTone;
  exiting?: boolean;
}

interface PushToastInput {
  title?: string;
  message: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastState {
  toasts: ToastRecord[];
  pushToast: (toast: PushToastInput) => string;
  dismissToast: (id: string) => void;
}

const DEFAULT_DURATION: Record<ToastTone, number> = {
  info: 5000,
  success: 4000,
  warning: 6000,
  error: 8000,
};

const MAX_TOASTS = 5;
let toastCounter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  pushToast: ({ tone = 'info', ...toast }) => {
    const durationMs = toast.durationMs ?? DEFAULT_DURATION[tone];
    const id = `toast_${Date.now().toString(36)}_${(toastCounter++).toString(36)}`;

    set((state) => {
      // Deduplicate: if an identical title+message+tone already exists, skip
      const isDupe = state.toasts.some(
        (t) =>
          !t.exiting && t.tone === tone && t.title === toast.title && t.message === toast.message,
      );
      if (isDupe) return state;

      const next = [...state.toasts, { id, tone, ...toast }];
      // Cap to MAX_TOASTS by removing oldest
      return { toasts: next.slice(-MAX_TOASTS) };
    });

    if (durationMs > 0) {
      setTimeout(() => get().dismissToast(id), durationMs);
    }

    return id;
  },

  dismissToast: (id) => {
    // Mark as exiting first, then remove after animation
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 220);
  },
}));

export function notify(toast: PushToastInput) {
  return useToastStore.getState().pushToast(toast);
}
