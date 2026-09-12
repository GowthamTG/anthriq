import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('capture, reload, stop, and inspect a real recording', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start acquisition' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start acquisition' }).click();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  await expect.poll(async () => Number((await page.getByTestId('recorded-samples').innerText()).replaceAll(',', ''))).toBeGreaterThan(0);
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
  await expect(page.getByTestId('expected-frames')).toHaveText(await page.getByTestId('saved-frames').innerText());
});

test('a startup failure is visible and leaves the controls recoverable', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-browser-failure-'));
  const blockedRoot = join(root, 'not-a-directory');
  await writeFile(blockedRoot, 'This fixture prevents recording-directory creation.');
  const server = spawn(process.execPath, ['server.ts'], { env: { ...process.env, PORT: '3101', SCOPE_RECORDINGS_DIR: blockedRoot }, stdio: 'ignore' });
  const closed = once(server, 'close');
  try {
    await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:3101/api/state')).status; } catch { return 0; } }).toBe(200);
    await page.goto('http://127.0.0.1:3101');
    await page.getByRole('button', { name: 'Start acquisition' }).click();
    await expect(page.getByTestId('acquisition-state')).toHaveText('Failed');
    await expect(page.getByRole('alert').filter({ hasText: 'Acquisition notice' })).toContainText(/ENOTDIR|EEXIST/);
    await expect(page.getByRole('button', { name: 'Start acquisition' })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Recording saved' })).toHaveCount(0);
  } finally {
    server.kill('SIGTERM');
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent starts and rapid repeated stops preserve a single acquisition', async ({ page }) => {
  await page.goto('/');
  const starts = await page.evaluate(async () => Promise.all([1, 2].map(async () => {
    const response = await fetch('/api/acquisitions', { method: 'POST' });
    return { status: response.status, body: await response.json() };
  })));
  expect(starts.map(r => r.status).sort()).toEqual([202, 409]);
  const id = starts.find(r => r.status === 202).body.id;
  const stops = await page.evaluate(async id => Promise.all([1, 2].map(async () => {
    const response = await fetch(`/api/acquisitions/${id}/stop`, { method: 'POST' });
    return response.status;
  })), id);
  expect(stops).toEqual([202, 202]);
  await expect(page.getByTestId('recording-id')).toHaveText(id);
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  const metadata = await page.evaluate(async id => (await fetch(`/api/acquisitions/${id}`)).json(), id);
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
