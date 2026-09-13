import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('capture, reload, stop, and inspect a real recording', async ({ page, request }) => {
  await page.goto('/');
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
  await expect(page.getByText('Integrity not yet verified')).toBeVisible();
  await page.getByRole('button', { name: 'Inspect recording' }).click();
  await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible();
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
  await expect(page.getByRole('img', { name: 'Live acquired signal trace' })).toBeVisible();
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
    await expect(observer.getByRole('img', { name: 'Live acquired signal trace' })).toBeVisible();
    const secondSession = await observer
      .locator('[data-browser-session]')
      .getAttribute('data-browser-session');
    await observer.getByLabel('Ch 0').click();
    await expect(observer.getByText('Show at most four live preview channels at once')).toHaveCount(
      0,
    );
    await expect(page.getByText(/Channel 0:/)).toBeVisible();
    await expect(observer.getByText(/Channel 1:/)).toBeVisible();
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
  await page.goto(`/recordings?id=${id}`);
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
