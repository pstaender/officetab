// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/pagedata.hxx faithful
// @upstream sc/source/ui/docshell/pagedata.cxx faithful
// ScPageBreakData: the print ranges of a sheet with the columns and rows where their pages end,
// as ScPrintFunc records them for the page break view.
import { ScRange, type SCCOL, type SCROW } from '../../../inc/address.ts';

export class ScPrintRangeData {
  private aPrintRange = new ScRange();
  private mvPageEndX: SCCOL[] = [];
  private mvPageEndY: SCROW[] = [];
  private nFirstPage = 1;
  private bTopDown = true;
  private bAutomatic = true;

  SetPrintRange(rNew: ScRange): void { this.aPrintRange = rNew; }
  GetPrintRange(): ScRange { return this.aPrintRange; }

  SetPagesX(nCount: number, pData: readonly SCCOL[]): void { this.mvPageEndX = pData.slice(0, nCount); }
  SetPagesY(nCount: number, pData: readonly SCROW[]): void { this.mvPageEndY = pData.slice(0, nCount); }

  GetPagesX(): number { return this.mvPageEndX.length; }
  GetPageEndX(): readonly SCCOL[] { return this.mvPageEndX; }
  GetPagesY(): number { return this.mvPageEndY.length; }
  GetPageEndY(): readonly SCROW[] { return this.mvPageEndY; }

  SetFirstPage(nNew: number): void { this.nFirstPage = nNew; }
  GetFirstPage(): number { return this.nFirstPage; }
  SetTopDown(bSet: boolean): void { this.bTopDown = bSet; }
  IsTopDown(): boolean { return this.bTopDown; }
  SetAutomatic(bSet: boolean): void { this.bAutomatic = bSet; }
  IsAutomatic(): boolean { return this.bAutomatic; }
}

export class ScPageBreakData {
  private readonly nAlloc: number;
  private nUsed = 0;
  private readonly pData: ScPrintRangeData[];

  constructor(nMax: number) {
    this.pData = Array.from({ length: nMax }, () => new ScPrintRangeData());
    this.nAlloc = nMax;
  }

  GetCount(): number { return this.nUsed; }

  GetData(nPos: number): ScPrintRangeData {
    if (nPos >= this.nAlloc) throw new Error('ScPageBreakData::GetData bumm');

    if (nPos >= this.nUsed) this.nUsed = nPos + 1;

    return this.pData[nPos]!;
  }

  equals(rOther: ScPageBreakData): boolean {
    if (this.nUsed !== rOther.nUsed) return false;

    for (let i = 0; i < this.nUsed; i++) if (!this.pData[i]!.GetPrintRange().equals(rOther.pData[i]!.GetPrintRange())) return false;

    //! compare ScPrintRangeData completely ??

    return true;
  }

  AddPages(): void {
    if (this.nUsed > 1) {
      let nPage = this.pData[0]!.GetFirstPage();
      for (let i = 0; i + 1 < this.nUsed; i++) {
        nPage += this.pData[i]!.GetPagesX() * this.pData[i]!.GetPagesY();
        this.pData[i + 1]!.SetFirstPage(nPage);
      }
    }
  }
}
