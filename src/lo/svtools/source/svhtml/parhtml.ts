// SPDX-License-Identifier: MPL-2.0
// @upstream svtools/source/svhtml/parhtml.cxx reduced
// @upstream include/svtools/parhtml.hxx reduced
// @upstream svtools/source/svrtf/svparser.cxx reduced
// The HTML tokenizer: SvParser's loop with HTMLParser's scanner. It reads a string (the caller
// decodes the bytes, see GetEncodingFromMeta); options are returned by name rather than by
// HtmlOptionId; the source is read in one pass (no pending state for asynchronous streams); the
// XHTML namespace prefix, the SGML comment hacks and the &{...}; macros are not supported.
import { HtmlTokenId, isOffToken } from '../../../include/svtools/htmltokn.ts';
import { GetHTMLToken, GetHTMLCharName } from './htmlkywd.ts';

/** An option of a tag: its name in lower case and its value with the entities resolved. */
export class HTMLOption {
  readonly aToken: string;
  readonly aValue: string;
  constructor(aToken: string, aValue: string) { this.aToken = aToken; this.aValue = aValue; }
  GetString(): string { return this.aValue; }
  GetNumber(): number {
    const n = parseInt(this.aValue.trim(), 10);
    return Number.isNaN(n) || n < 0 ? 0 : n;
  }
  GetSNumber(): number {
    const n = parseInt(this.aValue.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  }
}
export type HTMLOptions = HTMLOption[];

const MAX_ENTITY_LEN = 8;
const HTML_ISSPACE = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\x0b';
const isAsciiAlpha = (c: string) => /^[A-Za-z]$/.test(c);
const isAsciiAlnum = (c: string) => /^[A-Za-z0-9]$/.test(c);
/** linguistic::IsControlChar */
const IsControlChar = (c: string) => c.charCodeAt(0) < 0x20;

export abstract class HTMLParser {
  private readonly rInput: string;
  private nPos = 0;
  /** The current character; '' at the end of the input (EOF). */
  protected nNextCh = '';
  /** The text of a text token, the comment of a comment, the options of a tag. */
  protected aToken = '';
  /** The tag name as written (before converting to lower case). */
  protected sSaveToken = '';
  private maOptions: HTMLOptions | null = null;
  private mnPendingOffToken: HtmlTokenId = HtmlTokenId.NONE;

  protected bReadListing = false;
  protected bReadXMP = false;
  protected bReadPRE = false;
  protected bReadTextArea = false;
  protected bReadScript = false;
  protected bReadStyle = false;
  private bEndTokenFound = false;
  private bPre_IgnoreNewPara = false;
  private nPre_LinePos = 0;
  /** The tag that ends a raw section (</script>, </style>). */
  private aEndToken = '';
  protected m_bPreserveSpaces = false;

  constructor(rIn: string) {
    this.rInput = rIn.replace(/\r\n?/g, '\n');
  }

  private GetNextChar(): string {
    if (this.nPos >= this.rInput.length) { this.nPos = this.rInput.length + 1; return ''; }
    const c = this.rInput.codePointAt(this.nPos)!;
    const s = String.fromCodePoint(c);
    this.nPos += s.length;
    return s;
  }
  private eof(): boolean { return this.nPos > this.rInput.length; }

  /** The derived parser handles a token. */
  protected abstract NextToken(nToken: HtmlTokenId): void;

  /** SvParser::Continue: reads all tokens. */
  protected Continue(): void {
    this.nNextCh = this.GetNextChar();
    for (;;) {
      if (this.eof() && !this.nNextCh && this.mnPendingOffToken === HtmlTokenId.NONE) break;
      let nToken = this.GetNextToken_();
      nToken = this.FilterToken(nToken);
      if (nToken !== HtmlTokenId.NONE) this.NextToken(nToken);
      else if (this.eof()) break;
    }
  }

  /** HTMLParser::FilterToken: switches to and from PRE, LISTING and XMP. */
  protected FilterToken(nToken: HtmlTokenId): HtmlTokenId {
    switch (nToken) {
      case HtmlTokenId.NONE: return nToken;
      case HtmlTokenId.HEAD_ON: case HtmlTokenId.HEAD_OFF: case HtmlTokenId.BODY_ON: case HtmlTokenId.BODY_OFF:
      case HtmlTokenId.HTML_ON: case HtmlTokenId.HTML_OFF:
        break;
      case HtmlTokenId.PREFORMTXT_ON:
        this.StartPRE();
        break;
      case HtmlTokenId.PREFORMTXT_OFF:
        this.FinishPRE();
        break;
      case HtmlTokenId.LISTING_ON:
        this.StartListing();
        break;
      case HtmlTokenId.LISTING_OFF:
        this.FinishListing();
        break;
      case HtmlTokenId.XMP_ON:
        this.StartXMP();
        break;
      case HtmlTokenId.XMP_OFF:
        this.FinishXMP();
        break;
      default:
        if (this.bReadPRE) nToken = this.FilterPRE(nToken);
        else if (this.bReadListing) nToken = this.FilterListing(nToken);
        else if (this.bReadXMP) nToken = this.FilterXMP(nToken);
        break;
    }
    return nToken;
  }

  protected StartPRE(): void { this.bReadPRE = true; this.bPre_IgnoreNewPara = true; this.nPre_LinePos = 0; }
  protected FinishPRE(): void { this.bReadPRE = false; }
  protected IsReadPRE(): boolean { return this.bReadPRE; }
  protected StartListing(): void { this.bReadListing = true; this.bPre_IgnoreNewPara = true; this.nPre_LinePos = 0; }
  protected FinishListing(): void { this.bReadListing = false; }
  protected StartXMP(): void { this.bReadXMP = true; this.bPre_IgnoreNewPara = true; this.nPre_LinePos = 0; }
  protected FinishXMP(): void { this.bReadXMP = false; }
  protected IsReadScript(): boolean { return this.bReadScript; }
  protected IsReadStyle(): boolean { return this.bReadStyle; }

  /** HTMLParser::FilterPRE: line feeds become new paragraphs, tabs spaces to the next tab stop of 8. */
  protected FilterPRE(nToken: HtmlTokenId): HtmlTokenId {
    // in Netscape they only have impact in not empty paragraphs
    if (nToken === HtmlTokenId.PARABREAK_ON) nToken = HtmlTokenId.LINEBREAK;
    switch (nToken) {
      case HtmlTokenId.LINEBREAK: case HtmlTokenId.NEWPARA:
        this.nPre_LinePos = 0;
        if (this.bPre_IgnoreNewPara) nToken = HtmlTokenId.NONE;
        break;
      case HtmlTokenId.TABCHAR: {
        const nSpaces = 8 - (this.nPre_LinePos % 8);
        if (this.aToken.length < nSpaces) this.aToken = this.aToken.padEnd(nSpaces, ' ');
        this.nPre_LinePos += nSpaces;
        nToken = HtmlTokenId.TEXTTOKEN;
        break;
      }
      // Keep those
      case HtmlTokenId.TEXTTOKEN:
        this.nPre_LinePos += this.aToken.length;
        break;
      default:
        // The tokens of PRE_KEEP keep their meaning; the remainder is treated as an unknown token.
        if (!PRE_KEEP.has(nToken)) nToken = (nToken >= HtmlTokenId.ONOFF_START && isOffToken(nToken)) ? HtmlTokenId.UNKNOWNCONTROL_OFF : HtmlTokenId.UNKNOWNCONTROL_ON;
        break;
    }
    this.bPre_IgnoreNewPara = false;
    return nToken;
  }

  protected FilterListing(nToken: HtmlTokenId): HtmlTokenId {
    switch (nToken) {
      case HtmlTokenId.NEWPARA:
        if (this.bPre_IgnoreNewPara) nToken = HtmlTokenId.NONE;
        break;
      case HtmlTokenId.TEXTTOKEN: case HtmlTokenId.NONBREAKSPACE: case HtmlTokenId.SOFTHYPH:
        break;
      default:
        if (nToken !== HtmlTokenId.NONE) nToken = (nToken >= HtmlTokenId.ONOFF_START && isOffToken(nToken)) ? HtmlTokenId.UNKNOWNCONTROL_OFF : HtmlTokenId.UNKNOWNCONTROL_ON;
        break;
    }
    this.bPre_IgnoreNewPara = false;
    return nToken;
  }

  protected FilterXMP(nToken: HtmlTokenId): HtmlTokenId {
    switch (nToken) {
      case HtmlTokenId.NEWPARA:
        if (this.bPre_IgnoreNewPara) nToken = HtmlTokenId.NONE;
        break;
      case HtmlTokenId.TEXTTOKEN: case HtmlTokenId.NONBREAKSPACE: case HtmlTokenId.SOFTHYPH:
        break;
      default:
        if (nToken !== HtmlTokenId.NONE) {
          // The tag is text in XMP.
          this.aToken = `<${isOffToken(nToken) ? '/' : ''}${this.sSaveToken}${this.aToken ? ` ${this.aToken}` : ''}>`;
          nToken = HtmlTokenId.TEXTTOKEN;
        }
        break;
    }
    this.bPre_IgnoreNewPara = false;
    return nToken;
  }

  /** HTMLParser::ScanText: text up to cBreak ('<' for text, '>' for the options of a tag). */
  private ScanText(cBreak = ''): HtmlTokenId {
    let sTmpBuffer = '';
    let bContinue = true;
    let bEqSignFound = false;
    let cQuote = '';

    while (bContinue && !(this.eof() && !this.nNextCh)) {
      let bNextCh = true;
      switch (this.nNextCh) {
        case '&': {
          bEqSignFound = false;
          if (this.bReadXMP) { sTmpBuffer += '&'; break; }
          const nStreamPos = this.nPos;
          let cChar = 0;
          if ((this.nNextCh = this.GetNextChar()) === '#') {
            this.nNextCh = this.GetNextChar();
            const bIsHex = this.nNextCh === 'x' || this.nNextCh === 'X';
            if (bIsHex || /[0-9]/.test(this.nNextCh)) {
              if (bIsHex) {
                this.nNextCh = this.GetNextChar();
                while (/[0-9A-Fa-f]/.test(this.nNextCh) && this.nNextCh) { cChar = cChar * 16 + parseInt(this.nNextCh, 16); this.nNextCh = this.GetNextChar(); }
              } else {
                do { cChar = cChar * 10 + parseInt(this.nNextCh, 10); this.nNextCh = this.GetNextChar(); } while (/[0-9]/.test(this.nNextCh) && this.nNextCh);
              }
            } else {
              // "&#" without a number is text
              sTmpBuffer += '&#';
              bNextCh = false;
              break;
            }
            if (cChar > 0x10ffff || (cChar >= 0xd800 && cChar <= 0xdfff) || (cChar < 0x20 && cChar !== 13 && cChar !== 10 && cChar !== 9)) cChar = '?'.charCodeAt(0);
          } else if (isAsciiAlpha(this.nNextCh)) {
            let sEntityBuffer = '';
            let nPos = 0;
            do {
              sEntityBuffer += this.nNextCh;
              nPos++;
              this.nNextCh = this.GetNextChar();
            } while (nPos < MAX_ENTITY_LEN && isAsciiAlnum(this.nNextCh) && !this.eof());
            cChar = GetHTMLCharName(sEntityBuffer);
            // not found ( == 0 ): plain text, or an entity without ';' that is longer than a known one
            if (cChar === 0 && this.nNextCh !== ';') {
              for (let i = nPos - 1; i > 1; i--) {
                cChar = GetHTMLCharName(sEntityBuffer.slice(0, i));
                if (cChar) {
                  // back to the character after the shorter entity
                  this.nPos = nStreamPos + i + 1;
                  this.nNextCh = sEntityBuffer[i]!;
                  break;
                }
              }
            }
            if (!cChar) {
              // unknown character: back in stream, insert '&' and restart with the next character
              sTmpBuffer += '&';
              this.nPos = nStreamPos;
              this.nNextCh = this.GetNextChar();
              bNextCh = false;
              break;
            }
          } else {
            // &{...};-JavaScript-Macros are not supported any longer.
            sTmpBuffer += '&';
            bNextCh = false;
            break;
          }
          bNextCh = this.nNextCh === ';';
          if (cBreak === '>' && (cChar === 0x5c || cChar === 0x27 || cChar === 0x22 || cChar === 0x20)) {
            // ' and " have to be escaped within tags to separate them from ' and " enclosing
            // options. \ has to be escaped as well. Space is protected because it's not a
            // delimiter between options.
            sTmpBuffer += '\\';
          }
          // 1 and 2 are &nbsp; and &shy; (upstream: NONBREAKSPACE and SOFTHYPH tokens, which the
          // Writer parser inserts as CHAR_HARDBLANK and CHAR_SOFTHYPHEN).
          if (cChar === 1) sTmpBuffer += '\u00a0';
          else if (cChar === 2) sTmpBuffer += '\u00ad';
          else if (cChar) sTmpBuffer += String.fromCodePoint(cChar);
          break;
        }
        case '=':
          if (cBreak === '>' && !cQuote) bEqSignFound = true;
          sTmpBuffer += this.nNextCh;
          break;
        case '\\':
          // mark within tags
          if (cBreak === '>') sTmpBuffer += '\\';
          sTmpBuffer += '\\';
          break;
        case '"': case '\'':
          if (cBreak === '>') {
            if (bEqSignFound) cQuote = this.nNextCh;
            else if (cQuote && cQuote === this.nNextCh) cQuote = '';
          }
          sTmpBuffer += this.nNextCh;
          bEqSignFound = false;
          break;
        case '':
          bContinue = false;
          break;
        case '<':
          bEqSignFound = false;
          if (cBreak === '>') sTmpBuffer += this.nNextCh;
          else bContinue = false; // break, string is together
          break;
        case '\f':
          // If scanning options treat it like a space, otherwise it's a separate token.
          if (cBreak === '>') sTmpBuffer += ' ';
          else bContinue = false;
          break;
        case '\n': case '\t': case '\x0b': case ' ':
          if (this.nNextCh === '\n') {
            if (cBreak === '>') { sTmpBuffer += this.nNextCh; break; }
            if (this.bReadListing || this.bReadXMP || this.bReadPRE || this.bReadTextArea) { bContinue = false; break; }
            // Reduce sequence of CR/LF/BLANK/TAB to a single blank
          }
          if (this.nNextCh === '\t' && this.bReadPRE && cBreak !== '>') { bContinue = false; break; } // Pass Tabs up in <PRE>
          if (this.nNextCh === '\x0b' && (this.bReadPRE || this.bReadXMP || this.bReadListing) && cBreak !== '>') break;
          if (!this.m_bPreserveSpaces) {
            this.nNextCh = ' ';
            sTmpBuffer += this.nNextCh;
            if (cBreak !== '>' && !this.bReadListing && !this.bReadXMP && !this.bReadPRE && !this.bReadTextArea) {
              // Reduce sequences of Blanks/Tabs/CR/LF to a single blank
              do {
                this.nNextCh = this.GetNextChar();
                if (!this.nNextCh && this.eof()) {
                  // Have seen s.th. aside from blanks?
                  if (this.aToken || sTmpBuffer.length > 1) { this.aToken += sTmpBuffer; return HtmlTokenId.TEXTTOKEN; }
                  // Only read blanks: no text must be returned
                  return HtmlTokenId.NONE;
                }
              } while (HTML_ISSPACE(this.nNextCh));
              bNextCh = false;
            }
            break;
          }
          sTmpBuffer += this.nNextCh;
          break;
        default:
          bEqSignFound = false;
          if (this.nNextCh === cBreak && !cQuote) bContinue = false;
          else {
            // All remaining characters make their way into the text.
            if (!IsControlChar(this.nNextCh) || HTML_ISSPACE(this.nNextCh)) sTmpBuffer += this.nNextCh;
          }
          break;
      }
      if (bContinue && bNextCh) this.nNextCh = this.GetNextChar();
    }
    this.aToken += sTmpBuffer;
    return HtmlTokenId.TEXTTOKEN;
  }

  /** HTMLParser::GetNextRawToken: the content of <SCRIPT>, <STYLE> and the like, up to its end tag. */
  private GetNextRawToken(): HtmlTokenId {
    if (this.bEndTokenFound) {
      // During the last execution we already found the end token, thus we don't have to search it again.
      this.bReadScript = false;
      this.bReadStyle = false;
      this.aEndToken = '';
      this.bEndTokenFound = false;
      return HtmlTokenId.NONE;
    }
    const sEnd = `</${this.aEndToken}`;
    // The source up to the end tag (ignoring case), from the current character on.
    const nStart = this.nPos - this.nNextCh.length;
    const nEnd = this.rInput.toLowerCase().indexOf(sEnd, nStart);
    const nStop = nEnd < 0 ? this.rInput.length : nEnd;
    this.aToken = this.rInput.slice(nStart, nStop);
    this.nPos = nStop;
    this.nNextCh = this.GetNextChar();
    this.bEndTokenFound = true;
    if (!this.aToken) return this.GetNextRawToken();
    return HtmlTokenId.RAWDATA;
  }

  /** HTMLParser::GetNextToken_ */
  private GetNextToken_(): HtmlTokenId {
    let nRet: HtmlTokenId = HtmlTokenId.NONE;
    this.sSaveToken = '';

    if (this.mnPendingOffToken !== HtmlTokenId.NONE) {
      // HtmlTokenId::<TOKEN>_OFF generated for HtmlTokenId::<TOKEN>_ON
      nRet = this.mnPendingOffToken;
      this.mnPendingOffToken = HtmlTokenId.NONE;
      this.aToken = '';
      return nRet;
    }

    // Delete options
    this.maOptions = null;

    if (this.bReadScript || this.bReadStyle || this.aEndToken) {
      nRet = this.GetNextRawToken();
      if (nRet !== HtmlTokenId.NONE) return nRet;
    }

    do {
      let bNextCh = true;
      this.aToken = '';
      switch (this.nNextCh) {
        case '<': {
          const nStreamPos = this.nPos;
          let bOffState = false;
          if ((this.nNextCh = this.GetNextChar()) === '/') {
            bOffState = true;
            this.nNextCh = this.GetNextChar();
          }
          // Assume '<?' is a start of an XML declaration, ignore it.
          if (isAsciiAlpha(this.nNextCh) || this.nNextCh === '!' || this.nNextCh === '?') {
            let sTmpBuffer = '';
            do {
              sTmpBuffer += this.nNextCh;
              this.nNextCh = this.GetNextChar();
              if (sTmpBuffer === '![CDATA[') break;
            } while (this.nNextCh !== '>' && this.nNextCh !== '/' && !HTML_ISSPACE(this.nNextCh) && !IsControlChar(this.nNextCh) && this.nNextCh);
            this.aToken = sTmpBuffer;
            // Skip blanks
            while (HTML_ISSPACE(this.nNextCh)) this.nNextCh = this.GetNextChar();

            // Search token in table:
            this.sSaveToken = this.aToken;
            this.aToken = this.aToken.toLowerCase();
            if ((nRet = GetHTMLToken(this.aToken)) === HtmlTokenId.NONE) {
              // Unknown control
              nRet = HtmlTokenId.UNKNOWNCONTROL_ON;
            }
            // If it's a token which can be switched off...
            if (bOffState) {
              if (nRet >= HtmlTokenId.ONOFF_START) {
                // and there is an off token, return off token instead
                nRet = (nRet + 1) as HtmlTokenId;
              } else if (nRet === HtmlTokenId.LINEBREAK) {
                // and there is an off token, return off token instead
                // </BR> is treated as <BR> (Netscape)
                bOffState = false;
              } else {
                // don't return a token at all
                nRet = HtmlTokenId.NONE;
              }
            }

            if (nRet === HtmlTokenId.COMMENT || nRet === HtmlTokenId.CDATA) {
              // The text of the comment ("<!--" to "-->") or of the CDATA section ("<![CDATA[" to "]]>").
              const nStart = nStreamPos + (nRet === HtmlTokenId.COMMENT ? 3 : 8);
              const nEnd = this.rInput.indexOf(nRet === HtmlTokenId.COMMENT ? '-->' : ']]>', nStart);
              this.aToken = this.rInput.slice(nStart, nEnd < 0 ? this.rInput.length : nEnd);
              this.nPos = nEnd < 0 ? this.rInput.length : nEnd + 3;
              this.nNextCh = this.GetNextChar();
              bNextCh = false;
              break;
            }

            // Read the options of the tag (or the rest of a <!...> or <?...> declaration).
            this.aToken = '';
            if (this.nNextCh !== '>') {
              this.ScanText('>');
              // fdo#34666 fdo#36080 fdo#36390: closing "/>"?
              if (this.aToken.endsWith('/') && nRet >= HtmlTokenId.ONOFF_START && !isOffToken(nRet)) {
                this.mnPendingOffToken = (nRet + 1) as HtmlTokenId;
                this.aToken = this.aToken.slice(0, -1).trimEnd();
              } else if (this.aToken.endsWith('/')) this.aToken = this.aToken.slice(0, -1).trimEnd();
            }
            if (this.nNextCh === '/') {
              // "<br/>": the closing slash right after the name
              this.nNextCh = this.GetNextChar();
              while (HTML_ISSPACE(this.nNextCh)) this.nNextCh = this.GetNextChar();
              if (nRet >= HtmlTokenId.ONOFF_START && !isOffToken(nRet)) this.mnPendingOffToken = (nRet + 1) as HtmlTokenId;
            }
            if (!this.nNextCh && this.eof()) {
              // Move back in front of < and restart there. Return < as text.
              this.nPos = nStreamPos;
              this.aToken = '<';
              nRet = HtmlTokenId.TEXTTOKEN;
              this.nNextCh = this.GetNextChar();
              bNextCh = false;
              break;
            }
            // <?...>, <!DOCTYPE ...>: nothing to return but a doctype
            if (this.sSaveToken.startsWith('?')) nRet = HtmlTokenId.NONE;

            // Script requires reading till end token
            if (nRet === HtmlTokenId.SCRIPT_ON && !bOffState) {
              this.bReadScript = true;
              this.aEndToken = 'script';
            } else if (nRet === HtmlTokenId.STYLE_ON && !bOffState) {
              this.bReadStyle = true;
              this.aEndToken = 'style';
            } else if (nRet === HtmlTokenId.TEXTAREA_ON && !bOffState) this.bReadTextArea = true;
            else if (nRet === HtmlTokenId.TEXTAREA_OFF) this.bReadTextArea = false;
            if (this.bReadScript || this.bReadStyle || this.aEndToken) this.mnPendingOffToken = HtmlTokenId.NONE;
          } else {
            // Not a tag: '<' is text, and so is "</" not followed by a name.
            this.aToken = bOffState ? '</' : '<';
            nRet = HtmlTokenId.TEXTTOKEN;
            bNextCh = false;
            break;
          }
          break;
        }
        case '':
          return HtmlTokenId.NONE;
        default:
          if (this.nNextCh === '\n' && (this.bReadListing || this.bReadXMP || this.bReadPRE || this.bReadTextArea)) {
            nRet = HtmlTokenId.NEWPARA;
            break;
          }
          if (this.nNextCh === '\t' && this.bReadPRE) {
            nRet = HtmlTokenId.TABCHAR;
            break;
          }
          // also the whitespace (blank, CR/LF) belongs to text
          nRet = this.ScanText();
          bNextCh = false;
          break;
      }
      if (bNextCh && this.nNextCh) this.nNextCh = this.GetNextChar();
    } while (nRet === HtmlTokenId.NONE && this.nNextCh);

    return nRet;
  }

  /** HTMLParser::GetOptions: the options of the current tag. */
  GetOptions(): HTMLOptions {
    // If the options for the current token have already been returned, return them once again.
    if (this.maOptions) return this.maOptions;
    const opts: HTMLOptions = [];
    const s = this.aToken;
    let nPos = 0;
    while (nPos < s.length) {
      // A letter? Option beginning here.
      const c = s[nPos]!;
      if (!/[A-Za-z_:\-]/.test(c)) { nPos++; continue; }
      const nStt = nPos;
      while (nPos < s.length && !HTML_ISSPACE(s[nPos]!) && s[nPos] !== '=') nPos++;
      const sName = s.slice(nStt, nPos).toLowerCase();
      while (nPos < s.length && HTML_ISSPACE(s[nPos]!)) nPos++;
      let aValue = '';
      if (s[nPos] === '=') {
        nPos++;
        while (nPos < s.length && HTML_ISSPACE(s[nPos]!)) nPos++;
        const cEnd = s[nPos] === '"' || s[nPos] === '\'' ? s[nPos++] : '';
        let bDone = false;
        while (nPos < s.length && !bDone) {
          const ch = s[nPos]!;
          if (ch === '\\') {
            // the masked character (see ScanText): take it as it is
            if (nPos + 1 < s.length) aValue += s[++nPos];
            nPos++;
            continue;
          }
          if (cEnd ? ch === cEnd : HTML_ISSPACE(ch)) { bDone = true; nPos++; continue; }
          if (ch === '\n' && cEnd) { nPos++; continue; } // line feeds in quoted values are ignored
          aValue += ch;
          nPos++;
        }
      }
      opts.push(new HTMLOption(sName, aValue));
    }
    this.maOptions = opts;
    return opts;
  }
}

/** The tokens HTMLParser::FilterPRE passes on as they are (the others become unknown tokens). */
const PRE_KEEP = new Set<HtmlTokenId>([
  HtmlTokenId.ADDRESS_ON, HtmlTokenId.ADDRESS_OFF, HtmlTokenId.APPLET_ON, HtmlTokenId.APPLET_OFF,
  HtmlTokenId.BLOCKQUOTE_ON, HtmlTokenId.BLOCKQUOTE_OFF, HtmlTokenId.FORM_ON, HtmlTokenId.FORM_OFF,
  HtmlTokenId.HEAD1_ON, HtmlTokenId.HEAD1_OFF, HtmlTokenId.HEAD2_ON, HtmlTokenId.HEAD2_OFF,
  HtmlTokenId.HEAD3_ON, HtmlTokenId.HEAD3_OFF, HtmlTokenId.HEAD4_ON, HtmlTokenId.HEAD4_OFF,
  HtmlTokenId.HEAD5_ON, HtmlTokenId.HEAD5_OFF, HtmlTokenId.HEAD6_ON, HtmlTokenId.HEAD6_OFF,
  HtmlTokenId.SELECT_ON, HtmlTokenId.SELECT_OFF, HtmlTokenId.TEXTAREA_ON, HtmlTokenId.TEXTAREA_OFF,
  HtmlTokenId.ACRONYM_ON, HtmlTokenId.ACRONYM_OFF, HtmlTokenId.ANCHOR_ON, HtmlTokenId.ANCHOR_OFF,
  HtmlTokenId.AUTHOR_ON, HtmlTokenId.AUTHOR_OFF, HtmlTokenId.BASEFONT_ON, HtmlTokenId.BASEFONT_OFF,
  HtmlTokenId.BIGPRINT_ON, HtmlTokenId.BIGPRINT_OFF, HtmlTokenId.BLINK_ON, HtmlTokenId.BLINK_OFF,
  HtmlTokenId.BOLD_ON, HtmlTokenId.BOLD_OFF, HtmlTokenId.CAPTION_ON, HtmlTokenId.CAPTION_OFF,
  HtmlTokenId.CENTER_ON, HtmlTokenId.CENTER_OFF, HtmlTokenId.CITATION_ON, HtmlTokenId.CITATION_OFF,
  HtmlTokenId.CODE_ON, HtmlTokenId.CODE_OFF, HtmlTokenId.COL_ON, HtmlTokenId.COL_OFF, HtmlTokenId.COLGROUP_ON,
  HtmlTokenId.COLGROUP_OFF, HtmlTokenId.DEFINSTANCE_ON, HtmlTokenId.DEFINSTANCE_OFF, HtmlTokenId.DIVISION_ON,
  HtmlTokenId.DIVISION_OFF, HtmlTokenId.EMPHASIS_ON, HtmlTokenId.EMPHASIS_OFF, HtmlTokenId.FONT_ON,
  HtmlTokenId.FONT_OFF, HtmlTokenId.ITALIC_ON, HtmlTokenId.ITALIC_OFF, HtmlTokenId.KEYBOARD_ON,
  HtmlTokenId.KEYBOARD_OFF, HtmlTokenId.LANGUAGE_ON, HtmlTokenId.LANGUAGE_OFF, HtmlTokenId.PERSON_ON,
  HtmlTokenId.PERSON_OFF, HtmlTokenId.SAMPLE_ON, HtmlTokenId.SAMPLE_OFF, HtmlTokenId.SCRIPT_ON,
  HtmlTokenId.SCRIPT_OFF, HtmlTokenId.SHORTQUOTE_ON, HtmlTokenId.SHORTQUOTE_OFF, HtmlTokenId.SMALLPRINT_ON,
  HtmlTokenId.SMALLPRINT_OFF, HtmlTokenId.SPAN_ON, HtmlTokenId.SPAN_OFF, HtmlTokenId.STRIKE_ON,
  HtmlTokenId.STRIKE_OFF, HtmlTokenId.STRIKETHROUGH_ON, HtmlTokenId.STRIKETHROUGH_OFF, HtmlTokenId.STRONG_ON,
  HtmlTokenId.STRONG_OFF, HtmlTokenId.SUBSCRIPT_ON, HtmlTokenId.SUBSCRIPT_OFF, HtmlTokenId.SUPERSCRIPT_ON,
  HtmlTokenId.SUPERSCRIPT_OFF, HtmlTokenId.TABLE_ON, HtmlTokenId.TABLE_OFF, HtmlTokenId.TABLEDATA_ON,
  HtmlTokenId.TABLEDATA_OFF, HtmlTokenId.TABLEHEADER_ON, HtmlTokenId.TABLEHEADER_OFF, HtmlTokenId.TABLEROW_ON,
  HtmlTokenId.TABLEROW_OFF, HtmlTokenId.TBODY_ON, HtmlTokenId.TBODY_OFF, HtmlTokenId.TFOOT_ON,
  HtmlTokenId.TFOOT_OFF, HtmlTokenId.THEAD_ON, HtmlTokenId.THEAD_OFF, HtmlTokenId.UNDERLINE_ON,
  HtmlTokenId.UNDERLINE_OFF, HtmlTokenId.VARIABLE_ON, HtmlTokenId.VARIABLE_OFF, HtmlTokenId.BODY_ON,
  HtmlTokenId.EMBED, HtmlTokenId.IMAGE, HtmlTokenId.INPUT, HtmlTokenId.OPTION, HtmlTokenId.PARAM,
  HtmlTokenId.HORZRULE, HtmlTokenId.RAWDATA, HtmlTokenId.NONBREAKSPACE, HtmlTokenId.SOFTHYPH,
]);

/**
 * The character set of an HTML file: its byte order mark, else the charset of a <meta> element
 * in its first 1024 bytes (HTMLParser::ParseMetaOptions), else UTF-8 if the bytes are valid
 * UTF-8, else Windows-1252 (the default of the HTML filter).
 */
export function GetEncodingFromMeta(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  let head = '';
  for (let i = 0; i < Math.min(bytes.length, 1024); i++) head += String.fromCharCode(bytes[i]!);
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
  if (m) {
    const cs = m[1]!.toLowerCase();
    try { new TextDecoder(cs); return cs; } catch { /* unknown: detect below */ }
  }
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'utf-8'; } catch { return 'windows-1252'; }
}
