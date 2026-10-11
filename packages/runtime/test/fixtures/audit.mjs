// Records every module this process loads, through Node's synchronous module hooks, and writes the
// list to MOSTRA_TEST_AUDIT_FILE when the process exits. The RT-02 process audit preloads it into a
// real supervisor with `--import`.
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const loaded = new Set();
registerHooks({
  load(url, context, nextLoad) {
    loaded.add(url);
    return nextLoad(url, context);
  },
});
process.on("exit", () => {
  const target = process.env.MOSTRA_TEST_AUDIT_FILE;
  if (target) writeFileSync(target, JSON.stringify([...loaded].sort(), null, 1));
});
