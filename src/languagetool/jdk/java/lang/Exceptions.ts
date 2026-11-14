// SPDX-License-Identifier: MPL-2.0
// Java exception classes for catch blocks: not a port. The ports throw
// Error('<ExceptionClass>: message'); these helpers tell the classes apart as Java's catch does.
import { PatternSyntaxException } from '../util/regex/Pattern.ts';

/** Whether e is an IllegalArgumentException or one of its subclasses (NumberFormatException, PatternSyntaxException). */
export function isIllegalArgumentException(e: unknown): boolean {
  return e instanceof PatternSyntaxException
    || (e instanceof Error && /^(IllegalArgumentException|NumberFormatException)\b/.test(e.message));
}

/** Integer.parseInt(s): a decimal int, else NumberFormatException (also for null). */
export function Integer_parseInt(s: string | null | undefined): number {
  if (s == null || !/^[+-]?\d+$/.test(s)) throw new Error('NumberFormatException: For input string: "' + s + '"');
  const n = parseInt(s, 10);
  if (n > 2147483647 || n < -2147483648) throw new Error('NumberFormatException: For input string: "' + s + '"');
  return n;
}

/** StringUtils.isNumeric (Apache Commons Lang): non-empty and only Unicode digits. */
export function StringUtils_isNumeric(cs: string | null | undefined): boolean {
  return cs != null && cs.length > 0 && /^\p{Nd}+$/u.test(cs);
}
