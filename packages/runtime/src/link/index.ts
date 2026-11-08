/**
 * The owner's side of a remote server (ARCHITECTURE §15.3, INTERFACES §18.2, D165): the network
 * binding, sign-in, the sync cursor and the relay. One public entry, as every runtime module
 * (REPO_STANDARDS §3).
 */
export { type Binding, ownerInitialize, startBinding } from "./binding.ts";
export { forwardHosted, hostedState, pauseHandler } from "./hosted.ts";
export { createLink, type Link } from "./manager.ts";
