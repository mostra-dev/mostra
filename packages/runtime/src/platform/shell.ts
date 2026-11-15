/**
 * A value as one word of a command a diagnostic's fix names (`mostra add … --artifact <path>`),
 * for the shell an agent pastes it into: POSIX quoting, or on Windows the double quotes PowerShell
 * and `cmd` both read (a Windows path holds no `"`). A plain word stays as it is: letters, digits
 * and `@%+=:,./-`, a backslash on Windows, and a `~` that doesn't start the word (a short Windows
 * name such as `RUNNER~1`; a leading one would be a POSIX shell's home).
 */
import { WINDOWS } from "./directories.ts";

/** `value` as one shell word. */
export function shellWord(value: string): string {
  if (WINDOWS) return /^[\w@%+=:,./\\~-]+$/.test(value) ? value : `"${value}"`;
  return /^(?!~)[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
