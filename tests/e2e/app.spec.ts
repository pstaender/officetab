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
  const spelling = page.locator('.menu-item', { hasText: 'Spelling' }).first();
  await expect(spelling).toHaveAttribute('aria-disabled', 'true');
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
