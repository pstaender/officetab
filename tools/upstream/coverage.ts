// Prints how much of the Writer source closure has a TypeScript counterpart, by upstream line count.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE, ROOT, readDecls, requireCore } from './lib.ts';

requireCore();
const SCOPE = ['sw/source/core', 'sw/source/filter', 'sw/source/uibase', 'sw/source/ui', 'sw/source/writerfilter', 'sw/inc', 'editeng/source', 'svl/source', 'tools/source', 'xmloff/source', 'i18npool/source', 'vcl/source'];
const lines = (p: string) => readFileSync(join(CORE, p), 'utf8').split('\n').length;
const files = execFileSync('git', ['-C', CORE, 'ls-files', '--', ...SCOPE], { encoding: 'utf8', maxBuffer: 1 << 30 })
  .split('\n').filter((f) => /\.[ch]xx$/.test(f));
const total = files.reduce((n, f) => n + lines(f), 0);
const best = new Map<string, string>();
const rank = { reduced: 0, partial: 1, faithful: 2 } as const;
for (const d of readDecls()) {
  const cur = best.get(d.upstream) as keyof typeof rank | undefined;
  if (!cur || rank[d.status] > rank[cur]) best.set(d.upstream, d.status);
}
const sum = { faithful: 0, partial: 0, reduced: 0 } as Record<string, number>;
const cnt = { faithful: 0, partial: 0, reduced: 0 } as Record<string, number>;
for (const [p, s] of best) { sum[s]! += lines(p); cnt[s]!++; }
const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;
console.log(`Upstream scope: ${files.length} C++ files, ${total} lines`);
for (const s of ['faithful', 'partial', 'reduced']) console.log(`${s.padEnd(9)} ${String(cnt[s]).padStart(4)} files  ${String(sum[s]).padStart(8)} lines  ${pct(sum[s]!)} (lines in the upstream files touched, not lines translated)`);
// UI coverage: commands registered in the app against the entries in upstream's Writer menu.
const ui = JSON.parse(readFileSync(join(ROOT, 'src/app/generated/upstream-ui.json'), 'utf8'));
const menu = new Set<string>();
const visit = (ns: { cmd?: string; items?: unknown[] }[]) => ns.forEach((n) => { if (n.cmd) { menu.add(n.cmd.split('?')[0]!); if (n.items) visit(n.items as never); } });
visit(ui.menubar);
const impl = new Set([...readFileSync(join(ROOT, 'src/app/commands.ts'), 'utf8').matchAll(/'(\.uno:\w+)':/g)].map((m) => m[1]!));
console.log(`Menu commands implemented: ${[...menu].filter((c) => impl.has(c)).length} of ${menu.size}`);
