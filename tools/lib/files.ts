/**
 * One walk of a directory tree for the repository's tools: every entry below a directory, its
 * kind as it is on disk (a link is reported, never followed), sorted by path. Building the plugin
 * refuses links, checking it reports them, and the version sync reads the Skill's Markdown, all
 * through this one walk (WP-14's Opus review, finding 10).
 */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** One entry of a tree. */
export interface TreeEntry {
  /** Its path relative to the walked directory, with `/` separators. */
  readonly path: string;
  readonly kind: "file" | "directory" | "link" | "other";
}

/** Every entry below `dir`, directories included, links never followed, sorted by path. */
export function walkTree(dir: string): TreeEntry[] {
  const out: TreeEntry[] = [];
  const visit = (prefix: string): void => {
    for (const name of readdirSync(prefix === "" ? dir : join(dir, prefix))) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const stat = lstatSync(join(dir, path));
      const kind = stat.isSymbolicLink()
        ? "link"
        : stat.isDirectory()
          ? "directory"
          : stat.isFile()
            ? "file"
            : "other";
      out.push({ path, kind });
      if (kind === "directory") visit(path);
    }
  };
  visit("");
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
