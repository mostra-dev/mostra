# Demos: your project's front end inside the page

A demo is a front end your project builds (a Vite app, a Next.js static export, anything that writes static files) shown inside the page in a phone, tablet or browser frame. Mostra builds it from its source when you verify and publish, keeps the built files with the version, and serves them beside the page. A demo works the same everywhere the page is seen: on this computer, through a share, on a remote server and in every export. Nothing about it needs your machine once it is published.

A demo carries everything it needs: its data as fixtures or mock files, its state in local storage. It has no server of its own. For an app that needs one (API routes, server rendering at request time, a database, sign-in), link to the app's own deployment instead.

## Declaring one

```tsx
import { WebDemo } from "@mostra/kit/demo";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({
  title: "The new checkout",
  demos: {
    shop: { source: "../web", build: ["pnpm", "build"], output: "dist" },
  },
});

export default function Page() {
  return <WebDemo demo="shop" path="/checkout" device="iphone-15" />;
}
```

- `source` is the project's folder, relative to the artifact; `build` runs there; `output` is the folder the build writes, relative to `source`.
- Build for the path Mostra serves the demo at, which the build reads from `MOSTRA_DEMO_BASE` (`/_mostra/demos/shop/`): Vite's `base: process.env.MOSTRA_DEMO_BASE`, Next.js's `basePath` (without the last `/`, with `output: "export"`), a router's `basename`.
- `env` adds settings the build reads (never secrets: a demo holds none); `routing: "hash"` says the demo moves between its pages by the address's fragment; `bridge: false` leaves Mostra's review agent out of its pages; `timeout` (`"10m"` by default, `"60m"` at most) bounds the build.
- `<WebDemo>` takes `demo`, `path` (the page it opens at), `device` (`iphone-15`, `pixel-8`, `ipad`, `laptop`, `desktop` or `none`), `devices` (the switcher's choices, `false` for none), `values` (sent to the demo with `postMessage` as `{ "mostra/demo.values": values }`, the first with the demo's channel to the page as `event.ports[0]`) and `onMessage` (what the demo sends on that channel; Safari doesn't say which frame a `parent.postMessage` came from, so answer on the channel).

To frame a demo your own way, `useDemo(name, { path })` from `@mostra/react` gives what `<WebDemo>` uses: its `status` (`ready`, `unknown`, `folder-only` in one HTML file that couldn't hold it, `unavailable` inline in a chat app), its `src` and how it routes.

*Done when* `mostra demo build <dir>` reports each demo built, and `mostra verify <dir>` passes with the demo in its screenshots.

## When a build fails

`mostra demo build <dir>` builds now and prints each build's outcome; verify and publish build the same way, and reuse a build whose source, command and settings haven't changed. A failed build fails verify with the build's last log lines (`MOSTRA_DEMO_BUILD_FAILED`); an output folder that's missing or loads its files from outside its base fails too (`MOSTRA_DEMO_OUTPUT_MISSING`, `MOSTRA_DEMO_BASE_MISMATCH`). Each code's page (`mostra docs <code>`) says what to change.

## Changing a demo

A demo changes like the rest of the page: change its source, verify and publish a new version. People see the new version through the version banner. There's no live reload inside the frame.

## Routing, and sending the page as a file

Routing is a choice. Keep the framework's normal routing for a demo people see on a link, a share or a static host: it works fully there, deep links included. For a demo meant to be sent as a file, prefer hash routing (`routing: "hash"`), so it moves between its pages opened straight from disk too; browsers refuse moving between paths in a file opened from disk, and the demo then says so in place. Exporting is in [sharing.md](sharing.md#sending-the-page-as-files).
