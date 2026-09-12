import type { Frame } from './contracts.ts';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { Acquisition } from './acquisition.ts';
import { config } from './signal.ts';
import { inspect, readFrames } from './storage.ts';
import { verify } from './verify.mjs';
import { Playback } from './playback.mjs';

const [command, ...args] = process.argv.slice(2);
const options: Record<string, string> = {};
let directory;
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { const key = args[i].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); options[key] = args[++i]; }
  else directory = resolve(args[i]);
}
try {
  if (command === 'record') {
    directory ??= resolve('recordings', new Date().toISOString().replace(/[:.]/g, '-'));
    const acquisition = new Acquisition();
    acquisition.start(config(options), directory);
    const interrupt = () => acquisition.shutdown();
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    const result = await acquisition.finished;
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    if (!result || result.status === 'failed' || !result.metadata) throw new Error(result?.error || 'Recording did not complete');
    console.log(JSON.stringify({ recording: directory, status: result.status, frames: result.metadata.recordedFrames, droppedFrames: result.metadata.droppedFrames }));
  } else if (!directory && ['verify', 'inspect', 'retrieve', 'playback'].includes(command)) {
    throw new Error('A recording directory is required');
  } else if (command === 'verify') {
    const report = await verify(directory);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.result === 'PASS' ? 0 : 1;
  } else if (command === 'inspect') console.log(JSON.stringify(await inspect(directory!), null, 2));
  else if (command === 'retrieve') {
    const metadata = await inspect(directory!);
    const channels = options.channels ? options.channels.split(',').map(Number) : Array.from({ length: metadata.channels }, (_, i) => i);
    const start = options.startSeconds !== undefined ? Math.ceil(Number(options.startSeconds) * metadata.sampleRate) : Number(options.start || 0);
    const end = options.endSeconds !== undefined ? Math.ceil(Number(options.endSeconds) * metadata.sampleRate) : Number(options.end ?? metadata.expectedFrames);
    for await (const frame of readFrames(directory!, { start, end, channels })) if (!process.stdout.write(JSON.stringify(frame) + '\n')) await once(process.stdout, 'drain');
  } else if (command === 'playback') {
    const playback = await new Playback(directory!, (frames: Frame[]) => { if (options.output === 'jsonl') for (const f of frames) process.stdout.write(JSON.stringify(f) + '\n'); }).init();
    if (options.speed) playback.setSpeed(Number(options.speed));
    if (options.start) playback.seek(Number(options.start));
    playback.onStatus = (status: { playing: boolean }) => { if (!status.playing) { console.error(JSON.stringify(status)); } };
    process.on('SIGINT', () => playback.close());
    playback.play();
  } else {
    console.log('SCOPE commands:\n  record [directory] --seconds 60 --channels 32 --sample-rate 4000 --seed 42\n  inspect <directory>\n  verify <directory>\n  retrieve <directory> --start 0 --end 100 --channels 0,3\n  playback <directory> --speed 1\nSee README.md for range, playback and overload behavior.');
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
