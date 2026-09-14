import { test, expect } from '@playwright/test';
import { join } from 'node:path';

test('opt into a temporary stall, see loss and recovery, and inspect completed-with-loss', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Channels', { exact: true }).fill('32');
  await page.getByLabel('Sample rate', { exact: true }).fill('4000');
  await page.getByText('Overload diagnostics', { exact: true }).click();
  await page.getByLabel('Buffer budget').fill('8192');
  await page.getByLabel('Stall after').fill('0.5');
  await page.getByLabel('Temporary stall').fill('1200');
  await page.getByLabel('Duration', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Start acquisition' }).click();
  await expect(page.getByTestId('recorder-stall')).toHaveText('Recorder stalled');
  await expect(page.getByTestId('loss-state')).toContainText('Loss detected');
  await expect(page.getByTestId('recorder-stall')).toHaveText('Recorder resumed');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed with loss', {
    timeout: 8000,
  });
  await expect(page.getByTestId('lost-frames')).not.toHaveText('0');
  await expect(page.getByTestId('source-offered')).not.toHaveText('—');
  await page.getByRole('button', { name: 'Inspect recording' }).click();
  await expect(page.getByTestId('inspection-warnings')).toContainText('not lossless');
  await expect(
    page
      .getByRole('region', { name: 'Saved recording' })
      .getByTestId('recording-verification-status'),
  ).toHaveText('Integrity not verified');
  if (process.env.SCOPE_CAPTURE_T14_EVIDENCE)
    await page.screenshot({
      path: join(process.cwd(), 'docs/evidence/t14/desktop-completed-with-loss.png'),
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const state = await page.evaluate(async () => (await fetch('/api/state')).json());
  expect(state.metadata.generator.emittedFrames + state.metadata.droppedFrames).toBe(20000);
  expect(state.metadata.peakQueueBytes).toBeLessThanOrEqual(8192);
});
