// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/ext/ExtensionLoader.java reduced
// Java loads an extension class by name through the class loader (or OSGi). There is no
// reflection here: the classes a model's manifest can name (factory=...) register themselves
// under their Java class name when their module loads (registerExtension, not upstream), and
// are looked up in that table; any other name throws, as a missing class does in Java.
// Registered: opennlp.tools.tokenize.TokenizerFactory, opennlp.tools.postag.POSTaggerFactory,
// opennlp.tools.chunker.ChunkerFactory (each model imports its default factory, so they are
// there whenever a model is).

const classes = new Map<string, new () => unknown>();

/**
 * The ExtensionLoader is responsible to load extensions to the OpenNLP library.
 */
export class ExtensionLoader {
  private constructor() {
  }

  /** Makes a ported class known under its Java class name (instead of the class loader). */
  static registerExtension(extensionClassName: string, clazz: new () => unknown): void {
    classes.set(extensionClassName, clazz);
  }

  /**
   * Instantiates an user provided extension to OpenNLP.
   *
   * The extension is looked up in the table of ported classes (see the header).
   */
  static instantiateExtension<T>(extensionClassName: string): T {
    const clazz = classes.get(extensionClassName);
    if (clazz === undefined) {
      throw new Error('Unable to find the implementation ' + extensionClassName + ' in the ported classes');
    }
    return new clazz() as T;
  }
}
