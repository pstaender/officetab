// SPDX-License-Identifier: MPL-2.0
// @upstream include/svl/undo.hxx reduced
// @upstream svl/source/undo/undo.cxx reduced
// SfxUndoAction, SfxListUndoAction (an action composed of several actions) and SfxUndoManager
// (the undo and redo stack, with nested list actions). Single-threaded: the mutex and the
// UndoManagerGuard's deferred deletion are left out (listeners are notified directly after the
// change). Also left out: the undo contexts with an offset (UndoWithContext, UndoMark), the
// stack marks (MarkTopUndoAction, RemoveMark, HasTopUndoActionMark), the view shell ids, the
// date and time of an action, and the XML and JSON dumps.

/** SfxRepeatTarget: what Repeat acts on (the view). */
export type SfxRepeatTarget = object;

export class SfxUndoAction {
  Undo(): void {
    // These are only conceptually pure virtual
    throw new Error('pure virtual function called: SfxUndoAction::Undo()');
  }

  Redo(): void {
    // These are only conceptually pure virtual
    throw new Error('pure virtual function called: SfxUndoAction::Redo()');
  }

  Repeat(_rTarget: SfxRepeatTarget): void {
    // These are only conceptually pure virtual
    throw new Error('pure virtual function called: SfxUndoAction::Repeat()');
  }

  CanRepeat(_rTarget: SfxRepeatTarget): boolean { return true; }

  Merge(_pNextAction: SfxUndoAction): boolean { return false; }

  GetComment(): string { return ''; }

  GetRepeatComment(_rTarget: SfxRepeatTarget): string { return this.GetComment(); }
}

/** SfxUndoArray: do not make use of these implementation details, unless you really really
    have to! */
export class SfxUndoArray {
  maUndoActions: SfxUndoAction[] = [];
  nMaxUndoActions: number;
  nCurUndoAction = 0;
  pFatherUndoArray: SfxUndoArray | null = null;

  constructor(nMax = 0) {
    this.nMaxUndoActions = nMax;
  }

  GetUndoAction(idx: number): SfxUndoAction { return this.maUndoActions[idx]!; }

  /** Remove(idx) removes one action and returns it; Remove(pos, count) removes several. */
  Remove(i_pos: number, i_count?: number): SfxUndoAction | undefined {
    if (i_count !== undefined) {
      this.maUndoActions.splice(i_pos, i_count);
      return undefined;
    }
    return this.maUndoActions.splice(i_pos, 1)[0];
  }

  Insert(i_action: SfxUndoAction, i_pos: number): void { this.maUndoActions.splice(i_pos, 0, i_action); }
}

/**
 * UndoAction to composite multiple Undos in one UndoAction. These actions are used by
 * SfxUndomanager. With < SfxUndoManager::EnterListAction > you can go one composite level down
 * and with < SfxUndoManager::LeaveListAction > up again. Redo and Undo work element wise on
 * SfxListUndoActions.
 */
export class SfxListUndoAction extends SfxUndoAction {
  // SfxUndoArray part (multiple inheritance upstream)
  maUndoActions: SfxUndoAction[] = [];
  nMaxUndoActions: number;
  nCurUndoAction = 0;
  pFatherUndoArray: SfxUndoArray | SfxListUndoAction | null;
  private mnId: number;
  private maComment: string;
  private maRepeatComment: string;

  constructor(rComment: string, rRepeatComment: string, nId: number, pFather: SfxUndoArray | SfxListUndoAction | null) {
    super();
    this.mnId = nId;
    this.maComment = rComment;
    this.maRepeatComment = rRepeatComment;
    this.pFatherUndoArray = pFather;
    this.nMaxUndoActions = 0xffff; // USHRT_MAX
  }

  GetUndoAction(idx: number): SfxUndoAction { return this.maUndoActions[idx]!; }
  Remove(i_pos: number, i_count?: number): SfxUndoAction | undefined { return SfxUndoArray.prototype.Remove.call(this, i_pos, i_count); }
  Insert(i_action: SfxUndoAction, i_pos: number): void { this.maUndoActions.splice(i_pos, 0, i_action); }

  GetId(): number { return this.mnId; }
  override GetComment(): string { return this.maComment; }
  SetComment(rComment: string): void { this.maComment = rComment; }
  override GetRepeatComment(_rTarget: SfxRepeatTarget): string { return this.maRepeatComment; }

  override Undo(): void {
    for (let i = this.nCurUndoAction; i > 0;) this.maUndoActions[--i]!.Undo();
    this.nCurUndoAction = 0;
  }

  override Redo(): void {
    for (let i = this.nCurUndoAction; i < this.maUndoActions.length; i++) this.maUndoActions[i]!.Redo();
    this.nCurUndoAction = this.maUndoActions.length;
  }

  override Repeat(rTarget: SfxRepeatTarget): void {
    for (let i = 0; i < this.nCurUndoAction; i++) this.maUndoActions[i]!.Repeat(rTarget);
  }

  override CanRepeat(r: SfxRepeatTarget): boolean {
    for (let i = 0; i < this.nCurUndoAction; i++) {
      if (!this.maUndoActions[i]!.CanRepeat(r)) return false;
    }
    return true;
  }

  override Merge(pNextAction: SfxUndoAction): boolean {
    return this.maUndoActions.length > 0 && this.maUndoActions[this.maUndoActions.length - 1]!.Merge(pNextAction);
  }
}

/** The current level of the manager: the top-level array or an open list action. */
type UndoLevel = SfxUndoArray | SfxListUndoAction;

/** is a callback interface for notifications about state changes of an SfxUndoManager */
export interface SfxUndoListener {
  actionUndone?(i_actionComment: string): void;
  actionRedone?(i_actionComment: string): void;
  undoActionAdded?(i_actionComment: string): void;
  cleared?(): void;
  clearedRedo?(): void;
  resetAll?(): void;
  listActionEntered?(i_comment: string): void;
  listActionLeft?(i_comment: string): void;
  listActionCancelled?(): void;
}

export class SfxUndoManager {
  static readonly CurrentLevel = true;
  static readonly TopLevel = false;

  // SfxUndoManager_Data
  private maUndoArray: SfxUndoArray;
  private pActUndoArray: UndoLevel;
  private mbUndoEnabled = true;
  private mbDoing = false;
  private mbClearUntilTopLevel = false;
  private mbEmptyActions = true;
  /** holds a requested ClearRedo until safe to clear stack */
  private moNeedsClearRedo: boolean | undefined = undefined;
  private aListeners: SfxUndoListener[] = [];

  constructor(nMaxUndoActionCount = 20) {
    this.maUndoArray = new SfxUndoArray(nMaxUndoActionCount);
    this.pActUndoArray = this.maUndoArray;
    this.mbEmptyActions = !this.ImplIsEmptyActions();
  }

  private notify<K extends keyof SfxUndoListener>(k: K, s?: string): void {
    for (const l of [...this.aListeners]) (l[k] as ((s?: string) => void) | undefined)?.call(l, s);
  }

  EnableUndo(i_enable: boolean): void { this.ImplEnableUndo_Lock(i_enable); }

  private ImplEnableUndo_Lock(i_enable: boolean): void {
    if (this.mbUndoEnabled === i_enable) return;
    this.mbUndoEnabled = i_enable;
  }

  IsUndoEnabled(): boolean { return this.ImplIsUndoEnabled_Lock(); }
  private ImplIsUndoEnabled_Lock(): boolean { return this.mbUndoEnabled; }

  SetMaxUndoActionCount(nMaxUndoActionCount: number): void {
    // Remove entries from the pActUndoArray when we have to reduce
    // the number of entries due to a lower nMaxUndoActionCount.
    // Both redo and undo action entries will be removed until we reached the
    // new nMaxUndoActionCount.
    const a = this.pActUndoArray;
    let nNumToDelete = a.maUndoActions.length - nMaxUndoActionCount;
    while (nNumToDelete > 0) {
      const nPos = a.maUndoActions.length;
      if (nPos > a.nCurUndoAction) {
        a.Remove(nPos - 1);
        --nNumToDelete;
      }
      if (nNumToDelete > 0 && a.nCurUndoAction > 0) {
        a.Remove(0);
        --a.nCurUndoAction;
        --nNumToDelete;
      }
      if (nPos === a.maUndoActions.length) break; // Cannot delete more entries
    }
    a.nMaxUndoActions = nMaxUndoActionCount;
    this.ImplCheckEmptyActions();
  }

  GetMaxUndoActionCount(): number { return this.pActUndoArray.nMaxUndoActions; }

  private ImplClearCurrentLevel_NoNotify(): void {
    // clear array
    this.pActUndoArray.maUndoActions.length = 0;
    this.pActUndoArray.nCurUndoAction = 0;
    this.ImplCheckEmptyActions();
  }

  /** Clears both the Redo and the Undo stack. */
  Clear(): void {
    this.ImplClearCurrentLevel_NoNotify();
    // notify listeners
    this.notify('cleared');
  }

  /** clears all undo actions on the current level, plus all undo actions on superordinate
      levels, as soon as those levels are reached. */
  ClearAllLevels(): void {
    this.ImplClearCurrentLevel_NoNotify();
    if (this.ImplIsInListAction_Lock()) this.mbClearUntilTopLevel = true;
    else this.notify('cleared');
  }

  ImplClearRedo_NoLock(i_currentLevel: boolean): void {
    if (this.IsDoing()) {
      // cannot clear redo while undo/redo is in process. Delay ClearRedo until safe to clear.
      // (assuming if TopLevel requests a clear, it should have priority over CurrentLevel)
      if (this.moNeedsClearRedo === undefined || i_currentLevel === SfxUndoManager.TopLevel) this.moNeedsClearRedo = i_currentLevel;
      return;
    }
    this.ImplClearRedo(i_currentLevel);
  }

  /** Clears the Redo stack. */
  ClearRedo(): void { this.ImplClearRedo_NoLock(SfxUndoManager.CurrentLevel); }

  /** leaves any possible open list action, and clears both the Undo and the Redo stack. */
  Reset(): void {
    // clear all locks
    while (!this.ImplIsUndoEnabled_Lock()) this.ImplEnableUndo_Lock(true);
    // cancel all list actions
    while (this.IsInListAction()) this.ImplLeaveListAction(false, false);
    // clear both stacks
    this.ImplClearCurrentLevel_NoNotify();
    this.notify('resetAll');
  }

  private ImplClearUndo(): void {
    while (this.pActUndoArray.nCurUndoAction > 0) {
      this.pActUndoArray.Remove(0);
      --this.pActUndoArray.nCurUndoAction;
    }
    this.ImplCheckEmptyActions();
  }

  private ImplClearRedo(i_currentLevel: boolean): void {
    const pUndoArray = i_currentLevel === SfxUndoManager.CurrentLevel ? this.pActUndoArray : this.maUndoArray;
    // clearance
    while (pUndoArray.maUndoActions.length > pUndoArray.nCurUndoAction) pUndoArray.Remove(pUndoArray.maUndoActions.length - 1);
    this.ImplCheckEmptyActions();
    // notification - only if the top level's stack was cleared
    if (i_currentLevel === SfxUndoManager.TopLevel) this.notify('clearedRedo');
  }

  private ImplAddUndoAction_NoNotify(pAction: SfxUndoAction, bTryMerge: boolean, bClearRedo: boolean): boolean {
    if (!this.ImplIsUndoEnabled_Lock() || this.pActUndoArray.nMaxUndoActions === 0) return false;

    // merge, if required
    const a = this.pActUndoArray;
    const pMergeWithAction = a.nCurUndoAction ? a.maUndoActions[a.nCurUndoAction - 1]! : null;
    if (bTryMerge && pMergeWithAction) {
      const bMerged = pMergeWithAction.Merge(pAction);
      if (bMerged) return false;
    }

    // clear redo stack, if requested
    if (bClearRedo && this.ImplGetRedoActionCount_Lock() > 0) this.ImplClearRedo(SfxUndoManager.CurrentLevel);

    // respect max number
    if (a === this.maUndoArray) {
      while (a.maUndoActions.length >= a.nMaxUndoActions) {
        a.Remove(0);
        if (a.nCurUndoAction > 0) --a.nCurUndoAction;
      }
    }

    // append new action
    a.Insert(pAction, a.nCurUndoAction++);
    this.ImplCheckEmptyActions();
    return true;
  }

  AddUndoAction(pAction: SfxUndoAction, bTryMerge = false): void {
    // add
    if (this.ImplAddUndoAction_NoNotify(pAction, bTryMerge, true)) {
      // notify listeners
      this.notify('undoActionAdded', pAction.GetComment());
    }
  }

  GetUndoActionCount(i_currentLevel: boolean = SfxUndoManager.CurrentLevel): number {
    const pUndoArray = i_currentLevel ? this.pActUndoArray : this.maUndoArray;
    return pUndoArray.nCurUndoAction;
  }

  GetUndoActionComment(nNo = 0, i_currentLevel: boolean = SfxUndoManager.CurrentLevel): string {
    let sComment = '';
    const pUndoArray = i_currentLevel ? this.pActUndoArray : this.maUndoArray;
    if (nNo < pUndoArray.nCurUndoAction) sComment = pUndoArray.maUndoActions[pUndoArray.nCurUndoAction - 1 - nNo]!.GetComment();
    return sComment;
  }

  GetUndoAction(nNo = 0): SfxUndoAction | null {
    const a = this.pActUndoArray;
    if (nNo >= a.nCurUndoAction) return null;
    return a.maUndoActions[a.nCurUndoAction - 1 - nNo]!;
  }

  /** clears the redo stack and removes the top undo action */
  RemoveLastUndoAction(): void {
    const a = this.pActUndoArray;
    if (!a.nCurUndoAction) return;
    a.nCurUndoAction--;
    // delete redo-actions and top action
    a.Remove(a.nCurUndoAction, a.maUndoActions.length - a.nCurUndoAction);
    this.ImplCheckEmptyActions();
  }

  /** determines whether an Undo or Redo is currently running */
  IsDoing(): boolean { return this.mbDoing; }

  Undo(): boolean { return this.ImplUndo(); }

  private ImplUndo(): boolean {
    if (this.mbDoing) throw new Error('SfxUndoManager::Undo: *nested* Undo/Redo actions? How this?');
    if (this.ImplIsInListAction_Lock()) return false; // SfxUndoManager::Undo: not possible when within a list action!
    if (this.pActUndoArray.nCurUndoAction === 0) return false; // SfxUndoManager::Undo: undo stack is empty!

    this.mbDoing = true;
    const bOldEnabled = this.mbUndoEnabled; // LockGuard
    this.ImplEnableUndo_Lock(false);
    const pAction = this.pActUndoArray.maUndoActions[--this.pActUndoArray.nCurUndoAction]!;
    const sActionComment = pAction.GetComment();
    try {
      pAction.Undo();
    } catch (e) {
      // assume the error is a permanent failure, and clear the Undo stack
      if (this.pActUndoArray.maUndoActions.includes(pAction)) this.ImplClearUndo();
      this.mbDoing = false;
      this.ImplEnableUndo_Lock(bOldEnabled);
      throw e;
    }
    this.mbDoing = false;
    this.ImplEnableUndo_Lock(bOldEnabled);
    if (this.moNeedsClearRedo !== undefined) {
      const b = this.moNeedsClearRedo;
      this.moNeedsClearRedo = undefined;
      this.ImplClearRedo_NoLock(b);
    }
    this.notify('actionUndone', sActionComment);
    return true;
  }

  GetRedoActionCount(i_currentLevel: boolean = SfxUndoManager.CurrentLevel): number { return this.ImplGetRedoActionCount_Lock(i_currentLevel); }

  private ImplGetRedoActionCount_Lock(i_currentLevel: boolean = SfxUndoManager.CurrentLevel): number {
    const pUndoArray = i_currentLevel ? this.pActUndoArray : this.maUndoArray;
    return pUndoArray.maUndoActions.length - pUndoArray.nCurUndoAction;
  }

  GetRedoAction(nNo = 0): SfxUndoAction | null {
    const pUndoArray = this.pActUndoArray;
    return pUndoArray.maUndoActions[pUndoArray.nCurUndoAction + nNo] ?? null;
  }

  GetRedoActionComment(nNo = 0, i_currentLevel: boolean = SfxUndoManager.CurrentLevel): string {
    let sComment = '';
    const pUndoArray = i_currentLevel ? this.pActUndoArray : this.maUndoArray;
    if (pUndoArray.nCurUndoAction + nNo < pUndoArray.maUndoActions.length) sComment = pUndoArray.maUndoActions[pUndoArray.nCurUndoAction + nNo]!.GetComment();
    return sComment;
  }

  Redo(): boolean { return this.ImplRedo(); }

  private ImplRedo(): boolean {
    if (this.mbDoing) throw new Error('SfxUndoManager::Redo: *nested* Undo/Redo actions? How this?');
    if (this.ImplIsInListAction_Lock()) return false; // SfxUndoManager::Redo: not possible when within a list action!
    if (this.pActUndoArray.nCurUndoAction >= this.pActUndoArray.maUndoActions.length) return false; // redo stack is empty!

    this.mbDoing = true;
    const bOldEnabled = this.mbUndoEnabled; // LockGuard
    this.ImplEnableUndo_Lock(false);
    const pAction = this.pActUndoArray.maUndoActions[this.pActUndoArray.nCurUndoAction++]!;
    const sActionComment = pAction.GetComment();
    try {
      pAction.Redo();
    } catch (e) {
      // assume the error is a permanent failure, and clear the Redo stack
      if (this.pActUndoArray.maUndoActions.includes(pAction)) this.ImplClearRedo(SfxUndoManager.CurrentLevel);
      this.mbDoing = false;
      this.ImplEnableUndo_Lock(bOldEnabled);
      throw e;
    }
    this.mbDoing = false;
    this.ImplEnableUndo_Lock(bOldEnabled);
    this.ImplCheckEmptyActions();
    this.notify('actionRedone', sActionComment);
    return true;
  }

  GetRepeatActionCount(): number { return this.pActUndoArray.maUndoActions.length; }

  GetRepeatActionComment(rTarget: SfxRepeatTarget): string {
    const a = this.pActUndoArray.maUndoActions;
    return a[a.length - 1]!.GetRepeatComment(rTarget);
  }

  Repeat(rTarget: SfxRepeatTarget): boolean {
    const a = this.pActUndoArray.maUndoActions;
    if (a.length) {
      const pAction = a[a.length - 1]!;
      if (pAction.CanRepeat(rTarget)) pAction.Repeat(rTarget);
      return true;
    }
    return false;
  }

  CanRepeat(rTarget: SfxRepeatTarget): boolean {
    const a = this.pActUndoArray.maUndoActions;
    if (a.length) return a[a.length - 1]!.CanRepeat(rTarget);
    return false;
  }

  AddUndoListener(i_listener: SfxUndoListener): void { this.aListeners.push(i_listener); }

  RemoveUndoListener(i_listener: SfxUndoListener): void {
    const i = this.aListeners.indexOf(i_listener);
    if (i >= 0) this.aListeners.splice(i, 1);
  }

  /** Inserts a ListUndoAction and sets its UndoArray as current. */
  EnterListAction(rComment: string, rRepeatComment = '', nId = 0): void {
    if (!this.ImplIsUndoEnabled_Lock()) return;
    if (!this.maUndoArray.nMaxUndoActions) return;
    const pAction = new SfxListUndoAction(rComment, rRepeatComment, nId, this.pActUndoArray);
    this.ImplAddUndoAction_NoNotify(pAction, false, false);
    // expected to succeed: all conditions under which it could fail should have been checked already
    this.pActUndoArray = pAction;
    // notification
    this.notify('listActionEntered', rComment);
  }

  /** determines whether we're within a ListAction context */
  IsInListAction(): boolean { return this.ImplIsInListAction_Lock(); }
  private ImplIsInListAction_Lock(): boolean { return this.pActUndoArray !== this.maUndoArray; }

  /** Determines how many nested list actions are currently open */
  GetListActionDepth(): number {
    let nDepth = 0;
    let pLookup: UndoLevel | null = this.pActUndoArray;
    while (pLookup && pLookup !== this.maUndoArray) {
      pLookup = pLookup.pFatherUndoArray;
      ++nDepth;
    }
    return nDepth;
  }

  /** Leaves the list action entered with EnterListAction; returns the number of the sub actions
      in the list which has just been left (an empty list action is silently removed). */
  LeaveListAction(): number {
    let nCount = this.ImplLeaveListAction(false);
    if (this.mbClearUntilTopLevel) {
      this.ImplClearCurrentLevel_NoNotify();
      if (!this.ImplIsInListAction_Lock()) {
        this.mbClearUntilTopLevel = false;
        this.notify('cleared');
      }
      nCount = 0;
    }
    return nCount;
  }

  /** Leaves the list action entered with EnterListAction, and forcefully merges the previous
      action on the stack into the newly created list action. */
  LeaveAndMergeListAction(): number { return this.ImplLeaveListAction(true); }

  private ImplLeaveListAction(i_merge: boolean, bNotify = true): number {
    if (!this.ImplIsUndoEnabled_Lock()) return 0;
    if (!this.maUndoArray.nMaxUndoActions) return 0;
    if (!this.ImplIsInListAction_Lock()) return 0; // called without calling EnterListAction()!

    // the array/level which we're about to leave
    const pArrayToLeave = this.pActUndoArray;
    // one step up
    this.pActUndoArray = pArrayToLeave.pFatherUndoArray!;

    // If no undo actions were added to the list, delete the list action
    const nListActionElements = pArrayToLeave.nCurUndoAction;
    if (nListActionElements === 0) {
      this.pActUndoArray.Remove(--this.pActUndoArray.nCurUndoAction);
      if (bNotify) this.notify('listActionCancelled');
      return 0;
    }

    // now that it is finally clear the list action is non-trivial, and does participate in the
    // Undo stack, clear the redo stack
    this.ImplClearRedo(SfxUndoManager.CurrentLevel);

    const pCurrentAction = this.pActUndoArray.maUndoActions[this.pActUndoArray.nCurUndoAction - 1];
    if (!(pCurrentAction instanceof SfxListUndoAction)) return nListActionElements; // list action expected at this position!
    const pListAction = pCurrentAction;

    if (i_merge) {
      // merge the list action with its predecessor on the same level
      if (this.pActUndoArray.nCurUndoAction > 1) {
        const pPreviousAction = this.pActUndoArray.Remove(this.pActUndoArray.nCurUndoAction - 2)!;
        --this.pActUndoArray.nCurUndoAction;
        pListAction.SetComment(pPreviousAction.GetComment());
        pListAction.Insert(pPreviousAction, 0);
        ++pListAction.nCurUndoAction;
      }
    }

    // if the undo array has no comment, try to get it from its children
    if (!pListAction.GetComment()) {
      for (const a of pListAction.maUndoActions) {
        if (a.GetComment()) {
          pListAction.SetComment(a.GetComment());
          break;
        }
      }
    }

    this.ImplCheckEmptyActions();
    // notify listeners
    if (bNotify) this.notify('listActionLeft', pListAction.GetComment());
    // outta here
    return nListActionElements;
  }

  /** removes the oldest Undo actions from the stack */
  RemoveOldestUndoAction(): boolean {
    if (this.IsInListAction() && this.maUndoArray.nCurUndoAction === 1) return false; // cannot remove a not-yet-closed list action!
    this.maUndoArray.Remove(0);
    --this.maUndoArray.nCurUndoAction;
    this.ImplCheckEmptyActions();
    return true;
  }

  IsEmptyActions(): boolean { return this.ImplIsEmptyActions(); }

  private ImplIsEmptyActions(): boolean {
    return this.maUndoArray.nCurUndoAction > 0 || this.maUndoArray.maUndoActions.length - this.maUndoArray.nCurUndoAction > 0;
  }

  private ImplCheckEmptyActions(): void {
    const bEmptyActions = this.ImplIsEmptyActions();
    if (this.mbEmptyActions !== bEmptyActions) {
      this.mbEmptyActions = bEmptyActions;
      this.EmptyActionsChanged();
    }
  }

  protected EmptyActionsChanged(): void {}
}
