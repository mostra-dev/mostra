import { configDefaults, defineConfig } from "vitest/config";

/**
 * The integration suites in groups, each its own CI machine per platform (REPO_STANDARDS §6), so
 * the job stays inside its time while verify's real-browser suites grow. `MOSTRA_TEST_GROUP`
 * picks one; unset, every suite runs (`pnpm check --job integration` on a laptop). The groups
 * partition the files by name, so a new suite always lands in exactly one: `verify*` suites and
 * `dev` (the other sandboxed preview) in `verify`, the failure suites (verify's, publishing's and
 * workers' crashes) in `verify-failures`, everything else in `core`. Suites run one at a time, so a
 * group's time is the sum of its files': these keep the groups within about a minute of each other
 * on macOS (MT-01; `core` had been 8 min against 3.5 for the others).
 * `clients` is the CLI's, the SDK's and `create-mostra`'s suites (WP-11): none of the runtime's,
 * so their instances never compete with the runtime's suites for one machine's CPU.
 */
const VERIFY_SUITES = "test/integration/verify*.test.ts";
const VERIFY_FAILURES = "test/integration/verify-failures.test.ts";
const DEV = "test/integration/dev.test.ts";
const FAULTS = ["test/integration/publish-faults.test.ts", "test/integration/lifecycle.test.ts"];
// The binding's heartbeat suite waits out a proxy's real 60 s idle limit and a 45 s silence
// (WP-29): about two minutes. It joined `verify-failures`, the shorter group then; since WP-18 made
// each verify build its theme, that group passed its 10 minutes on macOS (MT-03 saw it near them;
// WP-18's `ci:full` run 44802962232), so it runs beside the binding's other suites in `remote`.
const HEARTBEAT = "test/integration/heartbeat.test.ts";
// The remote server's suites: real servers and owners, each half a machine of its own on macOS and
// Linux so neither nor `core` passes its deadline. `remote` (WP-29): the server, the binding, the
// owner's link, hosting and the relay. `remote-access` (WP-30, MT-03): sign-in, OAuth, the
// operator's ports, remote MCP and the hosted pages' rules. One `remote` group took 10.2 of its
// 10 minutes on macOS once MT-03's suites joined it (CI run 43350155809), and `core` has no room
// for them either (574 of its 600 s before them in run 43367597560), so the group is split
// (REPO_STANDARDS §6). Windows keeps them in `windows-remote`, but for MT-03's two, which join its
// lightest group, `windows-publish`.
const REMOTE_HOSTING = [
  "test/integration/server.test.ts",
  "test/integration/binding.test.ts",
  "test/integration/link.test.ts",
  "test/integration/hosted.test.ts",
  "test/integration/relay.test.ts",
  "test/integration/restore.test.ts",
  "test/integration/replicator.test.ts",
  "test/integration/idle-marks.test.ts",
  "test/integration/tenancy.test.ts",
  "test/integration/pause.test.ts",
  "test/integration/team-hosted.test.ts",
];
const SIGNIN_FACTS = "test/integration/signin-facts.test.ts";
const ANONYMOUS_VOLUME = "test/integration/anonymous-volume.test.ts";
const OPERATOR_RELAY = "test/integration/operator-relay.test.ts";
const REMOTE_ACCESS = [
  "test/integration/operator.test.ts",
  "test/integration/oauth.test.ts",
  "test/integration/remote-mcp.test.ts",
  "test/integration/remote-mcp-apps.test.ts",
  "test/integration/signin.test.ts",
  "test/integration/hosted-rules.test.ts",
  ANONYMOUS_VOLUME,
  "test/integration/remote-mcp-conformance.test.ts",
  "test/integration/server-pages.test.ts",
  "test/integration/signout.test.ts",
  SIGNIN_FACTS,
  OPERATOR_RELAY,
];
const REMOTE = [...REMOTE_HOSTING, ...REMOTE_ACCESS];
// Plugins and source packs (WP-16): real installs from a local registry, plugin children and
// local registry servers, a group of their own, since `core` has no room for them.
const EXTENSIONS = [
  "test/integration/plugins.test.ts",
  "test/integration/packs.test.ts",
  // WP-17: the app channel and the MCP App exporter, a bundled plugin (D175).
  "test/integration/mcp-apps.test.ts",
];
// Suites `core` has no room for on macOS and Linux, which `extensions` runs there (REPO_STANDARDS
// §6: a group near its deadline is rebalanced). macOS `core` reached its 10 minutes on `main` (10 min
// 7 s and 10 min 27 s in MT-05's merge queue, 44230190769 and 44224848051) and ran past it on WP-17's
// `ci:full` run (44270632827), while `extensions` takes about 4 minutes. The dependency suite installs
// as the plugin and pack suites do. Windows keeps it in `windows`, so its partition is unchanged.
// WP-18: the kit through verify (KT-03 to KT-10), which `core` has no room for either (macOS `core`
// reached its deadline with it on WP-18's `ci:full` run 44793555343).
const KIT_PARTS = "test/integration/kit-parts.test.ts";
const CORE_OVERFLOW = ["test/integration/deps.test.ts", KIT_PARTS];
export const INTEGRATION_GROUPS: Record<string, { include: string[]; exclude: string[] }> = {
  core: {
    include: ["test/integration/**/*.test.ts"],
    exclude: [VERIFY_SUITES, DEV, ...FAULTS, HEARTBEAT, ...REMOTE, ...EXTENSIONS, ...CORE_OVERFLOW],
  },
  extensions: { include: [...EXTENSIONS, ...CORE_OVERFLOW], exclude: [] },
  remote: { include: [...REMOTE_HOSTING, HEARTBEAT], exclude: [] },
  "remote-access": { include: REMOTE_ACCESS, exclude: [] },
  verify: { include: [VERIFY_SUITES, DEV], exclude: [VERIFY_FAILURES] },
  "verify-failures": { include: [VERIFY_FAILURES, ...FAULTS], exclude: [] },
  clients: { include: [], exclude: [] },
  // The Windows legs (WP-W1, WP-W2, D146): every suite, in groups one machine each (Windows arm64
  // runs them about twice as slowly as x64). They partition the files too, in their own way: a
  // test (`windows-groups.test.ts`) keeps every suite in exactly one of them. `windows-clients` is
  // the CLI's suites (packages/cli/vitest.config.ts), as `clients` is on macOS and Linux.
  windows: {
    include: [
      "test/integration/instance.test.ts",
      "test/integration/platform.test.ts",
      "test/integration/reaping.test.ts",
      "test/integration/processes.test.ts",
      "test/integration/deps.test.ts",
      "test/integration/windows.test.ts",
      "test/integration/heartbeat.test.ts",
    ],
    exclude: [],
  },
  // The remote server and the relay (WP-29), as `remote` is on macOS and Linux.
  // The anonymous-volume suite (about 100 s) runs in `windows-extensions`: `windows-remote` reached
  // its 14 minutes on a slow Windows arm64 runner with it (WP-18's ci:full run 44914565149).
  "windows-remote": {
    include: REMOTE.filter(
      (file) => file !== SIGNIN_FACTS && file !== OPERATOR_RELAY && file !== ANONYMOUS_VOLUME,
    ),
    exclude: [],
  },
  "windows-publish": {
    include: [
      "test/integration/protocol-suite.test.ts",
      "test/integration/publish.test.ts",
      "test/integration/publish-faults.test.ts",
      "test/integration/ancestors.test.ts",
      "test/integration/audit.test.ts",
      "test/integration/render.test.ts",
      "test/integration/bundle.test.ts",
      SIGNIN_FACTS,
      OPERATOR_RELAY,
      "test/integration/verify-secrets.test.ts",
    ],
    exclude: [],
  },
  // WP-W2: the gateway and the interaction core behind it, ...
  "windows-gateway": {
    include: [
      "test/integration/gateway.test.ts",
      "test/integration/interaction.test.ts",
      "test/integration/identity.test.ts",
      "test/integration/share.test.ts",
      "test/integration/addressing.test.ts",
      "test/integration/browser-revisions.test.ts",
      "test/integration/scale.test.ts",
      "test/integration/team.test.ts",
    ],
    exclude: [],
  },
  // ... workers, actions and live data (RT-03, RT-04, AC-01 to AC-08) ...
  "windows-workers": {
    include: [
      "test/integration/actions.test.ts",
      "test/integration/lifecycle.test.ts",
      "test/integration/producers.test.ts",
      "test/integration/seams.test.ts",
      "test/integration/server-packages.test.ts",
    ],
    exclude: [],
  },
  // ... and verify with its browser, and `mostra dev`.
  // `verify.test.ts` alone takes 12 of Windows arm64's 14 minutes since WP-18 (every build carries
  // its theme): the secrets suite and `mostra dev` go to the lighter groups (WP-18's `ci:full` run
  // 44793555343: `windows-publish` 7 minutes, `windows-extensions` 5.5).
  "windows-verify": { include: ["test/integration/verify.test.ts"], exclude: [] },
  // WP-18: the kit through verify, a suite of its own, in the lighter of the verify groups.
  "windows-verify-failures": { include: [VERIFY_FAILURES, KIT_PARTS], exclude: [] },
  "windows-extensions": { include: [...EXTENSIONS, DEV, ANONYMOUS_VOLUME], exclude: [] },
  "windows-clients": { include: [], exclude: [] },
  // The conformance kit's TypeScript reference host, apart from the other clients (WP-18, #225).
  "windows-conformance": { include: [], exclude: [] },
};
const group = process.env["MOSTRA_TEST_GROUP"];
const integrationFiles = group
  ? INTEGRATION_GROUPS[group]
  : { include: ["test/integration/**/*.test.ts"], exclude: [] };
if (!integrationFiles) {
  throw new Error(
    `MOSTRA_TEST_GROUP is "${group}"; the integration groups are ${Object.keys(INTEGRATION_GROUPS).join(", ")}.`,
  );
}

// Tests import the package by name, resolved to source through the `@mostra/source` condition.
// `unit` runs in-process; `integration` drives the built `mostra-runtime` binary as real
// processes (sockets, process groups, start times) and runs in the `integration` CI job on macOS
// and Linux (D86).
export default defineConfig({
  resolve: { conditions: ["@mostra/source"] },
  ssr: { resolve: { conditions: ["@mostra/source"] } },
  test: {
    // The `clients` integration group runs none of the runtime's suites (a root option: vitest
    // reads it only here).
    passWithNoTests: integrationFiles.include.length === 0,
    projects: [
      {
        extends: true,
        // A full local `pnpm check` runs every package's suites at once; 5 s starved a 0.3 s test
        // (WP-08's check), so time limits here bound hangs, never speed.
        test: { name: "unit", include: ["test/unit/**/*.test.ts"], testTimeout: 30_000 },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: integrationFiles.include,
          exclude: [...configDefaults.exclude, ...integrationFiles.exclude],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Real processes compete for the CPU; one file at a time keeps timings honest.
          fileParallelism: false,
        },
      },
      {
        // The hygiene checklist (HY-01) against a real daemon, run by the `hygiene` CI job.
        extends: true,
        test: {
          name: "hygiene",
          include: ["test/hygiene/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        // External evidence (STANDARDS, Verification layer 7): the real npm registry. Run by hand
        // with `pnpm --filter @mostra/runtime test:external`; never part of CI.
        extends: true,
        test: {
          name: "external",
          include: ["test/external/**/*.test.ts"],
          testTimeout: 600_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
