/**
 * The two platform globals this package uses, which every engine it runs in (Node.js, browsers,
 * workers) provides. Declared here so the neutral build depends on neither DOM nor Node.js types.
 */
declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
  readonly protocol: string;
  readonly hostname: string;
}
interface ImportMeta {
  readonly url: string;
}
