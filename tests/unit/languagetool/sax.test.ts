import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DefaultHandler, SAXParse, type Attributes } from '../../../src/languagetool/jdk/org/xml/sax/DefaultHandler.ts';

class Counter extends DefaultHandler {
  rules = 0; tokens: string[] = []; inToken = false; text = '';
  override startElement(_ns: string, _l: string, q: string, attrs: Attributes): void {
    if (q === 'rule') this.rules++;
    if (q === 'token') { this.inToken = true; this.text = ''; void attrs.getValue('regexp'); }
  }
  override endElement(_ns: string, _l: string, q: string): void { if (q === 'token') { this.inToken = false; this.tokens.push(this.text); } }
  override characters(buf: string, offset: number, len: number): void { if (this.inToken) this.text += buf.slice(offset, offset + len); }
}

describe('SAX for the LanguageTool ports', () => {
  it('expands internal DTD entities', () => {
    const h = new Counter();
    SAXParse('<!DOCTYPE rules [ <!ENTITY a "x|&b;"> <!ENTITY b "y"> ]><rules><rule><token>&a;z</token></rule></rules>', h);
    expect(h.tokens).toEqual(['x|yz']);
  });
  const grammar = 'upstream/languagetool/languagetool/languagetool-language-modules/en/src/main/resources/org/languagetool/rules/en/grammar.xml';
  it.skipIf(!existsSync(grammar))('reads the English grammar rules', () => {
    const h = new Counter();
    const t = performance.now();
    SAXParse(readFileSync(grammar, 'utf8'), h);
    expect(h.rules).toBeGreaterThan(5000);
    expect(h.tokens.filter((s) => /&[a-z_]+;/.test(s))).toEqual([]);
    console.log(`grammar.xml: ${h.rules} rules, ${h.tokens.length} tokens, ${(performance.now() - t).toFixed(0)} ms`);
  });
});
