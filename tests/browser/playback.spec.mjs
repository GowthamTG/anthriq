import { test, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function createDenseRecording() {
  const source = join(root, 'ui-recording');
  const directory = join(root, 'dense-recording');
  await mkdir(directory);
  const frameCount = 800;
  const channels = 32;
  const recordBytes = 8 + channels * 4;
  const frames = Buffer.alloc(frameCount * recordBytes);
  for (let index = 0; index < frameCount; index++) {
    const offset = index * recordBytes;
    frames.writeBigUInt64LE(BigInt(index), offset);
    for (let channel = 0; channel < channels; channel++)
      frames.writeFloatLE(Math.sin(index / 10 + channel), offset + 8 + channel * 4);
  }
  await writeFile(join(directory, 'frames.bin'), frames);
  const metadata = JSON.parse(await readFile(join(source, 'metadata.json'), 'utf8'));
  await writeFile(
    join(directory, 'metadata.json'),
    JSON.stringify({
      ...metadata,
      id: 'dense-recording',
      displayName: 'Dense playback reference',
      channels,
      recordBytes,
      sampleRate: 400,
      seconds: frameCount / 400,
      expectedFrames: frameCount,
      recordedFrames: frameCount,
      totalSamples: frameCount * channels,
      duration: frameCount / 400,
      droppedFrames: 0,
    }),
  );
}

async function createEmptyRecording() {
  const source = join(root, 'ui-recording');
  const directory = join(root, 'empty-recording');
  await mkdir(directory);
  await writeFile(join(directory, 'frames.bin'), Buffer.alloc(0));
  const metadata = JSON.parse(await readFile(join(source, 'metadata.json'), 'utf8'));
  await writeFile(
    join(directory, 'metadata.json'),
    JSON.stringify({
      ...metadata,
      id: 'empty-recording',
      displayName: 'Empty recording',
      seconds: 0,
      expectedFrames: 0,
      recordedFrames: 0,
      totalSamples: 0,
      duration: 0,
      droppedFrames: 0,
    }),
  );
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scope-playback-browser-'));
  await record('api-recording', 0.3);
  await record('ui-recording', 0.5);
  await createDenseRecording();
  await createEmptyRecording();
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

test('all-channel overview is ordered, bounded, endpoint-validated, and includes its extent', async () => {
  const response = await fetch(`${base}/api/recordings/dense-recording/channel-overview`);
  expect(response.status).toBe(200);
  const overview = await response.json();
  expect(overview).toMatchObject({
    channels: Array.from({ length: 32 }, (_, channel) => channel),
    sampleRate: 400,
    confirmedFrames: 800,
    capacity: 64,
  });
  expect(overview.observations).toHaveLength(64);
  expect(overview.observations[0].index).toBe(0);
  expect(overview.observations.at(-1).index).toBe(799);
  expect(overview.observations.every((frame) => frame.values.length === 32)).toBe(true);
  expect(overview.observations.length * overview.channels.length).toBeLessThanOrEqual(2048);

  const empty = await (
    await fetch(`${base}/api/recordings/empty-recording/channel-overview`)
  ).json();
  expect(empty).toMatchObject({ confirmedFrames: 0, observations: [] });
  expect((await fetch(`${base}/api/recordings/not%2Fa%2Frecording/channel-overview`)).status).toBe(
    404,
  );
  expect(
    (await fetch(`${base}/api/recordings/dense-recording/channel-overview?limit=2`)).status,
  ).toBe(400);
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

test('a full playback preview does not reserve space for observations it no longer retains', async ({
  page,
}) => {
  await page.goto(`${base}/recordings?id=dense-recording`);
  const allChannelPanel = page.getByTestId('playback-all-channel-panel');
  expect(
    await allChannelPanel.evaluate((panel) => panel.parentElement?.lastElementChild === panel),
  ).toBe(true);
  await expect(page.getByRole('img', { name: 'All recorded channel overview' })).toBeVisible();
  await expect(
    page.getByTestId('playback-all-channel-lanes').locator('[data-channel]'),
  ).toHaveCount(32);
  await expect(page.getByTestId('playback-all-channel-canvas')).toHaveCount(1);
  await expect(
    page.getByTestId('playback-all-channel-labels').locator('[data-channel-label]'),
  ).toHaveCount(32);
  await expect(page.getByTestId('playback-all-channel-context')).toContainText(
    'Normalized amplitude per lane',
  );
  await expect(page.getByTestId('playback-all-channel-context')).toContainText(
    'Shared original-frame and elapsed-time domain',
  );
  if (process.env.SCOPE_CAPTURE_ALL_CHANNEL_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'all-channels-playback-desktop.png'),
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId('playback-chart-channels')).toContainText('Ch 0–Ch 3');
  await page.getByRole('button', { name: 'Next trace group' }).click();
  await expect(page.getByTestId('playback-chart-channels')).toContainText('Ch 4–Ch 7');
  await expect
    .poll(async () => (await (await fetch(`${base}/api/playback`)).json()).preview.channels)
    .toEqual([4, 5, 6, 7]);
  await page.getByRole('button', { name: 'Previous trace group' }).click();
  await expect(page.getByTestId('playback-chart-channels')).toContainText('Ch 0–Ch 3');
  await page.getByRole('checkbox', { name: 'Ch 31', exact: true }).click();
  await expect(
    page.getByTestId('playback-all-channel-lanes').locator('[data-channel]'),
  ).toHaveCount(32);
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="playback-all-channel-canvas"]');
    window.__allChannelCanvasSizeMutations = 0;
    new MutationObserver((mutations) => {
      window.__allChannelCanvasSizeMutations += mutations.length;
    }).observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Ended', { timeout: 5000 });
  expect(await page.evaluate(() => window.__allChannelCanvasSizeMutations)).toBe(0);

  const snapshot = await (await fetch(`${base}/api/playback`)).json();
  expect(snapshot.preview.observations).toHaveLength(snapshot.preview.capacity);
  const firstRetained = snapshot.preview.observations[0].index;
  await expect(page.getByTestId('playback-visible-window')).toHaveText(
    `Visible window: frames ${firstRetained.toLocaleString('en-US')}-799`,
  );
  await expect(page.getByTestId('playback-trace').locator('.uplot')).toHaveCount(1);
  if (process.env.SCOPE_CAPTURE_PLAYBACK_WINDOW_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'playback-retained-window.png'),
      fullPage: true,
    });

  const timeline = page.getByTestId('playback-timeline');
  const timelineBox = await timeline.boundingBox();
  expect(timelineBox).not.toBeNull();
  const initialPosition = (await (await fetch(`${base}/api/playback`)).json()).position;
  await page.mouse.move(
    timelineBox.x + timelineBox.width * 0.25,
    timelineBox.y + timelineBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    timelineBox.x + timelineBox.width * 0.65,
    timelineBox.y + timelineBox.height / 2,
    {
      steps: 5,
    },
  );
  await expect
    .poll(async () => (await (await fetch(`${base}/api/playback`)).json()).position)
    .not.toBe(initialPosition);
  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  await expect(page.getByTestId('playback-latest-frame')).not.toContainText('Not available');
  expect(
    (await (await fetch(`${base}/api/playback`)).json()).preview.observations.length,
  ).toBeGreaterThan(0);
  await page.mouse.up();

  await page.goto(`${base}/recordings?id=empty-recording`);
  await expect(page.getByTestId('playback-all-channel-context')).toContainText(
    'No recorded frames; exclusive extent 0.',
  );
});

test('rapid timeline scrubbing serializes seeks and commits the newest position', async ({
  page,
}) => {
  let activeSeeks = 0;
  let maximumActiveSeeks = 0;
  let observedSeeks = 0;
  await page.route(`${base}/api/playback`, async (route) => {
    const request = route.request();
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    if (body?.action !== 'seek') return route.continue();
    activeSeeks++;
    observedSeeks++;
    maximumActiveSeeks = Math.max(maximumActiveSeeks, activeSeeks);
    if (observedSeeks === 1) await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const response = await route.fetch();
      await route.fulfill({ response });
    } finally {
      activeSeeks--;
    }
  });

  await page.goto(`${base}/recordings?id=control-recording`);
  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  const timeline = page.getByTestId('playback-timeline');
  const input = async (position) =>
    timeline.evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, String(value));
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, position);

  await input(5);
  await page.waitForTimeout(80);
  await input(15);
  await page.waitForTimeout(80);
  await input(35);
  await expect
    .poll(async () => (await (await fetch(`${base}/api/playback`)).json()).position)
    .toBe(35);
  expect(observedSeeks).toBeGreaterThanOrEqual(2);
  expect(maximumActiveSeeks).toBe(1);
  await page.getByRole('button', { name: 'Restart' }).click();
  await expect
    .poll(async () => (await (await fetch(`${base}/api/playback`)).json()).position)
    .toBe(0);
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
