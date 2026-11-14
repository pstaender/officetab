// SPDX-License-Identifier: MPL-2.0
// @upstream sfx2/source/doc/objcont.cxx partial
// SfxObjectShell::UpdateDocInfoForSave, UpdateTime_Impl, IsSaveVersionOnClose,
// SetSaveVersionOnClose and ResetFromTemplate, on the document shell's part that
// SwDoc holds. The security options that remove personal information or the editing time on
// saving are not ported (they are off by default). The user's full name (SvtUserOptions) is
// passed in.
import { DateTimeNow, InvalidDateTime, type SfxDocumentMetaData } from './SfxDocumentMetaData.ts';

export interface SfxObjectShell {
  m_xDocProps: SfxDocumentMetaData;
  /** IsUseUserData */
  m_bUseUserData: boolean;
  /** SfxObjectShell_Impl::nTime: since when editing time is counted. */
  m_nTime: Date;
  /** SfxObjectShell_Impl::bSaveVersionOnClose */
  m_bSaveVersionOnClose: boolean;
  IsModified(): boolean;
  SetModified(): void;
}

export function IsSaveVersionOnClose(sh: SfxObjectShell): boolean {
  return sh.m_bSaveVersionOnClose;
}

export function SetSaveVersionOnClose(sh: SfxObjectShell, bNew: boolean): void {
  if (sh.m_bSaveVersionOnClose !== bNew) sh.SetModified();
  sh.m_bSaveVersionOnClose = bNew;
}

export function UpdateDocInfoForSave(sh: SfxObjectShell, aUserName: string, now: Date = new Date()): void {
  const xDocProps = sh.m_xDocProps;
  if (sh.IsModified()) {
    if (!sh.m_bUseUserData) {
      // remove all data pointing to the current user
      if (xDocProps.getAuthor() === aUserName) xDocProps.setAuthor('');
      xDocProps.setModifiedBy('');
      if (xDocProps.getPrintedBy() === aUserName) xDocProps.setPrintedBy('');
    } else {
      // update ModificationAuthor, revision and editing time
      xDocProps.setModificationDate(DateTimeNow(now));
      xDocProps.setModifiedBy(aUserName);
      UpdateTime_Impl(sh, now);
    }
  }
}

/**
 * A document made from a template forgets the template's user data and records the template it
 * comes from. Upstream records it only for a template found in the template folders
 * (SfxDocumentTemplates::GetFull) and loaded from a file URL: `rFileName` is that template's
 * location, empty for none. The query to update the styles from the template on loading
 * (SetQueryLoadTemplate) is not ported.
 */
export function ResetFromTemplate(sh: SfxObjectShell, rTemplateName: string, rFileName: string, now: Date = new Date()): void {
  const xDocProps = sh.m_xDocProps;
  xDocProps.setTemplateURL('');
  xDocProps.setTemplateName('');
  xDocProps.setTemplateDate(InvalidDateTime());
  xDocProps.resetUserData('', DateTimeNow(now));

  // TODO/REFACTOR:
  // Title?

  if (!rFileName) return;

  xDocProps.setTemplateURL(rFileName);
  xDocProps.setTemplateName(rTemplateName);

  xDocProps.setTemplateDate(DateTimeNow(now));
}

const DAY = 24 * 3600 * 1000;

export function UpdateTime_Impl(sh: SfxObjectShell, aNow: Date = new Date()): void {
  const i_xDocProps = sh.m_xDocProps;
  // Get old time from documentinfo
  let secs = i_xDocProps.getEditingDuration();
  const start = sh.m_nTime;
  // Do the follow only, if user has NOT changed time to the past.
  // Else add a time of 0 to aOldTime... !!!
  if (aNow.getTime() >= start.getTime()) {
    // Count of days between now and last editing
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const nDays = Math.floor((aNow.getTime() - startDay) / DAY);
    // If time of working without save greater than 1 month (!)... we add 0 to aOldTime!
    if (nDays <= 31) secs += Math.trunc((aNow.getTime() - start.getTime()) / 1000);
  }
  sh.m_nTime = aNow;
  i_xDocProps.setEditingDuration(secs);
  i_xDocProps.setEditingCycles(i_xDocProps.getEditingCycles() + 1);
}
