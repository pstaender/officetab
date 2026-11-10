// SPDX-License-Identifier: MPL-2.0
// @upstream sfx2/source/doc/objcont.cxx partial
// SfxObjectShell::UpdateDocInfoForSave and UpdateTime_Impl, on the document shell's part that
// SwDoc holds. The security options that remove personal information or the editing time on
// saving are not ported (they are off by default). The user's full name (SvtUserOptions) is
// passed in.
import { DateTimeNow, type SfxDocumentMetaData } from './SfxDocumentMetaData.ts';

export interface SfxObjectShell {
  m_xDocProps: SfxDocumentMetaData;
  /** IsUseUserData */
  m_bUseUserData: boolean;
  /** SfxObjectShell_Impl::nTime: since when editing time is counted. */
  m_nTime: Date;
  IsModified(): boolean;
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
