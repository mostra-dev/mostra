"use client";

/**
 * A button that runs an action (D54, D185 item 8): it shows the run's state while it runs and,
 * where no server runs the action (an export of the page), it shows itself unavailable where it
 * sits, disabled with the reason beside it, instead of failing when someone presses it.
 *
 * ```tsx
 * import { ActionButton } from "@mostra/kit/action";
 * import { send } from "./actions";
 *
 * const sending = useAction(send);
 * <ActionButton action={sending} args={[draft]}>Send</ActionButton>
 * ```
 *
 * Ordinary React on the theme's tokens, the same in either base; it takes `className`, and
 * `mostra add mostra-action` copies it into the artifact for editing (D68, KT-10).
 */

import type { ActionHandle } from "@mostra/react";
import { cn } from "cn";
import type * as React from "react";

/** {@link ActionButton}'s props. */
export interface ActionButtonProps<A extends unknown[]>
  extends Omit<React.ComponentProps<"button">, "onClick"> {
  /** The action to run: what `useAction` gave. */
  readonly action: Pick<ActionHandle<A, unknown>, "run" | "isPending" | "available" | "unavailable">;
  /** The arguments it runs with. */
  readonly args?: A;
}

/** A button that runs an action, and says so where the action can't run. */
export function ActionButton<A extends unknown[]>({
  action,
  args,
  disabled,
  className,
  children,
  ...props
}: ActionButtonProps<A>): React.JSX.Element {
  const button = (
    <button
      type="button"
      data-slot="action-button"
      data-unavailable={action.available ? undefined : ""}
      disabled={disabled === true || action.isPending || !action.available}
      title={action.available ? undefined : action.unavailable}
      onClick={() => {
        void action.run(...((args ?? []) as A)).catch(() => undefined);
      }}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-(--radius) bg-(--primary) px-4 py-2 text-sm font-medium text-(--primary-foreground) transition-opacity disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
  if (action.available) return button;
  return (
    <span data-slot="action-unavailable" className="inline-flex flex-wrap items-center gap-2">
      {button}
      <span className="text-xs text-(--muted-foreground)">{action.unavailable}</span>
    </span>
  );
}
