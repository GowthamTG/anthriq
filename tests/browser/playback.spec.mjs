import { test, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const base = 'http://127.0.0.1:3106';
let root, server, closed;
test.describe.configure({ mode: 'serial' });

async function record(id, seconds) {
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    join(root, id),
    '--channels',
    '2',
    '--sample-rate',
    '20',
    '--seconds',
    String(seconds),
    '--display-name',
    id === 'ui-recording'
      ? 'Playback reference'
      : id === 'gap-recording'
        ? 'Playback gap reference'
        : 'API reference',
  ]);
}

async function createGapRecording() {
  await record('gap-recording', 0.5);
  const directory = join(root, 'gap-recording');
  const framePath = join(directory, 'frames.bin');
  const frames = await readFile(framePath);
  const width = 16;
  await writeFile(
    framePath,
    Buffer.concat(
      [1, 2, 5, 6, 7, 8].map((index) => frames.subarray(index * width, (index + 1) * width)),
    ),
  );
  const metadataPath = join(directory, 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  await writeFile(
    metadataPath,
    JSON.stringify({ ...metadata, recordedFrames: 6, totalSamples: 12, droppedFrames: 4 }),
  );
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scope-playback-browser-'));
  await record('api-recording', 0.3);
  await record('ui-recording', 0.5);
  await record('control-recording', 2);
  await createGapRecording();
  await record('incomplete-recording', 0.1);
  const metadataPath = join(root, 'incomplete-recording', 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  await writeFile(
    metadataPath,
    JSON.stringify({ ...metadata, status: 'failed', expectedFrames: null, duration: null }),
  );
  server = spawn(process.execPath, ['server.ts'], {
    env: { ...process.env, PORT: '3106', SCOPE_RECORDINGS_DIR: root },
    stdio: 'ignore',
  });
  closed = once(server, 'close');
  await expect
    .poll(async () => {
      try {
        return (await fetch(`${base}/api/state`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  await closed;
  await rm(root, { recursive: true, force: true });
});

const post = (body) =>
  fetch(`${base}/api/playback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('playback HTTP commands validate input and preserve one active session', async () => {
  expect(await (await fetch(`${base}/api/playback`)).json()).toMatchObject({
    status: 'idle',
    recordingId: null,
  });
  expect((await post({ action: 'open' })).status).toBe(400);
  expect((await post({ action: 'open', recordingId: 'api-recording', extra: true })).status).toBe(
    400,
  );
  expect((await post({ action: 'unknown', recordingId: 'api-recording' })).status).toBe(400);
  expect((await post({ action: 'open', recordingId: 'missing' })).status).toBe(404);
  expect((await post({ action: 'open', recordingId: 'incomplete-recording' })).status).toBe(409);

  const opened = await post({ action: 'open', recordingId: 'api-recording' });
  expect(opened.status).toBe(200);
  expect(await opened.json()).toMatchObject({ status: 'paused', recordingId: 'api-recording' });
  expect(
    (
      await post({
        action: 'seek',
        recordingId: 'api-recording',
        position: 1,
        positionSeconds: 0.1,
      })
    ).status,
  ).toBe(400);
  expect((await post({ action: 'speed', recordingId: 'api-recording', speed: 9 })).status).toBe(
    400,
  );
  const precise = await post({
    action: 'seek',
    recordingId: 'api-recording',
    positionSeconds: 0.1,
  });
  expect(precise.status).toBe(200);
  expect(await precise.json()).toMatchObject({ status: 'paused', position: 2 });
  expect((await post({ action: 'play', recordingId: 'ui-recording' })).status).toBe(409);
  expect((await post({ action: 'play', recordingId: 'api-recording' })).status).toBe(200);
  await expect
    .poll(async () => (await (await fetch(`${base}/api/playback`)).json()).emittedFrames)
    .toBeGreaterThan(0);
  const before = await (await fetch(`${base}/api/playback`)).json();
  const same = await (await post({ action: 'open', recordingId: 'api-recording' })).json();
  expect(same.emittedFrames).toBeGreaterThanOrEqual(before.emittedFrames);
  expect(same.status).not.toBe('paused');
});

test('recording detail plays real observations once and restarts paused at zero', async ({
  page,
}) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(`${base}/recordings?id=ui-recording`);
  await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible();
  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  await expect(
    page.getByRole('img', {
      name: 'Playback signal trace with original-frame and elapsed-time axes',
    }),
  ).toBeVisible();
  await expect(page.getByTestId('playback-visible-window')).toContainText('frames 0-9');
  await expect(page.getByTestId('playback-visible-gaps')).toContainText('0');
  await expect(page.getByTestId('playback-trace').locator('.uplot')).toHaveCount(1);
  await expect(page.getByTestId('playback-trace').locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Ended', { timeout: 3000 });
  await expect(page.getByTestId('playback-metrics')).toContainText('10');
  await expect(page.getByTestId('playback-metrics')).toContainText('20');
  await expect(page.getByTestId('playback-latest-frame')).not.toContainText('Not available');
  await expect(page.getByTestId('playback-trace')).toBeVisible();
  const plot = page.getByTestId('playback-trace').locator('.u-over');
  const box = await plot.boundingBox();
  expect(box).not.toBeNull();
  await plot.hover({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByTestId('playback-cursor-readout')).toContainText('Frame');
  await expect(page.getByTestId('playback-cursor-readout')).toContainText('Channel 0');
  await expect(page.getByTestId('playback-cursor-readout')).toContainText(' s |');

  const ended = await (await fetch(`${base}/api/playback`)).json();
  expect(ended).toMatchObject({ status: 'ended', position: 10, emittedFrames: 10 });
  const repeated = await (await post({ action: 'play', recordingId: 'ui-recording' })).json();
  expect(repeated).toMatchObject({ status: 'ended', position: 10, emittedFrames: 10 });

  if (process.env.SCOPE_CAPTURE_T10_CHART_EVIDENCE) {
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t10/uplot-ended.png'),
      fullPage: true,
    });
  }

  if (process.env.SCOPE_CAPTURE_T10_EVIDENCE) {
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t10/ended.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t10/narrow-ended.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  await expect(page.getByTestId('playback-metrics')).toContainText('0 / 10');
  await expect(page.getByTestId('playback-latest-frame')).toContainText('Not available');
  await expect(page.getByTestId('playback-trace').locator('.uplot')).toHaveCount(1);
  expect(consoleErrors).toEqual([]);
});

test('uPlot trace preserves initial, interior, and trailing gaps across replacement', async ({
  page,
}) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(`${base}/recordings?id=gap-recording`);
  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Ended', { timeout: 3000 });
  await expect(page.getByTestId('playback-latest-frame')).toContainText('8');
  await expect(page.getByTestId('playback-visible-window')).toContainText('frames 0-9');
  await expect(page.getByTestId('playback-visible-gaps')).toContainText('3');
  await expect(page.getByTestId('playback-trace').locator('.uplot')).toHaveCount(1);
  const snapshot = await (await fetch(`${base}/api/playback`)).json();
  expect(snapshot.preview.observations.length).toBeLessThanOrEqual(256);
  expect(snapshot.preview.channels.length).toBeLessThanOrEqual(4);

  if (process.env.SCOPE_CAPTURE_T10_CHART_EVIDENCE) {
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t10/uplot-gap.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('playback-trace')).toBeVisible();
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t10/uplot-narrow.png'),
      fullPage: true,
    });
  }

  await page.getByTestId('library-item').filter({ hasText: 'ui-recording' }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  await expect(page.getByTestId('playback-latest-frame')).toContainText('Not available');
  await expect(page.getByTestId('playback-visible-gaps')).toContainText('0');
  await expect(page.getByTestId('playback-trace').locator('.uplot')).toHaveCount(1);
  expect(consoleErrors).toEqual([]);
});

test('recording detail pauses, seeks, changes speed, and changes visible channels', async ({
  page,
}) => {
  await page.goto(`${base}/recordings?id=control-recording`);
  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  await page.getByRole('button', { name: '0.25×' }).click();
  await expect(page.getByTestId('playback-metrics')).toContainText('0.25×');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => (await (await fetch(`${base}/api/playback`)).json()).position)
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = await (await fetch(`${base}/api/playback`)).json();
  expect(paused.status).toBe('paused');
  await page.waitForTimeout(100);
  expect((await (await fetch(`${base}/api/playback`)).json()).position).toBe(paused.position);

  await page.getByTestId('playback-exact-seek').fill('20');
  await page.getByRole('button', { name: 'Seek', exact: true }).click();
  await expect(page.getByTestId('playback-metrics')).toContainText('20 / 40');
  await page.getByLabel('Ch 1').click();
  await expect
    .poll(async () => (await (await fetch(`${base}/api/playback`)).json()).channels)
    .toEqual([0]);
  await page.getByTestId('playback-speed').fill('2');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('playback-metrics')).toContainText('2×');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect
    .poll(async () => (await (await fetch(`${base}/api/playback`)).json()).position)
    .toBeGreaterThan(20);
  await page.getByTestId('playback-timeline').press('End');
  await expect(page.getByTestId('playback-status')).toHaveText('Ended');
  const ended = await (await fetch(`${base}/api/playback`)).json();
  expect(ended.position).toBe(40);
  expect(ended.preview.channels).toEqual([0]);

  if (process.env.SCOPE_CAPTURE_T11_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t11/controls-ended.png'),
      fullPage: true,
    });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
