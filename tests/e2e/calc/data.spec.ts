import { expect, test, type Page } from '@playwright/test';

/** Reads the model through the page's `__calc`. */
const model = <T,>(page: Page, f: string) => page.evaluate(`(() => { const c = globalThis.__calc; const d = c.sh.GetDocument(); const v = c.view.GetViewData(); return (${f}); })()`) as Promise<T>;
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

/** Types rows from A1: cells separated by Tab, rows ended with Enter. */
async function typeRows(page: Page, rows: string[][]) {
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) { await page.keyboard.type(r[i]!); await page.keyboard.press(i < r.length - 1 ? 'Tab' : 'Enter'); }
  }
}

/** Clicks the AutoFilter button of a header cell (at the right of the cell's bottom edge). */
async function clickButton(page: Page, nCol: number) {
  const box = (await page.getByTestId('grid-scroller').boundingBox())!;
  const [x, y] = await model<[number, number]>(page, `[v.GetScrPos(${nCol + 1}, 1, v.GetActivePart(), true).X, v.GetScrPos(${nCol + 1}, 1, v.GetActivePart(), true).Y]`);
  await page.mouse.click(box.x + x - 6, box.y + y - 5);
}

test('AutoFilter: the buttons, the popup filters and sorts, the status bar counts, undo', async ({ page }) => {
  const errors = await fresh(page);
  await typeRows(page, [['Fruit', 'Count'], ['apple', '3'], ['pear', '5'], ['apple', '1'], ['plum', '7']]);
  await page.getByTestId('name-box').fill('A1');
  await page.keyboard.press('Enter');
  await run(page, '.uno:DataFilterAutoFilter');
  expect(await model<boolean>(page, 'd.HasAutoFilter(0, 0, 0)')).toBe(true);

  await clickButton(page, 0);
  const popup = page.getByTestId('autofilter-popup');
  await expect(popup).toBeVisible();
  await popup.getByRole('checkbox', { name: 'pear' }).uncheck();
  await popup.getByRole('checkbox', { name: 'plum' }).uncheck();
  await popup.getByTestId('af-ok').click();
  await expect(popup).toBeHidden();
  expect(await model<boolean[]>(page, '[1,2,3,4].map((r) => d.RowHidden(r, 0))')).toEqual([false, true, false, true]);
  await expect(page.getByTestId('filter-status')).toHaveText('2 of 4 records found');

  // the search field narrows the list
  await clickButton(page, 1);
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('checkbox', { name: '5' })).toBeVisible();
  await popup.getByRole('searchbox').fill('3');
  await expect(popup.getByRole('checkbox', { name: '1' })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();

  // undo shows the rows again
  await page.getByTestId('cell-input').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  expect(await model<boolean[]>(page, '[1,2,3,4].map((r) => d.RowHidden(r, 0))')).toEqual([false, false, false, false]);

  // sorting from the popup (Alt+Down on the header cell opens it)
  await page.getByTestId('name-box').fill('B1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Alt+ArrowDown');
  await popup.getByTestId('af-sort-desc').click();
  expect(await model<string[]>(page, '[1,2,3,4].map((r) => d.GetString(1, r, 0))')).toEqual(['7', '5', '3', '1']);
  expect(errors).toEqual([]);
});

test('Standard Filter: a condition with an operator and a value', async ({ page }) => {
  const errors = await fresh(page);
  await typeRows(page, [['Name', 'Value'], ['a', '10'], ['b', '20'], ['c', '30']]);
  await page.getByTestId('name-box').fill('A1');
  await page.keyboard.press('Enter');
  await run(page, '.uno:DataFilterStandardFilter');
  const dialog = page.getByRole('dialog', { name: 'Standard Filter' });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('filter-field0').selectOption({ label: 'Value' });
  await dialog.getByTestId('filter-op0').selectOption({ label: '>=' });
  await dialog.getByTestId('filter-value0').fill('20');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  expect(await model<boolean[]>(page, '[1,2,3].map((r) => d.RowHidden(r, 0))')).toEqual([true, false, false]);
  await run(page, '.uno:DataFilterRemoveFilter');
  expect(await model<boolean[]>(page, '[1,2,3].map((r) => d.RowHidden(r, 0))')).toEqual([false, false, false]);
  expect(errors).toEqual([]);
});
