// SPDX-License-Identifier: MPL-2.0
// The case-insensitive java.lang.String methods for the LanguageTool ports: not a port, the JDK's
// API as the ports use it. Java compares char by char, first after Character.toUpperCase, then
// after Character.toLowerCase of that (so that one char never becomes two, as with ß).
import { Character } from './Character.ts';

function charsEqualIgnoreCase(c1: string, c2: string): boolean {
  if (c1 === c2) return true;
  const u1 = Character.toUpperCase(c1), u2 = Character.toUpperCase(c2);
  if (u1 === u2) return true;
  return Character.toLowerCase(u1) === Character.toLowerCase(u2);
}

/** String.regionMatches(ignoreCase, toffset, other, ooffset, len) */
export function StringRegionMatches(s: string, ignoreCase: boolean, toffset: number, other: string, ooffset: number, len: number): boolean {
  if (ooffset < 0 || toffset < 0 || toffset > s.length - len || ooffset > other.length - len) return false;
  for (let i = 0; i < len; i++) {
    const c1 = s.charAt(toffset + i), c2 = other.charAt(ooffset + i);
    if (c1 === c2) continue;
    if (!ignoreCase || !charsEqualIgnoreCase(c1, c2)) return false;
  }
  return true;
}

/** String.equalsIgnoreCase */
export function StringEqualsIgnoreCase(s: string, other: string | null): boolean {
  return other != null && other.length === s.length && StringRegionMatches(s, true, 0, other, 0, s.length);
}

/** String.CASE_INSENSITIVE_ORDER */
export function String_CASE_INSENSITIVE_ORDER(s1: string, s2: string): number {
  const n1 = s1.length, n2 = s2.length, min = Math.min(n1, n2);
  for (let i = 0; i < min; i++) {
    let c1 = s1.charAt(i), c2 = s2.charAt(i);
    if (c1 !== c2) {
      c1 = Character.toUpperCase(c1);
      c2 = Character.toUpperCase(c2);
      if (c1 !== c2) {
        c1 = Character.toLowerCase(c1);
        c2 = Character.toLowerCase(c2);
        if (c1 !== c2) return c1.charCodeAt(0) - c2.charCodeAt(0);
      }
    }
  }
  return n1 - n2;
}
