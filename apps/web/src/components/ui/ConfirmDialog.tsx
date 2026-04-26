'use client';

import { useEffect, useRef } from 'react';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <dialog
      open
      className="fixed inset-0 z-[200] flex items-center justify-center"
      aria-labelledby="confirm-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <div className="modal-content relative w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
        <h2 id="confirm-title" className="mb-2 text-sm font-semibold text-[var(--color-fg)]">
          {title}
        </h2>
        <p className="mb-5 text-sm text-gray-500">{message}</p>
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} size="sm" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={variant === 'danger' ? 'danger' : 'default'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
