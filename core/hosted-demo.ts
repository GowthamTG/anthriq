import { opendir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { LibraryPage } from './library.ts';
import { recordingId } from './library.ts';
import type { RecordingInspection, RuntimeInfo, Settings } from './contracts.ts';
import { inspect } from './storage.ts';

export const PUBLIC_DEMO_LIMITS = Object.freeze({
  maximumChannels: 32,
  maximumSampleRate: 4_000,
  minimumDurationSeconds: 1,
  maximumDurationSeconds: 5,
  maximumBufferBytes: 4 * 1024 * 1024,
  retainedRecordings: 12,
  acquisitionStartsPerHour: 6,
  verificationStartsPerHour: 12,
  diagnosticScenarios: false as const,
});

export interface ServerRuntime {
  hostname: string;
  publicDemo: boolean;
  info: RuntimeInfo;
}

export function serverRuntime(environment: NodeJS.ProcessEnv = process.env): ServerRuntime {
  const mode = environment.SCOPE_DEMO_MODE;
  if (mode !== undefined && mode !== 'public')
    throw new Error('SCOPE_DEMO_MODE must be public when set');
  const publicDemo = mode === 'public';
  const hostname = environment.SCOPE_HOST || '127.0.0.1';
  if (publicDemo && hostname !== '0.0.0.0')
    throw new Error('Public demo mode requires SCOPE_HOST=0.0.0.0');
  return {
    hostname,
    publicDemo,
    info: publicDemo
      ? {
          mode: 'public-demo',
          storage: 'persistent-hosted-volume',
          limits: PUBLIC_DEMO_LIMITS,
          availability: 'best-effort-free-tier',
        }
      : {
          mode: 'local',
          storage: 'local-filesystem',
          limits: null,
          availability: 'local',
        },
  };
}

export function validatePublicDemoSettings(settings: Settings) {
  const fields: Record<string, string> = {};
  if (settings.channels > PUBLIC_DEMO_LIMITS.maximumChannels)
    fields.channels = `Hosted captures support at most ${PUBLIC_DEMO_LIMITS.maximumChannels} channels`;
  if (settings.sampleRate > PUBLIC_DEMO_LIMITS.maximumSampleRate)
    fields.sampleRate = `Hosted captures support at most ${PUBLIC_DEMO_LIMITS.maximumSampleRate.toLocaleString('en-US')} Hz per channel`;
  if (
    settings.seconds < PUBLIC_DEMO_LIMITS.minimumDurationSeconds ||
    settings.seconds > PUBLIC_DEMO_LIMITS.maximumDurationSeconds
  )
    fields.seconds = `Hosted captures must run from ${PUBLIC_DEMO_LIMITS.minimumDurationSeconds} to ${PUBLIC_DEMO_LIMITS.maximumDurationSeconds} seconds`;
  if (settings.bufferBytes > PUBLIC_DEMO_LIMITS.maximumBufferBytes)
    fields.bufferBytes = `Hosted captures support at most ${PUBLIC_DEMO_LIMITS.maximumBufferBytes} buffer bytes`;
  if (settings.writeDelayMs || settings.stallAfterSeconds || settings.stallForMs)
    fields.diagnostics = 'Recorder delay and stall diagnostics are unavailable in the public demo';
  if (Object.keys(fields).length)
    throw Object.assign(new Error(Object.values(fields).join('; ')), { statusCode: 400, fields });
  return settings;
}

export class RollingWindowLimit {
  private starts: number[] = [];
  readonly maximum: number;
  readonly windowMs: number;
  constructor(maximum: number, windowMs = 60 * 60 * 1000) {
    this.maximum = maximum;
    this.windowMs = windowMs;
  }

  take(now = Date.now()) {
    this.starts = this.starts.filter((started) => now - started < this.windowMs);
    if (this.starts.length >= this.maximum) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((this.windowMs - (now - this.starts[0])) / 1000),
      );
      throw Object.assign(new Error('Public demo rate limit reached; try again later'), {
        statusCode: 429,
        retryAfterSeconds,
      });
    }
    this.starts.push(now);
  }
}

export function hideHostedLocation<T extends RecordingInspection>(recording: T): T {
  if (recording.location === undefined) return recording;
  const copy = { ...recording };
  delete copy.location;
  return copy;
}

export function hideHostedLibraryLocations(page: LibraryPage): LibraryPage {
  return {
    ...page,
    items: page.items.map((entry) => ({
      ...entry,
      recording: entry.recording ? hideHostedLocation(entry.recording) : undefined,
    })),
  };
}

export async function prunePublicDemoRecordings(
  root: string,
  protectedIds: ReadonlySet<string>,
  maximum = PUBLIC_DEMO_LIMITS.retainedRecordings,
) {
  const safeRoot = resolve(root);
  let directory;
  try {
    directory = await opendir(safeRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const candidates: { id: string; startedAt: number }[] = [];
  let recordingCount = 0;
  for await (const entry of directory) {
    if (!entry.isDirectory() || !recordingId(entry.name)) continue;
    recordingCount++;
    if (protectedIds.has(entry.name)) continue;
    try {
      const recording = await inspect(join(safeRoot, entry.name));
      if (!['completed', 'failed'].includes(recording.status)) continue;
      candidates.push({ id: entry.name, startedAt: Date.parse(recording.startedAt) || 0 });
    } catch {
      // Malformed or incomplete evidence remains available for inspection instead of being erased.
    }
  }
  const removalCount = Math.max(0, recordingCount - maximum + 1);
  candidates.sort(
    (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id),
  );
  if (candidates.length < removalCount)
    throw Object.assign(new Error('Hosted recording storage is temporarily at capacity'), {
      statusCode: 507,
    });
  const removed: string[] = [];
  for (const { id } of candidates.slice(0, removalCount)) {
    const target = join(safeRoot, id);
    if (resolve(target).startsWith(`${safeRoot}/`)) {
      await rm(target, { recursive: true, force: true });
      removed.push(id);
    }
  }
  return removed;
}
