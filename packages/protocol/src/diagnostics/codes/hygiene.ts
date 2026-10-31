/**
 * Diagnostic codes of the HYGIENE area: requests the gateway refuses because they don't come from
 * the holder of an artifact's capability URL (D06, HY-01). None of them limits what an artifact
 * or an agent may do; each keeps strangers out.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the HYGIENE area, in the order they were added. */
export const hygieneDiagnosticCodes = [
  "MOSTRA_HYGIENE_HOST_REFUSED",
  "MOSTRA_HYGIENE_ORIGIN_REFUSED",
  "MOSTRA_HYGIENE_CSRF_MISSING",
  "MOSTRA_HYGIENE_CONTENT_TYPE",
  "MOSTRA_HYGIENE_REQUEST_MALFORMED",
  "MOSTRA_HYGIENE_SESSION_MISSING",
  "MOSTRA_HYGIENE_TOKEN_INVALID",
  "MOSTRA_HYGIENE_TOKEN_REVOKED",
  "MOSTRA_HYGIENE_SCOPE_DENIED",
  "MOSTRA_HYGIENE_RATE_LIMITED",
  "MOSTRA_HYGIENE_NOT_SERVED",
  "MOSTRA_HYGIENE_SESSION_CONFLICT",
  "MOSTRA_HYGIENE_HEADERS_TOO_LARGE",
  "MOSTRA_HYGIENE_FRAME_SESSION",
  // gen:codes
] as const;

/** The codes of the HYGIENE area. */
export type HygieneDiagnosticCode = (typeof hygieneDiagnosticCodes)[number];

/** The HYGIENE area's catalog entries. */
export const hygieneDiagnostics: AreaCatalog<HygieneDiagnosticCode> = {
  MOSTRA_HYGIENE_HOST_REFUSED: {
    severity: "error",
    phase: "hygiene",
    title: "Host not served",
    hint: "Open the artifact through the exact link Mostra gave you.",
    docs: {
      explanation:
        "The request's `Host` header named a host this gateway doesn't serve. Each gateway listener accepts exactly the host and port its capability URLs use, so a page that rebinds its own DNS name to the loopback address can't reach an artifact (DNS rebinding). The gateway answers 421.",
      fix: "Use the URL from `view/url` or the publish receipt as it is, without replacing `127.0.0.1` by `localhost` or another name. A gateway started with `--bind` and `--url-host` accepts the URL host it was given.",
    },
  },
  MOSTRA_HYGIENE_ORIGIN_REFUSED: {
    severity: "error",
    phase: "hygiene",
    title: "Origin refused",
    hint: "Send the request from the page's own origin.",
    docs: {
      explanation:
        "A request that changes state, opens a stream or upgrades to a WebSocket must carry an `Origin` header equal to the origin it is sent to. The gateway compares the strings exactly and answers 403 otherwise, so another website, or another artifact on a different port, can't drive this one.",
      fix: "Call the gateway from the page it serves: the shell from the shell, the artifact from its own frame. Tools outside a browser send the listener's own origin.",
    },
  },
  MOSTRA_HYGIENE_CSRF_MISSING: {
    severity: "error",
    phase: "hygiene",
    title: "CSRF token missing or wrong",
    hint: "Send the session's CSRF token from `GET /_mostra/session` in the `X-Mostra-CSRF` header.",
    docs: {
      explanation:
        "Every request that changes state through a session carries the session's CSRF token in the `X-Mostra-CSRF` header. The token comes only from the session endpoint of the same origin, which no other page can read. A missing or different token is answered with 403.",
      fix: "Read `csrf` from `GET /_mostra/session` (on the shell, `GET /a/<artifactId>/_mostra/session`) and send it with every POST. Mostra's client runtime and shell do this for you.",
    },
  },
  MOSTRA_HYGIENE_CONTENT_TYPE: {
    severity: "error",
    phase: "hygiene",
    title: "JSON content type required",
    hint: "Send the body as JSON with `Content-Type: application/json`.",
    docs: {
      explanation:
        "Requests that change state must have a JSON body. A form or plain-text body is something any website can send without asking the browser first, so the gateway refuses it with 415.",
      fix: "Send `Content-Type: application/json` and a JSON body.",
    },
  },
  MOSTRA_HYGIENE_REQUEST_MALFORMED: {
    severity: "error",
    phase: "hygiene",
    title: "Malformed request",
    hint: "Send one well-formed HTTP request with a path that starts with `/`.",
    docs: {
      explanation:
        "The gateway refused a request it can't interpret safely: a repeated `Host` or `Origin` header, a request target that isn't a path, an encoded `/` or `..` that would leave the served tree, a body that isn't valid JSON, or a header with control characters. It answers 400 rather than guess.",
      fix: "Send a single request with one `Host` header and a plain path. Browsers always do; this usually means a hand-written client or a probe.",
    },
  },
  MOSTRA_HYGIENE_SESSION_MISSING: {
    severity: "error",
    phase: "hygiene",
    title: "No session",
    hint: "Open the artifact's capability link again to start a session.",
    docs: {
      explanation:
        "The request carried no valid session for this origin. Sessions start when a capability link is opened: the shell exchanges the link's token for a session cookie, and gives the artifact frame a single-use ticket for its own. A session issued for another origin never counts, because every port of the host shares the browser's cookies. The gateway answers 401.",
      fix: "Open the full capability link, including the part after `#`. A bookmark of the page without it works while the browser keeps the session cookie (400 days).",
    },
  },
  MOSTRA_HYGIENE_TOKEN_INVALID: {
    severity: "error",
    phase: "hygiene",
    title: "Unknown capability token",
    hint: "Use the complete capability link Mostra gave you, or mint a new one with `view/url`.",
    docs: {
      explanation:
        "The capability token or frame ticket matched nothing in this home: it was mistyped, cut short, belongs to another home or artifact, or the ticket was already used or expired (tickets last 60 seconds and work once). Over the host protocol, the token ID named in `view/revoke` or `view/rotate` doesn't exist. The gateway answers 401, and failed attempts count towards the rate limit.",
      fix: "Copy the whole link again. An agent or host mints a fresh one with `view/url`; the shell gets a new frame ticket by reloading.",
    },
  },
  MOSTRA_HYGIENE_TOKEN_REVOKED: {
    severity: "error",
    phase: "hygiene",
    title: "Link revoked or expired",
    hint: "Ask for a new link: `view/url` mints one, or `view/rotate` replaces this one.",
    docs: {
      explanation:
        "The capability link was revoked (`view/revoke`), replaced (`view/rotate`), or reached the end of its `ttl`. Every session started from it ends too. The gateway answers 410. Local links have no expiry unless one was asked for.",
      fix: "Get a new link from whoever shared this one. An agent mints it with `view/url`, or rotates the old one with `view/rotate`, and shares the new URL.",
    },
  },
  MOSTRA_HYGIENE_SCOPE_DENIED: {
    severity: "error",
    phase: "hygiene",
    title: "Not allowed by this link",
    hint: "Open a link minted with this scope (`view/url` with `scopes`).",
    docs: {
      explanation:
        "The session's link doesn't carry the scope this request needs: `draft` to save answers, `submit` to submit, `review` to comment, and `action:*`, `action:<export>` or `action:<module path>#<export>` to run a server function. A view-and-comment link, for example, can't submit or run an action. The gateway answers 403.",
      fix: 'Mint a link with the scopes the viewer needs, such as `view/url` with `scopes: ["view", "draft", "submit"]`. Without `scopes`, a link carries every scope.',
    },
  },
  MOSTRA_HYGIENE_RATE_LIMITED: {
    severity: "error",
    phase: "hygiene",
    title: "Too many failed attempts",
    hint: "Wait for the time in `Retry-After`, then open the link again.",
    docs: {
      explanation:
        "More than 30 capability tokens failed for this artifact within a minute, so the gateway refuses every token for it, valid ones included, until the minute has passed. A guess can't succeed while the limit holds, and only this artifact's links wait. The gateway answers 429 with `Retry-After`.",
      fix: "Wait, then open the link again. Repeated failures usually come from a mistyped link or a script retrying an old one.",
    },
  },
  MOSTRA_HYGIENE_NOT_SERVED: {
    severity: "error",
    phase: "hygiene",
    title: "Nothing served here",
    hint: "Request a published version's files or a documented `/_mostra/` path.",
    docs: {
      explanation:
        "The gateway serves only published versions' client files and the browser-protocol paths under `/_mostra/`. Everything else in the home, such as sources, server bundles, staging and unpublished builds, has no URL. A path or method nothing answers gets 404 or 405.",
      fix: "Check the path. Server code runs through the browser protocol, never as a file, and an artifact becomes viewable only once it is published.",
    },
  },
  MOSTRA_HYGIENE_SESSION_CONFLICT: {
    severity: "warning",
    phase: "hygiene",
    title: "Another link is already open for this artifact",
    hint: "Choose which link to keep; send `replace: true` to use the new one.",
    docs: {
      explanation:
        "This browser already has a live session for the artifact from a different link. Opening a link never silently replaces it, because a page elsewhere could send the viewer to its own, narrower link and take over their tabs (D98). The shell shows both links' access and lets the viewer choose; the answer is 409 with `current` and `offered`.",
      fix: "In the shell, choose the link to keep. A client exchanging tokens itself sends `replace: true` to replace the session.",
    },
  },
  MOSTRA_HYGIENE_HEADERS_TOO_LARGE: {
    severity: "error",
    phase: "hygiene",
    title: "The request's headers are too large",
    hint: "Open the link again: this page cleared the cookies that made the request too large.",
    docs: {
      explanation:
        "The request's headers passed the gateway's limit of 1 MiB, more than any browser sends for one host's cookies. Every port of the loopback host shares one cookie jar, so a page on any of them can fill it. The gateway answers 431 with `Clear-Site-Data: \"cookies\"`, which empties the host's cookies, so the next request works. Mostra's sessions go with them and come back when a link is opened again.",
      fix: "Open the artifact's link again. If it keeps happening, find the page that sets the cookies: it runs on this host.",
    },
  },
  MOSTRA_HYGIENE_FRAME_SESSION: {
    severity: "error",
    phase: "hygiene",
    title: "Frame session couldn't start",
    hint: "Open the artifact's tailnet or Funnel link, or this link in a normal window of another browser.",
    docs: {
      explanation:
        "Where the shell and the artifact are two sites (a Cloudflare quick tunnel, or a host's addresses on two hosts), the artifact's frame can't use a cookie: it enters through a bootstrap page that installs Mostra's service worker at `/`, which signs every request of the frame (worker mode, D70). Mostra reports this code when that can't happen: the browser offers the frame no service worker (a private window, a setting that blocks third-party storage), refuses to install it, or the gateway refused the frame's entry. The client runtime reports it too when the artifact's own code registers another service worker at `/`, which would replace Mostra's and end the frame's session.",
      fix: "Open the artifact through a tailnet or Funnel share, where the frame uses a cookie, or in a browser window that allows service workers in frames. An artifact that needs its own service worker registers it at a narrower scope than `/`.",
    },
  },
  // gen:entries
};
