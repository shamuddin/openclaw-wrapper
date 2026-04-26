'use client';

import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import type { CronJobRecord } from '@openclaw-wrapper/schemas';
import { AlertTriangle, Play } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

type CronNodeShape = {
  id: string;
  data: Record<string, unknown>;
};

type SelectOption = { label: string; value: string; scope?: string };

const THINKING_OPTIONS: SelectOption[] = [
  { label: 'Agent default', value: '' },
  { label: 'Off', value: 'off' },
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra high', value: 'xhigh' },
];

const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const TOOL_PRESETS: Array<{ label: string; value: string; description: string }> = [
  {
    label: 'Agent default',
    value: '',
    description: 'Use the agent or gateway default tool policy.',
  },
  {
    label: 'Web research',
    value: 'web_search, web_fetch, browser',
    description: 'Search, fetch pages, and use the browser.',
  },
  {
    label: 'YouTube read-only',
    value: 'youtube.readonly, youtube.channel, youtube.videos',
    description: 'Inject configured YouTube channel/video context before the scheduled run.',
  },
  {
    label: 'Messaging',
    value: 'message, sessions_list, sessions_send, session_status',
    description: 'Send messages and inspect/reuse sessions.',
  },
  {
    label: 'Automation ops',
    value: 'cron, session_status, agents_list',
    description: 'Inspect cron jobs and agent/session state.',
  },
  {
    label: 'Coding',
    value: 'read, edit, apply_patch, exec, process, web_search, web_fetch',
    description: 'File, process, and web tools for coding-oriented tasks.',
  },
];

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function readBoolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  return typeof value === 'boolean' ? value : fallback;
}

function uniqueOptions(options: SelectOption[]): SelectOption[] {
  const seen = new Set<string>();
  const output: SelectOption[] = [];
  for (const option of options) {
    const value = option.value.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push({ ...option, value });
  }
  return output;
}

function collectFieldOptions(
  catalog: { nodes?: Array<{ fields?: Array<{ key: string; options?: SelectOption[]; suggestions?: SelectOption[] }> }> } | undefined,
  key: string,
): SelectOption[] {
  return uniqueOptions(
    (catalog?.nodes ?? []).flatMap((node) =>
      (node.fields ?? [])
        .filter((field) => field.key === key)
        .flatMap((field) => [...(field.options ?? []), ...(field.suggestions ?? [])]),
    ),
  );
}

function getTimezoneOptions(currentTimezone: string): SelectOption[] {
  const localTimezone =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const supported =
    typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
      ? (Intl.supportedValuesOf('timeZone') as string[])
      : [];
  const values = [
    'UTC',
    ...(localTimezone ? [localTimezone] : []),
    ...COMMON_TIMEZONES,
    ...supported,
    ...(currentTimezone ? [currentTimezone] : []),
  ];
  return uniqueOptions(
    values.map((value) => ({
      label: value === localTimezone ? `${value} (local)` : value,
      value,
    })),
  );
}

function formatPreviewDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'UTC',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function buildSchedulePreview(data: Record<string, unknown>, scheduleKind: string): string {
  if (scheduleKind === 'every') {
    const amount = readString(data, 'everyAmount').trim() || '30';
    const unit = readString(data, 'everyUnit') || 'minutes';
    return `Runs every ${amount} ${unit}.`;
  }
  if (scheduleKind === 'at') {
    const runAt = readString(data, 'runAt').trim();
    if (!runAt) return 'Choose a run-at timestamp to preview this one-time schedule.';
    const ms = Date.parse(runAt);
    return Number.isFinite(ms)
      ? `Runs once at ${formatPreviewDate(new Date(ms), readString(data, 'timezone') || 'UTC')}.`
      : 'Run-at timestamp is not valid yet.';
  }

  const expression = readString(data, 'schedule').trim() || '0 * * * *';
  const timezone = readString(data, 'timezone') || 'UTC';
  return `Cron ${expression} in ${timezone}. Publish to see exact next wake times.`;
}

function statusTone(status?: string): string {
  switch (status) {
    case 'ok':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'skipped':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-600';
  }
}

function deliveryTone(status?: string): string {
  switch (status) {
    case 'delivered':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'not-delivered':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'not-requested':
      return 'border-slate-200 bg-slate-100 text-slate-600';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-600';
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3">
      <div className="text-[12px] font-semibold text-[var(--color-fg)]">{title}</div>
      {description ? <div className="mt-1 text-[11px] text-gray-500">{description}</div> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  description,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  description?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-gray-600">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
      />
      {description ? <p className="mt-1 text-[11px] text-gray-400">{description}</p> : null}
    </div>
  );
}

function TextAreaField({
  label,
  value,
  placeholder,
  description,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  description?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-gray-600">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-20 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
      />
      {description ? <p className="mt-1 text-[11px] text-gray-400">{description}</p> : null}
    </div>
  );
}

function ComboField({
  label,
  value,
  options,
  placeholder,
  description,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  placeholder?: string;
  description?: string;
  onChange: (value: string) => void;
}) {
  const listId = `cron-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-suggestions`;
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-gray-600">{label}</label>
      <input
        value={value}
        list={options.length > 0 ? listId : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
      />
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </datalist>
      ) : null}
      {description ? <p className="mt-1 text-[11px] text-gray-400">{description}</p> : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  description,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  description?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-gray-600">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {description ? <p className="mt-1 text-[11px] text-gray-400">{description}</p> : null}
    </div>
  );
}

function BooleanField({
  label,
  checked,
  description,
  onChange,
}: {
  label: string;
  checked: boolean;
  description?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-fg)]">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
        />
        <span>{label}</span>
      </label>
      {description ? <p className="mt-1 text-[11px] text-gray-400">{description}</p> : null}
    </div>
  );
}

function ToolPresetButtons({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 block text-[12px] font-medium text-gray-600">Tool presets</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {TOOL_PRESETS.map((preset) => {
          const active = value.trim() === preset.value;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.value)}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                active
                  ? 'border-[var(--color-accent)] bg-blue-50 text-blue-800'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-gray-600 hover:border-gray-300 hover:bg-white'
              }`}
            >
              <div className="font-medium">{preset.label}</div>
              <div className="mt-0.5 text-[11px] leading-4 opacity-75">{preset.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CronNodePanel({
  selectedNode,
  flowId,
  publishedVersion,
  updateNodeData,
}: {
  selectedNode: CronNodeShape;
  flowId: string | null;
  publishedVersion: number | null;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const utils = trpc.useUtils();
  const jobsQuery = trpc.cron.list.useQuery(
    { includeDisabled: true },
    { enabled: !!flowId && !!publishedVersion, refetchInterval: 15_000 },
  );
  const catalogQuery = trpc.nodes.catalog.useQuery(undefined, { staleTime: 60_000 });
  const runMutation = trpc.cron.run.useMutation({
    onSuccess(result) {
      notify({
        tone:
          result.status === 'error' ? 'error' : result.status === 'skipped' ? 'warning' : 'success',
        title: result.triggered ? 'Scheduled run processed' : 'Scheduled run skipped',
        message: result.summary ?? result.error ?? 'Cron trigger processed.',
      });
      void Promise.all([utils.cron.list.invalidate(), utils.cron.history.invalidate()]);
    },
    onError(error) {
      notify({ tone: 'error', title: 'Run failed', message: error.message, durationMs: 6000 });
    },
  });
  const liveUpdateMutation = trpc.cron.update.useMutation({
    onSuccess() {
      void Promise.all([utils.cron.list.invalidate(), utils.cron.status.invalidate()]);
    },
  });

  const currentJob =
    jobsQuery.data?.find(
      (job) =>
        job.source?.kind === 'flowTrigger' &&
        job.source.flowId === flowId &&
        job.source.nodeId === selectedNode.id,
    ) ?? null;

  const scheduleKind = readString(selectedNode.data, 'scheduleKind') || 'cron';
  const deliveryMode = readString(selectedNode.data, 'deliveryMode') || 'none';
  const rawExecutionKind = readString(selectedNode.data, 'executionKind');
  const executionKind =
    rawExecutionKind === 'agentTurn' || rawExecutionKind === 'systemEvent'
      ? rawExecutionKind
      : 'flowTrigger';
  const executionSessionTarget =
    readString(selectedNode.data, 'sessionTarget') ||
    (executionKind === 'agentTurn' ? 'isolated' : 'main');
  const failureAlertEnabled = readBoolean(selectedNode.data, 'failureAlertEnabled', false);
  const enabled = readBoolean(selectedNode.data, 'enabled', true);
  const missingDeliveryTarget =
    deliveryMode !== 'none' && readString(selectedNode.data, 'deliveryTo').trim().length === 0;
  const missingFailureTarget =
    failureAlertEnabled &&
    readString(selectedNode.data, 'failureAlertTo').trim().length === 0 &&
    readString(selectedNode.data, 'failureAlertChannel').trim().length === 0;
  const missingAssistantPrompt =
    executionKind === 'agentTurn' &&
    readString(selectedNode.data, 'assistantPrompt').trim().length === 0;
  const missingCustomSession =
    executionKind === 'agentTurn' &&
    executionSessionTarget === 'session' &&
    readString(selectedNode.data, 'sessionKey').trim().length === 0;
  const missingSystemEventText =
    executionKind === 'systemEvent' &&
    readString(selectedNode.data, 'systemEventText').trim().length === 0;
  const agentOptions = useMemo(
    () => collectFieldOptions(catalogQuery.data, 'agentId'),
    [catalogQuery.data],
  );
  const modelOptions = useMemo(
    () => collectFieldOptions(catalogQuery.data, 'modelOverride'),
    [catalogQuery.data],
  );
  const timezoneOptions = useMemo(
    () => getTimezoneOptions(readString(selectedNode.data, 'timezone')),
    [selectedNode.data],
  );
  const schedulePreview = buildSchedulePreview(selectedNode.data, scheduleKind);

  function patch(p: Record<string, unknown>) {
    updateNodeData(selectedNode.id, p);
  }

  async function patchEnabled(nextEnabled: boolean) {
    patch({ enabled: nextEnabled });
    if (currentJob) {
      await liveUpdateMutation.mutateAsync({
        id: currentJob.id,
        patch: { enabled: nextEnabled },
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs text-sky-800">
        <div className="font-medium">Cron authoring lives in the flow.</div>
        <div className="mt-1">
          This panel is the source of truth for the published scheduler job. Runtime status and run
          history stay visible here and in the scheduler dashboard.
        </div>
        <div className="mt-3">
          <Link
            href="/cron"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-sky-200 bg-white px-3 text-xs font-medium text-sky-900 transition hover:bg-sky-100"
          >
            Open scheduler dashboard
          </Link>
        </div>
      </div>

      <Section
        title="Runtime"
        description="Live scheduler status for this cron trigger after the flow is published."
      >
        {!flowId || !publishedVersion ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-3 text-[12px] text-gray-500">
            Publish the flow to create the scheduler job and see next wake, run controls, and run
            history.
          </div>
        ) : !currentJob ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-3 text-[12px] text-gray-500">
            This published cron trigger has not been reconciled into the scheduler yet. Re-publish
            or refresh the adapter if it does not appear after a moment.
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Last run</div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusTone(
                      currentJob.state.lastRunStatus,
                    )}`}
                  >
                    {currentJob.state.lastRunStatus ?? 'unknown'}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Delivery</div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${deliveryTone(
                      currentJob.state.lastDeliveryStatus,
                    )}`}
                  >
                    {currentJob.state.lastDeliveryStatus ?? 'unknown'}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Next wake</div>
                <div className="mt-1 text-[12px] text-[var(--color-fg)]">
                  {typeof currentJob.state.nextRunAtMs === 'number'
                    ? new Date(currentJob.state.nextRunAtMs).toLocaleString()
                    : 'not scheduled'}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Live job</div>
                <div className="mt-1 text-[12px] text-[var(--color-fg)]">
                  {currentJob.enabled ? 'enabled' : 'paused'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => runMutation.mutate({ id: currentJob.id, mode: 'due' })}
                disabled={runMutation.isPending}
              >
                <Play className="h-3.5 w-3.5" strokeWidth={2} />
                Run if due
              </Button>
              <Button
                size="sm"
                onClick={() => runMutation.mutate({ id: currentJob.id, mode: 'force' })}
                disabled={runMutation.isPending}
              >
                <Play className="h-3.5 w-3.5" strokeWidth={2} />
                Run now
              </Button>
              <Link
                href="/cron"
                className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]"
              >
                Scheduler dashboard
              </Link>
            </div>

            {currentJob.state.lastError || currentJob.state.lastDeliveryError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  <div>{currentJob.state.lastError ?? currentJob.state.lastDeliveryError}</div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Section>

      <Section
        title="Basics"
        description="Core trigger settings stored on the flow and synced on publish."
      >
        <TextField
          label="Label"
          value={readString(selectedNode.data, 'label')}
          placeholder="Cron Schedule"
          onChange={(value) => patch({ label: value })}
        />
        <TextAreaField
          label="Description"
          value={readString(selectedNode.data, 'description')}
          placeholder="Optional context for what this schedule handles."
          onChange={(value) => patch({ description: value })}
        />
        <BooleanField
          label="Enabled"
          checked={enabled}
          description="When published, this controls whether the synced scheduler job is active."
          onChange={(value) => void patchEnabled(value)}
        />
      </Section>

      <Section
        title="Schedule"
        description="Choose how the published scheduler should decide when to trigger this flow."
      >
        <SelectField
          label="Schedule type"
          value={scheduleKind}
          onChange={(value) => patch({ scheduleKind: value })}
          options={[
            { label: 'Cron expression', value: 'cron' },
            { label: 'Every interval', value: 'every' },
            { label: 'Run once at', value: 'at' },
          ]}
        />

        {scheduleKind === 'cron' ? (
          <>
            <TextField
              label="Cron expression"
              value={readString(selectedNode.data, 'schedule')}
              placeholder="*/15 * * * *"
              description="Five fields: minute hour day month weekday."
              onChange={(value) => patch({ schedule: value })}
            />
            <SelectField
              label="Timezone"
              value={readString(selectedNode.data, 'timezone') || 'UTC'}
              options={timezoneOptions}
              description="Includes UTC, your browser timezone, common zones, and supported IANA timezones."
              onChange={(value) => patch({ timezone: value })}
            />
          </>
        ) : null}

        {scheduleKind === 'every' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Every"
              value={readString(selectedNode.data, 'everyAmount')}
              placeholder="30"
              description="Whole-number interval greater than 0."
              onChange={(value) => patch({ everyAmount: value })}
            />
            <SelectField
              label="Unit"
              value={readString(selectedNode.data, 'everyUnit') || 'minutes'}
              onChange={(value) => patch({ everyUnit: value })}
              options={[
                { label: 'Minutes', value: 'minutes' },
                { label: 'Hours', value: 'hours' },
                { label: 'Days', value: 'days' },
              ]}
            />
          </div>
        ) : null}

        {scheduleKind === 'at' ? (
          <TextField
            label="Run at"
            value={readString(selectedNode.data, 'runAt')}
            placeholder="2026-04-27T09:00:00+05:30"
            description="Use an ISO date-time with timezone offset."
            onChange={(value) => patch({ runAt: value })}
          />
        ) : null}

        <BooleanField
          label="Delete after run"
          checked={readBoolean(selectedNode.data, 'deleteAfterRun', false)}
          description="Pause the synced scheduler job after a successful run. One-time schedules already stop after they fire."
          onChange={(value) => patch({ deleteAfterRun: value })}
        />

        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] text-blue-800">
          <div className="font-medium">Schedule preview</div>
          <div className="mt-1">{schedulePreview}</div>
        </div>
      </Section>

      <Section
        title="Delivery"
        description="Optional scheduler-side summary delivery for successful runs of this published flow."
      >
        <SelectField
          label="Result delivery"
          value={deliveryMode}
          onChange={(value) => patch({ deliveryMode: value })}
          options={[
            { label: 'None', value: 'none' },
            { label: 'Announce summary', value: 'announce' },
            { label: 'Webhook', value: 'webhook' },
          ]}
        />
        {deliveryMode !== 'none' ? (
          <>
            <TextField
              label={deliveryMode === 'webhook' ? 'Webhook URL' : 'To'}
              value={readString(selectedNode.data, 'deliveryTo')}
              placeholder={
                deliveryMode === 'webhook'
                  ? 'https://example.com/hooks/cron'
                  : '+1555... or chat id'
              }
              description="Required for announce and webhook delivery."
              onChange={(value) => patch({ deliveryTo: value })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Channel"
                value={readString(selectedNode.data, 'deliveryChannel')}
                placeholder="last"
                description="Optional connected channel for summary delivery."
                onChange={(value) => patch({ deliveryChannel: value })}
              />
              <TextField
                label="Account ID"
                value={readString(selectedNode.data, 'deliveryAccountId')}
                placeholder="default"
                description="Optional channel account or delivery account."
                onChange={(value) => patch({ deliveryAccountId: value })}
              />
            </div>
            <BooleanField
              label="Best effort delivery"
              checked={readBoolean(selectedNode.data, 'deliveryBestEffort', false)}
              description="Do not mark the scheduled run itself as failed when summary delivery fails."
              onChange={(value) => patch({ deliveryBestEffort: value })}
            />
          </>
        ) : null}
        {missingDeliveryTarget ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            Delivery is enabled, but a destination is still required.
          </div>
        ) : null}
      </Section>

      <Section
        title="Failure Alerts"
        description="Send repeated-failure notifications when this published schedule keeps failing."
      >
        <BooleanField
          label="Enable failure alerts"
          checked={failureAlertEnabled}
          description="When off, this flow-backed cron trigger will not send failure alerts."
          onChange={(value) => patch({ failureAlertEnabled: value })}
        />
        {failureAlertEnabled ? (
          <>
            <SelectField
              label="Alert mode"
              value={readString(selectedNode.data, 'failureAlertMode') || 'announce'}
              onChange={(value) => patch({ failureAlertMode: value })}
              options={[
                { label: 'Announce', value: 'announce' },
                { label: 'Webhook', value: 'webhook' },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Alert after"
                value={readString(selectedNode.data, 'failureAlertAfter') || '3'}
                placeholder="3"
                description="Send an alert after this many consecutive failures."
                onChange={(value) => patch({ failureAlertAfter: value })}
              />
              <TextField
                label="Cooldown (seconds)"
                value={readString(selectedNode.data, 'failureAlertCooldownSeconds') || '3600'}
                placeholder="3600"
                description="Minimum delay between repeated failure alerts."
                onChange={(value) => patch({ failureAlertCooldownSeconds: value })}
              />
            </div>
            <TextField
              label={readString(selectedNode.data, 'failureAlertMode') === 'webhook' ? 'Webhook URL' : 'To'}
              value={readString(selectedNode.data, 'failureAlertTo')}
              placeholder={
                readString(selectedNode.data, 'failureAlertMode') === 'webhook'
                  ? 'https://example.com/hooks/failure'
                  : '+1555... or chat id'
              }
              onChange={(value) => patch({ failureAlertTo: value })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Channel"
                value={readString(selectedNode.data, 'failureAlertChannel')}
                placeholder="last"
                onChange={(value) => patch({ failureAlertChannel: value })}
              />
              <TextField
                label="Account ID"
                value={readString(selectedNode.data, 'failureAlertAccountId')}
                placeholder="default"
                onChange={(value) => patch({ failureAlertAccountId: value })}
              />
            </div>
          </>
        ) : null}
        {failureAlertEnabled && missingFailureTarget ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            Failure alerts are enabled, but you still need a destination channel or recipient.
          </div>
        ) : null}
      </Section>

      <Section
        title="Execution"
        description="Choose what the scheduler does when this cron node wakes."
      >
        <SelectField
          label="What should run?"
          value={executionKind}
          onChange={(value) => patch({ executionKind: value })}
          options={[
            { label: 'Published flow run', value: 'flowTrigger' },
            { label: 'Run assistant task', value: 'agentTurn' },
            { label: 'Post system event', value: 'systemEvent' },
          ]}
          description="Published flow is the normal builder-owned behavior. Assistant and system-event modes use the scheduler runtime directly."
        />

        {executionKind === 'flowTrigger' ? (
          <>
            <SelectField
              label="Wake mode"
              value={readString(selectedNode.data, 'wakeMode') || 'now'}
              onChange={(value) => patch({ wakeMode: value })}
              options={[
                { label: 'Now', value: 'now' },
                { label: 'Next heartbeat', value: 'next-heartbeat' },
              ]}
              description="The scheduler queues the published flow when the schedule fires."
            />
            <TextField
              label="Timeout (seconds)"
              value={readString(selectedNode.data, 'timeoutSeconds')}
              placeholder="Optional, e.g. 300"
              description="Stored with the scheduler job for runtime visibility and future flow timeout controls."
              onChange={(value) => patch({ timeoutSeconds: value })}
            />
          </>
        ) : null}

        {executionKind === 'agentTurn' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ComboField
                label="Agent ID"
                value={readString(selectedNode.data, 'agentId') || 'main'}
                options={agentOptions}
                placeholder="main"
                description={
                  agentOptions.length > 0
                    ? 'Loaded from OpenClaw agents.list. You can still type a custom agent.'
                    : 'Gateway agent list is unavailable; type a custom agent ID.'
                }
                onChange={(value) => patch({ agentId: value })}
              />
              <SelectField
                label="Session"
                value={executionSessionTarget}
                onChange={(value) => patch({ sessionTarget: value })}
                options={[
                  { label: 'Isolated', value: 'isolated' },
                  { label: 'Custom session', value: 'session' },
                ]}
                description="Isolated creates a dedicated scheduler session; custom reuses the session key below."
              />
            </div>
            {executionSessionTarget === 'session' ? (
              <TextField
                label="Session key"
                value={readString(selectedNode.data, 'sessionKey')}
                placeholder="agent:main:daily-monitor"
                description="Required when using a custom scheduler session."
                onChange={(value) => patch({ sessionKey: value })}
              />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Wake mode"
                value={readString(selectedNode.data, 'wakeMode') || 'now'}
                onChange={(value) => patch({ wakeMode: value })}
                options={[
                  { label: 'Now', value: 'now' },
                  { label: 'Next heartbeat', value: 'next-heartbeat' },
                ]}
              />
              <TextField
                label="Timeout (seconds)"
                value={readString(selectedNode.data, 'timeoutSeconds')}
                placeholder="90"
                onChange={(value) => patch({ timeoutSeconds: value })}
              />
            </div>
            <BooleanField
              label="Clear agent override"
              checked={readBoolean(selectedNode.data, 'clearAgent', false)}
              description="Reset the scheduler session before sending this assistant task."
              onChange={(value) => patch({ clearAgent: value })}
            />
            <TextAreaField
              label="Assistant task prompt"
              value={readString(selectedNode.data, 'assistantPrompt')}
              placeholder="Run the monitoring sweep and summarize what changed."
              onChange={(value) => patch({ assistantPrompt: value })}
            />
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
              <div className="mb-3 text-[12px] font-semibold text-[var(--color-fg)]">
                Agent controls
              </div>
              <div className="space-y-3">
                <BooleanField
                  label="Light context"
                  checked={readBoolean(selectedNode.data, 'lightContext', false)}
                  description="Use lightweight bootstrap context for this scheduled task."
                  onChange={(value) => patch({ lightContext: value })}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <ComboField
                    label="Model"
                    value={readString(selectedNode.data, 'model')}
                    options={modelOptions}
                    placeholder="openai/gpt-5.2"
                    description={
                      modelOptions.length > 0
                        ? 'Loaded from OpenClaw models.list. Leave blank to use the agent default.'
                        : 'Leave blank to use the agent default, or type a provider/model value.'
                    }
                    onChange={(value) => patch({ model: value })}
                  />
                  <SelectField
                    label="Thinking"
                    value={readString(selectedNode.data, 'thinking')}
                    options={THINKING_OPTIONS}
                    description="Use a known thinking level instead of guessing provider-specific values."
                    onChange={(value) => patch({ thinking: value })}
                  />
                </div>
                <ComboField
                  label="Fallback models"
                  value={readString(selectedNode.data, 'fallbacks')}
                  options={modelOptions}
                  placeholder="openai/gpt-5.1, anthropic/claude..."
                  description="Optional comma-separated fallback model list."
                  onChange={(value) => patch({ fallbacks: value })}
                />
                <ToolPresetButtons
                  value={readString(selectedNode.data, 'toolsAllow')}
                  onChange={(value) => patch({ toolsAllow: value })}
                />
                <TextField
                  label="Allowed tools"
                  value={readString(selectedNode.data, 'toolsAllow')}
                  placeholder="web_search, web_fetch, browser"
                  description="Optional comma-separated OpenClaw tool allow-list for this scheduled task."
                  onChange={(value) => patch({ toolsAllow: value })}
                />
                <BooleanField
                  label="Allow unsafe external content"
                  checked={readBoolean(selectedNode.data, 'allowUnsafeExternalContent', false)}
                  onChange={(value) => patch({ allowUnsafeExternalContent: value })}
                />
              </div>
            </div>
          </>
        ) : null}

        {executionKind === 'systemEvent' ? (
          <>
            <SelectField
              label="Wake mode"
              value={readString(selectedNode.data, 'wakeMode') || 'next-heartbeat'}
              onChange={(value) => patch({ wakeMode: value })}
              options={[
                { label: 'Next heartbeat', value: 'next-heartbeat' },
                { label: 'Now', value: 'now' },
              ]}
            />
            <TextAreaField
              label="System event text"
              value={readString(selectedNode.data, 'systemEventText')}
              placeholder="Scheduled wakeup from this cron trigger."
              onChange={(value) => patch({ systemEventText: value })}
            />
          </>
        ) : null}

        {missingAssistantPrompt || missingCustomSession || missingSystemEventText ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            {missingAssistantPrompt
              ? 'Assistant task mode needs a prompt before this schedule can do useful work.'
              : null}
            {missingCustomSession ? ' Custom session mode needs a session key.' : null}
            {missingSystemEventText ? ' System-event mode needs event text.' : null}
          </div>
        ) : null}
      </Section>
    </div>
  );
}
