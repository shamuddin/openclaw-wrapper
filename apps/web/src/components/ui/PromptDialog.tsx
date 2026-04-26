'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './button';

interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
}

interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  fields: PromptField[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (values: Record<string, string>) => void | Promise<void>;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  description,
  fields,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const defaults: Record<string, string> = {};
      for (const f of fields) defaults[f.key] = f.defaultValue ?? '';
      setValues(defaults);
      setTimeout(() => firstRef.current?.focus(), 0);
    }
  }, [open, fields]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void Promise.resolve(onConfirm(values)).catch(() => undefined);
  }

  return (
    <dialog
      open
      className="fixed inset-0 z-[200] flex items-center justify-center"
      aria-labelledby="prompt-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <form
        onSubmit={handleSubmit}
        className="modal-content relative w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
      >
        <h2 id="prompt-title" className="mb-1 text-sm font-semibold text-[var(--color-fg)]">
          {title}
        </h2>
        {description && <p className="mb-4 text-xs text-gray-400">{description}</p>}
        <div className="mb-5 flex flex-col gap-3">
          {fields.map((field, i) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label htmlFor={`prompt-${field.key}`} className="text-xs font-medium text-gray-500">
                {field.label}
              </label>
              <input
                id={`prompt-${field.key}`}
                ref={i === 0 ? firstRef : undefined}
                type="text"
                placeholder={field.placeholder}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="submit" size="sm">
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
