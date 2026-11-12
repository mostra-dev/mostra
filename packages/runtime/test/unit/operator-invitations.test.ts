/**
 * The operator's invitations queue on its own (D168, Opus review 4): an invitation whose home
 * can't build its link (it fails, or hangs) is tried again later and holds no other invitation
 * back; one whose link no longer works is dropped; building a link is bounded like the hand-over.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPERATOR_TIME_LIMITS, type ServerHandle } from "@mostra/protocol/operator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLedger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { SERVER_MIGRATIONS } from "../../src/server/directory.ts";
import { loadOperator, type QueuedInvitation } from "../../src/server/operator.ts";
import { closeBeforeRemoval, tempDir } from "../support.ts";

declare global {
  // The fixture module's record of what it was handed.
  var __mostraInvitations: { invitationId: string; url: string }[] | undefined;
}

function invitation(home: string, tokenId: string): QueuedInvitation {
  return {
    invitationId: `${home}:${tokenId}`,
    account: "acct_01JB8Z3QF6S7W3N8D5K2C4V9XA",
    home,
    routeId: "rte_01JB8Z3QF6S7W3N8D5K2C4V9XA",
    label: "label",
    artifactId: "art_01JB8Z3QF6S7W3N8D5K2C4V9XA",
    title: "Retro",
    respondent: { ref: `${tokenId}@example.com`, email: `${tokenId}@example.com` },
    sender: {},
    at: new Date().toISOString(),
    tokenId,
  };
}

async function setup(
  invitationLink: (home: string, tokenId: string) => Promise<{ url: string } | undefined>,
) {
  const dir = tempDir("operator-invitations");
  const module = join(dir, "operator.mjs");
  writeFileSync(
    module,
    "export default () => ({ invitations: { send: async (one) => { (globalThis.__mostraInvitations ??= []).push({ invitationId: one.invitationId, url: one.url }); } } });\n",
  );
  const opening = openLedger({
    storeDir: dir,
    fileName: "server.sqlite",
    runtimeVersion: "1.0.0",
    owner: { pid: process.pid, startTime: "boot/1" },
    log: silentLog,
    migrations: SERVER_MIGRATIONS,
    locking: "normal",
  });
  if (!opening.ok) throw new Error("locked");
  const directory = opening.ledger;
  closeBeforeRemoval(() => directory.close());
  const operator = await loadOperator({
    path: module,
    handle: {} as ServerHandle,
    directory,
    log: silentLog,
    dispatchMs: 3_600_000,
    invitationLink,
  });
  const waiting = () =>
    directory.read((db) =>
      db.all<{ id: string; attempts: number }>(
        "SELECT id, attempts FROM outbound WHERE port = 'invitations' ORDER BY rowid",
      ),
    );
  return { operator, waiting };
}

describe("the operator's invitations (D168, Opus review 4)", () => {
  afterEach(() => {
    globalThis.__mostraInvitations = undefined;
    vi.useRealTimers();
  });

  it("hands over every other invitation while one home can't build its link, and drops a dead link's", async () => {
    const { operator, waiting } = await setup(async (home, tokenId) => {
      if (home === "hom_broken") throw new Error("the home's ledger can't be opened");
      if (tokenId === "tok_dead") return undefined;
      return { url: `https://content.example/a/rte#t=${tokenId}-secret` };
    });
    // The broken home's invitation is the oldest: the others must not wait behind it.
    operator.enqueue({ port: "invitations", invitation: invitation("hom_broken", "tok_one") });
    operator.enqueue({ port: "invitations", invitation: invitation("hom_ok", "tok_two") });
    operator.enqueue({ port: "invitations", invitation: invitation("hom_ok", "tok_dead") });
    operator.enqueue({ port: "invitations", invitation: invitation("hom_ok", "tok_three") });
    await operator.flush();
    expect((globalThis.__mostraInvitations ?? []).map((one) => one.invitationId).sort()).toEqual([
      "hom_ok:tok_three",
      "hom_ok:tok_two",
    ]);
    // The broken one waits for its own retry; the dead link's is gone.
    expect(waiting()).toEqual([{ id: "invitations:hom_broken:tok_one", attempts: 1 }]);
    operator.stop();
  });

  it("bounds building a link like the hand-over, so a home that hangs never stalls the dispatcher", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const { operator, waiting } = await setup(async (home) =>
      home === "hom_hung"
        ? new Promise<undefined>(() => {})
        : { url: "https://content.example/a/rte#t=late-secret" },
    );
    operator.enqueue({ port: "invitations", invitation: invitation("hom_hung", "tok_one") });
    operator.enqueue({ port: "invitations", invitation: invitation("hom_ok", "tok_two") });
    let done = false;
    const flushing = operator.flush().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(OPERATOR_TIME_LIMITS.outbound + 100);
    await flushing;
    expect(done).toBe(true);
    expect((globalThis.__mostraInvitations ?? []).map((one) => one.invitationId)).toEqual([
      "hom_ok:tok_two",
    ]);
    expect(waiting()).toEqual([{ id: "invitations:hom_hung:tok_one", attempts: 1 }]);
    operator.stop();
  });
});
