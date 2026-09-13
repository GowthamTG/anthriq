import type { Settings } from './contracts.ts';

export class ConfigurationError extends Error {
  statusCode = 400;
  fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super(Object.values(fields).join('; '));
    this.fields = fields;
  }
}

// Counts and byte offsets must stay exactly representable by JavaScript numbers.
export function safeExtent(frames: number, channels: number) {
  return (
    Number.isSafeInteger(frames) &&
    frames >= 0 &&
    Number.isSafeInteger(frames * channels) &&
    Number.isSafeInteger(frames * (8 + 4 * channels))
  );
}

export function config(input: unknown = {}): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigurationError({ configuration: 'Configuration must be an object' });
  }
  const raw = input as Record<string, unknown>;
  const defaults = {
    channels: 32,
    sampleRate: 4000,
    seed: 42,
    bufferBytes: 4194304,
    seconds: 0,
    writeDelayMs: 0,
    stallAfterSeconds: 0,
    stallForMs: 0,
  };
  const fields: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (key !== 'displayName' && !Object.hasOwn(defaults, key))
      throw new ConfigurationError({ configuration: `Unknown setting: ${key}` });
  }
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !value.trim()) ||
      !Number.isFinite(Number(value))
    ) {
      fields[key] = `${key} must be a finite number`;
    } else result[key] = Number(value);
  }
  for (const [key, min, max] of [
    ['channels', 1, 256],
    ['sampleRate', 1, 100000],
    ['seed', 0, 2147483647],
    ['bufferBytes', 4096, 67108864],
  ] as const) {
    if (!Number.isSafeInteger(result[key]) || result[key] < min || result[key] > max)
      fields[key] = `${key} must be an integer from ${min} to ${max}`;
  }
  if (result.seconds < 0) fields.seconds = 'Duration must be zero (until stopped) or positive';
  if (result.writeDelayMs < 0 || result.writeDelayMs > 5000)
    fields.writeDelayMs = 'Recorder delay must be from 0 to 5000 milliseconds';
  if (result.stallAfterSeconds < 0 || result.stallAfterSeconds > 86400)
    fields.stallAfterSeconds = 'Stall onset must be from 0 to 86400 seconds';
  if (!Number.isSafeInteger(result.stallForMs) || result.stallForMs < 0 || result.stallForMs > 5000)
    fields.stallForMs = 'Temporary stall must be an integer from 0 to 5000 milliseconds';
  const frames = Math.floor(result.seconds * result.sampleRate);
  if (!safeExtent(frames, result.channels)) {
    fields.seconds = 'Duration exceeds the safe frame, sample-count, or file-offset range';
  }
  if (
    raw.displayName !== undefined &&
    (typeof raw.displayName !== 'string' || raw.displayName.length > 120)
  ) {
    fields.displayName = 'Recording name must be text, up to 120 characters';
  }
  if (Object.keys(fields).length) throw new ConfigurationError(fields);
  return {
    ...result,
    displayName: typeof raw.displayName === 'string' ? raw.displayName.trim() : '',
  };
}
