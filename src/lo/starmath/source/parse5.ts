// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/parse5.cxx reduced
// @upstream starmath/inc/parse5.hxx reduced
// SmParser5: the formula language into a node tree. The grammar is faithful. The tokenizer is
// reduced: upstream classifies characters with the i18n CharClass (parseAnyToken); here numbers
// (ASCII digits and dots, a comma group separator), identifiers (Unicode letters), double quoted
// strings and the one-character operators are recognised by hand with the same results for the
// formula language. Not ported: colour names (only "color" with rgb, rgba and hex values and the
// basic HTML names), the symbol manager's export and import names of %symbols, and the error
// descriptions (errors are kept as error nodes with an empty description).
import { T, TG, SmToken, type SmTokenTableEntry, type SmTokenType } from '../inc/token.ts';
import {
  MS_ACUTE, MS_ALEPH, MS_AND, MS_APPROX, MS_ASSIGN, MS_BACKEPSILON, MS_BACKSLASH, MS_BAR, MS_BREVE, MS_CDOT,
  MS_CHECK, MS_CIRC, MS_CIRCLE, MS_COPROD, MS_DDDOT, MS_DDOT, MS_DEF, MS_DIV, MS_DLARROW, MS_DLINE,
  MS_DLRARROW, MS_DOT, MS_DOTSAXIS, MS_DOTSDOWN, MS_DOTSLOW, MS_DOTSUP, MS_DOTSVERT, MS_DOWNARROW, MS_DRARROW, MS_DVERTLINE,
  MS_EMPTYSET, MS_EQUIV, MS_EXISTS, MS_FACT, MS_FORALL, MS_FOURIER, MS_GE, MS_GESLANT, MS_GG, MS_GRAVE,
  MS_GT, MS_HADD, MS_HARPOON, MS_HAT, MS_HBAR, MS_IIINT, MS_IINT, MS_IM, MS_IN, MS_INFINITY,
  MS_INT, MS_INTERSECT, MS_LAMBDABAR, MS_LAPLACE, MS_LBRACE, MS_LBRACKET, MS_LCEIL, MS_LDBRACKET, MS_LE, MS_LEFTARROW,
  MS_LESLANT, MS_LFLOOR, MS_LINE, MS_LINT, MS_LL, MS_LLINT, MS_LLLINT, MS_LMATHANGLE, MS_LPARENT, MS_LT,
  MS_MAJ, MS_MINUS, MS_MINUSPLUS, MS_MULTIPLY, MS_NABLA, MS_NDIVIDES, MS_NEG, MS_NEQ, MS_NI, MS_NOTEXISTS,
  MS_NOTIN, MS_NOTPRECEDES, MS_NOTSUCCEEDS, MS_NSUBSET, MS_NSUBSETEQ, MS_NSUPSET, MS_NSUPSETEQ, MS_ODIVIDE, MS_ODOT, MS_OMINUS,
  MS_OPLUS, MS_OR, MS_ORTHO, MS_OTIMES, MS_OVERBRACE, MS_PARTIAL, MS_PLACE, MS_PLUS, MS_PLUSMINUS, MS_PRECEDES,
  MS_PRECEDESEQUAL, MS_PRECEDESEQUIV, MS_PROD, MS_PROP, MS_RBRACE, MS_RBRACKET, MS_RCEIL, MS_RDBRACKET, MS_RE, MS_RFLOOR,
  MS_RIGHTARROW, MS_RMATHANGLE, MS_RPARENT, MS_SETC, MS_SETN, MS_SETQ, MS_SETR, MS_SETZ, MS_SIM, MS_SIMEQ,
  MS_SLASH, MS_SQRT, MS_SUBSET, MS_SUBSETEQ, MS_SUCCEEDS, MS_SUCCEEDSEQUAL, MS_SUCCEEDSEQUIV, MS_SUM, MS_SUPSET, MS_SUPSETEQ,
  MS_TILDE, MS_TIMES, MS_TRANSL, MS_TRANSR, MS_UNDERBRACE, MS_UNION, MS_UPARROW, MS_VEC, MS_VERTLINE, MS_WP,
} from '../inc/types.ts';
import {
  SmAlignNode, SmAttributeNode, SmBinDiagonalNode, SmBinHorNode, SmBinVerNode, SmBlankNode, SmBraceNode,
  SmBracebodyNode, SmErrorNode, SmExpressionNode, SmFontNode, SmGlyphSpecialNode, SmLineNode, SmMathIdentifierNode,
  SmMathSymbolNode, SmMatrixNode, SmOperNode, SmPlaceNode, SmPolyLineNode, SmRectangleNode, SmRootNode,
  SmRootSymbolNode, SmSpecialNode, SmSubSupNode, SmTableNode, SmTextNode, SmUnHorNode, SmVerticalBraceNode,
  SmScaleMode, FontSizeType, SmSubSup, SUBSUP_NUM_ENTRIES, type SmNode, type SmStructureNode,
} from './node.ts';
import { FNT_FUNCTION, FNT_NUMBER, FNT_TEXT, FNT_VARIABLE } from './format.ts';

const DEPTH_LIMIT = 1024;

//Definition of math keywords
const aTokenTable: SmTokenTableEntry[] = ([
  ['abs', T.TABS, 0, TG.UnOper, 13],
  ['acute', T.TACUTE, MS_ACUTE, TG.Attribute, 5],
  ['aleph', T.TALEPH, MS_ALEPH, TG.Standalone, 5],
  ['alignb', T.TALIGNC, 0, TG.Align, 0],
  ['alignc', T.TALIGNC, 0, TG.Align, 0],
  ['alignl', T.TALIGNL, 0, TG.Align, 0],
  ['alignm', T.TALIGNC, 0, TG.Align, 0],
  ['alignr', T.TALIGNR, 0, TG.Align, 0],
  ['alignt', T.TALIGNC, 0, TG.Align, 0],
  ['and', T.TAND, MS_AND, TG.Product, 0],
  ['approx', T.TAPPROX, MS_APPROX, TG.Relation, 0],
  ['arccos', T.TACOS, 0, TG.Function, 5],
  ['arccot', T.TACOT, 0, TG.Function, 5],
  ['arcosh', T.TACOSH, 0, TG.Function, 5],
  ['arcoth', T.TACOTH, 0, TG.Function, 5],
  ['arcsin', T.TASIN, 0, TG.Function, 5],
  ['arctan', T.TATAN, 0, TG.Function, 5],
  ['arsinh', T.TASINH, 0, TG.Function, 5],
  ['artanh', T.TATANH, 0, TG.Function, 5],
  ['backepsilon', T.TBACKEPSILON, MS_BACKEPSILON, TG.Standalone, 5],
  ['bar', T.TBAR, MS_BAR, TG.Attribute, 5],
  ['binom', T.TBINOM, 0, TG.NONE, 5],
  ['bold', T.TBOLD, 0, TG.FontAttr, 5],
  ['boper', T.TBOPER, 0, TG.Product, 0],
  ['breve', T.TBREVE, MS_BREVE, TG.Attribute, 5],
  ['bslash', T.TBACKSLASH, MS_BACKSLASH, TG.Product, 0],
  ['cdot', T.TCDOT, MS_CDOT, TG.Product, 0],
  ['check', T.TCHECK, MS_CHECK, TG.Attribute, 5],
  ['circ', T.TCIRC, MS_CIRC, TG.Standalone, 5],
  ['circle', T.TCIRCLE, MS_CIRCLE, TG.Attribute, 5],
  ['color', T.TCOLOR, 0, TG.FontAttr, 5],
  ['coprod', T.TCOPROD, MS_COPROD, TG.Oper, 5],
  ['cos', T.TCOS, 0, TG.Function, 5],
  ['cosh', T.TCOSH, 0, TG.Function, 5],
  ['cot', T.TCOT, 0, TG.Function, 5],
  ['coth', T.TCOTH, 0, TG.Function, 5],
  ['csub', T.TCSUB, 0, TG.Power, 0],
  ['csup', T.TCSUP, 0, TG.Power, 0],
  ['dddot', T.TDDDOT, MS_DDDOT, TG.Attribute, 5],
  ['ddot', T.TDDOT, MS_DDOT, TG.Attribute, 5],
  ['def', T.TDEF, MS_DEF, TG.Relation, 0],
  ['div', T.TDIV, MS_DIV, TG.Product, 0],
  ['divides', T.TDIVIDES, MS_LINE, TG.Relation, 0],
  ['dlarrow', T.TDLARROW, MS_DLARROW, TG.Standalone, 5],
  ['dlrarrow', T.TDLRARROW, MS_DLRARROW, TG.Standalone, 5],
  ['dot', T.TDOT, MS_DOT, TG.Attribute, 5],
  ['dotsaxis', T.TDOTSAXIS, MS_DOTSAXIS, TG.Standalone, 5],
  ['dotsdiag', T.TDOTSDIAG, MS_DOTSUP, TG.Standalone, 5],
  ['dotsdown', T.TDOTSDOWN, MS_DOTSDOWN, TG.Standalone, 5],
  ['dotslow', T.TDOTSLOW, MS_DOTSLOW, TG.Standalone, 5],
  ['dotsup', T.TDOTSUP, MS_DOTSUP, TG.Standalone, 5],
  ['dotsvert', T.TDOTSVERT, MS_DOTSVERT, TG.Standalone, 5],
  ['downarrow', T.TDOWNARROW, MS_DOWNARROW, TG.Standalone, 5],
  ['drarrow', T.TDRARROW, MS_DRARROW, TG.Standalone, 5],
  ['emptyset', T.TEMPTYSET, MS_EMPTYSET, TG.Standalone, 5],
  ['equiv', T.TEQUIV, MS_EQUIV, TG.Relation, 0],
  ['evaluate', T.TEVALUATE, 0, TG.NONE, 0],
  ['exists', T.TEXISTS, MS_EXISTS, TG.Standalone, 5],
  ['exp', T.TEXP, 0, TG.Function, 5],
  ['fact', T.TFACT, MS_FACT, TG.UnOper, 5],
  ['fixed', T.TFIXED, 0, TG.Font, 0],
  ['font', T.TFONT, 0, TG.FontAttr, 5],
  ['forall', T.TFORALL, MS_FORALL, TG.Standalone, 5],
  ['fourier', T.TFOURIER, MS_FOURIER, TG.Standalone, 5],
  ['frac', T.TFRAC, 0, TG.NONE, 5],
  ['from', T.TFROM, 0, TG.Limit, 0],
  ['func', T.TFUNC, 0, TG.Function, 5],
  ['ge', T.TGE, MS_GE, TG.Relation, 0],
  ['geslant', T.TGESLANT, MS_GESLANT, TG.Relation, 0],
  ['gg', T.TGG, MS_GG, TG.Relation, 0],
  ['grave', T.TGRAVE, MS_GRAVE, TG.Attribute, 5],
  ['gt', T.TGT, MS_GT, TG.Relation, 0],
  ['hadd', T.THADD, MS_HADD, TG.Oper, 5],
  ['harpoon', T.THARPOON, MS_HARPOON, TG.Attribute, 5],
  ['hat', T.THAT, MS_HAT, TG.Attribute, 5],
  ['hbar', T.THBAR, MS_HBAR, TG.Standalone, 5],
  ['hex', T.THEX, 0, TG.NONE, 5],
  ['iiint', T.TIIINT, MS_IIINT, TG.Oper, 5],
  ['iint', T.TIINT, MS_IINT, TG.Oper, 5],
  ['im', T.TIM, MS_IM, TG.Standalone, 5],
  ['in', T.TIN, MS_IN, TG.Relation, 0],
  ['infinity', T.TINFINITY, MS_INFINITY, TG.Standalone, 5],
  ['infty', T.TINFINITY, MS_INFINITY, TG.Standalone, 5],
  ['int', T.TINT, MS_INT, TG.Oper, 5],
  ['intd', T.TINTD, MS_INT, TG.Oper, 5],
  ['intersection', T.TINTERSECT, MS_INTERSECT, TG.Product, 0],
  ['it', T.TIT, 0, TG.Product, 0],
  ['ital', T.TITALIC, 0, TG.FontAttr, 5],
  ['italic', T.TITALIC, 0, TG.FontAttr, 5],
  ['lambdabar', T.TLAMBDABAR, MS_LAMBDABAR, TG.Standalone, 5],
  ['langle', T.TLANGLE, MS_LMATHANGLE, TG.LBrace, 5],
  ['laplace', T.TLAPLACE, MS_LAPLACE, TG.Standalone, 5],
  ['lbrace', T.TLBRACE, MS_LBRACE, TG.LBrace, 5],
  ['lceil', T.TLCEIL, MS_LCEIL, TG.LBrace, 5],
  ['ldbracket', T.TLDBRACKET, MS_LDBRACKET, TG.LBrace, 5],
  ['ldline', T.TLDLINE, MS_DVERTLINE, TG.LBrace, 5],
  ['le', T.TLE, MS_LE, TG.Relation, 0],
  ['left', T.TLEFT, 0, TG.NONE, 5],
  ['leftarrow', T.TLEFTARROW, MS_LEFTARROW, TG.Standalone, 5],
  ['leslant', T.TLESLANT, MS_LESLANT, TG.Relation, 0],
  ['lfloor', T.TLFLOOR, MS_LFLOOR, TG.LBrace, 5],
  ['lim', T.TLIM, 0, TG.Oper, 5],
  ['liminf', T.TLIMINF, 0, TG.Oper, 5],
  ['limsup', T.TLIMSUP, 0, TG.Oper, 5],
  ['lint', T.TLINT, MS_LINT, TG.Oper, 5],
  ['ll', T.TLL, MS_LL, TG.Relation, 0],
  ['lline', T.TLLINE, MS_VERTLINE, TG.LBrace, 5],
  ['llint', T.TLLINT, MS_LLINT, TG.Oper, 5],
  ['lllint', T.TLLLINT, MS_LLLINT, TG.Oper, 5],
  ['ln', T.TLN, 0, TG.Function, 5],
  ['log', T.TLOG, 0, TG.Function, 5],
  ['lrline', T.TLRLINE, MS_VERTLINE, TG.LBrace | TG.RBrace, 5],
  ['lrdline', T.TLRDLINE, MS_VERTLINE, TG.LBrace | TG.RBrace, 5],
  ['lsub', T.TLSUB, 0, TG.Power, 0],
  ['lsup', T.TLSUP, 0, TG.Power, 0],
  ['lt', T.TLT, MS_LT, TG.Relation, 0],
  ['maj', T.TSUM, MS_MAJ, TG.Oper, 5],
  ['matrix', T.TMATRIX, 0, TG.NONE, 5],
  ['minusplus', T.TMINUSPLUS, MS_MINUSPLUS, TG.UnOper | TG.Sum, 5],
  ['mline', T.TMLINE, MS_VERTLINE, TG.NONE, 0],
  ['nabla', T.TNABLA, MS_NABLA, TG.Standalone, 5],
  ['nbold', T.TNBOLD, 0, TG.FontAttr, 5],
  ['ndivides', T.TNDIVIDES, MS_NDIVIDES, TG.Relation, 0],
  ['neg', T.TNEG, MS_NEG, TG.UnOper, 5],
  ['neq', T.TNEQ, MS_NEQ, TG.Relation, 0],
  ['newline', T.TNEWLINE, 0, TG.NONE, 0],
  ['ni', T.TNI, MS_NI, TG.Relation, 0],
  ['nitalic', T.TNITALIC, 0, TG.FontAttr, 5],
  ['none', T.TNONE, 0, TG.LBrace | TG.RBrace, 0],
  ['nospace', T.TNOSPACE, 0, TG.Standalone, 5],
  ['notexists', T.TNOTEXISTS, MS_NOTEXISTS, TG.Standalone, 5],
  ['notin', T.TNOTIN, MS_NOTIN, TG.Relation, 0],
  ['nprec', T.TNOTPRECEDES, MS_NOTPRECEDES, TG.Relation, 0],
  ['nroot', T.TNROOT, MS_SQRT, TG.UnOper, 5],
  ['nsubset', T.TNSUBSET, MS_NSUBSET, TG.Relation, 0],
  ['nsubseteq', T.TNSUBSETEQ, MS_NSUBSETEQ, TG.Relation, 0],
  ['nsucc', T.TNOTSUCCEEDS, MS_NOTSUCCEEDS, TG.Relation, 0],
  ['nsupset', T.TNSUPSET, MS_NSUPSET, TG.Relation, 0],
  ['nsupseteq', T.TNSUPSETEQ, MS_NSUPSETEQ, TG.Relation, 0],
  ['odivide', T.TODIVIDE, MS_ODIVIDE, TG.Product, 0],
  ['odot', T.TODOT, MS_ODOT, TG.Product, 0],
  ['ominus', T.TOMINUS, MS_OMINUS, TG.Sum, 0],
  ['oper', T.TOPER, 0, TG.Oper, 5],
  ['oplus', T.TOPLUS, MS_OPLUS, TG.Sum, 0],
  ['or', T.TOR, MS_OR, TG.Sum, 0],
  ['ortho', T.TORTHO, MS_ORTHO, TG.Relation, 0],
  ['otimes', T.TOTIMES, MS_OTIMES, TG.Product, 0],
  ['over', T.TOVER, 0, TG.Product, 0],
  ['overbrace', T.TOVERBRACE, MS_OVERBRACE, TG.Product, 5],
  ['overline', T.TOVERLINE, 0, TG.Attribute, 5],
  ['overstrike', T.TOVERSTRIKE, 0, TG.Attribute, 5],
  ['owns', T.TNI, MS_NI, TG.Relation, 0],
  ['parallel', T.TPARALLEL, MS_DLINE, TG.Relation, 0],
  ['partial', T.TPARTIAL, MS_PARTIAL, TG.Standalone, 5],
  ['phantom', T.TPHANTOM, 0, TG.FontAttr, 5],
  ['plusminus', T.TPLUSMINUS, MS_PLUSMINUS, TG.UnOper | TG.Sum, 5],
  ['prec', T.TPRECEDES, MS_PRECEDES, TG.Relation, 0],
  ['preccurlyeq', T.TPRECEDESEQUAL, MS_PRECEDESEQUAL, TG.Relation, 0],
  ['precsim', T.TPRECEDESEQUIV, MS_PRECEDESEQUIV, TG.Relation, 0],
  ['prod', T.TPROD, MS_PROD, TG.Oper, 5],
  ['prop', T.TPROP, MS_PROP, TG.Relation, 0],
  ['rangle', T.TRANGLE, MS_RMATHANGLE, TG.RBrace, 0],
  ['rbrace', T.TRBRACE, MS_RBRACE, TG.RBrace, 0],
  ['rceil', T.TRCEIL, MS_RCEIL, TG.RBrace, 0],
  ['rdbracket', T.TRDBRACKET, MS_RDBRACKET, TG.RBrace, 0],
  ['rdline', T.TRDLINE, MS_DVERTLINE, TG.RBrace, 0],
  ['re', T.TRE, MS_RE, TG.Standalone, 5],
  ['rfloor', T.TRFLOOR, MS_RFLOOR, TG.RBrace, 0],
  ['right', T.TRIGHT, 0, TG.NONE, 0],
  ['rightarrow', T.TRIGHTARROW, MS_RIGHTARROW, TG.Standalone, 5],
  ['rline', T.TRLINE, MS_VERTLINE, TG.RBrace, 0],
  ['rsub', T.TRSUB, 0, TG.Power, 0],
  ['rsup', T.TRSUP, 0, TG.Power, 0],
  ['sans', T.TSANS, 0, TG.Font, 0],
  ['serif', T.TSERIF, 0, TG.Font, 0],
  ['setC', T.TSETC, MS_SETC, TG.Standalone, 5],
  ['setminus', T.TSETMINUS, MS_BACKSLASH, TG.Product, 0],
  ['setN', T.TSETN, MS_SETN, TG.Standalone, 5],
  ['setQ', T.TSETQ, MS_SETQ, TG.Standalone, 5],
  ['setquotient', T.TSETQUOTIENT, MS_SLASH, TG.Product, 0],
  ['setR', T.TSETR, MS_SETR, TG.Standalone, 5],
  ['setZ', T.TSETZ, MS_SETZ, TG.Standalone, 5],
  ['sim', T.TSIM, MS_SIM, TG.Relation, 0],
  ['simeq', T.TSIMEQ, MS_SIMEQ, TG.Relation, 0],
  ['sin', T.TSIN, 0, TG.Function, 5],
  ['sinh', T.TSINH, 0, TG.Function, 5],
  ['size', T.TSIZE, 0, TG.FontAttr, 5],
  ['slash', T.TSLASH, MS_SLASH, TG.Product, 0],
  ['sqrt', T.TSQRT, MS_SQRT, TG.UnOper, 5],
  ['stack', T.TSTACK, 0, TG.NONE, 5],
  ['sub', T.TRSUB, 0, TG.Power, 0],
  ['subset', T.TSUBSET, MS_SUBSET, TG.Relation, 0],
  ['subseteq', T.TSUBSETEQ, MS_SUBSETEQ, TG.Relation, 0],
  ['succ', T.TSUCCEEDS, MS_SUCCEEDS, TG.Relation, 0],
  ['succcurlyeq', T.TSUCCEEDSEQUAL, MS_SUCCEEDSEQUAL, TG.Relation, 0],
  ['succsim', T.TSUCCEEDSEQUIV, MS_SUCCEEDSEQUIV, TG.Relation, 0],
  ['sum', T.TSUM, MS_SUM, TG.Oper, 5],
  ['sup', T.TRSUP, 0, TG.Power, 0],
  ['supset', T.TSUPSET, MS_SUPSET, TG.Relation, 0],
  ['supseteq', T.TSUPSETEQ, MS_SUPSETEQ, TG.Relation, 0],
  ['tan', T.TTAN, 0, TG.Function, 5],
  ['tanh', T.TTANH, 0, TG.Function, 5],
  ['tilde', T.TTILDE, MS_TILDE, TG.Attribute, 5],
  ['times', T.TTIMES, MS_TIMES, TG.Product, 0],
  ['to', T.TTO, 0, TG.Limit, 0],
  ['toward', T.TTOWARD, MS_RIGHTARROW, TG.Relation, 0],
  ['transl', T.TTRANSL, MS_TRANSL, TG.Relation, 0],
  ['transr', T.TTRANSR, MS_TRANSR, TG.Relation, 0],
  ['underbrace', T.TUNDERBRACE, MS_UNDERBRACE, TG.Product, 5],
  ['underline', T.TUNDERLINE, 0, TG.Attribute, 5],
  ['union', T.TUNION, MS_UNION, TG.Sum, 0],
  ['uoper', T.TUOPER, 0, TG.UnOper, 5],
  ['uparrow', T.TUPARROW, MS_UPARROW, TG.Standalone, 5],
  ['vec', T.TVEC, MS_VEC, TG.Attribute, 5],
  ['widebslash', T.TWIDEBACKSLASH, MS_BACKSLASH, TG.Product, 0],
  ['wideharpoon', T.TWIDEHARPOON, MS_HARPOON, TG.Attribute, 5],
  ['widehat', T.TWIDEHAT, MS_HAT, TG.Attribute, 5],
  ['wideslash', T.TWIDESLASH, MS_SLASH, TG.Product, 0],
  ['widetilde', T.TWIDETILDE, MS_TILDE, TG.Attribute, 5],
  ['widevec', T.TWIDEVEC, MS_VEC, TG.Attribute, 5],
  ['wp', T.TWP, MS_WP, TG.Standalone, 5],
  ['جا', T.TSIN, 0, TG.Function, 5],
  ['جاز', T.TSINH, 0, TG.Function, 5],
  ['جتا', T.TCOS, 0, TG.Function, 5],
  ['جتاز', T.TCOSH, 0, TG.Function, 5],
  ['حا', T.TSIN, 0, TG.Function, 5],
  ['حاز', T.TSINH, 0, TG.Function, 5],
  ['حتا', T.TCOS, 0, TG.Function, 5],
  ['حتاز', T.TCOSH, 0, TG.Function, 5],
  ['حد', T.THADD, MS_HADD, TG.Oper, 5],
  ['طا', T.TTAN, 0, TG.Function, 5],
  ['طاز', T.TTANH, 0, TG.Function, 5],
  ['طتا', T.TCOT, 0, TG.Function, 5],
  ['طتاز', T.TCOTH, 0, TG.Function, 5],
  ['ظا', T.TTAN, 0, TG.Function, 5],
  ['ظاز', T.TTANH, 0, TG.Function, 5],
  ['ظتا', T.TCOT, 0, TG.Function, 5],
  ['ظتاز', T.TCOTH, 0, TG.Function, 5],
  ['قا', T.TSEC, 0, TG.Function, 5],
  ['قاز', T.TSECH, 0, TG.Function, 5],
  ['قتا', T.TCSC, 0, TG.Function, 5],
  ['قتاز', T.TCSCH, 0, TG.Function, 5],
  ['لو', T.TLOG, 0, TG.Function, 5],
  ['مجـ', T.TSUM, MS_MAJ, TG.Oper, 5],
  ['نها', T.TNAHA, 0, TG.Oper, 5],
  ['ٯا', T.TSEC, 0, TG.Function, 5],
  ['ٯاز', T.TSECH, 0, TG.Function, 5],
  ['ٯتا', T.TCSC, 0, TG.Function, 5],
  ['ٯتاز', T.TCSCH, 0, TG.Function, 5],
] as [string, SmTokenType, number, TG, number][]).map(([aIdent, eType, cMathChar, nGroup, nLevel]) => ({ aIdent, eType, cMathChar, nGroup, nLevel }));

const TABLE = new Map(aTokenTable.map((e) => [e.aIdent.toLowerCase(), e]));

//Returns the SmTokenTableEntry for a keyword
export function GetTokenTableEntry(rName: string): SmTokenTableEntry | null {
  if (!rName) return null; //avoid null pointer exceptions
  return TABLE.get(rName.toLowerCase()) ?? null;
}

export function encloseOrEscapeLiteral(string: string, force: boolean): string {
  if (force) return `"${string}"`;
  let result = '';
  const DelimiterTable1 = new Set([' ', '\t', '\n', '\r', '+', '-', '*', '/', '=', '^', '_', '#', '%', '>', '<', '&', '|', '~', '`']);
  const DelimiterTable2 = new Set(['{', '}', '(', ')', '[', ']']);
  for (const c of string) {
    if (c === '"') result += '"\\""';
    else if (DelimiterTable1.has(c)) result += `"${c}"`;
    else if (DelimiterTable2.has(c)) result += `\\${c}`;
    else result += c;
  }
  const tkn = GetTokenTableEntry(result);
  // excluding function and operator as they take arguments and can't treat them as literal or else arguments are not displayed correctly
  if (tkn && tkn.nGroup !== TG.Function && tkn.nGroup !== TG.Oper) result = `"${result}"`;
  return result;
}

/** UnicodeType::SPACE_SEPARATOR and the other white space parseAnyToken skips (not the line feed). */
const isSpace = (c: string | undefined): boolean => c !== undefined && c !== '\n' && /[\s ]/.test(c);
const isLetter = (c: string | undefined): boolean => c !== undefined && /\p{L}|\p{M}/u.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

// checks number used as arguments in Math formulas (e.g. 'size' command)
// Format: no negative numbers, must start with a digit, no exponent notation, ...
function lcl_IsNumber(rText: string): boolean {
  let bPoint = false;
  for (const cChar of rText) {
    if (cChar === '.') {
      if (bPoint) return false;
      bPoint = true;
    } else if (!isDigit(cChar)) return false;
  }
  return true;
}
const lcl_IsNotWholeNumber = (rText: string): boolean => !/^[0-9]*$/.test(rText);
const lcl_IsNotWholeNumber16 = (rText: string): boolean => !/^[0-9A-F]*$/.test(rText);

/** Basic HTML colour names (starmathdatabase::Identify_ColorName_Parser, reduced). */
const COLORS: Record<string, number> = {
  black: 0x000000, white: 0xffffff, red: 0xff0000, green: 0x008000, blue: 0x0000ff, cyan: 0x00ffff, magenta: 0xff00ff,
  yellow: 0xffff00, gray: 0x808080, lime: 0x00ff00, maroon: 0x800000, navy: 0x000080, olive: 0x808000,
  purple: 0x800080, silver: 0xc0c0c0, teal: 0x008080, aqua: 0x00ffff, fuchsia: 0xff00ff, orange: 0xffa500,
};

const MATHML_COLORS = new Set(['aqua', 'black', 'blue', 'fuchsia', 'gray', 'green', 'lime', 'maroon', 'navy', 'olive', 'purple', 'red', 'silver', 'teal', 'white', 'yellow']);

/** The kinds of ParseResult::TokenType the tokenizer distinguishes. */
const KParseType = { NONE: 0, ONE_SINGLE_CHAR: 1, BOOLEAN: 2, IDENTNAME: 4, DOUBLE_QUOTE_STRING: 8, ANY_NUMBER: 16 } as const;
interface ParseResult { TokenType: number; EndPos: number; DequotedNameOrString?: string }

export interface SmErrorDesc { pNode: SmNode }

export class SmParser5 {
  m_aBufferString = '';
  m_aCurToken = new SmToken();
  m_aErrDescList: SmErrorDesc[] = [];
  m_nBufferIndex = 0;
  m_nTokenIndex = 0;
  m_nRow = 0;
  m_nColOff = 0;
  m_nParseDepth = 0;
  m_aUsedSymbols = new Set<string>();

  /** parseAnyToken / parsePredefinedToken, reduced to what the formula language needs. */
  private parseAny(nPos: number): ParseResult {
    const s = this.m_aBufferString, c = s[nPos];
    if (c === undefined) return { TokenType: 0, EndPos: nPos };
    // ASC_NUMBER: digits or a dot to start, digits, dots and a comma group separator to continue
    if (isDigit(c) || (c === '.' && isDigit(s[nPos + 1]))) {
      let e = nPos + 1;
      while (e < s.length && (isDigit(s[e]) || s[e] === '.' || (s[e] === ',' && isDigit(s[e + 1])) || s[e] === ',')) e++;
      return { TokenType: KParseType.ANY_NUMBER, EndPos: e };
    }
    if (isLetter(c)) {
      let e = nPos + 1;
      while (e < s.length && isLetter(s[e])) e++;
      return { TokenType: KParseType.IDENTNAME, EndPos: e };
    }
    if (c === '"') {
      // TWO_DOUBLE_QUOTES_BREAK_STRING
      let e = nPos + 1, str = '';
      while (e < s.length && s[e] !== '"') str += s[e++];
      return { TokenType: KParseType.DOUBLE_QUOTE_STRING, EndPos: Math.min(s.length, e + 1), DequotedNameOrString: str };
    }
    if (c === '<' || c === '>') {
      let e = nPos + 1;
      while (e < s.length && e - nPos < 2 && '<>='.includes(s[e]!)) e++;
      return { TokenType: KParseType.BOOLEAN, EndPos: e };
    }
    if (c === '\n') return { TokenType: 0, EndPos: nPos };
    if ('%[\\]^`{|}~#&()*+-./='.includes(c)) return { TokenType: KParseType.ONE_SINGLE_CHAR, EndPos: nPos + 1 };
    return { TokenType: 0, EndPos: nPos };
  }

  /** Skips white space, line feeds (counting rows) and %% comments; returns the token start. */
  private skip(): number {
    const s = this.m_aBufferString, nBufLen = s.length;
    for (;;) {
      while (isSpace(s[this.m_nBufferIndex])) ++this.m_nBufferIndex;
      const nRealStart = this.m_nBufferIndex;
      if (nRealStart < nBufLen && s[nRealStart] === '\n') {
        // keep data needed for tokens row and col entry up to date
        ++this.m_nRow;
        this.m_nBufferIndex = this.m_nColOff = nRealStart + 1;
        continue;
      }
      if (nRealStart + 2 <= nBufLen && s.startsWith('%%', nRealStart)) {
        //SkipComment
        this.m_nBufferIndex = nRealStart + 2;
        while (this.m_nBufferIndex < nBufLen && s[this.m_nBufferIndex] !== '\n') ++this.m_nBufferIndex;
        continue;
      }
      return nRealStart;
    }
  }

  private set(eType: SmTokenType, cMath: number, nGroup: TG, nLevel: number, aText: string): void {
    const t = this.m_aCurToken;
    t.eType = eType; t.setChar(cMath); t.nGroup = nGroup; t.nLevel = nLevel; t.aText = aText;
  }

  NextToken(): void { //Central part of the parser
    const s = this.m_aBufferString, nBufLen = s.length;
    const nRealStart = this.skip();
    const aRes = this.parseAny(nRealStart);
    this.m_nBufferIndex = nRealStart;
    // set index of current token
    this.m_nTokenIndex = this.m_nBufferIndex;

    let bHandled = true;
    if (nRealStart >= nBufLen) {
      this.set(T.TEND, 0, TG.NONE, 0, '');
    } else if (aRes.TokenType & KParseType.ANY_NUMBER) {
      if (s[aRes.EndPos - 1] === ',' && aRes.EndPos < nBufLen && !isSpace(s[aRes.EndPos])) {
        // Comma followed by a non-space char is unlikely for decimal/thousands separator.
        --aRes.EndPos;
      }
      this.set(T.TNUMBER, 0, TG.NONE, 5, s.slice(nRealStart, aRes.EndPos));
    } else if (aRes.TokenType & KParseType.DOUBLE_QUOTE_STRING) {
      this.set(T.TTEXT, 0, TG.NONE, 5, aRes.DequotedNameOrString ?? '');
    } else if (aRes.TokenType & KParseType.IDENTNAME) {
      const aName = s.slice(nRealStart, aRes.EndPos);
      const pEntry = GetTokenTableEntry(aName);
      if (pEntry) this.m_aCurToken.assign(pEntry);
      else this.set(T.TIDENT, 0, TG.NONE, 5, aName);
    } else if (aRes.TokenType === 0 && s[nRealStart] === '_') {
      this.set(T.TRSUB, 0, TG.Power, 0, '_');
      aRes.EndPos = nRealStart + 1;
    } else if (aRes.TokenType & KParseType.BOOLEAN) {
      if (aRes.EndPos - nRealStart <= 2) {
        const ch = s[nRealStart];
        const set2 = (eType: SmTokenType, c: number, g: TG, l: number, t: string) => { this.set(eType, c, g, l, t); aRes.EndPos = nRealStart + t.length; };
        if (ch === '<') {
          if (s.startsWith('<<', nRealStart)) set2(T.TLL, MS_LL, TG.Relation, 0, '<<');
          else if (s.startsWith('<=', nRealStart)) set2(T.TLE, MS_LE, TG.Relation, 0, '<=');
          else if (s.startsWith('<-', nRealStart)) set2(T.TLEFTARROW, MS_LEFTARROW, TG.Standalone, 5, '<-');
          else if (s.startsWith('<>', nRealStart)) set2(T.TNEQ, MS_NEQ, TG.Relation, 0, '<>');
          else if (s.startsWith('<?>', nRealStart)) set2(T.TPLACE, MS_PLACE, TG.NONE, 5, '<?>');
          else set2(T.TLT, MS_LT, TG.Relation, 0, '<');
        } else if (ch === '>') {
          if (s.startsWith('>=', nRealStart)) set2(T.TGE, MS_GE, TG.Relation, 0, '>=');
          else if (s.startsWith('>>', nRealStart)) set2(T.TGG, MS_GG, TG.Relation, 0, '>>');
          else set2(T.TGT, MS_GT, TG.Relation, 0, '>');
        } else bHandled = false;
      }
    } else if (aRes.TokenType & KParseType.ONE_SINGLE_CHAR) {
      const ch = s[nRealStart];
      const two = (t: string) => s.startsWith(t, nRealStart);
      switch (ch) {
        case '%': {
          // get identifier of user-defined character
          this.set(T.TTEXT, 0, TG.NONE, 5, '%');
          let e = aRes.EndPos;
          if (isLetter(s[e])) {
            while (e < nBufLen && (isLetter(s[e]) || isDigit(s[e]) || s[e] === '.')) e++;
            this.m_aCurToken.eType = T.TSPECIAL;
            this.m_aCurToken.aText = s.slice(nRealStart, e);
            aRes.EndPos = e;
          }
          // if no symbol-name was found we start-over with
          // finding the next token right after the '%' sign.
          break;
        }
        case '[': this.set(T.TLBRACKET, MS_LBRACKET, TG.LBrace, 5, '['); break;
        case '\\': this.set(T.TESCAPE, 0, TG.NONE, 5, '\\'); break;
        case ']': this.set(T.TRBRACKET, MS_RBRACKET, TG.RBrace, 0, ']'); break;
        case '^': this.set(T.TRSUP, 0, TG.Power, 0, '^'); break;
        case '`': this.set(T.TSBLANK, 0, TG.Blank, 5, '`'); break;
        case '{': this.set(T.TLGROUP, MS_LBRACE, TG.NONE, 5, '{'); break;
        case '|': this.set(T.TOR, MS_OR, TG.Sum, 0, '|'); break;
        case '}': this.set(T.TRGROUP, MS_RBRACE, TG.NONE, 0, '}'); break;
        case '~': this.set(T.TBLANK, 0, TG.Blank, 5, '~'); break;
        case '#':
          if (two('##')) { this.set(T.TDPOUND, 0, TG.NONE, 0, '##'); aRes.EndPos = nRealStart + 2; }
          else this.set(T.TPOUND, 0, TG.NONE, 0, '#');
          break;
        case '&': this.set(T.TAND, 0x2227, TG.Product, 0, '&'); break;
        case '(': this.set(T.TLPARENT, MS_LPARENT, TG.LBrace, 5, '('); break; //! 0 to continue expression
        case ')': this.set(T.TRPARENT, MS_RPARENT, TG.RBrace, 0, ')'); break; //! 0 to terminate expression
        case '*': this.set(T.TMULTIPLY, MS_MULTIPLY, TG.Product, 0, '*'); break;
        case '+':
          if (two('+-')) { this.set(T.TPLUSMINUS, MS_PLUSMINUS, TG.UnOper | TG.Sum, 5, '+-'); aRes.EndPos = nRealStart + 2; }
          else this.set(T.TPLUS, MS_PLUS, TG.UnOper | TG.Sum, 5, '+');
          break;
        case '-':
          if (two('-+')) { this.set(T.TMINUSPLUS, MS_MINUSPLUS, TG.UnOper | TG.Sum, 5, '-+'); aRes.EndPos = nRealStart + 2; }
          else if (two('->')) { this.set(T.TRIGHTARROW, MS_RIGHTARROW, TG.Standalone, 5, '->'); aRes.EndPos = nRealStart + 2; }
          else this.set(T.TMINUS, MS_MINUS, TG.UnOper | TG.Sum, 5, '-');
          break;
        case '.':
          // Only one character? Then it can't be a number.
          if (this.m_nBufferIndex < nBufLen - 1) {
            // for compatibility with SO5.2
            // texts like .34 ...56 ... h ...78..90
            // will be treated as numbers
            const nTxtStart = this.m_nBufferIndex;
            let cChar: string;
            // if the equation ends with dot(.) then increment m_nBufferIndex till end of string only
            do {
              cChar = s[++this.m_nBufferIndex]!;
            } while ((cChar === '.' || isDigit(cChar)) && this.m_nBufferIndex < nBufLen - 1);
            this.set(T.TNUMBER, 0, TG.NONE, 5, s.slice(nTxtStart, this.m_nBufferIndex));
            aRes.EndPos = this.m_nBufferIndex;
          } else bHandled = false;
          break;
        case '/': this.set(T.TDIVIDEBY, 0x002f, TG.Product, 0, '/'); break;
        case '=': this.set(T.TASSIGN, MS_ASSIGN, TG.Relation, 0, '='); break;
        default: bHandled = false;
      }
    } else bHandled = false;

    if (!bHandled) {
      // tdf#129372: we may have to deal with surrogate pairs
      const nOffset = (s.codePointAt(nRealStart) ?? 0) > 0xffff ? 2 : 1;
      this.set(T.TCHARACTER, 0, TG.NONE, 5, s.slice(nRealStart, nRealStart + nOffset));
      aRes.EndPos = nRealStart + nOffset;
    }
    if (this.cur() !== T.TEND) this.m_nBufferIndex = aRes.EndPos;
  }

  /** NextTokenColor: a colour name, or "#" for a hex value (reduced: rgb, rgba, hex and HTML names). */
  NextTokenColor(): void {
    const s = this.m_aBufferString;
    const nRealStart = this.skip();
    const aRes = this.parseAny(nRealStart);
    this.m_nTokenIndex = this.m_nBufferIndex = nRealStart;
    const t = this.m_aCurToken;
    if (nRealStart >= s.length) t.eType = T.TEND;
    else if (aRes.TokenType & KParseType.IDENTNAME) {
      const aName = s.slice(nRealStart, aRes.EndPos).toLowerCase();
      t.aText = ''; t.nLevel = 0; t.nGroup = TG.Color;
      if (aName === 'rgb') t.eType = T.TRGB;
      else if (aName === 'rgba') t.eType = T.TRGBA;
      else if (aName === 'hex') t.eType = T.THEX;
      // The 16 MathML colour names are TMATHMLCOL, the others HTML colours (starmathdatabase).
      else if (aName in COLORS) { t.eType = MATHML_COLORS.has(aName) ? T.TMATHMLCOL : T.THTMLCOL; t.cMathChar = COLORS[aName]!.toString(16); }
      else { t.eType = T.TERROR; t.nGroup = TG.NONE; }
    } else if (aRes.TokenType & KParseType.ONE_SINGLE_CHAR && s[nRealStart] === '#' && !s.startsWith('##', nRealStart)) {
      t.eType = T.THEX; t.cMathChar = ''; t.nGroup = TG.Color; t.nLevel = 0; t.aText = 'hex';
    } else t.eType = T.TNONE;
    if (t.eType !== T.TEND) this.m_nBufferIndex = aRes.EndPos;
  }

  /** NextTokenFontSize: a (hexadecimal) number or one of + - * /. */
  NextTokenFontSize(): void {
    const s = this.m_aBufferString;
    const nRealStart = this.skip();
    this.m_nTokenIndex = this.m_nBufferIndex = nRealStart;
    const t = this.m_aCurToken;
    let e = nRealStart;
    while (e < s.length && /[0-9A-F.,]/.test(s[e]!)) e++;
    if (nRealStart >= s.length) { t.eType = T.TEND; return; }
    if (e > nRealStart && /[0-9A-F]/.test(s[nRealStart]!)) {
      t.eType = T.THEX; t.cMathChar = ''; t.nGroup = TG.NONE; t.nLevel = 5; t.aText = s.slice(nRealStart, e);
    } else {
      e = nRealStart + 1;
      switch (s[nRealStart]) {
        case '*': this.set(T.TMULTIPLY, MS_MULTIPLY, TG.Product, 0, '*'); break;
        case '+': this.set(T.TPLUS, MS_PLUS, TG.UnOper | TG.Sum, 5, '+'); break;
        case '-': this.set(T.TMINUS, MS_MINUS, TG.UnOper | TG.Sum, 5, '-'); break;
        case '/': this.set(T.TDIVIDEBY, 0x002f, TG.Product, 0, '/'); break;
        default: t.eType = T.TNONE;
      }
    }
    this.m_nBufferIndex = e;
  }

  /** The current token's type, read anew (TypeScript would narrow the field across NextToken). */
  private cur(): SmTokenType { return this.m_aCurToken.eType; }

  private TokenInGroup(nGroup: TG): boolean { return (this.m_aCurToken.nGroup & nGroup) !== 0; }
  private tok(): SmToken { return this.m_aCurToken.clone(); }
  private depth<R>(f: () => R): R {
    if (++this.m_nParseDepth > DEPTH_LIMIT) throw new RangeError('parser depth limit');
    try { return f(); } finally { --this.m_nParseDepth; }
  }

  // grammar

  DoTable(): SmTableNode {
    return this.depth(() => {
      const aLineArray: (SmNode | null)[] = [this.DoLine()];
      while (this.cur() === T.TNEWLINE) {
        this.NextToken();
        aLineArray.push(this.DoLine());
      }
      const xSNode = new SmTableNode(this.tok());
      xSNode.SetSubNodes(aLineArray);
      return xSNode;
    });
  }

  // parse alignment info (if any), then go on with rest of expression
  DoAlign(bUseExtraSpaces = true): SmNode {
    return this.depth(() => {
      let xSNode: SmStructureNode | null = null;
      if (this.TokenInGroup(TG.Align)) {
        xSNode = new SmAlignNode(this.tok());
        this.NextToken();
        // allow for just one align statement in 5.0
        if (this.TokenInGroup(TG.Align)) return this.DoError();
      }
      const pNode = this.DoExpression(bUseExtraSpaces);
      if (xSNode) {
        xSNode.SetSubNode(0, pNode);
        return xSNode;
      }
      return pNode;
    });
  }

  // Postcondition: m_aCurToken.eType == TEND || m_aCurToken.eType == TNEWLINE
  DoLine(): SmNode {
    return this.depth(() => {
      const ExpressionArray: (SmNode | null)[] = [];
      // start with single expression that may have an alignment statement
      // (and go on with expressions that must not have alignment
      // statements in 'while' loop below. See also 'Expression()'.)
      if (this.cur() !== T.TEND && this.cur() !== T.TNEWLINE) ExpressionArray.push(this.DoAlign());
      while (this.cur() !== T.TEND && this.cur() !== T.TNEWLINE) ExpressionArray.push(this.DoExpression());
      //If there's no expression, add an empty one.
      //this is to avoid a formula tree without any caret
      //positions, in visual formula editor.
      if (!ExpressionArray.length) ExpressionArray.push(new SmExpressionNode(new SmToken(T.TNEWLINE)));
      const xSNode = new SmLineNode(this.tok());
      xSNode.SetSubNodes(ExpressionArray);
      return xSNode;
    });
  }

  DoExpression(bUseExtraSpaces = true): SmNode {
    return this.depth(() => {
      const RelationArray: (SmNode | null)[] = [this.DoRelation()];
      while (this.m_aCurToken.nLevel >= 4) RelationArray.push(this.DoRelation());
      if (RelationArray.length > 1) {
        const xSNode = new SmExpressionNode(this.tok());
        xSNode.SetSubNodes(RelationArray);
        xSNode.SetUseExtraSpaces(bUseExtraSpaces);
        return xSNode;
      }
      // This expression has only one node so just push this node.
      return RelationArray[0]!;
    });
  }

  DoRelation(): SmNode {
    return this.depth(() => {
      let xFirst = this.DoSum();
      while (this.TokenInGroup(TG.Relation)) {
        const xSNode = new SmBinHorNode(this.tok());
        const xSecond = this.DoOpSubSup();
        const xThird = this.DoSum();
        xSNode.SetSubNodes(xFirst, xSecond, xThird);
        xFirst = xSNode;
      }
      return xFirst;
    });
  }

  DoSum(): SmNode {
    return this.depth(() => {
      let xFirst = this.DoProduct();
      while (this.TokenInGroup(TG.Sum)) {
        const xSNode = new SmBinHorNode(this.tok());
        const xSecond = this.DoOpSubSup();
        const xThird = this.DoProduct();
        xSNode.SetSubNodes(xFirst, xSecond, xThird);
        xFirst = xSNode;
      }
      return xFirst;
    });
  }

  DoProduct(): SmNode {
    return this.depth(() => {
      let xFirst = this.DoPower();
      let nDepthLimit = 0;
      while (this.TokenInGroup(TG.Product)) {
        //this linear loop builds a recursive structure, if it gets
        //too deep then later processing, e.g. releasing the tree,
        //can exhaust stack
        if (this.m_nParseDepth + nDepthLimit > DEPTH_LIMIT) throw new RangeError('parser depth limit');
        let xSNode: SmStructureNode;
        let xOper: SmNode;
        const eType = this.m_aCurToken.eType;
        switch (eType) {
          case T.TOVER:
            xSNode = new SmBinVerNode(this.tok());
            xOper = new SmRectangleNode(this.tok());
            this.NextToken();
            break;
          case T.TBOPER:
            xSNode = new SmBinHorNode(this.tok());
            this.NextToken();
            //Let the glyph node know it's a binary operation
            this.m_aCurToken.eType = T.TBOPER;
            this.m_aCurToken.nGroup = TG.Product;
            xOper = this.DoGlyphSpecial();
            break;
          case T.TOVERBRACE:
          case T.TUNDERBRACE:
            xSNode = new SmVerticalBraceNode(this.tok());
            xOper = new SmMathSymbolNode(this.tok());
            this.NextToken();
            break;
          case T.TWIDEBACKSLASH:
          case T.TWIDESLASH: {
            const pSTmp = new SmBinDiagonalNode(this.tok());
            pSTmp.SetAscending(eType === T.TWIDESLASH);
            xSNode = pSTmp;
            xOper = new SmPolyLineNode(this.tok());
            this.NextToken();
            break;
          }
          default:
            xSNode = new SmBinHorNode(this.tok());
            xOper = this.DoOpSubSup();
        }
        const xArg = this.DoPower();
        xSNode.SetSubNodesBinMo(xFirst, xOper, xArg);
        xFirst = xSNode;
        ++nDepthLimit;
      }
      return xFirst;
    });
  }

  DoSubSup(nActiveGroup: TG, xGivenNode: SmNode): SmNode {
    return this.depth(() => {
      const pNode = new SmSubSupNode(this.tok());
      //! Of course 'm_aCurToken' is just the first sub-/supscript token.
      //! It should be of no further interest. The positions of the
      //! sub-/supscripts will be identified by the corresponding subnodes
      //! index in the 'aSubNodes' array (enum value from 'SmSubSup').
      pNode.SetUseLimits(nActiveGroup === TG.Limit);
      // initialize subnodes array
      const aSubNodes: (SmNode | null)[] = new Array(1 + SUBSUP_NUM_ENTRIES).fill(null);
      aSubNodes[0] = xGivenNode;
      // process all sub-/supscripts
      let nIndex = 0;
      while (this.TokenInGroup(nActiveGroup)) {
        const eType = this.m_aCurToken.eType;
        switch (eType) {
          case T.TRSUB: nIndex = SmSubSup.RSUB; break;
          case T.TRSUP: nIndex = SmSubSup.RSUP; break;
          case T.TFROM: case T.TCSUB: nIndex = SmSubSup.CSUB; break;
          case T.TTO: case T.TCSUP: nIndex = SmSubSup.CSUP; break;
          case T.TLSUB: nIndex = SmSubSup.LSUB; break;
          case T.TLSUP: nIndex = SmSubSup.LSUP; break;
          default: break;
        }
        nIndex++;
        let xENode: SmNode | null = null;
        if (aSubNodes[nIndex]) { // if already occupied at earlier iteration
          // forget the earlier one, remember an error instead
          aSubNodes[nIndex] = null;
          xENode = this.DoError(); // this also skips current token.
        } else {
          // skip sub-/supscript token
          this.NextToken();
        }
        // get sub-/supscript node
        // (even when we saw a double-sub/supscript error in the above
        // in order to minimize mess and continue parsing.)
        let xSNode: SmNode;
        if (eType === T.TFROM || eType === T.TTO) {
          // parse limits in old 4.0 and 5.0 style
          xSNode = this.DoRelation();
        } else xSNode = this.DoTerm(true);
        aSubNodes[nIndex] = xENode ?? xSNode;
      }
      pNode.SetSubNodes(aSubNodes);
      return pNode;
    });
  }

  DoSubSupEvaluate(xGivenNode: SmNode): SmNode {
    return this.depth(() => {
      const pNode = new SmSubSupNode(this.tok());
      pNode.SetUseLimits(true);
      // initialize subnodes array
      const aSubNodes: (SmNode | null)[] = new Array(1 + SUBSUP_NUM_ENTRIES).fill(null);
      aSubNodes[0] = xGivenNode;
      // process all sub-/supscripts
      let nIndex = 0;
      while (this.TokenInGroup(TG.Limit)) {
        const eType = this.m_aCurToken.eType;
        switch (eType) {
          case T.TFROM: nIndex = SmSubSup.RSUB; break;
          case T.TTO: nIndex = SmSubSup.RSUP; break;
          default: break;
        }
        nIndex++;
        let xENode: SmNode | null = null;
        if (aSubNodes[nIndex]) { // if already occupied at earlier iteration
          // forget the earlier one, remember an error instead
          aSubNodes[nIndex] = null;
          xENode = this.DoError(); // this also skips current token.
        } else this.NextToken(); // skip sub-/supscript token
        // get sub-/supscript node
        const xSNode = this.DoTerm(true);
        aSubNodes[nIndex] = xENode ?? xSNode;
      }
      pNode.SetSubNodes(aSubNodes);
      return pNode;
    });
  }

  DoOpSubSup(): SmNode {
    return this.depth(() => {
      // get operator symbol
      const xNode = new SmMathSymbolNode(this.tok());
      // skip operator token
      this.NextToken();
      // get sub- supscripts if any
      if (this.m_aCurToken.nGroup === TG.Power) return this.DoSubSup(TG.Power, xNode);
      return xNode;
    });
  }

  DoPower(): SmNode {
    return this.depth(() => {
      // get body for sub- supscripts on top of stack
      const xNode = this.DoTerm(false);
      if (this.m_aCurToken.nGroup === TG.Power) return this.DoSubSup(TG.Power, xNode);
      return xNode;
    });
  }

  DoBlank(): SmBlankNode {
    return this.depth(() => {
      const pBlankNode = new SmBlankNode(this.tok());
      do {
        pBlankNode.IncreaseBy(this.m_aCurToken);
        this.NextToken();
      } while (this.TokenInGroup(TG.Blank));
      // Ignore trailing spaces, if corresponding option is set
      if (this.cur() === T.TNEWLINE || this.cur() === T.TEND) pBlankNode.Clear();
      return pBlankNode;
    });
  }

  DoTerm(bGroupNumberIdent: boolean): SmNode {
    return this.depth((): SmNode => {
      switch (this.m_aCurToken.eType) {
        case T.TESCAPE:
          return this.DoEscape();
        case T.TNOSPACE:
        case T.TLGROUP: {
          const bNoSpace = this.cur() === T.TNOSPACE;
          if (bNoSpace) this.NextToken();
          if (this.cur() !== T.TLGROUP) return this.DoTerm(false); // nospace is no longer concerned
          this.NextToken();
          // allow for empty group
          if (this.cur() === T.TRGROUP) {
            const xSNode = new SmExpressionNode(this.tok());
            xSNode.SetSubNodes(null, null);
            this.NextToken();
            return xSNode;
          }
          const pNode = this.DoAlign(!bNoSpace);
          if (this.cur() === T.TRGROUP) {
            this.NextToken();
            return pNode;
          }
          const xSNode = new SmExpressionNode(this.tok());
          const xError = this.DoError();
          xSNode.SetSubNodes(pNode, xError);
          return xSNode;
        }
        case T.TLEFT:
          return this.DoBrace();
        case T.TEVALUATE:
          return this.DoEvaluate();
        case T.TBLANK:
        case T.TSBLANK:
          return this.DoBlank();
        case T.TTEXT: {
          const pNode = new SmTextNode(this.tok(), FNT_TEXT);
          this.NextToken();
          return pNode;
        }
        case T.TCHARACTER: {
          const pNode = new SmTextNode(this.tok(), FNT_VARIABLE);
          this.NextToken();
          return pNode;
        }
        case T.TIDENT:
        case T.TNUMBER: {
          const pTextNode = new SmTextNode(this.tok(), this.cur() === T.TNUMBER ? FNT_NUMBER : FNT_VARIABLE);
          if (!bGroupNumberIdent) {
            this.NextToken();
            return pTextNode;
          }
          const aNodes: SmNode[] = [];
          // Some people want to be able to write "x_2n" for "x_{2n}"
          // although e.g. LaTeX or AsciiMath interpret that as "x_2 n".
          // The tokenizer skips whitespaces so we need some additional
          // work to distinguish from "x_2 n".
          const nBufLen = this.m_aBufferString.length;
          // We need to be careful to call NextToken() only after having
          // tested for a whitespace separator (otherwise it will be
          // skipped!)
          let moveToNextToken = true;
          while (this.m_nBufferIndex < nBufLen && !isSpace(this.m_aBufferString[this.m_nBufferIndex])) {
            this.NextToken();
            if (this.cur() !== T.TNUMBER && this.cur() !== T.TIDENT) {
              // Neither a number nor an identifier. We just moved to
              // the next token, so no need to do that again.
              moveToNextToken = false;
              break;
            }
            aNodes.push(new SmTextNode(this.tok(), this.cur() === T.TNUMBER ? FNT_NUMBER : FNT_VARIABLE));
          }
          if (moveToNextToken) this.NextToken();
          if (!aNodes.length) return pTextNode;
          // We have several concatenated identifiers and numbers.
          // Let's group them into one SmExpressionNode.
          aNodes.unshift(pTextNode);
          const xNode = new SmExpressionNode(new SmToken());
          xNode.SetSubNodes(aNodes);
          return xNode;
        }
        case T.TLEFTARROW: case T.TRIGHTARROW: case T.TUPARROW: case T.TDOWNARROW: case T.TCIRC: case T.TDRARROW:
        case T.TDLARROW: case T.TDLRARROW: case T.TEXISTS: case T.TNOTEXISTS: case T.TFORALL: case T.TPARTIAL:
        case T.TNABLA: case T.TLAPLACE: case T.TFOURIER: case T.TTOWARD: case T.TDOTSAXIS: case T.TDOTSDIAG:
        case T.TDOTSDOWN: case T.TDOTSLOW: case T.TDOTSUP: case T.TDOTSVERT: {
          const pNode = new SmMathSymbolNode(this.tok());
          this.NextToken();
          return pNode;
        }
        case T.TSETN: case T.TSETZ: case T.TSETQ: case T.TSETR: case T.TSETC: case T.THBAR: case T.TLAMBDABAR:
        case T.TBACKEPSILON: case T.TALEPH: case T.TIM: case T.TRE: case T.TWP: case T.TEMPTYSET: case T.TINFINITY: {
          const pNode = new SmMathIdentifierNode(this.tok());
          this.NextToken();
          return pNode;
        }
        case T.TPLACE: {
          const pNode = new SmPlaceNode(this.tok());
          this.NextToken();
          return pNode;
        }
        case T.TSPECIAL:
          return this.DoSpecial();
        case T.TBINOM:
          return this.DoBinom();
        case T.TFRAC:
          return this.DoFrac();
        case T.TSTACK:
          return this.DoStack();
        case T.TMATRIX:
          return this.DoMatrix();
        case T.THEX:
          this.NextTokenFontSize();
          if (this.cur() === T.THEX) {
            const pTextNode = new SmTextNode(this.tok(), FNT_NUMBER);
            this.NextToken();
            return pTextNode;
          }
          return this.DoError();
        default:
          if (this.TokenInGroup(TG.LBrace)) return this.DoBrace();
          if (this.TokenInGroup(TG.Oper)) return this.DoOperator();
          if (this.TokenInGroup(TG.UnOper)) return this.DoUnOper();
          if (this.TokenInGroup(TG.Attribute) || this.TokenInGroup(TG.FontAttr)) {
            const aStack: SmStructureNode[] = [];
            for (;;) {
              const bIsAttr = this.TokenInGroup(TG.Attribute);
              if (!bIsAttr && !this.TokenInGroup(TG.FontAttr)) break;
              aStack.push(bIsAttr ? this.DoAttribute() : this.DoFontAttribute());
            }
            let xFirstNode = this.DoPower();
            while (aStack.length) {
              const xNode = aStack.pop()!;
              xNode.SetSubNodes(null, xFirstNode);
              xFirstNode = xNode;
            }
            return xFirstNode;
          }
          if (this.TokenInGroup(TG.Function)) return this.DoFunction();
          return this.DoError();
      }
    });
  }

  DoEscape(): SmNode {
    return this.depth(() => {
      this.NextToken();
      switch (this.m_aCurToken.eType) {
        case T.TLPARENT: case T.TRPARENT: case T.TLBRACKET: case T.TRBRACKET: case T.TLDBRACKET: case T.TRDBRACKET:
        case T.TLBRACE: case T.TLGROUP: case T.TRBRACE: case T.TRGROUP: case T.TLANGLE: case T.TRANGLE: case T.TLCEIL:
        case T.TRCEIL: case T.TLFLOOR: case T.TRFLOOR: case T.TLLINE: case T.TRLINE: case T.TLDLINE: case T.TRDLINE: {
          const pNode = new SmMathSymbolNode(this.tok());
          this.NextToken();
          return pNode;
        }
        default:
          return this.DoError();
      }
    });
  }

  DoOperator(): SmOperNode {
    return this.depth(() => {
      const xSNode = new SmOperNode(this.tok());
      // get operator
      let xOperator = this.DoOper();
      if (this.m_aCurToken.nGroup === TG.Limit || this.m_aCurToken.nGroup === TG.Power) xOperator = this.DoSubSup(this.m_aCurToken.nGroup, xOperator);
      // get argument
      const xArg = this.DoPower();
      xSNode.SetSubNodes(xOperator, xArg);
      return xSNode;
    });
  }

  DoOper(): SmNode {
    return this.depth(() => {
      const eType = this.m_aCurToken.eType;
      let pNode: SmNode;
      switch (eType) {
        case T.TSUM: case T.TPROD: case T.TCOPROD: case T.TINT: case T.TINTD: case T.TIINT: case T.TIIINT:
        case T.TLINT: case T.TLLINT: case T.TLLLINT:
          pNode = new SmMathSymbolNode(this.tok());
          break;
        case T.TLIM: case T.TLIMSUP: case T.TLIMINF: case T.THADD: case T.TNAHA:
          if (eType === T.TLIMSUP) this.m_aCurToken.aText = 'lim sup';
          else if (eType === T.TLIMINF) this.m_aCurToken.aText = 'lim inf';
          else if (eType === T.TNAHA) this.m_aCurToken.aText = 'نها';
          else if (eType === T.THADD) this.m_aCurToken.aText = String.fromCodePoint(0x1eef1);
          else this.m_aCurToken.aText = 'lim';
          pNode = new SmTextNode(this.tok(), FNT_TEXT);
          break;
        case T.TOPER:
          this.NextToken();
          this.m_aCurToken.eType = T.TOPER;
          pNode = new SmGlyphSpecialNode(this.tok());
          break;
        default:
          throw new Error('unknown case');
      }
      this.NextToken();
      return pNode;
    });
  }

  DoUnOper(): SmStructureNode {
    return this.depth(() => {
      const aNodeToken = this.tok();
      const eType = this.m_aCurToken.eType;
      const bIsPostfix = eType === T.TFACT;
      let xSNode: SmStructureNode;
      let xOper: SmNode | null = null;
      let xExtra: SmNode | null = null;
      switch (eType) {
        case T.TABS:
        case T.TSQRT:
          this.NextToken();
          break;
        case T.TNROOT:
          this.NextToken();
          xExtra = this.DoPower();
          break;
        case T.TUOPER:
          this.NextToken();
          //Let the glyph know what it is...
          this.m_aCurToken.eType = T.TUOPER;
          this.m_aCurToken.nGroup = TG.UnOper;
          xOper = this.DoGlyphSpecial();
          break;
        case T.TPLUS: case T.TMINUS: case T.TPLUSMINUS: case T.TMINUSPLUS: case T.TNEG: case T.TFACT:
          xOper = this.DoOpSubSup();
          break;
        default:
          throw new Error('unknown case');
      }
      // get argument
      const xArg = this.DoPower();
      if (eType === T.TABS) {
        xSNode = new SmBraceNode(aNodeToken);
        xSNode.SetScaleMode(SmScaleMode.Height);
        // build nodes for left & right lines
        // (text, group, level of the used token are of no interest here)
        // we'll use row & column of the keyword for abs
        aNodeToken.eType = T.TABS;
        aNodeToken.setChar(MS_VERTLINE);
        const xLeft = new SmMathSymbolNode(aNodeToken.clone());
        const xRight = new SmMathSymbolNode(aNodeToken.clone());
        xSNode.SetSubNodes(xLeft, xArg, xRight);
      } else if (eType === T.TSQRT || eType === T.TNROOT) {
        xSNode = new SmRootNode(aNodeToken);
        xOper = new SmRootSymbolNode(aNodeToken.clone());
        xSNode.SetSubNodes(xExtra, xOper, xArg);
      } else {
        xSNode = new SmUnHorNode(aNodeToken);
        if (bIsPostfix) xSNode.SetSubNodes(xArg, xOper);
        else {
          // prefix operator
          xSNode.SetSubNodes(xOper, xArg);
        }
      }
      return xSNode;
    });
  }

  DoAttribute(): SmStructureNode {
    return this.depth(() => {
      const xSNode = new SmAttributeNode(this.tok());
      let xAttr: SmNode;
      let eScaleMode: SmScaleMode = SmScaleMode.None;
      // get appropriate node for the attribute itself
      switch (this.m_aCurToken.eType) {
        case T.TUNDERLINE: case T.TOVERLINE: case T.TOVERSTRIKE:
          xAttr = new SmRectangleNode(this.tok());
          eScaleMode = SmScaleMode.Width;
          break;
        case T.TWIDEVEC: case T.TWIDEHARPOON: case T.TWIDEHAT: case T.TWIDETILDE:
          xAttr = new SmMathSymbolNode(this.tok());
          eScaleMode = SmScaleMode.Width;
          break;
        default:
          xAttr = new SmMathSymbolNode(this.tok());
      }
      this.NextToken();
      xSNode.SetSubNodes(xAttr, null); // the body will be filled later
      xSNode.SetScaleMode(eScaleMode);
      return xSNode;
    });
  }

  DoFontAttribute(): SmStructureNode {
    return this.depth(() => {
      switch (this.m_aCurToken.eType) {
        case T.TITALIC: case T.TNITALIC: case T.TBOLD: case T.TNBOLD: case T.TPHANTOM: {
          const pNode = new SmFontNode(this.tok());
          this.NextToken();
          return pNode;
        }
        case T.TSIZE:
          return this.DoFontSize();
        case T.TFONT:
          return this.DoFont();
        case T.TCOLOR:
          return this.DoColor();
        default:
          throw new Error('unknown case');
      }
    });
  }

  DoColor(): SmStructureNode {
    return this.depth(() => {
      const nBufferIndex = this.m_nBufferIndex;
      this.NextTokenColor();
      if (this.cur() === T.TERROR) return this.DoError();
      if (!this.TokenInGroup(TG.Color)) return this.DoError();
      const aToken = this.tok();
      const num = (hex = false): number | null => {
        this.NextTokenFontSize();
        if (hex ? lcl_IsNotWholeNumber16(this.m_aCurToken.aText) : lcl_IsNotWholeNumber(this.m_aCurToken.aText)) return null;
        const n = parseInt(this.m_aCurToken.aText, hex ? 16 : 10);
        return Number.isNaN(n) || (!hex && n > 255) ? null : n;
      };
      if (this.cur() === T.TRGB || this.cur() === T.TRGBA) { //loads r, g and b
        const v: number[] = [];
        for (let i = 0; i < (this.cur() === T.TRGBA ? 4 : 3); i++) {
          const n = num();
          if (n === null) return this.DoError();
          v.push(n);
        }
        const nc = (v[2]! | (v[1]! << 8) | (v[0]! << 16) | ((v[3] ?? 0) << 24)) >>> 0;
        aToken.cMathChar = nc.toString(16);
      } else if (this.cur() === T.THEX) { //loads hex code
        const n = num(true);
        if (n === null) return this.DoError();
        aToken.cMathChar = n.toString(16);
      }
      aToken.aText = this.m_aBufferString.slice(nBufferIndex, this.m_nBufferIndex);
      this.NextToken();
      return new SmFontNode(aToken);
    });
  }

  DoFont(): SmStructureNode {
    return this.depth(() => {
      // last font rules, get that one
      let aToken = new SmToken();
      do {
        this.NextToken();
        if (this.TokenInGroup(TG.Font)) {
          aToken = this.tok();
          this.NextToken();
        } else return this.DoError();
      } while (this.cur() === T.TFONT);
      return new SmFontNode(aToken);
    });
  }

  DoFontSize(): SmStructureNode {
    return this.depth(() => {
      const pFontNode = new SmFontNode(this.tok());
      this.NextTokenFontSize();
      let Type: FontSizeType;
      switch (this.m_aCurToken.eType) {
        case T.THEX: Type = FontSizeType.ABSOLUT; break;
        case T.TPLUS: Type = FontSizeType.PLUS; break;
        case T.TMINUS: Type = FontSizeType.MINUS; break;
        case T.TMULTIPLY: Type = FontSizeType.MULTIPLY; break;
        case T.TDIVIDEBY: Type = FontSizeType.DIVIDE; break;
        default: return this.DoError();
      }
      if (Type !== FontSizeType.ABSOLUT) {
        this.NextTokenFontSize();
        if (this.cur() !== T.THEX) return this.DoError();
      }
      // get number argument
      let aValue = 1;
      if (lcl_IsNumber(this.m_aCurToken.aText)) aValue = parseFloat(this.m_aCurToken.aText);
      else return this.DoError();
      pFontNode.SetSizeParameter(aValue, Type);
      this.NextToken();
      return pFontNode;
    });
  }

  DoBrace(): SmNode {
    return this.depth(() => {
      const xSNode = new SmBraceNode(this.tok());
      let pBody: SmNode | null = null, pLeft: SmNode | null = null, pRight: SmNode | null = null;
      let eScaleMode: SmScaleMode = SmScaleMode.None;
      let bError = false;
      if (this.cur() === T.TLEFT) {
        this.NextToken();
        eScaleMode = SmScaleMode.Height;
        // check for left bracket
        if (this.TokenInGroup(TG.LBrace) || this.TokenInGroup(TG.RBrace)) {
          pLeft = new SmMathSymbolNode(this.tok());
          this.NextToken();
          pBody = this.DoBracebody(true);
          if (this.cur() === T.TRIGHT) {
            this.NextToken();
            // check for right bracket
            if (this.TokenInGroup(TG.LBrace) || this.TokenInGroup(TG.RBrace)) {
              pRight = new SmMathSymbolNode(this.tok());
              this.NextToken();
            } else bError = true;
          } else bError = true;
        } else bError = true;
      } else {
        pLeft = new SmMathSymbolNode(this.tok());
        this.NextToken();
        pBody = this.DoBracebody(false);
        let eExpectedType: SmTokenType = T.TUNKNOWN;
        switch (pLeft.GetToken().eType) {
          case T.TLPARENT: eExpectedType = T.TRPARENT; break;
          case T.TLBRACKET: eExpectedType = T.TRBRACKET; break;
          case T.TLBRACE: eExpectedType = T.TRBRACE; break;
          case T.TLDBRACKET: eExpectedType = T.TRDBRACKET; break;
          case T.TLLINE: eExpectedType = T.TRLINE; break;
          case T.TLDLINE: eExpectedType = T.TRDLINE; break;
          case T.TLANGLE: eExpectedType = T.TRANGLE; break;
          case T.TLFLOOR: eExpectedType = T.TRFLOOR; break;
          case T.TLCEIL: eExpectedType = T.TRCEIL; break;
          case T.TLRLINE: eExpectedType = T.TLRLINE; break;
          case T.TLRDLINE: eExpectedType = T.TLRDLINE; break;
          default: break;
        }
        if (this.cur() === eExpectedType) {
          pRight = new SmMathSymbolNode(this.tok());
          this.NextToken();
        } else bError = true;
      }
      if (!bError) {
        xSNode.SetSubNodes(pLeft, pBody, pRight);
        xSNode.SetScaleMode(eScaleMode);
        return xSNode;
      }
      return this.DoError();
    });
  }

  DoBracebody(bIsLeftRight: boolean): SmBracebodyNode {
    return this.depth(() => {
      const pBody = new SmBracebodyNode(this.tok());
      const aNodes: (SmNode | null)[] = [];
      // get body if any
      const closing = () => (bIsLeftRight ? this.cur() === T.TRIGHT : this.TokenInGroup(TG.RBrace));
      do {
        if (this.cur() === T.TMLINE) {
          aNodes.push(new SmMathSymbolNode(this.tok()));
          this.NextToken();
        } else if (!closing()) {
          aNodes.push(this.DoAlign());
          if (this.cur() !== T.TMLINE && !closing()) aNodes.push(this.DoError());
        }
      } while (this.cur() !== T.TEND && !closing());
      pBody.SetSubNodes(aNodes);
      pBody.SetScaleMode(bIsLeftRight ? SmScaleMode.Height : SmScaleMode.None);
      return pBody;
    });
  }

  DoEvaluate(): SmNode {
    return this.depth(() => {
      // Create node
      const xSNode = new SmBraceNode(this.tok());
      const aToken = new SmToken(T.TRLINE, MS_VERTLINE, 'evaluate', TG.RBrace, 5);
      // Parse body && left none
      this.NextToken();
      const pBody = this.DoPower();
      const bToken = new SmToken(T.TNONE, 0, '', TG.LBrace, 5);
      const pLeft = new SmMathSymbolNode(bToken);
      // Mount nodes
      const pRight = new SmMathSymbolNode(aToken);
      xSNode.SetSubNodes(pLeft, pBody, pRight);
      xSNode.SetScaleMode(SmScaleMode.Height); // scalable line
      // Parse from to
      if (this.m_aCurToken.nGroup === TG.Limit) {
        const rSNode = this.DoSubSupEvaluate(xSNode);
        rSNode.GetToken().eType = T.TEVALUATE;
        return rSNode;
      }
      return xSNode;
    });
  }

  DoFunction(): SmTextNode {
    return this.depth(() => {
      if (this.cur() === T.TFUNC) {
        this.NextToken(); // skip "FUNC"-statement
        this.m_aCurToken.eType = T.TFUNC;
        this.m_aCurToken.nGroup = TG.Function;
      }
      const pNode = new SmTextNode(this.tok(), FNT_FUNCTION);
      this.NextToken();
      return pNode;
    });
  }

  DoBinom(): SmTableNode {
    return this.depth(() => {
      const xSNode = new SmTableNode(this.tok());
      this.NextToken();
      const xFirst = this.DoSum();
      const xSecond = this.DoSum();
      xSNode.SetSubNodes(xFirst, xSecond);
      return xSNode;
    });
  }

  DoFrac(): SmBinVerNode {
    return this.depth(() => {
      const xSNode = new SmBinVerNode(this.tok());
      const xOper = new SmRectangleNode(this.tok());
      this.NextToken();
      const xFirst = this.DoSum();
      const xSecond = this.DoSum();
      xSNode.SetSubNodes(xFirst, xOper, xSecond);
      return xSNode;
    });
  }

  DoStack(): SmNode {
    return this.depth(() => {
      const xSNode = new SmTableNode(this.tok());
      this.NextToken();
      if (this.cur() !== T.TLGROUP) return this.DoError();
      const aExprArr: (SmNode | null)[] = [];
      do {
        this.NextToken();
        aExprArr.push(this.DoAlign());
      } while (this.cur() === T.TPOUND);
      if (this.cur() === T.TRGROUP) this.NextToken();
      else aExprArr.push(this.DoError());
      xSNode.SetSubNodes(aExprArr);
      return xSNode;
    });
  }

  DoMatrix(): SmNode {
    return this.depth(() => {
      const xMNode = new SmMatrixNode(this.tok());
      this.NextToken();
      if (this.cur() !== T.TLGROUP) return this.DoError();
      const aExprArr: (SmNode | null)[] = [];
      do {
        this.NextToken();
        aExprArr.push(this.DoAlign());
      } while (this.cur() === T.TPOUND);
      let nCol = aExprArr.length;
      let nRow = 1;
      while (this.cur() === T.TDPOUND) {
        this.NextToken();
        for (let i = 0; i < nCol; i++) {
          let xNode = this.DoAlign();
          if (i < nCol - 1) {
            if (this.cur() === T.TPOUND) this.NextToken();
            else xNode = this.DoError();
          }
          aExprArr.push(xNode);
        }
        ++nRow;
      }
      if (this.cur() === T.TRGROUP) this.NextToken();
      else {
        const xENode = this.DoError();
        if (!aExprArr.length) nRow = nCol = 1;
        else aExprArr.pop();
        aExprArr.push(xENode);
      }
      xMNode.SetSubNodes(aExprArr);
      xMNode.SetRowCol(nRow, nCol);
      return xMNode;
    });
  }

  DoSpecial(): SmSpecialNode {
    return this.depth(() => {
      // add symbol name to list of used symbols
      const aSymbolName = this.m_aCurToken.aText.slice(1);
      if (aSymbolName) this.m_aUsedSymbols.add(aSymbolName);
      const pNode = new SmSpecialNode(this.tok());
      this.NextToken();
      return pNode;
    });
  }

  DoGlyphSpecial(): SmGlyphSpecialNode {
    return this.depth(() => {
      const pNode = new SmGlyphSpecialNode(this.tok());
      this.NextToken();
      return pNode;
    });
  }

  DoError(): SmExpressionNode {
    return this.depth(() => {
      // Generate error node
      this.m_aCurToken.eType = T.TERROR;
      const xSNode = new SmExpressionNode(this.tok());
      const pErr = new SmErrorNode(this.tok());
      xSNode.SetSubNode(0, pErr);
      // Append error to the error list
      this.m_aErrDescList.push({ pNode: xSNode });
      this.NextToken();
      return xSNode;
    });
  }

  // end grammar

  Parse(rBuffer: string): SmTableNode {
    this.m_aUsedSymbols.clear();
    this.m_aBufferString = rBuffer.replace(/\r\n?/g, '\n');
    this.m_nBufferIndex = 0;
    this.m_nTokenIndex = 0;
    this.m_nRow = 0;
    this.m_nColOff = 0;
    this.m_aErrDescList = [];
    this.NextToken();
    return this.DoTable();
  }

  ParseExpression(rBuffer: string): SmNode {
    this.m_aBufferString = rBuffer.replace(/\r\n?/g, '\n');
    this.m_nBufferIndex = 0;
    this.m_nTokenIndex = 0;
    this.m_nRow = 0;
    this.m_nColOff = 0;
    this.m_aErrDescList = [];
    this.NextToken();
    return this.DoExpression();
  }

  GetError(): SmErrorDesc | null { return this.m_aErrDescList[0] ?? null; }
}
