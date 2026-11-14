import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { Pattern, StringReplaceAll, StringSplit } from '../../../src/languagetool/jdk/java/util/regex/Pattern.ts';

describe('java.util.regex for the LanguageTool ports', () => {
  it('matches the whole input with matches() and searches with find()', () => {
    const p = Pattern.compile('a+b');
    expect(p.matcher('aab').matches()).toBe(true);
    expect(p.matcher('xaab').matches()).toBe(false);
    const m = p.matcher('ab xaab');
    expect(m.find()).toBe(true);
    expect([m.start(), m.end(), m.group()]).toEqual([0, 2, 'ab']);
    expect(m.find()).toBe(true);
    expect([m.start(), m.end()]).toEqual([4, 7]);
    expect(m.find()).toBe(false);
  });
  it('reads Java syntax: possessive quantifiers, inline flags, POSIX classes, \\Q..\\E', () => {
    expect(Pattern.matches('a++b', 'aab')).toBe(true);
    expect(Pattern.matches('a++a', 'aa')).toBe(false); // possessive gives nothing back
    expect(Pattern.matches('(?iu)straße', 'STRASSE')).toBe(false);
    expect(Pattern.matches('(?iu)ärger', 'ÄRGER')).toBe(true);
    expect(Pattern.matches('(?i)a(?-i)B', 'AB')).toBe(true);
    expect(Pattern.matches('(?i)a(?-i)B', 'Ab')).toBe(false);
    expect(Pattern.matches('\\p{Punct}+', '!?.')).toBe(true);
    expect(Pattern.matches('\\p{Punct}', '„')).toBe(false); // US-ASCII, as in Java
    expect(Pattern.matches('[\\p{Punct}x]+', 'x!')).toBe(true);
    expect(Pattern.matches('\\p{IsAlphabetic}+', 'Äb')).toBe(true);
    expect(Pattern.matches('\\Q1.5\\E', '1.5')).toBe(true);
    expect(Pattern.matches('\\Q1.5\\E', '125')).toBe(false);
    expect(Pattern.matches('\\d', '٣')).toBe(false); // ASCII digits, as in Java
    expect(Pattern.matches('(?s)a.b', 'a\nb')).toBe(true);
    expect(Pattern.matches('a.b', 'a\nb')).toBe(false);
  });
  it('replaces with Java replacement strings and splits as Java does', () => {
    expect(StringReplaceAll('John Smith', '(\\w+) (\\w+)', '$2, $1')).toBe('Smith, John');
    expect(StringReplaceAll('a.b', '\\.', '\\$')).toBe('a$b');
    expect(StringSplit('a,b,,', ',')).toEqual(['a', 'b']);
    expect(StringSplit(',a', ',')).toEqual(['', 'a']);
    expect(StringSplit('abc', '')).toEqual(['a', 'b', 'c']);
  });
  it('gives group positions', () => {
    const m = Pattern.compile('(a)(b)?c').matcher('xac');
    expect(m.find()).toBe(true);
    expect([m.start(1), m.end(1), m.start(2), m.group(2)]).toEqual([1, 2, -1, null]);
  });
  const rules = 'upstream/languagetool/languagetool/languagetool-language-modules/en/src/main/resources/org/languagetool';
  it.skipIf(!existsSync(rules))('compiles every regular expression of the English rules', () => {
    const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const pats = new Set<string>();
    for (const f of ['rules/en/grammar.xml', 'rules/en/style.xml', 'resource/en/disambiguation.xml']) {
      const xml = readFileSync(`${rules}/${f}`, 'utf8');
      for (const m of xml.matchAll(/<token\b([^>]*)>([^<]*)<\/token>/g)) if (/regexp="yes"/.test(m[1]!)) pats.add(dec(m[2]!));
      for (const m of xml.matchAll(/<regexp\b[^>]*>([^<]*)<\/regexp>/g)) pats.add(dec(m[1]!));
    }
    const failed = [...pats].filter((p) => { try { Pattern.compile(p).matcher('').find(); return false; } catch { return true; } });
    expect(failed).toEqual([]);
  });
});
