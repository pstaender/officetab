// Generates src/app/generated/dictionaries.json: the Hunspell spelling dictionaries of
// LibreOffice's dictionaries repository at the pinned release, as their dictionaries.xcu
// files describe them (files and locales). The app loads a dictionary's files on demand.
import { readFileSync, writeFileSync } from 'node:fs';

const { tag } = JSON.parse(readFileSync('upstream.json', 'utf8')) as { tag: string };
const BASE = `https://cdn.jsdelivr.net/gh/LibreOffice/dictionaries@${tag}`;
// jsDelivr serves files up to 20 MB; larger ones come from GitHub directly.
const FALLBACK = `https://raw.githubusercontent.com/LibreOffice/dictionaries/${tag}`;
// The repository's language folders (dictionaries/Module_dictionaries.mk).
const DIRS = ['af_ZA', 'an_ES', 'ar', 'be_BY', 'bg_BG', 'bn_BD', 'bo', 'br_FR', 'bs_BA', 'ca', 'ckb', 'cs_CZ', 'da_DK', 'de', 'el_GR', 'en', 'eo', 'es', 'et_EE', 'fa_IR', 'fr_FR', 'gd_GB', 'gl', 'gu_IN', 'gug', 'he_IL', 'hi_IN', 'hr_HR', 'hu_HU', 'id', 'is', 'it_IT', 'kmr_Latn', 'ko_KR', 'lo_LA', 'lt_LT', 'lv_LV', 'mn_MN', 'nl_NL', 'no', 'oc_FR', 'pl_PL', 'pt_BR', 'pt_PT', 'ro', 'ru_RU', 'si_LK', 'sk_SK', 'sl_SI', 'sq_AL', 'sr', 'sv_SE', 'sw_TZ', 'te_IN', 'th_TH', 'tr_TR', 'uk_UA', 'vi'];

interface Dict { locale: string; aff: string; dic: string }
const out: Dict[] = [];
/** Whether a file exists at the CDN; jsDelivr answers 403 while it fetches a file first, so retry. */
async function exists(path: string): Promise<boolean> {
  const raw = await fetch(`${FALLBACK}/${path}`, { headers: { Range: 'bytes=0-0' } });
  await raw.arrayBuffer().catch(() => undefined);
  if (raw.status === 404) return false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(`${BASE}/${path}`, { headers: { Range: 'bytes=0-0' } });
    await r.arrayBuffer().catch(() => undefined);
    if (r.ok) return true;
    if (r.status === 404) return false;
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  return raw.ok;
}
/** Some extensions keep the files in a dictionaries/ folder that their package build copies up. */
async function locate(dir: string, file: string): Promise<string | null> {
  for (const p of [`${dir}/${file}`, `${dir}/dictionaries/${file}`]) if (await exists(p)) return p;
  return null;
}
for (const dir of DIRS) {
  const res = await fetch(`${BASE}/${dir}/dictionaries.xcu`);
  if (!res.ok) { console.warn(`skip ${dir}: ${res.status}`); continue; }
  const xcu = await res.text();
  for (const node of xcu.matchAll(/<node oor:name="[^"]*" oor:op="fuse">([\s\S]*?)<\/node>/g)) {
    const prop = (name: string) => new RegExp(`<prop oor:name="${name}"[^>]*>\\s*<value>([^<]*)</value>`).exec(node[1]!)?.[1]?.trim();
    if (prop('Format') !== 'DICT_SPELL') continue;
    const files = (prop('Locations') ?? '').split(/\s+/).map((p) => p.replace('%origin%/', ''));
    const affName = files.find((p) => p.endsWith('.aff')), dicName = files.find((p) => p.endsWith('.dic'));
    if (!affName || !dicName) continue;
    const aff = await locate(dir, affName), dic = await locate(dir, dicName);
    if (!aff || !dic) { console.warn(`skip ${dir}/${dicName}: not found`); continue; }
    for (const locale of (prop('Locales') ?? '').split(/\s+/).filter(Boolean)) out.push({ locale, aff, dic });
  }
}
out.sort((a, b) => a.locale.localeCompare(b.locale));
writeFileSync('src/app/generated/dictionaries.json', `${JSON.stringify({ base: BASE, fallback: FALLBACK, dictionaries: out }, null, 1)}\n`);
console.log(`${out.length} spelling dictionaries`);
