// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/model/ArtifactProvider.java faithful

/**
 * Provides access to model persisted artifacts.
 */
export interface ArtifactProvider {
  /**
   * Gets an artifact by name
   */
  getArtifact<T>(key: string): T | null;

  /**
   * Retrieves the value to the given key from the manifest.properties
   * entry.
   */
  getManifestProperty(key: string): string | null;

  /**
   * Retrieves the language code of the material which was used to train the
   * model or x-unspecified if non was set.
   */
  getLanguage(): string | null;

  /**
   * Indicates if this provider was loaded from serialized. It is useful, for
   * example, while validating artifacts: you can skip the time consuming ones
   * if they where already validated during the serialization.
   */
  isLoadedFromSerialized(): boolean;
}
