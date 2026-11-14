// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/tokenizers/en/EnglishWordTokenizer.java faithful
// The static patterns are compiled on first use.
import { EnglishTagger } from '../../tagging/en/EnglishTagger.ts';
import { WordTokenizer } from '../../../../../../languagetool-core/org/languagetool/tokenizers/WordTokenizer.ts';
import { StringTokenizer } from '../../../../../../../jdk/java/util/StringTokenizer.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

// import static java.util.regex.Pattern.*
const compile = Pattern.compile;
const CASE_INSENSITIVE = Pattern.CASE_INSENSITIVE;
const UNICODE_CASE = Pattern.UNICODE_CASE;

const wordCharacters = '±§©@€£¥\\$\\p{L}\\d\\-̀-ͯ¨°%‰‱&�­¬，？'; // # _ \\u2070-\\u209f
// \\uFFOC -> rule NON_STANDARD_COMMA
// \\uFF1F -> rule NON_STANDARD_QUESTION_MARK

let patterns: {
  tokenizerPattern: Pattern; SINGLE_QUOTE: Pattern; CURLY_QUOTE: Pattern; APOSTYPEW: Pattern; APOSTYPOG: Pattern;
  SOFT_HYPHEN: Pattern; patternList: Pattern[];
} | null = null;
const P = () => (patterns ??= {
  tokenizerPattern: compile('[' + wordCharacters + ']+|[^' + wordCharacters + ']'),
  SINGLE_QUOTE: compile("'"),
  CURLY_QUOTE: compile('’'),
  APOSTYPEW: compile('xxAPOSTYPEWxx'),
  APOSTYPOG: compile('xxAPOSTYPOGxx'),
  SOFT_HYPHEN: compile('­'),
  patternList: [
    compile("^(fo['’]c['’]sle|rec['’][ds]|OK['’]d|cc['’][ds]|DJ['’][d]|[pd]m['’]d|rsvp['’]d)$", CASE_INSENSITIVE | UNICODE_CASE),
    compile(
        "^(['’]?)(are|is|were|was|do|does|did|have|has|had|wo|would|ca|could|sha|should|must|ai|ought|might|need|may|am|dare|das|dass|hai|used|use)(n['’]t)$",
        CASE_INSENSITIVE | UNICODE_CASE),
    compile("^(.+)(['’]m|['’]re|['’]ll|['’]ve|['’]d|['’]s)(['’-]?)$",
        CASE_INSENSITIVE | UNICODE_CASE),
    compile("^(['’]t)(was|were|is)$", CASE_INSENSITIVE | UNICODE_CASE)],
});

/**
 * @author Marcin Milkowski
 * @since 2.5
 */
export class EnglishWordTokenizer extends WordTokenizer {

  //the string used to tokenize characters
  private readonly enTokenizingChars = super.getTokenizingCharacters() + '_'; // underscore;

//  public EnglishWordTokenizer() {
//
//  }

  /**
   * Tokenizes text. The English tokenizer differs from the standard one in two
   * respects:
   * <ol>
   * <li>it does not treat the hyphen as part of the word if the hyphen is at the
   * end of the word;</li>
   * <li>it includes n-dash as a tokenizing character, as it is used without a
   * whitespace in English.
   * </ol>
   *
   * @param text String of words to tokenize.
   */
  override tokenize(text: string): string[] {
    const l: string[] = [];
    let auxText = text;
    auxText = P().SINGLE_QUOTE.matcher(auxText).replaceAll('xxAPOSTYPEWxx');
    auxText = P().CURLY_QUOTE.matcher(auxText).replaceAll('xxAPOSTYPOGxx');
    //auxText = auxText.replaceAll("-", "xxHYPHENxx");


    const tokenizerMatcher = P().tokenizerPattern.matcher(auxText);
    while (tokenizerMatcher.find()) {
      let s = tokenizerMatcher.group()!;
      if (l.length > 0 && s.length == 1 && s.codePointAt(0)! >= 0xFE00 && s.codePointAt(0)! <= 0xFE0F) {
        l[l.length - 1] = l[l.length - 1] + s;
        continue;
      }
      s = P().APOSTYPEW.matcher(s).replaceAll("'");
      s = P().APOSTYPOG.matcher(s).replaceAll('’');
          //.replaceAll("xxHYPHENxx", "-");
      let matchFound = false;
      let matcher = null;
      if (s.includes("'") || s.includes('’')) {
        for (const pattern of P().patternList) {
          matcher = pattern.matcher(s);
          matchFound = matcher.find();
          if (matchFound) {
            break;
          }
        }
      }
      if (matchFound) {
        for (let i = 1; i <= matcher!.groupCount(); i++) {
          const groupStr = matcher!.group(i)!;
          l.push(...this.wordsToAdd(groupStr));
        }
      } else {
        l.push(...this.wordsToAdd(s));
      }
    }
    return this.joinEMailsAndUrls(l);
  }

  /* Splits a word containing hyphen(-’') if it doesn't exist in the dictionary. */
  private wordsToAdd(s: string): string[] {
    const l: string[] = [];
    let hyphensAtEnd = 0;
    if (s.length !== 0) {
      while (s.startsWith('-')) {
        l.push('-');
        s = s.substring(1);
      }
      while (s.endsWith('-')) {
        s = s.substring(0, s.length - 1);
        hyphensAtEnd++;
      }
      if (s.length !== 0) {
        if (!s.includes('-') && !s.includes("'") && !s.includes('’')) {
          l.push(s);
        } else {
          let normalized = P().SOFT_HYPHEN.matcher(s).replaceAll('');
          normalized = P().CURLY_QUOTE.matcher(normalized).replaceAll("'");
          if (EnglishTagger.INSTANCE.tag([normalized])[0]!
              .isTagged()) {
            l.push(s);
          }
          // some camel-case words containing hyphen (is there any better fix?)
          else if (StringEqualsIgnoreCase(s, 'mers-cov') || StringEqualsIgnoreCase(s, 'mcgraw-hill')
              || StringEqualsIgnoreCase(s, 'sars-cov-2') || StringEqualsIgnoreCase(s, 'sars-cov') || StringEqualsIgnoreCase(s, 'ph-metre')
              || StringEqualsIgnoreCase(s, 'ph-metres') || StringEqualsIgnoreCase(s, 'anti-ivg') || StringEqualsIgnoreCase(s, 'anti-uv')
              || StringEqualsIgnoreCase(s, 'anti-vih') || StringEqualsIgnoreCase(s, 'al-qaida')) {
            l.push(s);
          } else {
            // if not found, the word is split
            // final StringTokenizer st2 = new StringTokenizer(s, "-’'", true);
            const st2 = new StringTokenizer(s, "’'", true);
            while (st2.hasMoreElements()) {
              l.push(st2.nextToken());
            }
          }
        }
      }
    }
    while (hyphensAtEnd > 0) {
      l.push('-');
      hyphensAtEnd--;
    }
    return l;
  }
}
