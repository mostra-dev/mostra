import { BRIDGE_FIELDS_MAX, BRIDGE_TEXT_MAX, mostraFields, mostraFlush } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { blockersForShell, clip, firstThatMatter } from "../src/runtime/bridge-limits.ts";

describe("what the page sends the shell fits the bridge (Claude review finding 11)", () => {
  it("shortens a long label and keeps short ones", () => {
    expect(clip("Your name")).toBe("Your name");
    const long = clip("Why? ".repeat(1000));
    expect(long.length).toBe(BRIDGE_TEXT_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("lists at most the bridge's count, required and failing fields first, and the shell accepts it", () => {
    const fields = Array.from({ length: BRIDGE_FIELDS_MAX + 5 }, (_, index) => ({
      id: `cell.${index}`,
      scope: "viewer" as const,
      label: clip(`Cell ${index} `.repeat(200)),
      ...(index === BRIDGE_FIELDS_MAX + 4 ? { required: true } : {}),
    }));
    const sent = firstThatMatter(fields, (field) => field.required === true);
    expect(sent).toHaveLength(BRIDGE_FIELDS_MAX);
    expect(sent[0]?.id).toBe(`cell.${BRIDGE_FIELDS_MAX + 4}`);
    expect(
      mostraFields.params.safeParse({ fields: sent, save: "saved", unsaved: false }).success,
    ).toBe(true);
  });

  it("answers a flush the shell accepts, whatever the blockers' labels", () => {
    const raw = [
      { fieldId: "q1", label: "A very long question? ".repeat(100), reason: "required" },
    ];
    // What the page sent before: the shell refused it, and every trusted Submit with it.
    expect(
      mostraFlush.result.safeParse({ revision: "3", unsaved: false, blockers: raw }).success,
    ).toBe(false);
    const blockers = blockersForShell([
      { fieldId: "q1", label: "A very long question? ".repeat(100), reason: "required" },
    ]);
    expect(mostraFlush.result.safeParse({ revision: "3", unsaved: false, blockers }).success).toBe(
      true,
    );
  });
});
