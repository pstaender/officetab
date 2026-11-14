// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/CommonFileTypes.java faithful
// The pattern is compiled on first use.
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';

const COMMON_FILE_TYPES: readonly string[] = [
  'jpeg', 'jpg', 'gif', 'png', 'bmp', 'svg', 'ai', 'sketch', 'ico', 'ps', 'psd', 'tiff', 'tif',
  'mp3', 'wav', 'midi', 'mid', 'aif', 'mpa', 'ogg', 'wma', 'wpl', 'cda',
  '7z', 'arj', 'deb', 'pkg', 'plist', 'rar', 'rpm', 'tar.gz', 'tar', 'zip',
  'bin', 'dmg', 'iso', 'toast', 'vcd', 'csv', 'dat', 'db', 'log', 'mdb', 'sav', 'sql', 'xml',
  'apk', 'bat', 'cgi', 'com', 'exe', 'gadget', 'jar', 'py', 'js', 'jsx', 'json', 'wsf', 'ts', 'tsx',
  'fnt', 'fon', 'otf', 'ttf', 'woff', 'woff2',
  'rb', 'java', 'php', 'html', 'asp', 'aspx', 'cer', 'cfm', 'cgi', 'pl', 'css', 'scss', 'htm', 'jsp', 'part', 'rss', 'xhtml',
  'key', 'odp', 'pps', 'ppt', 'pptx', 'class', 'cpp', 'cs', 'h', 'sh', 'swift', 'vb',
  'ods', 'odt', 'xlr', 'xls', 'xlsx', 'xlt', 'xltx', 'bak', 'cab', 'cfg', 'cpl', 'cur', 'dll', 'dmp', 'msi', 'ini', 'tmp',
  '3g2', '3gp', 'avi', 'flv', 'h264', 'm4v', 'mkv', 'mov', 'mp4', 'mpg', 'mpeg', 'rm', 'swf', 'vob', 'wmv',
  'doc', 'docx', 'dot', 'dotx', 'pdf', 'rtf', 'srx', 'text', 'tex', 'wks', 'wps', 'wpd', 'txt', 'yaml', 'yml', 'csl', 'md', 'adm', 'webm', 'webp',
];

let suffixPattern: Pattern | null = null;

/**
 * @since 5.4
 */
export class CommonFileTypes {

  static getSuffixPattern(): Pattern {
    return (suffixPattern ??=
      //Pattern.compile(".+\\.(" + String.join("|", COMMON_FILE_TYPES) + ")", Pattern.CASE_INSENSITIVE);
      Pattern.compile('[\\wáàâóòìíéèùúôîêûäöüß\\-.()]*?.+\\.(' + COMMON_FILE_TYPES.join('|') + ')', Pattern.CASE_INSENSITIVE));
  }

  private constructor() {}
}
