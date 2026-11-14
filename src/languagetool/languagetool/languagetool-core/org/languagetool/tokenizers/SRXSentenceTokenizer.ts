// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tokenizers/SRXSentenceTokenizer.java faithful
// The two constructors are one (the SRX path defaults to "/segment.srx").
import type { Language } from '../Language.ts';
import type { SrxDocument } from '../../../../../segment/segment/net/loomchild/segment/srx/SrxDocument.ts';
import type { SentenceTokenizer } from './SentenceTokenizer.ts';
import { SrxTools } from './SrxTools.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/**
 * Class to tokenize sentences using rules from an SRX file.
 * @author Marcin Miłkowski
 * @author Jarek Lipski
 */
export class SRXSentenceTokenizer implements SentenceTokenizer {

  private readonly srxDocument: SrxDocument;
  private readonly language: Language;
  private parCode!: string;

  /**
   * Build a sentence tokenizer based on the rules in the {@code segment.srx} file
   * that comes with LanguageTool (or in another SRX file).
   * @param srxInClassPath the path to an SRX file in the classpath
   * @since 3.2
   */
  constructor(language: Language, srxInClassPath = '/segment.srx') {
    this.language = Objects_requireNonNull(language);
    this.srxDocument = SrxTools.createSrxDocument(srxInClassPath);
    this.setSingleLineBreaksMarksParagraph(false);
  }

  tokenize(text: string): string[] {
    return SrxTools.tokenize(text, this.srxDocument, this.language.getShortCode() + this.parCode);
  }

  singleLineBreaksMarksPara(): boolean {
    return '_one' === this.parCode;
  }

  /**
   * @param lineBreakParagraphs if <code>true</code>, single lines breaks are assumed to end a
   *   paragraph; if <code>false</code>, only two ore more consecutive line breaks end a paragraph
   */
  setSingleLineBreaksMarksParagraph(lineBreakParagraphs: boolean): void {
    if (lineBreakParagraphs) {
      this.parCode = '_one';
    } else {
      this.parCode = '_two';
    }
  }

}
