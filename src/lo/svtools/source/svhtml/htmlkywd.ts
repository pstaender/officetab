// SPDX-License-Identifier: MPL-2.0
// @upstream svtools/source/svhtml/htmlkywd.cxx partial
// The token, character entity and colour name tables, with GetHTMLToken, GetHTMLCharName and
// GetHTMLColor. The option table is not ported: options are looked up by name.
import { HtmlTokenId } from '../../../include/svtools/htmltokn.ts';

/** aHTMLTokenTab */
const aHTMLTokenTab: Record<string, HtmlTokenId> = {
  '!--': HtmlTokenId.COMMENT, '!DOCTYPE': HtmlTokenId.DOCTYPE, '![cdata[': HtmlTokenId.CDATA,
  'a': HtmlTokenId.ANCHOR_ON, 'abbrev': HtmlTokenId.ABBREVIATION_ON,
  'acronym': HtmlTokenId.ACRONYM_ON, 'address': HtmlTokenId.ADDRESS_ON,
  'applet': HtmlTokenId.APPLET_ON, 'area': HtmlTokenId.AREA, 'au': HtmlTokenId.AUTHOR_ON,
  'b': HtmlTokenId.BOLD_ON, 'banner': HtmlTokenId.BANNER_ON, 'base': HtmlTokenId.BASE,
  'basefont': HtmlTokenId.BASEFONT_ON, 'big': HtmlTokenId.BIGPRINT_ON, 'blink': HtmlTokenId.BLINK_ON,
  'blockquote': HtmlTokenId.BLOCKQUOTE_ON, 'body': HtmlTokenId.BODY_ON,
  'bq': HtmlTokenId.BLOCKQUOTE30_ON, 'br': HtmlTokenId.LINEBREAK, 'caption': HtmlTokenId.CAPTION_ON,
  'center': HtmlTokenId.CENTER_ON, 'cite': HtmlTokenId.CITATION_ON, 'code': HtmlTokenId.CODE_ON,
  'col': HtmlTokenId.COL_ON, 'colgroup': HtmlTokenId.COLGROUP_ON, 'comment': HtmlTokenId.COMMENT2_ON,
  'credit': HtmlTokenId.CREDIT_ON, 'dd': HtmlTokenId.DD_ON, 'del': HtmlTokenId.DELETEDTEXT_ON,
  'dfn': HtmlTokenId.DEFINSTANCE_ON, 'dir': HtmlTokenId.DIRLIST_ON, 'div': HtmlTokenId.DIVISION_ON,
  'dl': HtmlTokenId.DEFLIST_ON, 'dt': HtmlTokenId.DT_ON, 'em': HtmlTokenId.EMPHASIS_ON,
  'embed': HtmlTokenId.EMBED, 'fig': HtmlTokenId.FIGURE_ON, 'fn': HtmlTokenId.FOOTNOTE_ON,
  'font': HtmlTokenId.FONT_ON, 'form': HtmlTokenId.FORM_ON, 'frame': HtmlTokenId.FRAME_ON,
  'frameset': HtmlTokenId.FRAMESET_ON, 'h1': HtmlTokenId.HEAD1_ON, 'h2': HtmlTokenId.HEAD2_ON,
  'h3': HtmlTokenId.HEAD3_ON, 'h4': HtmlTokenId.HEAD4_ON, 'h5': HtmlTokenId.HEAD5_ON,
  'h6': HtmlTokenId.HEAD6_ON, 'head': HtmlTokenId.HEAD_ON, 'hr': HtmlTokenId.HORZRULE,
  'html': HtmlTokenId.HTML_ON, 'i': HtmlTokenId.ITALIC_ON, 'iframe': HtmlTokenId.IFRAME_ON,
  'img': HtmlTokenId.IMAGE, 'input': HtmlTokenId.INPUT, 'ins': HtmlTokenId.INSERTEDTEXT_ON,
  'kbd': HtmlTokenId.KEYBOARD_ON, 'lang': HtmlTokenId.LANGUAGE_ON, 'lh': HtmlTokenId.LISTHEADER_ON,
  'li': HtmlTokenId.LI_ON, 'link': HtmlTokenId.LINK, 'listing': HtmlTokenId.LISTING_ON,
  'map': HtmlTokenId.MAP_ON, 'marquee': HtmlTokenId.MARQUEE_ON, 'menu': HtmlTokenId.MENULIST_ON,
  'meta': HtmlTokenId.META, 'multicol': HtmlTokenId.MULTICOL_ON, 'nobr': HtmlTokenId.NOBR_ON,
  'noembed': HtmlTokenId.NOEMBED_ON, 'noframe': HtmlTokenId.NOFRAMES_ON,
  'noframes': HtmlTokenId.NOFRAMES_ON, 'noscript': HtmlTokenId.NOSCRIPT_ON,
  'note': HtmlTokenId.NOTE_ON, 'object': HtmlTokenId.OBJECT_ON, 'ol': HtmlTokenId.ORDERLIST_ON,
  'option': HtmlTokenId.OPTION, 'p': HtmlTokenId.PARABREAK_ON, 'param': HtmlTokenId.PARAM,
  'person': HtmlTokenId.PERSON_ON, 'plaintext': HtmlTokenId.PLAINTEXT2_ON,
  'pre': HtmlTokenId.PREFORMTXT_ON, 'q': HtmlTokenId.SHORTQUOTE_ON,
  's': HtmlTokenId.STRIKETHROUGH_ON, 'samp': HtmlTokenId.SAMPLE_ON, 'script': HtmlTokenId.SCRIPT_ON,
  'sdfield': HtmlTokenId.SDFIELD_ON, 'select': HtmlTokenId.SELECT_ON,
  'small': HtmlTokenId.SMALLPRINT_ON, 'spacer': HtmlTokenId.SPACER, 'span': HtmlTokenId.SPAN_ON,
  'strike': HtmlTokenId.STRIKE_ON, 'strong': HtmlTokenId.STRONG_ON, 'style': HtmlTokenId.STYLE_ON,
  'sub': HtmlTokenId.SUBSCRIPT_ON, 'sup': HtmlTokenId.SUPERSCRIPT_ON, 't': HtmlTokenId.PLAINTEXT_ON,
  'table': HtmlTokenId.TABLE_ON, 'tbody': HtmlTokenId.TBODY_ON, 'td': HtmlTokenId.TABLEDATA_ON,
  'textarea': HtmlTokenId.TEXTAREA_ON, 'tfoot': HtmlTokenId.TFOOT_ON,
  'th': HtmlTokenId.TABLEHEADER_ON, 'thead': HtmlTokenId.THEAD_ON, 'title': HtmlTokenId.TITLE_ON,
  'tr': HtmlTokenId.TABLEROW_ON, 'tt': HtmlTokenId.TELETYPE_ON, 'u': HtmlTokenId.UNDERLINE_ON,
  'ul': HtmlTokenId.UNORDERLIST_ON, 'var': HtmlTokenId.VARIABLE_ON, 'xmp': HtmlTokenId.XMP_ON,
};

const aHTMLTokenTabLower = new Map(Object.entries(aHTMLTokenTab).map(([k, v]) => [k.toLowerCase(), v]));

/** GetHTMLToken: the token of a tag name (lower case), NONE if it is not known. */
export function GetHTMLToken(rName: string): HtmlTokenId {
  if (rName.startsWith("!--")) return HtmlTokenId.COMMENT;
  // The table is searched ignoring case (its DOCTYPE is in capitals).
  return aHTMLTokenTabLower.get(rName.toLowerCase()) ?? HtmlTokenId.NONE;
}

/** aHTMLCharNameTab */
const aHTMLCharNameTab: Record<string, number> = {
  'AElig': 198, 'Aacute': 193, 'Acirc': 194, 'Agrave': 192, 'Alpha': 913, 'Aring': 197,
  'Atilde': 195, 'Auml': 196, 'Beta': 914, 'Ccedil': 199, 'Chi': 935, 'Dagger': 8225, 'Delta': 916,
  'ETH': 208, 'Eacute': 201, 'Ecirc': 202, 'Egrave': 200, 'Epsilon': 917, 'Eta': 919, 'Euml': 203,
  'Gamma': 915, 'Iacute': 205, 'Icirc': 206, 'Igrave': 204, 'Iota': 921, 'Iuml': 207, 'Kappa': 922,
  'Lambda': 923, 'Mu': 924, 'Ntilde': 209, 'Nu': 925, 'OElig': 338, 'Oacute': 211, 'Ocirc': 212,
  'Ograve': 210, 'Omega': 937, 'Omicron': 927, 'Oslash': 216, 'Otilde': 213, 'Ouml': 214, 'Phi': 934,
  'Pi': 928, 'Prime': 8243, 'Psi': 936, 'Rho': 929, 'Scaron': 352, 'Sigma': 931, 'THORN': 222,
  'Tau': 932, 'Theta': 920, 'Uacute': 218, 'Ucirc': 219, 'Ugrave': 217, 'Upsilon': 933, 'Uuml': 220,
  'Xi': 926, 'Yacute': 221, 'Yuml': 376, 'Zeta': 918, 'aacute': 225, 'acirc': 226, 'acute': 180,
  'aelig': 230, 'agrave': 224, 'alefsym': 8501, 'alpha': 945, 'amp': 38, 'and': 8743, 'ang': 8736,
  'apos': 39, 'aring': 229, 'atilde': 227, 'auml': 228, 'bdquo': 8222, 'beta': 946, 'brvbar': 166,
  'bull': 8226, 'cap': 8745, 'ccedil': 231, 'cedil': 184, 'cent': 162, 'chi': 967, 'circ': 710,
  'clubs': 9827, 'cong': 8773, 'copy': 169, 'crarr': 8629, 'cup': 8746, 'curren': 164, 'dArr': 8659,
  'dagger': 8224, 'darr': 8595, 'deg': 176, 'delta': 948, 'diams': 9830, 'divide': 247,
  'eacute': 233, 'ecirc': 234, 'egrave': 232, 'empty': 8709, 'emsp': 8195, 'ensp': 8194,
  'epsilon': 949, 'equiv': 8801, 'eta': 951, 'eth': 240, 'euml': 235, 'euro': 8364, 'exist': 8707,
  'fnof': 402, 'forall': 8704, 'frac12': 189, 'frac14': 188, 'frac34': 190, 'frasl': 8260,
  'gamma': 947, 'ge': 8805, 'gt': 62, 'hArr': 8660, 'harr': 8596, 'hearts': 9829, 'hellip': 8230,
  'iacute': 237, 'icirc': 238, 'iexcl': 161, 'igrave': 236, 'image': 8465, 'infin': 8734,
  'int': 8747, 'iota': 953, 'iquest': 191, 'isin': 8712, 'iuml': 239, 'kappa': 954, 'lArr': 8656,
  'lambda': 955, 'lang': 9001, 'laquo': 171, 'larr': 8592, 'lceil': 8968, 'ldquo': 8220, 'le': 8804,
  'lfloor': 8970, 'lowast': 8727, 'loz': 9674, 'lrm': 8206, 'lsaquo': 8249, 'lsquo': 8216, 'lt': 60,
  'macr': 175, 'mdash': 8212, 'micro': 181, 'middot': 183, 'minus': 8722, 'mu': 956, 'nabla': 8711,
  'nbsp': 1, 'ndash': 8211, 'ne': 8800, 'ni': 8715, 'not': 172, 'notin': 8713, 'nsub': 8836,
  'ntilde': 241, 'nu': 957, 'oacute': 243, 'ocirc': 244, 'oelig': 339, 'ograve': 242, 'oline': 8254,
  'omega': 969, 'omicron': 959, 'oplus': 8853, 'or': 8744, 'ordf': 170, 'ordm': 186, 'oslash': 248,
  'otilde': 245, 'otimes': 8855, 'ouml': 246, 'para': 182, 'part': 8706, 'permil': 8240,
  'perp': 8869, 'phi': 966, 'pi': 960, 'piv': 982, 'plusmn': 177, 'pound': 163, 'prime': 8242,
  'prod': 8719, 'prop': 8733, 'psi': 968, 'quot': 34, 'rArr': 8658, 'radic': 8730, 'rang': 9002,
  'raquo': 187, 'rarr': 8594, 'rceil': 8969, 'rdquo': 8221, 'real': 8476, 'reg': 174, 'rfloor': 8971,
  'rho': 961, 'rlm': 8207, 'rsaquo': 8250, 'rsquo': 8217, 'sbquo': 8218, 'scaron': 353, 'sdot': 8901,
  'sect': 167, 'shy': 2, 'sigma': 963, 'sigmaf': 962, 'sim': 8764, 'spades': 9824, 'sub': 8834,
  'sube': 8838, 'sum': 8721, 'sup': 8835, 'sup1': 185, 'sup2': 178, 'sup3': 179, 'supe': 8839,
  'szlig': 223, 'tau': 964, 'there4': 8756, 'theta': 952, 'thetasym': 977, 'thinsp': 8201,
  'thorn': 254, 'tilde': 732, 'times': 215, 'trade': 8482, 'uArr': 8657, 'uacute': 250, 'uarr': 8593,
  'ucirc': 251, 'ugrave': 249, 'uml': 168, 'upsih': 978, 'upsilon': 965, 'uuml': 252, 'weierp': 8472,
  'xi': 958, 'yacute': 253, 'yen': 165, 'yuml': 255, 'zeta': 950, 'zwj': 8205, 'zwnj': 8204,
};

/** GetHTMLCharName: the character of an entity name, 0 if there is none. */
export function GetHTMLCharName(rName: string): number {
  return Object.hasOwn(aHTMLCharNameTab, rName) ? aHTMLCharNameTab[rName]! : 0;
}

/** aHTMLColorNameTab */
const aHTMLColorNameTab: Record<string, number> = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4, azure: 0xf0ffff,
  beige: 0xf5f5dc, bisque: 0xffe4c4, black: 0x000000, blanchedalmond: 0xffebcd, blue: 0x0000ff,
  blueviolet: 0x8a2be2, brown: 0xa52a2a, burlywood: 0xdeb887, cadetblue: 0x5f9ea0,
  chartreuse: 0x7fff00, chocolate: 0xd2691e, coral: 0xff7f50, cornflowerblue: 0x6495ed,
  cornsilk: 0xfff8dc, crimson: 0xdc143c, cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9, darkgreen: 0x006400, darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f, darkorange: 0xff8c00, darkorchid: 0x9932cc,
  darkred: 0x8b0000, darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f, darkslateblue: 0x483d8b,
  darkslategray: 0x2f4f4f, darkturquoise: 0x00ced1, darkviolet: 0x9400d3, deeppink: 0xff1493,
  deepskyblue: 0x00bfff, dimgray: 0x696969, dodgerblue: 0x1e90ff, firebrick: 0xb22222,
  floralwhite: 0xfffaf0, forestgreen: 0x228b22, fuchsia: 0xff00ff, gainsboro: 0xdcdcdc,
  ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080, green: 0x008000,
  greenyellow: 0xadff2f, honeydew: 0xf0fff0, hotpink: 0xff69b4, indianred: 0xcd5c5c,
  indigo: 0x4b0082, ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa, lavenderblush: 0xfff0f5,
  lawngreen: 0x7cfc00, lemonchiffon: 0xfffacd, lightblue: 0xadd8e6, lightcoral: 0xf08080,
  lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2, lightgreen: 0x90ee90, lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1, lightsalmon: 0xffa07a, lightseagreen: 0x20b2aa, lightskyblue: 0x87cefa,
  lightslategray: 0x778899, lightsteelblue: 0xb0c4de, lightyellow: 0xffffe0, lime: 0x00ff00,
  limegreen: 0x32cd32, linen: 0xfaf0e6, magenta: 0xff00ff, maroon: 0x800000,
  mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd, mediumorchid: 0xba55d3, mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee, mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc, mediumvioletred: 0xc71585, midnightblue: 0x191970, mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1, moccasin: 0xffe4b5, navajowhite: 0xffdead, navy: 0x000080, oldlace: 0xfdf5e6,
  olive: 0x808000, olivedrab: 0x6b8e23, orange: 0xffa500, orangered: 0xff4500, orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa, palegreen: 0x98fb98, paleturquoise: 0xafeeee, palevioletred: 0xdb7093,
  papayawhip: 0xffefd5, peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd,
  powderblue: 0xb0e0e6, purple: 0x800080, red: 0xff0000, rosybrown: 0xbc8f8f, royalblue: 0x4169e1,
  saddlebrown: 0x8b4513, salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57,
  seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd,
  slategray: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f, steelblue: 0x4682b4, tan: 0xd2b48c,
  teal: 0x008080, thistle: 0xd8bfd8, tomato: 0xff6347, turquoise: 0x40e0d0, violet: 0xee82ee,
  wheat: 0xf5deb3, white: 0xffffff, whitesmoke: 0xf5f5f5, yellow: 0xffff00, yellowgreen: 0x9acd32,
};

/** GetHTMLColor: the 24-bit colour of a colour name (not found = SAL_MAX_UINT32). */
export function GetHTMLColor(rName: string): number {
  const aLowerCaseName = rName.toLowerCase();
  return Object.hasOwn(aHTMLColorNameTab, aLowerCaseName) ? aHTMLColorNameTab[aLowerCaseName]! : 0xffffffff;
}
