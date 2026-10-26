/**
 * Whether a path of a host's home is owner-only, as the kit judges it (H-16, D44, D85, D150
 * item 3): on POSIX by its mode (`0700` for a directory, `0600` for a file); on Windows by its
 * access list, which allows no one but the user and `SYSTEM`, and for a directory is protected
 * (inherits nothing from above; a file inside inherits the directory's). Windows has no modes, and Node.js reads no access list, so the kit reads the
 * list's SDDL (the same in every language) through Windows PowerShell's `Get-Acl`, and the user's
 * SID through `whoami`.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

/** `SYSTEM`, as SDDL names it by alias and by SID. */
const SYSTEM = new Set(["SY", "S-1-5-18"]);

/** What is wrong with `path`'s privacy, or `undefined` when it is owner-only. */
export function notOwnerOnly(
  path: string,
  platform: string = process.platform,
): string | undefined {
  if (platform !== "win32") {
    const stats = statSync(path);
    const want = stats.isDirectory() ? 0o700 : 0o600;
    const mode = stats.mode & 0o777;
    return mode === want ? undefined : `mode ${mode.toString(8)}, not ${want.toString(8)}`;
  }
  return judgeSddl(windowsSddl(path), windowsUser(), statSync(path).isDirectory());
}

/** What is wrong with a Windows access list (`sddl`) for the user `user` (a SID). */
export function judgeSddl(sddl: string, user: string, directory: boolean): string | undefined {
  const start = sddl.indexOf("D:");
  if (start < 0) return `no access list (${sddl})`;
  const rest = sddl.slice(start + 2);
  const end = rest.search(/S:/);
  const dacl = end < 0 ? rest : rest.slice(0, end);
  const flags = dacl.slice(0, dacl.indexOf("(") < 0 ? dacl.length : dacl.indexOf("("));
  if (directory && !flags.includes("P")) return `its access list inherits from above (${dacl})`;
  for (const ace of dacl.matchAll(/\(([^)]*)\)/g)) {
    const fields = (ace[1] ?? "").split(";");
    const [type, , , , , sid] = fields;
    if (type === "D") continue;
    if (sid === undefined || !(sid === user || SYSTEM.has(sid))) {
      return `it grants ${sid ?? "someone"} access (${dacl})`;
    }
  }
  return undefined;
}

function windowsUser(): string {
  const answer = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const sid = /"(S-1-[0-9-]+)"/.exec(answer.stdout ?? "")?.[1];
  if (sid === undefined) throw new Error(`whoami named no SID: ${answer.stdout}${answer.stderr}`);
  return sid;
}

function windowsSddl(path: string): string {
  const system = process.env["SystemRoot"] ?? "C:\\Windows";
  const answer = spawnSync(
    `${system}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Acl -LiteralPath $env:MOSTRA_KIT_PATH).Sddl",
    ],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, MOSTRA_KIT_PATH: path } },
  );
  const sddl = (answer.stdout ?? "").trim();
  if (answer.status !== 0 || sddl === "") {
    throw new Error(`Get-Acl couldn't read ${path}: ${answer.stderr}`);
  }
  return sddl;
}
