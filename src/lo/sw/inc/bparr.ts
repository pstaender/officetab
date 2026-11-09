// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/bparr.hxx faithful
// @upstream sw/source/core/bastyp/bparr.cxx faithful
// Translated statement by statement; pointer walks became index loops.

export const MAXENTRY = 1000;
export const COMPRESSLVL = 80;
const nBlockGrowSize = 20;
const USHRT_MAX = 0xffff;

export interface BlockInfo {
  pBigArr: BigPtrArray;
  nStart: number;
  nEnd: number;
  nElem: number;
  mvData: (BigPtrEntry | undefined)[];
}

export class BigPtrEntry {
  m_pBlock: BlockInfo | null = null;
  m_nOffset = 0;

  GetPos(): number { return this.m_pBlock!.nStart + this.m_nOffset; }
  GetArray(): BigPtrArray { return this.m_pBlock!.pBigArr; }
  IsDisconnected(): boolean { return this.m_pBlock === null; }
}

const idiv = (a: number, b: number) => Math.trunc(a / b);

export class BigPtrArray {
  protected m_ppInf: BlockInfo[] = [];
  protected m_nSize = 0;
  protected m_nMaxBlock = nBlockGrowSize;
  protected m_nBlock = 0;
  protected m_nCur = 0;

  Count(): number { return this.m_nSize; }

  Move(from: number, to: number): void {
    if (from !== to) {
      const cur = this.Index2Block(from);
      const p = this.m_ppInf[cur]!;
      const pElem = p.mvData[from - p.nStart]!;
      this.Insert(pElem, to); // insert first, then delete!
      this.ImplRemove(to < from ? from + 1 : from, 1, /*bClearElement*/ false);
    }
  }

  at(idx: number): BigPtrEntry {
    this.m_nCur = this.Index2Block(idx);
    const p = this.m_ppInf[this.m_nCur]!;
    return p.mvData[idx - p.nStart]!;
  }

  protected Index2Block(pos: number): number {
    // last used block?
    let p = this.m_ppInf[this.m_nCur]!;
    if (p.nStart <= pos && p.nEnd >= pos) return this.m_nCur;
    // Index = 0?
    if (!pos) return 0;
    // following one?
    if (this.m_nCur < this.m_nBlock - 1) {
      p = this.m_ppInf[this.m_nCur + 1]!;
      if (p.nStart <= pos && p.nEnd >= pos) return this.m_nCur + 1;
    } else if (pos < p.nStart && this.m_nCur > 0) {
      // previous one?
      p = this.m_ppInf[this.m_nCur - 1]!;
      if (p.nStart <= pos && p.nEnd >= pos) return this.m_nCur - 1;
    }
    // binary search: always successful
    let lower = 0, upper = this.m_nBlock - 1, cur = 0;
    for (;;) {
      const n = lower + idiv(upper - lower, 2);
      cur = n === cur ? n + 1 : n;
      p = this.m_ppInf[cur]!;
      if (p.nStart <= pos && p.nEnd >= pos) return cur;
      if (p.nStart > pos) upper = cur;
      else lower = cur;
    }
  }

  protected UpdIndex(pos: number): void {
    let idx = this.m_ppInf[pos]!.nEnd + 1;
    while (++pos < this.m_nBlock) {
      const p = this.m_ppInf[pos]!;
      p.nStart = idx;
      idx += p.nElem;
      p.nEnd = idx - 1;
    }
  }

  protected InsBlock(pos: number): BlockInfo {
    if (this.m_nBlock === this.m_nMaxBlock) this.m_nMaxBlock += nBlockGrowSize;
    const start = pos ? this.m_ppInf[pos - 1]!.nEnd + 1 : 0;
    const p: BlockInfo = { pBigArr: this, nStart: start, nEnd: start - 1, nElem: 0, mvData: new Array(MAXENTRY) };
    this.m_ppInf.splice(pos, 0, p);
    ++this.m_nBlock;
    return p;
  }

  protected BlockDel(nDel: number): void {
    this.m_nBlock -= nDel;
    this.m_ppInf.length = this.m_nBlock;
    if (this.m_nMaxBlock - this.m_nBlock > nBlockGrowSize) {
      this.m_nMaxBlock = (idiv(this.m_nBlock, nBlockGrowSize) + 1) * nBlockGrowSize;
    }
  }

  Insert(pElem: BigPtrEntry, pos: number): void {
    let p: BlockInfo;
    let cur: number;
    if (!this.m_nSize) {
      // special case: insert first element
      cur = 0;
      p = this.InsBlock(cur);
    } else if (pos === this.m_nSize) {
      // special case: insert at end
      cur = this.m_nBlock - 1;
      p = this.m_ppInf[cur]!;
      if (p.nElem === MAXENTRY) p = this.InsBlock(++cur); // the last block is full, create a new one
    } else {
      // standard case:
      cur = this.Index2Block(pos);
      p = this.m_ppInf[cur]!;
    }

    if (p.nElem === MAXENTRY) {
      // does the last entry fit into the next block?
      let q: BlockInfo;
      if (cur < this.m_nBlock - 1 && this.m_ppInf[cur + 1]!.nElem < MAXENTRY) {
        q = this.m_ppInf[cur + 1]!;
        for (let i = q.nElem; i > 0; --i) {
          q.mvData[i] = q.mvData[i - 1];
          ++q.mvData[i]!.m_nOffset;
        }
        q.nStart--;
        q.nEnd--;
      } else {
        // If it does not fit, then insert a new block. But if there is more
        // than 50% space in the array then compress first.
        if (this.m_nBlock > idiv(this.m_nSize, idiv(MAXENTRY, 2)) && cur >= this.Compress()) {
          // Something was moved before the current position: restart Insert.
          this.Insert(pElem, pos);
          return;
        }
        q = this.InsBlock(cur + 1);
      }

      // entry does not fit anymore - clear space
      const pLast = p.mvData[MAXENTRY - 1]!;
      pLast.m_nOffset = 0;
      pLast.m_pBlock = q;
      q.mvData[0] = pLast;
      q.nElem++;
      q.nEnd++;
      p.nEnd--;
      p.nElem--;
    }
    // now we have free space - insert
    pos -= p.nStart;
    if (pos !== p.nElem) {
      for (let i = p.nElem; i > pos; --i) {
        p.mvData[i] = p.mvData[i - 1];
        ++p.mvData[i]!.m_nOffset;
      }
    }
    // insert element and update indices
    pElem.m_nOffset = pos;
    pElem.m_pBlock = p;
    p.mvData[pos] = pElem;
    p.nEnd++;
    p.nElem++;
    this.m_nSize++;
    if (cur !== this.m_nBlock - 1) this.UpdIndex(cur);
    this.m_nCur = cur;
  }

  Remove(pos: number, n = 1): void { this.ImplRemove(pos, n, true); }

  protected ImplRemove(pos: number, n: number, bClearElement: boolean): void {
    let nBlkdel = 0; // deleted blocks
    let cur = this.Index2Block(pos); // current block number
    let nBlk1 = cur; // 1st treated block
    let nBlk1del = USHRT_MAX; // 1st deleted block
    let p = this.m_ppInf[cur]!;
    pos -= p.nStart;

    let nElem = n;
    while (nElem) {
      let nel = p.nElem - pos;
      if (nel > nElem) nel = nElem;
      // clear the back-pointers from the node back to node array.
      if (bClearElement) {
        for (let i = 0; i < nel; ++i) {
          p.mvData[pos + i]!.m_pBlock = null;
          p.mvData[pos + i]!.m_nOffset = 0;
        }
      }
      // move elements if needed
      if (pos + nel < p.nElem) {
        let to = pos, from = to + nel;
        let nCount = p.nElem - nel - pos;
        while (nCount--) {
          p.mvData[to] = p.mvData[from++];
          p.mvData[to]!.m_nOffset -= nel;
          ++to;
        }
      }
      p.nEnd -= nel;
      p.nElem -= nel;
      // possibly delete block completely
      if (!p.nElem) {
        nBlkdel++;
        if (USHRT_MAX === nBlk1del) nBlk1del = cur;
      }
      nElem -= nel;
      if (!nElem) break;
      p = this.m_ppInf[++cur]!;
      pos = 0;
    }

    // update table if blocks were removed
    if (nBlkdel) {
      if (nBlk1del + nBlkdel < this.m_nBlock) {
        this.m_ppInf.copyWithin(nBlk1del, nBlk1del + nBlkdel, this.m_nBlock);
        // UpdateIdx updates the successor thus start before first elem
        if (!nBlk1) {
          p = this.m_ppInf[0]!;
          p.nStart = 0;
          p.nEnd = p.nElem - 1;
        } else {
          --nBlk1;
        }
      }
      this.BlockDel(nBlkdel); // blocks were deleted
    }

    this.m_nSize -= n;
    if (nBlk1 !== this.m_nBlock - 1 && this.m_nSize) this.UpdIndex(nBlk1);
    this.m_nCur = nBlk1;

    // call Compress() if there is more than 50% space in the array
    if (this.m_nBlock > idiv(this.m_nSize, idiv(MAXENTRY, 2))) this.Compress();
  }

  Replace(idx: number, pElem: BigPtrEntry): void { this.ImplReplace(idx, pElem, /*bClearElement*/ true); }

  protected ImplReplace(idx: number, pElem: BigPtrEntry, bClearElement: boolean): void {
    this.m_nCur = this.Index2Block(idx);
    const p = this.m_ppInf[this.m_nCur]!;
    pElem.m_nOffset = idx - p.nStart;
    pElem.m_pBlock = p;
    // clear the back-pointers from the old element back to element array.
    if (bClearElement) {
      p.mvData[idx - p.nStart]!.m_pBlock = null;
      p.mvData[idx - p.nStart]!.m_nOffset = 0;
    }
    // update with new element
    p.mvData[idx - p.nStart] = pElem;
  }

  /** Replaces the node AFTER pNotTheOne. Returns the entry BEFORE pNotTheOne. */
  ReplaceTheOneAfter(pNotTheOne: BigPtrEntry, pNewEntry: BigPtrEntry): BigPtrEntry | null {
    const p = pNotTheOne.m_pBlock!;
    let nOffset = pNotTheOne.m_nOffset;
    // if the next node is inside the current block
    if (nOffset < p.nElem - 1) {
      ++nOffset;
      p.mvData[nOffset] = pNewEntry;
      pNewEntry.m_nOffset = nOffset;
      pNewEntry.m_pBlock = p;
      --nOffset;
    } else {
      // slow path
      this.ImplReplace(pNotTheOne.GetPos() + 1, pNewEntry, /*bClearElement*/ false);
    }
    // if the previous node is inside the current block
    if (nOffset !== 0) {
      --nOffset;
      return p.mvData[nOffset]!;
    }
    // slow path
    const nPrevPos = pNotTheOne.GetPos();
    if (nPrevPos === 0) return null;
    return this.at(nPrevPos - 1);
  }

  /** Compress the array */
  protected Compress(): number {
    // <pp> reads the "old" and <qq> writes the "new" block table.
    let pp = 0, qq = 0;
    let pLast: BlockInfo | null = null; // last empty block
    let nLast = 0; // missing elements
    let nBlkdel = 0; // number of deleted blocks
    let nFirstChgPos = USHRT_MAX; // at which position was the 1st change?

    // convert fill percentage into number of remaining elements
    const nMax = MAXENTRY - idiv(MAXENTRY * COMPRESSLVL, 100);

    for (let cur = 0; cur < this.m_nBlock; ++cur) {
      let p: BlockInfo | null = this.m_ppInf[pp++]!;
      let n = p.nElem;
      // Do not top up a nearly-full block if the inspected block would have to be split.
      if (nLast && n > nLast && nLast < nMax) nLast = 0;
      if (nLast) {
        if (USHRT_MAX === nFirstChgPos) nFirstChgPos = cur;
        // Not full yet? Then fill up.
        if (n > nLast) n = nLast;
        // move elements from current to last block
        let nOff = pLast!.nElem;
        for (let i = 0; i < n; ++i) {
          const e = p.mvData[i]!;
          pLast!.mvData[nOff] = e;
          e.m_pBlock = pLast;
          e.m_nOffset = nOff++;
        }
        // adjustment
        pLast!.nElem += n;
        nLast -= n;
        p.nElem -= n;
        // Is the current block now empty as a result?
        if (!p.nElem) {
          p = null; // then remove
          ++nBlkdel;
        } else {
          for (let i = 0; i < p.nElem; ++i) {
            p.mvData[i] = p.mvData[i + n];
            p.mvData[i]!.m_nOffset -= n;
          }
        }
      }

      if (p) {
        // BlockInfo was not deleted
        this.m_ppInf[qq++] = p; // adjust to correct position
        // keep the potentially existing last half-full block
        if (!nLast && p.nElem < MAXENTRY) {
          pLast = p;
          nLast = MAXENTRY - p.nElem;
        }
      }
    }

    // if blocks were deleted shrink BlockInfo array if needed
    if (nBlkdel) this.BlockDel(nBlkdel);

    // and re-index
    if (this.m_nBlock) {
      const p = this.m_ppInf[0]!;
      p.nEnd = p.nElem - 1;
      this.UpdIndex(0);
    }

    if (this.m_nCur >= nFirstChgPos) this.m_nCur = 0;
    return nFirstChgPos;
  }
}
