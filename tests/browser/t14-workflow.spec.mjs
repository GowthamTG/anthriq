import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = 'http://127.0.0.1:3104';
const evidence = join(process.cwd(), 'docs/evidence/t14');
let root;
let server;
let closed;
let recordingId;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scope-t14-browser-'));
  server = spawn(process.execPath, ['server.ts'], {
    env: { ...process.env, PORT: '3104', SCOPE_RECORDINGS_DIR: root },
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
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE) await mkdir(evidence, { recursive: true });
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  await closed;
  await rm(root, { recursive: true, force: true });
});

test('the complete reviewer workflow is keyboard-operable and keeps verification truth across views', async ({
  page,
}) => {
  await page.goto(`${base}/recordings`);
  await expect(page.getByRole('heading', { name: 'No recordings yet' })).toBeVisible();
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({ path: join(evidence, 'desktop-empty.png'), fullPage: true });

  await page.getByRole('link', { name: 'Acquire' }).click();
  await page.getByLabel('Recording name').fill('T14 complete workflow');
  await page.getByLabel('Channels').fill('4');
  await page.getByLabel('Sample rate').fill('400');
  await page.getByLabel('Duration').fill('0.8');
  const start = page.getByRole('button', { name: 'Start acquisition' });
  await start.focus();
  await start.press('Enter');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  await expect(page.getByRole('img', { name: 'Live rolling signal detail' })).toBeVisible();
  await expect
    .poll(async () =>
      Number((await page.getByTestId('recorded-samples').innerText()).replaceAll(',', '')),
    )
    .toBeGreaterThan(0);
  recordingId = await page.getByTestId('recording-id').innerText();
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({ path: join(evidence, 'desktop-recording.png'), fullPage: true });

  const stop = page.getByRole('button', { name: 'Stop acquisition' });
  await stop.focus();
  await stop.press('Enter');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  await expect(page.getByTestId('recording-verification-status')).toHaveText(
    'Integrity not verified',
  );
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({ path: join(evidence, 'desktop-completed.png'), fullPage: true });

  await page.getByRole('link', { name: 'Open in Recordings' }).click();
  await expect(page).toHaveURL(new RegExp(`/recordings\\?id=${recordingId}$`));
  await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible();
  await page.getByLabel('Range start').fill('0');
  await page.getByLabel('Range end').fill('10');
  await page.getByLabel('Channels', { exact: true }).fill('3,0');
  await page.getByRole('button', { name: 'Inspect exact range' }).click();
  await expect(page.getByTestId('range-result')).toContainText('channels 3, 0');
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  expect((await csvDownload).suggestedFilename()).toContain('.csv');

  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  const speed = page.getByRole('button', { name: '2×' });
  await speed.focus();
  await speed.press('Space');
  await expect(speed).toHaveAttribute('aria-pressed', 'true');
  const timeline = page.getByTestId('playback-timeline');
  await timeline.focus();
  await timeline.press('ArrowRight');
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0);
  const addedChannel = page.getByRole('checkbox', { name: 'Ch 1' });
  await expect(addedChannel).toBeEnabled();
  await expect(addedChannel).toBeChecked();
  await addedChannel.focus();
  await addedChannel.press('Space');
  await expect(addedChannel).not.toBeChecked();
  await expect(addedChannel).toBeEnabled();
  await addedChannel.focus();
  await addedChannel.press('Space');
  await expect(addedChannel).toBeChecked();
  const removedChannel = page.getByRole('checkbox', { name: 'Ch 0' });
  await expect(removedChannel).toBeEnabled();
  await removedChannel.focus();
  await removedChannel.press('Space');
  await expect(removedChannel).not.toBeChecked();
  const play = page.getByRole('button', { name: /Play|Resume/ });
  await play.focus();
  await play.press('Enter');
  await expect(page.getByTestId('playback-status')).toHaveText('Playing');
  const pause = page.getByRole('button', { name: 'Pause' });
  await pause.focus();
  await pause.press('Enter');
  await expect(page.getByTestId('playback-status')).toHaveText('Paused');
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({ path: join(evidence, 'desktop-populated.png'), fullPage: true });

  await page.getByRole('link', { name: 'Verify recording' }).click();
  await expect(page).toHaveURL(new RegExp(`/verify\\?id=${recordingId}$`));
  await expect(page.getByTestId('verification-status')).toHaveText('Not yet verified');
  await page.getByRole('button', { name: 'Start verification' }).click();
  await expect(page.getByTestId('verification-status')).toHaveText('Integrity verified');
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download JSON report' }).click();
  expect((await reportDownload).suggestedFilename()).toContain('verification.json');
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({ path: join(evidence, 'desktop-verified.png'), fullPage: true });

  await page.getByRole('link', { name: 'Acquire' }).click();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  await expect(page.getByTestId('recording-verification-status')).toHaveText('Integrity verified');
  await page.getByRole('link', { name: 'Verify recording' }).click();
  await expect(page.getByTestId('verification-status')).toHaveText('Integrity verified');

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({ path: join(evidence, 'mobile-verified.png'), fullPage: true });

  await appendFile(join(root, recordingId, 'frames.bin'), Buffer.from([1, 2, 3]));
  await page.reload();
  await expect(page.getByTestId('verification-status')).toHaveText('Report stale');
  await expect(page.getByTestId('stale-warning')).toBeVisible();
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({ path: join(evidence, 'mobile-stale.png'), fullPage: true });
});

test('shared navigation, focus treatment, reduced motion, and reconnect state work responsively', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await expect(page.locator('.workspace-nav a[aria-current="page"]')).toHaveText('Acquire');
  const brandBox = await page.locator('.workspace-brand').boundingBox();
  const navBox = await page.locator('.workspace-nav').boundingBox();
  expect(navBox.y).toBeGreaterThanOrEqual(brandBox.y + brandBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const name = page.getByLabel('Recording name');
  await name.focus();
  expect(
    await name.evaluate((element) => ({
      style: getComputedStyle(element).outlineStyle,
      width: getComputedStyle(element).outlineWidth,
    })),
  ).toEqual({ style: 'solid', width: '2px' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .getByRole('button', { name: 'Start acquisition' })
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s');

  await page.route('**/api/events**', (route) => route.abort());
  await page.reload();
  await expect(page.getByText(/Reconnecting|Disconnected/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start acquisition' })).toBeDisabled();
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({ path: join(evidence, 'mobile-disconnected.png'), fullPage: true });
  await page.unroute('**/api/events**');
  await expect(page.getByText('Local connection')).toBeVisible({ timeout: 10000 });

  await page.setViewportSize({ width: 768, height: 900 });
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .map((element) => ({
          tag: element.tagName,
          className: element.getAttribute('class'),
          right: Math.round(element.getBoundingClientRect().right),
        }))
        .filter((element) => element.right > window.innerWidth + 1),
    ),
  ).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test('network-rejected acquisition and verification commands surface actionable errors', async ({
  page,
}) => {
  const pageErrors = [];
  page.on('pageerror', (cause) => pageErrors.push(cause.message));
  await page.goto(base);
  await page.route('**/api/acquisitions', (route) => route.abort());
  await page.getByRole('button', { name: 'Start acquisition' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Acquisition notice' })).toContainText(
    /Failed to fetch|Request failed/,
  );
  await page.unroute('**/api/acquisitions');

  await page.goto(`${base}/verify?id=${recordingId}`);
  await expect(page.getByRole('button', { name: /Run fresh verification/ })).toBeEnabled();
  await page.route('**/api/verifications', (route) => route.abort());
  await page.getByRole('button', { name: /Run fresh verification/ }).click();
  await expect(page.locator('.notice.error').first()).toContainText(
    /Failed to fetch|Request failed/,
  );
  expect(pageErrors).toEqual([]);
});
