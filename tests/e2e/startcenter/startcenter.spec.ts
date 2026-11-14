import { expect, test } from '@playwright/test';

test('the Start Center lists the apps and opens Writer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'OfficeTab' })).toBeVisible();
  await page.getByRole('link', { name: /Writer Document/ }).click();
  await expect(page).toHaveURL(/\/writer\/$/);
  await expect(page.getByTestId('document-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
