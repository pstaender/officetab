// Calc's clipboard (ScTransferObj and the paste of ScViewFunc::PasteDataFormat, reduced): a copy
// puts the selection on the system clipboard as tab-separated text and as an HTML table, and
// keeps the clipboard document (with formulas and formats) in the page; a paste uses that
// document while the HTML still carries its token, else reads an HTML table or text from other
// applications cell by cell. Only native copy, cut and paste events touch the clipboard.
import type { ScDocument } from '@lo/sc/source/core/data/document.ts';
import { ScAddress, ScRange } from '@lo/sc/inc/address.ts';
import { InsertDeleteFlags } from '@lo/sc/inc/global.ts';
import { newId } from '@shell/appcontroller.ts';
import type { Controller } from './controller.ts';

/** The clipboard document of the last copy in this page, and the token its HTML carries. */
let lastClip: { doc: ScDocument; token: string; range: ScRange; cut: boolean } | null = null;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The text of a range as rows of tab-separated cells (the displayed texts, as Calc copies text). */
export function RangeToText(rDoc: ScDocument, r: ScRange): string[][] {
  const rows: string[][] = [];
  for (let nRow = r.aStart.Row(); nRow <= r.aEnd.Row(); nRow++) {
    if (rDoc.RowHidden(nRow, r.aStart.Tab())) continue;
    const row: string[] = [];
    for (let nCol = r.aStart.Col(); nCol <= r.aEnd.Col(); nCol++) {
      if (rDoc.ColHidden(nCol, r.aStart.Tab())) continue;
      row.push(rDoc.GetString(new ScAddress(nCol, nRow, r.aStart.Tab())));
    }
    rows.push(row);
  }
  return rows;
}

/** A cell for TSV: quoted when it has tabs, line breaks or quotes. */
const tsvCell = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Copy or cut the selection to the clipboard event's data. */
export function copySelection(c: Controller, data: DataTransfer, bCut: boolean): void {
  const view = c.view;
  const v = view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const { rRange } = v.GetSimpleArea();
  const rows = RangeToText(rDoc, rRange);
  const pClip = view.CopyToClip(bCut);
  if (!pClip) { c.setMessage(c.sh.GetLastError() ?? ''); c.sh.ClearLastError(); return; }
  const token = newId();
  data.setData('text/plain', rows.map((r) => r.map(tsvCell).join('\t')).join('\n') + (rows.length > 1 ? '\n' : ''));
  const html = `<meta name="generator" content="OfficeTab Calc ${token}"><table>${rows.map((r) => `<tr>${r.map((s) => `<td>${escapeHtml(s).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</table>`;
  data.setData('text/html', html);
  lastClip = { doc: pClip, token, range: rRange.clone(), cut: bCut };
  if (bCut) view.DeleteContents(InsertDeleteFlags.ALL & ~InsertDeleteFlags.OBJECTS);
  else c.copySource = rRange.clone();
  c.notify();
}

/** Parses tab-separated text with quoted cells into rows. */
export function ParseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** The cells of the first HTML table (or null). */
export function ParseHTMLTable(html: string): string[][] | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows: string[][] = [];
  for (const tr of table.querySelectorAll('tr')) {
    const row: string[] = [];
    for (const td of tr.querySelectorAll('td, th')) {
      for (const br of td.querySelectorAll('br')) br.replaceWith('\n');
      row.push((td.textContent ?? '').replace(/ /g, ' ').trim());
      const span = Number((td as HTMLTableCellElement).colSpan) || 1;
      for (let k = 1; k < span; k++) row.push('');
    }
    rows.push(row);
  }
  return rows;
}

/** Pastes the clipboard event's data at the cursor (the selection for the clip document). */
export function pasteClipboard(c: Controller, data: DataTransfer): void {
  const html = data.getData('text/html');
  if (lastClip && html.includes(lastClip.token)) {
    c.view.PasteFromClip(InsertDeleteFlags.ALL & ~InsertDeleteFlags.OBJECTS, lastClip.doc);
    c.copySource = null;
    c.notify();
    return;
  }
  const rows = (html && ParseHTMLTable(html)) || ParseTSV(data.getData('text/plain'));
  pasteRows(c, rows);
}

/** The pasted text's cells entered from the cursor (as Calc's text import of the clipboard does), with one undo step. */
export function pasteRows(c: Controller, rows: string[][]): void {
  if (!rows.length) return;
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const nTab = v.GetTabNo();
  const nCol0 = v.GetCurX(), nRow0 = v.GetCurY();
  const rDocFunc = v.GetDocFunc();
  rDocFunc.EnterListAction('Paste');
  let nMaxCol = nCol0;
  rows.forEach((row, i) => row.forEach((s, j) => {
    const nCol = nCol0 + j, nRow = nRow0 + i;
    if (nCol > rDoc.MaxCol() || nRow > rDoc.MaxRow()) return;
    nMaxCol = Math.max(nMaxCol, nCol);
    rDocFunc.EnterData(new ScAddress(nCol, nRow, nTab), s);
  }));
  rDocFunc.EndListAction();
  c.view.MarkRange(new ScRange(nCol0, nRow0, nTab, Math.min(nMaxCol, rDoc.MaxCol()), Math.min(nRow0 + rows.length - 1, rDoc.MaxRow()), nTab), false);
  c.copySource = null;
  c.notify();
}

/** The clipboard document of the last copy (Paste Special). */
export const getLastClip = () => lastClip;

/** A DataTransfer for the menus' Cut, Copy and Paste, which go through the async clipboard API. */
class MapTransfer {
  readonly m = new Map<string, string>();
  setData(k: string, v: string): void { this.m.set(k, v); }
  getData(k: string): string { return this.m.get(k) ?? ''; }
}

/** .uno:Copy and .uno:Cut from a menu: the async clipboard API (the keys stay native). */
export async function copyCommand(c: Controller, bCut: boolean): Promise<void> {
  const d = new MapTransfer();
  copySelection(c, d as unknown as DataTransfer, bCut);
  if (!d.m.size) return;
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([d.getData('text/html')], { type: 'text/html' }),
    'text/plain': new Blob([d.getData('text/plain')], { type: 'text/plain' }),
  })]);
}

/** .uno:Paste from a menu; with bTextOnly the text only (.uno:PasteUnformatted). */
export async function pasteCommand(c: Controller, bTextOnly = false): Promise<void> {
  const d = new MapTransfer();
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!bTextOnly && item.types.includes('text/html')) d.setData('text/html', await (await item.getType('text/html')).text());
      if (item.types.includes('text/plain')) d.setData('text/plain', await (await item.getType('text/plain')).text());
    }
  } catch {
    d.setData('text/plain', await navigator.clipboard.readText());
  }
  pasteClipboard(c, d as unknown as DataTransfer);
}

/** Paste Only Text, Value or Formula (.uno:PasteOnly…): the clipboard document's cells of that kind. */
export function pasteOnly(c: Controller, nFlags: number): void {
  if (!lastClip) return;
  c.view.PasteFromClip(nFlags, lastClip.doc);
}
