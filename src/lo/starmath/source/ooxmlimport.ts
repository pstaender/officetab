// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/ooxmlimport.hxx faithful
// @upstream starmath/source/ooxmlimport.cxx faithful
// The constructor takes the m:oMath element and builds the XmlStream from it (upstream is handed
// a stream that writerfilter collected); M_TOKEN( x ) is the canonical name "m:x".
import type { XmlElement } from '../../xmloff/source/core/xmlparse.ts';
import {
  XML_STREAM_CLOSING, XML_STREAM_OPENING, XmlStream, XmlStreamBuilder,
} from '../../oox/source/mathml/importutils.ts';
import { encloseOrEscapeLiteral } from './parse5.ts';
import {
  MS_ACUTE, MS_BAR, MS_BREVE, MS_CHECK, MS_CIRCLE, MS_COMBACUTE, MS_COMBBAR, MS_COMBBREVE,
  MS_COMBCHECK, MS_COMBCIRCLE, MS_COMBDDOT, MS_COMBDOT, MS_COMBGRAVE, MS_COMBHAT, MS_COMBOVERLINE,
  MS_COMBTILDE, MS_COPROD, MS_DDDOT, MS_DDOT, MS_DLINE, MS_DOT, MS_DVERTLINE, MS_GRAVE, MS_HARPOON,
  MS_HAT, MS_IIINT, MS_IINT, MS_INT, MS_LANGLE, MS_LINT, MS_LLINT, MS_LLLINT, MS_LMATHANGLE,
  MS_PROD, MS_RANGLE, MS_RIGHTARROW, MS_RMATHANGLE, MS_SUM, MS_TILDE, MS_VEC,
} from '../inc/types.ts';

/*
The primary internal data structure for the formula is the text representation
(the SmNode tree is built from it), so read data must be converted into this format.
*/

const OPENING = XML_STREAM_OPENING;
const CLOSING = XML_STREAM_CLOSING;
const M_TOKEN = (token: string): string => 'm:' + token;
const OOX_TOKEN = (ns: string, token: string): string => ns + ':' + token;
const OUStringChar = (c: number): string => String.fromCharCode(c);

// o3tl::trim
function implIsWhitespace(c: number): boolean {
  /* Space or Control character? */
  if ((c <= 32) && c)
    return true;
  /* Only in the General Punctuation area Space or Control characters are included? */
  if ((c < 0x2000) || (c > 0x2029))
    return false;
  if ((c <= 0x200B) || /* U+2000 - U+200B All Spaces */
    (c >= 0x2028)) /* U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR */
    return true;
  return false;
}
function trim(s: string): string {
  let first = 0;
  let last = s.length;
  while (first < last && implIsWhitespace(s.charCodeAt(first))) ++first;
  while (last > first && implIsWhitespace(s.charCodeAt(last - 1))) --last;
  return s.slice(first, last);
}

const replaceAll = (s: string, from: string, to: string): string => s.split(from).join(to);

// TODO create IS_OPENING(), IS_CLOSING() instead of doing 'next == OPENING( next )' ?

const LimLowUpp_t = { LimLow: 0, LimUpp: 1 } as const;
type LimLowUpp_t = (typeof LimLowUpp_t)[keyof typeof LimLowUpp_t];
const { LimLow, LimUpp } = LimLowUpp_t;

/**
 Class implementing reading of formulas from OOXML. The toplevel element is expected
 to be oMath (handle oMathPara outside of this code).
 */
export class SmOoxmlImport {
  private m_rStream: XmlStream;

  constructor(oMath: XmlElement) {
    const s = new XmlStreamBuilder();
    s.appendElement(oMath);
    this.m_rStream = s;
  }

  ConvertToStarMath(): string {
    return this.handleStream();
  }

  // "toplevel" of reading, there will be oMath (if there was oMathPara, that was
  // up to the parent component to handle)

  // NOT complete
  private handleStream(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('oMath'));
    let ret = '';
    while (!this.m_rStream.atEnd() && this.m_rStream.currentToken() !== CLOSING(M_TOKEN('oMath'))) {
      // strictly speaking, it is not OMathArg here, but currently supported
      // functionality is the same like OMathArg, in the future this may need improving
      const item = this.readOMathArg(M_TOKEN('oMath'));
      if (item.length === 0)
        continue;
      if (ret.length !== 0)
        ret += ' ';
      ret += item;
    }
    this.m_rStream.ensureClosingTag(M_TOKEN('oMath'));
    // Placeholders are written out as nothing (i.e. nothing inside e.g. the <e> element),
    // which will result in "{}" in the formula text. Fix this up.
    let ret2 = replaceAll(ret, '{}', '<?>');
    // And as a result, empty parts of the formula that are not placeholders are written out
    // as a single space, so fix that up too.
    ret2 = replaceAll(ret2, '{ }', '{}');
    // SAL_INFO( "starmath.ooxml", "Formula: " << ret2 );
    return ret2;
  }

  private readOMathArg(stoptoken: string): string {
    let ret = '';
    while (!this.m_rStream.atEnd() && this.m_rStream.currentToken() !== CLOSING(stoptoken)) {
      if (ret.length !== 0)
        ret += ' ';
      switch (this.m_rStream.currentToken()) {
        case OPENING(M_TOKEN('acc')):
          ret += this.handleAcc();
          break;
        case OPENING(M_TOKEN('bar')):
          ret += this.handleBar();
          break;
        case OPENING(M_TOKEN('box')):
          ret += this.handleBox();
          break;
        case OPENING(M_TOKEN('borderBox')):
          ret += this.handleBorderBox();
          break;
        case OPENING(M_TOKEN('d')):
          ret += this.handleD();
          break;
        case OPENING(M_TOKEN('eqArr')):
          ret += this.handleEqArr();
          break;
        case OPENING(M_TOKEN('f')):
          ret += this.handleF();
          break;
        case OPENING(M_TOKEN('func')):
          ret += this.handleFunc();
          break;
        case OPENING(M_TOKEN('limLow')):
          ret += this.handleLimLowUpp(LimLow);
          break;
        case OPENING(M_TOKEN('limUpp')):
          ret += this.handleLimLowUpp(LimUpp);
          break;
        case OPENING(M_TOKEN('groupChr')):
          ret += this.handleGroupChr();
          break;
        case OPENING(M_TOKEN('m')):
          ret += this.handleM();
          break;
        case OPENING(M_TOKEN('nary')):
          ret += this.handleNary();
          break;
        case OPENING(M_TOKEN('r')):
          ret += this.handleR();
          break;
        case OPENING(M_TOKEN('rad')):
          ret += this.handleRad();
          break;
        case OPENING(M_TOKEN('sPre')):
          ret += this.handleSpre();
          break;
        case OPENING(M_TOKEN('sSub')):
          ret += this.handleSsub();
          break;
        case OPENING(M_TOKEN('sSubSup')):
          ret += this.handleSsubsup();
          break;
        case OPENING(M_TOKEN('sSup')):
          ret += this.handleSsup();
          break;
        default:
          this.m_rStream.handleUnexpectedTag();
          break;
      }
    }
    return ret;
  }

  private readOMathArgInElement(token: string): string {
    this.m_rStream.ensureOpeningTag(token);
    const ret = this.readOMathArg(token);
    this.m_rStream.ensureClosingTag(token);
    return ret;
  }

  private handleAcc(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('acc'));
    let accChr = 0x302;
    const accPr = this.m_rStream.checkOpeningTag(M_TOKEN('accPr'));
    if (accPr.valid()) {
      const chr = this.m_rStream.checkOpeningTag(M_TOKEN('chr'));
      if (chr.valid()) {
        accChr = chr.attribute(M_TOKEN('val'), accChr);
        this.m_rStream.ensureClosingTag(M_TOKEN('chr'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('accPr'));
    }
    // see aTokenTable in parse.cxx
    let acc: string;
    switch (accChr) {
      case MS_BAR:
      case MS_COMBBAR:
        acc = 'bar';
        break;
      case MS_CHECK:
      case MS_COMBCHECK:
        acc = 'check';
        break;
      case MS_ACUTE:
      case MS_COMBACUTE:
        acc = 'acute';
        break;
      case MS_COMBOVERLINE:
        acc = 'overline';
        break;
      case MS_GRAVE:
      case MS_COMBGRAVE:
        acc = 'grave';
        break;
      case MS_BREVE:
      case MS_COMBBREVE:
        acc = 'breve';
        break;
      case MS_CIRCLE:
      case MS_COMBCIRCLE:
        acc = 'circle';
        break;
      case MS_RIGHTARROW:
      case MS_VEC:
        // prefer wide variants for these 3, .docx can't seem to differentiate
        // between e.g. 'vec' and 'widevec', if whatever the accent is above is short, this
        // shouldn't matter, but short above a longer expression doesn't look right
        acc = 'widevec';
        break;
      case MS_HARPOON:
        acc = 'wideharpoon';
        break;
      case MS_TILDE:
      case MS_COMBTILDE:
        acc = 'widetilde';
        break;
      case MS_HAT:
      case MS_COMBHAT:
        acc = 'widehat';
        break;
      case MS_DOT:
      case MS_COMBDOT:
        acc = 'dot';
        break;
      case MS_DDOT:
      case MS_COMBDDOT:
        acc = 'ddot';
        break;
      case MS_DDDOT:
        acc = 'dddot';
        break;
      default:
        acc = 'acute';
        // SAL_WARN( "starmath.ooxml", "Unknown m:chr in m:acc '" << OUString(accChr) << "'" );
        break;
    }
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    this.m_rStream.ensureClosingTag(M_TOKEN('acc'));
    return acc + ' {' + e + '}';
  }

  private handleBar(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('bar'));
    const top = 0, bot = 1;
    let topbot: number = bot;
    if (this.m_rStream.checkOpeningTag(M_TOKEN('barPr')).valid()) {
      const pos = this.m_rStream.checkOpeningTag(M_TOKEN('pos'));
      if (pos.valid()) {
        if (pos.attribute(M_TOKEN('val')) === 'top')
          topbot = top;
        else if (pos.attribute(M_TOKEN('val')) === 'bot')
          topbot = bot;
        this.m_rStream.ensureClosingTag(M_TOKEN('pos'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('barPr'));
    }
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    this.m_rStream.ensureClosingTag(M_TOKEN('bar'));
    if (topbot === top)
      return 'overline {' + e + '}';
    else
      return 'underline {' + e + '}';
  }

  private handleBox(): string {
    // there does not seem to be functionality in LO to actually implement this
    // (or is there), but at least read in the contents instead of ignoring them
    this.m_rStream.ensureOpeningTag(M_TOKEN('box'));
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    this.m_rStream.ensureClosingTag(M_TOKEN('box'));
    return e;
  }

  private handleBorderBox(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('borderBox'));
    let isStrikeH = false;
    if (this.m_rStream.checkOpeningTag(M_TOKEN('borderBoxPr')).valid()) {
      const strikeH = this.m_rStream.checkOpeningTag(M_TOKEN('strikeH'));
      if (strikeH.valid()) {
        if (strikeH.attribute(M_TOKEN('val'), false))
          isStrikeH = true;
        this.m_rStream.ensureClosingTag(M_TOKEN('strikeH'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('borderBoxPr'));
    }
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    this.m_rStream.ensureClosingTag(M_TOKEN('borderBox'));
    if (isStrikeH)
      return 'overstrike {' + e + '}';
    // LO does not seem to implement anything for handling the other cases
    return e;
  }

  private handleD(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('d'));
    let opening = '(';
    let closing = ')';
    let separator = '|';
    const dPr = this.m_rStream.checkOpeningTag(M_TOKEN('dPr'));
    if (dPr.valid()) {
      const begChr = this.m_rStream.checkOpeningTag(M_TOKEN('begChr'));
      if (begChr.valid()) {
        opening = begChr.attribute(M_TOKEN('val'), opening);
        this.m_rStream.ensureClosingTag(M_TOKEN('begChr'));
      }
      const sepChr = this.m_rStream.checkOpeningTag(M_TOKEN('sepChr'));
      if (sepChr.valid()) {
        separator = sepChr.attribute(M_TOKEN('val'), separator);
        this.m_rStream.ensureClosingTag(M_TOKEN('sepChr'));
      }
      const endChr = this.m_rStream.checkOpeningTag(M_TOKEN('endChr'));
      if (endChr.valid()) {
        closing = endChr.attribute(M_TOKEN('val'), closing);
        this.m_rStream.ensureClosingTag(M_TOKEN('endChr'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('dPr'));
    }
    if (opening === '{')
      opening = 'left lbrace ';
    if (closing === '}')
      closing = ' right rbrace';
    if (opening === '⟦')
      opening = 'left ldbracket ';
    if (closing === '⟧')
      closing = ' right rdbracket';
    if (opening === '|')
      opening = 'left lline ';
    if (closing === '|')
      closing = ' right rline';
    if (opening === OUStringChar(MS_DLINE)
      || opening === OUStringChar(MS_DVERTLINE))
      opening = 'left ldline ';
    if (closing === OUStringChar(MS_DLINE)
      || closing === OUStringChar(MS_DVERTLINE))
      closing = ' right rdline';
    if (opening === OUStringChar(MS_LANGLE)
      || opening === OUStringChar(MS_LMATHANGLE))
      opening = 'left langle ';
    if (closing === OUStringChar(MS_RANGLE)
      || closing === OUStringChar(MS_RMATHANGLE))
      closing = ' right rangle';
    // use scalable brackets (the explicit "left" or "right")
    if (opening === '(' || opening === '[' || opening === ')' || opening === ']')
      opening = 'left ' + opening;
    if (closing === ')' || closing === ']' || closing === '(' || closing === '[')
      closing = ' right ' + closing;
    if (separator === '|') // plain "|" would be actually "V" (logical or)
      separator = ' mline ';
    if (opening.length === 0)
      opening = 'left none ';
    if (closing.length === 0)
      closing = ' right none';
    let ret = opening;
    let first = true;
    while (this.m_rStream.findTag(OPENING(M_TOKEN('e')))) {
      if (!first)
        ret += separator;
      first = false;
      ret += this.readOMathArgInElement(M_TOKEN('e'));
    }
    ret += closing;
    this.m_rStream.ensureClosingTag(M_TOKEN('d'));
    return ret;
  }

  private handleEqArr(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('eqArr'));
    let ret = '';
    do { // there must be at least one m:e
      if (ret.length !== 0)
        ret += '#';
      ret += ' '
        + this.readOMathArgInElement(M_TOKEN('e'))
        + ' ';
    } while (!this.m_rStream.atEnd() && this.m_rStream.findTag(OPENING(M_TOKEN('e'))));
    this.m_rStream.ensureClosingTag(M_TOKEN('eqArr'));
    return 'stack {' + ret + '}';
  }

  private handleF(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('f'));
    const bar = 0, lin = 1, noBar = 2;
    let operation: number = bar;
    if (this.m_rStream.checkOpeningTag(M_TOKEN('fPr')).valid()) {
      const type = this.m_rStream.checkOpeningTag(M_TOKEN('type'));
      if (type.valid()) {
        if (type.attribute(M_TOKEN('val')) === 'bar')
          operation = bar;
        else if (type.attribute(M_TOKEN('val')) === 'lin')
          operation = lin;
        else if (type.attribute(M_TOKEN('val')) === 'noBar')
          operation = noBar;
        this.m_rStream.ensureClosingTag(M_TOKEN('type'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('fPr'));
    }
    const num = this.readOMathArgInElement(M_TOKEN('num'));
    const den = this.readOMathArgInElement(M_TOKEN('den'));
    this.m_rStream.ensureClosingTag(M_TOKEN('f'));
    if (operation === bar)
      return '{' + num + '} over {' + den + '}';
    else if (operation === lin)
      return '{' + num + '} / {' + den + '}';
    else { // noBar
      return 'binom {' + num + '} {' + den + '}';
    }
  }

  private handleFunc(): string {
    //lim from{x rightarrow 1} x
    this.m_rStream.ensureOpeningTag(M_TOKEN('func'));
    let fname = this.readOMathArgInElement(M_TOKEN('fName'));
    // fix the various functions
    if (fname.startsWith('lim csub {'))
      fname = 'lim from {' + fname.substring(10);
    const ret = fname + ' {' + this.readOMathArgInElement(M_TOKEN('e')) + '}';
    this.m_rStream.ensureClosingTag(M_TOKEN('func'));
    return ret;
  }

  private handleLimLowUpp(limlowupp: LimLowUpp_t): string {
    const token = limlowupp === LimLow ? M_TOKEN('limLow') : M_TOKEN('limUpp');
    this.m_rStream.ensureOpeningTag(token);
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    const lim = this.readOMathArgInElement(M_TOKEN('lim'));
    this.m_rStream.ensureClosingTag(token);
    // fix up overbrace/underbrace  (use { }, as {} will be converted to a placeholder)
    if (limlowupp === LimUpp && e.endsWith(' overbrace { }'))
      return e.substring(0, e.length - 2) + lim + '}';
    if (limlowupp === LimLow && e.endsWith(' underbrace { }'))
      return e.substring(0, e.length - 2) + lim + '}';
    return e
      + (limlowupp === LimLow
        ? ' csub {' : ' csup {')
      + lim + '}';
  }

  private handleGroupChr(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('groupChr'));
    let chr = 0x23df;
    const top = 0, bot = 1;
    let pos: number = bot;
    if (this.m_rStream.checkOpeningTag(M_TOKEN('groupChrPr')).valid()) {
      const chrTag = this.m_rStream.checkOpeningTag(M_TOKEN('chr'));
      if (chrTag.valid()) {
        chr = chrTag.attribute(M_TOKEN('val'), chr);
        this.m_rStream.ensureClosingTag(M_TOKEN('chr'));
      }
      const posTag = this.m_rStream.checkOpeningTag(M_TOKEN('pos'));
      if (posTag.valid()) {
        if (posTag.attribute(M_TOKEN('val'), 'bot') === 'top')
          pos = top;
        this.m_rStream.ensureClosingTag(M_TOKEN('pos'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('groupChrPr'));
    }
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    this.m_rStream.ensureClosingTag(M_TOKEN('groupChr'));
    if (pos === top && chr === 0x23de)
      return '{' + e + '} overbrace { }';
    if (pos === bot && chr === 0x23df)
      return '{' + e + '} underbrace { }';
    if (pos === top)
      return '{' + e + '} csup {' + OUStringChar(chr) + '}';
    else
      return '{' + e + '} csub {' + OUStringChar(chr) + '}';
  }

  private handleM(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('m'));
    let allrows = '';
    do { // there must be at least one m:mr
      this.m_rStream.ensureOpeningTag(M_TOKEN('mr'));
      let row = '';
      do { // there must be at least one m:e
        if (row.length !== 0)
          row += ' # ';
        row += this.readOMathArgInElement(M_TOKEN('e'));
      } while (!this.m_rStream.atEnd() && this.m_rStream.findTag(OPENING(M_TOKEN('e'))));
      if (allrows.length !== 0)
        allrows += ' ## ';
      allrows += row;
      this.m_rStream.ensureClosingTag(M_TOKEN('mr'));
    } while (!this.m_rStream.atEnd() && this.m_rStream.findTag(OPENING(M_TOKEN('mr'))));
    this.m_rStream.ensureClosingTag(M_TOKEN('m'));
    return 'matrix {' + allrows + '}';
  }

  private handleNary(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('nary'));
    let chr = 0x222b;
    let subHide = false;
    let supHide = false;
    if (this.m_rStream.checkOpeningTag(M_TOKEN('naryPr')).valid()) {
      const chrTag = this.m_rStream.checkOpeningTag(M_TOKEN('chr'));
      if (chrTag.valid()) {
        chr = chrTag.attribute(M_TOKEN('val'), chr);
        this.m_rStream.ensureClosingTag(M_TOKEN('chr'));
      }
      const subHideTag = this.m_rStream.checkOpeningTag(M_TOKEN('subHide'));
      if (subHideTag.valid()) {
        subHide = subHideTag.attribute(M_TOKEN('val'), subHide);
        this.m_rStream.ensureClosingTag(M_TOKEN('subHide'));
      }
      const supHideTag = this.m_rStream.checkOpeningTag(M_TOKEN('supHide'));
      if (supHideTag.valid()) {
        supHide = supHideTag.attribute(M_TOKEN('val'), supHide);
        this.m_rStream.ensureClosingTag(M_TOKEN('supHide'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('naryPr'));
    }
    const sub = this.readOMathArgInElement(M_TOKEN('sub'));
    const sup = this.readOMathArgInElement(M_TOKEN('sup'));
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    let ret = '';
    switch (chr) {
      case MS_INT:
        ret = 'int';
        break;
      case MS_IINT:
        ret = 'iint';
        break;
      case MS_IIINT:
        ret = 'iiint';
        break;
      case MS_LINT:
        ret = 'lint';
        break;
      case MS_LLINT:
        ret = 'llint';
        break;
      case MS_LLLINT:
        ret = 'lllint';
        break;
      case MS_PROD:
        ret = 'prod';
        break;
      case MS_COPROD:
        ret = 'coprod';
        break;
      case MS_SUM:
        ret = 'sum';
        break;
      default:
        // SAL_WARN( "starmath.ooxml", "Unknown m:nary chr '" << OUString(chr) << "'" );
        break;
    }
    if (!subHide)
      ret += ' from {' + sub + '}';
    if (!supHide)
      ret += ' to {' + sup + '}';
    ret += ' {' + e + '}';
    this.m_rStream.ensureClosingTag(M_TOKEN('nary'));
    return ret;
  }

  // NOT complete
  private handleR(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('r'));
    let normal = false;
    let literal = false;
    let scrString = '';
    const rPr = this.m_rStream.checkOpeningTag(M_TOKEN('rPr'));
    if (rPr.valid()) {
      const litTag = this.m_rStream.checkOpeningTag(M_TOKEN('lit'));
      if (litTag.valid()) {
        literal = litTag.attribute(M_TOKEN('val'), true);
        this.m_rStream.ensureClosingTag(M_TOKEN('lit'));
      }
      const norTag = this.m_rStream.checkOpeningTag(M_TOKEN('nor'));
      if (norTag.valid()) {
        normal = norTag.attribute(M_TOKEN('val'), true);
        this.m_rStream.ensureClosingTag(M_TOKEN('nor'));
      }
      const srcTag = this.m_rStream.checkOpeningTag(M_TOKEN('scr'));
      if (srcTag.valid()) {
        scrString = srcTag.attribute(M_TOKEN('val'), scrString);
        this.m_rStream.ensureClosingTag(M_TOKEN('scr'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('rPr'));
    }
    let text = '';
    let isTagT = false;
    while (!this.m_rStream.atEnd() && this.m_rStream.currentToken() !== CLOSING(this.m_rStream.currentToken())) {
      switch (this.m_rStream.currentToken()) {
        case OPENING(M_TOKEN('t')): {
          isTagT = true;
          const rtag = this.m_rStream.ensureOpeningTag(M_TOKEN('t'));
          let sTagText = rtag.text;
          if (scrString === 'double-struck') {
            sTagText = SmOoxmlImport.handleSetString(sTagText);
          }
          if (rtag.attribute(OOX_TOKEN('xml', 'space')) !== 'preserve')
            sTagText = trim(sTagText);
          text += sTagText;
          this.m_rStream.ensureClosingTag(M_TOKEN('t'));
          break;
        }
        default:
          this.m_rStream.handleUnexpectedTag();
          break;
      }
    }
    this.m_rStream.ensureClosingTag(M_TOKEN('r'));
    if (scrString.length === 0 && (normal || literal || isTagT)) {
      return encloseOrEscapeLiteral(text, normal || literal);
    }
    return text;
  }

  private static handleSetString(setOUstring: string): string {
    const setList = new Set(['C', 'N', 'Q', 'R', 'Z', 'c', 'n', 'q', 'r', 'z']);
    let result = '';
    for (let i = 0; i < setOUstring.length; i++) {
      if (setList.has(setOUstring[i]!)) {
        result += ' set' + setOUstring[i] + ' ';
      } else
        result += encloseOrEscapeLiteral(setOUstring.substring(i, i + 1), /*bForce=*/false);
    }
    return result;
  }

  private handleRad(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('rad'));
    let degHide = false;
    if (this.m_rStream.checkOpeningTag(M_TOKEN('radPr')).valid()) {
      const degHideTag = this.m_rStream.checkOpeningTag(M_TOKEN('degHide'));
      if (degHideTag.valid()) {
        degHide = degHideTag.attribute(M_TOKEN('val'), degHide);
        this.m_rStream.ensureClosingTag(M_TOKEN('degHide'));
      }
      this.m_rStream.ensureClosingTag(M_TOKEN('radPr'));
    }
    const deg = this.readOMathArgInElement(M_TOKEN('deg'));
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    this.m_rStream.ensureClosingTag(M_TOKEN('rad'));
    if (degHide)
      return 'sqrt {' + e + '}';
    else
      return 'nroot {' + deg + '} {' + e + '}';
  }

  private handleSpre(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('sPre'));
    const sub = this.readOMathArgInElement(M_TOKEN('sub'));
    const sup = this.readOMathArgInElement(M_TOKEN('sup'));
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    this.m_rStream.ensureClosingTag(M_TOKEN('sPre'));
    return '{' + e + '} lsub {' + sub + '} lsup {' + sup + '}';
  }

  private handleSsub(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('sSub'));
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    const sub = this.readOMathArgInElement(M_TOKEN('sub'));
    this.m_rStream.ensureClosingTag(M_TOKEN('sSub'));
    return '{' + e + '} rsub {' + sub + '}';
  }

  private handleSsubsup(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('sSubSup'));
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    const sub = this.readOMathArgInElement(M_TOKEN('sub'));
    const sup = this.readOMathArgInElement(M_TOKEN('sup'));
    this.m_rStream.ensureClosingTag(M_TOKEN('sSubSup'));
    return '{' + e + '} rsub {' + sub + '} rsup {' + sup + '}';
  }

  private handleSsup(): string {
    this.m_rStream.ensureOpeningTag(M_TOKEN('sSup'));
    const e = this.readOMathArgInElement(M_TOKEN('e'));
    const sup = this.readOMathArgInElement(M_TOKEN('sup'));
    this.m_rStream.ensureClosingTag(M_TOKEN('sSup'));
    return '{' + e + '} ^ {' + sup + '}';
  }
}
