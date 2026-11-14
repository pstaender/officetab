// SPDX-License-Identifier: MPL-2.0
// @upstream linguistic/source/gciterator.cxx reduced
// GrammarCheckingIterator: paragraphs to check are queued (AddEntry) and checked in the
// background (DequeueAndCheck); the results are kept (ProcessResult) and the view is told to
// paint again. Reduced:
// - there is no thread: checking is asynchronous, as the proofreader's requests are;
// - checking waits until the queue has been quiet for a moment (typing pauses), and paragraphs
//   of the same language are sent together, joined by blank lines, in one request, whose errors
//   are then split back to the paragraphs: a remote server answers one request per pause instead
//   of one per paragraph;
// - requests can be limited per minute (the free LanguageTool server allows 20) and the queue
//   waits a minute when the server answers 429 (too many requests);
// - results are kept by paragraph text and language, not by document and paragraph object, and
//   the error "ignored once" (SwEditShell::IgnoreGrammarErrorAt) is kept here, by paragraph text.
import type { LanguageToolGrammarChecker, SingleProofreadingError } from '../../lingucomponent/source/spellcheck/languagetool/languagetoolimp.ts';

/** The separator between paragraphs sent in one request: LanguageTool's paragraph boundary. */
const PARA_SEP = '\n\n';

interface FPEntryItem { text: string; lang: string }

export interface GrammarCheckingOptions {
  /** How long the queue must be quiet before it is checked (ms). */
  nDelay?: number;
  /** The most characters sent in one request (the free server takes 20 KB). */
  nMaxChars?: number;
  /** The most requests per minute; 0 for no limit. */
  nMaxRequestsPerMinute?: number;
}

export class GrammarCheckingIterator {
  private static s_nIterators = 0;
  /**
   * Bumped when results arrive or ignore lists change, so that paragraphs are marked again;
   * distinct per iterator, so that a new one (other settings) marks them again too.
   */
  m_nVersion = ++GrammarCheckingIterator.s_nIterators * 1_000_000;
  private m_xChecker: LanguageToolGrammarChecker;
  /** The queue (m_aFPEntriesQueue): the latest text of each paragraph waiting to be checked. */
  private m_aFPEntriesQueue = new Map<object, FPEntryItem>();
  private m_aResults = new Map<string, SingleProofreadingError[]>();
  private m_aIgnoredOnce = new Set<string>();
  private m_nTimer: ReturnType<typeof setTimeout> | null = null;
  private m_bRunning = false;
  private m_aRequestTimes: number[] = [];
  private m_nPausedUntil = 0;
  private m_aIdle: (() => void)[] = [];
  private m_nDelay: number;
  private m_nMaxChars: number;
  private m_nMaxRequestsPerMinute: number;
  private m_fnChanged: () => void;

  constructor(xChecker: LanguageToolGrammarChecker, fnChanged: () => void, opts: GrammarCheckingOptions = {}) {
    this.m_xChecker = xChecker;
    this.m_fnChanged = fnChanged;
    this.m_nDelay = opts.nDelay ?? 800;
    this.m_nMaxChars = opts.nMaxChars ?? 8000;
    this.m_nMaxRequestsPerMinute = opts.nMaxRequestsPerMinute ?? 0;
  }

  private static key(text: string, lang: string): string { return `${lang}\u0000${text}`; }

  /** Whether the proofreader checks a language (getServiceForLocale). */
  hasLocale(lang: string): boolean { return this.m_xChecker.hasLocale(lang); }

  /**
   * The errors of a paragraph's text, or undefined while it is not checked yet; the paragraph
   * (identified by `para`) is then queued (AddEntry).
   */
  GetErrors(para: object, text: string, lang: string): SingleProofreadingError[] | undefined {
    if (!/\S/.test(text)) return [];
    const hit = this.m_aResults.get(GrammarCheckingIterator.key(text, lang));
    if (hit) {
      this.m_aFPEntriesQueue.delete(para);
      return hit.filter((e) => !this.m_xChecker.isRuleIgnored(e.aRuleIdentifier) && !this.m_aIgnoredOnce.has(this.ignoreKey(text, e)));
    }
    this.AddEntry(para, text, lang);
    return undefined;
  }

  private AddEntry(para: object, text: string, lang: string): void {
    const old = this.m_aFPEntriesQueue.get(para);
    if (old && old.text === text && old.lang === lang) return;
    this.m_aFPEntriesQueue.set(para, { text, lang });
    this.schedule();
  }

  private schedule(delay = this.m_nDelay): void {
    if (this.m_bRunning) return;
    if (this.m_nTimer) clearTimeout(this.m_nTimer);
    this.m_nTimer = setTimeout(() => { this.m_nTimer = null; void this.DequeueAndCheck(); }, delay);
  }

  /** isProofreading: whether paragraphs wait to be checked. */
  isProofreading(): boolean { return this.m_bRunning || this.m_aFPEntriesQueue.size > 0; }

  /** Resolves once every queued paragraph is checked. */
  WhenIdle(): Promise<void> {
    if (!this.isProofreading()) return Promise.resolve();
    return new Promise((resolve) => this.m_aIdle.push(resolve));
  }

  private async DequeueAndCheck(): Promise<void> {
    if (this.m_bRunning) return;
    const now = Date.now();
    if (now < this.m_nPausedUntil) { this.schedule(this.m_nPausedUntil - now); return; }
    if (this.m_nMaxRequestsPerMinute) {
      this.m_aRequestTimes = this.m_aRequestTimes.filter((t) => now - t < 60_000);
      if (this.m_aRequestTimes.length >= this.m_nMaxRequestsPerMinute) { this.schedule(60_000 - (now - this.m_aRequestTimes[0]!) + 50); return; }
    }
    // One batch: the first queued paragraph's language, as many paragraphs as fit.
    const batch: { para: object; item: FPEntryItem }[] = [];
    let len = 0;
    for (const [para, item] of this.m_aFPEntriesQueue) {
      if (batch.length && (item.lang !== batch[0]!.item.lang || len + PARA_SEP.length + item.text.length > this.m_nMaxChars)) continue;
      if (batch.some((b) => b.item.text === item.text)) { batch.push({ para, item }); continue; }
      batch.push({ para, item });
      len += (len ? PARA_SEP.length : 0) + item.text.length;
    }
    if (!batch.length) { this.idle(); return; }
    this.m_bRunning = true;
    const texts = [...new Set(batch.map((b) => b.item.text))];
    const lang = batch[0]!.item.lang;
    this.m_aRequestTimes.push(now);
    let status = 0;
    try {
      const res = await this.m_xChecker.doProofreading('', texts.join(PARA_SEP), lang);
      status = res.nHttpStatus;
      // Without an answer (the server is not running), the paragraphs stay unchecked until they change.
      if (status !== 429 && status !== 0) this.ProcessResult(texts, lang, res.aErrors);
    } finally {
      this.m_bRunning = false;
    }
    if (status === 429) this.m_nPausedUntil = Date.now() + 60_000;
    else for (const b of batch) if (this.m_aFPEntriesQueue.get(b.para) === b.item) this.m_aFPEntriesQueue.delete(b.para);
    if (this.m_aFPEntriesQueue.size) this.schedule(0);
    else this.idle();
  }

  /** ProcessResult: the errors of the joined text, back to each paragraph. */
  private ProcessResult(texts: string[], lang: string, aErrors: SingleProofreadingError[]): void {
    let start = 0;
    for (const text of texts) {
      const end = start + text.length;
      const mine = aErrors
        .filter((e) => e.nErrorStart >= start && e.nErrorStart + e.nErrorLength <= end)
        .map((e) => ({ ...e, nErrorStart: e.nErrorStart - start }));
      this.m_aResults.set(GrammarCheckingIterator.key(text, lang), mine);
      start = end + PARA_SEP.length;
    }
    // Keep the most recent results only.
    while (this.m_aResults.size > 2000) this.m_aResults.delete(this.m_aResults.keys().next().value!);
    this.m_nVersion++;
    this.m_fnChanged();
  }

  private idle(): void {
    const waiting = this.m_aIdle;
    this.m_aIdle = [];
    for (const f of waiting) f();
  }

  private ignoreKey(text: string, e: SingleProofreadingError): string {
    return `${text}\u0000${e.nErrorStart}\u0000${e.nErrorLength}\u0000${e.aRuleIdentifier}`;
  }

  /** SwEditShell::IgnoreGrammarErrorAt: the error is not shown until its paragraph changes. */
  IgnoreGrammarErrorAt(text: string, e: SingleProofreadingError): void {
    this.m_aIgnoredOnce.add(this.ignoreKey(text, e));
    this.m_nVersion++;
  }

  /** XProofreader::ignoreRule (Ignore All on a grammar error). */
  ignoreRule(aRuleIdentifier: string): void {
    this.m_xChecker.ignoreRule(aRuleIdentifier);
    this.m_nVersion++;
  }

  resetIgnoreRules(): void {
    this.m_xChecker.resetIgnoreRules();
    this.m_aIgnoredOnce.clear();
    this.m_nVersion++;
  }

  /** dispose: stops checking. */
  dispose(): void {
    if (this.m_nTimer) clearTimeout(this.m_nTimer);
    this.m_nTimer = null;
    this.m_aFPEntriesQueue.clear();
    this.idle();
  }
}
