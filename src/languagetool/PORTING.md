# LanguageTool in TypeScript

LanguageTool (and the libraries of it that run here: morfologik, segment, OpenNLP) ported from
Java, so that Writer can check spelling and grammar in the browser without a server. The rules,
disambiguation files, word lists and dictionaries are LanguageTool's own, unchanged, loaded from
the pinned release; the Java code that reads and applies them is ported file by file, so that a
new LanguageTool release can be applied by reading its diff side by side, as `src/lo/` follows
LibreOffice (see the repository's `CLAUDE.md`, "Porting rules").

## Layout

- `upstream.json`: the pinned upstreams (`languagetool`, `morfologik-stemming`, `segment`,
  `opennlp`) and the Maven data artifacts (`$data`). `npm run upstream:fetch` materialises them
  (sparse) in `upstream/languagetool/<id>/`.
- `<id>/`: the port of that upstream. Paths are upstream's without Maven's `src/main/java/`:
  `languagetool-core/src/main/java/org/languagetool/JLanguageTool.java` is
  `languagetool/languagetool-core/org/languagetool/JLanguageTool.ts`.
- `jdk/`: the parts of the JDK the ports use (`java.util.regex` through `oniguruma-to-es`,
  `Character`, `Objects`, ...). Not ports; they let the ports read like the Java.
- `generated/resources.json`: where each classpath resource comes from (written by
  `npm run languagetool:data`, which also unpacks the Maven data into `public/languagetool/`).
- `ports.lock.json`: the upstream blob of every ported file (`npm run upstream:check`).
- Upgrading: `npm run upstream:migrate -- <tag> --diff --upstream languagetool` lists the ported
  files whose Java changed, with the diff; then update `upstream.json` and run `upstream:fetch`,
  `languagetool:data`, `upstream:check`.

## Porting conventions

Every file starts with

```ts
// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/AnalyzedToken.java faithful
```

(`faithful`: the whole file statement by statement; `partial`: faithful, only some methods;
`reduced`: same names and responsibility, simplified, with a header comment saying what is left
out). The path is relative to the upstream repository's root.

- **Names**: keep class, method, field and local names, statement order and comments. Read the
  Java before writing; never reconstruct from memory.
- **Imports**: relative, with the `.ts` extension. Import a not-yet-ported class by the path it
  will have; the paths are determined by upstream's.
- **Overloads** (methods and constructors) become one signature with optional or union
  parameters. A private constructor overload used by a factory may become an extra optional
  parameter or a static method; say so in a comment.
- **Fields named like methods** (`isWhitespace` field and `isWhitespace()`): the field gets a
  leading underscore (`_isWhitespace`).
- **Nested classes** (`PatternToken.PosToken`) are exported from the outer class's file under
  their simple name (`export class PosToken`); if the name would clash, `Outer_Inner`.
- **Enums**: `export const X = { A: 'A', B: 'B' } as const; export type X = typeof X[keyof typeof X];`
  with the Java constant names as values. Enums with fields or methods become a class with static
  instances. (`erasableSyntaxOnly`: no `enum`, no parameter properties.)
- **null**: Java's `null` stays `null` (types `T | null`); `Optional` becomes `T | null`.
- **equals**: keep `equals(o: unknown): boolean`; `hashCode` is left out. Where Java relies on
  equals in collections (`List.contains`, `Objects.equals`, `Arrays.equals`), use the helpers in
  `jdk/java/util/Objects.ts`. Sets and map keys of strings and numbers are native `Set`/`Map`.
- **Strings**: JavaScript strings are UTF-16 like Java's; `charAt`/`length` agree. But
  `String.trim` is `StringTrim` (Java trims only up to U+0020), `Character.*` is
  `jdk/java/lang/Character.ts`, `toLowerCase()`/`toUpperCase()` without a locale are the same.
  `String.matches`, `replaceAll`, `replaceFirst`, `split` take regexes in Java: use
  `StringMatches`, `StringReplaceAll`, `StringReplaceFirst`, `StringSplit` from
  `jdk/java/util/regex/Pattern.ts`; `String.replace(CharSequence, CharSequence)` is
  `replaceAll` with a string in JavaScript.
- **Regular expressions** always go through `jdk/java/util/regex/Pattern.ts` (Java syntax and
  semantics), never `new RegExp` on a Java pattern. Static `Pattern` fields are compiled lazily
  (first use) when they are many, so that loading a module stays cheap.
- **Exceptions**: `throw new Error('IllegalArgumentException: ...')` keeping Java's message; checked
  `IOException`s disappear (resources are in memory). Catch blocks keep their logic.
- **Resources**: Java reads resources synchronously from the classpath. Here they are loaded
  (fetched) beforehand into `ResourceDataBroker` (`JLanguageTool.getDataBroker()`), which then
  answers synchronously: `getFromResourceDirAsStream(path)` / `getFromRulesDirAsStream(path)`
  return a `Uint8Array`, `getFromResourceDirAsLines`/`getAsString` text. APIs that take an
  `InputStream`, `Reader`, `File` or `URL` take a `Uint8Array` or a string instead.
- **XML**: SAX handlers (`DefaultHandler` subclasses) are ported as classes with the same
  `startElement(namespaceURI, lName, qName, attrs)` / `endElement` / `characters(buf, offset, len)`
  methods, driven by the `saxes` npm package (see `jdk/org/xml/sax/` for the adapter).
- **Concurrency, caches, logging**: `ExecutorService`/threads run sequentially; Guava/Caffeine
  caches become `Map`s (bounded where unbounded growth matters); loggers and metrics are dropped.
- **Reflection** (`Class.forName`, rule filters named by class in XML): a registry maps class
  names to constructors; register each ported class there.
- **No DOM**: everything runs in Node (tests, Vitest) and in a Web Worker.
- **Libraries**: use long-lived npm packages rather than porting general-purpose code
  (`oniguruma-to-es` for regexes, `saxes` for XML). Apache Commons / Guava helpers become small
  local functions.

## Testing

Tests are in `tests/unit/languagetool/`. They read the upstream checkout and
`public/languagetool/` directly (Node). LanguageTool's own test data are the best check: the
`<example>` sentences in the rule files (every incorrect example must be found by its rule, every
correct one not) and the Java unit tests (`src/test/java`), which can be added to the sparse
checkout with `git -C upstream/languagetool/languagetool sparse-checkout add <path>`.
