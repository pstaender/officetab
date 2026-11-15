import { expect, test, type Page } from '@playwright/test';

/** Reads the model through the page's `__calc` (the cells are painted on a canvas). */
const model = <T,>(page: Page, f: string) => page.evaluate(`(() => { const c = globalThis.__calc; const d = c.sh.GetDocument(); const v = c.view.GetViewData(); return (${f}); })()`) as Promise<T>;
const cell = (page: Page, col: number, row: number, tab = 0) => model<string>(page, `d.GetString(${col}, ${row}, ${tab})`);
const cursor = (page: Page) => model<[number, number]>(page, '[v.GetCurX(), v.GetCurY()]');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
/** Runs a command as the menus do. */
const run = (page: Page, cmd: string) => page.evaluate((cmd) => (globalThis as unknown as { __dispatch: (c: string) => boolean }).__dispatch(cmd), cmd);

async function fresh(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (localStorage.getItem('calc:ui-mode') === null) localStorage.setItem('calc:ui-mode', 'classic');
  });
  await page.goto('./');
  await expect(page.getByTestId('grid-canvas')).toBeVisible();
  await expect(page.locator('#splash')).toBeHidden();
  await page.getByTestId('cell-input').focus();
  return errors;
}

/** Types entries down a column from the cursor, each ended with Enter. */
async function typeDown(page: Page, entries: string[]) {
  for (const s of entries) { await page.keyboard.type(s); await page.keyboard.press('Enter'); }
}

test('values and formulas are entered, recalculated and undone', async ({ page }) => {
  const errors = await fresh(page);
  await typeDown(page, ['10', '20', '=A1+A2']);
  expect(await cell(page, 0, 2)).toBe('30');
  expect(await cursor(page)).toEqual([0, 3]);
  // changing a precedent recalculates the formula
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await typeDown(page, ['5']);
  expect(await cell(page, 0, 2)).toBe('25');
  await page.keyboard.press(`${mod}+z`);
  expect(await cell(page, 0, 0)).toBe('10');
  expect(await cell(page, 0, 2)).toBe('30');
  await page.keyboard.press(`${mod}+y`);
  expect(await cell(page, 0, 0)).toBe('5');
  // the formula bar shows the formula
  await page.getByTestId('name-box').fill('A3');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('input-line')).toHaveValue('=A1+A2');
  // Escape drops an input
  await page.keyboard.type('99');
  await page.keyboard.press('Escape');
  expect(await cell(page, 0, 2)).toBe('25');
  expect(errors).toEqual([]);
});

test('the canvas paints the cells', async ({ page }) => {
  await fresh(page);
  const canvas = page.getByTestId('grid-canvas');
  const before = await canvas.screenshot();
  await typeDown(page, ['Some text']);
  await page.waitForTimeout(100);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
});

test('navigation keys move the cursor, Ctrl+arrows to the data edges', async ({ page }) => {
  await fresh(page);
  await typeDown(page, ['1', '2', '3', '4']);
  await page.keyboard.press(`${mod}+Home`);
  expect(await cursor(page)).toEqual([0, 0]);
  if (process.platform === 'darwin') return; // the platform's Ctrl+arrow keys are the desktop's
  await page.keyboard.press('Control+ArrowDown');
  expect(await cursor(page)).toEqual([0, 3]);
  await page.keyboard.press('Control+ArrowDown');
  expect((await cursor(page))[1]).toBe(1048575);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await cursor(page)).toEqual([2, 0]);
  await page.keyboard.press('Shift+Tab');
  expect(await cursor(page)).toEqual([1, 0]);
  await page.keyboard.press('PageDown');
  expect((await cursor(page))[1]).toBeGreaterThan(10);
  await page.keyboard.press('Control+End');
  expect(await cursor(page)).toEqual([0, 3]);
});

test('Shift+arrows select, the status bar sums the selection and the Name Box goes to a cell', async ({ page }) => {
  await fresh(page);
  await typeDown(page, ['1', '2', '3']);
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await model(page, '[v.GetSimpleArea().rRange.aEnd.Col(), v.GetSimpleArea().rRange.aEnd.Row()]')).toEqual([0, 2]);
  await expect(page.getByTestId('status-funcs')).toContainText('Sum: 6');
  await expect(page.getByTestId('status-funcs')).toContainText('Average: 2');
  await page.getByTestId('name-box').fill('C7');
  await page.keyboard.press('Enter');
  expect(await cursor(page)).toEqual([2, 6]);
  await expect(page.getByTestId('name-box')).toHaveValue('C7');
});

test('a formula takes references by pointing and AutoSum sums the numbers above', async ({ page }) => {
  await fresh(page);
  await typeDown(page, ['4', '6']);
  await page.keyboard.type('=');
  // clicking on A1 inserts its reference
  const box = (await page.getByTestId('grid-scroller').boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + 8);
  await page.keyboard.type('*2');
  await page.keyboard.press('Enter');
  expect(await model(page, 'd.GetFormula(0, 2, 0)')).toBe('=A1*2');
  expect(await cell(page, 0, 2)).toBe('8');
  // AutoSum below two numbers
  await page.getByTestId('name-box').fill('B3');
  await page.keyboard.press('Enter');
  await page.getByTestId('name-box').fill('B1');
  await page.keyboard.press('Enter');
  await typeDown(page, ['1', '2']);
  await run(page, '.uno:AutoSum');
  await page.keyboard.press('Enter');
  expect(await model(page, 'd.GetFormula(1, 2, 0)')).toBe('=SUM(B1:B2)');
  expect(await cell(page, 1, 2)).toBe('3');
});

test('sheets are inserted and renamed from the sheet tabs', async ({ page }) => {
  const errors = await fresh(page);
  await page.getByRole('button', { name: 'Add sheet' }).click();
  expect(await model(page, 'd.GetTableCount()')).toBe(2);
  expect(await model(page, 'v.GetTabNo()')).toBe(1);
  await expect(page.getByTestId('sheet-status')).toHaveText('Sheet 2 of 2');
  await page.getByTestId('sheet-tab').nth(1).dblclick();
  const name = page.getByTestId('rename-sheet');
  await name.fill('Totals');
  await name.press('Enter');
  expect(await model(page, 'd.GetName(1)')).toBe('Totals');
  await expect(page.getByTestId('sheet-tab').nth(1)).toHaveText('Totals');
  // Ctrl+Page Up goes back to the first sheet
  await page.getByTestId('cell-input').focus();
  await page.keyboard.press(`${mod}+PageUp`);
  expect(await model(page, 'v.GetTabNo()')).toBe(0);
  // a formula on another sheet's cell
  await page.keyboard.type('=Totals.A1+1');
  await page.keyboard.press('Enter');
  expect(await cell(page, 0, 0)).toBe('1');
  expect(errors).toEqual([]);
});

test('the toolbar formats the selection and Format Cells sets a number format', async ({ page }) => {
  await fresh(page);
  await typeDown(page, ['1234.5']);
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: 'Bold' }).click();
  expect(await model(page, 'd.GetPattern(0, 0, 0).GetItem("ATTR_FONT_WEIGHT")')).toBe(true);
  await page.getByRole('button', { name: 'Align Right' }).click();
  expect(await model(page, 'd.GetPattern(0, 0, 0).GetItem("ATTR_HOR_JUSTIFY")')).toBe('Right');
  await page.getByRole('button', { name: 'Format as Percent' }).click();
  expect(await cell(page, 0, 0)).toBe('123450.00%');
  await page.getByRole('button', { name: 'Format as Percent' }).click();
  expect(await cell(page, 0, 0)).toBe('1234.5');
  await page.keyboard.press(`${mod}+1`);
  const dlg = page.getByRole('dialog', { name: 'Format Cells' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Format code').fill('#,##0.00');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await cell(page, 0, 0)).toBe('1,234.50');
  await expect(page.getByTestId('cell-input')).toBeFocused();
  await page.keyboard.press(`${mod}+z`);
  expect(await cell(page, 0, 0)).toBe('1234.5');
});

test('copy and paste within the app keep formulas with relative references', async ({ page }) => {
  await fresh(page);
  await typeDown(page, ['1', '2', '=A1+A2']);
  await page.keyboard.press('ArrowUp');
  const clip = (type: 'copy' | 'cut' | 'paste', data?: Record<string, string>) => page.evaluate(([type, data]) => {
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(data ?? {})) dt.setData(k, v);
    document.querySelector('[data-testid="cell-input"]')!.dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
    return { 'text/html': dt.getData('text/html'), 'text/plain': dt.getData('text/plain') };
  }, [type, data] as const);
  const copied = await clip('copy');
  expect(copied['text/plain']).toBe('3');
  await page.getByTestId('name-box').fill('B3');
  await page.keyboard.press('Enter');
  await clip('paste', copied);
  expect(await model(page, 'd.GetFormula(1, 2, 0)')).toBe('=B1+B2');
  // text from another application: tab-separated values fill cells
  await page.getByTestId('name-box').fill('D1');
  await page.keyboard.press('Enter');
  await clip('paste', { 'text/plain': 'a\tb\n1\t2\n' });
  expect([await cell(page, 3, 0), await cell(page, 4, 0), await cell(page, 3, 1), await cell(page, 4, 1)]).toEqual(['a', 'b', '1', '2']);
});

test('the spreadsheet is kept across a reload, where it was left', async ({ page }) => {
  await fresh(page);
  await typeDown(page, ['Kept', '=2*21']);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('#splash')).toBeHidden();
  await expect.poll(() => cell(page, 0, 0)).toBe('Kept');
  expect(await cell(page, 0, 1)).toBe('42');
  expect(await cursor(page)).toEqual([0, 2]);
});

test('the menus, context menus and the ribbon render without errors', async ({ page }) => {
  const errors = await fresh(page);
  for (const name of ['File', 'Edit', 'View', 'Insert', 'Format', 'Sheet', 'Data']) {
    await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
    await expect(page.locator('.menu-popup').first()).toBeVisible();
    await page.keyboard.press('Escape');
  }
  const box = (await page.getByTestId('grid-scroller').boundingBox())!;
  await page.mouse.click(box.x + 50, box.y + 30, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('sheet-tab').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Rename Sheet/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await run(page, 'app:MenuRibbon');
  await expect(page.getByRole('tablist', { name: 'Ribbon tabs' })).toBeVisible();
  for (const tab of ['Home', 'Insert', 'Layout', 'Data', 'View']) {
    const t = page.getByRole('tab', { name: tab, exact: true });
    if (await t.count()) await t.click();
  }
  expect(errors).toEqual([]);
});

test('Delete clears the selection and Backspace opens Delete Contents', async ({ page }) => {
  await fresh(page);
  await typeDown(page, ['x', 'y']);
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  expect([await cell(page, 0, 0), await cell(page, 0, 1)]).toEqual(['', '']);
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('dialog', { name: 'Delete Contents' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('rows are inserted and columns resized, and View > Freeze Cells freezes panes', async ({ page }) => {
  await fresh(page);
  await typeDown(page, ['a', 'b']);
  await page.keyboard.press(`${mod}+Home`);
  await run(page, '.uno:InsertRowsBefore');
  expect([await cell(page, 0, 0), await cell(page, 0, 1)]).toEqual(['', 'a']);
  const w0 = await model<number>(page, 'd.GetColWidth(0, 0)');
  await run(page, '.uno:ColumnWidth');
  const dlg = page.getByRole('dialog', { name: 'Column Width' });
  await dlg.getByRole('textbox').fill('5 cm');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await model<number>(page, 'd.GetColWidth(0, 0)')).toBe(2835);
  expect(w0).toBe(1280);
  await page.getByTestId('name-box').fill('B3');
  await page.keyboard.press('Enter');
  await run(page, '.uno:FreezePanes');
  expect(await model(page, '[v.GetFixPosX(), v.GetFixPosY()]')).toEqual([1, 2]);
});

test('a spreadsheet downloads as Excel and the Excel file opens again as a copy', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker; delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  const errors = await fresh(page);
  await typeDown(page, ['Item', 'Apples', 'Pears']);
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('ArrowRight');
  await typeDown(page, ['Price', '1.5', '2.25', '=SUM(B2:B3)']);
  await expect.poll(() => cell(page, 1, 3)).toBe('3.75');
  const download = page.waitForEvent('download');
  await page.evaluate(() => (globalThis as unknown as { __calc: { download(n: string, f: string): Promise<void> } }).__calc.download('prices', 'xlsx'));
  const d = await download;
  expect(d.suggestedFilename()).toBe('prices.xlsx');
  const bytes = await (await import('node:fs/promises')).readFile(await d.path());
  expect(bytes.subarray(0, 2).toString()).toBe('PK');

  await page.keyboard.press(`${mod}+o`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open file from this computer/ }).click();
  await (await chooser).setFiles({ name: 'prices.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
  await expect(page.getByText(/Opened as a copy of the Excel file/)).toBeVisible();
  expect(await cell(page, 0, 2)).toBe('Pears');
  expect(await cell(page, 1, 3)).toBe('3.75');
  expect(await model<string>(page, 'd.GetFormula(1, 3, 0)')).toBe('=SUM(B2:B3)');
  expect(await model<boolean>(page, 'globalThis.__calc.handle === null')).toBe(true);
  expect(errors).toEqual([]);
});
