// framework's popup menu controllers (officecfg Controller.xcu, Office/UI/Controller): commands whose
// menu entry is a submenu the controller fills each time it opens. Not a port of the UNO machinery;
// each controller's fillPopupMenu is followed for its entries.
import type { Controller } from './controller.ts';
import { t } from '@shell/i18n.ts';

/** One entry of a filled popup menu: a checkable item running its command, or a separator. */
export interface PopupEntry { label?: string; checked?: boolean; run?: () => void; sep?: boolean }

/**
 * framework/source/uielement/headermenucontroller.cxx (HeaderMenuController::fillPopupMenu): a
 * checkable entry per page style of the document (IsPhysical), ticked when its header or footer is
 * on, which turns it on or off ("…?PageStyle:string=<name>&On:bool=…"). With more than one style,
 * all in the same state, "All" comes first and turns every one the other way (STR_MENU_HEADFOOTALL).
 */
function HeaderMenuController(c: Controller, bFooter: boolean): PopupEntry[] {
  const bHeader = !bFooter;
  const out: PopupEntry[] = [];
  let bAllOneState = true, bLastCheck = true, bFirstChecked = false, bFirstItemInserted = false, nCount = 0;
  // SwXStyleFamily's element names: the page styles in the document, the default one first.
  const names = [...c.sh.m_pDoc.m_aPageDescs.keys()];
  for (let n = 0; n < names.length; n++) {
    const aName = names[n]!;
    const bHeaderIsOn = c.sh.IsHeaderOn(bHeader, aName);
    out.push({ label: aName, checked: bHeaderIsOn, run: () => void c.changeHeaderOrFooter(bHeader, !bHeaderIsOn, aName) });
    if (!bFirstItemInserted) { bFirstItemInserted = true; bFirstChecked = bHeaderIsOn; }
    // Check if all entries have the same state
    if (bAllOneState && n && bHeaderIsOn !== bLastCheck) bAllOneState = false;
    bLastCheck = bHeaderIsOn;
    ++nCount;
  }
  if (bAllOneState && nCount > 1) {
    // Insert special item for all command; it depends on the check state of the first entry.
    out.unshift({ label: t('hf.all'), run: () => void c.changeHeaderOrFooter(bHeader, !bFirstChecked, '') }, { sep: true });
  }
  return out;
}

export const POPUP_CONTROLLERS: Record<string, (c: Controller) => PopupEntry[]> = {
  '.uno:InsertPageHeader': (c) => HeaderMenuController(c, false),
  '.uno:InsertPageFooter': (c) => HeaderMenuController(c, true),
};
