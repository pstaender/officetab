// SPDX-License-Identifier: MPL-2.0
// java.util.Objects and Arrays.equals for the LanguageTool ports: not a port. Java objects with
// an equals method compare by it; everything else by identity or value.

export interface JavaEquals { equals(o: unknown): boolean }

const hasEquals = (o: unknown): o is JavaEquals => typeof o === 'object' && o !== null && typeof (o as JavaEquals).equals === 'function';

export function Objects_equals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (hasEquals(a)) return a.equals(b);
  return false;
}

export function Arrays_equals(a: readonly unknown[] | null | undefined, b: readonly unknown[] | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Objects_equals(a[i], b[i])) return false;
  return true;
}

export function Objects_requireNonNull<T>(o: T | null | undefined, message?: string): T {
  if (o == null) throw new TypeError(message ?? 'NullPointerException');
  return o;
}

/** List.contains / indexOf with equals. */
export const List_indexOf = (l: readonly unknown[], o: unknown): number => l.findIndex((x) => Objects_equals(x, o));
export const List_contains = (l: readonly unknown[], o: unknown): boolean => List_indexOf(l, o) >= 0;
