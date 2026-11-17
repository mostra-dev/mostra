# @mostra/plugin-mcp-app

Mostra's MCP App exporter. It turns a published Mostra artifact version into an [MCP App](https://github.com/modelcontextprotocol/ext-apps): one self-contained page that chat hosts such as Claude, ChatGPT and VS Code show inline.

Every Mostra home has it, so there is nothing to install:

```sh
mostra export ./my-artifact --as mcp-app --out ./my-artifact-app
```

The output directory holds:

- `index.html`: the page, with the whole client build inline;
- `mcp-app.json`: its `ui://mostra/view/<versionId>` resource as MCP lists it, with the origins the page declares (`_meta.ui.csp`).

Options (`--option name=value`):

| Option | What it does |
|---|---|
| `connectDomains` | More `https:` origins the page fetches from, as a JSON array |
| `resourceDomains` | More `https:` origins the page loads images, styles or media from |
| `prefersBorder` | Whether the host draws a border and background around the page; `true` unless set, since hosts' own defaults differ |

Mostra's own MCP server (`mostra mcp`) shows an artifact inline through `artifact_open`, and the page saves answers, submits and runs actions through its app-only tools. A host frames a page shown that way with its loader's policy, which declares no origin, so the page loads nothing from outside and says so for each origin the host blocks; the origins in `mcp-app.json` apply where a host shows the `ui://mostra/view/<versionId>` resource itself.

Licensed under Apache-2.0.
