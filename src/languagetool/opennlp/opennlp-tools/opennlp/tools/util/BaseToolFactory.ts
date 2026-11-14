// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/BaseToolFactory.java partial
// Left out: createArtifactMap and createManifestEntries' callers (the training constructors of
// BaseModel). Java creates factories by reflection from a class name: here
// ExtensionLoader.instantiateExtension looks the name up in a table, and create(Class) takes
// the constructor.
import type { ArtifactProvider } from './model/ArtifactProvider.ts';
import type { ArtifactSerializer } from './model/ArtifactSerializer.ts';
import { InvalidFormatException } from './InvalidFormatException.ts';
import { ExtensionLoader } from './ext/ExtensionLoader.ts';

/**
 * Base class for all tool factories.
 *
 * Extensions of this class should:
 * - implement an empty constructor (TODO is it necessary?)
 * - implement a constructor that takes the ArtifactProvider and calls BaseToolFactory(Map)
 * - override createArtifactMap() and createArtifactSerializersMap() methods if necessary.
 */
export abstract class BaseToolFactory {
  protected artifactProvider: ArtifactProvider | null = null;

  /**
   * Initializes the ToolFactory with an artifact provider.
   */
  protected init(artifactProvider: ArtifactProvider): void {
    this.artifactProvider = artifactProvider;
  }

  /**
   * Creates a Map with pairs of keys and ArtifactSerializer.
   * The models implementation should call this method from
   * BaseModel#createArtifactSerializersMap
   *
   * The base implementation will return a HashMap that should be
   * populated by sub-classes.
   */
  createArtifactSerializersMap(): Map<string, ArtifactSerializer<unknown>> {
    return new Map();
  }

  /**
   * Creates a Map with pairs of keys and objects. The models
   * implementation should call this constructor that creates a model
   * programmatically.
   */
  createArtifactMap(): Map<string, unknown> {
    return new Map();
  }

  /**
   * Creates the manifest entries that will be added to the model manifest
   */
  createManifestEntries(): Map<string, string> {
    return new Map();
  }

  /**
   * Validates the parsed artifacts. If something is not
   * valid subclasses should throw an InvalidFormatException.
   */
  abstract validateArtifactMap(): void;

  /** create(String subclassName, ...) and create(Class factoryClass, ...) */
  static create(factoryClass: string | (new () => BaseToolFactory) | null,
      artifactProvider: ArtifactProvider): BaseToolFactory | null {
    let theFactory: BaseToolFactory | null = null;

    if (typeof factoryClass === 'string') {
      const subclassName = factoryClass;
      try {
        // load the ToolFactory using the default constructor
        theFactory = ExtensionLoader.instantiateExtension<BaseToolFactory>(subclassName);

        if (theFactory != null) {
          theFactory.init(artifactProvider);
        }
      } catch (e) {
        const msg = 'Could not instantiate the ' + subclassName
            + '. The initialization throw an exception.';
        throw new InvalidFormatException(msg, e);
      }
      return theFactory;
    }

    if (factoryClass != null) {
      try {
        theFactory = new factoryClass();
        theFactory.init(artifactProvider);
      } catch (e) {
        const msg = 'Could not instantiate the '
            + factoryClass.name
            + '. The initialization throw an exception.';
        throw new InvalidFormatException(msg, e);
      }
    }
    return theFactory;
  }
}
