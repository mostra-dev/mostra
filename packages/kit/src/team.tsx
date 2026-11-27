"use client";

/**
 * Team parts on the team hooks (KT-11, D121, D168): who is here (`PresenceAvatars`), where they are
 * pointing (`LiveCursors`), who has answered (`RespondentTracker`) and who changed a shared field
 * (`Attribution`). Each draws exactly what its hook gives under the artifact's `team.visibility`
 * (`private` shows only the viewer's own entry, `counts` the numbers, `names` everyone) and
 * nothing more, draws without data where the hooks are unavailable (outside a live page, in
 * `verify`), and takes the hook's value as a prop too, so a page can draw it from its own data. A
 * person's colour comes from their key (`vk_…`), the same in all four, so one person's avatar,
 * cursor and chip match. Every part reads the tokens and takes `className`; `mostra add
 * mostra-team` copies the module (D68).
 */

import {
  type FieldMeta,
  type Presence,
  type PresencePeer,
  type RespondentForPage,
  type Respondents,
  usePresence,
  useRespondents,
} from "@mostra/react";
import { cn } from "cn";
import * as React from "react";
import { createPortal } from "react-dom";

/* -------------------------------------------------------------------------------------------- */
/* A person's colour and name                                                                    */

/** A person's colour from their key: one of the theme's six series colours, stable per key. */
export function personColor(key: string | undefined): string {
  if (key === undefined || key === "") return "var(--muted-foreground)";
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) | 0;
  return `var(--chart-${(Math.abs(hash) % 6) + 1})`;
}

/** A person's initials, for an avatar: two letters of their name, or `?`. */
function initials(name: string | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : (words[0]?.[1] ?? "");
  return `${first}${last}`.toUpperCase();
}

/** A person as text: their name, or how the page knows them without one. */
function nameOf(person: { readonly name?: string; readonly self?: boolean } | undefined): string {
  if (person?.self) return "You";
  return person?.name?.trim() || "Someone";
}

/** A list of names as a sentence: "Ada", "Ada and Bo", "Ada, Bo and 3 others". */
function sentence(names: readonly string[], more: number): string {
  const all = more > 0 ? [...names, `${more} ${more === 1 ? "other" : "others"}`] : [...names];
  if (all.length <= 1) return all[0] ?? "";
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

/* -------------------------------------------------------------------------------------------- */
/* PresenceAvatars                                                                               */

/** {@link PresenceAvatars}'s props. */
export interface PresenceAvatarsProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** Who is here, as `usePresence()` gives it; default read from the hook. */
  readonly presence?: Presence;
  /** How many avatars show before the rest become "+N". Default 5. */
  readonly max?: number;
  /** Show this viewer too. Default false. */
  readonly showSelf?: boolean;
}

/**
 * The people here now, as a row of avatars with their names for screen readers: everyone under
 * `names`, how many under `counts`, nothing of others under `private`.
 *
 * ```tsx
 * <PresenceAvatars />
 * ```
 */
export function PresenceAvatars({ presence, ...props }: PresenceAvatarsProps): React.JSX.Element {
  return presence !== undefined ? (
    <AvatarsView presence={presence} {...props} />
  ) : (
    <LiveAvatars {...props} />
  );
}

function LiveAvatars(props: Omit<PresenceAvatarsProps, "presence">): React.JSX.Element {
  return <AvatarsView presence={usePresence()} {...props} />;
}

function AvatarsView({
  presence,
  max = 5,
  showSelf = false,
  className,
  ...props
}: PresenceAvatarsProps & { readonly presence: Presence }): React.JSX.Element {
  const people: PresencePeer[] = [
    ...(showSelf && presence.self ? [presence.self] : []),
    ...presence.others,
  ];
  const shown = people.slice(0, Math.max(0, max));
  // Under `counts` the page knows how many others are here, not who.
  const others = presence.count ?? presence.others.length;
  const unnamed = Math.max(0, others - presence.others.length);
  const more = people.length - shown.length + unnamed;
  const label =
    presence.status === "unavailable"
      ? "Who is here shows on the shared page."
      : others === 0
        ? "Nobody else is here."
        : shown.length === 0
          ? `${others} ${others === 1 ? "other person is" : "other people are"} here.`
          : `${sentence(
              shown.map((peer) => nameOf(peer)),
              more,
            )} ${shown.length + more === 1 && !shown[0]?.self ? "is" : "are"} here.`;
  return (
    <div
      data-slot="presence-avatars"
      data-status={presence.status}
      className={cn("flex w-fit items-center", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      <ul aria-hidden="true" className="flex items-center -space-x-1">
        {shown.map((peer) => (
          <li
            key={peer.key}
            title={nameOf(peer)}
            className="flex size-8 items-center justify-center rounded-full border-2 text-xs font-medium text-foreground"
            style={{
              background: `color-mix(in oklab, ${personColor(peer.key)} 28%, var(--card))`,
              borderColor: personColor(peer.key),
            }}
          >
            {initials(peer.name ?? (peer.self ? "You" : undefined))}
          </li>
        ))}
        {more > 0 && (
          <li className="flex h-8 min-w-8 items-center justify-center rounded-full border-2 border-(--background) bg-muted px-2 text-xs font-medium text-muted-foreground">
            +{more}
          </li>
        )}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* LiveCursors                                                                                   */

/** {@link LiveCursors}'s props. */
export interface LiveCursorsProps {
  /** The others and their cursors, as `usePresence({ cursor: true })` gives them; default read from the hook, which shares this viewer's pointer. */
  readonly presence?: Presence;
  /** Classes for each cursor's element. */
  readonly className?: string;
}

/**
 * The pointers of the others here, each with their name, over the page in document coordinates.
 * Without a `presence` it shares this viewer's own pointer while it is mounted (the hook's
 * `cursor`), so mounting it is the page's opt-in. Others' cursors show under `names` only.
 *
 * ```tsx
 * <LiveCursors />
 * ```
 */
export function LiveCursors({ presence, className }: LiveCursorsProps): React.JSX.Element | null {
  return presence !== undefined ? (
    <CursorsView presence={presence} {...(className ? { className } : {})} />
  ) : (
    <LiveCursorsHook {...(className ? { className } : {})} />
  );
}

function LiveCursorsHook({ className }: { readonly className?: string }): React.JSX.Element | null {
  return (
    <CursorsView presence={usePresence({ cursor: true })} {...(className ? { className } : {})} />
  );
}

function CursorsView({
  presence,
  className,
}: {
  readonly presence: Presence;
  readonly className?: string;
}): React.JSX.Element | null {
  if (typeof document === "undefined") return null;
  const host = document.body;
  const pointing = presence.others.filter((peer) => peer.cursor !== undefined);
  return createPortal(
    <div data-slot="live-cursors" aria-hidden="true" className="pointer-events-none">
      {pointing.map((peer) => (
        <div
          key={peer.key}
          data-slot="live-cursor"
          data-name={peer.name}
          className={cn(
            "absolute top-0 left-0 z-50 transition-transform duration-100 ease-out motion-reduce:transition-none",
            className,
          )}
          style={{
            transform: `translate(${peer.cursor?.x ?? 0}px, ${peer.cursor?.y ?? 0}px)`,
            color: personColor(peer.key),
          }}
        >
          <svg
            width="16"
            height="20"
            viewBox="0 0 16 20"
            fill="none"
            aria-hidden="true"
            className="block"
          >
            <path
              d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z"
              fill="currentColor"
              stroke="var(--background)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span
            // The name sits at the arrow's tail, close enough to read as the same person's (M112).
            className="absolute top-3.5 left-2.5 rounded-full border-2 bg-card px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground"
            style={{ borderColor: personColor(peer.key) }}
          >
            {nameOf(peer)}
          </span>
        </div>
      ))}
    </div>,
    host,
  );
}

/* -------------------------------------------------------------------------------------------- */
/* RespondentTracker                                                                             */

/** {@link RespondentTracker}'s props. */
export interface RespondentTrackerProps
  extends Omit<React.ComponentProps<"section">, "children" | "title"> {
  /** The roster, as `useRespondents()` gives it; default read from the hook. */
  readonly respondents?: Respondents;
  /** Its heading. Default "Answers". */
  readonly title?: React.ReactNode;
}

const STATUS: Readonly<Record<RespondentForPage["status"], string>> = {
  "not-opened": "Not opened",
  drafting: "Drafting",
  submitted: "Answered",
};

/**
 * Who has answered: "3 of 5 answered" with a bar under `counts` and `names`, each person and where
 * they stand under `names`, and only the viewer's own answer under `private`.
 *
 * ```tsx
 * <RespondentTracker />
 * ```
 */
export function RespondentTracker({
  respondents,
  ...props
}: RespondentTrackerProps): React.JSX.Element {
  return respondents !== undefined ? (
    <TrackerView respondents={respondents} {...props} />
  ) : (
    <LiveTracker {...props} />
  );
}

function LiveTracker(props: Omit<RespondentTrackerProps, "respondents">): React.JSX.Element {
  return <TrackerView respondents={useRespondents()} {...props} />;
}

function TrackerView({
  respondents,
  title = "Answers",
  className,
  ...props
}: RespondentTrackerProps & { readonly respondents: Respondents }): React.JSX.Element {
  const { counts, self } = respondents;
  const headingId = React.useId();
  const share = counts && counts.total > 0 ? counts.submitted / counts.total : 0;
  return (
    <section
      data-slot="respondent-tracker"
      data-status={respondents.status}
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-3 rounded-card bg-card p-4 text-sm text-card-foreground shadow-card",
        className,
      )}
      {...props}
    >
      <h3 id={headingId} className="font-medium">
        {title}
      </h3>
      {respondents.status === "unavailable" ? (
        <p className="text-muted-foreground">Who has answered shows on the shared page.</p>
      ) : respondents.status === "loading" ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : counts ? (
        <div className="flex flex-col gap-1.5">
          <p>
            <span className="font-medium tabular-nums">
              {counts.submitted} of {counts.total}
            </span>{" "}
            answered{respondents.complete ? ", everyone is in" : ""}
            {counts.drafting > 0 ? `, ${counts.drafting} drafting` : ""}
          </p>
          <div
            role="progressbar"
            aria-label="Answered"
            aria-valuemin={0}
            aria-valuemax={counts.total}
            aria-valuenow={counts.submitted}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-(--answer) transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </div>
        </div>
      ) : self ? (
        <p>{self.status === "submitted" ? "Your answer is in." : "You haven't answered yet."}</p>
      ) : (
        <p className="text-muted-foreground">Nobody is expected to answer yet.</p>
      )}
      {respondents.respondents.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {respondents.respondents.map((person) => (
            <li key={person.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: personColor(person.key) }}
              />
              <span className="min-w-0 flex-1 truncate">{nameOf(person)}</span>
              <span
                data-respondent-status={person.status}
                className={cn(
                  "rounded-badge px-2 py-0.5 text-xs",
                  person.status === "submitted"
                    ? "bg-(--answer)/20 text-foreground"
                    : person.status === "drafting"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground",
                )}
              >
                {STATUS[person.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Attribution                                                                                   */

/** Who last wrote a shared field: a field's `meta.updatedBy`. */
export type UpdatedBy = NonNullable<FieldMeta<unknown>["updatedBy"]>;

/** {@link Attribution}'s props. */
export interface AttributionProps extends Omit<React.ComponentProps<"span">, "children"> {
  /** Who last changed the field, from `useField`'s `meta.updatedBy`; nothing shows without it. */
  readonly by: UpdatedBy | undefined;
  /** The time to count from, for tests and screenshots; default now. */
  readonly now?: Date;
}

/** How long ago, in words: "just now", "4 min ago", "2 h ago", or the date. */
function ago(at: string | undefined, now: Date): string | undefined {
  if (at === undefined) return undefined;
  const then = new Date(at);
  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return undefined;
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return then.toLocaleDateString();
}

/**
 * Who changed a shared field and when, as a small chip in that person's colour: "Grace · 4 min
 * ago", "You · just now", "The agent".
 *
 * ```tsx
 * const [tasks, setTasks, meta] = useField("tasks", [], { scope: "artifact" });
 * <Attribution by={meta.updatedBy} />
 * ```
 */
export function Attribution({
  by,
  now,
  className,
  ...props
}: AttributionProps): React.JSX.Element | null {
  // The time moves on while the page is open: the chip reads it again every half minute.
  const [tick, setTick] = React.useState(() => now ?? new Date());
  React.useEffect(() => {
    if (now !== undefined) return;
    const timer = setInterval(() => setTick(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [now]);
  if (by === undefined) return null;
  const who =
    by.kind === "agent"
      ? "The agent"
      : by.kind === "host"
        ? "The host"
        : by.self
          ? "You"
          : by.name?.trim() || "Someone";
  const when = ago(by.at, now ?? tick);
  return (
    <span
      data-slot="attribution"
      data-kind={by.kind}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-badge bg-muted px-2 py-0.5 text-xs text-muted-foreground",
        className,
      )}
      {...(by.at ? { title: new Date(by.at).toLocaleString() } : {})}
      {...props}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{
          background: by.kind === "viewer" ? personColor(by.key) : "var(--muted-foreground)",
        }}
      />
      <span>
        <span className="text-foreground">{who}</span>
        {when !== undefined ? ` · ${when}` : ""}
      </span>
    </span>
  );
}
