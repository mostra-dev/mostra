/**
 * Unpacking a downloaded archive (RT-01). Only regular files, directories and symbolic links are
 * accepted, all under the archive's one top directory, which is stripped; node-tar refuses
 * absolute paths, `..` and links that leave the target. The tree is then checked against the
 * bundle's file list by setup, so anything the archive smuggled in is found there too.
 */
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { x } from "tar";

const ACCEPTED = new Set(["File", "OldFile", "ContiguousFile", "Directory", "SymbolicLink"]);

/** Extracts `archive` (a `.tar.gz` with one top directory `top`) into the empty directory `into`. */
export async function extractBundle(archive: string, into: string, top: string): Promise<void> {
  let refused: string | undefined;
  try {
    await x({
      file: archive,
      cwd: into,
      strip: 1,
      strict: true,
      preservePaths: false,
      preserveOwner: false,
      // Owner-only directories are tightened later; files keep their 0644/0755 modes.
      noChmod: false,
      filter: (path, entry) => {
        const type = "type" in entry ? String(entry.type) : "File";
        const inside = path === `${top}/` || path === top || path.startsWith(`${top}/`);
        if (!inside || !ACCEPTED.has(type)) {
          refused ??= `${path} (${type})`;
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // The file system failing (a full disk, a permission) isn't the archive's fault.
    if (typeof code === "string" && /^E[A-Z]+$/.test(code) && code !== "EOF") {
      throw new RpcError(
        createDiagnostic("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED", {
          message: `The runtime bundle couldn't be written to ${into}: ${(error as Error).message}${code === "ENOSPC" ? " (the disk is full)" : ""}`,
        }),
      );
    }
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", {
        message: `The runtime bundle's archive couldn't be read: ${(error as Error).message}`,
      }),
    );
  }
  if (refused !== undefined) {
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", {
        message: `The runtime bundle's archive holds an entry a bundle never has: ${refused}.`,
      }),
    );
  }
}
