// md_parse for the Markdown filter: markdown-it (CommonMark with GitHub's tables and
// strikethrough) drives md4c's callbacks (sw/source/filter/md/swmd.ts), as md4c does with
// MD_DIALECT_GITHUB | MD_FLAG_WIKILINKS. Task list items and wiki links, which markdown-it leaves
// to plugins, are recognised here.
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { MD_BLOCK, MD_SPAN, MD_TEXT, type MD_ALIGN, type MD_DETAIL, type MD_PARSER } from '@lo/sw/source/filter/md/swmd.ts';

const md = new MarkdownIt({ html: true, linkify: true }).enable(['table', 'strikethrough']);

/** Emits a text with [[target|label]] wiki links as MD_SPAN_WIKILINK spans. */
function textWithWikiLinks(text: string, p: MD_PARSER): void {
  let last = 0;
  for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    if (m.index! > last) p.text(MD_TEXT.NORMAL, text.slice(last, m.index));
    p.enter_span(MD_SPAN.WIKILINK, { target: m[1]!.trim() });
    p.text(MD_TEXT.NORMAL, (m[2] ?? m[1])!.trim());
    p.leave_span(MD_SPAN.WIKILINK, {});
    last = m.index! + m[0].length;
  }
  if (last < text.length) p.text(MD_TEXT.NORMAL, text.slice(last));
}

function inline(children: Token[], p: MD_PARSER): void {
  for (const t of children) {
    switch (t.type) {
      case 'text': textWithWikiLinks(t.content, p); break;
      case 'softbreak': p.text(MD_TEXT.SOFTBR, '\n'); break;
      case 'hardbreak': p.text(MD_TEXT.BR, '\n'); break;
      case 'em_open': p.enter_span(MD_SPAN.EM, {}); break;
      case 'em_close': p.leave_span(MD_SPAN.EM, {}); break;
      case 'strong_open': p.enter_span(MD_SPAN.STRONG, {}); break;
      case 'strong_close': p.leave_span(MD_SPAN.STRONG, {}); break;
      case 's_open': p.enter_span(MD_SPAN.DEL, {}); break;
      case 's_close': p.leave_span(MD_SPAN.DEL, {}); break;
      case 'link_open': p.enter_span(MD_SPAN.A, { href: t.attrGet('href') ?? '', title: t.attrGet('title') ?? '' }); break;
      case 'link_close': p.leave_span(MD_SPAN.A, {}); break;
      case 'image':
        p.enter_span(MD_SPAN.IMG, { src: t.attrGet('src') ?? '', title: t.attrGet('title') ?? '' });
        if (t.children?.length) inline(t.children, p);
        p.leave_span(MD_SPAN.IMG, {});
        break;
      case 'code_inline':
        p.enter_span(MD_SPAN.CODE, {});
        p.text(MD_TEXT.CODE, t.content);
        p.leave_span(MD_SPAN.CODE, {});
        break;
      case 'html_inline': p.text(MD_TEXT.HTML, t.content); break;
    }
  }
}

const align = (t: Token): MD_ALIGN => {
  const m = /text-align:\s*(left|center|right)/.exec(t.attrGet('style') ?? '');
  return (m?.[1] as MD_ALIGN | undefined) ?? 'default';
};

/** md_parse: the document's blocks and spans as md4c reports them. */
export function mdParse(text: string, p: MD_PARSER): void {
  const tokens = md.parse(text, {});
  p.enter_block(MD_BLOCK.DOC, {});
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    switch (t.type) {
      case 'paragraph_open': if (!t.hidden) p.enter_block(MD_BLOCK.P, {}); break;
      case 'paragraph_close': if (!t.hidden) p.leave_block(MD_BLOCK.P, {}); break;
      case 'heading_open': p.enter_block(MD_BLOCK.H, { level: parseInt(t.tag.slice(1), 10) }); break;
      case 'heading_close': p.leave_block(MD_BLOCK.H, {}); break;
      case 'blockquote_open': p.enter_block(MD_BLOCK.QUOTE, {}); break;
      case 'blockquote_close': p.leave_block(MD_BLOCK.QUOTE, {}); break;
      case 'bullet_list_open': p.enter_block(MD_BLOCK.UL, {}); break;
      case 'bullet_list_close': p.leave_block(MD_BLOCK.UL, {}); break;
      case 'ordered_list_open': p.enter_block(MD_BLOCK.OL, { start: parseInt(t.attrGet('start') ?? '1', 10) || 1 }); break;
      case 'ordered_list_close': p.leave_block(MD_BLOCK.OL, {}); break;
      case 'list_item_open': {
        // MD_FLAG_TASKLISTS: "[ ]" or "[x]" at the start of the item's first line.
        const first = tokens.slice(i + 1, i + 3).find((x) => x.type === 'inline');
        const head = first?.children?.[0];
        const m = head?.type === 'text' ? /^\[([ xX])\]\s+/.exec(head.content) : null;
        const d: MD_DETAIL = {};
        if (m && head) { d.is_task = true; d.task_mark = m[1]; head.content = head.content.slice(m[0].length); }
        p.enter_block(MD_BLOCK.LI, d);
        break;
      }
      case 'list_item_close': p.leave_block(MD_BLOCK.LI, {}); break;
      case 'hr': p.enter_block(MD_BLOCK.HR, {}); p.leave_block(MD_BLOCK.HR, {}); break;
      case 'code_block': case 'fence':
        p.enter_block(MD_BLOCK.CODE, { lang: t.info.trim() });
        p.text(MD_TEXT.CODE, t.content);
        p.leave_block(MD_BLOCK.CODE, {});
        break;
      case 'html_block':
        p.enter_block(MD_BLOCK.HTML, {});
        p.text(MD_TEXT.HTML, t.content);
        p.leave_block(MD_BLOCK.HTML, {});
        break;
      case 'table_open': {
        // MD_BLOCK_TABLE_DETAIL: the rows of head and body, and the columns.
        let head = 0, body = 0, cols = 0, inHead = false, firstRow = true;
        for (let k = i + 1; k < tokens.length && tokens[k]!.type !== 'table_close'; k++) {
          const x = tokens[k]!;
          if (x.type === 'thead_open') inHead = true;
          if (x.type === 'thead_close') inHead = false;
          if (x.type === 'tr_open') { if (inHead) head++; else body++; }
          if (x.type === 'tr_close') firstRow = false;
          if ((x.type === 'th_open' || x.type === 'td_open') && firstRow) cols++;
        }
        p.enter_block(MD_BLOCK.TABLE, { col_count: cols, head_row_count: head, body_row_count: body });
        break;
      }
      case 'table_close': p.leave_block(MD_BLOCK.TABLE, {}); break;
      case 'thead_open': p.enter_block(MD_BLOCK.THEAD, {}); break;
      case 'thead_close': p.leave_block(MD_BLOCK.THEAD, {}); break;
      case 'tbody_open': p.enter_block(MD_BLOCK.TBODY, {}); break;
      case 'tbody_close': p.leave_block(MD_BLOCK.TBODY, {}); break;
      case 'tr_open': p.enter_block(MD_BLOCK.TR, {}); break;
      case 'tr_close': p.leave_block(MD_BLOCK.TR, {}); break;
      case 'th_open': p.enter_block(MD_BLOCK.TH, { align: align(t) }); break;
      case 'th_close': p.leave_block(MD_BLOCK.TH, {}); break;
      case 'td_open': p.enter_block(MD_BLOCK.TD, { align: align(t) }); break;
      case 'td_close': p.leave_block(MD_BLOCK.TD, {}); break;
      case 'inline': inline(t.children ?? [], p); break;
    }
  }
  p.leave_block(MD_BLOCK.DOC, {});
}
