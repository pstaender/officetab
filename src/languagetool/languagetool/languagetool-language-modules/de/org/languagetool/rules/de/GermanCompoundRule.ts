// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanCompoundRule.java faithful
// The static ANTI_PATTERNS and compound data are created on first use. GermanyGerman.getInstance()
// is Languages.getLanguageForShortCode('de-DE'): GermanyGerman imports this rule, a value import
// of it would be an import cycle. getDefaultSpellingRule() is typed Rule here; it is the
// language's SpellingCheckRule.
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractCompoundRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractCompoundRule.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { CompoundRuleData } from '../../../../../../languagetool-core/org/languagetool/rules/CompoundRuleData.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import { token, tokenRegex } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';
import type { SpellingCheckRule } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const GermanyGerman = { getInstance: (): Language => Languages.getLanguageForShortCode('de-DE') };

function antiPatterns(): PatternToken[][] {
  return [
    [  // "Die Bürger konnten an die 900 Meter Kabel in Eigenregie verlegen."
      tokenRegex('an|um'),
      token('die'),
      tokenRegex('\\d+')
    ],
    [  // "Lohnt sich die Werbung vom ausgegebenen Euro aus gedacht?"
      new PatternTokenBuilder().tokenRegex('von|vom').setSkip(5).build(),
      token('aus'),
      token('gedacht')
    ],
    [  // "Die Bürger konnten an die 900 Meter Kabel in Eigenregie verlegen."
      tokenRegex('rund|etwa|zirka|cirka|ungefähr|annähernd|grob|wohl|gegen|schätzungsweise'),
      tokenRegex('\\d+')
    ],
    [  // "Die Bürger konnten ca. 900 Meter Kabel in Eigenregie verlegen."
      token('ca'),
      token('.'),
      tokenRegex('\\d+')
    ],
    [  // Eigenname
      token('Kung'),
      token('Fu'),
      tokenRegex('Panda|Fighting')
    ],
    [  // Eigenname
      token('Harlem'),
      token('Gospel'),
      token('Singers')
    ],
    [  // Englisch
      token('Always'),
      token('on'),
      tokenRegex('my|your|the|an?|their')
    ],
    [  // sich selbst gerecht werden
      tokenRegex('sich|uns|ihm|ihr|mir|euch'),
      token('selbst'),
      tokenRegex('gerecht.*')
    ]
  ];
}
let ANTI_PATTERNS: DisambiguationPatternRule[] | null = null;

let compoundData: CompoundRuleData | null = null;

/**
 * Checks that compounds are not written as separate words. The supported compounds are loaded
 * from {@code /de/compounds.txt} and {@code /de/compounds-cities.txt} in the resource directory.
 * 
 * @author Daniel Naber
 */
export class GermanCompoundRule extends AbstractCompoundRule {
  
  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null) {
    super(messages, lang, userConfig,
            'Dieses Wort wird mit Bindestrich geschrieben.',
            'Dieses Wort wird zusammengeschrieben.',
            'Diese Wörter werden zusammengeschrieben oder mit Bindestrich getrennt.',
            'Zusammenschreibung von Wörtern');
    super.setCategory(Categories.COMPOUNDING.getCategory(messages));
    this.addExamplePair(Example.wrong('Wenn es schlimmer wird, solltest Du zum <marker>HNO Arzt</marker> gehen.'),
                   Example.fixed('Wenn es schlimmer wird, solltest Du zum <marker>HNO-Arzt</marker> gehen.'));
  }

  override getId(): string {
    return 'DE_COMPOUNDS';
  }

  override getDescription(): string {
    return "Zusammenschreibung von Wörtern, z. B. 'CD-ROM' statt 'CD ROM'";
  }

  override getCompoundRuleData(): CompoundRuleData {
    let data = compoundData;
    if (data == null) {
      compoundData = data = new CompoundRuleData('/de/compounds.txt', '/de/compound-cities.txt');
    }
    return data;
  }
  
  override isMisspelled(word: string): boolean {
    return (Objects_requireNonNull(GermanyGerman.getInstance().getDefaultSpellingRule()) as SpellingCheckRule).isMisspelled(word);
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return ANTI_PATTERNS ??= GermanCompoundRule.makeAntiPatterns(antiPatterns(), GermanyGerman.getInstance());
  }
}
