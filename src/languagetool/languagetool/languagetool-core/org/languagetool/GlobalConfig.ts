// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/GlobalConfig.java partial
// Only the verbose flag: the Grammalecte, Beolingus and NER settings are for servers.

/** Configuration that is the same for all users, e.g. on a server. */
export class GlobalConfig {
  private static verbose = false;

  static isVerbose(): boolean { return GlobalConfig.verbose; }
  static setVerbose(verbose: boolean): void { GlobalConfig.verbose = verbose; }
}
