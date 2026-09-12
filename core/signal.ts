import type { Settings, SettingsInput } from './contracts.ts';
// Integer arithmetic defines the waveform exactly on every supported platform.
// A smooth triangle carrier with a smaller, faster triangle modulation.
export function sample(index: number, channel: number, { sampleRate, seed }: Pick<Settings, 'sampleRate' | 'seed'>) {
  const period = Math.max(8, Math.round(sampleRate / (2 + channel * 0.37)));
  const triangle = (phase: number, length: number) => 1 - 4 * Math.abs(phase / length - 0.5);
  const phase = (index % period + ((channel * 97 + seed) % period)) % period;
  const fastPeriod = Math.max(4, Math.round(period / 7));
  const fastPhase = (index % fastPeriod + seed % fastPeriod) % fastPeriod;
  return Math.fround(0.8 * triangle(phase, period) + 0.12 * triangle(fastPhase, fastPeriod));
}

export function config(input: SettingsInput = {}): Settings {
  const result = { channels: 32, sampleRate: 4000, seed: 42, bufferBytes: 4 * 1024 * 1024, seconds: 0, writeDelayMs: 0, ...input };
  for (const [key, min, max] of [['channels', 1, 256], ['sampleRate', 1, 100000], ['seed', 0, 2147483647], ['bufferBytes', 4096, 64 * 1024 * 1024]] as const) {
    result[key] = Number(result[key]);
    if (!Number.isSafeInteger(result[key]) || Number(result[key]) < min || Number(result[key]) > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  for (const key of ['seconds', 'writeDelayMs'] as const) {
    result[key] = Number(result[key]);
    if (!Number.isFinite(result[key]) || Number(result[key]) < 0 || Number(result[key]) > (key === 'seconds' ? 604800 : 5000)) throw new Error(`Invalid ${key}`);
  }
  return result as Settings;
}

export const stride = (channels: number) => 8 + channels * 4;

export function encodeFrames(start: number, count: number, settings: Settings) {
  const width = stride(settings.channels);
  const buffer = Buffer.allocUnsafe(count * width);
  for (let frame = 0; frame < count; frame++) {
    buffer.writeBigUInt64LE(BigInt(start + frame), frame * width);
    for (let channel = 0; channel < settings.channels; channel++) {
      buffer.writeFloatLE(sample(start + frame, channel, settings), frame * width + 8 + channel * 4);
    }
  }
  return buffer;
}
