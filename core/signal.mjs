// Integer arithmetic defines the waveform exactly on every supported platform.
// A smooth triangle carrier with a smaller, faster triangle modulation.
export function sample(index, channel, { sampleRate, seed }) {
  const period = Math.max(8, Math.round(sampleRate / (2 + channel * 0.37)));
  const triangle = (phase, length) => 1 - 4 * Math.abs(phase / length - 0.5);
  const phase = (index % period + ((channel * 97 + seed) % period)) % period;
  const fastPeriod = Math.max(4, Math.round(period / 7));
  const fastPhase = (index % fastPeriod + seed % fastPeriod) % fastPeriod;
  return Math.fround(0.8 * triangle(phase, period) + 0.12 * triangle(fastPhase, fastPeriod));
}

export function config(input = {}) {
  const result = { channels: 32, sampleRate: 4000, seed: 42, bufferBytes: 4 * 1024 * 1024, seconds: 0, writeDelayMs: 0, ...input };
  for (const [key, min, max] of [['channels', 1, 256], ['sampleRate', 1, 100000], ['seed', 0, 2147483647], ['bufferBytes', 4096, 64 * 1024 * 1024]]) {
    result[key] = Number(result[key]);
    if (!Number.isSafeInteger(result[key]) || result[key] < min || result[key] > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  for (const key of ['seconds', 'writeDelayMs']) {
    result[key] = Number(result[key]);
    if (!Number.isFinite(result[key]) || result[key] < 0 || result[key] > (key === 'seconds' ? 604800 : 5000)) throw new Error(`Invalid ${key}`);
  }
  return result;
}

export const stride = channels => 8 + channels * 4;

export function encodeFrames(start, count, settings) {
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
