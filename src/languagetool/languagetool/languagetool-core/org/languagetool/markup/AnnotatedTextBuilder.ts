// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/markup/AnnotatedTextBuilder.java faithful
// The addGlobalMetaData and addMarkup overloads are one method each.
import { AnnotatedText, MetaDataKey } from './AnnotatedText.ts';
import { MappingValue } from './MappingValue.ts';
import { TextPart } from './TextPart.ts';
import { StringTokenizer } from '../../../../../jdk/java/util/StringTokenizer.ts';

/**
 * Use this builder to create input of text with markup for LanguageTool, so that it
 * can check only the plain text parts and ignore the markup, yet still calculate the
 * positions of errors so that they refer to the complete text, including markup.
 *
 * <p>It's up to you to split the input into parts that are plain text and parts that
 * are markup.
 *
 * <p>For example, text with XML markup like</p>
 *
 * <pre>
 *   Here is &lt;b&gt;some text&lt;/b&gt;
 * </pre>
 *
 * <p>needs to be prepared like this:</p>
 *
 * <pre>
 * new AnnotatedTextBuilder()
 *   .addText("Here is ").addMarkup("&lt;b&gt;").addText("some text").addMarkup("&lt;/b&gt;")
 *   .build()
 * </pre>
 *
 * @since 2.3
 */
export class AnnotatedTextBuilder {

  private static readonly hiddenChars = '­‭‬';

  private readonly parts: TextPart[] = [];
  private readonly metaData = new Map<MetaDataKey, string>();
  private readonly customMetaData = new Map<string, string>();

  constructor() {
  }

  /**
   * Add global meta data like document title or receiver name (when writing an email)
   * (a MetaDataKey), or any global meta data about the document to be checked (a string key).
   * Some rules may use this information.
   * Unless you're using your own rules for which you know useful keys, you probably want to
   * use a MetaDataKey.
   * @since 3.9
   */
  addGlobalMetaData(key: MetaDataKey | string, value: string): AnnotatedTextBuilder {
    if (key instanceof MetaDataKey) {
      this.metaData.set(key, value);
    } else {
      this.customMetaData.set(key, value);
    }
    return this;
  }

  /**
   * Add a plain text snippet, to be checked by LanguageTool when using
   * {@link org.languagetool.JLanguageTool#check(AnnotatedText)}.
   */
  addText(text: string): AnnotatedTextBuilder {
    const st = new StringTokenizer(text, AnnotatedTextBuilder.hiddenChars, true);
    while (st.hasMoreElements()) {
      const token = st.nextElement();
      if (!AnnotatedTextBuilder.hiddenChars.includes(token)) {
        this.parts.push(new TextPart(token, TextPart.Type.TEXT));
      } else {
        this.parts.push(new TextPart(token, TextPart.Type.MARKUP));
      }
    }
    return this;
  }

  /**
   * Add a markup text snippet like {@code <b attr='something'>} or {@code <div>}. These
   * parts will be ignored by LanguageTool when using {@link org.languagetool.JLanguageTool#check(AnnotatedText)}.
   * @param interpretAs A string that will be used by the checker instead of the markup. This is usually
   *                    whitespace, e.g. {@code \n\n} for {@code <p>}
   */
  addMarkup(markup: string, interpretAs?: string): AnnotatedTextBuilder {
    this.parts.push(new TextPart(markup, TextPart.Type.MARKUP));
    if (interpretAs !== undefined) {
      this.parts.push(new TextPart(interpretAs, TextPart.Type.FAKE_CONTENT));
    }
    return this;
  }

  /** @since 5.4 */
  add(part: TextPart): void {
    this.parts.push(part);
  }

  /**
   * Create the annotated text to be passed into {@link org.languagetool.JLanguageTool#check(AnnotatedText)}.
   */
  build(): AnnotatedText {
    let plainTextPosition = 0;
    let totalPosition = 0;
    const mapping = new Map<number, MappingValue>();
    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i]!;
      if (part.getType() === TextPart.Type.TEXT) {
        plainTextPosition += part.getPart().length;
        totalPosition += part.getPart().length;
        const mappingValue = new MappingValue(totalPosition);
        mapping.set(plainTextPosition, mappingValue);
      } else if (part.getType() === TextPart.Type.MARKUP) {
        totalPosition += part.getPart().length;
        if (this.hasFakeContent(i, this.parts)) {
          plainTextPosition += this.parts[i + 1]!.getPart().length;
          i++;
          if (mapping.get(plainTextPosition) == null) {
            const mappingValue = new MappingValue(totalPosition, part.getPart().length);
            mapping.set(plainTextPosition, mappingValue);
          }
        }
      }
    }
    return new AnnotatedText(this.parts, mapping, this.metaData, this.customMetaData);
  }

  private hasFakeContent(i: number, parts: TextPart[]): boolean {
    const nextPartIndex = i + 1;
    if (nextPartIndex < parts.length) {
      if (parts[nextPartIndex]!.getType() === TextPart.Type.FAKE_CONTENT) {
        return true;
      }
    }
    return false;
  }

}
