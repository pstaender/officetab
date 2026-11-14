// SPDX-License-Identifier: MPL-2.0
// java.util.Properties for the LanguageTool ports: not a port, the part of the JDK's API they use.
// load() reads the ISO 8859-1 .properties format: logical lines continued by a trailing
// backslash, # and ! comments, = : or whitespace between key and value, and \uXXXX escapes.

export class Properties {
  private readonly m_aMap = new Map<string, string>();

  getProperty(key: string, defaultValue?: string): string | null {
    return this.m_aMap.get(key) ?? defaultValue ?? null;
  }

  setProperty(key: string, value: string): string | null {
    const old = this.m_aMap.get(key) ?? null;
    this.m_aMap.set(key, value);
    return old;
  }

  /** Hashtable.put (Properties extends Hashtable<Object,Object>). */
  put(key: string, value: string): string | null { return this.setProperty(key, value); }

  stringPropertyNames(): Set<string> { return new Set(this.m_aMap.keys()); }

  /** load(InputStream): the bytes are ISO 8859-1. A string is taken as already decoded (load(Reader)). */
  load(input: Uint8Array | string): void {
    let text: string;
    if (typeof input === 'string') text = input;
    else { text = ''; for (let i = 0; i < input.length; i += 8192) text += String.fromCharCode.apply(null, input.subarray(i, i + 8192) as unknown as number[]); }
    const lines = text.split(/\r\n|\r|\n/);
    for (let li = 0; li < lines.length; li++) {
      let line = lines[li].replace(/^[ \t\f]+/, '');
      if (line === '' || line[0] === '#' || line[0] === '!') continue;
      // join continuation lines: an odd number of trailing backslashes
      while (/(^|[^\\])(\\\\)*\\$/.test(line) && li + 1 < lines.length) {
        line = line.slice(0, -1) + lines[++li].replace(/^[ \t\f]+/, '');
      }
      let k = 0;
      let key = '';
      for (; k < line.length; k++) {
        const c = line[k];
        if (c === '\\') { key += line.slice(k, k + 2); k++; continue; }
        if (c === '=' || c === ':' || c === ' ' || c === '\t' || c === '\f') break;
        key += c;
      }
      let rest = line.slice(k).replace(/^[ \t\f]*/, '');
      if (rest[0] === '=' || rest[0] === ':') rest = rest.slice(1).replace(/^[ \t\f]*/, '');
      this.m_aMap.set(unescape(key), unescape(rest));
    }
  }
}

function unescape(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) => {
    switch (e[0]) {
      case 'u': return e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : e;
      case 't': return '\t';
      case 'n': return '\n';
      case 'r': return '\r';
      case 'f': return '\f';
      default: return e;
    }
  });
}
