import { test, expect } from '@playwright/test';

test('invalid service settings preserve the current acquisition and expose field errors', async ({
  page,
}) => {
  await page.goto('/');
  const before = await page.evaluate(async () => (await fetch('/api/state')).json());
  for (const input of [
    { channels: 0 },
    { seed: null },
    { seed: true },
    { seconds: 1e300 },
    { channelz: 8 },
    { displayName: 42 },
    [],
  ]) {
    const result = await page.evaluate(async (input) => {
      const response = await fetch('/api/acquisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return {
        status: response.status,
        body: await response.json(),
        state: await (await fetch('/api/state')).json(),
      };
    }, input);
    expect(result.status).toBe(400);
    expect(Object.keys(result.body.fields).length).toBeGreaterThan(0);
    expect(result.state).toEqual(before);
  }
});

test('configure a timed recording, correct a field error, and inspect its actual settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Recording name').fill('Modulation bench');
  await page.getByLabel('Channels', { exact: true }).fill('0');
  await page.getByLabel('Sample rate', { exact: true }).fill('200');
  await page.getByLabel('Seed', { exact: true }).fill('123');
  await page.getByLabel('Duration', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Start acquisition' }).click();
  await expect(page.getByLabel('Channels', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Channels', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Recording name')).toHaveValue('Modulation bench');
  await expect(page.getByRole('button', { name: 'Start acquisition' })).toBeEnabled();
  await page.getByLabel('Channels', { exact: true }).fill('3');
  await expect(page.getByTestId('aggregate-rate')).toHaveText('600');
  await page.getByRole('button', { name: 'Start acquisition' }).click();
  await expect(page.getByTestId('acquisition-state')).toHaveText('Recording');
  await expect(page.getByLabel('Channels', { exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('Channels', { exact: true })).toHaveValue('3');
  await expect(page.getByTestId('acquisition-state')).toHaveText('Completed');
  await expect(page.getByTestId('recorded-samples')).toHaveText('1,200');
  await page.getByRole('button', { name: 'Inspect recording' }).click();
  await expect(page.getByTestId('expected-frames')).toHaveText('400');
  await expect(page.getByTestId('saved-frames')).toHaveText('400');
  await expect(page.getByTestId('saved-name')).toHaveText('Modulation bench');
  await expect(page.getByTestId('saved-settings')).toHaveText('3 channels · 200 Hz · seed 123');
});
