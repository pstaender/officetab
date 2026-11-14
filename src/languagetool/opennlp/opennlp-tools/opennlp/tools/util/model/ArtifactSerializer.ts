// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/model/ArtifactSerializer.java partial
// Left out: serialize. An InputStream is the bytes of the zip entry.

/**
 * Responsible to create an artifact from an InputStream.
 */
export interface ArtifactSerializer<T> {
  /**
   * Create the artifact from the provided InputStream. The InputStream
   * must not be closed by the implementation.
   */
  create(input: Uint8Array): T;
}
