// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/excel/xeescher.cxx partial
// XclExpComments: the notes of a sheet as the comments part (authors sorted, as upstream) and the
// legacy VML drawing with one note shape per comment that Excel needs to show them (VmlCommentExporter
// in oox/source/export/vmlexport.cxx, reduced to the shape, its anchor and visibility). The other
// drawing objects of xeescher.cxx are not exported (they are not in the model); the note's date
// has no place in the format.
import { escapeXml } from '../../../../xmloff/source/core/xmlparse.ts';
import type { ScPostIt } from '../../core/data/column.ts';
import { FormatOoxAddress } from '../oox/addressconverter.ts';
import { WriteText } from './xecontent.ts';

export interface XclExpNote { nCol: number; nRow: number; pNote: ScPostIt }

/** The comments part. */
export function SaveCommentsXml(aNotes: XclExpNote[]): string {
  const aAuthors = [...new Set(aNotes.map((n) => n.pNote.maAuthor))].sort();
  let s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors>';
  for (const a of aAuthors) s += `<author>${escapeXml(a)}</author>`;
  s += '</authors><commentList>';
  for (const n of aNotes) {
    s += `<comment ref="${FormatOoxAddress(n.nCol, n.nRow)}" authorId="${aAuthors.indexOf(n.pNote.maAuthor)}"><text><r>${WriteText(n.pNote.maText)}</r></text></comment>`;
  }
  return `${s}</commentList></comments>`;
}

/** The VML drawing of the notes (nShapeIdBase: the drawing's shape id block, 1024 per sheet). */
export function SaveCommentsVml(aNotes: XclExpNote[], nDrawing: number): string {
  let s = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">'
    + `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${nDrawing}"/></o:shapelayout>`
    + '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>';
  aNotes.forEach((n, i) => {
    const vis = n.pNote.mbShown ? 'visible' : 'hidden';
    s += `<v:shape id="_x0000_s${nDrawing * 1024 + i + 1}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:${i + 1};visibility:${vis}" fillcolor="#ffffe1" o:insetmode="auto">`
      + '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>'
      + `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${n.nCol + 1}, 15, ${Math.max(0, n.nRow - 1)}, 2, ${n.nCol + 3}, 15, ${n.nRow + 3}, 16</x:Anchor><x:AutoFill>False</x:AutoFill>`
      + `<x:Row>${n.nRow}</x:Row><x:Column>${n.nCol}</x:Column>${n.pNote.mbShown ? '<x:Visible/>' : ''}</x:ClientData></v:shape>`;
  });
  return `${s}</xml>`;
}
