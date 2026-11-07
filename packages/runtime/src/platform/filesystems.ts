/**
 * Whether a directory is on a network filesystem (D165 item 0b, DATA_MODEL §7.1): a remote
 * server's data directory never is, since its locks and SQLite's WAL need a local disk, and a
 * lock a network filesystem only pretends to hold would let two servers write one home.
 *
 * - **Linux:** the filesystem's magic number from `statfs(2)`: NFS, SMB, CIFS, SMB2, Ceph,
 *   AFS, Coda, 9P and FUSE (a FUSE mount may be sshfs or s3fs; a local FUSE data directory is
 *   refused too, rather than guessed at).
 * - **macOS:** the filesystem's name (`stat -f %T`): `nfs`, `smbfs`, `afpfs`, `webdav`,
 *   `macfuse`/`osxfuse` and other FUSE names.
 * - **Windows:** a UNC path (`\\server\share`), or a drive Windows reports as remote
 *   (`GetDriveTypeW`, through `fsutil fsinfo drivetype`).
 *
 * Answers the filesystem's name when it is a network one, `undefined` when it is local or can't
 * be told (a check that can't run never refuses a disk it can't classify).
 */
import { execFileSync } from "node:child_process";
import { statfsSync } from "node:fs";
import { parse } from "node:path";

/** Linux `statfs` magic numbers of network and user-space filesystems. */
const LINUX_NETWORK: ReadonlyMap<number, string> = new Map([
  [0x6969, "nfs"],
  [0x517b, "smb"],
  [0xff534d42, "cifs"],
  [0xfe534d42, "smb2"],
  [0x00c36400, "ceph"],
  [0x5346414f, "afs"],
  [0x73757245, "coda"],
  [0x01021997, "9p"],
  [0x65735546, "fuse"],
]);

const MAC_NETWORK = /^(nfs|smbfs|afpfs|webdav|cifs|ftp|macfuse|osxfuse|fuse.*)$/i;

/** The network filesystem `dir` is on, or `undefined` (local, or not knowable). */
export function networkFilesystem(dir: string): string | undefined {
  if (process.platform === "linux") {
    try {
      // `type` is a signed long on some systems: compare as unsigned 32-bit.
      const type = statfsSync(dir).type >>> 0;
      return LINUX_NETWORK.get(type);
    } catch {
      return undefined;
    }
  }
  if (process.platform === "darwin") {
    try {
      const name = execFileSync("/usr/bin/stat", ["-f", "%T", dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return MAC_NETWORK.test(name) ? name : undefined;
    } catch {
      return undefined;
    }
  }
  if (process.platform === "win32") {
    if (/^\\\\[^\\?.]/.test(dir)) return "unc";
    const drive = parse(dir).root.replace(/\\$/, "");
    if (!/^[A-Za-z]:$/.test(drive)) return undefined;
    try {
      const answer = execFileSync(
        `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\fsutil.exe`,
        ["fsinfo", "drivetype", drive],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        },
      );
      return /remote|network/i.test(answer) ? "remote" : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
