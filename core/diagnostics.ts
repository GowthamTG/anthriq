import { randomUUID } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DIAGNOSTIC_SCENARIOS, type DiagnosticScenario, type RecordingMetadata, type Settings } from './contracts.ts';
import { recordingId } from './library.ts';
import { encodeFrames, stride, WAVEFORM } from './signal.ts';
import { inspect, saveMetadata } from './storage.ts';

const EXPECTED_FRAMES = 8;
const scenarios = {
  clean: { label: 'Clean control', indices: [0, 1, 2, 3, 4, 5, 6, 7], losses: [] },
  missing: { label: 'Missing frames', indices: [1, 2, 4, 5], losses: [[0, 1], [3, 4], [6, 8]] },
  duplicate: { label: 'Duplicated frame', indices: [0, 1, 1, 2, 3, 4, 5, 6, 7], losses: [] },
  incorrect: { label: 'Incorrect values', indices: [0, 1, 2, 3, 4, 5, 6, 7], losses: [] },
  combined: { label: 'Combined faults', indices: [1, 1, 3, 4, 5, 6], losses: [[0, 1], [2, 3], [7, 8]] },
} as const;

export async function createDiagnosticScenario(root: string, sourceRecordingId: string, scenario: DiagnosticScenario): Promise<string> {
  if (!recordingId(sourceRecordingId)) throw Object.assign(new Error('Source recording not found'), { statusCode: 404 });
  if (!DIAGNOSTIC_SCENARIOS.includes(scenario)) throw Object.assign(new Error('Unsupported diagnostic scenario'), { statusCode: 400 });
  const source = await inspect(join(root, sourceRecordingId));
  if (source.status !== 'completed') throw Object.assign(new Error('Only completed recordings can seed a diagnostic scenario'), { statusCode: 409 });
  if (source.diagnostic) throw Object.assign(new Error('Choose an acquisition recording as the diagnostic source'), { statusCode: 409 });
  const id = `diagnostic-${scenario}-${randomUUID()}`;
  const temporary = await mkdtemp(join(root, '.scope-diagnostic-'));
  try {
    const definition = scenarios[scenario as keyof typeof scenarios];
    const settings: Settings = {
      channels: source.channels,
      sampleRate: source.sampleRate,
      seed: source.seed,
      bufferBytes: 4096,
      seconds: EXPECTED_FRAMES / source.sampleRate,
      writeDelayMs: 0,
      stallAfterSeconds: 0,
      stallForMs: 0,
      displayName: `Diagnostic · ${definition.label}`,
    };
    const now = new Date().toISOString();
    const metadata: RecordingMetadata = {
      format: 'SCOPE/1',
      waveform: WAVEFORM,
      id,
      ...settings,
      status: 'completed',
      startedAt: now,
      stoppedAt: now,
      expectedFrames: EXPECTED_FRAMES,
      recordedFrames: definition.indices.length,
      totalSamples: definition.indices.length * source.channels,
      droppedFrames: definition.losses.reduce((total, [start, end]) => total + end - start, 0),
      duration: EXPECTED_FRAMES / source.sampleRate,
      sampleType: 'float32',
      bytesPerSample: 4,
      byteOrder: 'little-endian',
      layout: 'uint64 frame index, then interleaved channel values',
      recordBytes: stride(source.channels),
      diagnostic: { format: 'SCOPE-DIAGNOSTIC/1', scenario, sourceRecordingId, createdAt: now },
    };
    const frames = Buffer.concat(definition.indices.map(index => encodeFrames(index, 1, settings)));
    if (scenario === 'incorrect') {
      frames.writeFloatLE(99, 2 * metadata.recordBytes + 8);
      frames.writeFloatLE(Number.NaN, 4 * metadata.recordBytes + 8);
    } else if (scenario === 'combined') {
      frames.writeFloatLE(7, metadata.recordBytes + 8);
      frames.writeFloatLE(Number.POSITIVE_INFINITY, 2 * metadata.recordBytes + 8);
    }
    await writeFile(join(temporary, 'frames.bin'), frames, { flag: 'wx' });
    await writeFile(join(temporary, 'losses.jsonl'), definition.losses.map(([start, end]) => JSON.stringify({ startFrame: start, endFrameExclusive: end, frames: end - start, samples: (end - start) * source.channels, cause: 'disposable diagnostic scenario' })).join('\n') + (definition.losses.length ? '\n' : ''), { flag: 'wx' });
    await saveMetadata(temporary, metadata);
    await rename(temporary, join(root, id));
    return id;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
