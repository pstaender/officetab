import { expect, test, type Page } from '@playwright/test';

/** Reads the model through the page's `__calc` (the cells are painted on a canvas). */
const model = <T,>(page: Page, f: string) => page.evaluate(`(() => { const c = globalThis.__calc; const d = c.sh.GetDocument(); const v = c.view.GetViewData(); return (${f}); })()`) as Promise<T>;
/** Runs a command as the menus do. */
const run = (page: Page, cmd: string) => page.evaluate((cmd) => (globalThis as unknown as { __dispatch: (c: string) => boolean }).__dispatch(cmd), cmd);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function fresh(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (localStorage.getItem('calc:ui-mode') === null) localStorage.setItem('calc:ui-mode', 'classic');
    window.print = () => { (globalThis as { __printed?: number }).__printed = ((globalThis as { __printed?: number }).__printed ?? 0) + 1; };
  });
  await page.goto('./');
  await expect(page.getByTestId('grid-canvas')).toBeVisible();
  await expect(page.locator('#splash')).toBeHidden();
  await page.getByTestId('cell-input').focus();
  return errors;
}

test('File > Print shows the pages of the sheet as SVG pages', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, '(() => { for (let r = 0; r < 120; r++) d.SetValue(0, r, 0, r + 1); c.sh.PostPaintGridAll(); })()');
  await page.keyboard.press(`${mod}+p`);
  const dialog = page.getByRole('dialog', { name: 'Print' });
  await expect(dialog).toBeVisible();
  // 120 rows of the default height are 3 pages of A4
  await expect(dialog.getByRole('status')).toHaveText('3 page(s)');
  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('.print-host .print-page')).toHaveCount(3);
  await expect(page.locator('.print-host .print-page svg').first()).toBeAttached();
  expect(await page.evaluate(() => (globalThis as { __printed?: number }).__printed)).toBe(1);
  // the footer's page numbers and the cells are text of the SVG
  const text = await page.locator('.print-host .print-page').nth(2).textContent();
  expect(text).toContain('Page 3');
  expect(text).toContain('120');
  // a selection prints only its cells
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.print-host')).toHaveCount(0);
  await page.getByTestId('name-box').fill('A1:A10');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`${mod}+p`);
  await dialog.getByLabel('Selected cells').check();
  await expect(dialog.getByRole('status')).toHaveText('1 page(s)');
  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('.print-host .print-page')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('File > Export as PDF downloads a PDF of all sheets', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, '(() => { for (let r = 0; r < 60; r++) d.SetValue(0, r, 0, r + 1); c.sh.PostPaintGridAll(); })()');
  const download = page.waitForEvent('download');
  await run(page, '.uno:ExportDirectToPDF');
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await (await d.createReadStream()).toArray();
  const pdf = Buffer.concat(bytes).toString('latin1');
  expect(pdf.startsWith('%PDF-1.7')).toBe(true);
  expect(pdf).toMatch(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count 2/);
  // the dialog offers the range
  await run(page, '.uno:ExportToPDF');
  const dialog = page.getByRole('dialog', { name: 'PDF Options' });
  await expect(dialog.getByRole('status')).toHaveText('2 page(s)');
  const download2 = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export' }).click();
  expect((await download2).suggestedFilename()).toMatch(/\.pdf$/);
  expect(errors).toEqual([]);
});

test('Format > Page Style changes the page style, with undo', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, '(() => { for (let r = 0; r < 100; r++) d.SetValue(0, r, 0, r + 1); c.sh.PostPaintGridAll(); })()');
  await run(page, '.uno:PageFormatDialog');
  const dialog = page.getByRole('dialog', { name: 'Page Style: Default' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Landscape').check();
  await dialog.getByRole('tab', { name: 'Sheet' }).click();
  await dialog.getByLabel('Grid').check();
  await dialog.getByRole('tab', { name: 'Footer' }).click();
  await dialog.getByRole('button', { name: 'Edit…' }).click();
  const right = dialog.getByLabel('Right area');
  await right.fill('Total: ');
  await dialog.getByRole('button', { name: 'Pages' }).click();
  await expect(right).toHaveValue('Total: ⟨Pages⟩');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  const style = `d.GetStyleSheetPool().Find('Default', 'Page')`;
  expect(await model(page, `${style}.GetItem('ATTR_PAGE').bLandscape`)).toBe(true);
  expect(await model(page, `${style}.GetItem('ATTR_PAGE_SIZE').nWidth > ${style}.GetItem('ATTR_PAGE_SIZE').nHeight`)).toBe(true);
  expect(await model(page, `${style}.GetItem('ATTR_PAGE_GRID')`)).toBe(true);
  expect(await model(page, `${style}.GetItem('ATTR_PAGE_FOOTERRIGHT').pRightArea.GetString()`)).toBe('Total: 99');
  // the print dialog counts the landscape pages
  await page.keyboard.press(`${mod}+p`);
  await expect(page.getByRole('dialog', { name: 'Print' }).getByRole('status')).toHaveText('3 page(s)');
  await page.getByRole('dialog', { name: 'Print' }).getByRole('button', { name: 'Cancel' }).click();
  await run(page, '.uno:Undo');
  expect(await model(page, `${style}.GetItem('ATTR_PAGE').bLandscape`)).toBe(false);
  expect(await model(page, `${style}.GetItem('ATTR_PAGE_GRID')`)).toBe(false);
  expect(errors).toEqual([]);
});

test('print ranges and page breaks from the menus, and the page break view', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, '(() => { for (let r = 0; r < 100; r++) for (let k = 0; k < 3; k++) d.SetValue(k, r, 0, r + 1); c.sh.PostPaintGridAll(); })()');
  await page.getByTestId('name-box').fill('A1:B20');
  await page.keyboard.press('Enter');
  await run(page, '.uno:DefinePrintArea');
  expect(await model(page, 'd.GetPrintRangeCount(0)')).toBe(1);
  await run(page, '.uno:EditPrintArea');
  const dialog = page.getByRole('dialog', { name: 'Edit Print Ranges' });
  await expect(dialog.getByRole('textbox', { name: 'Print range' })).toHaveValue('$A$1:$B$20');
  await dialog.getByRole('textbox', { name: 'Rows to repeat' }).fill('$1');
  await dialog.getByRole('button', { name: 'OK' }).click();
  expect(await model(page, 'd.GetRepeatRowRange(0).aEnd.Row()')).toBe(0);
  await run(page, '.uno:DeletePrintArea');
  expect(await model(page, 'd.IsPrintEntireSheet(0)')).toBe(true);
  await run(page, '.uno:Undo');
  expect(await model(page, 'd.GetPrintRangeCount(0)')).toBe(1);
  await run(page, '.uno:Undo');
  await run(page, '.uno:Undo');
  expect(await model(page, 'd.IsPrintEntireSheet(0)')).toBe(true);
  // a manual row break at the cursor
  await page.getByTestId('name-box').fill('A30');
  await page.keyboard.press('Enter');
  await run(page, '.uno:InsertRowBreak');
  expect(await model(page, 'd.GetRowManualBreaks(0)')).toEqual([29]);
  // the page break view computes the pages: the break at row 30 starts page 2
  await run(page, '.uno:PagebreakMode');
  expect(await model(page, 'v.IsPagebreakMode()')).toBe(true);
  expect(await model(page, 'c.view.GetPageBreakData().GetData(0).GetPageEndY()[0]')).toBe(28);
  await run(page, '.uno:DeleteRowbreak');
  expect(await model(page, 'd.GetRowManualBreaks(0)')).toEqual([]);
  await run(page, '.uno:NormalViewMode');
  expect(await model(page, 'v.IsPagebreakMode()')).toBe(false);
  expect(errors).toEqual([]);
});
