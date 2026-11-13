# @mostra/themes

How Mostra looks, as one package: its themes as data, the stylesheets and self-hosted faces made
from them, and templates for the pages a server draws itself and the mail an operator sends.

```sh
npm install @mostra/themes
```

**A stylesheet.** Take a theme's tokens (shadcn's names, light and dark, the faces) with no code:

```css
@import "@mostra/themes/css/studio.css";
```

A page follows the device's light or dark setting; `<html data-appearance="light">` or `"dark"`
keeps one.

**A server's pages**, with no script, in a theme:

```ts
import { createPages, html, linkButton, studio } from "@mostra/themes";

const pages = createPages({ theme: studio, identity: { name: "Acme Pages" }, assetBase: "/_mostra/theme/" });
// Serve every file of `pages.assets` under assetBase, and send `pages.csp` with each page.
const page = pages.render({
  kind: "task",
  title: "Sign in to Acme Pages",
  body: html`${linkButton("/signin/acme/start", "Continue with Acme SSO", { primary: true })}`,
});
```

**Your own theme**, checked like Mostra's (every text pair at WCAG 2.2 AA in both modes):

```ts
import { defineTheme, studio } from "@mostra/themes";
export const mine = defineTheme({ ...studio, id: "mine", name: "Mine", radius: "4px" });
```

Faces: Figtree, Jost and Spline Sans Mono, SIL Open Font License 1.1 (`fonts/OFL-*.txt`). Mostra's
marks in `marks/` are its trademarks, not licensed by Apache-2.0.

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.
