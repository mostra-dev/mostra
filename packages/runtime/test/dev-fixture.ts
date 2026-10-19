/**
 * The fixture `mostra dev`'s suites preview: a page with a field, a server function and a
 * Submit, written so a test can change its heading and its server code's answer.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Writes the fixture into `dir`. */
export function writeDevFixture(dir: string, heading = "HEADING-ONE", server = "SERVER-ONE"): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.tsx"),
    `import { defineArtifact, useAction, useField, useSubmit } from "@mostra/react";
import { whoAmI } from "./actions";

export const artifact = defineArtifact({ title: "Dev fixture" });

export default function Page() {
  const [answer, setAnswer] = useField("answer", "");
  const { submit } = useSubmit();
  const action = useAction(whoAmI);
  return (
    <main>
      <h1 id="title">${heading}</h1>
      <input id="answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
      <button id="call" type="button" onClick={() => void action.run()}>Call</button>
      <p id="server">{String(action.data ?? "")}</p>
      <button id="submit" type="button" onClick={() => void submit()}>Submit</button>
    </main>
  );
}
`,
  );
  writeFileSync(
    join(dir, "actions.ts"),
    `"use server";\nexport async function whoAmI() {\n  return "${server}";\n}\n`,
  );
}
