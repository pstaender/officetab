// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/unitconv.hxx reduced
// @upstream sc/source/core/tool/unitconv.cxx reduced
// The unit (old currency) converter of CONVERT_OOO. Reduced: the table is not read from the
// configuration (Office.Calc/UnitConversion) but holds the entries LibreOffice ships in
// officecfg/registry/data/org/openoffice/Office/Calc.xcu. ScGlobal::GetUnitConverter() is
// GetUnitConverter() here.

const cDelim = '\u0001'; // delimiter between From and To

// ScUnitConverterData
export class ScUnitConverterData {
  private readonly maIndexString: string;
  private readonly mfValue: number;

  constructor(rFromUnit: string, rToUnit: string, fValue: number) {
    this.maIndexString = ScUnitConverterData.BuildIndexString(rFromUnit, rToUnit);
    this.mfValue = fValue;
  }

  GetValue(): number { return this.mfValue; }
  GetIndexString(): string { return this.maIndexString; }

  static BuildIndexString(rFromUnit: string, rToUnit: string): string {
    return rFromUnit + cDelim + rToUnit;
  }
}

/** The UnitConversion entries of Calc.xcu (FromUnit, ToUnit, Factor). */
const aUnitConversion: readonly (readonly [string, string, number])[] = [
  ['EUR', 'ATS', 13.7603],
  ['EUR', 'BEF', 40.3399],
  ['EUR', 'DEM', 1.95583],
  ['EUR', 'ESP', 166.386],
  ['EUR', 'FIM', 5.94573],
  ['EUR', 'FRF', 6.55957],
  ['EUR', 'IEP', 0.787564],
  ['EUR', 'ITL', 1936.27],
  ['EUR', 'LUF', 40.3399],
  ['EUR', 'NLG', 2.20371],
  ['EUR', 'PTE', 200.482],
  ['EUR', 'GRD', 340.75],
  ['EUR', 'SIT', 239.64],
  ['EUR', 'MTL', 0.4293],
  ['EUR', 'CYP', 0.585274],
  ['EUR', 'SKK', 30.126],
  ['EUR', 'EEK', 15.6466],
  ['EUR', 'LVL', 0.702804],
  ['EUR', 'LTL', 3.4528],
  ['EUR', 'HRK', 7.5345],
  ['EUR', 'BGN', 1.95583],
];

// ScUnitConverter
export class ScUnitConverter {
  private readonly maData = new Map<string, ScUnitConverterData>();

  constructor() {
    // read from configuration - "convert.ini" is no longer used
    for (const [sFromUnit, sToUnit, fFactor] of aUnitConversion) {
      const aNew = new ScUnitConverterData(sFromUnit, sToUnit, fFactor);
      const aIndex = aNew.GetIndexString();
      this.maData.set(aIndex, aNew);
    }
  }

  /** The factor of the conversion, or null if there is none (upstream: false, fValue = 1.0). */
  GetValue(rFromUnit: string, rToUnit: string): number | null {
    const aIndex = ScUnitConverterData.BuildIndexString(rFromUnit, rToUnit);
    const it = this.maData.get(aIndex);
    if (!it) return null;
    return it.GetValue();
  }
}

let xUnitConverter: ScUnitConverter | null = null;

/** ScGlobal::GetUnitConverter */
export function GetUnitConverter(): ScUnitConverter {
  if (!xUnitConverter) xUnitConverter = new ScUnitConverter();
  return xUnitConverter;
}
