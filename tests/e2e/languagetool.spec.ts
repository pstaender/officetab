import { expect, test } from '@playwright/test';

// LanguageTool in the browser: the worker fetches the English rules from the pinned release on
// jsDelivr the first time, so this test needs the network (skip it with OFFLINE=1).
test.skip(!!process.env.OFFLINE, 'needs the network for LanguageTool’s rules');
test.use({ viewport: { width: 1200, height: 700 } });

test('LanguageTool in the browser marks grammar errors and offers corrections', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem('writer:languagetool', JSON.stringify({ IsEnabled: true, BaseURL: 'languagetool:browser/v2', ServerURL: '', Username: '', ApiKey: '', RestProtocol: '' }));
  });
  await page.goto('/');
  const input = page.getByTestId('document-input');
  await input.waitFor({ state: 'attached' });
  await page.waitForTimeout(1000);
  await input.focus();
  await page.keyboard.type('This are a sentence with a speling error.');
  // Right-click "are" until its grammar error is there (the first check loads the rules).
  const menu = page.locator('.spell-menu');
  // Until then the right-click opens the context menu, which a click on the page closes.
  await expect(async () => {
    await page.mouse.click(600, 500);
    await page.mouse.click(321, 217, { button: 'right' });
    await expect(menu).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 60_000, intervals: [500] });
  await expect(menu.locator('.spell-comment')).toContainText('plural');
  await menu.getByRole('menuitem', { name: 'is', exact: true }).click();
  await expect(menu).toBeHidden();
});

test('Tools > Spelling checks with LanguageTool when Automatic Spell Checking is off', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem('writer:languagetool', JSON.stringify({ IsEnabled: true, BaseURL: 'languagetool:browser/v2', ServerURL: '', Username: '', ApiKey: '', RestProtocol: '' }));
    localStorage.setItem('writer:autospell', 'false');
  });
  await page.goto('/');
  const input = page.getByTestId('document-input');
  await input.waitFor({ state: 'attached' });
  await page.waitForTimeout(1000);
  await input.focus();
  await page.keyboard.type('This are a sentence.');
  await page.keyboard.press('Home');
  // Tools > Spelling (.uno:SpellingAndGrammarDialog)
  await page.keyboard.press('F7');
  const dialog = page.locator('.spelling');
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  // Not "The spellcheck is complete": LanguageTool's agreement error is reported.
  await expect(dialog.locator('.word.grammar')).toBeVisible();
});
