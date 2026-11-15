// SPDX-License-Identifier: MPL-2.0
// @upstream include/editeng/editobj.hxx reduced
// @upstream editeng/source/editeng/editobj.cxx reduced
// EditTextObject, reduced: the paragraphs of a rich text (a Calc edit cell) with character
// attribute runs. The attributes use Calc's cell item names (ATTR_FONT, ATTR_FONT_WEIGHT, ...),
// which is what an edit cell's text portions carry over the cell's pattern. Fields (URL, sheet
// name, date, page) are kept as plain text runs with a field marker; the paragraph attributes, the
// script types and the edit engine's pool are left out.

/** The character attributes of a text portion (a subset of the cell items). */
export interface EditCharAttribs {
  ATTR_FONT?: string;
  ATTR_FONT_HEIGHT?: number;
  ATTR_FONT_WEIGHT?: boolean;
  ATTR_FONT_POSTURE?: boolean;
  ATTR_FONT_UNDERLINE?: 'none' | 'single' | 'double' | 'dotted' | 'dash' | 'wave';
  ATTR_FONT_OVERLINE?: 'none' | 'single' | 'double' | 'dotted' | 'dash' | 'wave';
  ATTR_FONT_CROSSEDOUT?: boolean;
  ATTR_FONT_COLOR?: string | null;
  /** escapement in percent: >0 superscript, <0 subscript */
  ESCAPEMENT?: number;
  /** a URL field: the portion's text is its representation */
  URL?: string;
  /** a header or footer field (SvxPageField, SvxPagesField, SvxTableField, SvxDateField,
      SvxTimeField, SvxFileField / SvxExtFileField, the document title): the portion's text is its
      representation when it was read or written */
  FIELD?: SvxFieldKind;
}

/** The kinds of SvxFieldData a header or footer area holds. */
export type SvxFieldKind = 'PAGE' | 'PAGES' | 'TABLE' | 'DATE' | 'TIME' | 'FILE' | 'TITLE';

/** An attribute run within a paragraph: [nStart, nEnd) in characters. */
export interface EditCharAttrib { nStart: number; nEnd: number; aAttribs: EditCharAttribs }

export interface EditParagraph { aText: string; maCharAttribs: EditCharAttrib[] }

export class EditTextObject {
  private maContents: EditParagraph[];

  constructor(aParagraphs: EditParagraph[] = []) {
    this.maContents = aParagraphs.length ? aParagraphs.map((p) => ({ aText: p.aText, maCharAttribs: p.maCharAttribs.map((a) => ({ ...a, aAttribs: { ...a.aAttribs } })) })) : [{ aText: '', maCharAttribs: [] }];
  }

  /** An object of plain text, one paragraph per line. */
  static FromText(rText: string): EditTextObject {
    return new EditTextObject(rText.split('\n').map((aText) => ({ aText, maCharAttribs: [] })));
  }

  Clone(): EditTextObject { return new EditTextObject(this.maContents); }

  GetParagraphCount(): number { return this.maContents.length; }
  GetText(nPara: number): string { return this.maContents[nPara]?.aText ?? ''; }
  GetParagraph(nPara: number): EditParagraph | undefined { return this.maContents[nPara]; }
  GetParagraphs(): readonly EditParagraph[] { return this.maContents; }

  /** Whether any paragraph carries character attributes. */
  HasCharAttribs(): boolean { return this.maContents.some((p) => p.maCharAttribs.length > 0); }

  /** Whether the text contains a field (URL). */
  HasField(): boolean { return this.maContents.some((p) => p.maCharAttribs.some((a) => a.aAttribs.URL !== undefined || a.aAttribs.FIELD !== undefined)); }

  /** All paragraphs joined by a line feed (ScEditUtil::GetString with \n). */
  GetString(): string { return this.maContents.map((p) => p.aText).join('\n'); }

  /** Add an attribute run to a paragraph. */
  AddCharAttrib(nPara: number, nStart: number, nEnd: number, aAttribs: EditCharAttribs): void {
    this.maContents[nPara]?.maCharAttribs.push({ nStart, nEnd, aAttribs: { ...aAttribs } });
  }

  equals(r: EditTextObject): boolean { return JSON.stringify(this.maContents) === JSON.stringify(r.maContents); }
}
