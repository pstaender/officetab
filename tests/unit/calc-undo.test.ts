// The undo manager (svl/source/undo/undo.cxx): stacks, list actions, limits, merging.
import { describe, expect, it } from 'vitest';
import { SfxListUndoAction, SfxUndoAction, SfxUndoManager } from '../../src/lo/svl/source/undo/undo.ts';

class Counter { n = 0; log: string[] = []; }

class AddAction extends SfxUndoAction {
  private c: Counter;
  private d: number;
  private name: string;
  constructor(c: Counter, d: number, name = `add ${d}`) {
    super();
    this.c = c;
    this.d = d;
    this.name = name;
  }
  override Undo(): void { this.c.n -= this.d; this.c.log.push(`undo ${this.name}`); }
  override Redo(): void { this.c.n += this.d; this.c.log.push(`redo ${this.name}`); }
  override GetComment(): string { return this.name; }
  override Merge(p: SfxUndoAction): boolean {
    if (p instanceof AddAction && this.name === 'merge' && p.name === 'merge') {
      this.d += p.d;
      return true;
    }
    return false;
  }
}

function doAdd(m: SfxUndoManager, c: Counter, d: number, name?: string, bTryMerge = false): void {
  c.n += d;
  m.AddUndoAction(new AddAction(c, d, name), bTryMerge);
}

describe('SfxUndoManager', () => {
  it('undoes and redoes in order, with counts and comments', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    doAdd(m, c, 1);
    doAdd(m, c, 10);
    expect(m.GetUndoActionCount()).toBe(2);
    expect(m.GetUndoActionComment()).toBe('add 10');
    expect(m.GetUndoActionComment(1)).toBe('add 1');
    expect(m.Undo()).toBe(true);
    expect(c.n).toBe(1);
    expect(m.GetRedoActionCount()).toBe(1);
    expect(m.GetRedoActionComment()).toBe('add 10');
    expect(m.Undo()).toBe(true);
    expect(c.n).toBe(0);
    expect(m.Undo()).toBe(false); // empty
    expect(m.Redo()).toBe(true);
    expect(m.Redo()).toBe(true);
    expect(c.n).toBe(11);
    expect(m.Redo()).toBe(false);
  });

  it('a new action clears the redo stack', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    doAdd(m, c, 1);
    doAdd(m, c, 2);
    m.Undo();
    expect(m.GetRedoActionCount()).toBe(1);
    doAdd(m, c, 5);
    expect(m.GetRedoActionCount()).toBe(0);
    expect(m.GetUndoActionCount()).toBe(2);
  });

  it('keeps at most the maximum number of actions', () => {
    const m = new SfxUndoManager(3);
    const c = new Counter();
    for (let i = 1; i <= 5; i++) doAdd(m, c, i);
    expect(m.GetUndoActionCount()).toBe(3);
    m.Undo(); m.Undo(); m.Undo();
    expect(c.n).toBe(3); // 1 + 2 can not be undone any more
    m.SetMaxUndoActionCount(1);
    expect(m.GetMaxUndoActionCount()).toBe(1);
  });

  it('groups actions in list actions, nested, and drops empty ones', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    m.EnterListAction('Group', 'Group', 0);
    expect(m.IsInListAction()).toBe(true);
    doAdd(m, c, 1);
    m.EnterListAction('Inner', '', 0);
    doAdd(m, c, 2);
    expect(m.GetListActionDepth()).toBe(2);
    expect(m.LeaveListAction()).toBe(1);
    expect(m.Undo()).toBe(false); // not possible within a list action
    expect(m.LeaveListAction()).toBe(2);
    expect(m.IsInListAction()).toBe(false);
    expect(m.GetUndoActionCount()).toBe(1);
    expect(m.GetUndoActionComment()).toBe('Group');
    expect(m.GetUndoAction()).toBeInstanceOf(SfxListUndoAction);
    m.Undo();
    expect(c.n).toBe(0);
    expect(c.log).toEqual(['undo add 2', 'undo add 1']);
    m.Redo();
    expect(c.n).toBe(3);
    // an empty list action is removed
    m.EnterListAction('Empty', '', 0);
    expect(m.LeaveListAction()).toBe(0);
    expect(m.GetUndoActionCount()).toBe(1);
  });

  it('takes the comment of a list action from its children when it has none', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    m.EnterListAction('', '', 0);
    doAdd(m, c, 4, 'child');
    m.LeaveListAction();
    expect(m.GetUndoActionComment()).toBe('child');
  });

  it('LeaveAndMergeListAction merges the previous action into the list', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    doAdd(m, c, 1, 'first');
    m.EnterListAction('Second', '', 0);
    doAdd(m, c, 2);
    m.LeaveAndMergeListAction();
    expect(m.GetUndoActionCount()).toBe(1);
    expect(m.GetUndoActionComment()).toBe('first');
    m.Undo();
    expect(c.n).toBe(0);
  });

  it('merges actions on request', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    doAdd(m, c, 1, 'merge');
    doAdd(m, c, 2, 'merge', true);
    expect(m.GetUndoActionCount()).toBe(1);
    m.Undo();
    expect(c.n).toBe(0);
  });

  it('ignores actions while undo is disabled and during Undo/Redo', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    m.EnableUndo(false);
    expect(m.IsUndoEnabled()).toBe(false);
    doAdd(m, c, 1);
    expect(m.GetUndoActionCount()).toBe(0);
    m.EnableUndo(true);

    // an action that records another action while undoing: ignored, IsDoing is set
    let bDoing = false;
    class Nested extends SfxUndoAction {
      override Undo(): void { bDoing = m.IsDoing(); m.AddUndoAction(new AddAction(c, 100)); }
      override Redo(): void {}
    }
    m.AddUndoAction(new Nested());
    m.Undo();
    expect(bDoing).toBe(true);
    expect(m.IsDoing()).toBe(false);
    expect(m.GetUndoActionCount()).toBe(0);
    expect(m.GetRedoActionCount()).toBe(1);
  });

  it('clears, clears redo, removes the last action and notifies listeners', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    const events: string[] = [];
    m.AddUndoListener({ undoActionAdded: (s) => events.push(`added ${s}`), actionUndone: (s) => events.push(`undone ${s}`), cleared: () => events.push('cleared') });
    doAdd(m, c, 1);
    doAdd(m, c, 2);
    m.Undo();
    m.ClearRedo();
    expect(m.GetRedoActionCount()).toBe(0);
    m.RemoveLastUndoAction();
    expect(m.GetUndoActionCount()).toBe(0);
    doAdd(m, c, 3);
    m.Clear();
    expect(m.GetUndoActionCount()).toBe(0);
    expect(m.IsEmptyActions()).toBe(false);
    expect(events).toEqual(['added add 1', 'added add 2', 'undone add 2', 'added add 3', 'cleared']);
  });

  it('Reset leaves open list actions', () => {
    const m = new SfxUndoManager();
    const c = new Counter();
    m.EnterListAction('a', '', 0);
    doAdd(m, c, 1);
    m.Reset();
    expect(m.IsInListAction()).toBe(false);
    expect(m.GetUndoActionCount()).toBe(0);
  });
});
