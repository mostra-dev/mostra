/**
 * The API origin's own pages (INTERFACES §18.5, D171): sign-in with its providers, the development
 * provider's name page, linking a machine (the device grant), consent for a chat app, a page's
 * "Answer as yourself", signing out (MT-06), and every "Sign-in can't continue". Every page that
 * shows who is signed in carries "Signed in as Ada · Sign out". They are `@mostra/themes`' pages in the
 * operator's theme and name, with no script; every word they say is in `API_PAGE_WORDS`, and every
 * name a provider, a client or a person supplies lands as text.
 */
import type { Appearance } from "@mostra/themes";
import {
  actions,
  alert,
  button,
  field,
  fine,
  html,
  linkButton,
  type SafeHtml,
  signedInLine,
} from "@mostra/themes";
import type { ServerPages } from "../gateway/index.ts";

/** Where a person's appearance switch posts on the API origin (D171). */
export const APPEARANCE_PATH = "/_mostra/appearance";

/** Where the API origin's sign-out is (MT-06): the page with its button, and its form's target. */
export const SIGNOUT_PATH = "/signout";

/** Every word the API origin's pages say (D149: Mirza reviews them). */
export const API_PAGE_WORDS = {
  signInTitle: (name: string | null): string => (name ? `Sign in to ${name}` : "Sign in"),
  signInLede: "Choose how to sign in.",
  continueWith: (label: string): string => `Continue with ${label}`,
  noProviders: "This server has no sign-in set up yet, so nobody can sign in.",
  neverPassword: "You sign in with your provider. This server never sees your password.",
  devTitle: "Development sign-in",
  devNote:
    "This server signs people in with a development provider, which trusts the name you type. Use it only on a server you run for yourself or for tests.",
  yourName: "Your name",
  continue: "Continue",
  cantContinue: "Sign-in can't continue",
  deviceTitle: "Link this machine",
  deviceWarning:
    "Approving links a machine to your account. That machine's Mostra can then host pages under your account and receives their answers. Continue only if you started this sign-in yourself, on that machine.",
  deviceCode: "The code that machine shows",
  approveMachine: "Approve this machine",
  refuse: "Refuse",
  deviceLinked: "The machine is linked to your account.",
  deviceRefused: "The sign-in was refused.",
  deviceClose: "You can close this page.",
  answerTitle: "Answer as yourself",
  answerAs: (who: string, owner: string): string => `Continue as ${who} to answer ${owner}'s page?`,
  answerDetail: "They will see your name with your answers.",
  thisPerson: "this person",
  allowTitle: (client: string): string => `Allow ${client}?`,
  asksToUse: (client: SafeHtml, who: string): SafeHtml =>
    html`${client} asks to use Mostra as <strong>${who}</strong>.`,
  /** Before a name nobody checked: it never reads as checked (D165, INTERFACES §18.5). */
  selfNamed: "An app calling itself",
  operatorClient: "this server's own app",
  grants: ["Read, create and change your hosted pages", "Read their answers"],
  sendsBackTo: (host: string): SafeHtml => html`It will send you back to <strong>${host}</strong>.`,
  loopback: "That is a program on your own computer: continue only if you started this there.",
  allow: "Allow",
  cancel: "Cancel",
  yourAccount: "your account",
  signedInAs: (name: string): SafeHtml => html`Signed in as <strong>${name}</strong>`,
  signOut: "Sign out",
  signOutTitle: "Sign out?",
  signOutLede: (name: string): SafeHtml =>
    html`This browser is signed in here as <strong>${name}</strong> until you sign out.`,
  signOutAsks: (client: SafeHtml, host: string): SafeHtml =>
    html`${client} asks to sign you out here, then sends you back to <strong>${host}</strong>.`,
  staySignedInHint: "To stay signed in, close this page.",
  signedOutTitle: "You're signed out",
  signedOutDetail: "You can close this page.",
  signInAgain: "Sign in",
} as const;

/** The marks of providers a person recognises, by provider ID. Others show their label alone. */
const PROVIDER_ICONS: Readonly<Record<string, SafeHtml>> = {
  github: html`<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
  google: html`<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0 9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>`,
};

/** Where a page is and what the person chose, for its appearance switch. */
export interface PageRequest {
  /** The person's own choice; without one, the operator's default. */
  readonly appearance?: Appearance;
  /** This page's own path and query: where the appearance switch returns. */
  readonly path: string;
}

/**
 * Who a page shows as signed in, and its "Sign out" (MT-06): the form's CSRF token, derived from
 * the browser's session, and where the person continues once signed out (a path of this origin).
 */
export interface SignedIn {
  readonly name: string;
  readonly csrf: string;
  readonly next: string;
}

/** The API origin's pages, as HTML. */
export interface ApiPages {
  readonly name: string | null;
  signIn(
    request: PageRequest,
    providers: readonly { readonly id: string; readonly label: string }[],
    next: string,
    message?: string,
    signedIn?: SignedIn,
  ): string;
  developmentName(request: PageRequest, providerId: string, state: string): string;
  problem(request: PageRequest, message: string): string;
  answerAs(
    request: PageRequest,
    form: ConsentForm,
    signedIn: SignedIn,
    owner: string | undefined,
  ): string;
  allow(
    request: PageRequest,
    form: ConsentForm,
    client: { readonly name: string; readonly trust: "first-party" | "operator" | "self-named" },
    signedIn: SignedIn,
    redirectHost: string,
    loopback: boolean,
  ): string;
  /**
   * `GET /signout` with a session: one button that signs this browser out, and when a client asked
   * for it, which one and where the person goes back to.
   */
  signOut(
    request: PageRequest,
    options: {
      readonly name: string;
      readonly csrf: string;
      readonly fields: Readonly<Record<string, string>>;
      readonly client?:
        | {
            readonly name: string;
            readonly trust: "first-party" | "operator" | "self-named";
            readonly back: string;
          }
        | undefined;
    },
  ): string;
  /** "You're signed out", with the way back into a sign-in in progress when there is one. */
  signedOut(request: PageRequest, next: string | undefined): string;
  deviceForm(
    request: PageRequest,
    options: {
      readonly code: string;
      readonly message?: string | undefined;
      readonly development?: { readonly id: string; readonly label: string } | undefined;
      readonly signedIn?:
        | { readonly name: string; readonly csrf: string; readonly signOut: SignedIn }
        | undefined;
    },
  ): string;
  deviceDone(request: PageRequest, message: string): string;
}

/** The consent form's target and its CSRF token. */
export interface ConsentForm {
  readonly action: string;
  readonly csrf: string;
}

/** Makes the API origin's pages from the server's own pages (its theme and name). */
export function createApiPages(server: ServerPages, name: string | null): ApiPages {
  const W = API_PAGE_WORDS;
  const { pages } = server;
  const consentButtons = (approve: string) =>
    actions(
      button(approve, { name: "decision", value: "approve", primary: true }),
      button(W.cancel, { name: "decision", value: "deny" }),
    );
  /** "Signed in as Ada · Sign out": a form of its own, posting to this origin's sign-out. */
  const signedInLineOf = (signedIn: SignedIn | undefined): SafeHtml | "" =>
    signedIn
      ? signedInLine(W.signedInAs(signedIn.name), {
          action: SIGNOUT_PATH,
          fields: { csrf: signedIn.csrf, next: signedIn.next },
          label: W.signOut,
        })
      : "";
  /** Whose word a client's name is: the operator's, the client's own, or (first-party) the server's. */
  const clientNamed = (client: {
    readonly name: string;
    readonly trust: "first-party" | "operator" | "self-named";
  }): SafeHtml => {
    // A name the app gave itself is said to be its own, plainly, before it: "An app calling itself
    // Claude asks…" (WP-20, Mirza's note on MT-06's pictures).
    if (client.trust === "self-named") return html`${W.selfNamed} <strong>${client.name}</strong>`;
    return client.trust === "operator"
      ? html`<strong>${client.name}</strong> <span class="m-hint">(${W.operatorClient})</span>`
      : html`<strong>${client.name}</strong>`;
  };
  return {
    name,
    signIn(request, providers, next, message, signedIn) {
      const list = providers.map((provider, index) =>
        linkButton(
          `/signin/${encodeURIComponent(provider.id)}/start?next=${encodeURIComponent(next)}`,
          W.continueWith(provider.label),
          {
            primary: index === 0,
            ...(PROVIDER_ICONS[provider.id]
              ? { icon: PROVIDER_ICONS[provider.id] as SafeHtml }
              : {}),
          },
        ),
      );
      return pages.render({
        kind: "task",
        title: W.signInTitle(name),
        lede: W.signInLede,
        body: html`${signedInLineOf(signedIn)}${message ? alert(message) : ""}${
          list.length > 0
            ? html`<div class="m-list">${list}</div>${fine(W.neverPassword)}`
            : alert(W.noProviders, "note")
        }`,
        ...request,
      });
    },
    developmentName(request, providerId, state) {
      return pages.render({
        kind: "task",
        title: W.devTitle,
        body: html`${alert(W.devNote, "note")}<form method="post" action="/signin/${providerId}/name"><input type="hidden" name="state" value="${state}">${field(
          { label: W.yourName, name: "name", required: true, maxLength: 64, autocomplete: "name" },
        )}${actions(button(W.continue, { primary: true }))}</form>`,
        ...request,
      });
    },
    problem(request, message) {
      return pages.render({
        kind: "notice",
        tone: "problem",
        title: W.cantContinue,
        body: html`<p>${message}</p>`,
        ...request,
      });
    },
    answerAs(request, form, signedIn, owner) {
      return pages.render({
        kind: "task",
        title: W.answerTitle,
        lede: W.answerAs(signedIn.name, owner ?? W.thisPerson),
        body: html`${signedInLineOf(signedIn)}<p>${W.answerDetail}</p><form method="post" action="${form.action}"><input type="hidden" name="csrf" value="${form.csrf}">${consentButtons(W.continue)}</form>`,
        ...request,
      });
    },
    allow(request, form, client, signedIn, redirectHost, loopback) {
      return pages.render({
        kind: "task",
        title: W.allowTitle(client.name),
        lede: W.asksToUse(clientNamed(client), signedIn.name),
        body: html`${signedInLineOf(signedIn)}<ul class="m-grants">${W.grants.map((grant) => html`<li>${grant}</li>`)}</ul><p>${W.sendsBackTo(redirectHost)}</p>${loopback ? alert(W.loopback) : ""}<form method="post" action="${form.action}"><input type="hidden" name="csrf" value="${form.csrf}">${consentButtons(W.allow)}</form>`,
        ...request,
      });
    },
    signOut(request, options) {
      const hidden = Object.entries({ ...options.fields, csrf: options.csrf }).map(
        ([name, value]) => html`<input type="hidden" name="${name}" value="${value}">`,
      );
      return pages.render({
        kind: "task",
        title: W.signOutTitle,
        lede: W.signOutLede(options.name),
        body: html`${options.client ? html`<p>${W.signOutAsks(clientNamed(options.client), options.client.back)}</p>` : ""}<form method="post" action="${SIGNOUT_PATH}">${hidden}${actions(button(W.signOut, { primary: true }))}</form>${options.client ? fine(W.staySignedInHint) : ""}`,
        ...request,
      });
    },
    signedOut(request, next) {
      return pages.render({
        kind: "notice",
        title: W.signedOutTitle,
        body: html`<p>${W.signedOutDetail}</p>${next !== undefined ? actions(linkButton(next, W.signInAgain, { primary: true })) : ""}`,
        ...request,
      });
    },
    deviceForm(request, options) {
      const signedIn = options.signedIn;
      const development = options.development;
      const form = signedIn
        ? html`<form method="post" action="/device"><input type="hidden" name="csrf" value="${signedIn.csrf}">${field(
            {
              label: W.deviceCode,
              name: "user_code",
              value: options.code,
              required: true,
              code: true,
            },
          )}${actions(
            button(W.approveMachine, { name: "session_decision", value: "approve", primary: true }),
            button(W.refuse, { name: "session_decision", value: "deny" }),
          )}</form>`
        : development
          ? html`<form method="post" action="/device">${field({
              label: W.deviceCode,
              name: "user_code",
              value: options.code,
              required: true,
              code: true,
            })}${alert(W.devNote, "note")}${field({
              label: W.yourName,
              name: "name",
              required: true,
              maxLength: 64,
              autocomplete: "name",
            })}<input type="hidden" name="provider" value="${development.id}">${actions(
              button(W.approveMachine, { name: "decision", value: "approve", primary: true }),
              button(W.refuse, { name: "decision", value: "deny" }),
            )}</form>`
          : alert(W.noProviders, "note");
      return pages.render({
        kind: "task",
        title: W.deviceTitle,
        body: html`${signedInLineOf(signedIn?.signOut)}${options.message ? alert(options.message) : ""}${alert(W.deviceWarning, "note")}${form}`,
        ...request,
      });
    },
    deviceDone(request, message) {
      return pages.render({
        kind: "notice",
        title: message,
        body: html`<p>${W.deviceClose}</p>`,
        ...request,
      });
    },
  };
}
