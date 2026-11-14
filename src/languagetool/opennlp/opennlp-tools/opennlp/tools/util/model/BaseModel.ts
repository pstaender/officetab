// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/model/BaseModel.java partial
// Only loading a model package (the InputStream constructor) and the accessors; left out: the
// constructors that build a model from trained parts, serialize, the File/URL constructors and
// Java serialization. The model package is read by the caller with readZip (which is
// asynchronous) and passed as its entries: new POSModel(await readZip(bytes)). Java reads the
// zip twice (once for the manifest, once for all artifacts); here both passes go over the
// entries map, in the package's order. Serializer classes named in the manifest
// (serializer-class-...) are looked up with ExtensionLoader.
import { Properties } from '../../../../../../jdk/java/util/Properties.ts';
import { BaseToolFactory } from '../BaseToolFactory.ts';
import { ExtensionLoader } from '../ext/ExtensionLoader.ts';
import { InvalidFormatException } from '../InvalidFormatException.ts';
import { Version } from '../Version.ts';
import type { ArtifactProvider } from './ArtifactProvider.ts';
import type { ArtifactSerializer } from './ArtifactSerializer.ts';
import { ByteArraySerializer } from './ByteArraySerializer.ts';
import { DictionarySerializer } from './DictionarySerializer.ts';
import { GenericModelSerializer } from './GenericModelSerializer.ts';
import { PropertiesSerializer } from './PropertiesSerializer.ts';

/** The entries of a model package (a zip): name to bytes, as readZip returns them. */
export type ModelPackage = Map<string, Uint8Array>;

/**
 * This model is a common based which can be used by the components
 * model classes.
 *
 * TODO:
 * Provide sub classes access to serializers already in constructor
 */
export abstract class BaseModel implements ArtifactProvider {
  protected static readonly MANIFEST_ENTRY = 'manifest.properties';
  protected static readonly FACTORY_NAME = 'factory';

  private static readonly MANIFEST_VERSION_PROPERTY = 'Manifest-Version';
  private static readonly COMPONENT_NAME_PROPERTY = 'Component-Name';
  private static readonly VERSION_PROPERTY = 'OpenNLP-Version';
  private static readonly TIMESTAMP_PROPERTY = 'Timestamp';
  private static readonly LANGUAGE_PROPERTY = 'Language';

  static readonly TRAINING_CUTOFF_PROPERTY = 'Training-Cutoff';
  static readonly TRAINING_ITERATIONS_PROPERTY = 'Training-Iterations';
  static readonly TRAINING_EVENTHASH_PROPERTY = 'Training-Eventhash';

  private static SERIALIZER_CLASS_NAME_PREFIX = 'serializer-class-';

  private artifactSerializers = new Map<string, ArtifactSerializer<unknown>>();

  protected artifactMap = new Map<string, unknown>();

  protected toolFactory: BaseToolFactory | null = null;

  private componentName: string;

  private subclassSerializersInitiated = false;
  private finishedLoadingArtifacts = false;

  private _isLoadedFromSerialized: boolean;

  /**
   * Initializes the current instance.
   *
   * @param componentName the component name
   * @param input the model package (the entries of the zip)
   */
  protected constructor(componentName: string, input: ModelPackage) {
    this._isLoadedFromSerialized = true;

    if (componentName == null) throw new TypeError('componentName must not be null!');
    this.componentName = componentName;

    this.loadModel(input);
  }

  private loadModel(input: ModelPackage): void {
    if (input == null) throw new TypeError('in must not be null');

    this.createBaseArtifactSerializers(this.artifactSerializers);

    // The model package can contain artifacts which are serialized with 3rd party
    // serializers which are configured in the manifest file. To be able to load
    // the model the manifest must be read first, and afterwards all the artifacts
    // can be de-serialized.

    // The ordering of artifacts in a zip package is not guaranteed. The stream is first
    // read until the manifest appears, reseted, and read again to load all artifacts.

    let isSearchingForManifest = true;

    for (const [name, data] of input) {
      if (!isSearchingForManifest) break;

      if ('manifest.properties' === name) {
        // TODO: Probably better to use the serializer here directly!
        const factory = this.artifactSerializers.get('properties') as ArtifactSerializer<unknown>;
        this.artifactMap.set(name, factory.create(data));
        isSearchingForManifest = false;
      }
    }

    this.initializeFactory();

    this.loadArtifactSerializers();

    this.finishLoadingArtifacts(input);

    this.checkArtifactMap();
  }

  private initializeFactory(): void {
    const factoryName = this.getManifestProperty(BaseModel.FACTORY_NAME);
    if (factoryName == null) {
      // load the default factory
      const factoryClass = this.getDefaultFactory();
      if (factoryClass != null) {
        this.toolFactory = BaseToolFactory.create(factoryClass, this);
      }
    } else {
      try {
        this.toolFactory = BaseToolFactory.create(factoryName, this);
      } catch (e) {
        if (e instanceof InvalidFormatException) throw new RangeError(e.message, { cause: e });
        throw e;
      }
    }
  }

  /**
   * Sub-classes should override this method if their module has a default
   * BaseToolFactory sub-class.
   *
   * @return the default BaseToolFactory for the module, or null if none.
   */
  protected getDefaultFactory(): (new () => BaseToolFactory) | null {
    return null;
  }

  /**
   * Loads the artifact serializers.
   */
  private loadArtifactSerializers(): void {
    if (!this.subclassSerializersInitiated)
      this.createArtifactSerializers(this.artifactSerializers);
    this.subclassSerializersInitiated = true;
  }

  /**
   * Finish loading the artifacts now that it knows all serializers.
   */
  private finishLoadingArtifacts(input: ModelPackage): void {
    const artifactMap = new Map<string, unknown>();

    for (const [entryName, data] of input) {
      // Note: The manifest.properties file will be read here again,
      // there should be no need to prevent that.

      const extension = this.getEntryExtension(entryName);

      let factory = this.artifactSerializers.get(extension);

      const artifactSerializerClazzName =
          this.getManifestProperty(BaseModel.SERIALIZER_CLASS_NAME_PREFIX + entryName);

      if (artifactSerializerClazzName != null) {
        factory = ExtensionLoader.instantiateExtension<ArtifactSerializer<unknown>>(artifactSerializerClazzName);
      }

      if (factory != null) {
        artifactMap.set(entryName, factory.create(data));
      } else {
        throw new InvalidFormatException('Unknown artifact format: ' + extension);
      }
    }

    for (const [k, v] of artifactMap) this.artifactMap.set(k, v);

    this.finishedLoadingArtifacts = true;
  }

  /**
   * Extracts the "." extension from an entry name.
   */
  private getEntryExtension(entry: string): string {
    const extensionIndex = entry.lastIndexOf('.') + 1;

    if (extensionIndex >= entry.length)
        throw new InvalidFormatException('Entry name must have type extension: ' + entry);

    return entry.substring(extensionIndex);
  }

  protected getArtifactSerializer(resourceName: string): ArtifactSerializer<unknown> | null {
    return this.artifactSerializers.get(this.getEntryExtension(resourceName)) ?? null;
  }

  /** The static createArtifactSerializers() of Java (a static and an instance method share the name there). */
  protected static createBaseSerializers(): Map<string, ArtifactSerializer<unknown>> {
    const serializers = new Map<string, ArtifactSerializer<unknown>>();

    GenericModelSerializer.register(serializers);
    PropertiesSerializer.register(serializers);
    DictionarySerializer.register(serializers);
    serializers.set('txt', new ByteArraySerializer());
    serializers.set('html', new ByteArraySerializer());

    return serializers;
  }

  /**
   * Registers all ArtifactSerializer for their artifact file name extensions.
   * The registered ArtifactSerializer are used to create and serialize
   * resources in the model package.
   *
   * Override this method to register custom ArtifactSerializers.
   *
   * Note:
   * Subclasses should generally invoke super.createArtifactSerializers at the beginning
   * of this method.
   *
   * This method is called during construction.
   */
  protected createArtifactSerializers(serializers: Map<string, ArtifactSerializer<unknown>>): void {
    if (this.toolFactory != null)
      for (const [k, v] of this.toolFactory.createArtifactSerializersMap()) serializers.set(k, v);
  }

  private createBaseArtifactSerializers(serializers: Map<string, ArtifactSerializer<unknown>>): void {
    for (const [k, v] of BaseModel.createBaseSerializers()) serializers.set(k, v);
  }

  /**
   * Validates the parsed artifacts. If something is not
   * valid subclasses should throw an InvalidFormatException.
   *
   * Note:
   * Subclasses should generally invoke super.validateArtifactMap at the beginning
   * of this method.
   */
  protected validateArtifactMap(): void {
    if (!(this.artifactMap.get(BaseModel.MANIFEST_ENTRY) instanceof Properties))
      throw new InvalidFormatException('Missing the ' + BaseModel.MANIFEST_ENTRY + '!');

    // First check version, everything else might change in the future
    const versionString = this.getManifestProperty(BaseModel.VERSION_PROPERTY);

    if (versionString != null) {
      let version: Version;

      try {
        version = Version.parse(versionString);
      }
      catch (e) {
        throw new InvalidFormatException("Unable to parse model version '" + versionString + "'!", e);
      }

      // Version check is only performed if current version is not the dev/debug version
      if (!Version.currentVersion().equals(Version.DEV_VERSION)) {
        // Major and minor version must match, revision might be
        // this check allows for the use of models of n minor release behind current minor release
        if (Version.currentVersion().getMajor() !== version.getMajor() ||
            Version.currentVersion().getMinor() - 4 > version.getMinor()) {
          throw new InvalidFormatException('Model version ' + version + ' is not supported by this ('
              + Version.currentVersion() + ') version of OpenNLP!');
        }

        // Reject loading a snapshot model with a non-snapshot version
        if (!Version.currentVersion().isSnapshot() && version.isSnapshot()) {
          throw new InvalidFormatException('Model version ' + version
              + ' is a snapshot - snapshot models are not supported by this non-snapshot version ('
              + Version.currentVersion() + ') of OpenNLP!');
        }
      }
    }
    else {
      throw new InvalidFormatException('Missing ' + BaseModel.VERSION_PROPERTY + ' property in ' +
            BaseModel.MANIFEST_ENTRY + '!');
    }

    if (this.getManifestProperty(BaseModel.COMPONENT_NAME_PROPERTY) == null)
      throw new InvalidFormatException('Missing ' + BaseModel.COMPONENT_NAME_PROPERTY + ' property in ' +
            BaseModel.MANIFEST_ENTRY + '!');

    if (this.getManifestProperty(BaseModel.COMPONENT_NAME_PROPERTY) !== this.componentName)
        throw new InvalidFormatException('The ' + this.componentName + ' cannot load a model for the ' +
            this.getManifestProperty(BaseModel.COMPONENT_NAME_PROPERTY) + '!');

    if (this.getManifestProperty(BaseModel.LANGUAGE_PROPERTY) == null)
      throw new InvalidFormatException('Missing ' + BaseModel.LANGUAGE_PROPERTY + ' property in ' +
          BaseModel.MANIFEST_ENTRY + '!');

    // Validate the factory. We try to load it using the ExtensionLoader. It
    // will return the factory, null or raise an exception
    const factoryName = this.getManifestProperty(BaseModel.FACTORY_NAME);
    if (factoryName != null) {
      try {
        if (ExtensionLoader.instantiateExtension<BaseToolFactory>(factoryName) == null) {
          throw new InvalidFormatException(
              'Could not load an user extension specified by the model: '
                  + factoryName);
        }
      } catch (e) {
        throw new InvalidFormatException(
            'Could not load an user extension specified by the model: '
                + factoryName, e);
      }
    }

    // validate artifacts declared by the factory
    if (this.toolFactory != null) {
      this.toolFactory.validateArtifactMap();
    }
  }

  /**
   * Checks the artifact map.
   *
   * A subclass should call this method from a constructor which accepts the individual
   * artifact map items, to validate that these items form a valid model.
   *
   * If the artifacts are not valid an IllegalArgumentException will be thrown.
   */
  protected checkArtifactMap(): void {
    if (!this.finishedLoadingArtifacts)
      throw new Error(
          'The method BaseModel.finishLoadingArtifacts(..) was not called by BaseModel sub-class.');
    try {
      this.validateArtifactMap();
    } catch (e) {
      if (e instanceof InvalidFormatException) throw new RangeError(e.message, { cause: e });
      throw e;
    }
  }

  /**
   * Retrieves the value to the given key from the manifest.properties
   * entry.
   */
  getManifestProperty(key: string): string | null {
    const manifest = this.artifactMap.get(BaseModel.MANIFEST_ENTRY) as Properties;

    return manifest.getProperty(key);
  }

  /**
   * Sets a given value for a given key to the manifest.properties entry.
   */
  protected setManifestProperty(key: string, value: string): void {
    const manifest = this.artifactMap.get(BaseModel.MANIFEST_ENTRY) as Properties;

    manifest.setProperty(key, value);
  }

  /**
   * Retrieves the language code of the material which
   * was used to train the model or x-unspecified if
   * non was set.
   */
  getLanguage(): string | null {
    return this.getManifestProperty(BaseModel.LANGUAGE_PROPERTY);
  }

  /**
   * Retrieves the OpenNLP version which was used
   * to create the model.
   */
  getVersion(): Version {
    const version = this.getManifestProperty(BaseModel.VERSION_PROPERTY);

    return Version.parse(version as string);
  }

  getArtifact<T>(key: string): T | null {
    const artifact = this.artifactMap.get(key);
    if (artifact == null)
      return null;
    return artifact as T;
  }

  isLoadedFromSerialized(): boolean {
    return this._isLoadedFromSerialized;
  }
}
