// SPDX-License-Identifier: MPL-2.0
// @upstream lingucomponent/source/spellcheck/languagetool/languagetoolimp.cxx reduced
// @upstream lingucomponent/source/spellcheck/languagetool/languagetoolimp.hxx reduced
// @upstream lingucomponent/config/Linguistic-lingucomponent-grammarchecker.xcu reduced
// The LanguageTool remote grammar checker (com.sun.star.linguistic2.Proofreader). Reduced:
// - requests go through fetch (asynchronous) instead of cURL, so doProofreading returns a promise;
//   the fetch function is supplied by the caller;
// - the configuration (officecfg Linguistic/GrammarChecking/LanguageTool) is an object set by the
//   caller; SSLCertVerify is left out, as a browser decides about certificates itself;
// - a failed request (upstream's lclShowCURLErrorInteraction) is reported through a callback,
//   once per server; the result carries the HTTP status, so that callers can back off on 429;
// - the result keeps only what the shell uses: the errors, and of each error also the rule
//   identifier and the category, which upstream drops (the category decides spelling or grammar);
// - the sentence bookkeeping of ProofreadingResult (nStartOfNextSentencePosition and the spaces
//   after it) is left out: the whole text is one unit, as upstream treats it;
// - the cache of results (o3tl::lru_map of 10) is a Map in insertion order;
// - the caller may restrict the supported locales (LanguageTool running in the browser has fewer
//   languages than a server).

/** officecfg::Office::Linguistic::GrammarChecking::LanguageTool */
export interface LanguageToolCfg {
  IsEnabled: boolean;
  BaseURL: string;
  Username: string;
  ApiKey: string;
  RestProtocol: string;
}

/** cui/source/options/optlanguagetool.cxx */
export const LANGUAGETOOL_DEFAULT_URL = 'https://api.languagetool.org/v2';
export const LANGUAGETOOLPLUS_DEFAULT_URL = 'https://api.languagetoolplus.com/v2';

const sDuden = 'duden';

/** com.sun.star.text.TextMarkupType */
export const TextMarkupType = { SPELLCHECK: 1, PROOFREADING: 2 } as const;

/** com.sun.star.linguistic2.SingleProofreadingError */
export interface SingleProofreadingError {
  nErrorStart: number;
  nErrorLength: number;
  nErrorType: number;
  aRuleIdentifier: string;
  aShortComment: string;
  aFullComment: string;
  aSuggestions: string[];
  /** aProperties: the LineColor property, as a CSS colour. */
  aProperties: { LineColor: string };
  /** The LanguageTool rule category ("TYPOS", "GRAMMAR", ...) or the Duden type ("orth", ...). */
  aCategory: string;
}

/** com.sun.star.linguistic2.ProofreadingResult, reduced. */
export interface ProofreadingResult {
  aDocumentIdentifier: string;
  aText: string;
  aLocale: string;
  aErrors: SingleProofreadingError[];
  /** The response's HTTP status (0 when the server could not be reached; 200 without a request). */
  nHttpStatus: number;
}

/** svtools/strings.hrc */
const STR_DESCRIPTION_LANGUAGETOOL = 'LanguageTool Remote Grammar Checker';
const STR_DESCRIPTION_SPELLING_ERROR = 'Spelling error';
const STR_DESCRIPTION_GRAMMAR_ERROR = 'Grammar error';
const STR_DESCRIPTION_STYLE_ERROR = 'Bad style';

const MAX_SUGGESTIONS_SIZE = 10;

/** The locales of Linguistic-lingucomponent-grammarchecker.xcu (GrammarCheckers' Locales). */
const LANGUAGETOOL_LOCALES = 'ar ast-ES be-BY br-FR ca-ES ca-ES-valencia zh-CN da-DK nl nl-BE en en-AU en-CA en-GB en-NZ en-ZA en-US fr gl-ES de de-AT de-DE de-CH el-GR ga-IE it ja-JP km-KH nb no fa pl-PL pt pt-AO pt-BR pt-MZ pt-PT ro-RO ru-RU de-DE-x-simple-language sk-SK sl-SI es es-AR sv tl-PH ta-IN uk-UA'.split(' ');

// tools/color.hxx
const COL_LIGHTRED = '#ff0000';
const COL_LIGHTBLUE = '#0000ff';

function lcl_GetLineColorPropertyFromErrorId(rErrorId: string): { LineColor: string } {
  let aColor: string;
  if (rErrorId === 'TYPOS' || rErrorId === 'orth') {
    aColor = COL_LIGHTRED;
  } else if (rErrorId === 'STYLE') {
    aColor = COL_LIGHTBLUE;
  } else {
    // Same color is used for other errorId's such as GRAMMAR, TYPOGRAPHY..
    const COL_ORANGE = '#d16820';
    aColor = COL_ORANGE;
  }
  return { LineColor: aColor };
}

/** Whether an error is a spelling error (red), not a grammar or style one. */
export const IsSpellingError = (e: SingleProofreadingError): boolean => e.aCategory === 'TYPOS' || e.aCategory === 'orth' || e.aCategory === 'term';

export function encodeTextForLT(text: string): string {
  // Let's be a bit conservative. I don't find a good description what needs encoding (and in
  // which way) at https://languagetool.org/http-api/; the "Try it out!" function shows that
  // different cases are handled differently by the demo; some percent-encode the UTF-8
  // representation, like %D0%90 (for cyrillic А); some turn into entities like &#33; (for
  // exclamation mark !); some other to things like ' (for apostrophe '). So only keep
  // RFC 3986's "Unreserved Characters" set unencoded, use UTF-8 percent-encoding for the rest.
  return encodeURIComponent(text.toWellFormed()).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** makeHttpRequest_impl: the response body and status; status 0 when no response came. */
async function makeHttpRequest_impl(fetchFn: FetchFn, aURL: string, aPostData: string, aHeaders: Record<string, string>): Promise<{ body: string; status: number; error?: string }> {
  try {
    const res = await fetchFn(aURL, { method: 'POST', headers: aHeaders, body: aPostData, signal: AbortSignal.timeout(10_000) });
    // CURLOPT_FAILONERROR: no body for an error status.
    return { body: res.status === 200 ? await res.text() : '', status: res.status };
  } catch (e) {
    return { body: '', status: 0, error: (e as Error).message };
  }
}

function makeDudenHttpRequest(fetchFn: FetchFn, cfg: LanguageToolCfg, aURL: string, aPostData: string) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' };
  const sAccessToken = cfg.ApiKey;
  if (sAccessToken) headers['access_token'] = sAccessToken;
  return makeHttpRequest_impl(fetchFn, aURL, aPostData, headers);
}

function makeHttpRequest(fetchFn: FetchFn, cfg: LanguageToolCfg, aURL: string, aPostData: string) {
  let realPostData = aPostData;
  const apiKey = cfg.ApiKey;
  const username = cfg.Username;
  if (apiKey && username)
    realPostData += '&username=' + encodeTextForLT(username) + '&apiKey=' + apiKey;
  return makeHttpRequest_impl(fetchFn, aURL, realPostData, { 'Content-Type': 'application/x-www-form-urlencoded' });
}

type Json = Record<string, unknown>;

function parseJson(json: string, path: string, f: (rError: Json) => SingleProofreadingError): SingleProofreadingError[] {
  let aRoot: Json = {};
  // tdf#161858 prevent crashing by catching any JSON exceptions
  try {
    aRoot = JSON.parse(json) as Json;
  } catch {
    // parseJson: read_json() threw exception
  }
  const tree = aRoot?.[path];
  return Array.isArray(tree) ? tree.map((e) => f((e ?? {}) as Json)) : [];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown): number => (typeof v === 'number' ? v : 0);

function DudenTypeToComment(type: string): string {
  // TODO: consider also "errorcode", some values of which are explained
  // at https://main.dks.epc.de/doc/Relnotes.html
  let id = STR_DESCRIPTION_SPELLING_ERROR; // matches both "orth" and "term"
  if (type === 'gram')
    id = STR_DESCRIPTION_GRAMMAR_ERROR;
  else if (type === 'style')
    id = STR_DESCRIPTION_STYLE_ERROR;
  return id;
}

function parseDudenResponse(rResult: ProofreadingResult, aJSONBody: string): void {
  rResult.aErrors = parseJson(aJSONBody, 'check-positions', (rPos) => {
    const sType = str(rPos['type']);
    const aShortComment = DudenTypeToComment(sType);
    const proposals = rPos['proposals'];
    return {
      nErrorStart: int(rPos['offset']),
      nErrorLength: int(rPos['length']),
      nErrorType: TextMarkupType.PROOFREADING,
      aRuleIdentifier: str(rPos['errorcode']),
      aShortComment,
      aFullComment: aShortComment,
      aProperties: lcl_GetLineColorPropertyFromErrorId(sType),
      aCategory: sType,
      aSuggestions: Array.isArray(proposals) ? proposals.slice(0, MAX_SUGGESTIONS_SIZE).map(str) : [],
    };
  });
}

/*
    rResult is both input and output
    aJSONBody is the response body from the HTTP Request to LanguageTool API
*/
function parseProofreadingJSONResponse(rResult: ProofreadingResult, aJSONBody: string): void {
  rResult.aErrors = parseJson(aJSONBody, 'matches', (match) => {
    const shortMessage = str(match['message']);
    const message = str(match['shortMessage']);

    // Parse the error category for Line Color
    let errorCategoryId = '';
    const rule = (match['rule'] ?? null) as Json | null;
    const ruleCategory = (rule?.['category'] ?? null) as Json | null;
    if (ruleCategory) errorCategoryId = str(ruleCategory['id']);

    const replacements = match['replacements'];
    // Limit suggestions to avoid crash on context menu popup
    return {
      nErrorStart: int(match['offset']),
      nErrorLength: int(match['length']),
      nErrorType: TextMarkupType.PROOFREADING,
      aRuleIdentifier: str(rule?.['id']),
      aShortComment: shortMessage,
      aFullComment: message,
      aProperties: lcl_GetLineColorPropertyFromErrorId(errorCategoryId),
      aCategory: errorCategoryId,
      aSuggestions: Array.isArray(replacements) ? replacements.slice(0, MAX_SUGGESTIONS_SIZE).map((r) => str((r as Json)?.['value'])) : [],
    };
  });
}

function getCheckerURL(cfg: LanguageToolCfg): string {
  if (cfg.BaseURL)
    return cfg.BaseURL.replace(/\/+$/, '') + '/check';
  return '';
}

export class LanguageToolGrammarChecker {
  private m_aSuppLocales: string[] | null = null;
  private mCachedResults = new Map<string, SingleProofreadingError[]>();
  private maLastErrorCheckerURL = '';
  /** The rules ignored with Ignore All (upstream's ignoreRule does nothing). */
  private m_aIgnoredRules = new Set<string>();

  private cfg: LanguageToolCfg;
  private fetchFn: FetchFn;
  /** lclShowCURLErrorInteraction */
  private onError: (message: string, server: string) => void;

  constructor(cfg: LanguageToolCfg, fetchFn: FetchFn, onError: (message: string, server: string) => void = () => {}, aLocales: string[] | null = null) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
    this.onError = onError;
    this.m_aSuppLocales = aLocales;
  }

  isSpellChecker(): boolean { return false; }

  /** hasLocale; a locale of a language listed without a country ("fr" for fr-FR) is supported too. */
  hasLocale(rLocale: string): boolean {
    const locales = this.getLocales();
    if (locales.includes(rLocale)) return true;
    const primary = rLocale.split('-')[0]!;
    return locales.includes(primary);
  }

  getLocales(): string[] {
    if (!this.cfg.IsEnabled) return [];
    if (this.m_aSuppLocales) return this.m_aSuppLocales;
    if (this.cfg.RestProtocol === sDuden)
      this.m_aSuppLocales = ['de-DE', 'en-US', 'en-GB'];
    else
      this.m_aSuppLocales = LANGUAGETOOL_LOCALES;
    return this.m_aSuppLocales;
  }

  async doProofreading(aDocumentIdentifier: string, aText: string, aLocale: string): Promise<ProofreadingResult> {
    // ProofreadingResult declared here instead of parseHttpJSONResponse because of the early exists.
    const xRes: ProofreadingResult = { aDocumentIdentifier, aText, aLocale, aErrors: [], nHttpStatus: 200 };

    if (!aText) return xRes;
    if (!this.cfg.IsEnabled) return xRes;

    const checkerURL = getCheckerURL(this.cfg);
    if (!checkerURL) return xRes;

    const langTag = aLocale;
    let postData: string;
    const bDudenProtocol = this.cfg.RestProtocol === sDuden;
    if (bDudenProtocol) {
      postData = JSON.stringify({
        'text-language': langTag,
        text: aText, // We don't encode the text in Duden Corrector tool case.
        hyphenation: false,
        'spellchecking-level': 3,
        'correction-proposals': true,
      });
    } else {
      postData = 'text=' + encodeTextForLT(aText) + '&language=' + langTag;
    }

    const cachedResult = this.mCachedResults.get(postData);
    if (cachedResult) {
      xRes.aErrors = cachedResult;
      return xRes;
    }

    const res = bDudenProtocol
      ? await makeDudenHttpRequest(this.fetchFn, this.cfg, checkerURL, postData)
      : await makeHttpRequest(this.fetchFn, this.cfg, checkerURL, postData);
    xRes.nHttpStatus = res.status;

    if (res.status === 0) {
      // show the cURL error only once for a given checkerURL
      if (this.maLastErrorCheckerURL !== checkerURL) {
        this.maLastErrorCheckerURL = checkerURL;
        this.onError(res.error ?? 'No connection', checkerURL);
      }
    }

    if (res.status !== 200) return xRes;
    if (res.body.length <= 0) return xRes;

    if (bDudenProtocol)
      parseDudenResponse(xRes, res.body);
    else
      parseProofreadingJSONResponse(xRes, res.body);
    // cache the result
    this.mCachedResults.set(postData, xRes.aErrors);
    if (this.mCachedResults.size > 10) this.mCachedResults.delete(this.mCachedResults.keys().next().value!);
    return xRes;
  }

  ignoreRule(aRuleIdentifier: string): void { if (aRuleIdentifier) this.m_aIgnoredRules.add(aRuleIdentifier); }
  resetIgnoreRules(): void { this.m_aIgnoredRules.clear(); }
  isRuleIgnored(aRuleIdentifier: string): boolean { return this.m_aIgnoredRules.has(aRuleIdentifier); }

  getServiceDisplayName(): string { return STR_DESCRIPTION_LANGUAGETOOL; }
  getImplementationName(): string { return 'org.openoffice.lingu.LanguageToolGrammarChecker'; }
}
