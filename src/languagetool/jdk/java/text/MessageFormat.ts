// SPDX-License-Identifier: MPL-2.0
// java.text.MessageFormat for the LanguageTool ports: not a port, the JDK's API as they use it.
// Arguments "{n}" and "{n,type,style}" (the type and style are ignored, except that numbers are
// formatted as NumberFormat.getInstance() does for English: grouping, up to 3 fraction digits),
// and Java's quoting: a single quote starts or ends a quoted section, two single quotes are one.
// null arguments print "null"; a missing argument prints "{n}", as Java does.

export class MessageFormat {
  private pattern: string;

  constructor(pattern: string) {
    this.pattern = pattern;
  }

  applyPattern(pattern: string): void { this.pattern = pattern; }

  toPattern(): string { return this.pattern; }

  /** MessageFormat.format(Object[] arguments) */
  format(args: readonly unknown[]): string {
    const p = this.pattern;
    let out = '';
    let inQuote = false;
    for (let i = 0; i < p.length; i++) {
      const c = p.charAt(i);
      if (c === "'") {
        if (i + 1 < p.length && p.charAt(i + 1) === "'") {
          out += "'";
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (c === '{' && !inQuote) {
        // find the closing brace (braces may nest inside a style, e.g. choice formats)
        let depth = 1;
        let j = i + 1;
        for (; j < p.length && depth > 0; j++) {
          if (p.charAt(j) === '{') depth++;
          else if (p.charAt(j) === '}') depth--;
        }
        if (depth > 0) throw new Error('IllegalArgumentException: Unmatched braces in the pattern.');
        const spec = p.substring(i + 1, j - 1);
        const indexStr = spec.split(',')[0]!.trim();
        if (!/^\d+$/.test(indexStr)) throw new Error("IllegalArgumentException: can't parse argument number: " + indexStr);
        const index = parseInt(indexStr, 10);
        if (index >= args.length) {
          out += '{' + index + '}';
        } else {
          out += MessageFormat.formatArg(args[index]);
        }
        i = j - 1;
      } else {
        out += c;
      }
    }
    return out;
  }

  private static formatArg(arg: unknown): string {
    if (arg === null || arg === undefined) return 'null';
    if (typeof arg === 'number' || typeof arg === 'bigint') {
      return arg.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }
    return String(arg);
  }

  /** MessageFormat.format(String pattern, Object... arguments) */
  static format(pattern: string, ...args: unknown[]): string {
    return new MessageFormat(pattern).format(args);
  }
}
