// SPDX-License-Identifier: MPL-2.0
// org.xml.sax for the LanguageTool ports: not a port. DefaultHandler, Attributes and Locator as
// the Java SAX API has them, driven by the saxes npm package (SAXParse). Internal DTD entities
// (<!ENTITY name "value">, which LanguageTool's rule files use) are read from the DOCTYPE and
// expanded, as Java's parser does.
import { SaxesParser, type SaxesTag } from 'saxes';

/** org.xml.sax.Attributes */
export interface Attributes {
  getLength(): number;
  getQName(index: number): string;
  getLocalName(index: number): string;
  /** By qualified name or by index. */
  getValue(qNameOrIndex: string | number): string | null;
}

/** org.xml.sax.Locator */
export interface Locator {
  getLineNumber(): number;
  getColumnNumber(): number;
  getSystemId(): string | null;
}

export class SAXException extends Error {}

/** org.xml.sax.helpers.DefaultHandler: every event does nothing. */
export class DefaultHandler {
  setDocumentLocator(_locator: Locator): void {}
  startDocument(): void {}
  endDocument(): void {}
  startElement(_namespaceURI: string, _lName: string, _qName: string, _attrs: Attributes): void {}
  endElement(_namespaceURI: string, _sName: string, _qName: string): void {}
  /** characters(char[] buf, int offset, int len): here the text with its offset and length. */
  characters(_buf: string, _offset: number, _len: number): void {}
  warning(_e: SAXException): void {}
  error(_e: SAXException): void {}
  fatalError(e: SAXException): void { throw e; }
}

class AttributesImpl implements Attributes {
  private readonly names: string[];
  private readonly values: Record<string, string>;
  constructor(attrs: Record<string, string>) {
    this.values = attrs;
    this.names = Object.keys(attrs);
  }
  getLength(): number { return this.names.length; }
  getQName(index: number): string { return this.names[index] ?? ''; }
  getLocalName(index: number): string { return (this.names[index] ?? '').replace(/^.*:/, ''); }
  getValue(key: string | number): string | null {
    const name = typeof key === 'number' ? this.names[key] : key;
    return name !== undefined && Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name]! : null;
  }
}

/** The internal subset's general entities, with references between them expanded. */
function parseEntities(doctype: string): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const m of doctype.matchAll(/<!ENTITY\s+([^\s%]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) raw[m[1]!] ??= m[2] ?? m[3] ?? '';
  const done: Record<string, string> = {};
  const expand = (name: string, depth = 0): string => {
    if (done[name] !== undefined) return done[name]!;
    const v = (raw[name] ?? '').replace(/&([\w.-]+);/g, (all, n: string) => (raw[n] !== undefined && depth < 20 ? expand(n, depth + 1) : all))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
    return (done[name] = v);
  };
  for (const n of Object.keys(raw)) expand(n);
  return done;
}

/** SAXParser.parse(InputStream, DefaultHandler): parses an XML document (text) with a handler. */
export function SAXParse(xml: string, handler: DefaultHandler, systemId: string | null = null): void {
  const parser = new SaxesParser({ position: true });
  const locator: Locator = { getLineNumber: () => parser.line, getColumnNumber: () => parser.column, getSystemId: () => systemId };
  handler.setDocumentLocator(locator);
  parser.on('doctype', (doctype) => { Object.assign(parser.ENTITIES, parseEntities(doctype)); });
  parser.on('opentag', (tag: SaxesTag) => {
    handler.startElement('', tag.local ?? tag.name, tag.name, new AttributesImpl(tag.attributes as Record<string, string>) /* no xmlns option: plain strings */);
  });
  parser.on('closetag', (tag: SaxesTag) => { handler.endElement('', tag.local ?? tag.name, tag.name); });
  parser.on('text', (text) => { handler.characters(text, 0, text.length); });
  parser.on('cdata', (text) => { handler.characters(text, 0, text.length); });
  parser.on('error', (e) => { handler.fatalError(new SAXException(`${systemId ?? ''}:${parser.line}:${parser.column}: ${e.message}`)); });
  handler.startDocument();
  parser.write(xml.charCodeAt(0) === 0xFEFF ? xml.slice(1) : xml).close();
  handler.endDocument();
}
