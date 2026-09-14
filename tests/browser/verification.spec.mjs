import { test, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { appendFile, chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const base = 'http://127.0.0.1:3103';
let root, server, closed, clean, damaged, unreadable;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scope-verification-browser-'));
  clean = join(root, 'clean-recording');
  damaged = join(root, 'damaged-recording');
  unreadable = join(root, 'unreadable-recording');
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    clean,
    '--seconds',
    '0.05',
    '--display-name',
    'Clean reference',
  ]);
  await execute(process.execPath, ['core/cli.ts', 'verify', clean]);
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    damaged,
    '--seconds',
    '0.05',
    '--display-name',
    'Damaged reference',
  ]);
  await appendFile(join(damaged, 'frames.bin'), Buffer.from([1, 2, 3]));
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    unreadable,
    '--seconds',
    '0.05',
    '--display-name',
    'Unreadable reference',
  ]);
  await chmod(join(unreadable, 'frames.bin'), 0o000);
  server = spawn(process.execPath, ['server.ts'], {
    env: { ...process.env, PORT: '3103', SCOPE_RECORDINGS_DIR: root },
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
  await chmod(join(unreadable, 'frames.bin'), 0o600).catch(() => {});
  server?.kill('SIGTERM');
  await closed;
  await rm(root, { recursive: true, force: true });
});

test('verification uses a separate worker, rejects a concurrent job, and keeps the service responsive', async () => {
  const requests = [clean, damaged].map((directory) =>
    fetch(`${base}/api/verifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingId: directory.split('/').at(-1) }),
    }),
  );
  const responses = await Promise.all(requests);
  expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
  const accepted = responses.find((response) => response.status === 202);
  const state = await accepted.json();
  expect(state.workerPid).toBeGreaterThan(0);
  expect(state.workerPid).not.toBe(server.pid);
  expect((await fetch(`${base}/api/state`)).status).toBe(200);
  await expect
    .poll(async () => (await (await fetch(`${base}/api/verification`)).json()).status)
    .not.toBe('running');
});

test('Verify view shows a real PASS and offers its persisted machine report', async ({ page }) => {
  await page.goto(`${base}/verify?id=clean-recording`);
  await expect(page.getByRole('heading', { name: 'Trust, measured.' })).toBeVisible();
  await page.getByRole('button', { name: /Clean reference/ }).click();
  await page
    .getByRole('button', { name: /Start verification|Verify again|Run fresh verification/ })
    .click();
  await expect(page.getByTestId('verification-status')).toHaveText('Integrity verified');
  await expect(page.getByTestId('verification-report')).toContainText('FORMAT ERRORS');
  await expect(page.getByTestId('verification-report')).toContainText('0');
  if (process.env.SCOPE_CAPTURE_T06_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t06/verified.png'),
      fullPage: true,
    });
  const response = await page.request.get(`${base}/api/recordings/clean-recording/verification`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition']).toContain('clean-recording-verification.json');
  expect((await response.json()).result).toBe('PASS');
});

test('Verify view distinguishes integrity failure from an operational failure', async ({
  page,
}) => {
  await page.goto(`${base}/verify?id=damaged-recording`);
  await page.getByRole('button', { name: /Damaged reference/ }).click();
  await page
    .getByRole('button', { name: /Start verification|Verify again|Run fresh verification/ })
    .click();
  await expect(page.getByTestId('verification-status')).toHaveText('Integrity failed');
  await expect(page.getByTestId('verification-report')).toContainText('FORMAT ERRORS');
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t14/desktop-integrity-failed.png'),
      fullPage: true,
    });

  await page.getByRole('button', { name: /Unreadable reference/ }).click();
  await page
    .getByRole('button', { name: /Start verification|Verify again|Run fresh verification/ })
    .click();
  await expect(page.locator('.notice.error')).toContainText('Verification could not run');
  await expect(page.getByTestId('verification-status')).toHaveText('Operational failure');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  if (process.env.SCOPE_CAPTURE_T06_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t06/narrow-failure.png'),
      fullPage: true,
    });
});

test('scenario lab creates and verifies a combined disposable recording without changing its source', async ({
  page,
}) => {
  const sourceFiles = ['metadata.json', 'frames.bin', 'verification.json'];
  const before = await Promise.all(sourceFiles.map((name) => readFile(join(clean, name))));
  const invalid = await page.request.post(`${base}/api/verification-scenarios`, {
    data: { sourceRecordingId: 'clean-recording', scenario: 'unknown', extra: true },
  });
  expect(invalid.status()).toBe(400);
  await page.goto(`${base}/verify?id=clean-recording`);
  const lab = page.getByRole('region', { name: 'Integrity scenario lab' });
  for (const name of ['Clean', 'Missing', 'Duplicate', 'Incorrect', 'Combined']) {
    await expect(
      lab.getByRole('button', { name: new RegExp(`Create ${name} scenario`, 'i') }),
    ).toBeVisible();
  }
  await lab.getByRole('button', { name: /Create Combined scenario/i }).click();
  await expect(page.getByTestId('scenario-state')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('scenario-state')).toContainText(/Creating|Scanning/);
  await expect(page.getByTestId('verification-status')).toHaveText('Integrity failed');
  await expect(page.getByTestId('metric-missing')).toHaveText('96');
  await expect(page.getByTestId('metric-duplicated')).toHaveText('32');
  await expect(page.getByTestId('metric-incorrect')).toHaveText('2');
  await expect(page.getByTestId('first-missing')).toContainText('frame 0 · channel 0');
  await expect(page.getByTestId('first-duplicate')).toContainText(
    'frame 1 · channel 0 · physical 1',
  );
  await expect(page.getByTestId('first-incorrect')).toContainText(
    'frame 1 · channel 0 · physical 1',
  );
  await expect(page.getByTestId('diagnostic-provenance')).toContainText('COMBINED');
  await expect(page.getByTestId('diagnostic-provenance')).toContainText('clean-recording');

  const id = new URL(page.url()).searchParams.get('id');
  expect(id).toMatch(/^diagnostic-combined-/);
  const response = await page.request.get(`${base}/api/recordings/${id}/verification`);
  expect(response.status()).toBe(200);
  expect((await response.json()).discrepancies.missing.samples).toBe(96);
  expect(await Promise.all(sourceFiles.map((name) => readFile(join(clean, name))))).toEqual(before);

  if (process.env.SCOPE_CAPTURE_T07_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t07/combined.png'),
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  if (process.env.SCOPE_CAPTURE_T07_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t07/narrow-combined.png'),
      fullPage: true,
    });

  await page.goto(`${base}/recordings?id=${id}`);
  await expect(page.getByTestId('library-item').filter({ hasText: id })).toContainText(
    'Diagnostic / combined',
  );
  await expect(page.getByTestId('diagnostic-recording')).toContainText(
    'DISPOSABLE DIAGNOSTIC / COMBINED',
  );

  await page.goto(`${base}/verify?id=clean-recording`);
  const cleanAction = page.getByRole('button', { name: /Create Clean scenario/i });
  await expect(cleanAction).toBeEnabled();
  await rm(clean, { recursive: true, force: true });
  await cleanAction.click();
  await expect(page.getByTestId('scenario-state')).toContainText('Error');
});
