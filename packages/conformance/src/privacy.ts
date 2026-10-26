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

/** `CREATOR OWNER`: an inheritable entry for whoever creates a child, which in an owner-only
 * directory only the user or `SYSTEM` can do (Opus review of WP-W3, finding 7). */
const CREATOR_OWNER = new Set(["CO", "S-1-3-0"]);

/** The entry types that deny: they grant no one anything (finding 7). */
const DENY = new Set(["D", "OD", "XD"]);

/**
 * The SIDs this machine's own account aliases stand for: SDDL writes the built-in Administrator
 * (`LA`) and Guest (`LG`) of the local machine by alias (GitHub's runners run as the former). An
 * alias is the user only when it resolves to exactly the user's SID, never by its relative ID
 * alone: a domain's Administrator ends in -500 too (finding 6). An alias that couldn't be resolved
 * is no one's, so its entry fails the check.
 */
export type AccountAliases = Readonly<Record<string, string>>;

/** Whether an SDDL trustee (a SID or an alias) is the user `user` (a SID). */
function isUser(trustee: string, user: string, aliases: AccountAliases): boolean {
  return trustee === user || (Object.hasOwn(aliases, trustee) && aliases[trustee] === user);
}

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
  const { sddl, aliases } = windowsSddl(path);
  return judgeSddl(sddl, windowsUser(), statSync(path).isDirectory(), aliases);
}

/** What is wrong with a Windows access list (`sddl`) for the user `user` (a SID). */
export function judgeSddl(
  sddl: string,
  user: string,
  directory: boolean,
  aliases: AccountAliases = {},
): string | undefined {
  const start = sddl.indexOf("D:");
  if (start < 0) return `no access list (${sddl})`;
  const rest = sddl.slice(start + 2);
  const end = rest.search(/S:/);
  const dacl = end < 0 ? rest : rest.slice(0, end);
  const flags = dacl.slice(0, dacl.indexOf("(") < 0 ? dacl.length : dacl.indexOf("("));
  // A NULL access list (the flag `NO_ACCESS_CONTROL`, beside any others) holds no entry and
  // grants everyone everything (GPT review of WP-W3).
  if (flags.includes("NO_ACCESS_CONTROL"))
    return `its access list is NULL, which grants everyone access (${dacl})`;
  if (directory && !flags.includes("P")) return `its access list inherits from above (${dacl})`;
  for (const ace of dacl.matchAll(/\(([^)]*)\)/g)) {
    const fields = (ace[1] ?? "").split(";");
    const [type, , , , , sid] = fields;
    if (type !== undefined && DENY.has(type)) continue;
    if (
      sid === undefined ||
      !(isUser(sid, user, aliases) || SYSTEM.has(sid) || CREATOR_OWNER.has(sid))
    ) {
      return `it grants ${sid ?? "someone"} access (${dacl})`;
    }
  }
  return undefined;
}

function windowsUser(): string {
  // Windows' own, by path: a `whoami` earlier on `PATH` (Git's coreutils) takes no `/user`.
  const system = process.env["SystemRoot"] ?? "C:\\Windows";
  const answer = spawnSync(`${system}\\System32\\whoami.exe`, ["/user", "/fo", "csv", "/nh"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const sid = /"(S-1-[0-9-]+)"/.exec(answer.stdout ?? "")?.[1];
  if (sid === undefined) throw new Error(`whoami named no SID: ${answer.stdout}${answer.stderr}`);
  return sid;
}

/** The path's SDDL, and the SIDs of this machine's `LA` and `LG` (absent when unresolvable). */
function windowsSddl(path: string): { sddl: string; aliases: AccountAliases } {
  const system = process.env["SystemRoot"] ?? "C:\\Windows";
  const answer = spawnSync(
    `${system}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "(Get-Acl -LiteralPath $env:MOSTRA_KIT_PATH).Sddl",
        // Single quotes only: Windows PowerShell 5 takes double quotes in `-Command` apart.
        "foreach ($a in 'LA','LG') { try { $a + '=' + ([Security.Principal.SecurityIdentifier]$a).Value } catch { $a + '=' } }",
      ].join("; "),
    ],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, MOSTRA_KIT_PATH: path } },
  );
  const [sddl = "", ...rest] = (answer.stdout ?? "").trim().split(/\r?\n/);
  if (answer.status !== 0 || sddl.trim() === "") {
    throw new Error(`Get-Acl couldn't read ${path}: ${answer.stderr}`);
  }
  const aliases: Record<string, string> = {};
  for (const line of rest) {
    const match = /^(LA|LG)=(S-1-[0-9-]+)\s*$/.exec(line.trim());
    if (match) aliases[match[1] as string] = match[2] as string;
  }
  return { sddl: sddl.trim(), aliases };
}
