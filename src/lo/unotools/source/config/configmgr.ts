// SPDX-License-Identifier: MPL-2.0
// @upstream unotools/source/config/configmgr.cxx partial
// Only the product getters. Upstream reads them from officecfg's Setup/Product (set at build time
// from the branding); here they come from package.json, whose version `tools/build/bump-version.ts`
// maintains. Upstream's ooSetupExtension has no counterpart: getProductExtension returns "".

import pkg from '../../../../../package.json' with { type: 'json' };

/** package.json's version, `major.minor.patch` with an optional `-beta` (or other) pre-release tag. */
const parseVersion = (): { major: number; minor: number; patch: number; pre: string } => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(pkg.version);
  if (!m) return { major: 0, minor: 0, patch: 0, pre: '' };
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? '' };
};

/** officecfg::Setup::Product::ooSetupVersionAboutBox: the full version, `26.0.0`. */
export function getAboutBoxProductVersion(): string {
  const v = parseVersion();
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** officecfg::Setup::Product::ooSetupVersionAboutBoxSuffix: the pre-release name, `Beta`, or "". */
export function getAboutBoxProductVersionSuffix(): string {
  const { pre } = parseVersion();
  const name = pre.replace(/[.\d]+$/, '');
  return name ? name.charAt(0).toUpperCase() + name.slice(1) + pre.slice(name.length).replace(/^\./, ' ') : '';
}

/** officecfg::Setup::Product::ooSetupExtension. */
export function getProductExtension(): string {
  return '';
}

/** officecfg::Setup::Product::ooName. */
export function getProductName(): string {
  return 'OfficeTab';
}

/** officecfg::Setup::Product::ooSetupVersion: the release, `26`, with the minor and patch level only when set. */
export function getProductVersion(): string {
  const v = parseVersion();
  return v.patch ? `${v.major}.${v.minor}.${v.patch}` : v.minor ? `${v.major}.${v.minor}` : `${v.major}`;
}

/** The version as the shell shows it: `26 (Beta)`, `26.1`. Not upstream. */
export function getDisplayVersion(): string {
  const suffix = getAboutBoxProductVersionSuffix();
  return suffix ? `${getProductVersion()} (${suffix})` : getProductVersion();
}
