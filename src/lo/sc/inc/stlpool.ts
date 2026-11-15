// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/stlpool.hxx reduced
// @upstream sc/source/core/data/stlpool.cxx reduced
// @upstream sc/res/xml/styles.xml faithful
// ScStyleSheetPool: the cell and page styles of a document. CreateStandardStyles makes the
// "Default" cell style and the "Default" and "Report" page styles as stlpool.cxx does, and the
// cell styles a new document gets from sc/res/xml/styles.xml (Heading, Heading 1/2, Text, Note,
// Footnote, Hyperlink, Status, Good, Neutral, Bad, Warning, Error, Accent, Accent 1-3, Result).
import type { ScItemSet } from './scitems.ts';
import { ScStyleSheet, SfxStyleFamily } from './stlsheet.ts';

export const STR_STYLENAME_STANDARD = 'Default';
export const STR_STYLENAME_REPORT = 'Report';

const pt = (n: number) => Math.round(n * 20); // points to twips

/** sc/res/xml/styles.xml as item sets: name, parent, items. */
const XML_STYLES: [string, string, ScItemSet][] = [
  ['Heading', 'Default', { ATTR_FONT_HEIGHT: pt(24), ATTR_FONT_POSTURE: false, ATTR_FONT_WEIGHT: true }],
  ['Heading 1', 'Heading', { ATTR_FONT_HEIGHT: pt(18) }],
  ['Heading 2', 'Heading', { ATTR_FONT_HEIGHT: pt(12) }],
  ['Text', 'Default', {}],
  ['Note', 'Text', {
    ATTR_BACKGROUND: '#ffffcc',
    ATTR_BORDER: { top: { color: '#808080', width: 15, style: 'solid' }, bottom: { color: '#808080', width: 15, style: 'solid' }, left: { color: '#808080', width: 15, style: 'solid' }, right: { color: '#808080', width: 15, style: 'solid' } },
    ATTR_FONT_COLOR: '#333333',
  }],
  ['Footnote', 'Text', { ATTR_FONT_COLOR: '#808080', ATTR_FONT_POSTURE: true }],
  ['Hyperlink', 'Text', { ATTR_FONT_COLOR: '#0000ee', ATTR_FONT_UNDERLINE: 'single' }],
  ['Status', 'Default', {}],
  ['Good', 'Status', { ATTR_BACKGROUND: '#ccffcc', ATTR_FONT_COLOR: '#006600' }],
  ['Neutral', 'Status', { ATTR_BACKGROUND: '#ffffcc', ATTR_FONT_COLOR: '#996600' }],
  ['Bad', 'Status', { ATTR_BACKGROUND: '#ffcccc', ATTR_FONT_COLOR: '#cc0000' }],
  ['Warning', 'Status', { ATTR_FONT_COLOR: '#cc0000' }],
  ['Error', 'Status', { ATTR_BACKGROUND: '#cc0000', ATTR_FONT_COLOR: '#ffffff', ATTR_FONT_WEIGHT: true }],
  ['Accent', 'Default', { ATTR_FONT_WEIGHT: true }],
  ['Accent 1', 'Accent', { ATTR_BACKGROUND: '#000000', ATTR_FONT_COLOR: '#ffffff' }],
  ['Accent 2', 'Accent', { ATTR_BACKGROUND: '#808080', ATTR_FONT_COLOR: '#ffffff' }],
  ['Accent 3', 'Accent', { ATTR_BACKGROUND: '#dddddd' }],
  ['Result', 'Default', { ATTR_FONT_WEIGHT: true, ATTR_FONT_POSTURE: true, ATTR_FONT_UNDERLINE: 'single' }],
];

export class ScStyleSheetPool {
  private maStyles: ScStyleSheet[] = [];

  /** Find a style by name and family. */
  Find(rName: string, eFam: SfxStyleFamily = SfxStyleFamily.Para): ScStyleSheet | null {
    return this.maStyles.find((s) => s.GetFamily() === eFam && s.GetName() === rName) ?? null;
  }

  /** Find a cell style case-insensitively (FindCaseIns). */
  FindCaseIns(rName: string, eFam: SfxStyleFamily = SfxStyleFamily.Para): ScStyleSheet | null {
    const u = rName.toUpperCase();
    return this.maStyles.find((s) => s.GetFamily() === eFam && s.GetName().toUpperCase() === u) ?? this.Find(rName, eFam);
  }

  /** Make a new style; a style of another family than Page gets "Default" as parent. */
  Make(rName: string, eFam: SfxStyleFamily, rItems: ScItemSet = {}, aParent?: string, bUserDefined = true): ScStyleSheet {
    let nAdd = 1;
    let aName = rName;
    if (rName === STR_STYLENAME_STANDARD && this.Find(rName, eFam)) {
      // When updating styles from a template, Office 5.1 sometimes created
      // files with multiple default styles.
      // Create new styles in that case:
      while (this.Find(aName, eFam)) aName = STR_STYLENAME_STANDARD + String(nAdd++);
    }
    const p = new ScStyleSheet(aName, eFam, '', rItems, (n) => this.Find(n, eFam), bUserDefined);
    if (eFam !== SfxStyleFamily.Page && STR_STYLENAME_STANDARD !== aName) p.SetParent(aParent ?? STR_STYLENAME_STANDARD);
    else if (aParent) p.SetParent(aParent);
    this.maStyles.push(p);
    return p;
  }

  Remove(p: ScStyleSheet): void {
    const i = this.maStyles.indexOf(p);
    if (i >= 0) this.maStyles.splice(i, 1);
    // Children inherit the removed style's parent.
    for (const s of this.maStyles) if (s.GetFamily() === p.GetFamily() && s.GetParent() === p.GetName()) s.SetParent(p.GetParent());
  }

  /** All styles of a family. */
  GetStyles(eFam: SfxStyleFamily = SfxStyleFamily.Para): ScStyleSheet[] { return this.maStyles.filter((s) => s.GetFamily() === eFam); }

  /** The "Default" cell style. */
  GetStandardStyle(): ScStyleSheet { return this.Find(STR_STYLENAME_STANDARD)!; }

  CreateStandardStyles(): void {
    // Cell format templates:
    // 1. Standard
    this.Make(STR_STYLENAME_STANDARD, SfxStyleFamily.Para, {}, undefined, false);
    // Page format template:
    // 1. Standard
    this.Make(STR_STYLENAME_STANDARD, SfxStyleFamily.Page, {}, undefined, false);
    // 2. Report
    this.Make(STR_STYLENAME_REPORT, SfxStyleFamily.Page, {}, undefined, false);
    // The styles of a new document (sc/res/xml/styles.xml).
    for (const [aName, aParent, aItems] of XML_STYLES) this.Make(aName, SfxStyleFamily.Para, aItems, aParent, false);
  }

  /** Copy the styles of another pool (CopyStdStylesFrom / for the clip and undo documents). */
  CopyStylesFrom(rSrc: ScStyleSheetPool): void {
    this.maStyles = [];
    for (const s of rSrc.maStyles) {
      const fam = s.GetFamily();
      const p = new ScStyleSheet(s.GetName(), fam, '', s.GetItemSet(), (n) => this.Find(n, fam), s.IsUserDefined());
      this.maStyles.push(p);
    }
    for (const s of rSrc.maStyles) this.Find(s.GetName(), s.GetFamily())!.SetParent(s.GetParent());
  }
}
