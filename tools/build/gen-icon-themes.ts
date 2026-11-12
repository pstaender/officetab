// Writes src/app/generated/icons-line-md.json: the "Material Line Icons" theme (line-md by
// Vjacheslav Trushkin, MIT, from @iconify-json/line-md) for the commands it has a fitting icon for.
// Commands without one keep their Colibre icon. line-md icons draw themselves with SMIL
// animations; toolbar icons must not, so each is frozen at its last frame here.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT } from '../upstream/lib.ts';

const require = createRequire(import.meta.url);
const set = require('@iconify-json/line-md/icons.json') as { icons: Record<string, { body: string }>; width: number; height: number };

/** The line-md icon for each command (only where the meaning matches). */
const LINE_MD: Record<string, string> = {
  '.uno:AddDirect': 'document-add', '.uno:NewDoc': 'document-add', '.uno:Open': 'folder', '.uno:OpenFromWriter': 'folder',
  '.uno:Save': 'file-download', '.uno:SaveAs': 'file-export', '.uno:SetDocumentProperties': 'file-document',
  '.uno:Copy': 'text-box-multiple', '.uno:Paste': 'clipboard-arrow',
  '.uno:Undo': 'u-turn-left', '.uno:Redo': 'u-turn-right', '.uno:SearchDialog': 'search', '.uno:Zoom100Percent': 'search',
  '.uno:SpellingAndGrammarDialog': 'check-all', '.uno:WordCountDialog': 'document-report',
  '.uno:InsertGraphic': 'image', '.uno:HyperlinkDialog': 'link', '.uno:InsertSection': 'text-box',
  '.uno:InsertMultiIndex': 'document-list', '.uno:InsertDateField': 'calendar', '.uno:InsertPageNumberField': 'hash',
  '.uno:InsertPageCountField': 'hash-small', '.uno:EditStyle': 'edit',
  '.uno:InsertAnnotation': 'chat', '.uno:DeleteComment': 'chat-off',
  '.uno:TrackChanges': 'pencil', '.uno:NextTrackedChange': 'chevron-right', '.uno:PreviousTrackedChange': 'chevron-left',
  '.uno:AcceptTrackedChange': 'confirm', '.uno:RejectTrackedChange': 'close', '.uno:AcceptTrackedChangeToNext': 'confirm-circle',
  '.uno:RejectTrackedChangeToNext': 'close-circle', '.uno:AcceptAllTrackedChanges': 'check-all', '.uno:RejectAllTrackedChanges': 'close-square',
  '.uno:LeftPara': 'align-left', '.uno:CenterPara': 'align-center', '.uno:RightPara': 'align-right', '.uno:JustifyPara': 'align-justify',
  '.uno:CellVertTop': 'valign-top', '.uno:CellVertCenter': 'valign-middle', '.uno:CellVertBottom': 'valign-bottom',
  '.uno:DefaultBullet': 'list', '.uno:IncrementIndent': 'list-indented', '.uno:DecrementIndent': 'list-indented-reversed',
  '.uno:DeleteTable': 'trash', '.uno:TableSort': 'arrows-vertical', '.uno:Protect': 'security',
  '.uno:TableDialog': 'cog', '.uno:FrameDialog': 'cog', '.uno:GraphicDialog': 'cog', '.uno:CompressGraphic': 'folder-zip',
  '.uno:ObjectAlignLeft': 'arrow-align-left', '.uno:AlignCenter': 'arrow-align-center', '.uno:ObjectAlignRight': 'arrow-align-right',
  '.uno:AlignUp': 'arrow-align-top', '.uno:AlignMiddle': 'arrow-align-middle', '.uno:AlignDown': 'arrow-align-bottom',
  '.uno:BringToFront': 'chevron-double-up', '.uno:ObjectForwardOne': 'chevron-up', '.uno:ObjectBackOne': 'chevron-down', '.uno:SendToBack': 'chevron-double-down',
  '.uno:FlipVertical': 'double-arrow-vertical', '.uno:FlipHorizontal': 'double-arrow-horizontal',
  '.uno:RotateLeft': 'rotate-270', '.uno:RotateRight': 'rotate-90', '.uno:Rotate180': 'rotate-180', '.uno:RotateReset': 'backup-restore',
  '.uno:ToggleObjectRotateMode': 'round-360', '.uno:ZoomMinus': 'minus-circle', '.uno:ZoomPlus': 'plus-circle',
};

interface El { tag: string; attrs: [string, string][]; children: (El | string)[] }

function parse(src: string): El {
  const root: El = { tag: '', attrs: [], children: [] };
  const stack = [root];
  for (const m of src.matchAll(/<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g)) {
    const top = stack[stack.length - 1]!;
    if (m[5] !== undefined) { top.children.push(m[5]); continue; }
    if (m[1]) { stack.pop(); continue; }
    const el: El = { tag: m[2]!, attrs: [...m[3]!.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]), children: [] };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

const attr = (e: El, k: string) => e.attrs.find((a) => a[0] === k)?.[1];
function setAttr(e: El, k: string, v: string) { const a = e.attrs.find((x) => x[0] === k); if (a) a[1] = v; else e.attrs.push([k, v]); }

/** Applies each animation's end value to the element it animates and drops the animation. */
function freeze(e: El): void {
  for (const ch of e.children) if (typeof ch !== 'string') freeze(ch);
  e.children = e.children.filter((ch) => {
    if (typeof ch === 'string' || !['animate', 'set', 'animateTransform'].includes(ch.tag)) return true;
    const name = attr(ch, 'attributeName');
    const end = attr(ch, 'to') ?? attr(ch, 'values')?.split(';').pop()?.trim();
    if (name && end !== undefined && attr(ch, 'fill') === 'freeze') {
      if (ch.tag === 'animateTransform') setAttr(e, 'transform', `${attr(ch, 'type')}(${end})`);
      else setAttr(e, name, end);
    }
    return false;
  });
}

const serialize = (e: El | string): string => typeof e === 'string' ? e
  : e.tag ? `<${e.tag}${e.attrs.map(([k, v]) => ` ${k}="${v}"`).join('')}${e.children.length ? `>${e.children.map(serialize).join('')}</${e.tag}>` : '/>'}`
  : e.children.map(serialize).join('');

const out: Record<string, string> = {};
for (const [cmd, name] of Object.entries(LINE_MD)) {
  const icon = set.icons[name];
  if (!icon) throw new Error(`line-md has no icon ${name}`);
  const body = parse(icon.body);
  freeze(body);
  // A data: URL image has no inherited colour: the strokes take the toolbar's text grey.
  const svg = serialize(body).replace(/currentColor/g, '#3c4048');
  out[cmd] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${set.width} ${set.height}">${svg}</svg>`;
}
const pkg = JSON.parse(readFileSync(require.resolve('@iconify-json/line-md/package.json'), 'utf8')) as { version: string };
writeFileSync(join(ROOT, 'src/app/generated/icons-line-md.json'), `${JSON.stringify(out)}\n`);
console.log(`line-md ${pkg.version}: ${Object.keys(out).length} command icons`);
