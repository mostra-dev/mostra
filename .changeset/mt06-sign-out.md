---
"@mostra/runtime": minor
"@mostra/shell": minor
"@mostra/themes": minor
---

Signing out of a remote server, and the operator's metering window (all additive within `OPERATOR_REVISION` `2026-11-08`):

- **A person can sign out of the server's sign-in.** Every page of the API origin that shows who is signed in (the sign-in page, linking a machine, a chat app's consent, "Answer as yourself") says "Signed in as Ada · Sign out", and its button ends that browser's sign-in: its session and its cookie go, so the next sign-in in that browser goes through the provider again. `POST /signout` takes the sign-out only from the API origin's own pages or from an operator's own app (an `operatorClients` client, by its pages' exact `Origin`), never from another origin and never by a `GET`; `GET /signout` is a page with one button.
- **An operator's own app signs a person out of both with one "Sign out".** Its form posts to `POST /signout` with OpenID Connect RP-Initiated Logout's `client_id`, `post_logout_redirect_uri` and `state`; the person goes back only to an address listed in the app's metadata document's `post_logout_redirect_uris`. Dynamic Client Registration takes `post_logout_redirect_uris` too. The server's metadata names the sign-out as `end_session_endpoint`.
- **`prompt=login` and `prompt=consent`** on `/oauth/authorize`: a fresh sign-in through the provider whatever the browser's session, and consent asked again; any other `prompt` value is refused with `invalid_request`. The metadata advertises `prompt_values_supported`.
- **A hosted page's viewer chip signs the page out**, and with one more button on the server's "Sign out?" page, the browser's sign-in there too: the page answers as anyone with the link again in that browser, the account's frame sessions end at once, the next "Sign in" asks for a provider again, and drafts and answers stay with whoever made them.
- **Expired sign-ins are swept** hourly: browser sessions, sign-ins never finished, spent codes and expired tokens.
- **`metering.windowSeconds`** in the server's configuration sets how long an operator's metering windows last (whole minutes that divide an hour, 60 seconds by default). Windows now start on multiples of their length, so none straddles an hour, and a longer window means fewer writes of the server's directory.
- `@mostra/themes` gains `signedInLine`, a "Signed in as … · Sign out" line for a server's pages, and `localPath`, which `safeHref` now uses: a path with a tab, a newline, another control character or a backslash, which a browser could read as another origin, is no path of the page's own any more.
