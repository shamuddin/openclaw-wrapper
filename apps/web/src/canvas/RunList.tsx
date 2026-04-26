'use client';

import type { Run } from '@openclaw-wrapper/schemas';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { statusClasses, statusDotClass } from './RunDetails';

type StatusFilter = 'all' | Run['status'];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function RunList({
  runs,
  isLoading,
  selectedRunId,
  onSelect,
}: {
  runs: Run[] | undefined;
  isLoading: boolean;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filtered = runs?.filter((r) => statusFilter === 'all' || r.status === statusFilter) ?? [];

  return (
    <div className="rounded-xl border border-[var(--color-border)]">
      {/* Header + filter */}
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-500">
            Recent runs
            {runs
              ? ` (${filtered.length}${statusFilter !== 'all' ? ` of ${runs.length}` : ''})`
              : ''}
          </p>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {STATUS_OPTIONS.map(({ value, label }) => {
            const count =
              value === 'all' ? runs?.length : runs?.filter((r) => r.status === value).length;
            if (value !== 'all' && !count) return null;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                  statusFilter === value
                    ? value === 'all'
                      ? 'border-[var(--color-accent)] bg-indigo-50 text-[var(--color-accent)]'
                      : statusClasses(value as Run['status'])
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-gray-400 hover:text-gray-600'
                }`}
              >
                {label}
                {count !== undefined && ` (${count})`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-48 divide-y divide-[var(--color-border)] overflow-auto">
        {isLoading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Loading runs…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="px-3 py-3 text-xs text-gray-400">
            {statusFilter === 'all' ? 'No runs yet.' : `No ${statusFilter} runs.`}
          </p>
        )}
        {filtered.map((run) => {
          const isSelected = run.id === selectedRunId;
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelect(run.id)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition ${
                isSelected ? 'bg-indigo-50' : 'hover:bg-[var(--color-surface-2)]'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(run.status)}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-[var(--color-fg)]">
                    {run.trigger.label ?? run.trigger.type}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {new Date(run.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${statusClasses(run.status)}`}
                aria-label={`Status: ${run.status}`}
              >
                {run.status}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
