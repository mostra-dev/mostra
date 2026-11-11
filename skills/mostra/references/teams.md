# Teams: several people on one page

Read this when more than one person answers the page, when you need to know who has answered, or when people work on it together.

## Send one page to a team

1. **Take one submission per person.** In the manifest, `submission: { policy: "once", scope: "per-viewer" }` (one answer each), or `{ policy: "epochs" }` (each can answer again; a round ends when everyone has). *Done when* the manifest names one of the two.
2. **Name the people you expect.** After `mostra publish <dir>`:

   ```sh
   mostra roster add <dir> ada@example.com grace@example.com alan@example.com
   mostra roster add <dir> ada@example.com --name "Ada Lovelace"   # a display name for one person
   ```

   The ref is your own stable key for each person (an email, an account ID). Each gets a **personal link** that acts as them: their own draft, their own submission, their name on what they change. Adding someone again keeps their link and updates their name. On a remote server, `mostra share <dir> --cloud --respondent ada@example.com,grace@example.com` hosts the page and names them at once. *Done when* every expected person has a link.
3. **Give each person their own link.** One link is one person: a link sent to two people makes them one respondent. *Done when* each link has gone to its person.
4. **Wait for everyone.** `mostra wait <dir> --until submitted:all --timeout 1h` returns once every expected respondent has submitted; under `epochs` it returns at the end of each round. `--until submitted:5` waits for five submissions from anyone. Exit 5 means still waiting: nothing is lost. *Done when* it exits 0.
5. **Read every answer.** `mostra results <dir> --all` prints every submission, oldest first. *Done when* you've used each person's answers.

`mostra roster get <dir>` shows who is expected and where each stands: `not-opened`, `drafting` or `submitted`. `mostra roster remove <dir> <ref>` stops expecting someone; their link and answers stay.

## Show the team on the page

The shell draws nothing about other people: the page shows them in its own design.

```tsx
import { useField, usePresence, useRespondents } from "@mostra/react";

function Progress() {
  const { counts } = useRespondents();
  if (!counts) return null;                          // visibility "private": only the owner sees counts
  return <p>{counts.submitted} of {counts.total} answered</p>;
}

function Cursors() {
  const { others } = usePresence({ cursor: true });  // shares this viewer's pointer while mounted
  return (
    <>
      {others.map((peer) =>
        peer.cursor ? (
          <span key={peer.key} className="pointer-events-none absolute text-xs"
            style={{ left: peer.cursor.x, top: peer.cursor.y }}>
            ▲ {peer.name}
          </span>
        ) : null,
      )}
    </>
  );
}

function SharedNotes() {
  const [text, setText, meta] = useField("team.notes", "", { scope: "artifact", label: "Notes" });
  const who = meta.updatedBy;                        // { name, at, self, key } of the last change
  return (
    <label>
      Notes
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      {who && <small>{who.self ? "You" : who.name} changed this</small>}
    </label>
  );
}
```

- `useRespondents()` gives `self` (this viewer's own entry, when they are expected), `counts`, `complete` and `respondents`, each with `key`, `name` and `status`, as far as the visibility allows.
- `usePresence({ cursor, selection })` gives `others`, the people here now, each with `key`, `name` and what they share. `cursor` is the pointer in document coordinates; `selection` names the focused element by its `data-presence-id`, `id` or `name`. Nothing is shared without the hook, and nothing is ever stored.
- A person's `key` is the same in `useRespondents`, `usePresence` and a shared field's `meta.updatedBy`, so the page can match them.

## What people see of each other

The manifest's `team: { visibility }` decides what a viewer sees of the others:

| `visibility` | A respondent sees |
|---|---|
| `"private"` (the default) | Their own entry only |
| `"counts"` | Also how many are expected, drafting and submitted, and how many are here now |
| `"names"` | Also each person by name, their status, and who is here with their cursor |

The page's owner sees everyone in every case, and you see everything through `mostra roster get`. Attribution of shared fields (`meta.updatedBy`) is always shown.
