import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('capture, reload, stop, and inspect a real recording', async ({ page, request }) => {
  await page.goto('/');
  expect((await request.get('/api/diagnostics/observers')).status()).toBe(404);
  expect((await request.get('/api/state?clientId=missing-session')).status()).toBe(404);
  expect((await request.get('/api/events?clientId=invalid-session&channels=0,0')).status()).toBe(
    400,
  );
  await expect(page.getByRole('button', { name: 'Start acquisition' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start acquisition' }).click();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  await expect
    .poll(async () =>
      Number((await page.getByTestId('recorded-samples').innerText()).replaceAll(',', '')),
    )
    .toBeGreaterThan(0);
  const id = await page.getByTestId('recording-id').innerText();
  await page.reload();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  await expect(page.getByTestId('recording-id')).toHaveText(id);
  await page.getByRole('button', { name: 'Stop acquisition' }).click();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  await expect(page.getByRole('heading', { name: 'Recording saved' })).toBeVisible();
  await expect(page.getByText('Integrity not verified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect recording' }).click();
  await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible();
  await expect(page.getByTestId('live-all-channel-panel')).toHaveCount(1);
  await expect(page.getByTestId('playback-all-channel-panel')).toHaveCount(0);
  await expect(page.getByTestId('format')).toHaveText('SCOPE/1');
  await expect(page.getByTestId('expected-frames')).toHaveText(
    await page.getByTestId('saved-frames').innerText(),
  );
});

test('independent observing tabs keep bounded session previews while acquisition continues', async ({
  page,
  browser,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start acquisition' }).click();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  await expect(page.getByRole('img', { name: 'Live rolling signal detail' })).toBeVisible();
  const firstSession = await page
    .locator('[data-browser-session]')
    .getAttribute('data-browser-session');
  await expect
    .poll(async () => {
      const state = await (await request.get(`/api/state?clientId=${firstSession}`)).json();
      return state.preview?.buckets.length || 0;
    })
    .toBeGreaterThan(0);
  const firstPreview = await (await request.get(`/api/state?clientId=${firstSession}`)).json();
  expect(firstPreview.preview.channels).toEqual([0, 1, 2, 3]);
  expect(firstPreview.preview.buckets.length).toBeLessThanOrEqual(256);
  expect(firstPreview.preview.buckets.every((bucket) => bucket.minimum.length === 4)).toBe(true);
  expect(
    firstPreview.preview.buckets.every(
      (bucket) => bucket.end <= firstPreview.metrics.recordedFrames,
    ),
  ).toBe(true);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const observer = await context.newPage();
  try {
    await observer.goto('/');
    await expect(observer.getByRole('img', { name: 'Live rolling signal detail' })).toBeVisible();
    const secondSession = await observer
      .locator('[data-browser-session]')
      .getAttribute('data-browser-session');
    await observer.getByLabel('Ch 0').click();
    await expect(observer.getByText('Show at most four live preview channels at once')).toHaveCount(
      0,
    );
    await expect(page.getByText(/Channel 0:/).first()).toBeVisible();
    await expect(observer.getByText(/Channel 1:/).first()).toBeVisible();
    await expect
      .poll(async () => {
        const state = await (await request.get(`/api/state?clientId=${secondSession}`)).json();
        return state.preview?.channels.join(',');
      })
      .toBe('1,2,3');
    expect(
      (await (await request.get(`/api/state?clientId=${firstSession}`)).json()).preview.channels,
    ).toEqual([0, 1, 2, 3]);
    const id = await page.getByTestId('recording-id').innerText();
    const invalid = await request.post(`/api/acquisitions/${id}/preview`, {
      data: { channels: [0] },
    });
    expect(invalid.status()).toBe(400);
    await context.close();
    await expect
      .poll(async () =>
        Number((await page.getByTestId('recorded-samples').innerText()).replaceAll(',', '')),
      )
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Stop acquisition' }).click();
    await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  } finally {
    await context.close().catch(() => {});
  }
});

test('active all-channel overview requires prefix acknowledgement and stays bounded', async ({
  page,
  request,
}) => {
  await page.route('**/channel-overview*', async (route) => {
    if (!route.request().url().includes('prefix=true'))
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Final overview temporarily unavailable' }),
      });
    await new Promise((resolve) => setTimeout(resolve, 700));
    return route.continue();
  });
  await page.goto('/');
  const started = await (
    await request.post('/api/acquisitions', {
      data: { channels: 32, sampleRate: 1000, seconds: 2, displayName: 'All channels' },
    })
  ).json();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  expect((await request.get(`/api/recordings/${started.id}/channel-overview`)).status()).toBe(400);
  const response = await request.get(`/api/recordings/${started.id}/channel-overview?prefix=true`);
  expect(response.status()).toBe(200);
  const overview = await response.json();
  expect(overview.channels).toEqual(Array.from({ length: 32 }, (_, channel) => channel));
  expect(overview.observations.length * overview.channels.length).toBeLessThanOrEqual(2048);
  expect(overview.observations.at(-1).index).toBeLessThan(overview.confirmedFrames);
  const allChannelPanel = page.getByTestId('live-all-channel-panel');
  const [wholeAcquisitionBox, allChannelPanelBox] = await Promise.all([
    page.getByTestId('live-overview-trace').boundingBox(),
    allChannelPanel.boundingBox(),
  ]);
  expect(wholeAcquisitionBox).not.toBeNull();
  expect(allChannelPanelBox).not.toBeNull();
  expect(allChannelPanelBox.y).toBeGreaterThan(wholeAcquisitionBox.y + wholeAcquisitionBox.height);
  await expect(page.getByRole('img', { name: 'All configured channel overview' })).toBeVisible();
  await expect(page.getByTestId('live-all-channel-context')).toContainText(
    'Normalized amplitude per lane',
  );
  await expect(page.getByTestId('live-all-channel-lanes').locator('[data-channel]')).toHaveCount(
    32,
  );
  await expect(
    page.getByTestId('live-all-channel-labels').locator('[data-channel-label]'),
  ).toHaveCount(32);
  await expect(
    page.getByTestId('live-all-channel-labels').locator('[data-channel-label]').first(),
  ).toHaveText('Ch 00');
  await expect(
    page.getByTestId('live-all-channel-labels').locator('[data-channel-label]').last(),
  ).toHaveText('Ch 31');
  await expect(page.getByTestId('live-all-channel-canvas')).toHaveCount(1);
  if (process.env.SCOPE_CAPTURE_ALL_CHANNEL_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'all-channels-live-desktop.png'),
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(
    await page.getByTestId('live-all-channel-labels').evaluate((labels) => {
      const bounds = labels.getBoundingClientRect();
      return [...labels.querySelectorAll('[data-channel-label]')].every((label) => {
        const box = label.getBoundingClientRect();
        return box.left >= bounds.left && box.right <= bounds.right;
      });
    }),
  ).toBe(true);
  if (process.env.SCOPE_CAPTURE_ALL_CHANNEL_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'all-channels-live-mobile.png'),
      fullPage: true,
    });
  await page.setViewportSize({ width: 1280, height: 720 });
  const session = await page.locator('[data-browser-session]').getAttribute('data-browser-session');
  await expect
    .poll(async () => {
      const state = await (await request.get(`/api/state?clientId=${session}`)).json();
      return state.preview?.channels;
    })
    .toEqual([0, 1, 2, 3]);
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed', { timeout: 5000 });
  await expect(page.getByText(/persisted all-channel overview may be stale/i)).toBeVisible();
  await expect(page.getByRole('img', { name: 'All configured channel overview' })).toBeVisible();
  const inspection = await (await request.get(`/api/acquisitions/${started.id}`)).json();
  expect(inspection.recordedFrames).toBe(inspection.expectedFrames);
  expect(inspection.droppedFrames).toBe(0);
});

test('live trace preserves selected channels and marks a preview gap across reconnect', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/');
  const started = await (
    await request.post('/api/acquisitions', {
      data: { channels: 4, sampleRate: 1000, seconds: 4, displayName: 'Reconnect continuity' },
    })
  ).json();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  const session = await page.locator('[data-browser-session]').getAttribute('data-browser-session');
  await page.getByLabel('Ch 0').click();
  await expect
    .poll(async () => {
      const state = await (await request.get(`/api/state?clientId=${session}`)).json();
      return state.preview?.channels.join(',');
    })
    .toBe('1,2,3');
  await expect(page.getByRole('img', { name: 'Live rolling signal detail' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Whole acquisition signal overview' })).toBeVisible();
  await expect(page.getByTestId('live-rolling-latest-frame')).not.toContainText('Not available');
  const latestBefore = Number(
    (await page.getByTestId('live-rolling-latest-frame').innerText()).replaceAll(/\D/g, ''),
  );
  const gapsBefore = Number(
    await page.getByTestId('live-preview-gaps').getAttribute('data-preview-gap-count'),
  );
  const stateBefore = await (await request.get('/api/state')).json();

  await context.setOffline(true);
  await expect(page.getByText('Connection unavailable.')).toBeVisible();
  await expect(page.getByTestId('live-rolling-latest-frame')).not.toContainText('Not available');
  await new Promise((resolve) => setTimeout(resolve, 650));
  const stateWhileOffline = await (await request.get('/api/state')).json();
  expect(stateWhileOffline.metrics.recordedFrames).toBeGreaterThan(
    stateBefore.metrics.recordedFrames,
  );

  await context.setOffline(false);
  await expect(page.getByText('Local connection')).toBeVisible({ timeout: 10000 });
  await expect
    .poll(async () => {
      const state = await (await request.get(`/api/state?clientId=${session}`)).json();
      return state.preview?.channels.join(',');
    })
    .toBe('1,2,3');
  await expect(page.getByTestId('live-rolling-latest-frame')).not.toHaveText(
    `Latest original frame: ${latestBefore}`,
  );
  await expect(page.getByTestId('live-preview-gaps')).toContainText('Preview not observed');
  await expect
    .poll(async () =>
      Number(await page.getByTestId('live-preview-gaps').getAttribute('data-preview-gap-count')),
    )
    .toBeGreaterThan(gapsBefore);
  await expect(page.getByTestId('live-overview-visible-window')).toContainText('frames 0-');
  await expect(page.getByTestId('live-rolling-trace').locator('.uplot')).toHaveCount(1);
  await expect(page.getByTestId('live-overview-trace').locator('.uplot')).toHaveCount(1);
  if (process.env.SCOPE_CAPTURE_RECONNECT_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'reconnect-desktop.png'),
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('checkbox', { name: 'Ch 1', exact: true }).focus();
  await expect(page.getByRole('checkbox', { name: 'Ch 1', exact: true })).toBeFocused();
  await expect(page.getByRole('img', { name: 'Live rolling signal detail' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Whole acquisition signal overview' })).toBeVisible();
  if (process.env.SCOPE_CAPTURE_RECONNECT_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'reconnect-mobile.png'),
      fullPage: true,
    });

  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed', { timeout: 10000 });
  const inspection = await (await request.get(`/api/acquisitions/${started.id}`)).json();
  expect(inspection.recordedFrames).toBe(inspection.expectedFrames);
  expect(inspection.droppedFrames).toBe(0);
  await expect(page.getByTestId('live-overview-visible-window')).toHaveText(
    `Visible window: frames 0-${(inspection.recordedFrames - 1).toLocaleString('en-US')}`,
  );
  const rollingWindow = await page.getByTestId('live-rolling-visible-window').innerText();
  const rollingBounds = rollingWindow.match(/frames ([\d,]+)-([\d,]+)/);
  expect(rollingBounds).not.toBeNull();
  const rollingStart = Number(rollingBounds[1].replaceAll(',', ''));
  const rollingEnd = Number(rollingBounds[2].replaceAll(',', ''));
  expect(rollingEnd - rollingStart).toBe(inspection.sampleRate * 2 - 1);

  const overviewScroll = page.getByTestId('live-overview-scroll');
  await expect(overviewScroll).toBeVisible();
  expect(
    await overviewScroll.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await overviewScroll.focus();
  await expect(overviewScroll).toBeFocused();
  await overviewScroll.press('End');
  await expect
    .poll(() => overviewScroll.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
});

test('reloaded acquisition shows its full confirmed extent and an honest unavailable prefix', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await request.post('/api/acquisitions', {
    data: { channels: 4, sampleRate: 1000, seconds: 3, displayName: 'Reloaded overview' },
  });
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  await expect
    .poll(async () => (await (await request.get('/api/state')).json()).metrics?.recordedFrames ?? 0)
    .toBeGreaterThan(400);

  await page.reload();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  await expect(page.getByRole('img', { name: 'Whole acquisition signal overview' })).toBeVisible();
  await expect(page.getByTestId('live-overview-visible-window')).toContainText('frames 0-');
  await expect
    .poll(async () =>
      Number(await page.getByTestId('live-preview-gaps').getAttribute('data-preview-gap-count')),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('live-preview-gaps')).toContainText('Preview not observed');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed', { timeout: 10000 });
});

test('whole-acquisition scrolling follows latest until the user inspects history', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const start = await request.post('/api/acquisitions', {
    data: { channels: 4, sampleRate: 1000, seconds: 6, displayName: 'Latest follow' },
  });
  const acquisition = await start.json();
  try {
    await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
    const scroll = page.getByTestId('live-overview-scroll');
    await expect
      .poll(() =>
        scroll.evaluate((element) => ({
          client: element.clientWidth,
          width: element.scrollWidth,
        })),
      )
      .toMatchObject({ width: expect.any(Number) });
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
    await expect
      .poll(() =>
        scroll.evaluate(
          (element) =>
            Math.abs(element.scrollLeft - (element.scrollWidth - element.clientWidth)) < 3,
        ),
      )
      .toBe(true);

    await scroll.focus();
    await scroll.press('Home');
    await expect(page.getByRole('button', { name: 'Jump to latest data' })).toBeVisible();
    await page.waitForTimeout(700);
    expect(await scroll.evaluate((element) => element.scrollLeft)).toBe(0);

    await scroll.press('End');
    await expect
      .poll(() =>
        scroll.evaluate(
          (element) =>
            Math.abs(element.scrollLeft - (element.scrollWidth - element.clientWidth)) < 3,
        ),
      )
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Jump to latest data' })).toHaveCount(0);
    await scroll.press('ArrowLeft');
    await expect(page.getByRole('button', { name: 'Jump to latest data' })).toBeVisible();
    await page.getByRole('button', { name: 'Jump to latest data' }).click();
    await expect(page.getByRole('button', { name: 'Jump to latest data' })).toHaveCount(0);

    const gapText = page.getByTestId('live-preview-gaps');
    const channelPanel = page.getByTestId('live-chart-channel-panel');
    const [gapBox, panelBox] = await Promise.all([
      gapText.boundingBox(),
      channelPanel.boundingBox(),
    ]);
    expect(gapBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox.y - (gapBox.y + gapBox.height)).toBeGreaterThanOrEqual(24);
    await page.getByRole('button', { name: 'Stop acquisition' }).click();
    await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
    await scroll.focus();
    await scroll.press('Home');
    await expect(page.getByRole('button', { name: 'Jump to latest data' })).toBeVisible();
    await request.post('/api/acquisitions', {
      data: { channels: 4, sampleRate: 1000, seconds: 1, displayName: 'Follow reset' },
    });
    await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
    await expect(page.getByRole('button', { name: 'Jump to latest data' })).toHaveCount(0);
    await expect(page.getByTestId('acquisition-state')).toHaveText('Completed', { timeout: 5000 });
  } finally {
    await request.post(`/api/acquisitions/${acquisition.id}/stop`).catch(() => undefined);
  }
});

test('live chart channel paging reaches every configured channel without widening preview payloads', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await request.post('/api/acquisitions', {
    data: { channels: 8, sampleRate: 100, seconds: 1, displayName: 'Channel paging' },
  });
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  const session = await page.locator('[data-browser-session]').getAttribute('data-browser-session');
  await expect(page.getByTestId('live-chart-channels')).toContainText('Ch 0–Ch 3');

  await page.getByRole('button', { name: 'Next trace group' }).click();
  await expect(page.getByTestId('live-chart-channels')).toContainText('Ch 4–Ch 7');
  await expect
    .poll(async () => {
      const snapshot = await (await request.get(`/api/state?clientId=${session}`)).json();
      return snapshot.preview?.channels;
    })
    .toEqual([4, 5, 6, 7]);

  await page.getByRole('button', { name: 'Previous trace group' }).click();
  await expect(page.getByTestId('live-chart-channels')).toContainText('Ch 0–Ch 3');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed', { timeout: 5000 });
});

test('evidence mode exposes bounded observer diagnostics and cleans up a disconnected reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scope-observer-diagnostics-'));
  const server = spawn(process.execPath, ['server.ts'], {
    env: {
      ...process.env,
      PORT: '3108',
      SCOPE_RECORDINGS_DIR: root,
      SCOPE_EVIDENCE_MODE: '1',
    },
    stdio: 'ignore',
  });
  const closed = once(server, 'close');
  let request;
  try {
    await expect
      .poll(async () => {
        try {
          return (await fetch('http://127.0.0.1:3108/api/diagnostics/observers')).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
    request = http.get(
      'http://127.0.0.1:3108/api/events?clientId=stalled-test&channels=0,1,2,3',
      (response) => response.pause(),
    );
    await fetch('http://127.0.0.1:3108/api/acquisitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: 1 }),
    });
    await expect
      .poll(async () => (await fetch('http://127.0.0.1:3108/api/diagnostics/observers')).json(), {
        timeout: 3000,
      })
      .toMatchObject({ activeClients: 1 });
    const diagnostics = await (
      await fetch('http://127.0.0.1:3108/api/diagnostics/observers')
    ).json();
    expect(diagnostics.limits).toMatchObject({
      clients: 8,
      clientBufferBytes: 65536,
      drainMs: 2000,
    });
    expect(diagnostics.maxWritableLengthBytes).toBeLessThanOrEqual(65536);
    request.destroy();
    request = undefined;
    await expect
      .poll(async () => (await fetch('http://127.0.0.1:3108/api/diagnostics/observers')).json(), {
        timeout: 2500,
      })
      .toMatchObject({ activeClients: 0 });

    // A browser can tear down an EventSource as soon as its response headers arrive.
    // Repeating that boundary must not leave observer slots occupied by closed sockets.
    await Promise.all(
      Array.from(
        { length: 24 },
        (_, index) =>
          new Promise((resolve) => {
            const socket = net.createConnection(3108, '127.0.0.1', () => {
              socket.write(
                `GET /api/events?clientId=short-lived-${index}&channels=0,1,2,3 HTTP/1.1\r\nHost: 127.0.0.1:3108\r\nConnection: close\r\n\r\n`,
                () => socket.destroy(),
              );
            });
            socket.on('close', resolve);
            socket.on('error', resolve);
          }),
      ),
    );
    await expect
      .poll(async () => (await fetch('http://127.0.0.1:3108/api/diagnostics/observers')).json(), {
        timeout: 2500,
      })
      .toMatchObject({ activeClients: 0 });
    expect(
      (await fetch('http://127.0.0.1:3108/api/events?clientId=after-churn&channels=0,1,2,3'))
        .status,
    ).toBe(200);
  } finally {
    request?.destroy();
    server.kill('SIGTERM');
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});

test('a startup failure is visible and leaves the controls recoverable', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-browser-failure-'));
  const blockedRoot = join(root, 'not-a-directory');
  await writeFile(blockedRoot, 'This fixture prevents recording-directory creation.');
  const server = spawn(process.execPath, ['server.ts'], {
    env: { ...process.env, PORT: '3101', SCOPE_RECORDINGS_DIR: blockedRoot },
    stdio: 'ignore',
  });
  const closed = once(server, 'close');
  try {
    await expect
      .poll(async () => {
        try {
          return (await fetch('http://127.0.0.1:3101/api/state')).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto('http://127.0.0.1:3101');
    await page.getByRole('button', { name: 'Start acquisition' }).click();
    await expect(page.getByTestId('acquisition-state')).toHaveText('Failed');
    await expect(page.getByRole('alert').filter({ hasText: 'Acquisition notice' })).toContainText(
      /ENOTDIR|EEXIST/,
    );
    await expect(page.getByRole('button', { name: 'Start acquisition' })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Recording saved' })).toHaveCount(0);
  } finally {
    server.kill('SIGTERM');
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent starts and rapid repeated stops preserve a single acquisition', async ({
  page,
}) => {
  await page.goto('/');
  const starts = await page.evaluate(async () =>
    Promise.all(
      [1, 2].map(async () => {
        const response = await fetch('/api/acquisitions', { method: 'POST' });
        return { status: response.status, body: await response.json() };
      }),
    ),
  );
  expect(starts.map((r) => r.status).sort()).toEqual([202, 409]);
  const id = starts.find((r) => r.status === 202).body.id;
  const stops = await page.evaluate(
    async (id) =>
      Promise.all(
        [1, 2].map(async () => {
          const response = await fetch(`/api/acquisitions/${id}/stop`, { method: 'POST' });
          return response.status;
        }),
      ),
    id,
  );
  expect(stops).toEqual([202, 202]);
  await expect(page.getByTestId('recording-id')).toHaveText(id);
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  const metadata = await page.evaluate(
    async (id) => (await fetch(`/api/acquisitions/${id}`)).json(),
    id,
  );
  expect(metadata.recordedFrames).toBe(metadata.expectedFrames);
  expect(metadata.trailingBytes).toBe(0);
});

test('mobile capture controls remain in reach and work with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Start acquisition' });
  const stop = page.getByRole('button', { name: 'Stop acquisition' });
  await expect(start).toBeEnabled();
  const bounds = await start.boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await start.focus();
  await expect(start).toBeFocused();
  await start.press('Enter');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  const stopBounds = await stop.boundingBox();
  expect(stopBounds.y + stopBounds.height).toBeLessThanOrEqual(844);
  await stop.focus();
  await stop.press('Enter');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('Stop times out a suspended recorder, preserves its prefix, and releases ownership', async ({
  page,
  request,
}) => {
  const started = await request.post('/api/acquisitions');
  const { id } = await started.json();
  let state;
  await expect
    .poll(async () => {
      state = await (await request.get('/api/state')).json();
      return state.status;
    })
    .toBe('recording');
  const pids = state.metadata.processes;
  try {
    process.kill(pids.recorder, 'SIGSTOP');
    await request.post(`/api/acquisitions/${id}/stop`);
    await request.post(`/api/acquisitions/${id}/stop`);
    expect((await request.post('/api/acquisitions')).status()).toBe(409);
    await page.goto('/');
    await expect(page.getByTestId('acquisition-state')).toHaveText('Stopping');
    await expect(page.getByTestId('acquisition-state')).toHaveText('Failed', { timeout: 12000 });
    await expect(page.getByRole('alert').filter({ hasText: 'Acquisition notice' })).toContainText(
      '10-second',
    );
    await expect(page.getByRole('button', { name: 'Start acquisition' })).toBeEnabled();
    const saved = await (await request.get(`/api/acquisitions/${id}`)).json();
    expect(saved.status).toBe('failed');
    expect(saved.expectedFrames).toBeNull();
    expect(saved.warnings.join(' ')).toContain('completeness are unknown');
    await expect
      .poll(() =>
        Object.values(pids).every((pid) => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        }),
      )
      .toBe(true);
  } finally {
    for (const pid of Object.values(pids)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
});

test('timed capture stays stopping while accepted writes drain', async ({ page, request }) => {
  await request.post('/api/acquisitions', { data: { seconds: 0.1, writeDelayMs: 200 } });
  await page.goto('/');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Stopping');
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t14/desktop-stopping.png'),
      fullPage: true,
    });
  expect((await request.post('/api/acquisitions')).status()).toBe(409);
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  const state = await (await request.get('/api/state')).json();
  expect(state.metadata.expectedFrames).toBe(400);
  expect(state.metadata.recordedFrames).toBe(400);
});

test('a failed capture retains its actionable cause in saved inspection', async ({
  page,
  request,
}) => {
  const { id } = await (await request.post('/api/acquisitions')).json();
  let state;
  await expect
    .poll(async () => {
      state = await (await request.get('/api/state')).json();
      return state.metrics?.recordedFrames || 0;
    })
    .toBeGreaterThan(0);
  process.kill(state.metadata.processes.generator, 'SIGKILL');
  await page.goto('/');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Failed');
  await expect(page.getByRole('button', { name: 'Inspect readable recording' })).toBeVisible();
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t14/desktop-failed.png'),
      fullPage: true,
    });
  await page.getByRole('link', { name: 'Open in Recordings' }).click();
  await expect(page).toHaveURL(new RegExp(`/recordings\\?id=${id}$`));
  await expect(page.getByTestId('inspection-failure')).toContainText(
    'Generator exited unexpectedly',
  );
  await expect(page.getByTestId('recording-duration')).toHaveText('Unknown');
  await expect(page.getByText('Integrity not verified', { exact: true })).toBeVisible();
});

test('application SIGTERM drains an active capture and closes both children', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scope-server-stop-'));
  const base = 'http://127.0.0.1:3104';
  const server = spawn(process.execPath, ['server.ts'], {
    env: { ...process.env, PORT: '3104', SCOPE_RECORDINGS_DIR: root },
    stdio: 'ignore',
  });
  const closed = once(server, 'close');
  let state;
  try {
    await expect
      .poll(async () => {
        try {
          return (await fetch(`${base}/api/state`)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await fetch(`${base}/api/acquisitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channels: 1, sampleRate: 20, writeDelayMs: 100 }),
    });
    await expect
      .poll(async () => {
        state = await (await fetch(`${base}/api/state`)).json();
        return state.metrics?.recordedFrames || 0;
      })
      .toBeGreaterThan(0);
    server.kill('SIGTERM');
    server.kill('SIGTERM');
    expect((await closed)[0]).toBe(0);
    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse(await readFile(join(root, state.id, 'metadata.json'), 'utf8'));
    expect(saved.status).toBe('completed');
    expect(saved.recordedFrames).toBe(saved.expectedFrames);
    for (const pid of Object.values(saved.processes)) expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    for (const pid of Object.values(state?.metadata?.processes || {})) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});
