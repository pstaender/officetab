// SPDX-License-Identifier: MPL-2.0
// @upstream include/editeng/acorrcfg.hxx reduced
// @upstream editeng/source/misc/acorrcfg.cxx reduced
// The AutoCorrect configuration: the SvxAutoCorrect instance and the AutoText and "while
// typing" switches. Upstream reads and writes it through the configuration (SvxBaseAutoCorrCfg
// and SvxSwAutoCorrCfg, Office.Common/AutoCorrect and Office.Writer/AutoFunction); here the
// application loads and stores the values and calls SetModified's listener.
import { SvxAutoCorrect } from './svxacorr.ts';
import { SvxSwAutoFormatFlags } from './swafopt.ts';

export class SvxAutoCorrCfg {
  pAutoCorrect: SvxAutoCorrect;
  // Flags for Autotext:
  bFileRel = true;
  bNetRel = true;
  // Help tip for Autotext as you type
  bAutoTextTip = true;
  bAutoTextPreview = false;
  bAutoFmtByInput = true;
  bSearchInAllCategories = false;
  /** Called when a value changed, to store the configuration (ConfigItem::SetModified). */
  m_pOnModified: (() => void) | null = null;

  constructor() {
    this.pAutoCorrect = new SvxAutoCorrect(new SvxSwAutoFormatFlags());
  }

  SetModified(): void { this.m_pOnModified?.(); }
  GetAutoCorrect(): SvxAutoCorrect { return this.pAutoCorrect; }
  // the pointer is transferred to the possession of the ConfigItems!
  SetAutoCorrect(pNew: SvxAutoCorrect): void { this.pAutoCorrect = pNew; }
  IsAutoFormatByInput(): boolean { return this.bAutoFmtByInput; }
  SetAutoFormatByInput(bSet: boolean): void { this.bAutoFmtByInput = bSet; this.SetModified(); }
  IsAutoTextTip(): boolean { return this.bAutoTextTip; }
  SetAutoTextTip(bSet: boolean): void { this.bAutoTextTip = bSet; this.SetModified(); }

  private static s_pCfg: SvxAutoCorrCfg | null = null;
  static Get(): SvxAutoCorrCfg { return (SvxAutoCorrCfg.s_pCfg ??= new SvxAutoCorrCfg()); }
}
