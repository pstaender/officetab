// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/kahan.hxx faithful
// KahanSum: Neumaier summation that also queues the last non-zero value and adds it like
// rtl::math::approxAdd() when the result is taken (0.1 + 0.2 - 0.3 is 0.0). No SSE2 path.
import { approxEqual } from '../../../../sal/rtl/math.ts';

export class KahanSum {
  private m_fSum = 0.0;
  private m_fError = 0.0;
  private m_fMem = 0.0;

  constructor(x_0 = 0.0, err_0 = 0.0) {
    this.m_fSum = x_0;
    this.m_fError = err_0;
  }

  /**
    * Performs one step of the Neumaier sum of doubles.
    * Overwrites the summand and error.
    */
  private static sumNeumaierNormal(k: KahanSum, value: number): void {
    const t = k.m_fSum + value;
    if (Math.abs(k.m_fSum) >= Math.abs(value)) k.m_fError += k.m_fSum - t + value;
    else k.m_fError += value - t + k.m_fSum;
    k.m_fSum = t;
  }

  /** Adds a value (or another KahanSum) to the sum using Kahan summation. */
  add(x_i: number | KahanSum): void {
    if (x_i instanceof KahanSum) {
      const t = new KahanSum(x_i.m_fSum, x_i.m_fError);
      if (x_i.m_fMem !== 0.0) KahanSum.sumNeumaierNormal(t, x_i.m_fMem);
      this.add(t.m_fSum);
      this.add(t.m_fError);
      return;
    }
    if (x_i === 0.0) return;
    if (!this.m_fMem) {
      this.m_fMem = x_i;
      return;
    }
    KahanSum.sumNeumaierNormal(this, this.m_fMem);
    this.m_fMem = x_i;
  }

  /** Subtracts a value to the sum using Kahan summation. */
  subtract(fSum: number | KahanSum): void {
    if (fSum instanceof KahanSum) this.add(fSum.neg());
    else this.add(-fSum);
  }

  neg(): KahanSum {
    const k = new KahanSum(-this.m_fSum, -this.m_fError);
    k.m_fMem = -this.m_fMem;
    return k;
  }

  assign(fSum: number): void {
    this.m_fSum = fSum;
    this.m_fError = 0;
    this.m_fMem = 0;
  }

  /** In some parts of the code of interpr_.cxx this may be used for
      product instead of sum. This operator shall be used for that task. */
  mul(fTimes: number): void {
    if (this.m_fMem) {
      this.m_fSum = this.get() * fTimes;
      this.m_fMem = 0.0;
    } else this.m_fSum = (this.m_fSum + this.m_fError) * fTimes;
    this.m_fError = 0.0;
  }

  div(fDivides: number): void {
    if (this.m_fMem) {
      this.m_fSum = this.get() / fDivides;
      this.m_fMem = 0.0;
    } else this.m_fSum = (this.m_fSum + this.m_fError) / fDivides;
    this.m_fError = 0.0;
  }

  /** Returns the final sum. */
  get(): number {
    const fTotal = this.m_fSum + this.m_fError;
    if (!this.m_fMem) return fTotal;
    // Check the same condition as rtl::math::approxAdd() and if true
    // return 0.0, if false use another Kahan summation adding m_fMem.
    if (((this.m_fMem < 0.0 && fTotal > 0.0) || (fTotal < 0.0 && this.m_fMem > 0.0)) && approxEqual(this.m_fMem, -fTotal)) {
      /* TODO: should we reset all values to zero here for further
       * summation, or is it better to keep them as they are? */
      return 0.0;
    }
    // The actual argument passed to add() here does not matter as long as it
    // is not 0, m_fMem is not 0 and will be added anyway, see add().
    const k = new KahanSum(this.m_fSum, this.m_fError);
    k.m_fMem = this.m_fMem;
    k.add(1.0);
    return k.m_fSum + k.m_fError;
  }
}
