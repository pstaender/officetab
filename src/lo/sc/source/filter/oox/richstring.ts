// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/richstring.cxx reduced
// @upstream sc/source/filter/oox/richstringcontext.cxx reduced
// @upstream sc/source/filter/oox/sharedstringsbuffer.cxx reduced
// RichString: the text runs of a shared or inline string (si/is: t, r with rPr) and their
// conversion to a plain string or an EditTextObject (one paragraph per line), and the
// SharedStringsBuffer of sharedStrings.xml. Reduced: phonetic runs (rPh, phoneticPr) are not kept
// (reported through mbHasPhonetic); the BIFF12 records are not read.
import { EditTextObject, type EditCharAttribs, type EditParagraph } from '../../../../editeng/source/editeng/editobj.ts';
import { decodeXString } from '../../../../oox/source/helper/attributelist.ts';
import type { XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { Font, kid, kids, ln, type StylesBuffer } from './stylesbuffer.ts';

const textOf = (e: XmlElement): string => e.children.map((c) => (typeof c === 'string' ? c : '')).join('');

export class RichStringPortion {
  maText = '';
  mxFont: Font | null = null;

  setText(rText: string): void { this.maText = decodeXString(rText); }
  hasFont(): boolean { return !!this.mxFont; }

  finalizeImport(): void { this.mxFont?.finalizeImport(); }
}

export class RichString {
  maTextPortions: RichStringPortion[] = [];
  mbHasPhonetic = false;

  /** RichStringContext: an si or is element (t, or r runs of rPr and t). */
  importString(rEl: XmlElement, rStyles: StylesBuffer): void {
    for (const e of kids(rEl)) {
      switch (ln(e)) {
        case 't': this.createPortion().setText(textOf(e)); break;
        case 'r': {
          const p = this.createPortion();
          const rPr = kid(e, 'rPr');
          if (rPr) { p.mxFont = new Font(rStyles, true); p.mxFont.importFont(rPr); }
          const t = kid(e, 't');
          if (t) p.setText(textOf(t));
          break;
        }
        case 'rPh': this.mbHasPhonetic = true; break;
      }
    }
  }

  finalizeImport(): void { for (const p of this.maTextPortions) p.finalizeImport(); }

  getStringContent(): string { return this.maTextPortions.map((p) => p.maText).join(''); }

  /** extractPlainString: the text if no rich text is needed (null otherwise). Upstream refuses
      strings with phonetic portions; those are reduced to plain runs here. */
  extractPlainString(pFirstPortionFont: Font | null): string | null {
    if (!this.maTextPortions.length) return '';
    if ((this.maTextPortions.length === 1) && !this.maTextPortions[0]!.hasFont() && !(pFirstPortionFont?.needsRichTextFormat())) {
      const s = this.maTextPortions[0]!.maText;
      return s.includes('\n') ? null : s;
    }
    return null;
  }

  /** convert: the edit text, the first portion getting the cell's font if that needs rich text. */
  convert(pFirstPortionFont: Font | null): EditTextObject {
    const aParas: EditParagraph[] = [{ aText: '', maCharAttribs: [] }];
    for (const rTextPortion of this.maTextPortions) {
      const pFontToUse = rTextPortion.mxFont ?? (pFirstPortionFont?.needsRichTextFormat() ? pFirstPortionFont : null);
      pFirstPortionFont = null;
      const a: EditCharAttribs | null = pFontToUse ? pFontToUse.fillToEditAttribs() : null;
      const lines = rTextPortion.maText.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) aParas.push({ aText: '', maCharAttribs: [] });
        const p = aParas[aParas.length - 1]!;
        if (a && line && Object.keys(a).length) p.maCharAttribs.push({ nStart: p.aText.length, nEnd: p.aText.length + line.length, aAttribs: { ...a } });
        p.aText += line;
      });
    }
    return new EditTextObject(aParas);
  }

  private createPortion(): RichStringPortion {
    const p = new RichStringPortion();
    this.maTextPortions.push(p);
    return p;
  }
}

/** SharedStringsBuffer with SharedStringsFragment: the si elements of sharedStrings.xml. */
export class SharedStringsBuffer {
  private maStrings: RichString[] = [];

  importSharedStrings(rSst: XmlElement | undefined, rStyles: StylesBuffer): void {
    for (const si of kids(rSst, 'si')) {
      const s = new RichString();
      s.importString(si, rStyles);
      this.maStrings.push(s);
    }
  }

  finalizeImport(): void { for (const s of this.maStrings) s.finalizeImport(); }

  getString(nStringId: number): RichString | null { return this.maStrings[nStringId] ?? null; }
  hasPhonetic(): boolean { return this.maStrings.some((s) => s.mbHasPhonetic); }
}
