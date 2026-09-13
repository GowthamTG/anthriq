import { test, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, truncate, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execute = promisify(execFile);
const base = 'http://127.0.0.1:3102';
let root, server, closed;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scope-library-browser-'));
  server = spawn(process.execPath, ['server.ts'], {
    env: { ...process.env, PORT: '3102', SCOPE_RECORDINGS_DIR: root },
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

test('empty library explains how to capture the first recording', async ({ page }) => {
  await page.goto(`${base}/recordings`);
  await expect(page.getByRole('heading', { name: 'No recordings yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a capture' })).toHaveAttribute('href', '/');
});

test('browse pages and inspect normal, incomplete, malformed, and missing recordings', async ({
  page,
}) => {
  const original = join(root, 'record-00');
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    original,
    '--seconds',
    '0.01',
    '--display-name',
    'Baseline',
  ]);
  const metadata = JSON.parse(await readFile(join(original, 'metadata.json'), 'utf8'));
  for (let i = 1; i <= 10; i++) {
    const id = `record-${String(i).padStart(2, '0')}`;
    const directory = join(root, id);
    await mkdir(directory);
    await copyFile(join(original, 'frames.bin'), join(directory, 'frames.bin'));
    await writeFile(
      join(directory, 'metadata.json'),
      JSON.stringify({ ...metadata, id, displayName: `Capture ${i}` }),
    );
  }
  const incomplete = join(root, 'record-01');
  await truncate(join(incomplete, 'frames.bin'), 2 * 136 + 3);
  await writeFile(
    join(incomplete, 'metadata.json'),
    JSON.stringify({
      ...metadata,
      id: 'record-01',
      displayName: 'Interrupted capture',
      status: 'failed',
      expectedFrames: null,
      duration: 88,
    }),
  );
  await writeFile(join(root, 'record-02', 'metadata.json'), '{invalid');
  await page.goto(`${base}/recordings`);
  await expect(page.getByTestId('library-item')).toHaveCount(10);
  await page.getByRole('button', { name: /Baseline/ }).click();
  await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible();
  await expect(page.getByTestId('physical-frames')).toHaveText('40');
  const itemBounds = await page.getByTestId('library-item').first().boundingBox();
  const detailBounds = await page.getByRole('heading', { name: 'Recording details' }).boundingBox();
  expect(itemBounds.x + itemBounds.width).toBeLessThan(detailBounds.x);
  await expect(page.getByText('Integrity not verified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Interrupted capture/ }).click();
  await expect(page.getByTestId('recording-duration')).toHaveText('Unknown');
  await expect(page.getByTestId('physical-frames')).toHaveText('2');
  await expect(page.getByTestId('trailing-bytes')).toHaveText('3');
  await expect(page.getByTestId('inspection-warnings')).toContainText('unconfirmed');
  await page.reload();
  await expect(page.getByTestId('saved-name')).toHaveText('Interrupted capture');
  await page.getByRole('button', { name: /record-02/ }).click();
  await expect(page.getByTestId('inspection-error')).toContainText('Invalid metadata JSON');
  await expect(page.getByRole('heading', { name: 'Recording details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await page.getByRole('button', { name: 'First page' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(10);
  await page.goto(`${base}/recordings?id=missing-recording`);
  await expect(page.getByTestId('inspection-error')).toContainText(/not found|ENOENT/i);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
