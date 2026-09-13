import type { Settings } from './contracts.ts';
export { config } from './config.ts';
export const WAVEFORM = 'triangle-modulated-v1';

// Double-precision intermediates with one final IEEE-754 float32 rounding.
// A smooth triangle carrier with a smaller, faster triangle modulation.
export function sample(
  index: number,
  channel: number,
  { sampleRate, seed }: Pick<Settings, 'sampleRate' | 'seed'>,
) {
  const period = Math.max(8, Math.round(sampleRate / (2 + channel * 0.37)));
  const triangle = (phase: number, length: number) => 1 - 4 * Math.abs(phase / length - 0.5);
  const phase = ((index % period) + ((channel * 97 + seed) % period)) % period;
  const fastPeriod = Math.max(4, Math.round(period / 7));
  const fastPhase = ((index % fastPeriod) + (seed % fastPeriod)) % fastPeriod;
  return Math.fround(0.8 * triangle(phase, period) + 0.12 * triangle(fastPhase, fastPeriod));
}

export const stride = (channels: number) => 8 + channels * 4;

export function encodeFrames(start: number, count: number, settings: Settings) {
  const width = stride(settings.channels);
  const buffer = Buffer.allocUnsafe(count * width);
  for (let frame = 0; frame < count; frame++) {
    buffer.writeBigUInt64LE(BigInt(start + frame), frame * width);
    for (let channel = 0; channel < settings.channels; channel++) {
      buffer.writeFloatLE(
        sample(start + frame, channel, settings),
        frame * width + 8 + channel * 4,
      );
    }
  }
  return buffer;
}
