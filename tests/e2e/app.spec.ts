import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

type W = { sh: any; zoom: number; name: string };
const model = <T,>(page: Page, f: string) => page.evaluate(`(() => { const c = globalThis.__writer; const sh = c.sh; const nodes = sh.m_pDoc.GetNodes(); const paras = () => { const o = []; for (let n = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) o.push(n); return o; }; return (${f}); })()`) as Promise<T>;
const texts = (page: Page) => model<string[]>(page, 'paras().map((n) => n.GetText())');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function fresh(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The tests drive the classic menus and toolbars with Colibre's icons; a choice a test makes
  // itself stays across reloads.
  await page.addInitScript(() => {
    if (localStorage.getItem('writer:ui-mode') === null) localStorage.setItem('writer:ui-mode', 'classic');
    if (localStorage.getItem('writer:icon-theme') === null) localStorage.setItem('writer:icon-theme', 'colibre');
  });
  await page.goto('./');
  await expect(page.getByTestId('document-canvas')).toBeVisible();
  await expect(page.locator('#splash')).toBeHidden();
  await page.getByTestId('document-input').focus();
  return errors;
}

test('typing, paragraphs and undo edit the document', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Hello world');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  expect(await texts(page)).toEqual(['Hello world', 'Second']);
  await page.keyboard.press(`${mod}+z`);
  expect(await texts(page)).toEqual(['Hello world', '']);
  await page.keyboard.press(`${mod}+z`);
  expect(await texts(page)).toEqual(['Hello world']);
  await page.keyboard.press('Backspace');
  expect(await texts(page)).toEqual(['Hello worl']);
  expect(errors).toEqual([]);
});

test('the upstream Ctrl+B shortcut formats a selection and paints it', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('bold text');
  const plain = await page.getByTestId('document-canvas').screenshot();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+b`);
  expect(await model(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_WEIGHT", 2)')).toBe(true);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const bold = await page.getByTestId('document-canvas').screenshot();
  expect(bold.equals(plain)).toBe(false);
});

test('text is really drawn on the canvas', async ({ page }) => {
  await fresh(page);
  const dark = () => page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 90 && d[i + 1]! < 90 && d[i + 2]! < 90) n++;
    return n;
  });
  await page.keyboard.type('WWWW MMMM');
  await page.getByTestId('document-input').blur(); // removes the caret from the count
  await page.waitForTimeout(100);
  expect(await dark()).toBeGreaterThan(200);
});

test('typing past a page creates a second page', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const sh = (globalThis as unknown as { __writer: W }).__writer.sh;
    for (let i = 0; i < 80; i++) { sh.Insert(`Paragraph number ${i}`); sh.SplitNode(); }
  });
  await expect(page.getByTestId('page-status')).toHaveText(/of [2-9]/);
});

test('clicking places the caret; word and arrow navigation work', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('One two three');
  const r = await model<{ x: number; y: number; h: number; scrollTop: number }>(page, '(() => { const r = sh.m_pRoot.GetCharRect(paras()[0], 4); return { x: r.Left(), y: r.Top(), h: r.Height() }; })()');
  const box = (await page.getByTestId('document-canvas').boundingBox())!;
  const view = await page.evaluate(() => { const s = document.querySelector('.editwin-scroller')!; return { w: s.clientWidth, top: s.scrollTop }; });
  const size = await model<{ width: number }>(page, 'sh.m_pRoot.GetDocSize()');
  const offset = (view.w - size.width / 15) / 2;
  await page.mouse.click(box.x + offset + r.x / 15 + 0.5, box.y + (r.y + r.h / 2) / 15 - view.top);
  expect(await model(page, 'sh.m_pCursor.GetPoint().GetContentIndex()')).toBe(4);
  await page.keyboard.type('X');
  expect(await texts(page)).toEqual(['One Xtwo three']);
  await page.keyboard.press('End');
  expect(await model(page, 'sh.m_pCursor.GetPoint().GetContentIndex()')).toBe(14);
  await page.keyboard.press('Home');
  expect(await model(page, 'sh.m_pCursor.GetPoint().GetContentIndex()')).toBe(0);
});

test('menus come from upstream and unported commands are disabled', async ({ page }) => {
  await fresh(page);
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  await expect(page.locator('.menu-popup').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  // Spelling is ported; the Mail Merge Wizard is not.
  await expect(page.locator('.menu-item', { hasText: 'Spelling' }).first()).toHaveAttribute('aria-disabled', 'false');
  await expect(page.getByRole('menuitem', { name: /^Mail Merge Wizard/ })).toHaveAttribute('aria-disabled', 'true');
});

test('a submenu is not clipped by its scrolling parent and runs its command', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('abc');
  await page.keyboard.press(`${mod}+a`);
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  const parent = page.locator('.menu-root.open > .menu-popup');
  await parent.locator('> .menu-item', { hasText: 'Text' }).first().hover();
  const bold = page.locator('.menu-item', { hasText: /^Bold/ }).first();
  await expect(bold).toBeVisible();
  const [p, b] = [(await parent.boundingBox())!, (await bold.boundingBox())!];
  expect(b.x).toBeGreaterThanOrEqual(p.x + p.width - 1); // beside the parent, not inside it
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.menu-item'), [b.x + 8, b.y + 8])).toBe(true);
  await bold.click();
  expect(await model(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_WEIGHT", 1)')).toBe(true);
});

test('the style dropdown applies a heading', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('Title here');
  await page.getByTestId('style-select').selectOption('Heading 1');
  expect(await model(page, 'paras()[0].GetTextColl().GetName()')).toBe('Heading 1');
  expect(await model(page, 'paras()[0].GetAttr("RES_CHRATR_FONTSIZE")')).toBe(360);
});

test('the ribbon style list previews the hovered style on the selection, and Clear Direct Formatting is beside it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('writer:ui-mode', 'ribbon'));
  const errors = await fresh(page);
  await page.keyboard.type('Title here');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body');
  const coll = (i: number) => model<string>(page, `paras()[${i}].GetTextColl().GetName()`);
  const state = () => model<[number, boolean]>(page, '[sh.m_pDoc.m_aUndo.length, sh.m_pDoc.IsModified()]');
  const box = page.getByTestId('style-select');
  // Beside the box: Clear Direct Formatting.
  await expect(box.locator('xpath=../following-sibling::button[1]')).toHaveAttribute('aria-label', /Clear Direct Formatting/);
  // Without a selection, hovering previews nothing.
  await box.click();
  const list = page.getByRole('listbox', { name: 'Paragraph styles' });
  await list.getByRole('option', { name: 'Heading 1', exact: true }).hover();
  expect(await coll(1)).not.toBe('Heading 1');
  await page.keyboard.press('Escape');
  // The first paragraph selected: hovering shows the style on it, outside undo.
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('Shift+End');
  const before = await coll(0);
  const undoBefore = await state();
  await box.click();
  await list.getByRole('option', { name: 'Heading 1', exact: true }).hover();
  expect(await coll(0)).toBe('Heading 1');
  expect(await model(page, 'paras()[0].GetAttr("RES_CHRATR_FONTSIZE")')).toBe(360);
  expect(await coll(1)).not.toBe('Heading 1');
  expect(await state()).toEqual(undoBefore);
  await list.getByRole('option', { name: 'Heading 2', exact: true }).hover();
  expect(await coll(0)).toBe('Heading 2');
  // Leaving the list ends the preview; so does Escape.
  await page.mouse.move(700, 600);
  expect(await coll(0)).toBe(before);
  await list.getByRole('option', { name: 'Heading 2', exact: true }).hover();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  expect(await coll(0)).toBe(before);
  expect(await state()).toEqual(undoBefore);
  // A click applies the style as one undo step.
  await box.click();
  await list.getByRole('option', { name: 'Heading 1', exact: true }).click();
  expect(await coll(0)).toBe('Heading 1');
  expect((await state())[0]).toBe(undoBefore[0] + 1);
  await page.keyboard.press(`${mod}+z`);
  expect(await coll(0)).toBe(before);
  expect(errors).toEqual([]);
});

test('find and replace works', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('apple pie, apple tart');
  await page.getByTestId('document-input').press(`${mod}+h`);
  await page.getByLabel('Find', { exact: true }).fill('apple');
  await page.getByLabel('Replace with').fill('pear');
  await page.getByRole('button', { name: 'Replace All' }).click();
  expect(await texts(page)).toEqual(['pear pie, pear tart']);
});

test('the document survives a reload through IndexedDB', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('Persist me');
  await page.keyboard.press('Enter');
  await page.keyboard.type('line two');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+i`);
  // Autosave stores each change at once.
  await page.waitForTimeout(300);
  await page.reload();
  await expect.poll(() => texts(page)).toEqual(['Persist me', 'line two']);
  expect(await model(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_POSTURE", 1)')).toBe(true);
});

test('the app starts offline once installed', async ({ page, context }) => {
  await fresh(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.keyboard.type('x');
  await expect.poll(() => model<boolean>(page, '!c.unsaved && !c.savePending')).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('document-canvas')).toBeVisible();
  // The stored document is open (typing before would go to the empty one it replaces).
  await expect.poll(async () => (await texts(page)).join('')).toBe('x');
  await page.getByTestId('document-input').focus();
  // The caret is back after the "x" typed before: a new paragraph keeps the words apart.
  await page.keyboard.press('Enter');
  await page.keyboard.type('Offline text');
  expect((await texts(page)).join('')).toContain('Offline text');
  // Everything the manifest and shell reference must be cached too.
  for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png']) {
    expect(await page.evaluate((u) => fetch(u).then((r) => r.ok), f), f).toBe(true);
  }
  await context.setOffline(false);
});

test.describe('static hosting', () => {
  let server: Server;
  let origin = '';
  const dist = resolve(import.meta.dirname, '../../dist');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

  test.beforeAll(async () => {
    // A deliberately dumb file server: fixed sub-directory, no rewrites, no special headers.
    server = createServer(async (req, res) => {
      const path = new URL(req.url!, 'http://x').pathname;
      if (!path.startsWith('/some/sub/dir/')) { res.statusCode = 404; res.end(); return; }
      let rel = normalize(path.slice('/some/sub/dir/'.length));
      if (rel === '.' || rel === '') rel = 'index.html';
      try {
        const body = await readFile(join(dist, rel));
        res.setHeader('content-type', types[extname(rel)] ?? 'application/octet-stream');
        res.end(body);
      } catch { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>((r) => server.listen(0, r));
    origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  test.afterAll(() => { server.close(); });

  test('runs from a sub-directory of a plain file server', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (r) => { if (r.status() >= 400) failed.push(r.url()); });
    await page.goto(`${origin}/some/sub/dir/`);
    await page.getByTestId('document-input').focus();
    await page.keyboard.type('hosted');
    expect(await texts(page)).toEqual(['hosted']);
    expect(failed).toEqual([]);
  });
});

test('the editor starts with the ribbon and Fluent icons', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#splash')).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('menubar')).toHaveCount(0);
  expect(await model<string>(page, 'c.iconTheme')).toBe('fluent');
  await expect(page.locator('.ribbon img.icon-fallback')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with a mouse, the ribbon scrolls with arrows instead of a scroll bar', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.addInitScript(() => localStorage.setItem('writer:ui-mode', 'ribbon'));
  await fresh(page);
  const scroll = page.locator('.ribbon-scroll');
  const start = page.locator('.ribbon-arrow.start'), end = page.locator('.ribbon-arrow.end');
  expect(await scroll.evaluate((e) => (e as HTMLElement).offsetHeight - e.clientHeight)).toBe(0);
  await expect(start).toHaveCSS('visibility', 'hidden');
  await expect(end).toHaveCSS('visibility', 'visible');
  await end.click();
  await expect.poll(() => scroll.evaluate((e) => e.scrollLeft)).toBeGreaterThan(100);
  await expect(start).toHaveCSS('visibility', 'visible');
  for (let i = 0; i < 10 && await end.evaluate((e) => getComputedStyle(e).visibility === 'visible'); i++) { await end.click(); await page.waitForTimeout(400); }
  await expect(end).toHaveCSS('visibility', 'hidden');
  await expect.poll(() => scroll.evaluate((e) => e.scrollLeft + e.clientWidth >= e.scrollWidth - 1)).toBe(true);
});

test('a splash screen shows until the app is ready', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#splash')).toContainText('Writer');
  await expect(page.locator('#splash')).toBeHidden();
  await expect(page.getByTestId('document-canvas')).toBeVisible();
});

test('pinch zoom on the canvas zooms the document, not the page', async ({ page }) => {
  await fresh(page);
  const box = (await page.getByTestId('document-canvas').boundingBox())!;
  const before = await model<number>(page, 'globalThis.__writer.zoom');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // A trackpad pinch reaches the page as wheel events with ctrlKey set.
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -20);
  await page.keyboard.up('Control');
  await expect.poll(() => model<number>(page, 'globalThis.__writer.zoom')).toBeGreaterThan(before);
  // The browser's own zoom stayed untouched.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
});

test('the toolbar list buttons number paragraphs and Tab demotes them', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  const plain = await page.getByTestId('document-canvas').screenshot();
  await page.keyboard.press(`${mod}+a`);
  await page.getByRole('button', { name: 'Toggle Ordered List' }).click();
  const labels = () => model<(string | null)[]>(page, 'paras().map((n) => sh.m_pRoot.m_aNums.get(n)?.label ?? null)');
  expect(await labels()).toEqual(['1.', '2.']);
  await expect(page.getByRole('button', { name: 'Toggle Ordered List' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.getByTestId('document-canvas').screenshot()).not.toEqual(plain);
  // Tab at the start of an entry demotes it; Enter on an empty entry ends the list.
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  expect(await labels()).toEqual(['1.', '1.']);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  expect(await labels()).toEqual(['1.', '1.', null]);
  expect(errors).toEqual([]);
});

test('a table is inserted from the toolbar, filled with Tab and drawn', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Above');
  const before = await page.getByTestId('document-canvas').screenshot();
  await page.getByRole('toolbar').getByRole('button', { name: 'Table', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert Table' });
  await dialog.getByLabel('Columns', { exact: true }).fill('3');
  await dialog.getByLabel('Rows', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('document-input')).toBeFocused();
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('!');
  const cells = () => model<string[][]>(page, `(() => { const t = sh.m_pCursor.GetPoint().GetNode().FindTableNode(); return t.m_pTable.GetTabLines().map((l) => l.m_aBoxes.map((b) => nodes.GoNext(b.m_pStartNode.GetIndex()).GetText())); })()`);
  expect(await cells()).toEqual([['!a', 'b', ''], ['', '', '']]);
  expect(await page.getByTestId('document-canvas').screenshot()).not.toEqual(before);
  expect(errors).toEqual([]);
});

test('Table cells are selected with Shift+arrows, merged and split from the Table menu', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, 'sh.InsertTable(3, 3, { heading: false, repeatHeading: false, borders: true })');
  for (const [i, t] of ['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3'].entries()) { if (i) await page.keyboard.press('Tab'); await page.keyboard.type(t); }
  await model(page, '(() => { const t = sh.m_pCursor.GetPoint().GetNode().FindTableNode(); sh.m_pCursor.GetPoint().Assign(nodes.GoNext(t.GetIndex()), 0); sh.m_pCursor.DeleteMark(); c.notify(); })()');
  // From A1, down and right: A1 to B2.
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  expect(await model(page, 'sh.IsTableMode()')).toBe(true);
  expect(await model<number>(page, 'sh.GetTableSelBoxes().length')).toBe(4);
  await page.screenshot({ path: 'test-results/table-selection.png' });
  const table = async (item: RegExp, sub?: RegExp) => {
    await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
    if (sub) await page.getByRole('menuitem', { name: sub }).hover();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await table(/^Merge Cells/);
  const spans = () => model<number[][]>(page, '(() => { const t = sh.m_pCursor.GetPoint().GetNode().FindTableNode(); return t.m_pTable.GetTabLines().map((l) => l.m_aBoxes.map((b) => b.getRowSpan())); })()');
  expect(await spans()).toEqual([[2, 1], [-1, 1], [1, 1, 1]]);
  await table(/^Split Cells/);
  const dlg = page.getByRole('dialog', { name: 'Split Cells' });
  await dlg.getByLabel('Split cell into:').fill('2');
  await dlg.getByLabel('Vertically').check();
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await spans()).toEqual([[2, 2, 1], [-1, -1, 1], [1, 1, 1]]);
  // Table > Select > Column: the cursor's column, the merged cell (with the cell it covers) and A3.
  await table(/^Column$/, /^Select ›/);
  expect(await model<number>(page, 'sh.GetTableSelBoxes().length')).toBe(3);
  await page.screenshot({ path: 'test-results/table-merge-split.png' });
  expect(errors).toEqual([]);
});

test('Table Properties and the table toolbar change the table', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, 'sh.InsertTable(2, 3, { heading: true, repeatHeading: false, borders: true })');
  for (const [i, t] of ['A', 'B', 'C', 'd', 'e', 'f'].entries()) { if (i) await page.keyboard.press('Tab'); await page.keyboard.type(t); }
  // The table toolbar: centre the cell vertically.
  await page.getByRole('toolbar').getByRole('button', { name: 'Center Vertically' }).click();
  expect(await model(page, 'sh.GetBoxAlign()')).toBe('center');
  await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Table Properties/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Table Properties' });
  await dlg.getByLabel('Name:').fill('Prices');
  await dlg.getByLabel('Centered').check();
  await dlg.getByLabel('Width (cm):').fill('10');
  await dlg.getByRole('tab', { name: 'Text Flow' }).click();
  await dlg.getByLabel('Repeat heading').check();
  await dlg.getByRole('tab', { name: 'Borders' }).click();
  await dlg.getByLabel('Line arrangement:').selectOption({ label: 'Outer border only' });
  await dlg.getByRole('tab', { name: 'Background' }).click();
  await dlg.getByLabel('Cell background:').selectOption({ label: 'Color' });
  await page.screenshot({ path: 'test-results/table-properties.png' });
  await dlg.getByRole('button', { name: 'OK' }).click();
  const t = 'sh.GetTableNode().m_pTable';
  expect(await model(page, `[${t}.m_aAttrs.name, ${t}.m_aAttrs.adjust, Math.round(${t}.m_aAttrs.width), ${t}.GetRowsToRepeat()]`)).toEqual(['Prices', 'center', 5670, 1]);
  // Outer border only: the inner lines went.
  expect(await model(page, `[${t}.m_aLines[0].m_aBoxes[1].m_aAttrs.box.left, !!${t}.m_aLines[0].m_aBoxes[1].m_aAttrs.box.top]`)).toEqual([null, true]);
  // One undo step for the whole dialog.
  await model(page, 'sh.Undo()');
  expect(await model(page, `${t}.m_aAttrs.name`)).toBe('Table1');
  await page.screenshot({ path: 'test-results/table-toolbar.png' });
  expect(errors).toEqual([]);
});

test('Text becomes a table, gets a table style and is sorted', async ({ page }) => {
  const errors = await fresh(page);
  for (const [i, line] of ['Name\tScore', 'Bob\t10', 'Carol\t100', 'alice\t9'].entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(line); }
  await page.keyboard.press(`${mod}+a`);
  const table = async (item: RegExp, sub?: RegExp) => {
    await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
    if (sub) await page.getByRole('menuitem', { name: sub }).hover();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await table(/^Text to Table/, /^Convert ›/);
  const conv = page.getByRole('dialog', { name: 'Convert Text to Table' });
  await conv.getByLabel('Heading', { exact: true }).check();
  await conv.getByLabel('Repeat heading').check();
  await conv.getByRole('button', { name: 'OK' }).click();
  const cells = () => model<string[][]>(page, '(() => { const t = sh.GetTableNode(); return t.m_pTable.GetTabLines().map((l) => l.m_aBoxes.map((b) => nodes.GoNext(b.m_pStartNode.GetIndex()).GetText())); })()');
  expect(await cells()).toEqual([['Name', 'Score'], ['Bob', '10'], ['Carol', '100'], ['alice', '9']]);
  // Sort the rows below the heading by score, descending.
  await model(page, '(() => { sh.SelTable(); c.notify(); })()');
  await table(/^Sort/);
  const sort = page.getByRole('dialog', { name: 'Sort' });
  await sort.locator('input[name="col1"]').fill('2');
  await sort.locator('select[name="type1"]').selectOption('num');
  await sort.locator('input[name="order1"][value="down"]').check();
  await sort.getByRole('button', { name: 'OK' }).click();
  expect((await cells()).map((r) => r[0])).toEqual(['Name', 'Carol', 'Bob', 'alice']);
  await table(/^AutoFormat Styles/);
  const af = page.getByRole('dialog', { name: 'AutoFormat' });
  await af.getByLabel('Format').selectOption({ label: 'Box List Blue' });
  await page.screenshot({ path: 'test-results/table-autoformat.png' });
  await af.getByRole('button', { name: 'OK' }).click();
  expect(await model(page, 'sh.GetTableNode().m_pTable.m_aAttrs.styleName')).toBe('Box List Blue');
  // RestoreTableProperties: the built-in styles repeat no heading rows.
  expect(await model(page, 'sh.GetTableNode().m_pTable.GetRowsToRepeat()')).toBe(0);
  await page.screenshot({ path: 'test-results/table-sorted.png' });
  expect(errors).toEqual([]);
});

test('AutoSum and Insert Formula calculate in the table, and Number Format formats the result', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, 'sh.InsertTable(4, 2, { heading: false, repeatHeading: false, borders: true })');
  for (const [i, t] of ['Apples', '1.5', 'Pears', '2.25', 'Plums', '4', 'Total', ''].entries()) { if (i) await page.keyboard.press('Tab'); if (t) await page.keyboard.type(t); }
  const table = async (item: RegExp) => {
    await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  // AutoSum proposes the numbers above; Enter applies it.
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: /^Sum/ }).click();
  const input = page.getByRole('textbox', { name: 'Formula text' });
  await expect(input).toHaveValue('=sum(<B1>|<B2>|<B3>)');
  await expect(page.getByLabel('Position')).toHaveText('B4');
  await input.press('Enter');
  const cell = (r: number, k: number) => model<string>(page, `nodes.GoNext(sh.GetTableNode().m_pTable.m_aLines[${r}].m_aBoxes[${k}].m_pStartNode.GetIndex()).GetText()`);
  expect(await cell(3, 1)).toBe('7.75');
  // Insert Formula shows the formula of the box.
  await table(/^Edit Formula/);
  await expect(input).toHaveValue('=sum(<B1>|<B2>|<B3>)');
  await input.fill('=<B1>*2');
  await input.press('Enter');
  expect(await cell(3, 1)).toBe('3');
  // Number Format: currency.
  await table(/^Number Format/);
  const dlg = page.getByRole('dialog', { name: 'Number Format' });
  await dlg.getByLabel('Category').selectOption({ label: 'Currency' });
  await dlg.getByLabel('Decimal places:').fill('2');
  await page.screenshot({ path: 'test-results/table-numberformat.png' });
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await cell(3, 1)).toBe('$3.00');
  await page.screenshot({ path: 'test-results/table-formula.png' });
  expect(errors).toEqual([]);
});

test('The table toolbar sets borders, their style and colour, and optimizes sizes', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, 'sh.InsertTable(2, 2, { heading: false, repeatHeading: false, borders: false })');
  const bar = page.getByRole('group', { name: 'Table' });
  const box = (k: string) => model(page, `JSON.stringify(sh.GetTableNode().m_pTable.m_aLines[0].m_aBoxes[0].m_aAttrs.box?.${k} ?? null)`);
  await bar.getByLabel('Borders').selectOption({ label: 'Outer Border and All Inner Lines' });
  expect(JSON.parse(await box('left') as string)).toEqual({ color: '#000000', width: 15 });
  await bar.getByLabel('Border Style').selectOption({ label: 'Thick (2.25 pt)' });
  expect(JSON.parse(await box('left') as string).width).toBe(45);
  await bar.getByLabel('Border Color').fill('#ff0000');
  expect(JSON.parse(await box('left') as string)).toEqual({ color: '#ff0000', width: 45 });
  await bar.getByLabel('Borders').selectOption({ label: 'No Borders' });
  expect(await box('left')).toBe('null');
  await expect(bar.getByLabel('Optimize')).toBeEnabled();
  await bar.getByLabel('Optimize').selectOption({ index: 6 });
  expect(errors).toEqual([]);
});

test('Insert Caption numbers a table caption', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, 'sh.InsertTable(2, 2, { heading: false, repeatHeading: false, borders: true })');
  await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Insert Caption...' }).click();
  const dlg = page.getByRole('dialog', { name: 'Insert Caption' });
  await dlg.getByLabel('Caption', { exact: true }).fill('Fruit prices');
  await expect(dlg.getByLabel('Preview')).toHaveText('Table 1: Fruit prices');
  await page.screenshot({ path: 'test-results/caption-dialog.png' });
  await dlg.getByRole('button', { name: 'OK' }).click();
  const cap = await model<string>(page, '(() => { const n = nodes.node(sh.GetTableNode().GetIndex() - 1); return n.GetTextColl().GetName() + "|" + n.GetText().replace("\\u0001", "#"); })()');
  expect(cap).toBe('Table|Table #: Fruit prices');
  await page.screenshot({ path: 'test-results/caption.png' });
  expect(errors).toEqual([]);
});

test('Insert > Page Number, Cross-reference, Signature Line and Text Box', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Intro');
  const insert = async (item: string | RegExp) => {
    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  // Page Number: a centred number in a new footer.
  await insert('Page Number...');
  const pn = page.getByRole('dialog', { name: 'Page Number Wizard' });
  await pn.getByRole('checkbox', { name: 'Include page total', exact: true }).check();
  await page.screenshot({ path: 'test-results/pagenumber-dialog.png' });
  await pn.getByRole('button', { name: 'OK' }).click();
  expect(await model<boolean>(page, 'sh.IsHeaderOn(false)')).toBe(true);
  await model(page, '(() => { const n = paras()[0]; sh.SelectRange(n, 0, 5); sh.SetBookmark("intro"); sh.SelectRange(n, 5, 5); })()');
  // Cross-reference to the bookmark.
  await insert('Cross-reference...');
  const xr = page.getByRole('dialog', { name: 'Fields' });
  await xr.getByLabel('Type').selectOption({ label: 'Bookmarks' });
  await xr.getByLabel('Selection').selectOption({ label: 'intro' });
  await xr.getByLabel('Refer using').selectOption({ label: 'Reference' });
  await page.screenshot({ path: 'test-results/crossref-dialog.png' });
  await xr.getByRole('button', { name: 'Insert' }).click();
  await xr.getByRole('button', { name: 'Close' }).click();
  expect(await model<string>(page, 'paras()[0].m_aHints.find((h) => h.aAttrs.RES_TXTATR_FIELD)?.aAttrs.RES_TXTATR_FIELD.type ?? ""')).toBe('GetRef');
  // Signature line.
  await insert('Signature Line...');
  const sl = page.getByRole('dialog', { name: 'Signature Line' });
  await sl.getByLabel('Name:').fill('Jane Doe');
  await sl.getByRole('button', { name: 'OK' }).click();
  expect(await model<string>(page, 'sh.GetFlyFrameFormat()?.m_aSignatureLine?.m_aSuggestedSignerName ?? ""')).toBe('Jane Doe');
  // Text box: drawn with the mouse, then typed into.
  await insert('Text Box');
  const canvas = page.locator('canvas').first();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + 500, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 700, b.y + 350, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.type('Boxed');
  expect(await model<string>(page, '(() => { const f = sh.GetCurrFlyName(); return f ? nodes.node(nodes.FindFlySection(f).GetIndex() + 1).GetText() : ""; })()')).toBe('Boxed');
  await page.screenshot({ path: 'test-results/insert-features.png' });
  expect(errors).toEqual([]);
});

test('Insert > Object > Formula Object inserts a formula, and a double click edits it', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('x = ');
  await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'OLE Object' }).click();
  await page.getByRole('menuitem', { name: 'Formula Object...' }).click();
  const dlg = page.getByRole('dialog', { name: 'Insert Formula' });
  await dlg.getByRole('button', { name: 'a/b' }).click();
  await expect(dlg.getByLabel('Commands')).toHaveValue('{<?>} over {<?>} ');
  await dlg.getByLabel('Commands').fill('{-b +- sqrt{b^2 - 4ac}} over {2a}');
  await page.screenshot({ path: 'test-results/formula-dialog.png' });
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(dlg).toBeHidden();
  const text = await model<string>(page, 'paras()[0].m_aHints.find((h) => h.aAttrs.RES_TXTATR_FLYCNT)?.aAttrs.RES_TXTATR_FLYCNT.math?.m_sText ?? ""');
  expect(text).toBe('{-b +- sqrt{b^2 - 4ac}} over {2a}');
  await page.screenshot({ path: 'test-results/formula.png' });
  expect(errors).toEqual([]);
});

test('Ctrl+K links the selection through the Hyperlink dialog', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Visit us');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press(`${mod}+k`);
  const dialog = page.getByRole('dialog', { name: 'Hyperlink' });
  await dialog.getByLabel('URL').fill('example.org');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  expect(await model<string | null>(page, 'paras()[0].m_aHints[0]?.aAttrs.RES_TXTATR_INETFMT ?? null')).toBe('https://example.org');
  expect(errors).toEqual([]);
});

test('the font size box applies a typed size on Enter without a new paragraph, and offers the standard sizes', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Big');
  await page.keyboard.press('Shift+Home');
  const box = page.getByRole('combobox', { name: 'Font size', exact: true });
  await box.click();
  await box.fill('20');
  await box.press('Enter');
  expect(await model<number>(page, 'paras().length')).toBe(1);
  expect(await model<number>(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_FONTSIZE", 0)')).toBe(400);
  const list = page.getByRole('combobox', { name: 'Font sizes', exact: true });
  expect(await list.locator('option:not([hidden])').count()).toBe(32);
  await list.selectOption('10.5');
  expect(await model<number>(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_FONTSIZE", 0)')).toBe(210);
  await expect(box).toHaveValue('10.5');
  expect(await model<string>(page, 'paras()[0].GetText()')).toBe('Big');
  // Without a selection the size is for the next text typed, and the box shows it at once.
  await page.keyboard.press('End');
  await list.selectOption('36');
  await expect(box).toHaveValue('36');
  await page.keyboard.type('!');
  expect(await model<number>(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_FONTSIZE", 3)')).toBe(720);
  expect(errors).toEqual([]);
});

test('the font name list previews each font, finds by typing and lists the fonts chosen last first', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('Some text');
  await page.keyboard.press(`${mod}+a`);
  const box = page.getByRole('combobox', { name: 'Font name', exact: true });
  await box.click();
  const list = page.getByRole('listbox', { name: 'Fonts' });
  await expect(list).toBeVisible();
  // Entries in view are drawn in their font (web fonts through a preview face of their own);
  // those out of view are not, so they load nothing.
  await expect(list.locator('[aria-selected="true"]')).toHaveCSS('font-family', /__preview /);
  const styled = await list.locator('li').evaluateAll((lis) => lis.filter((li) => (li as HTMLElement).style.fontFamily).length);
  expect(styled).toBeLessThan(await list.locator('li').count());
  await page.keyboard.type('cou');
  await expect(list.getByRole('option', { name: 'Courier New', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  expect(await model<string[]>(page, 'paras().map((n) => n.GetCharAttrAt("RES_CHRATR_FONT", 2))')).toEqual(['Courier New']);
  expect(await texts(page)).toEqual(['Some text']);
  await box.click();
  await expect(list.getByRole('option').first()).toHaveText('Courier New');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  // With all Google Fonts listed, the box is the plain native list.
  await page.evaluate('globalThis.__writer.fonts.setShowAll(true); globalThis.__writer.notify()');
  await box.click();
  await expect(list).toBeHidden();
  await page.keyboard.press('Escape');
});

test('Format > Character has the font name and size boxes with their lists', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('Some text');
  await page.keyboard.press(`${mod}+a`);
  await page.evaluate("globalThis.__writer.setDialog('character')");
  const dlg = page.getByRole('dialog', { name: 'Character' });
  const name = dlg.getByRole('combobox', { name: 'Font', exact: true });
  await name.focus();
  await page.keyboard.press('Alt+ArrowDown');
  const list = page.getByRole('listbox', { name: 'Fonts' });
  await expect(list.locator('[aria-selected="true"]')).toHaveCSS('font-family', /__preview /);
  await page.keyboard.type('cou');
  // Enter and Escape are the list's: the dialog stays open.
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(name).toHaveValue('Courier New');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(dlg).toBeVisible();
  const size = dlg.getByRole('combobox', { name: 'Size (pt)', exact: true });
  await size.focus();
  await page.keyboard.press('ArrowDown');
  await expect(size).toHaveValue('13');
  await dlg.getByRole('combobox', { name: 'Font sizes', exact: true }).selectOption('10.5');
  await expect(size).toHaveValue('10.5');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(dlg).toBeHidden();
  expect(await model(page, '[paras()[0].GetCharAttrAt("RES_CHRATR_FONT", 2), paras()[0].GetCharAttrAt("RES_CHRATR_FONTSIZE", 2)]')).toEqual(['Courier New', 210]);
});

test('right-click opens the context menu of the text or a table, and Shift+F10 at the caret', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Hello context menu');
  // A selection under the pointer stays; the text menu applies to it.
  await page.keyboard.press('Shift+Home');
  const at = async (f: string) => {
    const r = await model<{ x: number; y: number }>(page, f);
    const zoom = await model<number>(page, 'globalThis.__writer.zoom');
    const origin = await page.locator('.editwin-scroller').evaluate((el) => { const b = (el.firstElementChild as HTMLElement).getBoundingClientRect(); return { x: b.left, y: b.top }; });
    return { x: origin.x + (r.x * zoom) / 15, y: origin.y + (r.y * zoom) / 15 };
  };
  const word = await at('(() => { const f = sh.m_pRoot.pages[0].frames[0]; return { x: f.nLeft + 300, y: f.nTop + 120 }; })()');
  await page.mouse.click(word.x, word.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Context menu' });
  await expect(menu).toBeVisible();
  expect(await model<boolean>(page, 'sh.HasSelection()')).toBe(true);
  // Disabled commands are hidden, as in Writer's context menus; Cut is there with a selection.
  await expect(menu.getByRole('menuitem', { name: /^Cut/ })).toBeVisible();
  await menu.locator('.menu-label', { hasText: /^Paragraph$/ }).hover();
  await menu.getByRole('menuitem', { name: 'Heading 1', exact: true }).click();
  await expect(menu).toBeHidden();
  expect(await model<string>(page, 'paras()[0].GetTextColl().GetName()')).toBe('Heading 1');
  // In a table: the table's menu.
  await model(page, '(() => { sh.EndDoc(); sh.SplitNode(); sh.InsertTable(2, 2); globalThis.__writer.notify(); })()');
  const cell = await at('(() => { const r = sh.GetCharRect(); return { x: r.Left() + 100, y: r.Top() + 60 }; })()');
  await page.mouse.click(cell.x, cell.y, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /^Table Properties/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // Shift+F10 opens it at the caret; Enter runs the focused entry.
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('Ctrl+click on an index entry jumps to its heading', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, `(() => {
    sh.Insert('Intro');
    for (let i = 0; i < 60; i++) { sh.SplitNode(); sh.Insert('Text ' + i); }
    sh.SplitNode();
    sh.Insert('Target');
    sh.SetTextFormatColl('Heading 1');
    sh.SttDoc();
    sh.InsertTableOf('Contents', 1);
    sh.SttDoc();
    globalThis.__writer.notify();
  })()`);
  const entry = await model<{ x: number; y: number }>(page, `(() => { const f = sh.m_pRoot.pages.flatMap((p) => p.frames).find((f) => f.node.GetText().startsWith('Target')); return { x: f.nLeft + 300, y: f.nTop + 150 }; })()`);
  const scroller = page.locator('.editwin-scroller');
  const zoom = await model<number>(page, 'globalThis.__writer.zoom');
  const px = (t: number) => (t * zoom) / 15;
  const origin = await scroller.evaluate((el) => { const s = el.firstElementChild as HTMLElement; const b = s.getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.keyboard.down(mod === 'Meta' ? 'Meta' : 'Control');
  await page.mouse.click(origin.x + px(entry.x), origin.y + px(entry.y));
  await page.keyboard.up(mod === 'Meta' ? 'Meta' : 'Control');
  await expect.poll(() => model<string>(page, 'sh.m_pCursor.GetPoint().GetNode().GetText()')).toBe('Target');
  // Without "Ctrl-click required to open hyperlinks", a plain click follows the link.
  await model(page, `(() => { globalThis.__writer.ctrlClickHyperlink = false; sh.SttDoc(); globalThis.__writer.notify(); })()`);
  await page.waitForTimeout(700);
  const origin2 = await scroller.evaluate((el) => { const s = el.firstElementChild as HTMLElement; const b = s.getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.click(origin2.x + px(entry.x), origin2.y + px(entry.y));
  await expect.poll(() => model<string>(page, 'sh.m_pCursor.GetPoint().GetNode().GetText()')).toBe('Target');
  await model(page, 'globalThis.__writer.ctrlClickHyperlink = true');
  expect(errors).toEqual([]);
});

test('Insert > Content from Document inserts a file at the cursor', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Start end');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Content from Document...' }).click();
  await (await chooser).setFiles({ name: 'part.html', mimeType: 'text/html', buffer: Buffer.from('<p>one <b>bold</b></p><p>two</p>') });
  // The first paragraph joins the text before the cursor, the text after it the last one.
  await expect.poll(() => model<string[]>(page, 'paras().map((n) => n.GetText())')).toEqual(['Start one bold', 'twoend']);
  // The cursor is at the end of the inserted content.
  await page.keyboard.type('!');
  expect(await model<string>(page, 'paras()[1].GetText()')).toBe('two!end');
  await page.screenshot({ path: 'test-results/insert-document.png' });
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+z`);
  expect(await model<string[]>(page, 'paras().map((n) => n.GetText())')).toEqual(['Start end']);
  expect(errors).toEqual([]);
});

test('an image is inserted from a file and painted', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Logo: ');
  const before = await page.getByTestId('document-canvas').screenshot();
  // A 2x2 red PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('toolbar').getByRole('button', { name: /^Image/ }).click();
  await (await chooser).setFiles({ name: 'red.png', mimeType: 'image/png', buffer: png });
  // Anchored to the character by default, and selected.
  await expect.poll(() => model<number | null>(page, 'paras()[0].m_aAnchoredFlys[0]?.fmt.m_nWidth ?? null')).toBe(30);
  expect(await model<number>(page, 'paras()[0].m_aAnchoredFlys[0].nContent')).toBe(6);
  expect(await model<boolean>(page, 'sh.IsFrameSelected()')).toBe(true);
  // Delete removes the selected image; undo brings it back.
  await page.keyboard.press('Delete');
  expect(await model<number>(page, 'paras()[0].m_aAnchoredFlys.length')).toBe(0);
  await page.keyboard.press(`${mod}+z`);
  expect(await model<number>(page, 'paras()[0].m_aAnchoredFlys.length')).toBe(1);
  await expect.poll(async () => !(await page.getByTestId('document-canvas').screenshot()).equals(before)).toBe(true);
  expect(errors).toEqual([]);
});

test('clicking an image far below the cursor selects it without scrolling', async ({ page }) => {
  const errors = await fresh(page);
  for (let i = 0; i < 60; i++) await page.keyboard.press('Enter');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('toolbar').getByRole('button', { name: /^Image/ }).click();
  await (await chooser).setFiles({ name: 'red.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => model<boolean>(page, 'sh.IsFrameSelected()')).toBe(true);
  // Deselect, move the cursor to the top, then scroll the image into view and click it.
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+Home`);
  const rect = await model<{ x: number; y: number; w: number; h: number }>(page, '(() => { const r = sh.GetFlyRect(sh.m_pRoot.pages.flatMap((p) => p.flys)[0].fmt.m_aName); return { x: r.Left(), y: r.Top(), w: r.Width(), h: r.Height() }; })()');
  const scroller = page.locator('.editwin-scroller');
  const zoom = await model<number>(page, 'globalThis.__writer.zoom');
  const px = (t: number) => (t * zoom) / 15;
  await scroller.evaluate((el, top) => { el.scrollTop = top; }, px(rect.y) - 200);
  await page.waitForTimeout(100);
  const before = await scroller.evaluate((el) => el.scrollTop);
  const origin = await scroller.evaluate((el) => { const s = el.firstElementChild as HTMLElement; const b = s.getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.click(origin.x + px(rect.x + rect.w / 2), origin.y + px(rect.y + rect.h / 2));
  await expect.poll(() => model<boolean>(page, 'sh.IsFrameSelected()')).toBe(true);
  await page.waitForTimeout(100);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
  expect(errors).toEqual([]);
});

test('Format > Frame and Object > Link Frames links the selected frame to the clicked one', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Body text');
  // Two fixed-height frames side by side; the first gets more text than it can hold.
  await model(page, `(() => {
    sh.InsertTextFrame(2835, 567);
    sh.Insert('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty');
    sh.SelectFly('Frame1');
    sh.SetFlyFrameAttr({ m_bAutoHeight: false, m_aHoriOrient: { m_eOrient: 0, m_eRelation: 0, m_nPos: 0 } });
    sh.place(paras()[0], 0, false);
    sh.InsertTextFrame(2835, 567);
    sh.SelectFly('Frame2');
    sh.SetFlyFrameAttr({ m_aHoriOrient: { m_eOrient: 0, m_eRelation: 0, m_nPos: 5000 } });
    sh.SelectFly('Frame1');
    globalThis.__writer.notify();
  })()`);
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Frame and Object' }).hover();
  await page.getByRole('menuitem', { name: 'Link Frames', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/continue|weitergehen/);
  const rect = await model<{ x: number; y: number; w: number; h: number }>(page, '(() => { const r = sh.GetFlyRect("Frame2"); return { x: r.Left(), y: r.Top(), w: r.Width(), h: r.Height() }; })()');
  const zoom = await model<number>(page, 'globalThis.__writer.zoom');
  const px = (t: number) => (t * zoom) / 15;
  const origin = await page.locator('.editwin-scroller').evaluate((el) => { const b = (el.firstElementChild as HTMLElement).getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.click(origin.x + px(rect.x + rect.w / 2), origin.y + px(rect.y + rect.h / 2));
  await expect.poll(() => model<string | null>(page, 'sh.GetFlyFrameFormat("Frame1").m_aChain?.m_sNext ?? null')).toBe('Frame2');
  // The text that does not fit in the first frame shows in the second.
  expect(await model<number>(page, 'sh.m_pRoot.FindFly("Frame2").fly.frames.length')).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/chained-frames.png' });
  expect(errors).toEqual([]);
});

test('Insert > Shape draws a shape by dragging on the page, and undo removes it', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Text under a shape');
  await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Shape/ }).hover();
  await page.getByRole('menuitem', { name: /^Basic Shapes/ }).hover();
  await page.getByRole('menuitem', { name: /^Diamond/ }).click();
  await expect(page.getByRole('alert')).toContainText(/Drag|Ziehen/);
  const box = (await page.getByTestId('document-canvas').boundingBox())!;
  const before = await page.getByTestId('document-canvas').screenshot();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 260, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => model<string | null>(page, 'sh.GetFlyFrameFormat()?.m_pShape?.m_sType ?? null')).toBe('diamond');
  const size = await model<number[]>(page, '[sh.GetFlyFrameFormat().m_nWidth, sh.GetFlyFrameFormat().m_nHeight]');
  expect(size[0]).toBeGreaterThan(1500);
  expect(size[1]).toBeGreaterThan(1000);
  await expect.poll(async () => !(await page.getByTestId('document-canvas').screenshot()).equals(before)).toBe(true);
  // A double click edits the shape's text; Escape selects the shape again.
  const r = await model<{ x: number; y: number; w: number; h: number }>(page, '(() => { const r = sh.GetFlyRect(); return { x: r.Left(), y: r.Top(), w: r.Width(), h: r.Height() }; })()');
  const zoom = await model<number>(page, 'globalThis.__writer.zoom');
  const origin = await page.locator('.editwin-scroller').evaluate((el) => { const b = (el.firstElementChild as HTMLElement).getBoundingClientRect(); return { x: b.left, y: b.top }; });
  const at = { x: origin.x + ((r.x + r.w / 2) * zoom) / 15, y: origin.y + ((r.y + r.h / 2) * zoom) / 15 };
  await page.mouse.dblclick(at.x, at.y);
  await page.keyboard.type('In the diamond');
  expect(await model<string>(page, '(() => { const f = sh.m_pDoc.GetFlyFormats()[0].fmt; const s = nodes.FindFlySection(f.m_sContentId); return nodes.GoNext(s.GetIndex()).GetText(); })()')).toBe('In the diamond');
  await page.keyboard.press('Escape');
  expect(await model<boolean>(page, 'sh.IsFrameSelected()')).toBe(true);
  // Undo takes back the typing, the shape's text section, then the shape.
  for (let i = 0; i < 20 && (await model<number>(page, 'sh.m_pDoc.m_aUndo.length')) > 0; i++) await page.keyboard.press(`${mod}+z`);
  expect(await model<number>(page, 'sh.m_pDoc.GetFlyFormats().length')).toBe(0);
  expect(errors).toEqual([]);
});

test('PDF export is switched off in favour of printing', async ({ page }) => {
  const errors = await fresh(page);
  // The toolbar leaves out commands that are not implemented: no Export Directly as PDF, while
  // Print is there (the print dialog saves PDF).
  await expect(page.getByRole('toolbar').getByRole('button', { name: /PDF/ })).toHaveCount(0);
  await expect(page.getByRole('toolbar').getByRole('button', { name: /^Print/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Formatting Marks toggles pilcrows and space dots', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('a b');
  const plain = await page.getByTestId('document-canvas').screenshot();
  await page.getByRole('toolbar').getByRole('button', { name: /Formatting Marks/ }).click();
  await expect.poll(async () => !(await page.getByTestId('document-canvas').screenshot()).equals(plain)).toBe(true);
  await page.getByRole('toolbar').getByRole('button', { name: /Formatting Marks/ }).click();
  await expect.poll(async () => (await page.getByTestId('document-canvas').screenshot()).equals(plain)).toBe(true);
});

test('Ctrl+Alt+C adds a comment whose card edits its text', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Check this');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press(`${mod}+Alt+c`);
  const card = page.getByRole('article', { name: /Comment by/ });
  await expect(card).toBeVisible();
  await expect(card.getByLabel('Comment text')).toBeFocused();
  await page.keyboard.type('Needs a source');
  await page.getByTestId('document-input').focus();
  await expect.poll(() => model<string>(page, 'sh.m_pDoc.GetAnnotations()[0].field.text')).toBe('Needs a source');
  await card.getByRole('button', { name: 'Delete comment' }).click();
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});

test('screen readers get the document as headings, lists and tables, and hear the caret', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const sh = (globalThis as unknown as { __writer: { sh: any; notify(): void } }).__writer.sh;
    sh.Insert('Report'); sh.SetTextFormatColl('Heading 1'); sh.SplitNode();
    sh.Insert('alpha'); sh.ToggleNum(true); sh.SplitNode(); sh.Insert('beta'); sh.SplitNode(); sh.DelNumRules();
    sh.InsertTable(1, 2); sh.Insert('cell one');
  });
  const doc = page.getByRole('document', { name: /document text/ });
  await expect(doc.getByRole('heading', { level: 1, name: 'Report' })).toBeAttached();
  await expect(doc.getByRole('listitem')).toHaveText(['1. alpha', '2. beta']);
  await expect(doc.getByRole('cell').first()).toHaveText('cell one');
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+Home`);
  await expect(page.getByRole('status').last()).toHaveText('Report');
});

test('a Word document opens as a copy', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker; });
  const errors = await fresh(page);
  const { writeZip } = await import('../../src/lo/package/source/zipapi/zip.ts');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const docx = await writeZip([{ name: 'word/document.xml', data: new TextEncoder().encode(`<w:document ${W}><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>From Word</w:t></w:r></w:p></w:body></w:document>`) }]);
  await page.keyboard.press(`${mod}+o`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open file from this computer/ }).click();
  await (await chooser).setFiles({ name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(docx) });
  await expect(page.getByRole('alert')).toContainText('Opened as a copy');
  expect(await texts(page)).toEqual(['From Word']);
  expect(await model<boolean>(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_WEIGHT", 0)')).toBe(true);
  // The copy is edited right away: Edit document closes the notice and puts the cursor in the text.
  await page.getByRole('alert').getByRole('button', { name: 'Edit document' }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type(' edited');
  await expect.poll(() => texts(page)).toEqual(['From Word edited']);
  expect(errors).toEqual([]);
});

test('a Markdown file opens with its structure and saves back as Markdown', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker; delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  const errors = await fresh(page);
  await page.keyboard.press(`${mod}+o`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open file from this computer/ }).click();
  await (await chooser).setFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n\nSome **bold** text.\n\n- one\n- two\n') });
  await expect.poll(() => texts(page)).toEqual(['Notes', 'Some bold text.', 'one', 'two']);
  expect(await model<string>(page, 'paras()[0].GetTextColl().GetName()')).toBe('Heading 1');
  expect(await model<boolean>(page, 'paras()[1].GetCharAttrAt("RES_CHRATR_WEIGHT", 6)')).toBe(true);
  const download = page.waitForEvent('download');
  await page.evaluate(() => (globalThis as unknown as { __writer: { download(n: string, f: string): Promise<void> } }).__writer.download('notes', 'md'));
  const d = await download;
  expect(d.suggestedFilename()).toBe('notes.md');
  const md = await (await import('node:fs/promises')).readFile(await d.path(), 'utf8');
  expect(md).toContain('# Notes');
  expect(md).toContain('Some **bold** text.');
  expect(md).toContain('- one');
  expect(errors).toEqual([]);
});

test('an HTML file opens with its structure and downloads as HTML', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker; delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  const errors = await fresh(page);
  await page.keyboard.press(`${mod}+o`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open file from this computer/ }).click();
  const html = '<html><head><title>Page</title></head><body><h1>Notes</h1><p>Some <b>bold</b> text.</p><ul><li>one</li><li>two</li></ul><table border="1"><tr><td>a</td><td>b</td></tr></table></body></html>';
  await (await chooser).setFiles({ name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await expect.poll(() => texts(page)).toEqual(['Notes', 'Some bold text.', 'one', 'two', 'a', 'b', '']);
  expect(await model<string>(page, 'paras()[0].GetTextColl().GetName()')).toBe('Heading 1');
  expect(await model<boolean>(page, 'paras()[1].GetCharAttrAt("RES_CHRATR_WEIGHT", 6)')).toBe(true);
  const download = page.waitForEvent('download');
  await page.evaluate(() => (globalThis as unknown as { __writer: { download(n: string, f: string): Promise<void> } }).__writer.download('notes', 'html'));
  const d = await download;
  expect(d.suggestedFilename()).toBe('notes.html');
  const out = await (await import('node:fs/promises')).readFile(await d.path(), 'utf8');
  expect(out).toContain('<title>Page</title>');
  expect(out).toContain('<h1>Notes</h1>');
  expect(out).toContain('<p>Some <b>bold</b> text.</p>');
  expect(out).toContain('<li><p');
  expect(out).toContain('<table');
  expect(errors).toEqual([]);
});

test('Delete all removes every stored document but the open one', async ({ page }) => {
  const errors = await fresh(page);
  // Two older documents in the browser's store.
  await page.evaluate(() => new Promise<void>((res, rej) => {
    const r = indexedDB.open('lo-writer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('documents', { keyPath: 'id' });
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result, store = 'documents', tx = db.transaction(store, 'readwrite');
      for (const id of ['old1', 'old2']) tx.objectStore(store).put({ id, name: id, updated: Date.now(), bytes: new Uint8Array(id === 'old1' ? 1_572_864 : 0) });
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    };
  }));
  await page.keyboard.type('kept');
  await page.keyboard.press(`${mod}+o`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete old1' })).toBeVisible();
  // A table of the documents, with each one's size in MB.
  await expect(dialog.getByRole('columnheader')).toHaveText(['Name', /^Modified/, 'Size', 'Actions']);
  await expect(dialog.getByRole('row').filter({ hasText: 'old1' })).toContainText('1.50 MB');
  await expect(dialog.getByRole('row').filter({ hasText: 'old2' })).toContainText('0.00 MB');
  // Sortable by name, modification and size, each way: newest first to begin with.
  const header = (name: string) => dialog.getByRole('columnheader', { name: new RegExp(`^${name}`) });
  const bodyRows = dialog.locator('tbody tr');
  await expect(header('Modified')).toHaveAttribute('aria-sort', 'descending');
  await header('Size').getByRole('button').click();
  await expect(header('Size')).toHaveAttribute('aria-sort', 'descending');
  await expect(header('Modified')).not.toHaveAttribute('aria-sort');
  await expect(bodyRows.first()).toContainText('old1');
  await header('Size').getByRole('button').click();
  await expect(header('Size')).toHaveAttribute('aria-sort', 'ascending');
  await expect(bodyRows.last()).toContainText('old1');
  await header('Name').getByRole('button').click();
  await expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
  await expect(bodyRows.first()).toContainText('old1');
  await header('Name').getByRole('button').click();
  await expect(header('Name')).toHaveAttribute('aria-sort', 'descending');
  await expect(bodyRows.last()).toContainText('old1');
  page.once('dialog', (d) => void d.accept());
  await dialog.getByRole('button', { name: 'Delete all' }).click();
  await expect(dialog.getByRole('button', { name: 'Delete old1' })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Delete old2' })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Delete all' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('printing paints the pages as SVG with the text as text', async ({ page }) => {
  await page.addInitScript(() => { window.print = () => { (globalThis as { printed?: boolean }).printed = true; }; });
  const errors = await fresh(page);
  await page.keyboard.type('Printed text');
  await page.keyboard.press(`${mod}+p`);
  await expect.poll(() => page.evaluate(() => !!(globalThis as { printed?: boolean }).printed)).toBe(true);
  const svg = page.locator('.print-host .print-page svg');
  await expect(svg).toHaveCount(1);
  expect(await svg.locator('text').allTextContents()).toContain('Printed text');
  // The default page rule offers the document's paper to the print dialog.
  expect(await page.evaluate(() => [...document.querySelectorAll('style')].some((s) => /@page \{ size: A4 portrait/.test(s.textContent ?? '')))).toBe(true);
  expect(errors).toEqual([]);
});

test('Edit Style changes the paragraph style for every paragraph using it', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  await page.getByRole('menuitem', { name: 'Styles' }).or(page.getByRole('button', { name: 'Styles', exact: true })).first().click();
  await page.getByText('Edit Style...').click();
  const dialog = page.getByRole('dialog', { name: /Paragraph Style: Standard/ });
  await dialog.getByLabel('Alignment').selectOption('center');
  // Values off the spinner's step (as imported documents have) must pass the form's validation.
  await dialog.getByLabel('Before text (cm)').fill('4.23');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  expect(await model<string[]>(page, 'paras().map((n) => n.GetAttr("RES_PARATR_ADJUST"))')).toEqual(['center', 'center']);
  expect(await model<number>(page, 'Math.round(paras()[0].GetAttr("RES_LR_SPACE").left)')).toBe(Math.round(4.23 * 567));
  expect(errors).toEqual([]);
});

test('track changes records typing and deleting, and Accept All applies them', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Hello world');
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Track Changes/ }).hover();
  await page.getByRole('menuitem', { name: /^Record/ }).click();
  await page.getByTestId('document-input').focus();
  await page.keyboard.press('Backspace');
  await page.keyboard.type('!');
  // As in Writer, Backspace leaves the cursor before the deleted character.
  expect(await model<string>(page, 'paras()[0].GetText()')).toBe('Hello worl!d');
  expect(await model<string[]>(page, 'sh.GetRedlineTable().map((r) => r.data.type)')).toEqual(['Insert', 'Delete']);
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Track Changes/ }).hover();
  await page.getByRole('menuitem', { name: /^Accept All/ }).click();
  expect(await model<string>(page, 'paras()[0].GetText()')).toBe('Hello worl!');
  expect(errors).toEqual([]);
});

test('spelling: choosing a language loads its dictionary, marks unknown words and offers suggestions', async ({ page }) => {
  // The dictionary download is served locally: a tiny Hunspell dictionary in Latin-1.
  await page.route('**/cdn.jsdelivr.net/**', (route) => {
    const url = route.request().url();
    const latin1 = (s: string) => Buffer.from(s, 'latin1');
    if (url.endsWith('.aff')) return route.fulfill({ body: latin1('SET ISO8859-1\nTRY esianrtolcdugmphbyfvkwzESIANRTOLCDUGMPHBYFVKWZ\n') });
    if (url.endsWith('.dic')) return route.fulfill({ body: latin1('4\nhallo\nWelt\ngrün\nBaum\n') });
    return route.abort();
  });
  const errors = await fresh(page);
  await page.keyboard.type('hallo Welt grün Baum Wlet');
  await page.getByLabel('Text language').selectOption('de-DE');
  await expect.poll(() => model<string[]>(page, 'sh.GetWrongList(paras()[0]).map((w) => w.word)'), { timeout: 15000 }).toEqual(['Wlet']);
  // Right-click on the word: suggestions, and choosing one replaces it.
  const r = await model<{ x: number; y: number }>(page, '(() => { const n = paras()[0]; const [rc] = sh.m_pRoot.GetRangeRects(n, 21, 25); return { x: rc.x + 30, y: rc.y + rc.h / 2 }; })()');
  const box = await page.locator('.editwin-scroller').boundingBox();
  const pt = await page.evaluate(({ x, y }) => { const s = document.querySelector('.editwin-scroller')!; const c = (globalThis as any).__writer; const f = c.zoom / 15; const docW = c.sh.m_pRoot.GetDocSize().width * f; const off = docW < s.clientWidth ? (s.clientWidth - docW) / 2 : -s.scrollLeft; return { x: off + x * f, y: y * f - s.scrollTop }; }, r);
  await page.mouse.click(box!.x + pt.x, box!.y + pt.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Welt' }).click();
  expect(await model<string>(page, 'paras()[0].GetText()')).toBe('Hallo Welt grün Baum Welt');
  await expect.poll(() => model<string[]>(page, 'sh.GetWrongList(paras()[0]).map((w) => w.word)')).toEqual([]);
  expect(errors).toEqual([]);
});

test('Format > Text changes the case of the selection and sets small capitals', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('hello big world');
  await page.keyboard.press(`${mod}+a`);
  const formatText = async () => {
    await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Text ›/ }).hover();
  };
  await formatText();
  await page.getByRole('menuitem', { name: /^Capitalize Every Word/ }).click();
  expect(await texts(page)).toEqual(['Hello Big World']);
  await formatText();
  await page.getByRole('menuitem', { name: /^UPPERCASE/ }).click();
  expect(await texts(page)).toEqual(['HELLO BIG WORLD']);
  await formatText();
  await page.getByRole('menuitem', { name: /^Small capitals/ }).click();
  expect(await model<string>(page, "paras()[0].GetCharAttrAt('RES_CHRATR_CASEMAP', 1)")).toBe('smallcaps');
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+z`);
  expect(await texts(page)).toEqual(['Hello Big World']);
  expect(errors).toEqual([]);
});

test('Format > Spotlight marks paragraph styles and direct formatting', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('plain bold');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press(`${mod}+b`);
  const spotlight = async (name: RegExp) => {
    await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Spotlight ›/ }).hover();
    await page.getByRole('menuitem', { name }).click();
  };
  await spotlight(/Paragraph Styles$/);
  await spotlight(/Character Direct Formatting$/);
  expect(await model(page, 'sh.m_aSpotlight')).toEqual({ charDF: true, paraStyles: true, charStyles: false });
  await page.screenshot({ path: 'test-results/spotlight.png' });
  await spotlight(/Paragraph Styles$/);
  expect(await model(page, 'sh.m_aSpotlight.paraStyles')).toBe(false);
  expect(errors).toEqual([]);
});

test('Format > Bullets and Numbering applies an ordered list and customizes a level', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  await page.keyboard.press(`${mod}+a`);
  const open = async () => {
    await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
    await page.getByRole('menuitem', { name: /Bullets and Numbering/ }).click();
  };
  await open();
  const dlg = page.getByRole('dialog', { name: 'Bullets and Numbering' });
  await dlg.getByRole('tab', { name: 'Ordered', exact: true }).click();
  await dlg.getByRole('group', { name: 'Ordered', exact: true }).getByRole('button').nth(2).click();
  await page.screenshot({ path: 'test-results/numbullet.png' });
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await model<(string | null)[]>(page, 'paras().map((n) => sh.m_pRoot.m_aNums.get(n)?.label ?? null)')).toEqual(['(1)', '(2)']);
  await open();
  await dlg.getByRole('tab', { name: 'Customize' }).click();
  await dlg.getByLabel('Before').fill('No. ');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await model<(string | null)[]>(page, 'paras().map((n) => sh.m_pRoot.m_aNums.get(n)?.label ?? null)')).toEqual(['No. 1)', 'No. 2)']);
  expect(errors).toEqual([]);
});

test('Format > Title Page turns the first page into a title page', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Title');
  await model(page, '(() => { sh.InsertPageBreak(null); sh.Insert("Body"); })()');
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitem', { name: /Title Page/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Title Page' });
  await dlg.getByRole('checkbox', { name: 'Reset page numbering after title pages' }).check();
  await page.screenshot({ path: 'test-results/titlepage.png' });
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await model(page, 'sh.m_pRoot.pages.map((p) => [p.pDesc.m_aName, p.nVirtNum])')).toEqual([['First Page', 1], ['Default Page Style', 1]]);
  expect(errors).toEqual([]);
});

test('Format > Watermark puts a watermark on the pages', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Some text');
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Watermark/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Watermark' });
  await dlg.getByLabel('Text').fill('DRAFT');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await model(page, 'sh.m_pRoot.pages[0].flys.map((f) => f.fmt.m_pShape?.m_sText)')).toEqual(['DRAFT']);
  await page.screenshot({ path: 'test-results/watermark.png' });
  expect(errors).toEqual([]);
});

test('File > Properties sets the title and image resolution, and Graphic Size Check lists a coarse image', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('x');
  // A 40 × 20 PNG, inserted at 96 DPI and then made 4 inches wide: 10 DPI.
  await page.evaluate(async () => {
    const cv = new OffscreenCanvas(40, 20); cv.getContext('2d')!.fillRect(0, 0, 40, 20);
    const c = (globalThis as any).__writer;
    await c.insertImageFile(await cv.convertToBlob({ type: 'image/png' }));
    const name = c.sh.m_pDoc.GetFlyFormats()[0].name;
    c.sh.SelectFly(name); c.sh.SetFlyFrameAttr({ m_nWidth: 5760, m_nHeight: 2880 }); c.sh.SelectFly(null); c.notify();
  });
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Properties/ }).click();
  const dlg = page.getByRole('dialog', { name: /^Properties of/ });
  await dlg.getByRole('checkbox', { name: 'Preferred resolution for images:' }).check();
  await dlg.getByLabel('ppi').fill('300');
  await page.screenshot({ path: 'test-results/properties.png' });
  await dlg.getByRole('tab', { name: 'Description' }).click();
  await dlg.getByLabel('Title:').fill('Quarterly report');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await model(page, '[sh.m_pDoc.m_xDocProps.getTitle(), sh.m_pDoc.m_nImagePreferredDPI, sh.m_pDoc.IsModified()]')).toEqual(['Quarterly report', 300, true]);
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Image ›/ }).hover();
  await page.getByRole('menuitem', { name: /^Graphic Size Check/ }).click();
  const check = page.getByRole('dialog', { name: 'Graphic Size Check' });
  await expect(check.getByText("Image 'Image1' has too few pixels for the current size (10 x 10 DPI)")).toBeVisible();
  await check.getByRole('button', { name: 'Mark' }).click();
  expect(await model(page, 'sh.m_sSelFly')).toBe('Image1');
  await page.screenshot({ path: 'test-results/graphic-size-check.png' });
  expect(errors).toEqual([]);
});

test('The image toolbar sets the image mode, transparency and colours', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('x');
  await page.evaluate(async () => {
    const cv = new OffscreenCanvas(40, 20); const ctx = cv.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 40, 20);
    const c = (globalThis as any).__writer;
    await c.insertImageFile(await cv.convertToBlob({ type: 'image/png' }));
    c.sh.SelectFly(c.sh.m_pDoc.GetFlyFormats()[0].name); c.notify();
  });
  const attr = () => model(page, 'sh.GetGrfAttr()');
  await page.getByRole('combobox', { name: 'Image Mode' }).selectOption({ label: 'Grayscale' });
  expect(await attr()).toEqual({ m_eDrawMode: 1 });
  const transparency = page.getByRole('spinbutton', { name: 'Transparency' });
  await transparency.fill('40');
  await transparency.press('Enter');
  expect(await attr()).toEqual({ m_eDrawMode: 1, m_nTransparency: 40 });
  // Format > Image > Color shows the colorbar.
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Image ›/ }).hover();
  await page.getByRole('menuitem', { name: /^Color$/ }).click();
  const bright = page.getByRole('spinbutton', { name: 'Brightness' });
  await bright.fill('30');
  await bright.press('Enter');
  expect(await attr()).toEqual({ m_eDrawMode: 1, m_nTransparency: 40, m_nLuminance: 30 });
  // The graphic is painted grey once its modified bitmap is ready.
  await expect.poll(() => page.evaluate(() => {
    const c = (globalThis as any).__writer;
    return c.graphics.Get(c.sh.m_pDoc, c.sh.GetFlyFrameFormat().graphic, c.sh.GetGrfAttr()) !== null;
  })).toBe(true);
  await page.screenshot({ path: 'test-results/image-color.png' });
  expect(errors).toEqual([]);
});

test('Format > Lists moves an item with its sub-items and inserts an unnumbered entry', async ({ page }) => {
  const errors = await fresh(page);
  for (const [i, t] of ['A', 'A1', 'B'].entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(t); }
  await page.keyboard.press(`${mod}+a`);
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Lists ›/ }).hover();
  await page.getByRole('menuitem', { name: /^Ordered List/ }).click();
  await model(page, '(() => { sh.SelectRange(paras()[1], 0, 0); sh.NumUpDown(true); sh.SelectRange(paras()[0], 0, 0); })()');
  const lists = async (name: RegExp) => {
    await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Lists ›/ }).hover();
    await page.getByRole('menuitem', { name }).click();
  };
  await lists(/^Move Item Down with Subpoints/);
  expect(await texts(page)).toEqual(['B', 'A', 'A1']);
  await lists(/^Insert Unnumbered Entry/);
  expect(await model<boolean[]>(page, "paras().map((n) => n.GetAttr('RES_PARATR_LIST_ISCOUNTED'))")).toEqual([true, true, false, true]);
  expect(errors).toEqual([]);
});

test('Format > Image > Filter replaces the image with the filtered one', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('x');
  // A 40 × 20 red PNG, inserted and selected.
  await page.evaluate(async () => {
    const cv = new OffscreenCanvas(40, 20); const ctx = cv.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 40, 20);
    const c = (globalThis as any).__writer;
    await c.insertImageFile(await cv.convertToBlob({ type: 'image/png' }));
    c.sh.SelectFly(c.sh.m_pDoc.GetFlyFormats()[0].fmt.m_aName); c.notify();
  });
  const pixel = () => page.evaluate(async () => { const b = await (globalThis as any).__writer.selectedBitmap(); return [...b.data.slice(0, 3)]; });
  expect(await pixel()).toEqual([255, 0, 0]);
  const filter = async (name: RegExp) => {
    await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Image ›/ }).hover();
    await page.getByRole('menuitem', { name: /^Filter ›/ }).hover();
    await page.getByRole('menuitem', { name }).click();
  };
  await filter(/^Invert/);
  await expect.poll(pixel).toEqual([0, 255, 255]);
  // Mosaic opens its dialog first.
  const undoSteps = () => model<number>(page, 'sh.m_pDoc.m_aUndo.length');
  const before = await undoSteps();
  await filter(/^Mosaic/);
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
  await expect.poll(undoSteps).toBe(before + 1);
  expect(await pixel()).toEqual([0, 255, 255]);
  // Undo brings the original image back (Mosaic of a single colour changes nothing).
  const select = () => page.evaluate(() => { const c = (globalThis as any).__writer; c.sh.SelectFly(c.sh.m_pDoc.GetFlyFormats()[0].fmt.m_aName); });
  for (let i = 0; i < 2 && (await pixel())[0] !== 255; i++) { await page.keyboard.press(`${mod}+z`); await select(); }
  expect(await pixel()).toEqual([255, 0, 0]);
  expect(errors).toEqual([]);
});

test('table column and row borders are dragged with the mouse', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, 'sh.InsertTable(2, 3, { heading: false, repeatHeading: false, borders: true })');
  await page.keyboard.type('A1');
  await page.waitForTimeout(100);
  // Document twips to client pixels, as SwEditWin's toDoc inverted.
  const at = (x: string, y: string) => page.evaluate(`(() => {
    const c = globalThis.__writer, sh = c.sh, s = document.querySelector('.editwin-scroller'), r = s.getBoundingClientRect();
    const t = sh.m_pRoot.pages[0].tabs[0], cell = t.rows[0].cells[0], f = 15 / c.zoom;
    const w = sh.m_pRoot.GetDocSize().width * c.zoom / 15;
    const sx = w < s.clientWidth ? -((s.clientWidth - w) / 2) * f : s.scrollLeft * f;
    return { x: r.left + ((${x}) - sx) / f, y: r.top + ((${y}) - s.scrollTop * f) / f };
  })()`) as Promise<{ x: number; y: number }>;
  const widths = () => model<number[]>(page, 'sh.GetColWidths()');
  const before = await widths();
  // The border between the first two columns: the pointer turns into a column resizer.
  const p = await at('cell.aFrame.Right()', 'cell.aFrame.Top() + cell.aFrame.Height() / 2');
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('.editwin-scroller')).toHaveCSS('cursor', 'col-resize');
  await page.mouse.down();
  await page.mouse.move(p.x + 30, p.y, { steps: 4 });
  await page.mouse.move(p.x + 60, p.y, { steps: 4 });
  await page.screenshot({ path: 'test-results/table-border-drag.png' });
  await page.mouse.up();
  const after = await widths();
  // 60 CSS pixels at the zoom level, taken from the second column; the cursor stays in A1.
  const zoom = await model<number>(page, 'c.zoom');
  expect(after[0]! - before[0]!).toBeGreaterThan((55 * 15) / zoom);
  expect(after[0]! + after[1]!).toBeCloseTo(before[0]! + before[1]!, -1);
  expect(after[2]).toBeCloseTo(before[2]!, -1);
  expect(await model(page, 'sh.m_pCursor.GetPoint().GetNode().GetText()')).toBe('A1');
  // Escape cancels a drag.
  const q = await at('cell.aFrame.Right()', 'cell.aFrame.Top() + cell.aFrame.Height() / 2');
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x - 40, q.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await widths()).toEqual(after);
  // The first row's bottom border makes the row higher.
  const h = () => model<number>(page, 'sh.m_pRoot.pages[0].tabs[0].rows[0].aFrame.Height()');
  const h0 = await h();
  const r = await at('cell.aFrame.Left() + 300', 'cell.aFrame.Bottom()');
  await page.mouse.move(r.x, r.y);
  await expect(page.locator('.editwin-scroller')).toHaveCSS('cursor', 'row-resize');
  await page.mouse.down();
  await page.mouse.move(r.x, r.y + 40, { steps: 4 });
  await page.mouse.up();
  expect(await h()).toBeGreaterThan(h0 + (35 * 15) / zoom);
  // Undo takes the height back.
  await page.keyboard.press(`${mod}+z`);
  expect(await h()).toBeCloseTo(h0, 0);
  expect(errors).toEqual([]);
});

test('File > Autosave turns storing every change off and on, for later documents too', async ({ page }) => {
  const errors = await fresh(page);
  const file = async (item: string | RegExp) => {
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  const autosave = () => model<boolean>(page, 'c.autoSave');
  expect(await autosave()).toBe(true);
  await page.keyboard.type('Stored');
  await expect.poll(() => model<boolean>(page, 'c.unsaved')).toBe(false);
  await file('Autosave');
  expect(await autosave()).toBe(false);
  // Off: a change stays unsaved, and survives a reload only as the browser last stored it.
  await page.keyboard.type(' later');
  await page.waitForTimeout(300);
  expect(await model<boolean>(page, 'c.unsaved')).toBe(true);
  // Another document asks first; Cancel keeps this one.
  await file(/^New/);
  const query = page.getByRole('dialog', { name: 'Save Document?' });
  await expect(query).toBeVisible();
  await query.getByRole('button', { name: 'Cancel' }).click();
  expect(await texts(page)).toEqual(['Stored later']);
  // Save stores it and goes on to the new document.
  await file(/^New/);
  await query.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => texts(page)).toEqual(['']);
  // The setting holds for the new document and after a reload.
  expect(await autosave()).toBe(false);
  await page.reload();
  await expect(page.locator('#splash')).toBeHidden();
  expect(await autosave()).toBe(false);
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Autosave' }).locator('.menu-check')).toHaveText('');
  await page.keyboard.press('Escape');
  await file('Autosave');
  expect(await autosave()).toBe(true);
  expect(errors).toEqual([]);
});

test('File > Download and Download As download a copy; with autosave, Save saves a version', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('copy me');
  const name = await model<string>(page, 'c.name');
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  // Autosave is on: everything is in the browser already, and Save keeps a version.
  await expect(page.getByRole('menuitem', { name: /^Save(\s+(⌘|Ctrl)\S*)?$/ })).not.toHaveAttribute('aria-disabled', 'true');
  // Download: at once, in the document's own format.
  let download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBe(`${name}.odt`);
  // Download As: another name and format.
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  // Download As replaces Save As, with its shortcut; Save New Version has Ctrl+Alt+V.
  await expect(page.getByRole('menuitem', { name: /^Save As/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /^Save New Version\.\.\.\s*(⌘⌥V|Ctrl\+Alt\+V)$/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Download As\.\.\.\s*(⇧⌘S|Ctrl\+Shift\+S)$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+Shift+s`);
  const dialog = page.getByRole('dialog', { name: 'Download As' });
  // Without versions, there is no history to include.
  await expect(dialog.getByRole('checkbox', { name: /^Include version history/ })).toHaveCount(0);
  await dialog.getByRole('textbox').fill('Copy');
  await dialog.getByRole('combobox').selectOption('txt');
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Copy.txt');
  // A copy: the document keeps its name.
  expect(await model<string>(page, 'c.name')).toBe(name);
  // The ribbon's quick access toolbox: Open, Save, Download.
  await page.getByRole('menuitem', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ribbon' }).click();
  const quick = page.getByRole('toolbar', { name: 'Quick access' }).getByRole('button');
  const names = await quick.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  const open = names.findIndex((n) => /^Open/.test(n ?? ''));
  expect(names.slice(open, open + 3).map((n) => n?.replace(/\.+$/, ''))).toEqual([names[open]!.replace(/\.+$/, ''), 'Save', 'Download']);
  const save = page.getByRole('toolbar', { name: 'Quick access' }).getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  expect(errors).toEqual([]);
});

test('File > Save to Computer saves to a file that Save writes back to', async ({ page }) => {
  // The browser's save dialog, answered with a file that records what is written to it.
  await page.addInitScript(() => {
    const w = window as unknown as { showSaveFilePicker: unknown; __written: number[]; __suggested: string };
    w.__written = [];
    w.showSaveFilePicker = async (o: { suggestedName: string }) => {
      w.__suggested = o.suggestedName;
      return {
        name: 'Report.odt',
        createWritable: async () => ({ write: async (b: Blob) => { w.__written.push(b.size); }, close: async () => {} }),
      };
    };
  });
  const errors = await fresh(page);
  await page.keyboard.type('to disk');
  const name = await model<string>(page, 'c.name');
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to Computer...' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __written: number[] }).__written.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __suggested: string }).__suggested)).toBe(`${name}.odt`);
  expect(await model<string>(page, 'c.name')).toBe('Report');
  // With a file on disk, Save writes to it even with autosave on.
  await page.keyboard.type(' again');
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Save(\s+(⌘|Ctrl)\S*)?$/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __written: number[] }).__written.length)).toBe(2);
  expect(errors).toEqual([]);
});

test('File > Versions saves, shows, opens and deletes versions, and autosave keeps one of each session', async ({ page }) => {
  const errors = await fresh(page);
  const versions = async () => {
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Versions/ }).click();
    return page.getByRole('dialog', { name: /^Versions of/ });
  };
  const comments = () => model<string[]>(page, 'c.versions.map((v) => v.Comment)');
  await page.keyboard.type('First');
  let dlg = await versions();
  await expect(dlg.getByText('This document has no versions yet.')).toBeVisible();
  // Save New Version asks for the comment.
  await dlg.getByRole('button', { name: 'Save New Version' }).click();
  const insert = page.getByRole('dialog', { name: 'Insert Version Comment' });
  await insert.getByRole('textbox').fill('the first');
  await insert.getByRole('button', { name: 'OK' }).click();
  await expect(dlg.getByRole('row')).toHaveCount(2);
  await expect(dlg.getByRole('row').nth(1)).toContainText('the first');
  expect(await comments()).toEqual(['the first']);
  await dlg.getByRole('button', { name: 'Show…' }).click();
  const view = page.getByRole('dialog', { name: 'View Version Comment' });
  await expect(view.getByRole('textbox')).toHaveValue('the first');
  await view.getByRole('button', { name: 'Close' }).click();
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  // The version is stored in the browser with the document, and opens as a copy.
  await page.getByTestId('document-input').focus();
  await page.keyboard.type(' more');
  await expect.poll(() => model<boolean>(page, 'c.unsaved')).toBe(false);
  dlg = await versions();
  await dlg.getByRole('button', { name: 'Open' }).click();
  await expect.poll(() => texts(page)).toEqual(['First']);
  expect(await comments()).toEqual([]);
  await page.getByRole('button', { name: 'Back to the document' }).click();
  await expect.poll(() => texts(page)).toEqual(['First more']);
  expect(await comments()).toEqual(['the first']);
  // With autosave, Save (Ctrl+S) keeps a changed state as a version without asking for a comment,
  // and no second one of the same state. (The pointer leaves the notices' place: hovering pauses them.)
  await page.mouse.move(700, 700);
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+s`);
  await page.waitForTimeout(300);
  expect(await comments()).toEqual(['the first']);
  await page.keyboard.press('End');
  await page.keyboard.type(' too');
  const canvasTop = () => page.getByTestId('document-canvas').evaluate((e) => e.getBoundingClientRect().top);
  const top = await canvasTop();
  await page.keyboard.press(`${mod}+s`);
  await expect.poll(() => comments()).toEqual(['the first', '']);
  // Each version Save makes is announced by a passing notice: it floats over the document, which
  // stays put, and goes by itself.
  await expect(page.getByText('Saved as new version.')).toBeVisible();
  expect(await canvasTop()).toBe(top);
  await expect(page.getByText('Saved as new version.')).toBeHidden({ timeout: 6000 });
  await page.keyboard.press(`${mod}+s`);
  await page.waitForTimeout(300);
  expect(await comments()).toEqual(['the first', '']);
  await expect(page.locator('.message')).toHaveCount(0);
  // Delete: with autosave the list is stored at once.
  dlg = await versions();
  await dlg.getByRole('button', { name: 'Delete', exact: true }).click();
  expect(await comments()).toEqual(['the first']);
  // Delete All deletes at once, without asking.
  await dlg.getByRole('button', { name: 'Delete All' }).click();
  await expect(dlg.getByText('This document has no versions yet.')).toBeVisible();
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => model<boolean>(page, 'c.unsaved')).toBe(false);
  // Autosave's versioning: the first change after the document is opened again keeps the state
  // it was opened in as a version.
  await page.reload();
  await expect(page.locator('#splash')).toBeHidden();
  expect(await comments()).toEqual([]);
  // Save without a change since the document was opened makes no version.
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+s`);
  await page.waitForTimeout(300);
  expect(await comments()).toEqual([]);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect.poll(() => comments()).toEqual(['Automatically saved version']);
  await expect.poll(() => model<boolean>(page, 'c.unsaved')).toBe(false);
  dlg = await versions();
  await dlg.getByRole('button', { name: 'Open' }).click();
  await expect.poll(() => texts(page)).toEqual(['First more too']);
  expect(errors).toEqual([]);
});

test('Ctrl+Alt+V saves a version with a comment, Download As can leave the versions out, and Clear Data deletes everything after a warning', async ({ page }) => {
  const errors = await fresh(page);
  const file = () => page.getByRole('menuitem', { name: 'File', exact: true }).click();
  const zipNames = async (d: Promise<import('@playwright/test').Download>) => {
    const path = await (await d).path();
    return (await readFile(path)).toString('latin1');
  };
  await page.keyboard.type('kept');
  // Ctrl+Alt+V asks for a comment; Cancel saves nothing.
  await page.keyboard.press(`${mod}+Alt+v`);
  let comment = page.getByRole('dialog', { name: 'Insert Version Comment' });
  await expect(comment).toBeVisible();
  await comment.getByRole('button', { name: 'Cancel' }).click();
  await expect(comment).toBeHidden();
  expect(await model<number>(page, 'c.versions.length')).toBe(0);
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+Alt+v`);
  comment = page.getByRole('dialog', { name: 'Insert Version Comment' });
  await comment.getByRole('textbox').fill('First draft');
  await comment.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => model<number>(page, 'c.versions.length')).toBe(1);
  expect(await model<string>(page, 'c.versions[0].Comment')).toBe('First draft');
  await expect(page.getByText('Saved as new version.')).toBeVisible();
  // A second one, unchanged, confirmed with Ctrl+Enter.
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+Alt+v`);
  comment = page.getByRole('dialog', { name: 'Insert Version Comment' });
  await comment.getByRole('textbox').fill('Second');
  await comment.getByRole('textbox').press('Control+Enter');
  await expect.poll(() => model<number>(page, 'c.versions.length')).toBe(2);
  // Download keeps the versions.
  await file();
  let download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  expect(await zipNames(download)).toContain('VersionList.xml');
  // Download As: the versions are included unless the box is cleared.
  await file();
  await page.getByRole('menuitem', { name: /^Download As/ }).click();
  let dialog = page.getByRole('dialog', { name: 'Download As' });
  const include = dialog.getByRole('checkbox', { name: 'Include version history (2 versions)' });
  await expect(include).toBeChecked();
  // Only the OpenDocument formats carry them.
  await dialog.getByRole('combobox').selectOption('docx');
  await expect(include).toHaveCount(0);
  await dialog.getByRole('combobox').selectOption('odt');
  await include.uncheck();
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  const bytes = await zipNames(download);
  expect(bytes).toContain('content.xml');
  expect(bytes).not.toContain('VersionList.xml');
  expect(await model<number>(page, 'c.versions.length')).toBe(2);
  await file();
  await page.getByRole('menuitem', { name: /^Download As/ }).click();
  dialog = page.getByRole('dialog', { name: 'Download As' });
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  expect(await zipNames(download)).toContain('VersionList.xml');
  // Clear Data warns first; Cancel keeps everything.
  await page.evaluate(() => localStorage.setItem('writer:author', 'Someone'));
  await file();
  await page.getByRole('menuitem', { name: /^Clear Data/ }).click();
  let dlg = page.getByRole('dialog', { name: 'Clear Data?' });
  await expect(dlg.getByText('Delete all documents stored in this browser and reset all settings?')).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toBeHidden();
  expect(await texts(page)).toEqual(['kept']);
  await file();
  await page.getByRole('menuitem', { name: /^Clear Data/ }).click();
  dlg = page.getByRole('dialog', { name: 'Clear Data?' });
  await Promise.all([page.waitForEvent('load'), dlg.getByRole('button', { name: 'Clear Data' }).click()]);
  await expect(page.locator('#splash')).toBeHidden();
  await expect.poll(() => texts(page)).toEqual(['']);
  expect(await page.evaluate(() => localStorage.getItem('writer:author'))).toBeNull();
  // No document is left in the browser's store, the one open before least of all.
  const stored = () => page.evaluate(() => new Promise<string[]>((resolve) => {
    const req = indexedDB.open('lo-writer', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('documents', { keyPath: 'id' });
    req.onsuccess = () => {
      const g = req.result.transaction('documents').objectStore('documents').getAll();
      g.onsuccess = () => { req.result.close(); resolve((g.result as { name: string }[]).map((d) => d.name)); };
    };
  }));
  expect(await stored()).toEqual([]);
  expect(errors).toEqual([]);
});

test('File > Create Copy stores the document under a new name and offers to open it', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('original');
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Create Copy/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Create Copy' });
  const name = dlg.getByLabel('Name of the copy');
  await expect(name).toHaveValue('Untitled (Copy)');
  await name.fill('My copy');
  await dlg.getByRole('button', { name: 'Create Copy' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText('Copy “My copy” created.', { exact: false })).toBeVisible();
  // The document stays open; a change to it after the copy does not reach the copy.
  expect(await model<string>(page, 'c.name')).toBe('Untitled');
  const docId = await model<string>(page, 'c.docId');
  await page.getByTestId('document-input').focus();
  await page.keyboard.type(' changed');
  await page.getByRole('button', { name: 'Open Copy' }).click();
  await expect.poll(() => model<string>(page, 'c.name')).toBe('My copy');
  expect(await model<string>(page, 'c.docId')).not.toBe(docId);
  expect(await texts(page)).toEqual(['original']);
  expect(errors).toEqual([]);
});

test('File > Templates: Save as Template, Manage Templates (open, default, rename, move, export, delete, categories, import) and Load Styles', async ({ page }) => {
  const errors = await fresh(page);
  const templatesMenu = async (item: RegExp) => {
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Templates/ }).hover();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await page.keyboard.type('Dear customer');
  // A paragraph style of this document only, which documents made from the template get.
  await page.evaluate(() => {
    const c = (globalThis as unknown as { __writer: { sh: any } }).__writer;
    c.sh.m_pDoc.MakeColl('Letter Body', c.sh.m_pDoc.FindTextFormatCollByName('Text Body'), { RES_CHRATR_FONTSIZE: 300 });
  });
  // Save as Template: a name and a category (None keeps Save disabled).
  await templatesMenu(/^Save as Template/);
  const sat = page.getByRole('dialog', { name: 'Save As Template' });
  await sat.getByLabel('Enter Template Name:').fill('Letter');
  await expect(sat.getByRole('button', { name: 'Save' })).toBeDisabled();
  await sat.getByLabel('Select Template Category:').selectOption({ label: 'My Templates' });
  await sat.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Template “Letter” saved.')).toBeVisible();
  // The document is unchanged and not a template.
  expect(await model<boolean>(page, 'c.template')).toBe(false);

  // Manage Templates (Shift+Ctrl+N): LibreOffice's templates and the new one.
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`Shift+${mod}+n`);
  const tm = page.getByRole('dialog', { name: 'Templates' });
  const list = tm.getByRole('listbox', { name: 'Template List' });
  await expect(list.getByRole('option', { name: 'CV', exact: true })).toBeVisible();
  await expect(list.getByRole('option', { name: 'Letter', exact: true })).toBeVisible();
  await tm.getByLabel('Filter by Category').selectOption({ label: 'My Templates' });
  await expect(list.locator('.tm-name')).toHaveText(['Letter']);
  await tm.getByLabel('Filter by Category').selectOption({ label: 'All Categories' });
  await tm.getByRole('searchbox', { name: 'Search' }).fill('modern');
  await expect(list.locator('.tm-name')).toHaveText(['Modern business letter sans-serif', 'Modern business letter serif', 'Modern']);
  await tm.getByRole('searchbox', { name: 'Search' }).fill('');
  // LibreOffice's own templates cannot be renamed or deleted.
  await list.getByRole('option', { name: 'CV', exact: true }).click({ button: 'right' });
  const menu = tm.getByRole('menu', { name: 'Template' });
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  await page.keyboard.press('Escape');
  // Set as Default: new documents are made from it.
  await list.getByRole('option', { name: 'Letter', exact: true }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Set as Default' }).click();
  await list.getByRole('option', { name: 'Letter', exact: true }).click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Reset Default' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Rename it; a name the category has is refused.
  await list.getByRole('option', { name: 'Letter', exact: true }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename' });
  await rename.getByLabel('Enter new template name:').fill('Customer letter');
  await rename.getByRole('button', { name: 'OK' }).click();
  await expect(list.getByRole('option', { name: 'Customer letter', exact: true })).toBeVisible();
  // A new category, and the template moved there.
  await tm.getByRole('button', { name: /^Manage/ }).click();
  await tm.getByRole('menuitem', { name: 'New Category' }).click();
  const newCat = page.getByRole('dialog', { name: 'New Category' });
  await newCat.getByLabel('Enter new category name:').fill('Letters');
  await newCat.getByRole('button', { name: 'OK' }).click();
  await expect(tm.getByLabel('Filter by Category')).toHaveValue('Letters');
  await tm.getByLabel('Filter by Category').selectOption({ label: 'All Categories' });
  await list.getByRole('option', { name: 'Customer letter', exact: true }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Move' }).click();
  const cat = page.getByRole('dialog', { name: 'Select Category' });
  await cat.getByLabel('Select from Existing Category').selectOption({ label: 'Letters' });
  await cat.getByRole('button', { name: 'OK' }).click();
  await tm.getByLabel('Filter by Category').selectOption({ label: 'Letters' });
  await expect(list.locator('.tm-name')).toHaveText(['Customer letter']);
  // Export downloads the template as .ott.
  await list.getByRole('option', { name: 'Customer letter', exact: true }).click({ button: 'right' });
  const download = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: 'Export' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Customer letter.ott');
  await expect(page.getByText('1 templates successfully exported.')).toBeVisible();
  const exported = await file.path();
  // Open (double click) makes a new, untitled document from the template.
  const before = await model<string>(page, 'c.docId');
  await list.getByRole('option', { name: 'Customer letter', exact: true }).dblclick();
  await expect(tm).toBeHidden();
  await expect.poll(() => model<string>(page, 'c.docId')).not.toBe(before);
  expect(await texts(page)).toEqual(['Dear customer']);
  expect(await model<string>(page, 'c.name')).toBe('Untitled');
  expect(await model<boolean>(page, 'c.template')).toBe(false);
  expect(await model<string>(page, 'sh.m_pDoc.m_xDocProps.getTemplateName()')).toBe('Customer letter');
  expect(await model<boolean>(page, '!!sh.m_pDoc.FindTextFormatCollByName("Letter Body")')).toBe(true);
  // File > New > Text Document uses the default template.
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  const made = await model<string>(page, 'c.docId');
  await page.getByRole('menuitem', { name: /^New\s*(⌘N|Ctrl\+N)?$/ }).click();
  await expect.poll(() => model<string>(page, 'c.docId')).not.toBe(made);
  expect(await texts(page)).toEqual(['Dear customer']);

  // Load Styles from Template brings a template's styles into a document.
  await page.getByTestId('document-input').focus();
  expect(await model<boolean>(page, '!!sh.m_pDoc.FindTextFormatCollByName("Letter Body")')).toBe(true);
  await page.evaluate(() => { const sh = (globalThis as unknown as { __writer: { sh: any } }).__writer.sh; sh.m_pDoc.m_aTextFormatColls.delete('Letter Body'); });
  await page.getByRole('menuitem', { name: 'Styles', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Load Styles from Template/ }).click();
  const ls = page.getByRole('dialog', { name: 'Load Styles from Template' });
  // The first template of a category is selected at once: OK loads it without choosing it again.
  await ls.getByLabel('Categories').selectOption({ label: 'Letters' });
  await expect(ls.getByLabel('Templates', { exact: true })).toHaveValue(/./);
  await expect(ls.getByRole('button', { name: 'OK' })).toBeEnabled();
  await ls.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => model<boolean>(page, '!!sh.m_pDoc.FindTextFormatCollByName("Letter Body")')).toBe(true);

  // Delete the template, then the category; Reset Default Text Document resets the default.
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`Shift+${mod}+n`);
  await tm.getByLabel('Filter by Category').selectOption({ label: 'Letters' });
  await tm.getByRole('button', { name: /^Manage/ }).click();
  await expect(tm.getByRole('menuitem', { name: 'Reset Default Text Document' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(tm).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await list.getByRole('option', { name: 'Customer letter', exact: true }).click();
  await list.press('Delete');
  await expect(list.getByRole('option')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('writer:default-template'))).toBeNull();
  // Import the exported file into the (now empty) category.
  await tm.getByRole('button', { name: /^Manage/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await tm.getByRole('menuitem', { name: 'Import' }).click();
  await (await chooser).setFiles({ name: 'Imported.ott', mimeType: 'application/vnd.oasis.opendocument.text-template', buffer: await readFile(exported) });
  await expect(list.locator('.tm-name')).toHaveText(['Imported']);
  page.once('dialog', (d) => void d.accept());
  await tm.getByRole('button', { name: /^Manage/ }).click();
  await tm.getByRole('menuitem', { name: 'Delete Category' }).click();
  await expect(tm.getByLabel('Filter by Category')).toHaveValue('');
  await expect(tm.getByLabel('Filter by Category').locator('option', { hasText: 'Letters' })).toHaveCount(0);
  // Edit opens LibreOffice's own template as a template.
  await list.getByRole('option', { name: 'Resume', exact: true }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(tm).toBeHidden();
  await expect.poll(() => model<string>(page, 'c.name')).toBe('Resume');
  expect(await model<boolean>(page, 'c.template')).toBe(true);
  await expect(page.getByText('LibreOffice’s template “Resume” is open for editing', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Search Commands (Ctrl+/ or Shift+Esc) finds menu commands with their menu and runs them, also from the ribbon', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('text');
  await page.keyboard.press(`${mod}+/`);
  const popup = page.getByRole('dialog', { name: 'Search Commands' });
  const box = popup.getByRole('combobox', { name: 'Search command' });
  await expect(box).toBeFocused();
  await box.fill('template');
  const results = popup.getByRole('listbox', { name: 'Commands found' });
  const save = results.getByRole('option').filter({ hasText: 'Save as Template...' });
  await expect(save).toContainText('File ▸ Templates');
  // Disabled and unported commands are not offered; Ctrl+/ no longer inserts a zero-width space.
  await expect(results.getByRole('option').filter({ hasText: 'Wizards' })).toHaveCount(0);
  expect(await texts(page)).toEqual(['text']);
  // Down and Enter run the chosen entry.
  // Every word, in any order.
  await box.fill('save template');
  await expect(results.getByRole('option').filter({ hasText: 'Save as Template...' })).toHaveCount(1);
  await box.fill('manage templ');
  await expect(results.getByRole('option')).toHaveCount(1);
  await box.press('Enter');
  await expect(popup).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Templates' })).toBeVisible();
  await page.keyboard.press('Escape');
  // In the ribbon: the search button and Shift+Esc, with the focus on a ribbon button.
  await page.getByRole('menuitem', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ribbon' }).click();
  await page.getByRole('button', { name: 'Search Commands' }).click();
  await expect(popup).toBeVisible();
  await box.fill('bold');
  await expect(results.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await box.press('Escape');
  await expect(popup).toBeHidden();
  await page.getByRole('tab', { name: 'Insert' }).click();
  await page.getByRole('tab', { name: 'Insert' }).focus();
  await page.keyboard.press('Shift+Escape');
  await expect(popup).toBeVisible();
  await box.fill('word count');
  await results.getByRole('option').filter({ hasText: 'Word Count' }).click();
  await expect(page.getByRole('dialog', { name: /Word Count/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Insert > Formatting Mark inserts each mark', async ({ page }) => {
  const errors = await fresh(page);
  const insert = async (item: RegExp) => {
    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Formatting Mark/ }).hover();
    await page.getByRole('menuitem', { name: item }).click();
  };
  const marks: [RegExp, string][] = [
    [/^No-break Space/, '\u00a0'], [/^Non-breaking Hyphen/, '\u2011'], [/^Soft Hyphen/, '\u00ad'],
    [/^Narrow No-break Space/, '\u202f'], [/^Zero-width Space/, '\u200b'], [/^Word Joiner/, '\u2060'],
    [/^Left-to-Right Mark/, '\u200e'], [/^Right-to-Left Mark/, '\u200f'],
  ];
  let expected = '';
  for (const [item, ch] of marks) {
    await page.keyboard.type('x');
    await insert(item);
    expected += `x${ch}`;
  }
  expect(await texts(page)).toEqual([expected]);
  // A second soft hyphen next to the first is not inserted.
  await page.keyboard.press('Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await insert(/^Soft Hyphen/);
  expect(await texts(page)).toEqual([expected]);
  expect(errors).toEqual([]);
});

test('Menu switches between the classic menus and the ribbon, which follows the context', async ({ page }) => {
  const errors = await fresh(page);
  await expect(page.getByRole('menuitem', { name: 'Window', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ribbon' }).click();
  await expect(page.getByRole('menubar')).toHaveCount(0);
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await expect(tab('Home')).toHaveAttribute('aria-selected', 'true');
  // No File tab: Home comes first, and New sits before Open in the quick access toolbox.
  await expect(tab('File')).toHaveCount(0);
  await expect(page.getByRole('tab').first()).toHaveText('Home');
  const quick = page.getByRole('toolbar', { name: 'Quick access' }).getByRole('button');
  const names = await quick.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  expect(names[0]).toBe('New');
  // New's own icon, a plain document (in the theme, not Colibre's grey stand-in).
  const newIcon = page.getByRole('button', { name: 'New', exact: true }).locator('img');
  await expect(newIcon).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(newIcon).not.toHaveClass(/icon-fallback/);
  expect(names[1]).toMatch(/^Open/);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const newMenu = page.getByRole('menu', { name: 'New' });
  await expect(newMenu.getByRole('menuitem')).toHaveText(['New Document', 'New Template']);
  await newMenu.getByRole('menuitem', { name: 'New Template' }).click();
  expect(await model<boolean>(page, 'c.template')).toBe(true);
  expect(await model<string>(page, 'c.fileFormat()')).toBe('ott');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menu', { name: 'New' }).getByRole('menuitem', { name: 'New Document' }).click();
  expect(await model<boolean>(page, 'c.template')).toBe(false);
  // Home's commands work on the text.
  await page.getByTestId('document-input').focus();
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.keyboard.type('bold');
  expect(await model<boolean>(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_WEIGHT", 1)')).toBe(true);
  // A table brings its contextual tab and selects it; leaving the table goes back to Home.
  await expect(tab('Table')).toHaveCount(0);
  await tab('Insert').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('dialog', { name: 'Insert Table' }).getByRole('button', { name: 'Insert' }).click();
  await expect(tab('Table')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Delete selected rows' })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(tab('Table')).toHaveCount(0);
  await expect(tab('Home')).toHaveAttribute('aria-selected', 'true');
  // The document's name is shown and edited beside the tabs.
  const name = page.getByRole('textbox', { name: 'Document name' });
  await name.fill('Ribbon notes');
  await name.press('Enter');
  expect(await model<string>(page, 'c.name')).toBe('Ribbon notes');
  await expect(page.getByTestId('document-input')).toBeFocused();
  // The menu button holds the classic menus; the choice survives a reload.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Menu/ }).hover();
  await expect(page.getByRole('menuitem', { name: 'Ribbon' }).locator('.menu-check')).toHaveText('✓');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#splash')).toBeHidden();
  await expect(tab('Home')).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Menu/ }).hover();
  await page.getByRole('menuitem', { name: 'Classic' }).click();
  await expect(page.getByRole('menubar')).toBeVisible();
  await expect(tab('Home')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('with a German browser', () => {
  test.use({ locale: 'de-DE' });
  test('the shell speaks the language of the menus, which exist in English only', async ({ page }) => {
    const errors = await fresh(page);
    await page.getByRole('menuitem', { name: 'Menu', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Classic' })).toBeVisible();
    await expect(page.getByText('Klassisch')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test('Tools > Options > Keyboard Shortcuts: templates, own keys with browser warnings, kept after a reload', async ({ page }) => {
  const errors = await fresh(page);
  const options = async () => {
    await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Options/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Options' });
    await dialog.getByRole('tab', { name: 'Keyboard Shortcuts' }).click();
    return dialog;
  };
  let dialog = await options();
  const set = dialog.getByLabel('Shortcut set');
  await expect(set).toHaveValue('default');
  // Shift+Ctrl+R is left to the browser by default; LibreOffice's set has it for the rulers.
  await dialog.getByLabel('Find a command or key').fill('Rulers');
  const rulers = dialog.getByRole('row', { name: /^Rulers/ }).first();
  await expect(rulers.locator('kbd')).toHaveCount(0);
  await set.selectOption('libreoffice');
  await expect(rulers.locator('.key-chip.warn')).toHaveCount(1);
  await set.selectOption('msWindows');
  // A key of one's own makes the set custom, with a warning for a key the browser uses.
  await dialog.getByLabel('Find a command or key').fill('Bold');
  const bold = dialog.getByRole('row', { name: /^Bold\b/ }).first();
  await bold.getByRole('button', { name: /^Add a shortcut/ }).click();
  await page.keyboard.press(`${mod}+Alt+KeyQ`);
  await expect(set).toHaveValue('custom');
  await bold.getByRole('button', { name: /^Add a shortcut/ }).click();
  await page.keyboard.press(`${mod}+KeyR`);
  await expect(dialog.locator('.keys-notice .warn', { hasText: 'reload' })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'OK' }).click();
  // The new key works in the document.
  await page.getByTestId('document-input').focus();
  await page.keyboard.type('word');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+Alt+KeyQ`);
  expect(await model(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_WEIGHT", 2)')).toBe(true);
  await page.reload();
  await expect(page.locator('#splash')).toBeHidden();
  dialog = await options();
  await expect(dialog.getByLabel('Shortcut set')).toHaveValue('custom');
  // Exported and imported as JSON.
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export…' }).click()]);
  const file = JSON.parse(await readFile((await download.path())!, 'utf8')) as { shortcuts: Record<string, string> };
  expect(file.shortcuts.Q_MOD1_MOD2).toBe('.uno:Bold');
  await dialog.getByLabel('Shortcut set').selectOption('default');
  await dialog.locator('.keyboard-settings input[type=file]').setInputFiles({ name: 'keys.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(dialog.getByLabel('Shortcut set')).toHaveValue('custom');
  expect(errors).toEqual([]);
});

test('Tools > Options > View switches the icon theme, kept after a reload', async ({ page }) => {
  const errors = await fresh(page);
  const icon = (name: string) => page.getByRole('toolbar').getByRole('button', { name, exact: true }).locator('img');
  const colibreUndo = await icon('Undo').getAttribute('src');
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Options/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Options' });
  await dialog.getByRole('tab', { name: 'View' }).click();
  await dialog.getByLabel('Icon theme').selectOption('line-md');
  await dialog.getByRole('button', { name: 'OK' }).click();
  // Undo is line-md's; Bold, which line-md lacks, is Material Symbols': no Colibre stand-ins.
  await expect(icon('Undo')).not.toHaveAttribute('src', colibreUndo!);
  await expect(page.locator('.toolbar img.icon-fallback')).toHaveCount(0);
  const materialBold = await icon('Bold').getAttribute('src');
  await page.reload();
  await expect(page.locator('#splash')).toBeHidden();
  await expect(icon('Bold')).toHaveAttribute('src', materialBold!);
  expect(await model<string>(page, 'c.iconTheme')).toBe('line-md');
  // Keyline Icons has a Bold icon of its own.
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Options/ }).click();
  await dialog.getByRole('tab', { name: 'View' }).click();
  await dialog.getByLabel('Icon theme').selectOption('keyline-icons');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(icon('Bold')).not.toHaveAttribute('src', materialBold!);
  // Its theme is complete for the toolbar: no Colibre stand-ins left.
  await expect(page.locator('.toolbar img.icon-fallback')).toHaveCount(0);
  // So is Fluent's, which loads when chosen.
  const keylineBold = await icon('Bold').getAttribute('src');
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Options/ }).click();
  await dialog.getByRole('tab', { name: 'View' }).click();
  await dialog.getByLabel('Icon theme').selectOption('fluent-color');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(icon('Bold')).not.toHaveAttribute('src', keylineBold!);
  await expect(page.locator('.toolbar img.icon-fallback')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a submenu stays open while the pointer moves over to it', async ({ page }) => {
  const errors = await fresh(page);
  await page.evaluate(() => (globalThis as any).__writer.setUiMode('ribbon'));
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const item = page.getByRole('menuitem', { name: /^Menu/ });
  const sub = item.locator('.menu-popup').first();
  const a = (await item.boundingBox())!;
  await page.mouse.move(a.x + 20, a.y + a.height / 2);
  const s = (await sub.boundingBox())!;
  // Across the gap between the item and its submenu, a few pixels at a time.
  for (let x = a.x + 20; x < s.x + 20; x += 2) {
    await page.mouse.move(x, a.y + a.height / 2);
    await expect(sub).toBeVisible();
  }
  await sub.getByRole('menuitem', { name: 'Classic' }).click();
  await expect(page.getByRole('menubar')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the colour window sets a custom colour at once, offers it again, and removes colours', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('colour');
  await page.keyboard.press('Shift+Home');
  const at = (which: string) => model<string | null>(page, `paras()[0].GetCharAttrAt("${which}", 2)`);
  const open = async (name: string) => {
    await page.getByRole('button', { name, exact: true }).click();
    return page.getByRole('dialog', { name });
  };
  // A custom colour from the browser's picker applies when the picker reports it, and closes the window.
  let win = await open('Font Color');
  await win.locator('input[type=color]').evaluate((el: HTMLInputElement) => { el.value = '#2a6099'; el.dispatchEvent(new Event('change')); });
  await expect(win).toBeHidden();
  expect(await at('RES_CHRATR_COLOR')).toBe('#2a6099');
  // It is then among the recent colours and the document's colours.
  win = await open('Font Color');
  await expect(win.getByRole('heading', { name: 'Recent Colors' })).toBeVisible();
  await expect(win.getByRole('button', { name: '#2a6099' })).toHaveCount(2);
  // Automatic removes the colour.
  await win.getByRole('button', { name: 'Automatic' }).click();
  await expect(win).toBeHidden();
  expect(await at('RES_CHRATR_COLOR')).toBeNull();
  // Highlighting: a recent colour, then none.
  win = await open('Character Highlighting Color');
  await win.getByRole('button', { name: '#2a6099' }).first().click();
  expect(await at('RES_CHRATR_BACKGROUND')).toBe('#2a6099');
  win = await open('Character Highlighting Color');
  await win.getByRole('button', { name: 'No Highlighting' }).click();
  expect(await at('RES_CHRATR_BACKGROUND')).toBeNull();
  // The selection stays for the next command.
  expect(await model<boolean>(page, 'sh.HasSelection()')).toBe(true);
  expect(errors).toEqual([]);
});

test('a Word 97-2003 document opens as a copy, with its notes', async ({ page }) => {
  const errors = await fresh(page);
  const { readFileSync } = await import('node:fs');
  const data = readFileSync(new URL('../unit/data/ww8/3endnotes.doc', import.meta.url)).toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    await (globalThis as any).__writer.openFile(new File([bytes], 'franchises.doc'), null);
  }, data);
  await expect.poll(() => model<string>(page, 'paras().map((p) => p.GetText()).join("\\n")')).toContain('The Mid-Victorian Quest for Electoral');
  expect(await model<string>(page, 'c.name')).toBe('franchises');
  await expect(page.getByRole('alert')).toContainText('copy');
  // Its endnotes came along.
  expect(await model<number>(page, 'paras().flatMap((p) => p.m_aHints).filter((h) => h.aAttrs.RES_TXTATR_FTN).length')).toBe(3);
  expect(errors).toEqual([]);
});

test('the caret is where the document was left after a reload', async ({ page }) => {
  const errors = await fresh(page);
  for (let i = 1; i <= 60; i++) { await page.keyboard.type(`line ${i}`); await page.keyboard.press('Enter'); }
  // Back up into line 50, in the middle of a word, without editing.
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft');
  const at = () => model<[string, number]>(page, '[sh.m_pCursor.GetPoint().GetNode().GetText(), sh.m_pCursor.GetPoint().GetContentIndex()]');
  expect(await at()).toEqual(['line 50', 6]);
  const scrolled = await page.locator('.editwin-scroller').evaluate((e) => e.scrollTop);
  // The document stored, as the browser would otherwise warn before leaving.
  await expect.poll(() => model<boolean>(page, '!c.unsaved && !c.savePending')).toBe(true);
  await page.reload();
  await expect(page.locator('#splash')).toBeHidden();
  await expect.poll(at).toEqual(['line 50', 6]);
  expect(scrolled).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.editwin-scroller').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the Navigator lists headings, goes to one, and moves a chapter', async ({ page }) => {
  const errors = await fresh(page);
  await page.evaluate(() => {
    const sh = (globalThis as any).__writer.sh;
    const para = (text: string, style?: string) => { sh.Insert(text); if (style) sh.SetTextFormatColl(style); sh.SplitNode(); };
    para('Alpha', 'Heading 1'); para('first');
    para('Beta', 'Heading 1'); para('second');
    sh.InsertTable(2, 2);
    sh.SttDoc();
    (globalThis as any).__writer.notify();
  });
  // F5 shows it (View > Navigator).
  await page.keyboard.press('F5');
  const nav = page.getByRole('complementary', { name: 'Navigator' });
  await expect(nav).toBeVisible();
  const tree = nav.getByRole('tree');
  await expect(tree.getByRole('treeitem', { name: 'Headings' })).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('treeitem', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
  // An empty type is shown greyed, without children.
  await expect(tree.getByRole('treeitem', { name: 'Bookmarks' })).toHaveAttribute('aria-disabled', 'true');
  // Tables open with a click on the arrow; a click goes to an entry, the focus staying in the
  // tree, and the arrow keys go on to the next; a double-click goes there with the document focused.
  await tree.getByRole('treeitem', { name: 'Tables' }).locator('.nav-twisty').dispatchEvent('mousedown');
  await expect(tree.getByRole('treeitem', { name: 'Table1' })).toBeVisible();
  await tree.getByRole('treeitem', { name: 'Beta' }).click();
  expect(await model<string>(page, 'sh.m_pCursor.GetPoint().GetNode().GetText()')).toBe('Beta');
  await expect(tree).toBeFocused();
  await page.keyboard.press('ArrowUp');
  expect(await model<string>(page, 'sh.m_pCursor.GetPoint().GetNode().GetText()')).toBe('Alpha');
  await tree.getByRole('treeitem', { name: 'Beta' }).dblclick();
  expect(await model<string>(page, 'sh.m_pCursor.GetPoint().GetNode().GetText()')).toBe('Beta');
  await expect(page.getByTestId('document-input')).toBeFocused();
  // Move Heading Up takes the chapter with its text before Alpha.
  await tree.getByRole('treeitem', { name: 'Beta' }).click();
  await nav.getByRole('button', { name: 'Move Heading Up' }).click();
  // The chapter's table comes along.
  expect((await texts(page)).filter(Boolean)).toEqual(['Beta', 'second', 'Alpha', 'first']);
  expect(await model<number>(page, 'nodes.node(nodes.FirstTextNode().GetIndex() + 2).IsTableNode() ? 1 : 0')).toBe(1);
  await expect(tree.getByRole('treeitem', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
  // Navigate By Headings: Next goes to the next heading.
  await nav.getByRole('combobox', { name: 'Navigate By' }).selectOption({ label: 'Headings' });
  await page.evaluate(() => { const c = (globalThis as any).__writer; c.sh.SttDoc(); c.notify(); });
  await nav.getByRole('button', { name: 'Next' }).click();
  expect(await model<string>(page, 'sh.m_pCursor.GetPoint().GetNode().GetText()')).toBe('Alpha');
  // It stays open in the next session; the close button hides it.
  await page.reload();
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'Close' }).click();
  await expect(nav).toBeHidden();
  expect(errors).toEqual([]);
});

test('Edit > Go to Page moves the cursor to a page', async ({ page }) => {
  const errors = await fresh(page);
  await page.evaluate(() => { const c = (globalThis as any).__writer; for (let i = 0; i < 3; i++) c.sh.InsertPageBreak?.() ?? c.sh.SplitNode(); for (let i = 0; i < 120; i++) { c.sh.Insert(`line ${i}`); c.sh.SplitNode(); } c.sh.SttDoc(); c.notify(); });
  const pages = await model<number>(page, 'sh.GetPageCnt()');
  expect(pages).toBeGreaterThan(1);
  await page.keyboard.press(`${mod}+G`);
  const dlg = page.getByRole('dialog', { name: 'Go to Page' });
  await expect(dlg).toContainText(`of ${pages}`);
  await dlg.getByRole('spinbutton').fill('2');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await model<number>(page, 'sh.GetPageNumber()')).toBe(2);
  expect(errors).toEqual([]);
});

test('a long document opens with a loading indicator and is laid out once', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await fresh(page);
  const { readFileSync } = await import('node:fs');
  const data = readFileSync(new URL('../../specs/writer/bible.docx', import.meta.url)).toString('base64');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    void (globalThis as any).__writer.openFile(new File([bytes], 'bible.docx'), null);
  }, data);
  await expect(page.getByRole('status').filter({ hasText: 'Opening “bible.docx”…' })).toBeVisible();
  await expect(page.locator('.opening')).toBeHidden({ timeout: 60_000 });
  expect(await model<string>(page, 'c.name')).toBe('bible');
  expect(await model<number>(page, 'sh.GetPageCnt()')).toBeGreaterThan(1000);
  // Jumping to the end needs no other layout: the fonts were there before the first.
  const root = await page.evaluateHandle(() => (globalThis as any).__writer.sh.m_pRoot.pages);
  await page.evaluate(() => { const s = document.querySelector('.editwin-scroller')!; s.scrollTop = s.scrollHeight; });
  await page.evaluate(() => { (globalThis as any).__writer.fontsChanged(); });
  expect(await page.evaluate((p) => p === (globalThis as any).__writer.sh.m_pRoot.pages, root)).toBe(true);
  // Typing near the end works, and the mirror for screen readers follows after a pause.
  await page.evaluate(() => { const c = (globalThis as any).__writer; c.sh.EndDoc(); c.sh.Insert('Amen!'); c.notify(); });
  await expect(page.locator('[role=document] p').last()).toContainText('Amen!');
  expect(errors).toEqual([]);
});

test('a corrupt Word document asks to be repaired, and opens repaired', async ({ page }) => {
  const errors = await fresh(page);
  const { readFileSync } = await import('node:fs');
  const data = readFileSync(new URL('../../specs/writer/exam.docx', import.meta.url)).toString('base64');
  const open = (name: string) => page.evaluate(async ([b64, n]) => {
    // The package followed by 100 KB of zeros: its directory's end is not found.
    const docx = Uint8Array.from(atob(b64!), (ch) => ch.charCodeAt(0));
    const bytes = new Uint8Array(docx.length + 100_000);
    bytes.set(docx);
    void (globalThis as any).__writer.openFile(new File([bytes], n!), null);
  }, [data, name]);
  await open('declined.docx');
  const query = page.getByRole('dialog', { name: 'Repair File?' });
  await expect(query).toContainText('The file “declined.docx” is corrupt');
  await query.getByRole('button', { name: 'Don’t Repair' }).click();
  await expect(query).toBeHidden();
  expect(await model<string>(page, 'c.name')).not.toBe('declined');
  await open('exam.docx');
  await query.getByRole('button', { name: 'Repair', exact: true }).click();
  await expect.poll(() => model<string>(page, 'c.name')).toBe('exam');
  expect((await texts(page)).join('').length).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('AutoCorrect corrects while typing and Enter makes a numbered list', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('see teh "dog" ');
  expect(await texts(page)).toEqual(['See the “dog” ']);
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  expect(await texts(page)).toEqual(['See the “dog”', 'First', 'Second']);
  expect(await model(page, 'paras()[2].GetAttr("RES_PARATR_NUMRULE") === paras()[1].GetAttr("RES_PARATR_NUMRULE") && !!paras()[1].GetAttr("RES_PARATR_NUMRULE")')).toBe(true);
  expect(errors).toEqual([]);
});

test('Tools > AutoCorrect > While Typing switches the corrections off', async ({ page }) => {
  await fresh(page);
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.locator('.menu-item', { hasText: /^AutoCorrect✓?While Typing/ }).first().hover();
  await page.locator('.menu-item', { hasText: /^✓?While Typing$/ }).first().click();
  await page.getByTestId('document-input').focus();
  await page.keyboard.type('see teh ');
  expect(await texts(page)).toEqual(['see teh ']);
});

test('word completion offers a collected word and Enter accepts it', async ({ page }) => {
  await fresh(page);
  await page.keyboard.type('Documentation is good. ');
  await page.waitForTimeout(900); // words are collected at idle time
  await page.keyboard.type('Docu');
  await expect(page.locator('.quickhelp-tip')).toHaveText('Documentation');
  await page.keyboard.press('Enter');
  expect(await texts(page)).toEqual(['Documentation is good. Documentation']);
});

test('the AutoCorrect dialog adds a replacement', async ({ page }) => {
  await fresh(page);
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.locator('.menu-item', { hasText: /^AutoCorrect✓?While Typing/ }).first().hover();
  await page.locator('.menu-item', { hasText: /^AutoCorrect Options/ }).first().click();
  const dlg = page.getByRole('dialog', { name: 'AutoCorrect' });
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.acor-list tr').first()).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Replace', exact: true }).fill('lwb');
  await dlg.getByRole('textbox', { name: 'With', exact: true }).fill('OfficeTab');
  await dlg.getByRole('button', { name: 'New' }).click();
  await dlg.getByRole('tab', { name: 'Options', exact: true }).click();
  await expect(dlg.getByRole('checkbox', { name: /^\[T\] Bulleted and numbered lists\. Bullet symbol/ })).toBeChecked();
  await dlg.getByRole('button', { name: 'OK' }).click();
  await page.getByTestId('document-input').focus();
  await page.keyboard.type('Try lwb ');
  expect(await texts(page)).toEqual(['Try OfficeTab ']);
});

test('a selected image or formula is copied, cut and pasted, and an object under the pointer gets a frame', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('x');
  await page.evaluate(async () => {
    const cv = new OffscreenCanvas(40, 20), g = cv.getContext('2d')!;
    g.fillStyle = '#cfe3ff'; g.fillRect(0, 0, 40, 20);
    const c = (globalThis as any).__writer;
    await c.insertImageFile(await cv.convertToBlob({ type: 'image/png' }));
    c.sh.SelectFly(null); c.sh.EndDoc(); c.sh.InsertObjectStarMath('a over b'); c.sh.SelectFly(null); c.notify();
  });
  const flys = () => model<string[]>(page, 'sh.m_pDoc.GetFlyFormats().map((f) => f.name)');
  expect(await flys()).toEqual(['Object1', 'Image1']);
  // The native clipboard events, as the shortcuts send them to the document's input.
  const clip = (type: 'copy' | 'cut' | 'paste', data?: Record<string, string>) => page.evaluate(([type, data]) => {
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(data ?? {})) dt.setData(k, v);
    document.querySelector('[data-testid="document-input"]')!.dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
    return { 'text/html': dt.getData('text/html'), 'text/plain': dt.getData('text/plain') };
  }, [type, data] as const);
  await model(page, 'sh.SelectFly("Image1")');
  const image = await clip('copy');
  expect(image['text/html']).toMatch(/^<img data-lo-clip="\w+" alt="" src="data:image\/png;base64,/);
  await clip('paste', image);
  expect((await flys()).sort()).toEqual(['Image1', 'Image2', 'Object1']);
  await model(page, 'sh.SelectFly("Object1")');
  const formula = await clip('cut');
  expect(formula['text/plain']).toBe('a over b');
  expect((await flys()).sort()).toEqual(['Image1', 'Image2']);
  await model(page, '(sh.SelectFly(null), sh.SttDoc())');
  await clip('paste', formula);
  expect(await model(page, '[sh.GetFlyFrameFormat()?.m_aName, sh.GetFlyFrameFormat()?.m_pMath?.m_sText]')).toEqual(['Object1', 'a over b']);
  // Other clipboard content is pasted as before: plain text.
  await model(page, 'sh.SelectFly(null)');
  await clip('paste', { 'text/plain': 'z' });
  expect((await texts(page))[0]).toContain('z');

  // Hovering an object frames it; moving off it removes the frame.
  await model(page, '(sh.SelectFly(null), globalThis.__writer.notify())');
  const box = await page.evaluate(() => {
    const c = (globalThis as any).__writer;
    const r = c.sh.m_pRoot.FindFly('Image1').fly.aFrame;
    const s = document.querySelector('.editwin-spacer')!.getBoundingClientRect();
    const f = c.zoom / 15;
    return { x: s.left + (r.Left() + r.Width() / 2) * f, y: s.top + (r.Top() + r.Height() / 2) * f, w: r.Width() * f };
  });
  const hover = page.locator('.editwin-hover');
  await expect(hover).toBeHidden();
  await page.mouse.move(box.x, box.y);
  await expect(hover).toBeVisible();
  expect((await hover.boundingBox())!.width).toBeCloseTo(box.w, 0);
  await page.screenshot({ path: 'test-results/object-hover.png' });
  await page.mouse.move(box.x, box.y + 400);
  await expect(hover).toBeHidden();
  expect(errors).toEqual([]);
});

test('Insert > Field: title, subject and author, and the Fields dialog', async ({ page }) => {
  const errors = await fresh(page);
  await model(page, '(() => { const p = sh.m_pDoc.m_xDocProps; p.setTitle("Report"); p.setSubject("Fields"); p.setAuthor("Ada"); })()');
  await page.keyboard.type('one two three ');
  const field = async (item: string) => {
    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Field ›', exact: true }).hover();
    const it = page.getByRole('menuitem', { name: new RegExp(`^${item.replace(/[.]/g, '\\.')}`) });
    await expect(it).toBeVisible();
    await it.click();
  };
  await field('Title');
  await page.keyboard.type(' ');
  await field('Subject');
  await page.keyboard.type(' ');
  await field('First Author');
  await page.keyboard.type(' ');
  // More Fields: the word count from the Document page, the fixed title from DocInformation.
  await field('More Fields...');
  const dlg = page.getByRole('dialog', { name: 'Fields' });
  await dlg.getByLabel('Type').selectOption({ label: 'Statistics' });
  await dlg.getByLabel('Select').selectOption({ label: 'Words' });
  await dlg.getByLabel('Format').selectOption({ label: 'I, II, III, ...' });
  await dlg.getByRole('button', { name: 'Insert' }).click();
  await dlg.getByRole('tab', { name: 'DocInformation' }).click();
  await dlg.getByLabel('Type').selectOption({ label: 'Title' });
  await expect(dlg.locator('output')).toHaveText('Report');
  await dlg.getByRole('checkbox', { name: 'Fixed content' }).check();
  await page.screenshot({ path: 'test-results/fields-dialog.png' });
  await dlg.getByRole('button', { name: 'Insert' }).click();
  await dlg.getByRole('button', { name: 'Close' }).click();
  await model(page, '(() => { sh.m_pDoc.m_xDocProps.setTitle("Summary"); sh.m_pDoc.SetModified(); c.notify(); })()');
  const shown = () => model<string>(page, '(() => { sh.m_pRoot.Layout(); const f = sh.m_pRoot.pages[0].frames.find((x) => !x.pArea); return f.lines.flatMap((l) => l.portions.map((x) => x.kind === "field" ? x.aExpand : f.node.GetText().slice(x.nStart, x.nStart + x.nLen))).join(""); })()');
  // The live title follows the property, the fixed one keeps its text; three words before the
  // count (AutoCorrect capitalised the first).
  await expect.poll(shown).toBe('One two three Summary Fields Ada IIIReport');
  expect(errors).toEqual([]);
});

test('Insert > Bookmark: inserts, renames, edits the text of and deletes bookmarks; Tools > Protect Document protects them', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Alpha beta gamma');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  const open = async () => {
    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Bookmark\.\.\./ }).click();
    return page.getByRole('dialog', { name: 'Bookmark' });
  };
  let dlg = await open();
  await expect(dlg.getByLabel('Name:')).toHaveValue('Bookmark 1');
  await dlg.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dlg).toBeHidden();
  const marks = () => model<string[][]>(page, 'sh.getIDocumentMarkAccess().getBookmarks().map((m) => [m.GetName(), m.GetMarkStart().GetNode().GetText().slice(m.GetMarkStart().GetContentIndex(), m.GetMarkEnd().GetContentIndex())])');
  expect(await marks()).toEqual([['Bookmark 1', 'beta']]);
  // A forbidden character disables Insert and says which ones are forbidden.
  dlg = await open();
  await dlg.getByLabel('Name:').fill('a#b');
  await expect(dlg.getByRole('alert')).toContainText('Forbidden characters:');
  await expect(dlg.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  // Edit Text, then Rename in its own dialog.
  await dlg.getByRole('row', { name: /Bookmark 1/ }).click();
  await dlg.getByRole('button', { name: 'Edit Text' }).click();
  await dlg.getByRole('textbox', { name: 'Text' }).fill('delta');
  await dlg.getByRole('textbox', { name: 'Text' }).press('Enter');
  expect(await texts(page)).toEqual(['Alpha delta gamma']);
  await dlg.getByRole('row', { name: /Bookmark 1/ }).click();
  await dlg.getByRole('button', { name: 'Rename' }).click();
  const ren = page.getByRole('dialog', { name: 'Rename object: Bookmark 1' });
  await ren.getByLabel('New name:').fill('Greek');
  await page.screenshot({ path: 'test-results/bookmark-rename.png' });
  await ren.getByRole('button', { name: 'OK' }).click();
  await expect(ren).toBeHidden();
  await expect(dlg.getByRole('row', { name: /Greek/ })).toBeVisible();
  await dlg.getByRole('row', { name: /Greek/ }).click();
  await expect(dlg.getByLabel('Name:')).toHaveValue('Greek');
  await expect(dlg.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/bookmark-dialog.png' });
  await dlg.getByRole('button', { name: 'Close' }).click();
  expect(await marks()).toEqual([['Greek', 'delta']]);
  // Protected, the bookmark's text cannot be deleted and the dialog does not delete it.
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Protect Document/ }).hover();
  await page.getByRole('menuitem', { name: 'Protect Bookmarks' }).click();
  expect(await model<boolean>(page, 'sh.m_pDoc.m_bProtectBookmarks')).toBe(true);
  await page.getByTestId('document-input').focus();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press('Backspace');
  expect(await texts(page)).toEqual(['Alpha delta gamma']);
  dlg = await open();
  await dlg.getByRole('row', { name: /Greek/ }).click();
  await expect(dlg.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await dlg.getByRole('button', { name: 'Close' }).click();
  expect(errors).toEqual([]);
});

test('Fields dialog, Variables page: variables, formulas, user fields and an input field with its dialog', async ({ page }) => {
  const errors = await fresh(page);
  await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Field ›', exact: true }).hover();
  await page.getByRole('menuitem', { name: /^More Fields\.\.\./ }).click();
  const dlg = page.getByRole('dialog', { name: 'Fields' });
  await dlg.getByRole('tab', { name: 'Variables' }).click();
  // Set variable: price = 12.5 in the -1234.57 format.
  await dlg.getByRole('textbox', { name: 'Name', exact: true }).fill('price');
  await dlg.getByRole('textbox', { name: 'Value', exact: true }).fill('12.5');
  await dlg.getByRole('listbox', { name: /^Format/ }).selectOption({ label: '-1234.57' });
  await dlg.getByRole('button', { name: 'Insert' }).click();
  // Show variable: the first variable is selected with its name.
  await dlg.getByLabel('Type').selectOption({ label: 'Show variable' });
  await expect(dlg.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('price');
  await dlg.getByRole('button', { name: 'Insert' }).click();
  await dlg.getByLabel('Type').selectOption({ label: 'Insert Formula' });
  await dlg.getByRole('textbox', { name: 'Formula', exact: true }).fill('price*2');
  await dlg.getByRole('button', { name: 'Insert' }).click();
  // A user field made with Apply, then inserted.
  await dlg.getByLabel('Type').selectOption({ label: 'User Field' });
  await dlg.getByRole('textbox', { name: 'Name', exact: true }).fill('vat');
  await dlg.getByRole('textbox', { name: 'Value', exact: true }).fill('0.19');
  await dlg.getByRole('listbox', { name: /^Format/ }).selectOption({ label: 'General' });
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await expect(dlg.getByLabel('Select')).toContainText('vat');
  await page.screenshot({ path: 'test-results/fields-variables.png' });
  await dlg.getByRole('button', { name: 'Insert' }).click();
  // An input field of price asks for its value at once.
  await dlg.getByLabel('Type').selectOption({ label: 'Input field' });
  await dlg.getByRole('textbox', { name: 'Reference', exact: true }).fill('New price?');
  await dlg.getByRole('button', { name: 'Insert' }).click();
  const input = page.getByRole('dialog', { name: 'Input Field' });
  await expect(input).toContainText('New price?');
  await input.getByRole('textbox').fill('20');
  await input.getByRole('button', { name: 'OK' }).click();
  const shown = () => model<string>(page, '(() => { sh.m_pRoot.Layout(); const f = sh.m_pRoot.pages[0].frames.find((x) => !x.pArea); return f.lines.flatMap((l) => l.portions.map((x) => x.kind === "field" ? `[${x.aExpand}]` : f.node.GetText().slice(x.nStart, x.nStart + x.nLen))).join(""); })()');
  await expect.poll(shown).toBe('[12.50][12.50][25.00][0.19][20]');
  expect(errors).toEqual([]);
});

test('Index entries and citations: insert, edit and delete through their dialogs', async ({ page }) => {
  const errors = await fresh(page);
  await page.keyboard.type('Cold weather and cold winds. ');
  const menu = async (top: string, sub: string, item: RegExp) => {
    await page.getByRole('menuitem', { name: top, exact: true }).click();
    await page.getByRole('menuitem', { name: sub, exact: true }).hover();
    const it = page.getByRole('menuitem', { name: item });
    await expect(it).toBeVisible();
    await it.click();
  };
  // Without a selection the word at the cursor is the entry; applied to all occurrences, any case.
  await model(page, '(() => { sh.SelectRange(paras()[0], 1, 1); globalThis.__writer.notify(); })()');
  await menu('Insert', 'Table of Contents and Index ›', /^Index Entry\.\.\./);
  const dlg = page.getByRole('dialog', { name: 'Insert Index Entry' });
  await expect(dlg.getByLabel('Index:')).toHaveValue('1');
  await expect(dlg.getByRole('textbox', { name: 'Entry:' })).toHaveValue('Cold');
  await dlg.getByRole('combobox', { name: '1st key:' }).fill('weather');
  await dlg.getByLabel('Apply to all other occurrences').check();
  await page.screenshot({ path: 'test-results/index-entry.png' });
  await dlg.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dlg).toBeHidden();
  const marks = () => model<string>(page, '(() => { const o = []; for (const h of paras()[0].m_aHints) for (const m of h.aAttrs.RES_TXTATR_TOXMARK ?? []) o.push(`${h.nStart}-${h.nEnd}:${m.GetPrimaryKey()}`); return o.join(" "); })()');
  expect(await marks()).toBe('0-4:weather 17-21:weather');
  // Edit > Reference > Index Entry for the second mark: travel back, change the key, then delete one.
  await model(page, '(() => { sh.SelectRange(paras()[0], 18, 18); globalThis.__writer.notify(); })()');
  await menu('Edit', 'Reference ›', /^Edit Index Entry\.\.\./);
  const edit = page.getByRole('dialog', { name: 'Edit Index Entry' });
  await expect(edit.getByRole('textbox', { name: 'Entry:' })).toHaveValue('cold');
  await edit.getByRole('button', { name: 'Previous entry', exact: true }).click();
  await expect(edit.getByRole('textbox', { name: 'Entry:' })).toHaveValue('Cold');
  await edit.getByRole('combobox', { name: '1st key:' }).fill('climate');
  await edit.getByRole('button', { name: 'OK' }).click();
  expect(await marks()).toBe('0-4:climate 17-21:weather');
  await model(page, '(() => { sh.SelectRange(paras()[0], 18, 18); globalThis.__writer.notify(); })()');
  await menu('Edit', 'Reference ›', /^Edit Index Entry\.\.\./);
  await page.getByRole('dialog', { name: 'Edit Index Entry' }).getByRole('button', { name: 'Delete' }).click();
  // DelHdl: without a next mark the dialog closes.
  await expect(page.getByRole('dialog', { name: 'Edit Index Entry' })).toBeHidden();
  expect(await marks()).toBe('0-4:climate');

  // A citation: a new entry defined in the document, then inserted.
  await model(page, '(() => { sh.SelectRange(paras()[0], paras()[0].Len(), paras()[0].Len()); globalThis.__writer.notify(); })()');
  await menu('Insert', 'Table of Contents and Index ›', /^Citation\.\.\./);
  const cit = page.getByRole('dialog', { name: 'Insert Citation' });
  await cit.getByRole('button', { name: 'New…' }).click();
  const def = page.getByRole('dialog', { name: 'Define Bibliography Entry' });
  await def.getByRole('textbox', { name: 'Short name' }).fill('Knuth84');
  await def.getByLabel('Type', { exact: true }).selectOption({ label: 'Book' });
  await def.getByRole('textbox', { name: 'Author(s)' }).fill('Donald Knuth');
  await def.getByRole('textbox', { name: 'Title', exact: true }).fill('The TeXbook');
  await page.screenshot({ path: 'test-results/citation-define.png' });
  await def.getByRole('button', { name: 'OK' }).click();
  await expect(cit).toContainText('Donald Knuth');
  await cit.getByRole('button', { name: 'Insert', exact: true }).click();
  const shown = () => model<string>(page, '(() => { sh.m_pRoot.Layout(); const f = sh.m_pRoot.pages[0].frames.find((x) => !x.pArea); return f.lines.flatMap((l) => l.portions.map((x) => x.kind === "field" ? `<${x.aExpand}>` : f.node.GetText().slice(x.nStart, x.nStart + x.nLen))).join(""); })()');
  await expect.poll(shown).toBe('Cold weather and cold winds. <[Knuth84]>');
  // Edit > Reference > Citation renames the short name of the citation at the cursor.
  await model(page, '(() => { const n = paras()[0]; sh.SelectRange(n, n.Len() - 1, n.Len() - 1); globalThis.__writer.notify(); })()');
  await menu('Edit', 'Reference ›', /^Citation\.\.\./);
  const editCit = page.getByRole('dialog', { name: 'Edit Citation' });
  await expect(editCit).toContainText('The TeXbook');
  await editCit.getByRole('textbox', { name: 'Short name' }).fill('Knuth86');
  await editCit.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(shown).toBe('Cold weather and cold winds. <[Knuth86]>');
  expect(errors).toEqual([]);
});

test('View > Screen View lays the page out at the window width, and the rulers and grid are shown and kept', async ({ page }) => {
  const errors = await fresh(page);
  const view = async (...path: string[]) => {
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
    // Names carry a check mark, a submenu arrow or a shortcut around the label.
    for (const name of path) await page.getByRole('menuitem', { name: new RegExp(`^(✓ )?${name}( ›| \\S+)?$`) }).last().click();
  };
  // Paper View by default, without rulers.
  await expect(page.getByTestId('hruler')).toHaveCount(0);
  await expect(page.getByTestId('vruler')).toHaveCount(0);
  expect(await model<boolean>(page, 'c.viewOpt.getBrowseMode()')).toBe(false);
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '✓ Paper View' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Screen View', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('document-input').focus();
  await page.keyboard.type('Screen view text');
  await view('Screen View');
  expect(await model<boolean>(page, 'c.viewOpt.getBrowseMode()')).toBe(true);
  // The page is as wide as the visible area (in twips at 100%: 15 per CSS pixel).
  const widths = await model<number[]>(page, '[sh.m_pRoot.pages[0].aFrame.Width(), sh.m_pRoot.maVisArea.Width()]');
  expect(widths[0]).toBe(widths[1]);
  await view('Paper View');
  expect(await model<number>(page, 'sh.m_pRoot.pages[0].aFrame.Width()')).toBe(11906);

  // View > Rulers > Rulers shows the horizontal ruler, above the document.
  await view('Rulers', 'Rulers');
  await expect(page.getByTestId('hruler')).toBeVisible();
  const canvas = await page.getByTestId('document-canvas').boundingBox();
  const ruler = await page.getByTestId('hruler').boundingBox();
  expect(canvas!.y).toBeCloseTo(ruler!.y + ruler!.height, 0);
  await view('Rulers', 'Vertical Ruler');
  await expect(page.getByTestId('vruler')).toBeVisible();
  await view('Grid and Helplines', 'Display Grid');
  expect(await model<boolean>(page, 'c.viewOpt.IsGridVisible()')).toBe(true);
  // Kept in this browser, like LibreOffice's user profile.
  await page.reload();
  await expect(page.getByTestId('vruler')).toBeVisible();
  expect(await model<boolean>(page, 'c.viewOpt.IsGridVisible()')).toBe(true);
  // View > Rulers > Rulers hides both.
  await view('Rulers', 'Rulers');
  await expect(page.getByTestId('hruler')).toHaveCount(0);
  await expect(page.getByTestId('vruler')).toHaveCount(0);
  expect(errors).toEqual([]);
});
