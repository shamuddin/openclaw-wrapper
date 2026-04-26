import type { CronSchedule } from './cron.js';

export type CronTriggerScheduleKind = 'cron' | 'every' | 'at';
export type CronTriggerEveryUnit = 'minutes' | 'hours' | 'days';

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  return typeof value === 'boolean' ? value : fallback;
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function getCronTriggerScheduleKind(
  data: Record<string, unknown>,
): CronTriggerScheduleKind {
  const value = readString(data, 'scheduleKind');
  if (value === 'every' || value === 'at') {
    return value;
  }
  return 'cron';
}

export function getCronTriggerTimezone(data: Record<string, unknown>): string | undefined {
  const timezone = readString(data, 'timezone');
  return timezone || undefined;
}

export function getCronTriggerCronExpression(data: Record<string, unknown>): string | undefined {
  const schedule = readString(data, 'schedule');
  return schedule || undefined;
}

export function getCronTriggerEveryAmount(data: Record<string, unknown>): number | undefined {
  return parsePositiveInteger(readString(data, 'everyAmount'));
}

export function getCronTriggerEveryUnit(
  data: Record<string, unknown>,
): CronTriggerEveryUnit {
  const unit = readString(data, 'everyUnit');
  if (unit === 'hours' || unit === 'days') {
    return unit;
  }
  return 'minutes';
}

export function getCronTriggerRunAt(data: Record<string, unknown>): string | undefined {
  const runAt = readString(data, 'runAt');
  return runAt || undefined;
}

export function getCronTriggerEnabled(data: Record<string, unknown>): boolean {
  return readBoolean(data, 'enabled', true);
}

export function getCronTriggerDeleteAfterRun(data: Record<string, unknown>): boolean {
  return readBoolean(data, 'deleteAfterRun', false);
}

export function getCronTriggerDescription(data: Record<string, unknown>): string | undefined {
  const description = readString(data, 'description');
  return description || undefined;
}

export function getCronTriggerDisplaySchedule(data: Record<string, unknown>): string | undefined {
  const scheduleKind = getCronTriggerScheduleKind(data);
  if (scheduleKind === 'cron') {
    return getCronTriggerCronExpression(data);
  }
  if (scheduleKind === 'every') {
    const amount = getCronTriggerEveryAmount(data);
    const unit = getCronTriggerEveryUnit(data);
    if (!amount) return undefined;
    const singularUnit = unit.endsWith('s') ? unit.slice(0, -1) : unit;
    return `Every ${amount} ${amount === 1 ? singularUnit : unit}`;
  }
  return getCronTriggerRunAt(data);
}

export function buildCronScheduleFromTriggerData(
  data: Record<string, unknown>,
  options?: { createdAtMs?: number },
): CronSchedule | undefined {
  const scheduleKind = getCronTriggerScheduleKind(data);

  if (scheduleKind === 'cron') {
    const expr = getCronTriggerCronExpression(data);
    if (!expr) return undefined;
    const tz = getCronTriggerTimezone(data) ?? 'UTC';
    return { kind: 'cron', expr, tz };
  }

  if (scheduleKind === 'every') {
    const amount = getCronTriggerEveryAmount(data);
    if (!amount) return undefined;
    const unit = getCronTriggerEveryUnit(data);
    const unitMs =
      unit === 'days' ? 24 * 60 * 60 * 1000 : unit === 'hours' ? 60 * 60 * 1000 : 60 * 1000;
    return {
      kind: 'every',
      everyMs: amount * unitMs,
      ...(options?.createdAtMs !== undefined ? { anchorMs: options.createdAtMs } : {}),
    };
  }

  const at = getCronTriggerRunAt(data);
  if (!at) return undefined;
  return { kind: 'at', at };
}
