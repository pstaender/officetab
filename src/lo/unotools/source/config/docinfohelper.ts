// SPDX-License-Identifier: MPL-2.0
// @upstream unotools/source/config/docinfohelper.cxx reduced
// DocInfoHelper::GetGeneratorString: the product name and version (`Workspace_Office/26`), without the
// GeneratorOverride setting, the `$<os>_<arch>` platform and the `LibreOffice_project/<build id>` part.

import { getProductExtension, getProductName, getProductVersion } from './configmgr.ts';

export const GetGeneratorString = (): string => {
  let aResult = '';

  // First product: branded name + version
  // version is <product_versions>_<product_extension>$<platform>

  // plain product name
  let aValue = getProductName();
  if (aValue) {
    aResult += aValue.replaceAll(' ', '_') + '/';

    aValue = getProductVersion();
    if (aValue) {
      aResult += aValue.replaceAll(' ', '_');

      aValue = getProductExtension();
      if (aValue) {
        aResult += aValue.replaceAll(' ', '_');
      }
    }
  }
  return aResult;
};
