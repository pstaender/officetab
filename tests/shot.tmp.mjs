import { chromium } from 'playwright';
const [out, theme] = process.argv.slice(2);
const b = await chromium.launch();
for (const scheme of ['light', 'dark']) {
const p = await b.newPage({ viewport: { width: 1400, height: 140 }, colorScheme: scheme });
await p.addInitScript((t) => localStorage.setItem('writer:icon-theme', t), theme);
await p.goto('http://localhost:4173/');
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/${theme}-classic-${scheme}.png` });
await p.evaluate(() => globalThis.__writer.setUiMode('ribbon'));
await p.waitForTimeout(200);
await p.screenshot({ path: `${out}/${theme}-home-${scheme}.png` });
await p.getByRole('tab', { name: 'Review', exact: true }).click();
await p.waitForTimeout(150);
await p.screenshot({ path: `${out}/${theme}-review-${scheme}.png` });
await p.evaluate(() => globalThis.__writer.setUiMode('classic'));
await p.close();
}
await b.close();
