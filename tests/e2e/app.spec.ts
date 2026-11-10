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
  await page.keyboard.type('one two three');
  const r = await model<{ x: number; y: number; h: number; scrollTop: number }>(page, '(() => { const r = sh.m_pRoot.GetCharRect(paras()[0], 4); return { x: r.Left(), y: r.Top(), h: r.Height() }; })()');
  const box = (await page.getByTestId('document-canvas').boundingBox())!;
  const view = await page.evaluate(() => { const s = document.querySelector('.editwin-scroller')!; return { w: s.clientWidth, top: s.scrollTop }; });
  const size = await model<{ width: number }>(page, 'sh.m_pRoot.GetDocSize()');
  const offset = (view.w - size.width / 15) / 2;
  await page.mouse.click(box.x + offset + r.x / 15 + 0.5, box.y + (r.y + r.h / 2) / 15 - view.top);
  expect(await model(page, 'sh.m_pCursor.GetPoint().GetContentIndex()')).toBe(4);
  await page.keyboard.type('X');
  expect(await texts(page)).toEqual(['one Xtwo three']);
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
  await page.keyboard.type('persist me');
  await page.keyboard.press('Enter');
  await page.keyboard.type('line two');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+i`);
  await page.waitForTimeout(1800); // autosave debounce
  await page.reload();
  await expect.poll(() => texts(page)).toEqual(['persist me', 'line two']);
  expect(await model(page, 'paras()[0].GetCharAttrAt("RES_CHRATR_POSTURE", 1)')).toBe(true);
});

test('the app starts offline once installed', async ({ page, context }) => {
  await fresh(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.keyboard.type('x');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('document-canvas')).toBeVisible();
  await page.getByTestId('document-input').focus();
  await page.keyboard.type('offline text');
  expect((await texts(page)).join('')).toContain('offline text');
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
  await page.evaluate(() => (globalThis as unknown as { __writer: { saveAs(f: string): Promise<void> } }).__writer.saveAs('md'));
  const d = await download;
  expect(d.suggestedFilename()).toBe('notes.md');
  const md = await (await import('node:fs/promises')).readFile(await d.path(), 'utf8');
  expect(md).toContain('# Notes');
  expect(md).toContain('Some **bold** text.');
  expect(md).toContain('- one');
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
      for (const id of ['old1', 'old2']) tx.objectStore(store).put({ id, name: id, updated: Date.now(), bytes: new Uint8Array() });
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    };
  }));
  await page.keyboard.type('kept');
  await page.keyboard.press(`${mod}+o`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete old1' })).toBeVisible();
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
  expect(await model<string>(page, 'paras()[0].GetText()')).toBe('hallo Welt grün Baum Welt');
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
