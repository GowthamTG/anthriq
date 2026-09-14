import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { format } from 'prettier';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(read, accept, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch {}
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function json(base, path, init) {
  const response = await fetch(`${base}${path}`, init);
  assert.ok(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

function rawObserver(base, clientId, paused = false) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      `${base}/api/events?clientId=${clientId}&channels=0,1,2,3`,
      (response) => {
        if (paused) response.pause();
        else response.resume();
        resolve({
          close() {
            request.destroy();
            response.destroy();
          },
        });
      },
    );
    request.once('error', reject);
  });
}

async function browserHeap(pages) {
  const values = await Promise.all(
    pages.map((page) =>
      page.evaluate(() => performance.memory?.usedJSHeapSize ?? null).catch(() => null),
    ),
  );
  return values.filter(Number.isFinite).reduce((sum, value) => sum + value, 0) || null;
}

async function openPage(browser, base, busy = false) {
  const page = await browser.newPage();
  await page.goto(base);
  if (busy)
    await page.evaluate(() => {
      window.__scopeBusyInterval = setInterval(() => {
        const until = performance.now() + 200;
        while (performance.now() < until) Math.sqrt(Math.random());
      }, 400);
    });
  return page;
}

async function observersFor(name, browser, base) {
  const pages = [];
  const raw = [];
  let reconnectCheck = null;
  if (name === 'normal-observer') pages.push(await openPage(browser, base));
  if (name === 'stalled-sse-reader') raw.push(await rawObserver(base, 'stalled-reader', true));
  if (name === 'reconnect-churn') {
    let priorRecordedFrames = 0;
    for (let index = 0; index < 6; index++) {
      const observer = await rawObserver(base, 'churn-reader');
      raw.push(observer);
      await sleep(120);
      const state = await json(base, '/api/state?clientId=churn-reader');
      assert.ok((state.metrics?.recordedFrames ?? 0) >= priorRecordedFrames);
      priorRecordedFrames = state.metrics?.recordedFrames ?? priorRecordedFrames;
      if (index < 5) raw.pop().close();
    }
    reconnectCheck = { reconnects: 5, nondecreasingPersistedFrames: true };
  }
  if (name === 'multiple-observers')
    for (let index = 0; index < 8; index++) pages.push(await openPage(browser, base));
  if (name === 'busy-browser') pages.push(await openPage(browser, base, true));
  return {
    pages,
    reconnectCheck,
    async close() {
      raw.forEach((observer) => observer.close());
      await Promise.all(pages.map((page) => page.close()));
    },
  };
}

async function writeLine(stream, value) {
  if (stream.write(`${JSON.stringify(value)}\n`)) return;
  await once(stream, 'drain');
}

export async function runBrowserIsolationEvidence({
  outputDirectory,
  recordingsRoot,
  seconds = 5,
} = {}) {
  const destination = resolve(outputDirectory ?? 'docs/evidence/issue-36');
  const root = resolve(
    recordingsRoot ??
      join('recordings', `issue-36-${new Date().toISOString().replaceAll(':', '-')}`),
  );
  await Promise.all([mkdir(destination, { recursive: true }), mkdir(root, { recursive: true })]);
  const rawPath = join(destination, 'measurements.jsonl');
  const rawStream = createWriteStream(rawPath, { flags: 'w' });
  const port = 3136;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      SCOPE_RECORDINGS_DIR: root,
      SCOPE_EVIDENCE_MODE: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const serverClosed = once(server, 'close');
  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const names = [
    'no-observer',
    'normal-observer',
    'stalled-sse-reader',
    'reconnect-churn',
    'multiple-observers',
    'busy-browser',
  ];
  const cases = [];
  try {
    await until(
      () => fetch(`${base}/api/state`),
      (response) => response.status === 200,
      'evidence server',
      30000,
    );
    for (const name of names) {
      await until(
        () => json(base, '/api/diagnostics/observers'),
        (diagnostics) => diagnostics.activeClients === 0,
        `${name} clean observer baseline`,
      );
      const before = await json(base, '/api/diagnostics/observers');
      const began = performance.now();
      const started = await json(base, '/api/acquisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels: 32,
          sampleRate: 4000,
          seconds,
          displayName: `Browser isolation ${name}`,
        }),
      });
      const observers = await observersFor(name, browser, base);
      const samples = [];
      const final = await until(
        async () => {
          const [state, diagnostics, heapBytes] = await Promise.all([
            json(base, '/api/state'),
            json(base, '/api/diagnostics/observers'),
            browserHeap(observers.pages),
          ]);
          const sample = {
            case: name,
            observedAtMs: performance.now() - began,
            status: state.status,
            acquisition: state.metrics,
            observers: diagnostics,
            browserHeapBytes: heapBytes,
          };
          samples.push(sample);
          await writeLine(rawStream, sample);
          return state;
        },
        (state) => state.status === 'completed' || state.status === 'failed',
        `${name} completion`,
        (seconds + 15) * 1000,
      );
      const elapsedMs = performance.now() - began;
      const inspection = await json(base, `/api/acquisitions/${started.id}`);
      assert.equal(final.status, 'completed', `${name}: acquisition must complete`);
      assert.equal(inspection.expectedFrames, Math.floor(seconds * 4000));
      assert.equal(inspection.recordedFrames, inspection.expectedFrames);
      assert.equal(inspection.droppedFrames, 0);
      assert.equal(inspection.generator.droppedFrames, 0);
      const afterRun = await json(base, '/api/diagnostics/observers');
      if (name === 'stalled-sse-reader')
        assert.ok(
          afterRun.backpressureDisconnects > before.backpressureDisconnects,
          'the stalled SSE reader must be evicted by the bounded drain policy',
        );
      await observers.close();
      const afterCleanup = await until(
        () => json(base, '/api/diagnostics/observers'),
        (diagnostics) => diagnostics.activeClients === 0,
        `${name} observer cleanup`,
        2500,
      );
      cases.push({
        name,
        recordingId: started.id,
        elapsedMs,
        expectedFrames: inspection.expectedFrames,
        scheduledFrames: inspection.generator.scheduledFrames,
        emittedFrames: inspection.generator.emittedFrames,
        persistedFrames: inspection.recordedFrames,
        lostFrames: inspection.droppedFrames,
        sourceTiming: {
          elapsedSeconds: inspection.generator.elapsedSeconds,
          pacingErrorFrames: inspection.generator.pacingErrorFrames,
          emissionDeficitFrames: inspection.generator.emissionDeficitFrames,
          emissionRateFramesPerSecond: inspection.generator.emissionRateFramesPerSecond,
          maxEmissionGapMs: inspection.generator.maxEmissionGapMs,
        },
        sourceMaxLagMs: inspection.generator.maxLagMs,
        peakOutstandingBytes: inspection.generator.peakOutstandingBytes,
        peakQueueBytes: inspection.peakQueueBytes,
        generatorPeakRssBytes: inspection.generator.peakRssBytes,
        recorderPeakRssBytes: inspection.recorderPeakRssBytes,
        serverPeakRssBytes: Math.max(...samples.map((sample) => sample.observers.serverRssBytes)),
        browserPeakHeapBytes:
          Math.max(0, ...samples.map((sample) => sample.browserHeapBytes ?? 0)) || null,
        peakActiveClients: Math.max(...samples.map((sample) => sample.observers.activeClients)),
        peakWritableLengthBytes: Math.max(
          0,
          ...samples.flatMap((sample) =>
            sample.observers.clients.map((client) => client.writableLengthBytes),
          ),
        ),
        observerCleanupMs: performance.now() - began - elapsedMs,
        reconnectCheck: observers.reconnectCheck,
        commandAccounting: { acquisitionStartRequests: 1, stopRequests: 0 },
        diagnosticsDelta: {
          opened: afterCleanup.opened - before.opened,
          closed: afterCleanup.closed - before.closed,
          replacements: afterCleanup.replacements - before.replacements,
          backpressureDisconnects:
            afterCleanup.backpressureDisconnects - before.backpressureDisconnects,
        },
      });
    }
  } finally {
    rawStream.end();
    await once(rawStream, 'close');
    await browser.close();
    server.kill('SIGTERM');
    await serverClosed;
  }
  const control = cases[0];
  for (const item of cases.slice(1)) {
    const completionToleranceMs = Math.max(control.elapsedMs * 0.05, 250);
    const lagToleranceMs = Math.max(control.sourceMaxLagMs * 2, 25);
    assert.ok(
      item.elapsedMs - control.elapsedMs <= completionToleranceMs,
      `${item.name}: completion impact exceeded the project tolerance`,
    );
    assert.ok(
      item.sourceMaxLagMs <= lagToleranceMs,
      `${item.name}: source lag exceeded the project tolerance`,
    );
    assert.equal(item.lostFrames, 0, `${item.name}: observer case must remain lossless`);
    assert.equal(item.scheduledFrames, item.expectedFrames, `${item.name}: source extent mismatch`);
    assert.equal(item.emittedFrames, item.persistedFrames, `${item.name}: persistence mismatch`);
    assert.ok(item.peakActiveClients <= 8, `${item.name}: observer count exceeded its bound`);
    assert.ok(
      item.peakWritableLengthBytes <= 65536,
      `${item.name}: observed socket backlog exceeded its bound`,
    );
  }
  const result = {
    format: 'SCOPE-BROWSER-ISOLATION-EVIDENCE/1',
    createdAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      release: release(),
      architecture: process.arch,
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      node: process.version,
      browser: 'Playwright Chromium',
    },
    configuration: { channels: 32, sampleRate: 4000, seconds },
    recordingRoot: relative(process.cwd(), root),
    engineeringTolerances: {
      note: 'Project evidence thresholds, not requirements quoted from the assessment.',
      completionImpact: 'no more than max(5% of no-observer elapsed time, 250 ms)',
      sourceMaximumLag: 'no more than max(2x no-observer maximum lag, 25 ms)',
      recordedLoss: 'zero frames',
      maximumObservers: 8,
      maximumSocketWritableLengthBytes: 65536,
      cleanupMs: 2500,
    },
    cases,
    result: 'PASS',
  };
  await writeFile(
    join(destination, 'summary.json'),
    await format(JSON.stringify(result), { parser: 'json' }),
  );
  process.stdout.write(
    `${JSON.stringify({ result: result.result, cases: cases.map((item) => item.name) })}\n`,
  );
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--output-directory');
  const rootIndex = process.argv.indexOf('--recordings-root');
  const secondsIndex = process.argv.indexOf('--seconds');
  await runBrowserIsolationEvidence({
    outputDirectory: outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined,
    recordingsRoot: rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined,
    seconds: secondsIndex >= 0 ? Number(process.argv[secondsIndex + 1]) : 5,
  });
}
