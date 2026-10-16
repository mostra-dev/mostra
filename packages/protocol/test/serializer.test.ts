/**
 * The serializer's conformance suite (D54, RS-01 seam 2): every type React documents for Server
 * Functions round-trips through Mostra's serializer exactly as it does through React's own Flight
 * reply codec, and every documented unsupported type is refused, naming where it is. React's
 * codec runs in a child process under the `react-server` condition its server build needs.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { expect, describe as group, it } from "vitest";
import {
  type AnyFunction,
  deserializeAll,
  type Frame,
  fromBase64,
  SerializationError,
  serializeAll,
  toBase64,
  ValueReader,
  ValueWriter,
} from "../src/index.ts";
import { CASES, describe } from "./fixtures/serializer-cases.ts";

type ReactVerdict = { accepted: true; value: string } | { accepted: false; message: string };

const reactVerdicts: Record<string, ReactVerdict> = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      fileURLToPath(new URL("./fixtures/react-flight.mjs", import.meta.url)),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ),
) as Record<string, ReactVerdict>;

async function roundTrip(value: unknown, mode: "argument" | "result"): Promise<unknown> {
  const batches = await serializeAll(value, { mode });
  // What crosses the wire is JSON text.
  const wire = JSON.parse(JSON.stringify(batches)) as unknown[];
  return deserializeAll(wire);
}

group("the documented type set, against React's Flight reply codec", () => {
  for (const testCase of CASES) {
    const react = reactVerdicts[testCase.name];
    it(`${testCase.name}: ${testCase.documented}`, async () => {
      expect(react, "React's verdict").toBeDefined();
      // React itself behaves as documented, or as the recorded divergence says.
      const reactAccepts = testCase.react
        ? testCase.react === "accepted"
        : testCase.documented === "supported";
      expect(react?.accepted).toBe(reactAccepts);

      if (testCase.documented === "supported") {
        const expected = await describe(testCase.make());
        if (testCase.argument === "refused") {
          await expect(serializeAll([testCase.make()], { mode: "argument" })).rejects.toThrow();
        } else {
          const [back] = (await roundTrip([testCase.make()], "argument")) as unknown[];
          const ours = await describe(back);
          expect(ours).toBe(expected);
          // Where React takes it, both come back the same.
          if (react?.accepted) expect(ours).toBe(react.value);
        }
        // A result carries the same type set (wrapped, so a promise isn't flattened by `await`).
        const [result] = (await roundTrip([testCase.make()], "result")) as unknown[];
        expect(await describe(result)).toBe(expected);
      } else {
        await expect(serializeAll([testCase.make()], { mode: "argument" })).rejects.toThrow(
          SerializationError,
        );
        await expect(serializeAll(testCase.make(), { mode: "result" })).rejects.toThrow(
          SerializationError,
        );
      }
    });
  }
});

group("refusals name where the value is", () => {
  it("names the argument and the path", async () => {
    const error = await serializeAll(["ok", { items: [1, new (class Foo {})()] }], {
      mode: "argument",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SerializationError);
    expect((error as SerializationError).code).toBe("MOSTRA_ACTION_UNSERIALIZABLE");
    expect((error as Error).message).toBe(
      "Argument 2 at .items[1] is an instance of Foo; only plain objects and the built-ins React's Server Functions accept can be sent.",
    );
  });

  it("names a result's path", async () => {
    const error = await serializeAll({ when: Symbol("x") }, { mode: "result" }).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toMatch(/^The result\.when is a symbol not registered/);
  });

  it("refuses an async iterable as an argument, takes it as a result", async () => {
    async function* items() {
      yield 1;
    }
    await expect(serializeAll([items()], { mode: "argument" })).rejects.toThrow(
      /only a result may be one/,
    );
    await expect(serializeAll(items(), { mode: "result" })).resolves.toBeDefined();
  });
});

group("Server Functions", () => {
  it("cross as references both ways", async () => {
    const sendReply = async (): Promise<string> => "sent";
    const ids = new Map<AnyFunction, string>([[sendReply, "actions.ts#sendReply"]]);
    const batches = await serializeAll([{ callback: sendReply }], {
      mode: "argument",
      serverFunctionId: (fn) => ids.get(fn),
    });
    expect(JSON.stringify(batches)).toContain('"$hactions.ts#sendReply"');
    const [back] = (await deserializeAll(batches, {
      serverFunction: (id) => (id === "actions.ts#sendReply" ? sendReply : () => undefined),
    })) as { callback: () => Promise<string> }[];
    expect(back?.callback).toBe(sendReply);
  });

  it("refuses a reference without a resolver", async () => {
    const batches: Frame[][] = [[{ c: 0, v: ["$hx#y"] }]];
    await expect(deserializeAll(batches)).rejects.toThrow(/Server Function reference/);
  });
});

group("streaming results", () => {
  it("writes the root first, then promises and iterable items as they settle", async () => {
    let release!: (value: string) => void;
    const later = new Promise<string>((resolve) => {
      release = resolve;
    });
    async function* ticks() {
      yield { n: 1 };
      await later;
      yield new Date(0);
    }
    const batches: Frame[][] = [];
    const writer = new ValueWriter({ mode: "result", onBatch: (batch) => batches.push(batch) });
    await writer.write({ status: later, ticks: ticks() });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The root, then the first item; nothing that waits on `later` yet.
    expect(batches[0]?.[0]).toMatchObject({ c: 0 });
    const before = batches.length;
    expect(JSON.stringify(batches)).not.toContain('"p":');
    release("done");
    await writer.done;
    expect(batches.length).toBeGreaterThan(before);
    const reader = new ValueReader();
    for (const batch of batches) reader.push(JSON.parse(JSON.stringify(batch)));
    const value = (await reader.root) as { status: Promise<string>; ticks: AsyncIterable<unknown> };
    expect(await value.status).toBe("done");
    const items: unknown[] = [];
    for await (const item of value.ticks) items.push(item);
    expect(items).toEqual([{ n: 1 }, new Date(0)]);
  });

  it("carries a failed iteration and a rejected promise as errors with their code", async () => {
    async function* failing() {
      yield 1;
      throw Object.assign(new Error("source down"), { code: "MOSTRA_LIVE_SOURCE_FAILED" });
    }
    const value = (await roundTrip(
      { items: failing(), later: Promise.reject(new Error("nope")) },
      "result",
    )) as { items: AsyncIterable<number>; later: Promise<unknown> };
    await expect(value.later).rejects.toThrow("nope");
    const items: number[] = [];
    const failure = await (async () => {
      for await (const item of value.items) items.push(item);
    })().catch((error: unknown) => error);
    expect(items).toEqual([1]);
    expect(failure).toMatchObject({ message: "source down", code: "MOSTRA_LIVE_SOURCE_FAILED" });
  });

  it("writes an item outside the type set as the iteration's failure", async () => {
    async function* bad() {
      yield 1;
      yield new (class Nope {})();
      yield 3;
    }
    const value = (await roundTrip(bad(), "result")) as AsyncIterable<number>;
    const items: number[] = [];
    const failure = await (async () => {
      for await (const item of value) items.push(item);
    })().catch((error: unknown) => error);
    expect(items).toEqual([1]);
    expect(failure).toMatchObject({ code: "MOSTRA_ACTION_UNSERIALIZABLE" });
  });

  it("stops reading an iterable when the writer aborts", async () => {
    let finished = false;
    async function* endless() {
      try {
        for (let n = 0; ; n += 1) {
          yield n;
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      } finally {
        finished = true;
      }
    }
    const batches: Frame[][] = [];
    const writer = new ValueWriter({ mode: "result", onBatch: (batch) => batches.push(batch) });
    await writer.write(endless());
    await new Promise((resolve) => setTimeout(resolve, 20));
    writer.abort();
    await writer.done;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(true);
    const count = batches.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(batches.length).toBe(count);
  });
});

group("reading untrusted batches", () => {
  const bad: [string, unknown][] = [
    ["a batch that isn't an array", { c: 0, v: 1 }],
    ["a frame without an ID", [{ v: 1 }]],
    ["a missing chunk", [{ c: 0, v: "$Q4" }]],
    ["a bad bigint", [{ c: 0, v: "$n1.5" }]],
    ["a bad date", [{ c: 0, v: "$Dyesterday" }]],
    [
      "a bad typed array kind",
      [
        { c: 0, v: "$T1" },
        { c: 1, v: ["xx", ""] },
      ],
    ],
    [
      "malformed base64",
      [
        { c: 0, v: "$A1" },
        { c: 1, v: "@@" },
      ],
    ],
    [
      "a chunk written twice",
      [
        { c: 0, v: 1 },
        { c: 0, v: 2 },
      ],
    ],
    ["a non-finite number", [{ c: 0, v: Number.POSITIVE_INFINITY }]],
  ];
  for (const [name, batch] of bad) {
    it(`refuses ${name}`, () => {
      expect(() => new ValueReader().push(batch)).toThrow(SerializationError);
    });
  }

  it("never sets an object's prototype from a __proto__ key", async () => {
    const value = (await deserializeAll([
      [{ c: 0, v: JSON.parse('{"__proto__":{"polluted":1}}') }],
    ])) as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("refuses a value nested too deeply instead of exhausting the stack", async () => {
    let deep: unknown = 1;
    for (let index = 0; index < 600; index += 1) deep = [deep];
    await expect(serializeAll(deep, { mode: "result" })).rejects.toThrow(/nests too deeply/);
    let wire: unknown = 1;
    for (let index = 0; index < 600; index += 1) wire = [wire];
    expect(() => new ValueReader().push([{ c: 0, v: wire }])).toThrow(/nests too deeply/);
  });

  it("fails promises left open when the stream ends early", async () => {
    const [value] = (await deserializeAll([[{ c: 0, v: ["$@1"] }]])) as Promise<unknown>[];
    await expect(value).rejects.toThrow(/ended early/);
  });
});

group("properties", () => {
  const json = fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: "small" },
      fc.string(),
      fc.double(),
      fc.bigInt(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.date({ noInvalidDate: false }),
      fc.array(tie("value"), { maxLength: 4 }),
      fc.dictionary(fc.string(), tie("value"), { maxKeys: 4, noNullPrototype: true }),
      fc
        .array(fc.tuple(tie("value"), tie("value")), { maxLength: 3 })
        .map((pairs) => new Map(pairs)),
      fc.array(tie("value"), { maxLength: 3 }).map((items) => new Set(items)),
      fc.uint8Array({ maxLength: 8 }),
    ),
  })).value;

  it("round-trips any value of the type set", async () => {
    await fc.assert(
      fc.asyncProperty(json, async (value) => {
        expect(await describe(await roundTrip(value, "result"))).toBe(await describe(value));
      }),
      { numRuns: 300 },
    );
  });

  it("base64 round-trips any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
        expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
      }),
    );
  });
});
