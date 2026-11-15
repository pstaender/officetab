// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/userlist.hxx reduced
// @upstream sc/source/core/tool/userlist.cxx reduced
// The sort lists (Tools - Options - Calc - Sort Lists): ScUserListData is one list of
// comma-separated entries, ScUserList all of them. The default lists are the day and month names
// of the en-US Gregorian calendar (AddDefaults reads them from the locale data; here they are
// fixed). Case-insensitive matching upper-cases with toUpperCase instead of ScGlobal's
// CharClass, and the case-sensitive and -insensitive string comparisons use Intl.Collator.

/** ScGlobal::cListDelimiter */
const cListDelimiter = ',';

const EMPTY_OUSTRING = '';

/** ScGlobal::GetCaseTransliteration / GetTransliteration, used for strings not in the list. */
const aCaseCollator = new Intl.Collator('en-US', { sensitivity: 'variant', caseFirst: 'lower' });
const aCollator = new Intl.Collator('en-US', { sensitivity: 'accent' });

class SubStr {
  maReal: string;
  maUpper: string;
  constructor(aReal: string) {
    this.maReal = aReal;
    this.maUpper = aReal.toUpperCase();
  }
}

/** Stores individual user-defined sort list. */
export class ScUserListData {
  private maSubStrings: SubStr[] = [];
  private aStr: string;

  constructor(aStr: string) {
    this.aStr = aStr;
    this.InitTokens();
  }

  private InitTokens(): void {
    this.maSubStrings = [];
    for (const aSub of this.aStr.split(cListDelimiter)) if (aSub) this.maSubStrings.push(new SubStr(aSub));
  }

  GetString(): string { return this.aStr; }
  SetString(rStr: string): void {
    this.aStr = rStr;
    this.InitTokens();
  }
  GetSubCount(): number { return this.maSubStrings.length; }

  /** The index of an entry (case-sensitive match first, then case-insensitive), or null;
      bMatchCase tells which matched. */
  GetSubIndex(rSubStr: string): { rIndex: number; bMatchCase: boolean } | null {
    // First, case sensitive search.
    let itr = this.maSubStrings.findIndex((item) => item.maReal === rSubStr);
    if (itr >= 0) return { rIndex: itr, bMatchCase: true };

    // When that fails, do a case insensitive search.
    const aUpStr = rSubStr.toUpperCase();
    itr = this.maSubStrings.findIndex((item) => item.maUpper === aUpStr);
    if (itr >= 0) return { rIndex: itr, bMatchCase: false };
    return null;
  }

  GetSubStr(nIndex: number): string {
    if (nIndex < this.maSubStrings.length) return this.maSubStrings[nIndex]!.maReal;
    else return EMPTY_OUSTRING;
  }

  Compare(rSubStr1: string, rSubStr2: string): number {
    const r1 = this.GetSubIndex(rSubStr1);
    const r2 = this.GetSubIndex(rSubStr2);
    if (r1) {
      if (r2) {
        if (r1.rIndex < r2.rIndex) return -1;
        else if (r1.rIndex > r2.rIndex) return 1;
        else return 0;
      } else return -1;
    } else if (r2) return 1;
    else return Math.sign(aCaseCollator.compare(rSubStr1, rSubStr2));
  }

  ICompare(rSubStr1: string, rSubStr2: string): number {
    const r1 = this.GetSubIndex(rSubStr1);
    const r2 = this.GetSubIndex(rSubStr2);
    if (r1) {
      if (r2) {
        if (r1.rIndex < r2.rIndex) return -1;
        else if (r1.rIndex > r2.rIndex) return 1;
        else return 0;
      } else return -1;
    } else if (r2) return 1;
    else return Math.sign(aCollator.compare(rSubStr1, rSubStr2));
  }
}

/** The en-US Gregorian calendar (i18npool's locale data), week starting on Sunday. */
const aDays = [
  ['Sun', 'Sunday'], ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'],
] as const;
const aMonths = [
  ['Jan', 'January'], ['Feb', 'February'], ['Mar', 'March'], ['Apr', 'April'], ['May', 'May'], ['Jun', 'June'],
  ['Jul', 'July'], ['Aug', 'August'], ['Sep', 'September'], ['Oct', 'October'], ['Nov', 'November'], ['Dec', 'December'],
] as const;

/** Collection of user-defined sort lists. */
export class ScUserList {
  private maData: ScUserListData[] = [];

  constructor(initDefault = true) {
    if (initDefault) this.AddDefaults();
  }

  AddDefaults(): void {
    const cDelimiter = cListDelimiter;
    {
      const aDayShort = aDays.map((d) => d[0]).join(cDelimiter);
      const aDayLong = aDays.map((d) => d[1]).join(cDelimiter);
      if (!this.HasEntry(aDayShort)) this.emplace_back(aDayShort);
      if (!this.HasEntry(aDayLong)) this.emplace_back(aDayLong);
    }
    {
      const aMonthShort = aMonths.map((m) => m[0]).join(cDelimiter);
      const aMonthLong = aMonths.map((m) => m[1]).join(cDelimiter);
      if (!this.HasEntry(aMonthShort)) this.emplace_back(aMonthShort);
      if (!this.HasEntry(aMonthLong)) this.emplace_back(aMonthLong);
    }
  }

  /** The list containing rSubStr, preferring a case-sensitive match. */
  GetData(rSubStr: string): ScUserListData | null {
    let pFirstCaseInsensitive: ScUserListData | null = null;
    for (const rxItem of this.maData) {
      const r = rxItem.GetSubIndex(rSubStr);
      if (r) {
        if (r.bMatchCase) return rxItem;
        if (!pFirstCaseInsensitive) pFirstCaseInsensitive = rxItem;
      }
    }
    return pFirstCaseInsensitive;
  }

  at(nIndex: number): ScUserListData { return this.maData[nIndex]!; }
  size(): number { return this.maData.length; }
  empty(): boolean { return this.maData.length === 0; }
  clear(): void { this.maData = []; }
  erase(nIndex: number): void { this.maData.splice(nIndex, 1); }
  emplace_back(aStr: string): void { this.maData.push(new ScUserListData(aStr)); }

  HasEntry(rStr: string): boolean { return this.maData.some((pData) => pData.GetString() === rStr); }

  equals(r: ScUserList): boolean {
    return this.maData.length === r.maData.length && this.maData.every((d, i) => d.GetString() === r.maData[i]!.GetString());
  }
}

let xUserList: ScUserList | null = null;

/** ScGlobal::GetUserList (global.cxx): the application's sort lists, created on first use. */
export function GetUserList(): ScUserList {
  if (!xUserList) xUserList = new ScUserList();
  return xUserList;
}
