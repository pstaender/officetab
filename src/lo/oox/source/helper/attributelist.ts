// SPDX-License-Identifier: MPL-2.0
// @upstream oox/source/helper/attributelist.cxx reduced
// AttributeList and AttributeConversion over the attribute map of a parsed element: strings,
// encoded strings (_xHHHH_), integers, hexadecimal integers, doubles and the boolean spellings of
// OOXML and VML. The token, date and colour conversions are left out.

const XSTRING_ENCCHAR_LEN = 7;

function lclAddHexDigit(cDigit: string): number {
  if (cDigit >= '0' && cDigit <= '9') return cDigit.charCodeAt(0) - 48;
  if (cDigit >= 'a' && cDigit <= 'f') return cDigit.charCodeAt(0) - 97 + 10;
  if (cDigit >= 'A' && cDigit <= 'F') return cDigit.charCodeAt(0) - 65 + 10;
  return -1;
}

/** AttributeConversion::decodeXString: "_x000D_" and the like become their character. */
export function decodeXString(rValue: string): string {
  // string shorter than one encoded character - no need to decode
  if (rValue.length < XSTRING_ENCCHAR_LEN) return rValue;
  const index = rValue.indexOf('_x');
  if (index === -1) return rValue;
  let aBuffer = rValue.slice(0, index);
  let i = index;
  while (i < rValue.length) {
    if (rValue.length - i >= XSTRING_ENCCHAR_LEN && rValue[i] === '_' && rValue[i + 1] === 'x' && rValue[i + 6] === '_') {
      const d = [2, 3, 4, 5].map((k) => lclAddHexDigit(rValue[i + k]!));
      if (d.every((x) => x >= 0)) {
        aBuffer += String.fromCharCode((d[0]! << 12) | (d[1]! << 8) | (d[2]! << 4) | d[3]!);
        i += XSTRING_ENCCHAR_LEN;
        continue;
      }
    }
    aBuffer += rValue[i++];
  }
  // sanitizeStringSurrogates: lone surrogates are dropped
  return aBuffer.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

/** The encoding of decodeXString for writing: control characters and "_x" sequences as _xHHHH_. */
export function encodeXString(rValue: string): string {
  return rValue.replace(/_(?=x[0-9A-Fa-f]{4}_)|[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);
}

export class AttributeList {
  private readonly mxAttribs: Map<string, string>;

  constructor(rAttribs: Map<string, string>) { this.mxAttribs = rAttribs; }

  hasAttribute(nAttrToken: string): boolean { return this.mxAttribs.has(nAttrToken); }

  getString(nAttrToken: string, rDefault?: string): string | undefined {
    return this.mxAttribs.get(nAttrToken) ?? rDefault;
  }

  getXString(nAttrToken: string, rDefault?: string): string | undefined {
    const v = this.mxAttribs.get(nAttrToken);
    return v === undefined ? rDefault : decodeXString(v);
  }

  getDouble(nAttrToken: string): number | undefined;
  getDouble(nAttrToken: string, fDefault: number): number;
  getDouble(nAttrToken: string, fDefault?: number): number | undefined {
    const v = this.mxAttribs.get(nAttrToken);
    if (v === undefined) return fDefault;
    const f = Number(v.trim());
    return v.trim() !== '' && Number.isFinite(f) ? f : fDefault;
  }

  getInteger(nAttrToken: string): number | undefined;
  getInteger(nAttrToken: string, nDefault: number): number;
  getInteger(nAttrToken: string, nDefault?: number): number | undefined {
    const v = this.mxAttribs.get(nAttrToken);
    if (v === undefined) return nDefault;
    const m = /^\s*[+-]?\d+/.exec(v);
    return m ? Math.max(-0x80000000, Math.min(0x7fffffff, parseInt(m[0], 10))) : nDefault;
  }

  getIntegerHex(nAttrToken: string, nDefault: number): number {
    const v = this.mxAttribs.get(nAttrToken);
    if (v === undefined) return nDefault;
    const n = parseInt(v, 16);
    return Number.isFinite(n) ? n >>> 0 : nDefault;
  }

  getBool(nAttrToken: string): boolean | undefined;
  getBool(nAttrToken: string, bDefault: boolean): boolean;
  getBool(nAttrToken: string, bDefault?: boolean): boolean | undefined {
    const pAttr = this.mxAttribs.get(nAttrToken);
    if (pAttr === undefined) return bDefault;
    // catch the common cases as quickly as possible first
    if (pAttr === 'false') return false;
    if (pAttr === 'true') return true;
    // boolean attributes may be "t", "f", "true", "false", "on", "off", "1", or "0"
    switch (pAttr) {
      case 't': case 'on': return true; // used in VML
      case 'f': case 'off': return false;
    }
    return (parseInt(pAttr, 10) || 0) !== 0;
  }

  /** getToken: the value as a token name (the attribute's string). */
  getToken(nAttrToken: string, nDefault: string): string {
    return this.mxAttribs.get(nAttrToken) ?? nDefault;
  }
}
