// SPDX-License-Identifier: MPL-2.0
// @upstream sfx2/source/doc/objstor.cxx partial
// SfxObjectShell::SaveTo_Impl for the own format (ODT), with PutURLContentsToVersionStream_Impl
// and CreateTempCopyOfStorage_Impl: the document is written, the versions of the medium are copied
// into the new package and, given a version comment (SID_DOCINFO_COMMENTS), the saved state is
// added as a new version. Temporary files are byte arrays; the medium saved to is the document's
// own (a plain save), so the version list need not be transferred. Left out: alien formats,
// thumbnails, encryption and CMIS check-in. Also SfxObjectShell::DetectCsvSeparators (for the CSV
// filter), on a text stream.
import { DateTimeNow, type DateTime } from './SfxDocumentMetaData.ts';
import type { SfxMedium } from './docfile.ts';
import type { RevisionTag, Storage } from '../../../xmloff/source/meta/xmlversion.ts';
import type { ZipEntry } from '../../../package/source/zipapi/zip.ts';

export interface SaveToArgs {
  /** SID_DOCINFO_COMMENTS: store a version also, with this comment. */
  pVersionItem?: string;
  /** SID_DOCINFO_AUTHOR: the version's author; else the user's full name (SvtUserOptions). */
  pAuthorItem?: string;
  aUserName?: string;
  /**
   * Not upstream: the package and time of the version, when it is not the state being saved (an
   * automatic version of the state an editing session started from).
   */
  aVersionStream?: Uint8Array;
  aVersionTime?: DateTime;
}

/** SfxObjectShell::SaveTo_Impl: the package of the document, with the medium's versions. */
export async function SaveTo_Impl(
  SaveAsOwnFormat: (extra: readonly ZipEntry[]) => Promise<Uint8Array>,
  rMedium: SfxMedium,
  args: SaveToArgs = {},
): Promise<Uint8Array> {
  const pVersionItem = args.pVersionItem;
  let aTmpVersion: Uint8Array | null = null;

  // save to target
  if (pVersionItem !== undefined) aTmpVersion = args.aVersionStream ?? CreateTempCopyOfStorage_Impl(await SaveAsOwnFormat([]));

  // The streams of the new package that are not the document's.
  const xMedStorage: Storage = new Map();
  const aVersions = rMedium.GetVersionList(true);
  const xOldStorage = rMedium.GetStorage();
  if (aVersions.length && xOldStorage) {
    // copy the version streams
    for (const rVersion of aVersions) {
      const old = xOldStorage.get(`Versions/${rVersion.Identifier}`);
      if (old) xMedStorage.set(`Versions/${rVersion.Identifier}`, old);
    }
  }
  rMedium.SetStorage_Impl(xMedStorage);

  if (pVersionItem !== undefined && aTmpVersion) {
    // store a version also
    // version comment
    const aInfo: RevisionTag = {
      Identifier: '',
      Comment: pVersionItem,
      // version author
      // if not transferred as a parameter, get it from user settings
      Author: args.pAuthorItem ?? args.aUserName ?? '',
      TimeStamp: args.aVersionTime ?? { ...DateTimeNow(), NanoSeconds: 0 },
    };

    // add new version information into the versionlist and save the versionlist
    // the version list must have been transferred from the "old" medium before
    rMedium.AddVersion_Impl(aInfo);
    rMedium.SaveVersionList_Impl();
    PutURLContentsToVersionStream_Impl(aTmpVersion, xMedStorage, aInfo.Identifier);
  } else rMedium.SaveVersionList_Impl();

  // The version list first, then the versions; packed streams gain nothing from deflate.
  const extra: ZipEntry[] = [];
  const list = xMedStorage.get('VersionList.xml');
  if (list) extra.push({ name: 'VersionList.xml', data: list });
  for (const [name, data] of xMedStorage) if (name.startsWith('Versions/')) extra.push({ name, data, store: true });
  return SaveAsOwnFormat(extra);
}

/** SfxObjectShell::CreateTempCopyOfStorage_Impl: a copy of the package written so far. */
function CreateTempCopyOfStorage_Impl(xStorage: Uint8Array): Uint8Array {
  return xStorage.slice();
}

/** SfxObjectShell::PutURLContentsToVersionStream_Impl: the package as the version's stream. */
function PutURLContentsToVersionStream_Impl(aURL: Uint8Array, xDocStorage: Storage, aStreamName: string): void {
  xDocStorage.set(`Versions/${aStreamName}`, aURL);
}

/**
 * The text stream DetectCsvSeparators reads (the part of SvStream it uses): ScImportStringStream
 * implements it. ReadUniOrByteStringLine returns null where SvStream's returns false.
 */
export interface SvTextStream {
  Tell(): number;
  Seek(nPos: number): void;
  StartReadingUnicodeText(): void;
  ReadUniOrByteStringLine(nMaxCodepointsToRead?: number): string | null;
}

/**
 * SfxObjectShell::DetectCsvSeparators: the separators of a CSV text, those common separators
 * (",\t;:| \\/") that occur on the most lines with the fewest different counts per line, or
 * the one of a "sep=" first line. The stream is read as text (the encoding is the stream's);
 * cStringDelimiter '' is '"'.
 */
export function DetectCsvSeparators(stream: SvTextStream, cStringDelimiter: string): string {
  let sLine: string | null;
  const aLinesCharsCount: Map<string, number>[] = [];
  let aCharsCount = new Map<string, number>();
  const aStats = new Map<string, [number, number]>();
  const nTimeout = 500; // Timeout for detection in ms
  let nLinesCount = 0;
  let sInitSeps = '';
  const sCommonSeps = ',\t;:| \\/'; //Sorted by importance
  const usetCommonSeps = new Set<string>();
  let bIsDelimiter = false;
  // The below two are needed to handle a "not perfect" structure.
  let nMaxLinesSameChar = 0;
  let nMinDiffs = 0xFFFFFFFF;
  const nInitPos = stream.Tell();
  const nStartTime = Date.now();
  let separators = '';

  if (!cStringDelimiter) cStringDelimiter = '"';

  for (let nComSepIdx = sCommonSeps.length - 1; nComSepIdx >= 0; nComSepIdx--) usetCommonSeps.add(sCommonSeps[nComSepIdx]!);

  stream.StartReadingUnicodeText();
  while ((sLine = stream.ReadUniOrByteStringLine()) !== null && (Date.now() - nStartTime < nTimeout)) {
    if (sLine.length === 0) continue;

    if (!nLinesCount) {
      if (sLine.length === 5 && sLine.toLowerCase().startsWith('sep=')) {
        separators += sLine[4];
        break;
      } else if (sLine.length === 7 && sLine[6] === '"' && sLine.toLowerCase().startsWith('"sep=')) {
        separators += sLine[5];
        break;
      }
    }

    // Count the occurrences of each character within the line.
    // Skip strings.
    for (let i = 0; i < sLine.length; i++) {
      const p = sLine[i]!;
      if (p === cStringDelimiter) {
        bIsDelimiter = !bIsDelimiter;
        continue;
      }
      if (bIsDelimiter) continue;

      // If restricted only to common separators then skip the rest
      if (!usetCommonSeps.has(p)) continue;

      aCharsCount.set(p, (aCharsCount.get(p) ?? 0) + 1);
    }

    if (bIsDelimiter) continue;

    nLinesCount++;

    // For each character count the lines that contain it and different number of occurrences.
    // And the global maximum for the first statistic.
    for (const [cChar, nCount] of aCharsCount) {
      let aCurStats = aStats.get(cChar);
      if (!aCurStats) {
        aCurStats = [1, 1];
        aStats.set(cChar, aCurStats);
      } else {
        aCurStats[0]++; // Increment number of lines that contain the current character

        const bFound = aLinesCharsCount.some((aPrevLineChar) => aPrevLineChar.get(cChar) === nCount);
        if (!bFound) aCurStats[1]++; // Increment number of different number of occurrences.
      }

      // Update the maximum of number of lines that contain the same character. This is a global value.
      if (nMaxLinesSameChar < aCurStats[0]) nMaxLinesSameChar = aCurStats[0];
    }

    aLinesCharsCount.push(aCharsCount);
    aCharsCount = new Map();
  }

  // Compute the global minimum of different number of occurrences.
  // But only for characters which occur in a maximum number of lines (previously computed).
  for (const [, s] of aStats) if (s[0] === nMaxLinesSameChar && nMinDiffs > s[1]) nMinDiffs = s[1];

  // Compute the initial list of separators: those with the maximum lines of occurrence and
  // the minimum of different number of occurrences.
  for (const [c, s] of aStats) if (s[0] === nMaxLinesSameChar && s[1] === nMinDiffs) sInitSeps += c;

  // If forced to most common or there are multiple separators then pick up only the most common by importance.
  for (let nComSepIdx = 0; nComSepIdx < sCommonSeps.length; nComSepIdx++) {
    const c = sCommonSeps[nComSepIdx]!;
    for (let nInitSepIdx = sInitSeps.length - 1; nInitSepIdx >= 0; nInitSepIdx--) {
      if (c === sInitSeps[nInitSepIdx]) {
        separators += c;
        break;
      }
    }
  }

  stream.Seek(nInitPos);
  return separators;
}
