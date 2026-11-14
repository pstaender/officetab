// SPDX-License-Identifier: MPL-2.0
// @upstream sfx2/source/doc/docfile.cxx partial
// SfxMedium's version list: GetVersionList, AddVersion_Impl, RemoveVersion_Impl,
// TransferVersionList_Impl and SaveVersionList_Impl, and the part of GetStorage that opens a
// version (SID_VERSION). The medium's storage is the package's streams by path; only the version
// list and the versions are kept of it, as the document itself is read by the import filter.
import { XMLVersionListPersistence, type RevisionTag, type Storage } from '../../../xmloff/source/meta/xmlversion.ts';

export class SfxMedium {
  readonly pImpl: {
    m_bVersionsAlreadyLoaded: boolean;
    aVersions: RevisionTag[];
    xStorage: Storage | null;
  };

  /** A medium on a package's streams, or with null, the medium of a new document. */
  constructor(xStorage: Storage | null = null) {
    this.pImpl = { m_bVersionsAlreadyLoaded: false, aVersions: [], xStorage: null };
    if (xStorage) {
      // Only the version list and the versions of the package are needed later.
      const kept: Storage = new Map();
      for (const [k, v] of xStorage) if (k === 'VersionList.xml' || k.startsWith('Versions/')) kept.set(k, v);
      this.pImpl.xStorage = kept;
    }
  }

  GetStorage(): Storage | null { return this.pImpl.xStorage; }

  /** Replaces the storage, after saving to a new one (SfxMedium's storage switch on DoSaveCompleted). */
  SetStorage_Impl(xStorage: Storage): void { this.pImpl.xStorage = xStorage; }

  GetVersionList(_bNoReload = false): readonly RevisionTag[] {
    // if the medium has no name, then this medium should represent a new document and can have no version info
    if ((!_bNoReload || !this.pImpl.m_bVersionsAlreadyLoaded) && !this.pImpl.aVersions.length && this.GetStorage()) {
      this.pImpl.aVersions = XMLVersionListPersistence.load(this.GetStorage());
    }

    if (!this.pImpl.m_bVersionsAlreadyLoaded) this.pImpl.m_bVersionsAlreadyLoaded = true;

    return this.pImpl.aVersions;
  }

  static GetVersionList(xStorage: Storage): RevisionTag[] {
    return XMLVersionListPersistence.load(xStorage);
  }

  AddVersion_Impl(rRevision: RevisionTag): void {
    if (!this.GetStorage()) return;

    // To determine a unique name for the stream
    const aLongs: number[] = [];
    for (const rVersion of this.pImpl.aVersions) {
      const nVer = parseInt(rVersion.Identifier.slice(7), 10) >>> 0;
      let n: number;
      for (n = 0; n < aLongs.length; ++n) if (nVer < aLongs[n]!) break;

      aLongs.splice(n, 0, nVer);
    }

    let nKey: number;
    for (nKey = 0; nKey < aLongs.length; ++nKey) if (aLongs[nKey]! > nKey + 1) break;

    rRevision.Identifier = `Version${nKey + 1}`;
    this.pImpl.aVersions = [...this.pImpl.aVersions, rRevision];
  }

  RemoveVersion_Impl(rName: string): void {
    if (!this.pImpl.aVersions.length) return;

    const nIndex = this.pImpl.aVersions.findIndex((rVersion) => rVersion.Identifier === rName);
    if (nIndex !== -1) this.pImpl.aVersions = this.pImpl.aVersions.filter((_, i) => i !== nIndex);
  }

  TransferVersionList_Impl(rMedium: SfxMedium): boolean {
    if (rMedium.pImpl.aVersions.length) {
      this.pImpl.aVersions = rMedium.pImpl.aVersions;
      return true;
    }

    return false;
  }

  SaveVersionList_Impl(): void {
    if (!this.GetStorage()) return;

    if (!this.pImpl.aVersions.length) return;

    XMLVersionListPersistence.store(this.GetStorage(), this.pImpl.aVersions);
  }

  /**
   * GetStorage with SID_VERSION: the package of a version, numbered from 1, or counted back from
   * the current version when negative; null when there is no such version.
   */
  GetVersionStorage_Impl(nVersion: number): Uint8Array | null {
    const aVersions = this.GetVersionList();
    if (!nVersion || !aVersions.length) return null;
    // The versions are numbered starting with 1, versions with
    // negative versions numbers are counted backwards from the
    // current version
    if (nVersion < 0) nVersion = aVersions.length + nVersion;
    else nVersion--;

    const rTag = aVersions[nVersion];
    if (!rTag) return null;
    // There the version is stored as packed Stream
    return this.GetStorage()?.get(`Versions/${rTag.Identifier}`) ?? null;
  }
}
