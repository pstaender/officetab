// SPDX-License-Identifier: MPL-2.0
// java.net.URLEncoder for the LanguageTool ports: not a port. application/x-www-form-urlencoded
// in UTF-8 as Java encodes it: letters, digits and ".-*_" stay, a space becomes "+", every other
// character its UTF-8 bytes as "%XX" (upper-case hex).

export const URLEncoder = {
  /** The charset is always UTF-8 here. */
  encode(s: string, _charset = 'utf-8'): string {
    return encodeURIComponent(s)
      .replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
      .replace(/%20/g, '+');
  },
};
