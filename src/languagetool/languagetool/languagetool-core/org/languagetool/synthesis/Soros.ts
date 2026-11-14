// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/synthesis/Soros.java faithful
// String.replace(CharSequence, CharSequence) is the literal replace() below (JavaScript's
// replaceAll would interpret "$" in the replacement); String.replaceAll/replaceFirst/split go
// through java.util.regex. The static func pattern is compiled on first use.
import { Pattern, StringReplaceAll, StringReplaceFirst, StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';

/** String.replace(CharSequence target, CharSequence replacement) */
function replace(s: string, target: string, replacement: string): string {
  return s.split(target).join(replacement);
}

const m = '\\";#';
const m2 = '$()|[]';
const c = '\uE000\uE001\uE002\uE003';
const c2 = '\uE004\uE005\uE006\uE007\uE008\uE009';
const slash = '\uE000';
const pipe = '\uE003';

// pattern to recognize function calls in the replacement string

let func: Pattern | null = null;
const getFunc = () => (func ??= Pattern.compile(translate(
      '(?:\\|?(?:\\$\\()+)?' +                // optional nested calls
      '(\\|?\\$\\(([^\\(\\)]*)\\)\\|?)' +     // inner call (2 subgroups)
      '(?:\\)+\\|?)?',                        // optional nested calls
      m2.substring(0, c.length), c, '\\'))); // \$, \(, \), \| -> \uE000..\uE003

function translate(s: string, chars: string, chars2: string, delim: string): string {
  for (let i = 0; i < chars.length; i++) {
      s = replace(s, delim + chars.charAt(i), '' + chars2.charAt(i));
  }
  return s;
}

/**
 * Soros interpreter (see http://numbertext.org)
 * @author Laszlo Nemeth
 */
export class Soros {
  private patterns: Pattern[] = [];
  private values: string[] = [];
  private begins: boolean[] = [];
  private ends: boolean[] = [];

  private numbertext = false;

  constructor(source: string, lang: string) {
    source = translate(source, m, c, '\\');      // \\, \", \;, \# -> \uE000..\uE003
    // switch off all country-dependent lines, and switch on the requested ones
    source = StringReplaceAll(StringReplaceAll(StringReplaceAll(source,
        '(^|[\n;])([^\n;#]*#[^\n]*\\[:[^\n:\\]]*:][^\n]*)', '$1#$2'),
        '(^|[\n;])#([^\n;#]*#[^\n]*\\[:' + lang.replaceAll('_', '-') + ':][^\n]*)', '$1$2'),
        '(#[^\n]*)?(\n|$)', ';');   // remove comments
    if (source.indexOf('__numbertext__') == -1)
        source = '__numbertext__;' + source;
    source = replace(source, '__numbertext__',
        // default left zero deletion
        '"([a-z][-a-z]* )?0+(0|[1-9]\\d*)" $(\\1\\2);' +
        // separator function
        '"\uE00A(.*)\uE00A(.+)\uE00A(.*)" \\1\\2\\3;' +
        // no separation, if subcall returns with empty string
        '"\uE00A.*\uE00A\uE00A.*"');

    const p = Pattern.compile('^\\s*("[^"]*"|[^\\s]*)\\s*(.*[^\\s])?\\s*$');
    const macro = Pattern.compile('== *(.*[^ ]?) ==');
    let prefix = '';
    for (let s of StringSplit(source, ';')) {
        const matchmacro = macro.matcher(s);
        if (matchmacro.matches()) {
            prefix = matchmacro.group(1)!;
            continue;
        }
        let sp = p.matcher(s);
        if (!(prefix === '') && !(s === '') && sp.matches()) {
            s = StringReplaceFirst(StringReplaceFirst(sp.group(1)!, '^"', ''), '"$', '');
            s = '"' + (s.startsWith('^') ? '^' : '') + prefix + (s === '' ? '' : ' ') +
                 StringReplaceFirst(s, '^\\^', '') + '" ' + sp.group(2);
            sp = p.matcher(s);
        }
        if (!(s === '') && sp.matches()) {
            s = translate(StringReplaceFirst(StringReplaceFirst(sp.group(1)!, '^"', ''), '"$', ''),
                c.substring(1), m.substring(1), '');
            s = replace(s, slash, '\\\\'); // -> \\, ", ;, #
            let s2 = '';
            if (sp.group(2) != null) s2 = StringReplaceFirst(StringReplaceFirst(sp.group(2)!, '^"', ''), '"$', '');
            s2 = translate(s2, m2, c2, '\\');   // \$, \(, \), \|, \[, \] -> \uE004..\uE009
            // call inner separator: [ ... $1 ... ] -> $(\uE00A ... \uE00A$1\uE00A ... )
            s2 = StringReplaceAll(s2, '^\\[[$](\\d\\d?|\\([^\\)]+\\))', '\\$(\uE00A\uE00A|\\$$1\uE00A'); // add "|"
            s2 = StringReplaceAll(s2, '\\[([^$\\[\\\\]*)[$](\\d\\d?|\\([^\\)]+\\))', '\\$(\uE00A$1\uE00A\\$$2\uE00A');
            s2 = StringReplaceAll(s2, '\uE00A\\]$', '|\uE00A)'); // add "|" in terminating position
            s2 = replace(s2, ']', ')');
            s2 = StringReplaceAll(s2, '(\\$\\d|\\))\\|\\$', '$1||\\$'); // $()|$() -> $()||$()
            s2 = translate(s2, c, m, '');       // \uE000..\uE003-> \, ", ;, #
            s2 = translate(s2, m2.substring(0, c.length), c, '');      // $, (, ), | -> \uE000..\uE003
            s2 = translate(s2, c2, m2, '');     // \uE004..\uE009 -> $, (, ), |, [, ]
            s2 = StringReplaceAll(s2, '[$]', '\\$');    // $ -> \$
            s2 = StringReplaceAll(s2, '\uE000(\\d)', '\uE000\uE001\\$$1\uE002'); // $n -> $(\n)
            s2 = StringReplaceAll(s2, '\\\\(\\d)', '\\$$1'); // \[n] -> $[n]
            s2 = replace(s2, '\\n', '\n');            // \n -> [new line]
            this.patterns.push(Pattern.compile('^' + StringReplaceFirst(StringReplaceFirst(s, '^\\^', ''),
                '\\$$', '') + '$'));
            this.begins.push(s.startsWith('^'));
            this.ends.push(s.endsWith('$'));
            this.values.push(s2);
        }
    }
  }

  /** run(input) and the private run(input, begin, end). */
  run(input: string, begin = true, end = true): string {
    for (let i = 0; i < this.patterns.length; i++) {
        if ((!begin && this.begins[i]) || (!end && this.ends[i])) continue;
        const m = this.patterns[i]!.matcher(input);
        if (!m.matches()) continue;
        let s = m.replaceAll(this.values[i]!);
        let n = getFunc().matcher(s);
        while (n.find()) {
            let b = false;
            let e = false;
            if (n.group(1)!.startsWith(pipe) || n.group()!.startsWith(pipe)) b = true;
            else if (n.start() == 0) b = begin;
            if (n.group(1)!.endsWith(pipe) || n.group()!.endsWith(pipe)) e = true;
            else if (n.end() == s.length) e = end;
            s = s.substring(0, n.start(1)) + this.run(n.group(2)!, b, e) + s.substring(n.end(1));
            n = getFunc().matcher(s);
        }
        return s;
    }
    return '';
  }
}
