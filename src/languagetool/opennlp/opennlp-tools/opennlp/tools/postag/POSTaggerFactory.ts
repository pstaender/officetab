// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/POSTaggerFactory.java partial
// Only what loading a model needs. Left out: the constructors and create methods for training,
// createTagDictionary, setTagDictionary, setDictionary, createEmptyTagDictionary, and the
// feature generator descriptors of 1.8+ models (createFeatureGenerators, GeneratorFactory and
// ConfigurablePOSContextGenerator are not ported: getPOSContextGenerator throws for such a
// model). Models of OpenNLP 1.5-1.7, such as en-pos-maxent.bin, take DefaultPOSContextGenerator.
// The class registers itself with ExtensionLoader under its Java name (see there).
import type { Properties } from '../../../../../jdk/java/util/Properties.ts';
import type { AbstractModel } from '../ml/model/AbstractModel.ts';
import type { Dictionary } from '../dictionary/Dictionary.ts';
import { BaseToolFactory } from '../util/BaseToolFactory.ts';
import { ExtensionLoader } from '../util/ext/ExtensionLoader.ts';
import { InvalidFormatException } from '../util/InvalidFormatException.ts';
import type { ArtifactSerializer } from '../util/model/ArtifactSerializer.ts';
import type { SequenceValidator } from '../util/SequenceValidator.ts';
import { Version } from '../util/Version.ts';
import { DefaultPOSContextGenerator } from './DefaultPOSContextGenerator.ts';
import { DefaultPOSSequenceValidator } from './DefaultPOSSequenceValidator.ts';
import type { POSContextGenerator } from './POSContextGenerator.ts';
import { POSDictionary } from './POSDictionary.ts';
import type { TagDictionary } from './TagDictionary.ts';

/** POSModel.POS_MODEL_ENTRY_NAME (not imported: POSModel imports this module). */
const POS_MODEL_ENTRY_NAME = 'pos.model';

/**
 * The factory that provides POS Tagger default implementations and resources
 */
export class POSTaggerFactory extends BaseToolFactory {
  private static readonly TAG_DICTIONARY_ENTRY_NAME = 'tags.tagdict';
  private static readonly NGRAM_DICTIONARY_ENTRY_NAME = 'ngram.dictionary';

  protected ngramDictionary: Dictionary | null = null;
  private resources: Map<string, unknown> | null = null;
  protected posDictionary: TagDictionary | null = null;

  override createArtifactSerializersMap(): Map<string, ArtifactSerializer<unknown>> {
    const serializers = super.createArtifactSerializersMap();

    // NOTE: This is only needed for old models and this if can be removed if support is dropped
    POSDictionarySerializer.register(serializers);

    return serializers;
  }

  override createArtifactMap(): Map<string, unknown> {
    const artifactMap = super.createArtifactMap();

    if (this.posDictionary != null)
      artifactMap.set(POSTaggerFactory.TAG_DICTIONARY_ENTRY_NAME, this.posDictionary);

    if (this.ngramDictionary != null)
      artifactMap.set(POSTaggerFactory.NGRAM_DICTIONARY_ENTRY_NAME, this.ngramDictionary);

    return artifactMap;
  }

  protected getResources(): Map<string, unknown> {
    if (this.resources != null) {
      return this.resources;
    }

    return new Map();
  }

  getTagDictionary(): TagDictionary | null {
    if (this.posDictionary == null && this.artifactProvider != null)
      this.posDictionary = this.artifactProvider.getArtifact<TagDictionary>(POSTaggerFactory.TAG_DICTIONARY_ENTRY_NAME);
    return this.posDictionary;
  }

  /** @deprecated */
  getDictionary(): Dictionary | null {
    if (this.ngramDictionary == null && this.artifactProvider != null)
      this.ngramDictionary = this.artifactProvider.getArtifact<Dictionary>(POSTaggerFactory.NGRAM_DICTIONARY_ENTRY_NAME);
    return this.ngramDictionary;
  }

  getPOSContextGenerator(cacheSize = 0): POSContextGenerator {
    if (this.artifactProvider != null) {
      const manifest = this.artifactProvider.getArtifact<Properties>('manifest.properties') as Properties;

      const version = manifest.getProperty('OpenNLP-Version') as string;

      if (Version.parse(version).getMinor() < 8) {
        return new DefaultPOSContextGenerator(cacheSize, this.getDictionary());
      }
    }

    // new ConfigurablePOSContextGenerator(cacheSize, createFeatureGenerators())
    throw new Error('Feature generator descriptors (OpenNLP 1.8+ POS models) are not ported');
  }

  getSequenceValidator(): SequenceValidator<string> {
    return new DefaultPOSSequenceValidator(this.getTagDictionary());
  }

  protected validatePOSDictionary(posDict: POSDictionary,
      posModel: AbstractModel): void {
    const dictTags = new Set<string>();

    for (const word of posDict) {
      for (const t of posDict.getTags(word) ?? []) dictTags.add(t);
    }

    const modelTags = new Set<string>();

    for (let i = 0; i < posModel.getNumOutcomes(); i++) {
      modelTags.add(posModel.getOutcome(i));
    }

    let unknownTag = '';
    for (const d of dictTags) {
      if (!modelTags.has(d)) {
        unknownTag += d + ' ';
      }
    }
    if (unknownTag !== '') {
      throw new InvalidFormatException('Tag dictionary contains tags '
          + 'which are unknown by the model! The unknown tags are: '
          + unknownTag);
    }
  }

  validateArtifactMap(): void {
    // Ensure that the tag dictionary is compatible with the model

    const provider = this.artifactProvider!;
    const tagdictEntry = provider.getArtifact<unknown>(POSTaggerFactory.TAG_DICTIONARY_ENTRY_NAME);

    if (tagdictEntry != null) {
      if (tagdictEntry instanceof POSDictionary) {
        if (!provider.isLoadedFromSerialized()) {
          const posModel = provider.getArtifact<AbstractModel>(POS_MODEL_ENTRY_NAME) as AbstractModel;
          const posDict = tagdictEntry;
          this.validatePOSDictionary(posDict, posModel);
        }
      } else {
        throw new InvalidFormatException(
            'POSTag dictionary has wrong type!');
      }
    }

    const ngramDictEntry = provider.getArtifact<unknown>(POSTaggerFactory.NGRAM_DICTIONARY_ENTRY_NAME);

    if (ngramDictEntry != null && !(typeof ngramDictEntry === 'object' && 'asStringSet' in ngramDictEntry)) {
      throw new InvalidFormatException('NGram dictionary has wrong type!');
    }
  }
}

// TODO: This should not be done anymore for 8 models, they can just
// use the SerializableArtifact interface
export class POSDictionarySerializer implements ArtifactSerializer<POSDictionary> {
  create(input: Uint8Array): POSDictionary {
    return POSDictionary.create(input);
  }

  static register(factories: Map<string, ArtifactSerializer<unknown>>): void {
    factories.set('tagdict', new POSDictionarySerializer());
  }
}

ExtensionLoader.registerExtension('opennlp.tools.postag.POSTaggerFactory', POSTaggerFactory);
