import { resolve } from 'node:path';
import { once } from 'node:events';
import { Acquisition } from './acquisition.ts';
import { config } from './signal.ts';
import { inspect, parseChannelList, readFrames } from './storage.ts';
import { verifyRecording } from './verify.ts';
import { listRecordings } from './library.ts';
import { Playback } from './playback.ts';

const [command, ...args] = process.argv.slice(2);
const options: Record<string, string> = {};
let directory;
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const option = args[i];
      const value = args[++i];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`Missing value for ${option}`);
      const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (key in options) throw new Error(`Duplicate option: ${option}`);
      options[key] = value;
    } else {
      if (directory) throw new Error('Provide only one recording directory');
      directory = resolve(args[i]);
    }
  }
  if (command === 'list') {
    for (const key of Object.keys(options))
      if (!['limit', 'cursor'].includes(key)) throw new Error(`Unknown list option: ${key}`);
    console.log(
      JSON.stringify(
        await listRecordings(
          directory || resolve(process.env.SCOPE_RECORDINGS_DIR || 'recordings'),
          options,
        ),
        null,
        2,
      ),
    );
  } else if (command === 'record') {
    directory ??= resolve('recordings', new Date().toISOString().replace(/[:.]/g, '-'));
    const acquisition = new Acquisition();
    acquisition.start(config(options), directory);
    const interrupt = () => acquisition.shutdown();
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    const result = await acquisition.finished;
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    if (!result || result.status === 'failed' || !result.metadata)
      throw new Error(result?.error || 'Recording did not complete');
    console.log(
      JSON.stringify({
        recording: directory,
        status: result.status,
        frames: result.metadata.recordedFrames,
        droppedFrames: result.metadata.droppedFrames,
      }),
    );
  } else if (!directory && ['verify', 'inspect', 'retrieve', 'playback'].includes(command)) {
    throw new Error('A recording directory is required');
  } else if (command === 'verify') {
    for (const key of Object.keys(options)) throw new Error(`Unknown verify option: ${key}`);
    try {
      const report = await verifyRecording(directory!);
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.result === 'PASS' ? 0 : 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    }
  } else if (command === 'inspect') console.log(JSON.stringify(await inspect(directory!), null, 2));
  else if (command === 'retrieve') {
    for (const key of Object.keys(options))
      if (!['channels', 'start', 'end', 'startSeconds', 'endSeconds', 'prefix'].includes(key))
        throw new Error(`Unknown retrieve option: ${key}`);
    const number = (key: string) => (options[key] === undefined ? undefined : Number(options[key]));
    const prefix = options.prefix === undefined ? false : options.prefix === 'true';
    if (options.prefix !== undefined && !['true', 'false'].includes(options.prefix))
      throw new Error('Prefix must be true or false');
    const query = {
      channels: parseChannelList(options.channels),
      start: number('start'),
      end: number('end'),
      startSeconds: number('startSeconds'),
      endSeconds: number('endSeconds'),
      prefix,
    };
    for await (const frame of readFrames(directory!, query))
      if (!process.stdout.write(JSON.stringify(frame) + '\n')) await once(process.stdout, 'drain');
  } else if (command === 'playback') {
    for (const key of Object.keys(options))
      if (key !== 'output') throw new Error(`Unknown playback option: ${key}`);
    if (options.output !== undefined && options.output !== 'jsonl')
      throw new Error('Playback output must be jsonl');
    const playback = await Playback.open(directory!, {
      async write(frames) {
        if (options.output !== 'jsonl') return;
        for (const frame of frames)
          if (!process.stdout.write(JSON.stringify(frame) + '\n'))
            await once(process.stdout, 'drain');
      },
    });
    let finish: (state: ReturnType<typeof playback.snapshot>) => void = () => {};
    const settled = new Promise<ReturnType<typeof playback.snapshot>>((resolve) => {
      finish = resolve;
    });
    const unsubscribe = playback.subscribe((state) => {
      if (state.status === 'ended' || state.status === 'error') finish(state);
    });
    const interrupt = () => {
      const state = playback.snapshot();
      void playback.close().finally(() => finish(state));
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    playback.play();
    const result = playback.snapshot().status === 'ended' ? playback.snapshot() : await settled;
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    unsubscribe();
    await playback.close();
    console.error(JSON.stringify(result));
    if (result.status === 'error') throw new Error(result.error || 'Playback failed');
  } else {
    console.log(
      'SCOPE commands:\n  record [directory] --seconds 60 --channels 32 --sample-rate 4000 --seed 42 --display-name "Bench run"\n    Optional: --buffer-bytes 4194304 --write-delay-ms 0\n    Temporary diagnostic: --stall-after-seconds 0.5 --stall-for-ms 1000 (off by default)\n    --seconds 0 means until stopped; settings bounds are documented in README.md.\n  list [root] --limit 10 --cursor <last-recording-id>\n  inspect <directory>\n  verify <directory>\n  retrieve <directory> --start 0 --end 100 --channels 0,3\n  playback <directory> [--output jsonl]\nSee README.md for range, playback and overload behavior.',
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = command === 'verify' ? 2 : 1;
}
