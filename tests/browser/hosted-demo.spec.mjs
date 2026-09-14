import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = 'http://127.0.0.1:3110';
let root;
let server;
let closed;
let recordingId;

test.describe.configure({ mode: 'serial' });

async function launch() {
  server = spawn(process.execPath, ['server.ts'], {
    env: {
      ...process.env,
      PORT: '3110',
      SCOPE_HOST: '0.0.0.0',
      SCOPE_DEMO_MODE: 'public',
      SCOPE_RECORDINGS_DIR: root,
    },
    stdio: 'ignore',
  });
  closed = once(server, 'close');
  await expect
    .poll(async () => {
      try {
        return (await fetch(`${base}/healthz`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scope-public-browser-'));
  await launch();
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  await closed;
  await rm(root, { recursive: true, force: true });
});

test('public mode completes the real capture and verification flow without leaking paths', async ({
  page,
  request,
}) => {
  expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ready: true });
  const runtime = await (await fetch(`${base}/api/runtime`)).json();
  expect(runtime).toMatchObject({ mode: 'public-demo', availability: 'best-effort-free-tier' });

  await page.goto(base);
  await expect(page.getByTestId('public-demo-banner')).toBeVisible();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('3');
  await expect(page.getByText('Overload diagnostics')).toHaveCount(0);
  await page.getByLabel('Recording name').fill('Hosted workflow');
  await page.getByLabel('Channels', { exact: true }).fill('4');
  await page.getByLabel('Sample rate', { exact: true }).fill('100');
  await page.getByLabel('Duration', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start acquisition' }).click();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed', { timeout: 10_000 });
  recordingId = await page.getByTestId('recording-id').innerText();

  const details = await (await fetch(`${base}/api/recordings/${recordingId}`)).json();
  expect(details.location).toBeUndefined();
  expect(JSON.stringify(details)).not.toContain(root);
  const missing = await (await fetch(`${base}/api/recordings/missing-recording`)).json();
  expect(missing).toEqual({ error: 'Recording not found' });
  expect(JSON.stringify(missing)).not.toContain(root);

  await page.goto(`${base}/verify?id=${recordingId}`);
  await expect(page.getByTestId('public-demo-verification-note')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Integrity scenario lab' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start verification' }).click();
  await expect(page.getByTestId('verification-status')).toHaveText('Integrity verified', {
    timeout: 10_000,
  });
  expect(
    (
      await request.post(`${base}/api/verification-scenarios`, {
        data: { sourceRecordingId: recordingId, scenario: 'clean' },
      })
    ).status(),
  ).toBe(403);
});

test('public validation rejects continuous and oversized acquisition requests', async ({
  request,
}) => {
  for (const data of [{ seconds: 0 }, { seconds: 3, channels: 33 }]) {
    const response = await request.post(`${base}/api/acquisitions`, { data });
    expect(response.status()).toBe(400);
    expect((await response.json()).fields).toBeTruthy();
  }
});

test('recordings survive a hosted service restart on the same persistent root', async ({
  request,
}) => {
  server.kill('SIGTERM');
  await closed;
  await launch();
  const response = await request.get(`${base}/api/recordings/${recordingId}`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ id: recordingId, status: 'completed' });
});
