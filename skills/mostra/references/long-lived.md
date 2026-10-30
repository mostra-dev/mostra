# Long-lived pages: shared state, live data, always on

A dashboard open all week, a task list a team works through, a status page you keep updating: these pages don't end in one submission. They use the `none` policy (no Submit), shared fields, live sources, actions and signals.

## Contents

- Shared state
- Live data
- Talking without a Submit
- New versions of a page people keep open
- Always on

## Shared state

A field with `scope: "artifact"` is shared: every viewer sees and edits the same value, and so can you from the command line.

```tsx
type Task = { id: string; title: string; done: boolean };
const [tasks, setTasks, meta] = useField("tasks", [] as Task[], { label: "Tasks", scope: "artifact" });
// meta.updatedBy: { kind: "viewer" | "agent" | "host", name? } of the last change
```

```sh
mostra state get ./tasks                                   # every shared field, with the revision
mostra state set ./tasks priorities '["Ship the CLI"]'      # one field, as the agent
mostra state patch ./tasks --ops '[{"id":"tasks","value":[]},{"id":"old","delete":true}]'
mostra state set ./tasks priorities '["Ship the CLI","Fix #12"]' --base 41   # only if unchanged since revision 41, else exit 6
mostra wait ./tasks --until state:tasks --timeout 1h        # when a person changes it
```

- Writes are compare-and-set per field. Two writers changing the same field get a conflict, never a silent overwrite: the page shows `meta.conflict`, and the CLI exits 6 when `--base` is stale. Read again, merge, write again.
- Server code writes the same fields with `state.set(id, value)` and `state.patch(ops)` from `@mostra/server`.
- A person's own fields (the default `scope: "viewer"`) stay private to their link; shared fields are the same for everyone.

## Live data

A live source is a value that updates without a new version: prices, build status, a feed. Define producers in `live.ts` (this exact name):

```ts
// live.ts
import { defineLive, secret } from "@mostra/server";

export const builds = defineLive({
  refresh: "30s",                                  // load again every 30 s while someone looks
  load: async () => (await fetch("https://ci.example/api/builds", { headers: { authorization: secret("CI_TOKEN") } })).json(),
});

export const latency = defineLive({
  ring: 600,                                       // keep the last 600 values for charts
  stream: async function* (signal) {
    while (!signal.aborted) {
      yield { at: Date.now(), ms: await probe() };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  },
});

export const config = defineLive({ watch: "data/*.json", load: async () => readConfig() });   // when a file changes
```

```tsx
import { useLive } from "@mostra/react";

const builds = useLive("builds");                                      // { data, isLoading, error, refresh(), revision, at }
const latency = useLive("latency", { mode: "append", window: 300 });   // data: the last 300 values
```

- A source needs `load`, `stream` or both. `refresh` is `1s` to `24h`. `always: true` keeps it running with nobody looking; otherwise producers run while a page shows the source and stop a minute after.
- The latest value is kept, so a page opening later shows it at once, with `at` saying when it was produced. A failing producer sets `error` and keeps the last good value; show both.
- `useLive` keys and value types come from `live.ts` automatically.
- You can feed a source from outside too, with no `live.ts` entry needed: `mostra push ./dash builds --value '{"passing":12,"failing":1}'`, or `--append` to add to its ring. Values are up to 4 MiB.
- Live updates aren't events: nothing wakes you when they change.

## Talking without a Submit

With `{ policy: "none" }` the page has no Submit. It talks to you through:

- shared fields you watch with `mostra wait <dir> --until state:<fieldId>`;
- signals the page sends (`useSignal`) or server code raises (`signal()`), watched with `mostra wait <dir> --until signal:<name>`;
- actions that do the work themselves ([server.md](server.md)).

`mostra wait <dir> --until submitted` is refused under `none` (`MOSTRA_SUBMIT_POLICY_NONE`).

## New versions of a page people keep open

Publishing again shows a banner on open pages: "Switch", "Always follow this artifact" and "Later". A person who chose to follow gets new versions by themselves, unless they have unsaved edits or answers that wouldn't carry over. Keep field IDs stable so nothing is left behind.

## Always on

Mostra's background process stops after 30 idle minutes, and links stop answering until a command starts it again. A page that must answer at any hour needs the login service:

```sh
mostra daemon install     # launchd on macOS, systemd on Linux, Task Scheduler on Windows
mostra daemon status
mostra doctor             # warns about `none` pages in a home without it
```

`mostra daemon uninstall` removes it again.
