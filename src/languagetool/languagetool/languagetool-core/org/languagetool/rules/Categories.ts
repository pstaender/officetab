// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/Categories.java faithful
import { Category } from './Category.ts';
import { CategoryId } from './CategoryId.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/**
 * Pre-defined rule categories.
 * @since 3.3
 */
export class Categories {

  /** Rules about detecting uppercase words where lowercase is required and vice versa. */
  static readonly CASING = Categories.make('CASING', 'category_case');

  /** Rules about spelling terms as one word or as as separate words. */
  static readonly COMPOUNDING = Categories.make('COMPOUNDING', 'category_compounding');

  static readonly GRAMMAR = Categories.make('GRAMMAR', 'category_grammar');

  /** Spelling issues. */
  static readonly TYPOS = Categories.make('TYPOS', 'category_typo');

  static readonly PUNCTUATION = Categories.make('PUNCTUATION', 'category_punctuation');

  /** Problems like incorrectly used dash or quote characters. */
  static readonly TYPOGRAPHY = Categories.make('TYPOGRAPHY', 'category_typography');

  /** Words that are easily confused, like 'there' and 'their' in English. */
  static readonly CONFUSED_WORDS = Categories.make('CONFUSED_WORDS', 'category_confused_words');

  static readonly REPETITIONS = Categories.make('REPETITIONS', 'category_repetitions');

  static readonly REDUNDANCY = Categories.make('REDUNDANCY', 'category_redundancy');

  static readonly REPETITIONS_STYLE = Categories.make('REPETITIONS_STYLE', 'cateogry_repetitions_style');

  /** General style issues not covered by other categories, like overly verbose wording. */
  static readonly STYLE = Categories.make('STYLE', 'category_style');


  /** Created to match PLAIN_ENGLISH XML category. */
  static readonly PLAIN_ENGLISH = Categories.make('PLAIN_ENGLISH', 'category_plain_english');

  static readonly GENDER_NEUTRALITY = Categories.make('GENDER_NEUTRALITY', 'category_gender_neutrality');

  /** Logic, content, and consistency problems. */
  static readonly SEMANTICS = Categories.make('SEMANTICS', 'category_semantics');

  /** Colloquial style. */
  static readonly COLLOQUIALISMS = Categories.make('COLLOQUIALISMS', 'category_colloquialism');

  /** Regionalisms: words used only in another language variant or used with different meanings. */
  static readonly REGIONALISMS = Categories.make('REGIONALISMS', 'category_regionalisms');

  /** False friends: words easily confused by language learners because a similar word exists in their native language. */
  static readonly FALSE_FRIENDS = Categories.make('FALSE_FRIENDS', 'category_false_friend');

  /** Rules that only make sense when editing Wikipedia (typically turned off by default in LanguageTool). */
  static readonly WIKIPEDIA = Categories.make('WIKIPEDIA', 'category_wikipedia');

  /** Miscellaneous rules that don't fit elsewhere. */
  static readonly MISC = Categories.make('MISC', 'category_misc');

  // *** NOTE: keep in sync when making changes above ***
  static readonly ALL: readonly Categories[] = [Categories.STYLE, Categories.REPETITIONS_STYLE, Categories.REPETITIONS, Categories.CASING, Categories.COMPOUNDING,
    Categories.COLLOQUIALISMS, Categories.CONFUSED_WORDS, Categories.FALSE_FRIENDS, Categories.GENDER_NEUTRALITY, Categories.GRAMMAR, Categories.MISC, Categories.PLAIN_ENGLISH,
    Categories.REDUNDANCY, Categories.REGIONALISMS, Categories.PUNCTUATION, Categories.TYPOGRAPHY, Categories.WIKIPEDIA, Categories.TYPOS];

  private static make(id: string, message: string): Categories {
    return new Categories(id, message);
  }

  private readonly id: string;
  private readonly messageKey: string;

  private constructor(id: string, messageKey: string) {
    this.id = Objects_requireNonNull(id);
    this.messageKey = Objects_requireNonNull(messageKey);
  }

  getId(): CategoryId {
    return new CategoryId(this.id);
  }

  getCategory(messages: ResourceBundle): Category {
    return new Category(new CategoryId(this.id), messages.getString(this.messageKey));
  }
}
