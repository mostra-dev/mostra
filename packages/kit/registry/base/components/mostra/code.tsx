"use client";

/**
 * Code in the page's theme (D26): `Code` shows it highlighted by Shiki (VS Code's grammars, its
 * regular expressions run in JavaScript, no WebAssembly), and `CodeEditor` lets a person write it in
 * CodeMirror 6, saved as a field like every kit input (`id`, D52). Both colour code with the theme's
 * text colours, each of which holds WCAG AA on the theme's cards: keywords in its highlight,
 * strings in its success colour, numbers in its warning colour, comments muted, in light and dark.
 * A page restyles them through `--code-*` variables. Both take `className`; `mostra add mostra-code`
 * copies the module (D68).
 */

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderText,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useField } from "@mostra/react";
import { cn } from "cn";
import * as React from "react";
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/* -------------------------------------------------------------------------------------------- */
/* The colours                                                                                   */

/**
 * Each syntax role's colour, as a variable a page may set (`--code-keyword`), else the theme's text
 * colour for it.
 */
const ROLE = {
  foreground: "var(--code-foreground, var(--card-foreground))",
  background: "var(--code-background, var(--muted))",
  keyword: "var(--code-keyword, var(--highlight))",
  string: "var(--code-string, var(--success))",
  number: "var(--code-number, var(--warning))",
  function: "var(--code-function, var(--foreground))",
  comment: "var(--code-comment, var(--muted-foreground))",
  punctuation: "var(--code-punctuation, var(--muted-foreground))",
  property: "var(--code-property, var(--foreground))",
  deleted: "var(--code-deleted, var(--destructive))",
  inserted: "var(--code-inserted, var(--success))",
} as const;

/** Shiki's theme of CSS variables, each falling back to the role's colour. */
const shikiTheme = createCssVariablesTheme({
  name: "mostra",
  variablePrefix: "--shiki-",
  variableDefaults: {
    foreground: ROLE.foreground,
    background: "transparent",
    "token-constant": ROLE.number,
    "token-string": ROLE.string,
    "token-string-expression": ROLE.string,
    "token-comment": ROLE.comment,
    "token-keyword": ROLE.keyword,
    "token-parameter": ROLE.foreground,
    "token-function": ROLE.function,
    "token-punctuation": ROLE.punctuation,
    "token-link": ROLE.keyword,
    "token-inserted": ROLE.inserted,
    "token-deleted": ROLE.deleted,
    "token-changed": ROLE.number,
  },
  fontStyle: true,
});

/* -------------------------------------------------------------------------------------------- */
/* Code                                                                                          */

/** A language Shiki highlights for `Code`, by Shiki's own name. */
type ShikiLanguage =
  | "bash"
  | "css"
  | "diff"
  | "go"
  | "html"
  | "java"
  | "javascript"
  | "json"
  | "jsx"
  | "markdown"
  | "python"
  | "rust"
  | "sql"
  | "swift"
  | "toml"
  | "tsx"
  | "typescript"
  | "yaml";

/** The languages `Code` highlights, each loaded the first time a page shows it. */
const LANGUAGES: Readonly<Record<ShikiLanguage, () => Promise<unknown>>> = {
  bash: () => import("shiki/langs/shellscript.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

/** A language `Code` highlights, by Shiki's name or a usual alias. */
export type CodeLanguage =
  | ShikiLanguage
  | "js"
  | "ts"
  | "py"
  | "sh"
  | "shell"
  | "zsh"
  | "md"
  | "yml"
  | "text";

const ALIASES: Readonly<Record<string, ShikiLanguage>> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  md: "markdown",
  yml: "yaml",
};

let highlighter: Promise<HighlighterCore> | undefined;

async function highlighted(code: string, language: string): Promise<string | undefined> {
  const name =
    ALIASES[language] ?? (language in LANGUAGES ? (language as ShikiLanguage) : undefined);
  if (name === undefined) return undefined;
  highlighter ??= createHighlighterCore({
    themes: [shikiTheme],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  const shiki = await highlighter;
  if (!shiki.getLoadedLanguages().includes(name)) {
    await shiki.loadLanguage((await LANGUAGES[name]()) as never);
  }
  return shiki.codeToHtml(code, { lang: name, theme: "mostra" });
}

/** {@link Code}'s props. */
export interface CodeProps extends Omit<React.ComponentProps<"figure">, "children" | "title"> {
  /** The code. */
  readonly code: string;
  /** Its language. Default `"text"` (shown as it is). */
  readonly lang?: CodeLanguage;
  /** A file name or a title above it. */
  readonly title?: React.ReactNode;
  /** Number its lines. Default false. */
  readonly lineNumbers?: boolean;
}

/**
 * Code, highlighted in the page's theme. Until its language has loaded it shows the code as plain
 * text, so nothing moves.
 *
 * ```tsx
 * <Code lang="ts" title="retry.ts" code={`export const retries = 3;`} />
 * ```
 */
export function Code({
  code,
  lang = "text",
  title,
  lineNumbers: numbered = false,
  className,
  style,
  ...props
}: CodeProps): React.JSX.Element {
  const [html, setHtml] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    let current = true;
    highlighted(code, lang).then(
      (result) => {
        if (current) setHtml(result);
      },
      (error: unknown) => {
        console.error(`The code couldn't be highlighted as ${lang}:`, error);
      },
    );
    return () => {
      current = false;
    };
  }, [code, lang]);
  return (
    <figure
      data-slot="code"
      data-numbered={numbered ? "" : undefined}
      className={cn(
        "min-w-0 overflow-hidden rounded-card text-sm shadow-card",
        "[&_pre]:overflow-x-auto [&_pre]:p-4 [&_pre]:font-mono [&_pre]:leading-relaxed [&_code]:font-mono",
        "data-numbered:[&_code]:[counter-reset:line] data-numbered:[&_.line]:before:mr-4 data-numbered:[&_.line]:before:inline-block data-numbered:[&_.line]:before:w-6 data-numbered:[&_.line]:before:text-right data-numbered:[&_.line]:before:text-(--code-comment,var(--muted-foreground)) data-numbered:[&_.line]:before:content-[counter(line)] data-numbered:[&_.line]:before:[counter-increment:line]",
        className,
      )}
      style={{ background: ROLE.background, color: ROLE.foreground, ...style }}
      {...props}
    >
      {title !== undefined && (
        <figcaption className="border-b border-border px-4 py-2 font-mono text-xs text-muted-foreground">
          {title}
        </figcaption>
      )}
      {html !== undefined ? (
        // Shiki's own output: the code, escaped, in spans of the theme's colours.
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes the code it is given.
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>
            {code.split("\n").map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are their positions.
              <span key={index} className="line">
                {line}
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
      )}
    </figure>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* CodeEditor                                                                                    */

/** A language `CodeEditor` edits with highlighting and indentation. */
export type EditorLanguage =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "css"
  | "html"
  | "markdown"
  | "python"
  | "text";

function languageOf(lang: EditorLanguage): Extension {
  switch (lang) {
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "jsx":
      return javascript({ jsx: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    case "css":
      return css();
    case "html":
      return html();
    case "markdown":
      return markdown();
    case "python":
      return python();
    default:
      return [];
  }
}

/** CodeMirror's colours for each syntax role, the same as `Code`'s. */
const highlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword],
    color: ROLE.keyword,
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: ROLE.string },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom, tags.constant(tags.name)],
    color: ROLE.number,
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: ROLE.function,
    fontWeight: "500",
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: ROLE.comment,
    fontStyle: "italic",
  },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: ROLE.punctuation },
  { tag: [tags.propertyName, tags.attributeName, tags.tagName], color: ROLE.property },
  { tag: [tags.heading, tags.strong], fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: ROLE.keyword, textDecoration: "underline" },
  { tag: tags.deleted, color: ROLE.deleted },
  { tag: tags.inserted, color: ROLE.inserted },
]);

/** CodeMirror's surfaces, from the page's tokens. */
const editorTheme = EditorView.theme({
  "&": {
    color: ROLE.foreground,
    backgroundColor: "var(--field, var(--card))",
    fontSize: "0.875rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    caretColor: "var(--foreground)",
    padding: "10px 0",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklab, var(--ring) 28%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    border: "none",
    fontFamily: "var(--font-mono)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--muted) 60%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklab, var(--ring) 22%, transparent)" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover, var(--card))",
    color: "var(--popover-foreground, var(--card-foreground))",
    border: "1px solid var(--border)",
    borderRadius: "var(--popover-radius, var(--radius))",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--menu-highlight, var(--accent))",
    color: "var(--menu-highlight-fg, var(--accent-foreground))",
  },
});

/** {@link CodeEditor}'s props. */
export interface CodeEditorProps extends Omit<React.ComponentProps<"div">, "id" | "children"> {
  /** The field the code saves as (D52): stable, and unique on the page. */
  readonly id: string;
  /** What the code is, for the field's label in results and for screen readers. */
  readonly label: string;
  /** The code it starts with, before the person writes. */
  readonly initial?: string;
  /** Its language. Default `"text"`. */
  readonly lang?: EditorLanguage;
  /** What an empty editor says. */
  readonly placeholder?: string;
  /** Whether Submit waits for some code. */
  readonly required?: boolean;
  /** Its height in CSS pixels; default it grows with the code from 120. */
  readonly height?: number;
  /** Show it without letting the person change it. */
  readonly readOnly?: boolean;
}

/**
 * A code editor whose text saves as a field, like every kit input: it comes back after a reload
 * and arrives in results under its label.
 *
 * ```tsx
 * <CodeEditor id="query" label="The query to run" lang="python" initial={"select * from orders"} required />
 * ```
 */
export function CodeEditor({
  id,
  label,
  initial = "",
  lang = "text",
  placeholder,
  required = false,
  height,
  readOnly = false,
  className,
  ...props
}: CodeEditorProps): React.JSX.Element {
  const [value, setValue, meta] = useField(id, initial, { label, required });
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const write = React.useRef(setValue);
  const text = React.useRef(value);
  React.useLayoutEffect(() => {
    write.current = setValue;
    text.current = value;
  });
  const labelId = React.useId();

  // The editor, made again only when its language or what it allows changes.
  // The editor, made again only when its language or what it allows changes, from the text of then;
  // a later value is set below, in place.
  React.useEffect(() => {
    const element = host.current;
    if (!element) return;
    const created = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: text.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          languageOf(lang),
          syntaxHighlighting(highlightStyle),
          editorTheme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            "aria-labelledby": labelId,
            "aria-multiline": "true",
            ...(required ? { "aria-required": "true" } : {}),
            // The field's id, so the shell can focus it as a blocker and presence can name it.
            "data-presence-id": id,
          }),
          ...(placeholder !== undefined ? [placeholderText(placeholder)] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) write.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      if (view.current === created) view.current = null;
    };
  }, [lang, readOnly, required, placeholder, labelId, id]);

  // A value from elsewhere (a draft from another tab, a conflict taken back) replaces the text.
  React.useEffect(() => {
    const current = view.current;
    if (!current) return;
    const shown = current.state.doc.toString();
    if (shown !== value) {
      current.dispatch({ changes: { from: 0, to: shown.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      data-slot="code-editor"
      data-field={id}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      {...props}
    >
      <span id={labelId} className="text-sm font-medium">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      <div
        ref={host}
        className="min-w-0 overflow-hidden rounded-control shadow-(--control-shadow) focus-within:ring-2 focus-within:ring-ring [&_.cm-editor]:min-h-30"
        style={height !== undefined ? { height } : undefined}
      />
      {meta.error !== undefined && (
        <p role="alert" className="text-xs text-destructive">
          {meta.error}
        </p>
      )}
    </div>
  );
}
