# @mostra/react

The client runtime of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime.
Artifacts import it for `defineArtifact`, the manifest an artifact declares in its entry:

```tsx
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Sidebar options", family: "review" });

export default function Page() {
  return <h1>Sidebar options</h1>;
}
```

Artifacts don't install it: every Mostra build resolves it from the warm set. It carries fields,
submissions, actions and live data. Apache-2.0.
