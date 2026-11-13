/**
 * Diagnostic codes of the REMOTE area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the REMOTE area, in the order they were added. */
export const remoteDiagnosticCodes = [
  "MOSTRA_REMOTE_CONFIG_INVALID",
  "MOSTRA_REMOTE_LOGIN_FAILED",
  "MOSTRA_REMOTE_UNREACHABLE",
  "MOSTRA_REMOTE_OWNER_OFFLINE",
  "MOSTRA_REMOTE_QUEUE_FULL",
  "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
  "MOSTRA_REMOTE_SIGN_IN_REQUIRED",
  "MOSTRA_REMOTE_RATE_LIMITED",
  "MOSTRA_REMOTE_PAUSED_BY_OPERATOR",
  "MOSTRA_REMOTE_LIMIT_REACHED",
  "MOSTRA_REMOTE_OPERATOR_UNAVAILABLE",
  "MOSTRA_REMOTE_NO_INSTANCE",
  "MOSTRA_REMOTE_UNDER_REVIEW",
  "MOSTRA_REMOTE_HOME_SUSPENDED",
  "MOSTRA_REMOTE_HOME_MOVING",
  // gen:codes
] as const;

/** The codes of the REMOTE area. */
export type RemoteDiagnosticCode = (typeof remoteDiagnosticCodes)[number];

/** The REMOTE area's catalog entries. */
export const remoteDiagnostics: AreaCatalog<RemoteDiagnosticCode> = {
  MOSTRA_REMOTE_CONFIG_INVALID: {
    severity: "error",
    phase: "host",
    title: "Remote server configuration can't be used",
    hint: "Fix the configuration key the message names, then start mostra-runtime server again.",
    docs: {
      explanation:
        "`mostra-runtime server` reads its configuration (the file `--config` names and `MOSTRA_SERVER_*` variables) before it serves anything, and stops when a key is missing, of the wrong type or out of range, naming the key. Nothing was served.",
      fix: "Correct the key the message names: `apiOrigin` must be an `https:` origin (or `http:` on loopback), and `domains.active` a host name.",
    },
  },
  MOSTRA_REMOTE_LOGIN_FAILED: {
    severity: "error",
    phase: "host",
    title: "Signing in to a remote server failed",
    hint: "Run mostra login again, and approve the code on the server's page within ten minutes.",
    docs: {
      explanation:
        "Signing this home in to a remote server didn't finish: the code expired, the person refused it, the server refused the client, or the binding's access token was refused (revoked, expired, or for another server). Nothing of the home changed; artifacts it owns on that server stay its own.",
      fix: "Sign in to the server again and approve the code on the page it names. A refusal you didn't expect means the sign-in was revoked on the server.",
    },
  },
  MOSTRA_REMOTE_UNREACHABLE: {
    severity: "error",
    phase: "host",
    title: "The remote server can't be reached",
    hint: "Check the network and the server's address, then try again; mostra status shows the link.",
    docs: {
      explanation:
        "The owner instance couldn't reach the remote server that holds this hosted artifact, so a write that must go there (its artifact state, a live value) was refused, never applied locally alone (D165 item 1). Nothing was lost: a page's edit stays in its journal and is sent again.",
      fix: "Run `mostra status` to see each server's link. When the server is back the link reconnects by itself; then write again.",
    },
  },
  MOSTRA_REMOTE_OWNER_OFFLINE: {
    severity: "error",
    phase: "host",
    title: "The artifact's owner instance is offline",
    hint: "Start Mostra on the machine that shared the page, or try again once it is back.",
    docs: {
      explanation:
        "A hosted page called server code its owner instance runs, and the owner instance isn't connected. A plain call isn't kept, so it is refused at once; an action run waits or fails as the artifact's `hosted.offline` says.",
      fix: 'Start Mostra on the owner\'s machine (`mostra daemon start`, or `mostra daemon install` for always-on). An action that must work while the owner is away should be an action run with `hosted.offline.actions: "queue"`.',
    },
  },
  MOSTRA_REMOTE_QUEUE_FULL: {
    severity: "error",
    phase: "host",
    title: "Too many runs wait for the owner",
    hint: "Wait for the owner to come back and work through its queue, then press again.",
    docs: {
      explanation:
        "The artifact's owner instance is offline and as many runs as the server allows already wait for it, or the server's operator allows no more waiting runs for this account now (its `limits` port, `run.wait`, whose message is the operator's own), so this one was refused before anything was recorded. Runs already waiting keep their place.",
      fix: "Bring the owner instance back online: waiting runs then go out in the order they were made. The cap is the server's `relay.waitingRunsPerArtifact` setting, or the operator's limit its message names; its `Retry-After`, when present, says when to try again.",
    },
  },
  MOSTRA_REMOTE_NOT_OWNER_INSTANCE: {
    severity: "error",
    phase: "host",
    title: "Another instance owns this hosted artifact",
    hint: "Share or push this artifact from its owner instance, named in the message.",
    docs: {
      explanation:
        "A hosted artifact has one owner instance: the one that shared it. It alone receives the artifact's submissions, relayed runs and authoring, and only it pushes versions of it (D165 item 1b). Another instance of the same account reads and waits through the hosted home.",
      fix: "Run the command on the instance the message names. Moving an artifact to another owner instance isn't part of this release.",
    },
  },
  MOSTRA_REMOTE_SIGN_IN_REQUIRED: {
    severity: "error",
    phase: "host",
    title: "This action needs a signed-in viewer",
    hint: "Sign in from the page's chrome, or have the owner allow this for anyone with the link.",
    docs: {
      explanation:
        "On a hosted link, an action that runs on the owner's machine, or a submission when the artifact asks for it, needs a viewer signed in (D159, D165 item 13). Nothing was recorded.",
      fix: 'Sign in with the page\'s Sign in. An owner who wants anyone with the link to run actions sets `hosted: { actions: "link" }` in the manifest (and `submissions: "link"` for answers).',
    },
  },
  MOSTRA_REMOTE_RATE_LIMITED: {
    severity: "error",
    phase: "host",
    title: "Too many requests on this link",
    hint: "Try again after the time the answer's Retry-After gives.",
    docs: {
      explanation:
        "Too many requests of this kind came through one link or one address in a short time, past the server's `rateLimits`. Nothing was recorded, and a draft stays as it was.",
      fix: "Wait for the `Retry-After` the answer carries and try again. The limits are the server's `rateLimits` settings.",
    },
  },
  MOSTRA_REMOTE_PAUSED_BY_OPERATOR: {
    severity: "error",
    phase: "host",
    title: "Paused by the server's operator",
    hint: "Contact the server's operator: only the operator resumes a pause it made.",
    docs: {
      explanation:
        "The server's operator paused this hosted artifact, and an owner can't undo an operator's pause (D165 item 14). Views keep working and the links stay valid.",
      fix: "Ask the server's operator why it was paused and to resume it.",
    },
  },
  MOSTRA_REMOTE_LIMIT_REACHED: {
    severity: "error",
    phase: "host",
    title: "The server's limit refused this",
    hint: "Read the message for the server's limit, and try again once it allows the operation.",
    docs: {
      explanation:
        "The server's operator refused the operation for this account (its `limits` port): a share, a version push, a link, a view, a submission, an action or an MCP call. The message is the operator's own. A refused submission keeps its draft.",
      fix: "Follow the operator's message; its `Retry-After`, when present, says when to try again.",
    },
  },
  MOSTRA_REMOTE_OPERATOR_UNAVAILABLE: {
    severity: "error",
    phase: "host",
    title: "The server's operator didn't answer",
    hint: "Try again in a moment; the server's operator didn't answer in time.",
    docs: {
      explanation:
        "The server's operator module didn't answer in time (2 s for limits, 5 s for sign-in), so an operation that creates something (a share, a push, a link, authoring, a sign-in) was refused rather than allowed blind. Views, drafts and submissions never wait for it, and existing sessions keep working.",
      fix: "Try again; if it lasts, the server's operator has to fix its operator module.",
    },
  },
  MOSTRA_REMOTE_NO_INSTANCE: {
    severity: "error",
    phase: "host",
    title: "No owner instance connected",
    hint: "Start Mostra on the machine linked to this account (mostra daemon start), then try again.",
    docs: {
      explanation:
        "Creating, verifying and publishing from a chat host run on the account's default owner instance, through the relay (D165 item 5), and no default instance is connected to the server now. Reading tools (list, wait, results, state, docs, open) keep working.",
      fix: "Start Mostra on the linked machine (`mostra daemon start`, or `mostra daemon install` to keep it running); link a machine first with `mostra login <server> --default`.",
    },
  },
  MOSTRA_REMOTE_UNDER_REVIEW: {
    severity: "error",
    phase: "host",
    title: "This page is under review",
    hint: "Nothing to do here: the server's operator is reviewing this page.",
    docs: {
      explanation:
        "The server's operator quarantined this hosted page, or this version of it, while it reviews it. Its data is kept; the page shows a neutral notice instead of its content until the operator releases it.",
      fix: "The owner can ask the server's operator about the review.",
    },
  },
  MOSTRA_REMOTE_HOME_SUSPENDED: {
    severity: "error",
    phase: "host",
    title: "This account's pages are suspended",
    hint: "Contact the server's operator: this account's pages are suspended.",
    docs: {
      explanation:
        "The server's operator suspended this account's hosted home: its pages, its owner instances' bindings, pushes and links are refused until the operator resumes it. Nothing was deleted.",
      fix: "Ask the server's operator to resume the account.",
    },
  },
  MOSTRA_REMOTE_HOME_MOVING: {
    severity: "error",
    phase: "host",
    title: "This account's pages are moving",
    hint: "Try again in a minute: this account's pages are moving between machines.",
    docs: {
      explanation:
        "The server's operator is moving this account's hosted home to another data directory (`drainHome`), so the home is closed here until it serves again. Clients retry; nothing is lost.",
      fix: "Retry shortly; the move ends when the operator releases the home on its new machine.",
    },
  },
  // gen:entries
};
