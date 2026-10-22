// Disposable probe for WP-W1 (removed before merging): does a sealed version stop its owner's
// writes on the runner, and which privileges does a Node.js process there hold?
import { execFileSync, execSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const helper = resolve(process.argv[2]);
const dir = mkdtempSync(join(tmpdir(), "seal-"));
mkdirSync(join(dir, "client"));
writeFileSync(join(dir, "client", "a.js"), "x");
console.log(
  "privileges",
  execSync("C:\\Windows\\System32\\whoami.exe /priv", { encoding: "utf8" })
    .split("\n")
    .filter((line) => /Backup|Restore|TakeOwnership|Security/.test(line))
    .join("\n"),
);
console.log("seal", execFileSync(helper, ["seal", dir], { encoding: "utf8" }).trim());
const attempt = (label, body) => {
  try {
    body();
    console.log(label, "SUCCEEDED");
  } catch (error) {
    console.log(label, "refused", error.code);
  }
};
attempt("writeFileSync existing", () => writeFileSync(join(dir, "client", "a.js"), "y"));
attempt("openSync r+", () => closeSync(openSync(join(dir, "client", "a.js"), "r+")));
attempt("writeFileSync new", () => writeFileSync(join(dir, "client", "b.js"), "y"));
console.log("icacls", execSync(`icacls "${join(dir, "client", "a.js")}"`, { encoding: "utf8" }));
