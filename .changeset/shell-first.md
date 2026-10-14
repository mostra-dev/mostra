---
"@mostra/shell": minor
---

First release of the shell: the trusted page a capability link opens. It exchanges the link's
token for a session, removes the token from the address bar and shows the artifact in a frame on
its own origin, over the validated bridge. The frame can't replace the shell page, and opening a
second link for an artifact asks before it replaces the session.
