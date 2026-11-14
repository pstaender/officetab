import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { BROWSE_HEIGHT, DOCUMENTBORDER } from '../../src/lo/sw/source/core/layout/pagechg.ts';
import { SwViewOption } from '../../src/lo/sw/inc/viewopt.ts';
import { Size } from '../../src/lo/tools/source/generic/gen.ts';
import { StateTabWin } from '../../src/lo/sw/source/uibase/uiview/viewtab.ts';
import { SvxRuler, type SvxRulerRequest } from '../../src/lo/svx/source/dialog/svxruler.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** A shell in browse mode with a visible area of `w` × `h` twips. */
function browse(w = 9000, h = 6000) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.m_pRoot.m_pViewOpt.setBrowseMode(true);
  sh.m_pRoot.VisPortChgd(new Size(w, h));
  sh.m_pRoot.Layout();
  return sh;
}

describe('View > Screen View (browse mode)', () => {
  it('makes one page as wide as the visible area, filling its height, inside the browse border', () => {
    const sh = browse();
    sh.Insert('Hello');
    const [page] = sh.m_pRoot.pages;
    const b = sh.m_pRoot.maBrowseBorder;
    expect(sh.m_pRoot.pages).toHaveLength(1);
    expect(page!.aFrame.Width()).toBe(9000);
    expect(page!.aFrame.Height()).toBe(6000);
    expect(page!.aFrame.Left()).toBe(DOCUMENTBORDER);
    expect(page!.aPrt.Left()).toBe(DOCUMENTBORDER + b.Width());
    expect(page!.aPrt.Width()).toBe(9000 - 2 * b.Width());
    expect(page!.aPrt.Top()).toBe(DOCUMENTBORDER + b.Height());
    // The text wraps at the visible width, not at the page style's.
    sh.Insert(' word'.repeat(30));
    const frame = sh.m_pRoot.pages[0]!.frames[0]!;
    expect(frame.lines.length).toBeGreaterThan(1);
    expect(Math.max(...frame.lines.map((l) => l.nWidth))).toBeLessThanOrEqual(9000 - 2 * b.Width());
  });

  it('grows the page with its content, ignoring page breaks, headers and footers', () => {
    const sh = browse();
    for (let i = 0; i < 200; i++) { if (i) sh.SplitNode(); sh.Insert(`line ${i}`); }
    sh.ChangeHeaderOrFooter(true, true);
    sh.Insert('head');
    sh.m_pDoc.GetNodes().LastTextNode().m_aSet.RES_BREAK = 'page-before';
    sh.m_pRoot.Layout();
    const pages = sh.m_pRoot.pages;
    expect(pages).toHaveLength(1);
    expect(pages[0]!.aHeader).toBeUndefined();
    expect(pages[0]!.frames.some((f) => f.pArea === 'header')).toBe(false);
    const last = pages[0]!.frames[pages[0]!.frames.length - 1]!;
    expect(pages[0]!.aFrame.Height()).toBeGreaterThan(6000);
    expect(pages[0]!.aFrame.Height()).toBeLessThan(BROWSE_HEIGHT);
    // The page ends the browse border below its last line.
    expect(pages[0]!.aFrame.Bottom() + 1).toBe(last.nTop + last.nHeight + sh.m_pRoot.maBrowseBorder.Height());
  });

  it('lays out again when the visible width changes, and returns to pages of the page style', () => {
    const sh = browse();
    sh.Insert('x');
    expect(sh.m_pRoot.VisPortChgd(new Size(12000, 6000))).toBe(true);
    sh.m_pRoot.Layout();
    expect(sh.m_pRoot.pages[0]!.aFrame.Width()).toBe(12000);
    sh.m_pRoot.m_pViewOpt.setBrowseMode(false);
    sh.m_pRoot.Layout();
    expect(sh.m_pRoot.pages[0]!.aFrame.Width()).toBe(sh.m_pDoc.m_aPageDesc.nWidth);
    expect(sh.m_pRoot.VisPortChgd(new Size(8000, 6000))).toBe(false);
  });
});

describe('view options', () => {
  it('shows the horizontal ruler only, a 1 cm grid with one subdivision, as Writer does', () => {
    const o = new SwViewOption();
    expect(o.IsViewAnyRuler()).toBe(true);
    expect(o.IsViewHRuler()).toBe(true);
    expect(o.IsViewVRuler()).toBe(false);
    o.SetViewVRuler(true);
    expect(o.IsViewVRuler()).toBe(true);
    // View > Rulers > Rulers hides both, remembering which are chosen.
    o.SetViewAnyRuler(false);
    expect(o.IsViewHRuler()).toBe(false);
    expect(o.IsViewVRuler(true)).toBe(true);
    expect(o.GetSnapSize().Width()).toBe(567);
    expect(o.GetDivisionX()).toBe(1);
    expect(o.IsGridVisible()).toBe(false);
  });
});

describe('ruler', () => {
  /** The horizontal ruler of a shell at 100%, with its page at the window's left edge. */
  function ruler(sh: SwWrtShell) {
    const requests: SvxRulerRequest[] = [];
    const state = StateTabWin(sh)!;
    const r = new SvxRuler(true, { LogicToPixelX: (n) => Math.round((n - state.aPagePosSize.nPosX) / 15), LogicToPixelY: (n) => Math.round(n / 15), GetZoom: () => 1, ShowTrackLine: () => {} }, (q) => requests.push(q));
    r.SetOutputSizePixel(1000, 24);
    r.Update({ aPagePos: state.aPagePosSize, aLRSpace: state.aLongLR, bMarginsSizeable: state.bPageMargins, aParaItem: state.aParaLR, aTabStopItem: state.aTabStops, nDefTabDist: state.nDefTabDist, bTextRTL: false });
    // Paint once, as the window does, which places the ruler's null point.
    r.Paint({ SetLineColor() {}, SetFillColor() {}, DrawLine() {}, DrawRect() {}, DrawPolygon() {}, DrawTextCentered() {}, GetTextWidth: (s) => s.length * 5, GetTextHeight: () => 7 }, { shadow: '', darkShadow: '', light: '', face: '', window: '', dialog: '', workspace: '', appBackground: '', checked: '' });
    return { r, requests, state };
  }
  const px = (twips: number) => Math.round(twips / 15);

  it('shows the page margins and the paragraph indents of the cursor', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('text');
    sh.SetParaAttr({ RES_LR_SPACE: { left: 567, right: 0, firstLine: 283 } });
    const { state } = ruler(sh);
    expect(state.aLongLR).toEqual({ mlLeft: 1134, mlRight: 1134 });
    expect(state.aParaLR).toEqual({ left: 567, right: 0, firstLine: 283 });
    expect(state.bPageMargins).toBe(true);
  });

  it('dragging the left indent moves the first line with it and sets the paragraph indents', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('text');
    const { r, requests } = ruler(sh);
    // The left indent's triangle sits at the bottom of the ruler, at the left margin.
    const x0 = px(1134);
    const y = 20;
    expect(r.MouseButtonDown(x0, y, 1, 0)).toBe(true);
    r.Tracking(x0 + px(1134), y, false);
    r.Tracking(x0 + px(1134), y, true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ nSlot: 'SID_ATTR_PARA_LRSPACE' });
    const lr = (requests[0] as { item: { left: number; firstLine: number } }).item;
    // Snapped to the ruler's millimetres: 2 cm.
    expect(Math.abs(lr.left - 1134)).toBeLessThanOrEqual(30);
    expect(lr.firstLine).toBe(0);
  });

  it('a click between the indents sets a left tab stop relative to the indent', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('text');
    const { r, requests } = ruler(sh);
    r.MouseButtonDown(px(1134 + 1500), 12, 1, 0);
    expect(requests[0]).toMatchObject({ nSlot: 'SID_ATTR_TABSTOP' });
    const tabs = (requests[0] as { item: { pos: number; adjust: string }[] }).item;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.adjust).toBe('left');
    expect(Math.abs(tabs[0]!.pos - 1500)).toBeLessThanOrEqual(15);
  });
});
