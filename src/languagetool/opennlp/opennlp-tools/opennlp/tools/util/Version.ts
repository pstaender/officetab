// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/Version.java partial
// Left out: hashCode. currentVersion() reads the version from the opennlp.version resource
// in Java; here it is the ported release, 1.9.4.

/**
 * The Version class represents the OpenNlp Tools library version.
 */
export class Version {
  private static readonly DEV_VERSION_STRING = '0.0.0-SNAPSHOT';

  private static readonly SNAPSHOT_MARKER = '-SNAPSHOT';

  /** The version of the ported opennlp-tools (the opennlp.version resource). */
  private static readonly PORTED_VERSION_STRING = '1.9.4';

  static readonly DEV_VERSION: Version = Version.parse(Version.DEV_VERSION_STRING);

  private readonly major: number;

  private readonly minor: number;

  private readonly revision: number;

  private readonly snapshot: boolean;

  constructor(major: number, minor: number, revision: number, snapshot = false) {
    this.major = major;
    this.minor = minor;
    this.revision = revision;
    this.snapshot = snapshot;
  }

  getMajor(): number {
    return this.major;
  }

  getMinor(): number {
    return this.minor;
  }

  getRevision(): number {
    return this.revision;
  }

  isSnapshot(): boolean {
    return this.snapshot;
  }

  toString(): string {
    return String(this.getMajor()) + '.' + String(this.getMinor()) +
      '.' + String(this.getRevision()) + (this.isSnapshot() ? Version.SNAPSHOT_MARKER : '');
  }

  equals(obj: unknown): boolean {
    if (obj === this) {
      return true;
    }

    if (obj instanceof Version) {
      const version = obj;

      return this.getMajor() === version.getMajor()
          && this.getMinor() === version.getMinor()
          && this.getRevision() === version.getRevision()
          && this.isSnapshot() === version.isSnapshot();
    }

    return false;
  }

  /**
   * Return a new Version initialized to the value represented by the specified String
   */
  static parse(version: string): Version {
    const indexFirstDot = version.indexOf('.');

    const indexSecondDot = version.indexOf('.', indexFirstDot + 1);

    if (indexFirstDot === -1 || indexSecondDot === -1) {
      throw new RangeError("Invalid version format '" + version + "', expected two dots!");
    }

    const indexFirstDash = version.indexOf('-');

    let versionEnd: number;
    if (indexFirstDash === -1) {
      versionEnd = version.length;
    }
    else {
      versionEnd = indexFirstDash;
    }

    const snapshot = version.endsWith(Version.SNAPSHOT_MARKER);

    return new Version(parseInt_(version.substring(0, indexFirstDot)),
        parseInt_(version.substring(indexFirstDot + 1, indexSecondDot)),
        parseInt_(version.substring(indexSecondDot + 1, versionEnd)), snapshot);
  }

  /** Retrieves the current version of the OpenNlp Tools library. */
  static currentVersion(): Version {
    return Version.parse(Version.PORTED_VERSION_STRING);
  }
}

/** Integer.parseInt: throws NumberFormatException (a RangeError here) on anything but an int. */
function parseInt_(s: string): number {
  if (!/^[+-]?\d+$/.test(s)) throw new RangeError('For input string: "' + s + '"');
  return parseInt(s, 10);
}
