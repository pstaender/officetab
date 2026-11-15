// SPDX-License-Identifier: MPL-2.0
// @upstream include/tools/duration.hxx reduced
// @upstream tools/source/datetime/duration.cxx reduced
// tools::Duration, reduced to the constructor from a time in days with its accuracy correction
// (a value within 300 ns of a full second snaps to that second) and GetInDays(). The time part
// is held as signed nanoseconds instead of a tools::Time (MakeTimeFromNS / GetTimeInDays round
// trip exactly for less than a day); the other constructors and the arithmetic are left out.
import { approxCeil, approxFloor } from '../../../sal/rtl/math.ts';
import { Time } from './ttime.ts';

export class Duration {
  static readonly kAccuracyEpsilonNanoseconds = 300;

  private mnNS = 0;
  private mnDays = 0;

  /** Assumes that fTimeInDays represents a known duration and is not the result of a calculation
      that may have accumulated rounding errors; with nAccuracyEpsilonNanoseconds a fraction
      within that distance of a full second is corrected. */
  constructor(fTimeInDays: number, nAccuracyEpsilonNanoseconds = Duration.kAccuracyEpsilonNanoseconds) {
    let fInt: number, fFrac: number;
    if (fTimeInDays < 0.0) {
      fInt = approxCeil(fTimeInDays);
      fFrac = fInt <= fTimeInDays ? 0.0 : fTimeInDays - fInt;
    } else {
      fInt = approxFloor(fTimeInDays);
      fFrac = fInt >= fTimeInDays ? 0.0 : fTimeInDays - fInt;
    }
    this.mnDays = Math.trunc(fInt);
    if (fFrac) {
      fFrac *= Time.nanoSecPerDay;
      fFrac = approxFloor(fFrac);
      let nNS = Math.trunc(fFrac);
      const nN = nNS % Time.nanoSecPerSec;
      if (nN) {
        const nA = Math.abs(nN);
        if (nA <= nAccuracyEpsilonNanoseconds) nNS -= nNS < 0 ? -nN : nN;
        else if (nA >= Time.nanoSecPerSec - nAccuracyEpsilonNanoseconds) {
          const nD = Time.nanoSecPerSec - nA;
          nNS += nNS < 0 ? -nD : nD;
          if (Math.abs(nNS) >= Time.nanoSecPerDay) {
            this.mnDays += Math.trunc(nNS / Time.nanoSecPerDay);
            nNS %= Time.nanoSecPerDay;
          }
        }
      }
      this.mnNS = nNS; // maTime.MakeTimeFromNS(nNS)
    }
  }

  GetDays(): number { return this.mnDays; }
  GetInDays(): number { return this.mnDays + this.mnNS / Time.nanoSecPerDay; }
}
