/**
 * Mail an operator sends (a notice, an invitation, a statement of reasons), in its theme: HTML
 * that holds in light and dark clients and with images off, and the plain text beside it carrying
 * the whole message. This package sends nothing; the operator's mailer does.
 *
 * Mail clients read little CSS: one 600 px column of tables, every style inline in literal hex,
 * the faces as a preference over the system's, one button, and a hidden preview line.
 */
import { type HtmlValue, html, type SafeHtml, text } from "./html.ts";
import { safeHref } from "./pages.ts";
import type { Theme } from "./theme.ts";

/** One message. */
export interface MailContent {
  /** The subject line. */
  readonly subject: string;
  /** The line inboxes show after the subject. */
  readonly preheader: string;
  /** The message's heading, its first words in the body. */
  readonly heading: string;
  /** Paragraphs, in order: text, or markup built with `html`. */
  readonly paragraphs: readonly HtmlValue[];
  /** The one thing to do, as a button: an `https:` link. */
  readonly action?: { readonly href: string; readonly label: string };
  /** Why the person got this, who sent it, how to stop it: small print. */
  readonly footer: readonly string[];
}

/** How the sender names itself at the top. */
export interface MailIdentity {
  /** The sender's name, set in type: "Mostra", or an operator's own. */
  readonly name: string;
  /** An `https:` image of the sender's mark; mail with images off still reads by its name. */
  readonly logo?: { readonly src: string; readonly width: number; readonly height: number };
}

/** A rendered message: the parts a mailer sends. */
export interface Mail {
  /** The subject line. */
  readonly subject: string;
  /** The HTML part. */
  readonly html: string;
  /** The plain-text part, the whole message. */
  readonly text: string;
}

/** The plain-text form of markup: tags dropped, entities read, links kept beside their words. */
function plain(value: HtmlValue): string {
  return text(value)
    .value.replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Renders a message in a theme. */
export function renderMail(theme: Theme, identity: MailIdentity, content: MailContent): Mail {
  const light = theme.modes.light;
  const dark = theme.modes.dark;
  const sans = `'${theme.faces.sans.family}', ${theme.faces.sans.fallback.replace(/ui-sans-serif, /, "")}, 'Helvetica Neue', Arial, sans-serif`;
  const display = `'${theme.faces.display.family}', ${sans}`;
  const href = content.action ? safeHref(content.action.href) : undefined;
  const logo = identity.logo && safeHref(identity.logo.src);
  const brand: SafeHtml = logo
    ? html`<img src="${logo}" width="${identity.logo?.width ?? 0}" height="${identity.logo?.height ?? 0}" alt="${identity.name}" style="display:block;border:0;height:${identity.logo?.height ?? 0}px;width:auto;">`
    : html`<span class="m-name" style="font-family:${display};font-size:20px;font-weight:500;color:${light.foreground.hex};">${identity.name}</span>`;
  const body = html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${content.subject}</title>
<style>
/* ${theme.name}: ${light.background.hex} ground, ${light.card.hex} card, ${light.foreground.hex} text, ${light.primary.hex} action. */
@media (prefers-color-scheme: dark) {
  .m-ground { background: ${dark.background.hex} !important; }
  .m-card { background: ${dark.card.hex} !important; border-color: ${dark.border.hex} !important; }
  .m-text, .m-name, .m-heading { color: ${dark.foreground.hex} !important; }
  .m-muted { color: ${dark.mutedForeground.hex} !important; }
  .m-button { background: ${dark.primary.hex} !important; color: ${dark.primaryForeground.hex} !important; }
  .m-link { color: ${dark.primary.hex} !important; }
}
</style></head>
<body class="m-ground" style="margin:0;padding:0;background:${light.background.hex};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${content.preheader}</div>
<table role="presentation" class="m-ground" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${light.background.hex};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 8px 20px;">${brand}</td></tr>
<tr><td class="m-card" style="background:${light.card.hex};border:1px solid ${light.border.hex};border-radius:16px;padding:32px;">
<h1 class="m-heading" style="margin:0 0 16px;font-family:${display};font-size:26px;line-height:1.2;font-weight:500;letter-spacing:-0.01em;color:${light.foreground.hex};">${content.heading}</h1>
${content.paragraphs.map((paragraph) => html`<p class="m-text" style="margin:0 0 16px;font-family:${sans};font-size:16px;line-height:1.55;color:${light.foreground.hex};">${paragraph}</p>`)}
${
  href && content.action
    ? html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr><td style="border-radius:999px;background:${light.primary.hex};"><a class="m-button" href="${href}" style="display:inline-block;padding:14px 26px;font-family:${sans};font-size:16px;font-weight:600;line-height:1;color:${light.primaryForeground.hex};text-decoration:none;border-radius:999px;background:${light.primary.hex};">${content.action.label}</a></td></tr></table>`
    : ""
}
</td></tr>
<tr><td style="padding:20px 8px 0;">${content.footer.map((line) => html`<p class="m-muted" style="margin:0 0 8px;font-family:${sans};font-size:13px;line-height:1.5;color:${light.mutedForeground.hex};">${line}</p>`)}</td></tr>
</table></td></tr></table></body></html>`;
  const lines = [
    identity.name,
    "",
    content.heading,
    "",
    ...content.paragraphs.flatMap((paragraph) => [plain(paragraph), ""]),
    ...(href && content.action ? [`${content.action.label}: ${href}`, ""] : []),
    "--",
    ...content.footer,
  ];
  return { subject: content.subject, html: body.value, text: `${lines.join("\n").trim()}\n` };
}
