// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr3.cxx partial
// Statistics (distributions, MEDIAN, RANK, LARGE, PERCENTILE, CORREL, ...), combinatorics and
// the name errors. Function families are added between the section markers below.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { ScInterpreter } from './interpr4.ts';

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScNoName(): void;
    ScBadName(): void;
  }
}

// General functions

ScInterpreter.prototype.ScNoName = function (this: ScInterpreter): void { this.PushError(FormulaError.NoName); };

ScInterpreter.prototype.ScBadName = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  while (nParamCount-- > 0) this.PopError();
  this.PushError(FormulaError.NoName);
};

// @@ STATISTICS @@

ScInterpreter.Register(OC.ocNoName, ScInterpreter.prototype.ScNoName);
ScInterpreter.Register(OC.ocBad, ScInterpreter.prototype.ScBadName);
