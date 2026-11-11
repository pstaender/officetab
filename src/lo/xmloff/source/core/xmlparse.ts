// SPDX-License-Identifier: MPL-2.0
// @upstream sax/source/fastparser/fastparser.cxx reduced
// @upstream xmloff/source/core/xmltkmap.cxx reduced
// Namespace-aware: element and attribute names are normalised to canonical ODF prefixes,
// whatever prefixes the producing application declared.

export interface XmlElement { name: string; attrs: Map<string, string>; children: (XmlElement | string)[] }

const CANONICAL: Record<string, string> = {
  'urn:oasis:names:tc:opendocument:xmlns:office:1.0': 'office',
  'urn:oasis:names:tc:opendocument:xmlns:text:1.0': 'text',
  'urn:oasis:names:tc:opendocument:xmlns:style:1.0': 'style',
  'urn:oasis:names:tc:opendocument:xmlns:table:1.0': 'table',
  'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0': 'draw',
  'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0': 'svg',
  'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0': 'fo',
  'urn:oasis:names:tc:opendocument:xmlns:meta:1.0': 'meta',
  'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0': 'number',
  'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0': 'manifest',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://www.w3.org/1999/xlink': 'xlink',
  'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0': 'loext',
  // Office Open XML, transitional and strict.
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'rel',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing': 'wp',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://purl.oclc.org/ooxml/drawingml/picture': 'pic',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'http://purl.oclc.org/ooxml/officeDocument/math': 'm',
};

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string): string =>
  s.includes('&')
    ? s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
        if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENT[e] ?? m;
      })
    : s;

export class XmlParseError extends Error {}

export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: new Map(), children: [] };
  const stack: { el: XmlElement; ns: Map<string, string>; raw: string }[] = [{ el: root, ns: new Map(), raw: '' }];
  const canon = (qname: string, ns: Map<string, string>, isAttr: boolean): string => {
    const i = qname.indexOf(':');
    if (i < 0) return isAttr ? qname : qname;
    const prefix = qname.slice(0, i);
    if (prefix === 'xml' || prefix === 'xmlns') return qname;
    const uri = ns.get(prefix);
    const c = uri && CANONICAL[uri];
    return c ? `${c}:${qname.slice(i + 1)}` : qname;
  };
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let lastEnd = 0;
  for (let m; (m = re.exec(src)); ) {
    if (m.index !== lastEnd) throw new XmlParseError(`Malformed XML near offset ${lastEnd}`);
    lastEnd = re.lastIndex;
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) { top.el.children.push(m[1]); continue; }
    if (m[6] !== undefined) { top.el.children.push(decode(m[6])); continue; }
    if (!m[3]) continue;
    if (m[2]) {
      if (top.raw !== m[3]) throw new XmlParseError(`Mismatched </${m[3]}>`);
      stack.pop();
      continue;
    }
    const raw: [string, string][] = [];
    const ns = new Map(top.ns);
    for (const a of m[4]!.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const value = decode(a[2] ?? a[3] ?? '');
      if (a[1]!.startsWith('xmlns:')) ns.set(a[1]!.slice(6), value);
      raw.push([a[1]!, value]);
    }
    const attrs = new Map<string, string>();
    for (const [k, v] of raw) attrs.set(canon(k, ns, true), v);
    const el: XmlElement = { name: canon(m[3], ns, false), attrs, children: [] };
    top.el.children.push(el);
    if (!m[5]) stack.push({ el, ns, raw: m[3] });
  }
  if (lastEnd !== src.length) throw new XmlParseError(`Malformed XML near offset ${lastEnd}`);
  if (stack.length !== 1) throw new XmlParseError('Unclosed element at end of document');
  return root;
}

export const childElements = (e: XmlElement): XmlElement[] => e.children.filter((c): c is XmlElement => typeof c !== 'string');
export const child = (e: XmlElement | undefined, name: string): XmlElement | undefined => e && childElements(e).find((c) => c.name === name);
export const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
