// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/app/docsh2.cxx partial
// @upstream include/sfx2/new.hxx partial
// SwDocShell::LoadStylesFromFile and the flags of SID_TEMPLATE_LOAD (Styles > Load Styles from
// Template). The file is given as its bytes, and its styles are read by the ODF import of the
// whole package, then copied with SwDoc::LoadStyles, instead of an import in styles-only mode.
// Frame styles are not ported, so LOAD_FRAME_STYLES has no effect.
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwPaM } from '../../../inc/pam.ts';
import { ImportODT } from '../../filter/xml/odt.ts';
import { readZip } from '../../../../package/source/zipapi/zip.ts';

/** SfxTemplateFlags */
export const SfxTemplateFlags = {
  NONE: 0x00,
  LOAD_TEXT_STYLES: 0x01,
  LOAD_FRAME_STYLES: 0x02,
  LOAD_PAGE_STYLES: 0x04,
  LOAD_NUM_STYLES: 0x08,
  MERGE_STYLES: 0x10,
} as const;
export type SfxTemplateFlags = number;

/** SwgReaderOption, the part LoadStylesFromFile sets. Merge is the opposite of MERGE_STYLES. */
export interface SwgReaderOption { m_bTextFormats: boolean; m_bFrameFormats: boolean; m_bPageDescs: boolean; m_bNumRules: boolean; m_bMerge: boolean }

/**
 * SID_TEMPLATE_LOAD's static choices (SwDocShell::Execute): the flags the dialog starts with,
 * text styles when nothing else is chosen.
 */
export function DefaultTemplateFlags(bText = true, bFrame = false, bPage = false, bNum = false, bMerge = false): SfxTemplateFlags {
  let nFlags: number = bFrame ? SfxTemplateFlags.LOAD_FRAME_STYLES : SfxTemplateFlags.NONE;
  if (bPage) nFlags |= SfxTemplateFlags.LOAD_PAGE_STYLES;
  if (bNum) nFlags |= SfxTemplateFlags.LOAD_NUM_STYLES;
  if (nFlags === SfxTemplateFlags.NONE || bText) nFlags |= SfxTemplateFlags.LOAD_TEXT_STYLES;
  if (bMerge) nFlags |= SfxTemplateFlags.MERGE_STYLES;
  return nFlags;
}

/** SID_TEMPLATE_LOAD: the reader options of the chosen flags. */
export function ReaderOptions(nFlags: SfxTemplateFlags): SwgReaderOption {
  return {
    m_bTextFormats: !!(nFlags & SfxTemplateFlags.LOAD_TEXT_STYLES),
    m_bFrameFormats: !!(nFlags & SfxTemplateFlags.LOAD_FRAME_STYLES),
    m_bPageDescs: !!(nFlags & SfxTemplateFlags.LOAD_PAGE_STYLES),
    m_bNumRules: !!(nFlags & SfxTemplateFlags.LOAD_NUM_STYLES),
    //different meaning between SFX_MERGE_STYLES and aOpt.SetMerge!
    m_bMerge: !(nFlags & SfxTemplateFlags.MERGE_STYLES),
  };
}

/**
 * Loads the styles of an OpenDocument file into the document. As upstream, only the own formats
 * are imported (a package with a media type); for anything else nothing happens and false is
 * returned. The styles overwrite the document's own unless `rOpt.m_bMerge`.
 */
export async function LoadStylesFromFile(doc: SwDoc, pam: SwPaM, aFile: Uint8Array, rOpt: SwgReaderOption): Promise<boolean> {
  // --> OD #i117339# - trigger import only for own formats
  let bImport = false;
  try {
    const files = await readZip(aFile);
    bImport = files.has('mimetype') && /^application\/vnd\.oasis\.opendocument\./.test(new TextDecoder().decode(files.get('mimetype')).trim());
  } catch { bImport = false; }
  if (!bImport) return false;
  const { doc: src } = await ImportODT(aFile);
  doc.LoadStyles(pam, src, { bText: rOpt.m_bTextFormats, bPage: rOpt.m_bPageDescs, bNum: rOpt.m_bNumRules, bOverwrite: !rOpt.m_bMerge });
  return true;
}
