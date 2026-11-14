import { describe, expect, it } from 'vitest';
import { ImportMarkdown } from '../../src/lo/sw/source/filter/md/swmd.ts';
import { ExportMarkdown } from '../../src/lo/sw/source/filter/md/wrtmd.ts';
import { mdParse } from '../../src/writer/markdown.ts';
import type { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';
const sample = `# Title

Some **bold**, *italic*, ~~gone~~ and \`code\` text with a [link](https://example.org).

- one
- two
  1. nested
- [x] done
- [ ] open

3. third
4. fourth

| Left | Right |
|:-|-:|
| a | **b** |

\`\`\`
let x = 1;
\`\`\`

> quoted

---

![a dot](data:image/png;base64,${PNG})
`;

const paras = (doc: SwDoc) => {
  const out: SwTextNode[] = [];
  const nodes = doc.GetNodes();
  for (let i = nodes.BodyStart(); i < nodes.GetEndOfContent().GetIndex(); i++) { const n = nodes.node(i); if (n.IsTextNode()) out.push(n); }
  return out;
};

describe('Markdown', () => {
  it('imports headings, inline formatting, lists, tables, code, quotes, rules and images', () => {
    const { doc, lost } = ImportMarkdown(sample, mdParse);
    expect(lost).toEqual([]);
    const ps = paras(doc);
    const byText = (t: string) => ps.find((p) => p.GetText().replace(/ /g, ' ').includes(t))!;
    expect(byText('Title').GetTextColl().GetName()).toBe('Heading 1');
    const body = byText('Some');
    const at = (s: string) => body.GetText().indexOf(s);
    expect(body.GetCharAttrAt('RES_CHRATR_WEIGHT', at('bold'))).toBe(true);
    expect(body.GetCharAttrAt('RES_CHRATR_POSTURE', at('italic'))).toBe(true);
    expect(body.GetCharAttrAt('RES_CHRATR_CROSSEDOUT', at('gone'))).toBe(true);
    expect(body.GetCharAttrAt('RES_CHRATR_FONT', at('code'))).toBe('Liberation Mono');
    expect(body.GetCharAttrAt('RES_TXTATR_INETFMT', at('link'))).toBe('https://example.org');
    expect(byText('nested').GetAttr('RES_PARATR_LIST_LEVEL')).toBe(1);
    expect(byText('done').GetText()).toBe('☒ done');
    expect(byText('third').m_aSet).toMatchObject({ RES_PARATR_LIST_ISRESTART: true, RES_PARATR_LIST_RESTARTVALUE: 3 });
    const cell = byText('Right');
    expect(cell.GetAttr('RES_PARATR_ADJUST')).toBe('right');
    expect(cell.FindTableBoxStartNode()).toBeTruthy();
    expect(byText('let x').GetTextColl().GetName()).toBe('Preformatted Text');
    expect(byText('quoted').GetTextColl().GetName()).toBe('Quotations');
    expect(ps.some((p) => p.GetTextColl().GetName() === 'Horizontal Line')).toBe(true);
    const img = ps.flatMap((p) => p.m_aHints).find((h) => h.aAttrs.RES_TXTATR_FLYCNT)!.aAttrs.RES_TXTATR_FLYCNT!;
    expect([img.alt, img.width]).toEqual(['a dot', 500]);
  });

  it('writes the document back as GitHub Markdown', () => {
    const md = ExportMarkdown(ImportMarkdown(sample, mdParse).doc);
    for (const piece of ['# Title', '**bold**', '*italic*', '~~gone~~', '`code`', '[link](https://example.org)', '- one', '  1. nested', '- [x] done', '- [ ] open', '3. third', '| Left | Right |', '| - | -: |', '| a | **b** |', '```\nlet x = 1;\n```', '> quoted', '___', '![a dot](data:image/png;base64,']) {
      expect(md, piece).toContain(piece);
    }
    // And the written Markdown reads back the same.
    const again = ExportMarkdown(ImportMarkdown(md, mdParse).doc);
    expect(again).toBe(md);
  });

  it('escapes Markdown characters and keeps line breaks', () => {
    const { doc } = ImportMarkdown('a \\*star\\* and a  \nbreak', mdParse);
    expect(paras(doc)[0]!.GetText()).toBe('a *star* and a\nbreak');
    expect(ExportMarkdown(doc)).toBe('a \\*star\\* and a  \nbreak\n');
  });
});
