// The Insert and Edit Index Entry dialog (sw/uiconfig/swriter/ui/indexentry.ui, SwIndexMarkPane)
// and the Insert and Edit Citation dialog (bibliographyentry.ui, SwAuthorMarkPane) with its Define
// Bibliography Entry dialog (createauthorentry.ui, SwCreateAuthEntryDlg_Impl), after
// sw/source/ui/index/swuiidxmrk.cxx. Both are modal here, and Insert closes them (see DIFFERENCES.md).
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { t } from '@shell/i18n.ts';
import type { Controller } from '../controller.ts';
import { Modal } from './Dialogs.tsx';
import { SwTOXMgr, type SwTOXMarkDescription } from '@lo/sw/source/uibase/index/toxmgr.ts';
import { GetTOIKeys, GetTOXMarkText, GotoTOXMark } from '@lo/sw/source/core/doc/doctxm.ts';
import { SwTOIKeyType, SwTOXSearch, TOXTypes, ToxAuthorityField, ToxAuthorityType } from '@lo/sw/inc/toxe.ts';
import { MAXLEVEL } from '@lo/sw/inc/numrule.ts';
import { SwAuthEntry, TargetType } from '@lo/sw/inc/authfld.ts';
import type { SwTOXMark } from '@lo/sw/inc/tox.ts';

/** A question inside a dialog (the query boxes upstream opens on top of it). */
function Ask({ text, onAnswer }: { text: ReactNode; onAnswer: (yes: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} aria-label={t('idxmrk.query.title')} onClose={() => onAnswer(false)} onCancel={(e) => { e.preventDefault(); onAnswer(false); }} onClick={(e) => e.stopPropagation()}>
      <p>{text}</p>
      <footer>
        <button type="button" onClick={() => onAnswer(false)}>{t('common.no')}</button>
        <button type="button" className="primary" autoFocus onClick={() => onAnswer(true)}>{t('common.yes')}</button>
      </footer>
    </dialog>
  );
}

/** A dialog on top of another one: its own modal <dialog>, closing only itself. */
function SubModal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className={wide ? 'wide' : undefined} aria-label={title} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => e.stopPropagation()}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

// --- Index entries ---

const POS_CONTENT = 0, POS_INDEX = 1;
/** nTypePos: the index chosen last, the alphabetical index at first. */
let nTypePos = POS_INDEX;

/** The name an index type shows: the document's types in the interface language, user-defined indexes by name. */
const typeLabel = (nPos: number, name: string) =>
  nPos === POS_CONTENT ? t('idxmrk.type.content') : nPos === POS_INDEX ? t('idxmrk.type.index') : name === 'User-Defined' ? t('idxmrk.type.user') : name;

/** SwNewUserIdxDlg (newuserindexdialog.ui): the name of a new user-defined index. */
function NewUserIndex({ names, onDone }: { names: string[]; onDone: (name: string | null) => void }) {
  const [name, setName] = useState('');
  return (
    <SubModal title={t('idxmrk.newuser.title')} onClose={() => onDone(null)}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); onDone(name); }}>
        <label className="field"><span>{t('idxmrk.newuser.name')}</span><input value={name} autoFocus onChange={(e) => setName(e.target.value)} /></label>
        <footer>
          <button type="button" onClick={() => onDone(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary" disabled={!name || names.includes(name)}>{t('common.ok')}</button>
        </footer>
      </form>
    </SubModal>
  );
}

/**
 * SwIndexMarkPane: Insert > Table of Contents and Index > Index Entry (`bNewMark`), and Edit >
 * Reference > Index Entry for the marks at the cursor.
 */
export function IndexEntryDialog({ c, bNewMark }: { c: Controller; bNewMark: boolean }) {
  const sh = c.sh, doc = sh.m_pDoc;
  const mgr = useMemo(() => new SwTOXMgr(sh), [sh]);
  // InitControls: the index types, the keys used so far, and for a new mark the selection's text.
  const [userTypes, setUserTypes] = useState(() => doc.m_pTOXTypes.filter((x) => x.GetType() === TOXTypes.TOX_USER).map((x) => x.GetTypeName()));
  const types = [mgr.GetTOXType(TOXTypes.TOX_CONTENT)!.GetTypeName(), mgr.GetTOXType(TOXTypes.TOX_INDEX)!.GetTypeName(), ...userTypes];
  const keys = (e: SwTOIKeyType) => [...new Set(GetTOIKeys(doc, e))].sort();
  const [init] = useState(() => {
    if (!bNewMark) return { m_aOrgStr: '', m_bSelected: false, bApplyAllEnabled: false };
    // GetSelectionTextParam(true, false): without a selection, the word at the cursor.
    const m_bSelected = !sh.HasSelection();
    if (m_bSelected) sh.SelWrd();
    const s = sh.m_pCursor.Start(), e = sh.m_pCursor.End();
    const m_aOrgStr = sh.HasSelection() ? s.GetNode().GetText().slice(s.GetContentIndex(), e.GetNode() === s.GetNode() ? e.GetContentIndex() : undefined).replaceAll('\u0001', '') : '';
    //to include all equal entries may only be allowed in the body and even there
    //only when a simple selection exists
    return { m_aOrgStr, m_bSelected, bApplyAllEnabled: !!m_aOrgStr && !sh.IsInHeaderFooter() };
  });
  const [m_aOrgStr, setOrgStr] = useState(init.m_aOrgStr);
  const [nType, setType] = useState(bNewMark ? Math.min(nTypePos, types.length - 1) : 0);
  const [entry, setEntry] = useState(init.m_aOrgStr);
  const [key1, setKey1] = useState('');
  const [key2, setKey2] = useState('');
  const [level, setLevel] = useState(1);
  const [main, setMain] = useState(false);
  const [applyAll, setApplyAll] = useState(false);
  const [wordOnly, setWordOnly] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [modified, setModified] = useState(false);
  const [cur, setCur] = useState<SwTOXMark | null>(mgr.GetCurTOXMark());
  const [ask, setAsk] = useState<{ text: string; then: (yes: boolean) => void } | null>(null);
  const [newUser, setNewUser] = useState(false);

  // UpdateDialog: the current mark's settings, the mark selected in the document.
  const UpdateDialog = () => {
    const pMark = mgr.GetCurTOXMark();
    setCur(pMark);
    if (!pMark) return;
    const sText = GetTOXMarkText(doc, pMark);
    setOrgStr(sText);
    setEntry(sText);
    const eCurType = pMark.GetTOXType().GetType();
    setType(eCurType === TOXTypes.TOX_CONTENT ? POS_CONTENT : eCurType === TOXTypes.TOX_INDEX ? POS_INDEX : 2 + userTypes.indexOf(pMark.GetTOXType().GetTypeName()));
    setKey1(pMark.GetPrimaryKey());
    setKey2(pMark.GetSecondaryKey());
    setMain(pMark.IsMainEntry());
    setLevel(Math.max(1, pMark.GetLevel()));
    sh.GotoTOXMark(pMark);
    setModified(false);
    c.notify();
  };
  useEffect(() => { if (!bNewMark) { if (mgr.GetCurTOXMark()) UpdateDialog(); else c.setDialog(null); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bIndex = nType === POS_INDEX;
  // ModifyHdl: keys for the alphabetical index (the 2nd only after a 1st), a level for the others.
  const changeType = (n: number) => { setType(n); setModified(true); if (n !== POS_INDEX) setLevel(1); };
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setModified(true); };
  const description = (): SwTOXMarkDescription => {
    const meTOXType = nType === POS_CONTENT ? TOXTypes.TOX_CONTENT : nType === POS_INDEX ? TOXTypes.TOX_INDEX : TOXTypes.TOX_USER;
    const d: SwTOXMarkDescription = { meTOXType, mnLevel: level, mbMainEntry: bIndex && main };
    if (bIndex) { d.maPrimKey = key1; d.maSecKey = key1 ? key2 : ''; }
    if (meTOXType === TOXTypes.TOX_USER) d.maTOUName = types[nType];
    if (m_aOrgStr !== entry) d.maAltStr = entry;
    return d;
  };

  // InsertMark: all equal strings are selected so that the entry is applied to all of them.
  const InsertMark = () => {
    const d = description();
    const aRanges = applyAll && init.bApplyAllEnabled ? sh.FindSameStrings(m_aOrgStr, wordOnly, caseSensitive) : undefined;
    mgr.InsertTOXMark(d, aRanges);
    nTypePos = nType;
  };
  // UpdateMark: empty alternative texts are not allowed.
  const UpdateMark = (): boolean => {
    const d = description();
    if (d.maAltStr === '') return false;
    mgr.UpdateTOXMark(d);
    return true;
  };

  const close = () => { c.setDialog(null); c.notify(); };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (bNewMark) {
      InsertMark();
      // Apply: a word selected for the dialog is deselected again.
      if (init.m_bSelected) sh.m_pCursor.DeleteMark();
    } else if (cur && modified && !UpdateMark()) return;
    close();
  };
  // NextHdl, PrevHdl and the same-name ones: changes are applied on request first.
  const travel = (eDir: SwTOXSearch) => {
    const go = () => {
      if (eDir === SwTOXSearch.TOX_NXT || eDir === SwTOXSearch.TOX_SAME_NXT) mgr.NextTOXMark(eDir === SwTOXSearch.TOX_SAME_NXT);
      else mgr.PrevTOXMark(eDir === SwTOXSearch.TOX_SAME_PRV);
      UpdateDialog();
    };
    if (modified) setAsk({ text: `${t('idxmrk.query.text')} ${t('idxmrk.query.question')}`, then: (yes) => { if (yes) UpdateMark(); go(); } });
    else go();
  };
  const del = () => {
    mgr.DeleteTOXMark();
    if (mgr.GetCurTOXMark()) UpdateDialog();
    else close();
  };
  const canGo = (eDir: SwTOXSearch) => !!cur && GotoTOXMark(doc, cur, eDir) !== cur;
  const bShowNav = !bNewMark && !!cur && [SwTOXSearch.TOX_NXT, SwTOXSearch.TOX_PRV].some(canGo);
  const bShowSame = !bNewMark && !!cur && [SwTOXSearch.TOX_SAME_NXT, SwTOXSearch.TOX_SAME_PRV].some(canGo);
  const title = bNewMark ? t('idxmrk.insert') : t('idxmrk.edit');
  const key1List = keys(SwTOIKeyType.TOI_PRIMARY), key2List = keys(SwTOIKeyType.TOI_SECONDARY);

  return (
    <Modal c={c} title={title}>
      <form method="dialog" onSubmit={submit} className="index-entry">
        <fieldset><legend>{t('idxmrk.selection')}</legend>
          <label className="field"><span>{t('idxmrk.index')}</span>
            <span className="row">
              <select value={nType} disabled={!bNewMark} onChange={(e) => changeType(Number(e.target.value))}>
                {types.map((name, i) => <option key={`${i}/${name}`} value={i}>{typeLabel(i, name)}</option>)}
              </select>
              {bNewMark && <button type="button" title={t('idxmrk.newuser.button')} aria-label={t('idxmrk.newuser.button')} onClick={() => setNewUser(true)}>…</button>}
            </span>
          </label>
          <label className="field"><span>{t('idxmrk.entry')}</span>
            <input value={entry} autoFocus onChange={(e) => edit(setEntry)(e.target.value)} />
          </label>
          <label className="field"><span>{t('idxmrk.key1')}</span>
            <input list="idx-key1" value={key1} disabled={!bIndex} onChange={(e) => edit(setKey1)(e.target.value)} />
            <datalist id="idx-key1">{key1List.map((k) => <option key={k} value={k} />)}</datalist>
          </label>
          <label className="field"><span>{t('idxmrk.key2')}</span>
            <input list="idx-key2" value={key2} disabled={!bIndex || !key1} onChange={(e) => edit(setKey2)(e.target.value)} />
            <datalist id="idx-key2">{key2List.map((k) => <option key={k} value={k} />)}</datalist>
          </label>
          {bIndex ? (
            <label className="check"><input type="checkbox" checked={main} onChange={(e) => edit(setMain)(e.target.checked)} />{t('idxmrk.main')}</label>
          ) : (
            <label className="field"><span>{t('idxmrk.level')}</span>
              <input type="number" min={1} max={MAXLEVEL} value={level} onChange={(e) => edit(setLevel)(Math.max(1, Math.min(MAXLEVEL, parseInt(e.target.value, 10) || 1)))} />
            </label>
          )}
        </fieldset>
        {bNewMark && (
          <fieldset><legend>{t('idxmrk.selected')}</legend>
            <label className="check"><input type="checkbox" checked={applyAll} disabled={!init.bApplyAllEnabled} onChange={(e) => setApplyAll(e.target.checked)} />{t('idxmrk.applyall')}</label>
            <label className="check"><input type="checkbox" checked={caseSensitive} disabled={!applyAll} onChange={(e) => setCaseSensitive(e.target.checked)} />{t('idxmrk.matchcase')}</label>
            <label className="check"><input type="checkbox" checked={wordOnly} disabled={!applyAll} onChange={(e) => setWordOnly(e.target.checked)} />{t('idxmrk.wholewords')}</label>
          </fieldset>
        )}
        {(bShowNav || bShowSame) && (
          <p className="row">
            {bShowSame && <button type="button" disabled={!canGo(SwTOXSearch.TOX_SAME_PRV)} onClick={() => travel(SwTOXSearch.TOX_SAME_PRV)} title={t('idxmrk.prevsame')} aria-label={t('idxmrk.prevsame')}>⏮</button>}
            {bShowNav && <button type="button" disabled={!canGo(SwTOXSearch.TOX_PRV)} onClick={() => travel(SwTOXSearch.TOX_PRV)} title={t('idxmrk.prev')} aria-label={t('idxmrk.prev')}>◀</button>}
            {bShowNav && <button type="button" disabled={!canGo(SwTOXSearch.TOX_NXT)} onClick={() => travel(SwTOXSearch.TOX_NXT)} title={t('idxmrk.next')} aria-label={t('idxmrk.next')}>▶</button>}
            {bShowSame && <button type="button" disabled={!canGo(SwTOXSearch.TOX_SAME_NXT)} onClick={() => travel(SwTOXSearch.TOX_SAME_NXT)} title={t('idxmrk.nextsame')} aria-label={t('idxmrk.nextsame')}>⏭</button>}
          </p>
        )}
        <footer>
          {!bNewMark && <button type="button" onClick={del}>{t('idxmrk.delete')}</button>}
          <button type="button" onClick={close}>{t('common.close')}</button>
          <button type="submit" className="primary" disabled={!entry}>{bNewMark ? t('idxmrk.insertbutton') : t('common.ok')}</button>
        </footer>
      </form>
      {newUser && <NewUserIndex names={types} onDone={(name) => {
        setNewUser(false);
        if (name) { setUserTypes([...userTypes, name]); setType(types.length); setLevel(1); setModified(true); }
      }} />}
      {ask && <Ask text={ask.text} onAnswer={(yes) => { const a = ask; setAsk(null); a.then(yes); }} />}
    </Modal>
  );
}

// --- Citations ---

/** aTextInfoArr: the fields of the Define Bibliography Entry dialog, in their order. */
const aTextInfoArr: ToxAuthorityField[] = [
  ToxAuthorityField.AUTH_FIELD_IDENTIFIER, ToxAuthorityField.AUTH_FIELD_AUTHORITY_TYPE, ToxAuthorityField.AUTH_FIELD_AUTHOR,
  ToxAuthorityField.AUTH_FIELD_TITLE, ToxAuthorityField.AUTH_FIELD_YEAR, ToxAuthorityField.AUTH_FIELD_PUBLISHER, ToxAuthorityField.AUTH_FIELD_ADDRESS,
  ToxAuthorityField.AUTH_FIELD_ISBN, ToxAuthorityField.AUTH_FIELD_CHAPTER, ToxAuthorityField.AUTH_FIELD_PAGES, ToxAuthorityField.AUTH_FIELD_EDITOR,
  ToxAuthorityField.AUTH_FIELD_EDITION, ToxAuthorityField.AUTH_FIELD_BOOKTITLE, ToxAuthorityField.AUTH_FIELD_VOLUME, ToxAuthorityField.AUTH_FIELD_HOWPUBLISHED,
  ToxAuthorityField.AUTH_FIELD_ORGANIZATIONS, ToxAuthorityField.AUTH_FIELD_INSTITUTION, ToxAuthorityField.AUTH_FIELD_SCHOOL, ToxAuthorityField.AUTH_FIELD_REPORT_TYPE,
  ToxAuthorityField.AUTH_FIELD_MONTH, ToxAuthorityField.AUTH_FIELD_JOURNAL, ToxAuthorityField.AUTH_FIELD_NUMBER, ToxAuthorityField.AUTH_FIELD_SERIES,
  ToxAuthorityField.AUTH_FIELD_ANNOTE, ToxAuthorityField.AUTH_FIELD_NOTE, ToxAuthorityField.AUTH_FIELD_URL, ToxAuthorityField.AUTH_FIELD_TARGET_TYPE,
  ToxAuthorityField.AUTH_FIELD_TARGET_URL, ToxAuthorityField.AUTH_FIELD_LOCAL_URL, ToxAuthorityField.AUTH_FIELD_CUSTOM1, ToxAuthorityField.AUTH_FIELD_CUSTOM2,
  ToxAuthorityField.AUTH_FIELD_CUSTOM3, ToxAuthorityField.AUTH_FIELD_CUSTOM4, ToxAuthorityField.AUTH_FIELD_CUSTOM5,
];

const emptyFields = () => Array.from({ length: ToxAuthorityField.AUTH_FIELD_END }, () => '');

/** SplitUrlAndPage: a URL with a "page=" fragment, as its URL and page number. */
function SplitUrlAndPage(rText: string): { rUrl: string; nPageNumber: number } | null {
  const i = rText.indexOf('#');
  if (i < 0 || !rText.slice(i + 1).startsWith('page=')) return null;
  return { rUrl: rText.slice(0, i), nPageNumber: parseInt(rText.slice(i + 6), 10) || 0 };
}

/**
 * SwCreateAuthEntryDlg_Impl: every field of an entry. A new entry's short name must be new; while
 * editing a citation the short name chooses another entry of the document. The Browse button of
 * the local copy is left out (there is no file system to browse).
 */
function CreateAuthEntry({ c, pFields, bNewEntryMode, bCreate, isAllowed, onDone }: {
  c: Controller; pFields: string[]; bNewEntryMode: boolean; bCreate: boolean; isAllowed?: (s: string) => boolean; onDone: (fields: string[] | null) => void;
}) {
  const pFType = c.sh.m_pDoc.m_pAuthorityFieldType;
  const split = (f: string[]) => SplitUrlAndPage(f[ToxAuthorityField.AUTH_FIELD_LOCAL_URL] ?? '');
  // SetFields: a target type is chosen for new entries (a bibliography table row), legacy ones open their display URL.
  const fill = (f: string[], bNew: boolean) => {
    const out = [...f];
    const s = split(f);
    if (s) out[ToxAuthorityField.AUTH_FIELD_LOCAL_URL] = s.rUrl;
    if (!out[ToxAuthorityField.AUTH_FIELD_TARGET_TYPE]) out[ToxAuthorityField.AUTH_FIELD_TARGET_TYPE] = String(bNew ? TargetType.BibliographyTableRow : TargetType.UseDisplayURL);
    return { fields: out, page: s ? s.nPageNumber : null };
  };
  const [state, setState] = useState(() => fill(pFields, bNewEntryMode));
  const { fields, page } = state;
  const [m_bNameAllowed, setNameAllowed] = useState(!!pFields[ToxAuthorityField.AUTH_FIELD_IDENTIFIER]);
  const set = (i: ToxAuthorityField, v: string) => setState((s) => ({ ...s, fields: s.fields.map((x, k) => (k === i ? v : x)) }));
  const ids: string[] = [];
  if (!bNewEntryMode) pFType.GetAllEntryIdentifiers(ids);
  const nType = fields[ToxAuthorityField.AUTH_FIELD_AUTHORITY_TYPE] ? parseInt(fields[ToxAuthorityField.AUTH_FIELD_AUTHORITY_TYPE]!, 10) : -1;
  // GetEntryText: the type and target type as numbers, the local copy with its page.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const out = [...fields];
    if (page !== null) out[ToxAuthorityField.AUTH_FIELD_LOCAL_URL] = `${out[ToxAuthorityField.AUTH_FIELD_LOCAL_URL]}#page=${page}`;
    onDone(out);
  };
  const input = (eField: ToxAuthorityField) => {
    const label = t(`authfld.${eField}`);
    switch (eField) {
      case ToxAuthorityField.AUTH_FIELD_AUTHORITY_TYPE:
        return (
          <select aria-label={label} value={nType} onChange={(e) => set(eField, e.target.value)}>
            {nType < 0 && <option value={-1} />}
            {Array.from({ length: ToxAuthorityType.AUTH_TYPE_END }, (_, j) => <option key={j} value={j}>{t(`authtype.${j}`)}</option>)}
          </select>
        );
      case ToxAuthorityField.AUTH_FIELD_IDENTIFIER:
        if (!bNewEntryMode) {
          // IdentifierHdl: choosing another entry's short name shows that entry.
          return (
            <>
              <input aria-label={label} list="auth-ids" value={fields[eField]} onChange={(e) => {
                const pEntry = pFType.GetEntryByIdentifier(e.target.value);
                if (pEntry) setState(fill(pEntry.m_aAuthFields, false));
                else set(eField, e.target.value);
              }} />
              <datalist id="auth-ids">{ids.map((id) => <option key={id} value={id} />)}</datalist>
            </>
          );
        }
        // ShortNameHdl: a new entry's short name must be allowed.
        return <input aria-label={label} value={fields[eField]} disabled={!bCreate} autoFocus={bCreate} onChange={(e) => { set(eField, e.target.value); if (isAllowed) setNameAllowed(isAllowed(e.target.value)); }} />;
      case ToxAuthorityField.AUTH_FIELD_TARGET_TYPE:
        return (
          <select aria-label={label} value={fields[eField]} onChange={(e) => set(eField, e.target.value)}>
            {[TargetType.UseDisplayURL, TargetType.UseTargetURL, TargetType.None, TargetType.BibliographyTableRow].map((v) => <option key={v} value={v}>{t(`authtarget.${v}`)}</option>)}
          </select>
        );
      case ToxAuthorityField.AUTH_FIELD_LOCAL_URL:
        return (
          <span className="row">
            <input aria-label={label} value={fields[eField]} onChange={(e) => set(eField, e.target.value)} />
            <label className="check"><input type="checkbox" checked={page !== null} onChange={(e) => setState((s) => ({ ...s, page: e.target.checked ? 1 : null }))} />{t('authmrk.page')}</label>
            <input type="number" min={1} aria-label={t('authmrk.page')} disabled={page === null} value={page ?? 1} onChange={(e) => setState((s) => ({ ...s, page: Math.max(1, parseInt(e.target.value, 10) || 1) }))} />
          </span>
        );
      default:
        // TargetTypeHdl: the target URL only for "Open Target URL".
        return <input aria-label={label} value={fields[eField]} disabled={eField === ToxAuthorityField.AUTH_FIELD_TARGET_URL && fields[ToxAuthorityField.AUTH_FIELD_TARGET_TYPE] !== String(TargetType.UseTargetURL)} onChange={(e) => set(eField, e.target.value)} />;
    }
  };
  return (
    <SubModal title={t('authmrk.define')} onClose={() => onDone(null)} wide>
      <form method="dialog" onSubmit={submit}>
        <fieldset><legend>{t('authmrk.entrydata')}</legend>
          <div className="auth-grid">
            {aTextInfoArr.map((eField) => (
              <label key={eField} className="field"><span>{t(`authfld.${eField}`)}</span>{input(eField)}</label>
            ))}
          </div>
        </fieldset>
        <footer>
          <button type="button" onClick={() => onDone(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary" disabled={!(m_bNameAllowed && nType >= 0)}>{t('common.ok')}</button>
        </footer>
      </form>
    </SubModal>
  );
}

/**
 * SwAuthorMarkPane: Insert > Table of Contents and Index > Citation (`bNewEntry`), and Edit >
 * Reference > Citation for the citation at the cursor. The bibliography database is not
 * available, so citations come from the document's own entries and new ones (see DIFFERENCES.md).
 */
export function CitationDialog({ c, bNewEntry }: { c: Controller; bNewEntry: boolean }) {
  const sh = c.sh, pFType = sh.m_pDoc.m_pAuthorityFieldType;
  // InitControls: an edited citation's entry.
  const [m_sFields, setFields] = useState<string[]>(() => {
    const pField = bNewEntry ? null : sh.GetCurField();
    return pField?.type === 'TableOfAuthorities' && pField.m_xAuthEntry ? [...pField.m_xAuthEntry.m_aAuthFields] : emptyFields();
  });
  const [m_sCreatedEntry, setCreated] = useState<string[]>(emptyFields);
  // ChangeSourceHdl: the document's entries and the one created, sorted (tdf#90641).
  const entries = useMemo(() => {
    const aIds: string[] = [];
    pFType.GetAllEntryIdentifiers(aIds);
    if (m_sCreatedEntry[ToxAuthorityField.AUTH_FIELD_IDENTIFIER] && !aIds.includes(m_sCreatedEntry[ToxAuthorityField.AUTH_FIELD_IDENTIFIER]!)) aIds.push(m_sCreatedEntry[ToxAuthorityField.AUTH_FIELD_IDENTIFIER]!);
    return [...new Set(aIds)].sort((a, b) => a.localeCompare(b));
  }, [pFType, m_sCreatedEntry]);
  const sOrgId = useRef(m_sFields[ToxAuthorityField.AUTH_FIELD_IDENTIFIER]);
  const [sEdit, setEdit] = useState(m_sFields[ToxAuthorityField.AUTH_FIELD_IDENTIFIER] ?? '');
  const [define, setDefine] = useState<{ bCreate: boolean } | null>(null);
  const [ask, setAsk] = useState<(() => void) | null>(null);

  // CompEntryHdl: the fields of the entry chosen.
  const CompEntry = (sEntry: string) => {
    if (!sEntry) { setFields(emptyFields()); return; }
    const pEntry = pFType.GetEntryByIdentifier(sEntry);
    setFields(pEntry ? [...pEntry.m_aAuthFields] : sEntry === m_sCreatedEntry[ToxAuthorityField.AUTH_FIELD_IDENTIFIER] ? [...m_sCreatedEntry] : emptyFields());
  };
  useEffect(() => { if (bNewEntry && entries.length) CompEntry(entries[0]!); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // IsEditAllowedHdl: a new short name must not be another entry's.
  const bEditAllowed = !!sEdit && (sEdit === sOrgId.current || !pFType.GetEntryByIdentifier(sEdit));
  const close = () => { c.setDialog(null); c.notify(); };
  // InsertHdl: insert or update the SwAuthorityField; an entry the document has with other data
  // is adjusted on request.
  const apply = (fields: string[]) => {
    const pEntry = pFType.GetEntryByIdentifier(fields[ToxAuthorityField.AUTH_FIELD_IDENTIFIER]!);
    const xNewData = new SwAuthEntry(fields);
    const bDifferent = !!pEntry && !pEntry.equals(xNewData);
    const run = () => {
      if (bNewEntry) {
        if (bDifferent) sh.ChangeAuthorityData(xNewData);
        sh.InsertFormatField({ type: 'TableOfAuthorities', m_xAuthEntry: xNewData });
      } else sh.UpdateCurAuthorityField(xNewData);
      close();
    };
    if (bDifferent) setAsk(() => run);
    else run();
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!m_sFields[ToxAuthorityField.AUTH_FIELD_IDENTIFIER]) return;
    apply(m_sFields);
  };

  return (
    <Modal c={c} title={bNewEntry ? t('authmrk.insert') : t('authmrk.edit')}>
      <form method="dialog" onSubmit={submit}>
        {bNewEntry && (
          <fieldset><legend>{t('authmrk.source')}</legend>
            <label className="check"><input type="radio" name="authsource" disabled />{t('authmrk.frombibliography')}</label>
            <label className="check"><input type="radio" name="authsource" defaultChecked />{t('authmrk.fromdocument')}</label>
          </fieldset>
        )}
        <fieldset><legend>{t('authmrk.citation')}</legend>
          <label className="field"><span>{t('authmrk.shortname')}</span>
            {bNewEntry ? (
              <select value={m_sFields[ToxAuthorityField.AUTH_FIELD_IDENTIFIER]} onChange={(e) => CompEntry(e.target.value)} autoFocus>
                {!entries.length && <option value="" />}
                {entries.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            ) : (
              // EditModifyHdl
              <input value={sEdit} autoFocus onChange={(e) => {
                const v = e.target.value;
                setEdit(v);
                if (v && (v === sOrgId.current || !pFType.GetEntryByIdentifier(v))) setFields((f) => f.map((x, i) => (i === ToxAuthorityField.AUTH_FIELD_IDENTIFIER ? v : x)));
              }} />
            )}
          </label>
          <p className="field"><span>{t('authmrk.author')}</span><output>{m_sFields[ToxAuthorityField.AUTH_FIELD_AUTHOR]}</output></p>
          <p className="field"><span>{t('authmrk.title')}</span><output>{m_sFields[ToxAuthorityField.AUTH_FIELD_TITLE]}</output></p>
          <p className="row">
            {bNewEntry && <button type="button" onClick={() => setDefine({ bCreate: true })}>{t('authmrk.new')}</button>}
            <button type="button" disabled={!m_sFields[ToxAuthorityField.AUTH_FIELD_IDENTIFIER]} onClick={() => setDefine({ bCreate: false })}>{t('authmrk.editbutton')}</button>
          </p>
        </fieldset>
        <footer>
          <button type="button" onClick={close}>{t('common.close')}</button>
          <button type="submit" className="primary" disabled={!m_sFields[ToxAuthorityField.AUTH_FIELD_IDENTIFIER] || (!bNewEntry && !bEditAllowed)}>{bNewEntry ? t('idxmrk.insertbutton') : t('authmrk.apply')}</button>
        </footer>
      </form>
      {define && (
        <CreateAuthEntry c={c} pFields={define.bCreate ? emptyFields() : m_sFields} bNewEntryMode={bNewEntry} bCreate={define.bCreate}
          // IsEntryAllowedHdl: a new short name must be new.
          isAllowed={bNewEntry ? (s) => !!s && !entries.includes(s) && !pFType.GetEntryByIdentifier(s) : undefined}
          onDone={(f) => {
            const bCreate = define.bCreate;
            setDefine(null);
            if (!f) return;
            // CreateEntryHdl: the entry is shown (and a created one offered); an edited citation is applied at once.
            setFields(f);
            if (bCreate) setCreated(f);
            setEdit(f[ToxAuthorityField.AUTH_FIELD_IDENTIFIER] ?? '');
            if (!bNewEntry) apply(f);
          }} />
      )}
      {ask && <Ask text={t('authmrk.query.change')} onAnswer={(yes) => { const run = ask; setAsk(null); if (yes) run(); }} />}
    </Modal>
  );
}
