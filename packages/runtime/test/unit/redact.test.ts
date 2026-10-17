/**
 * Redacting what server code sends out (D131, AC-06): result and live frames redacted as values,
 * never as text, and multi-line secrets protected a line at a time (Opus review 7 and 8). The
 * frames come from the real serializer and go back through its real reader.
 */
import { deserializeAll, type Frame, serializeAll } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { REDACTED, Redactor, redactFrames } from "../../src/log.ts";

const TOKEN = "s3cr3t-token-value";

async function redactedRoundTrip(value: unknown, redactor: Redactor): Promise<unknown> {
  const batches = await serializeAll(value, { mode: "result" });
  const redacted = batches.map((batch) => redactFrames([...batch], redactor) as Frame[]);
  return deserializeAll(JSON.parse(JSON.stringify(redacted)) as unknown[]);
}

describe("redacting result frames as values (Opus review 7)", () => {
  const redactor = new Redactor();
  redactor.protectSecret(TOKEN);
  redactor.protectSecret("$ecretValue1");

  it("keeps a $-leading secret a string", async () => {
    expect(await redactedRoundTrip(["$ecretValue1", "a $ecretValue1 b"], redactor)).toEqual([
      REDACTED,
      `a ${REDACTED} b`,
    ]);
    // A plain string that holds a `$` escape stays one.
    expect(await redactedRoundTrip(["$plain", "$$both"], redactor)).toEqual(["$plain", "$$both"]);
  });

  it("masks a secret's bytes in binary values, keeping every length", async () => {
    const bytes = new TextEncoder().encode(`before ${TOKEN} after`);
    const back = (await redactedRoundTrip(
      {
        u8: bytes,
        buffer: bytes.slice().buffer,
        // An even length, so the bytes read as 16-bit numbers too.
        i16: new Int16Array(new TextEncoder().encode(`${TOKEN}xx`).buffer),
        nodeBuffer: Buffer.from(bytes),
      },
      redactor,
    )) as Record<string, ArrayBufferView | ArrayBuffer>;
    const text = (view: ArrayBufferView | ArrayBuffer): string =>
      new TextDecoder().decode(
        view instanceof ArrayBuffer
          ? new Uint8Array(view)
          : new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      );
    const masked = `before ${"*".repeat(TOKEN.length)} after`;
    expect(text(back["u8"] as Uint8Array)).toBe(masked);
    expect(text(back["buffer"] as ArrayBuffer)).toBe(masked);
    expect(text(back["nodeBuffer"] as Uint8Array)).toBe(masked);
    expect(text(back["i16"] as Int16Array)).toBe(`${"*".repeat(TOKEN.length)}xx`);
    expect((back["i16"] as Int16Array).length).toBe((TOKEN.length + 2) / 2);
  });

  it("masks a file's bytes and name inside a FormData", async () => {
    const form = new FormData();
    form.append("note", `token ${TOKEN}`);
    form.append("file", new File([`key=${TOKEN}`], `${TOKEN}.txt`, { type: "text/plain" }));
    const back = (await redactedRoundTrip(form, redactor)) as FormData;
    expect(back.get("note")).toBe(`token ${REDACTED}`);
    const file = back.get("file") as File;
    expect(file.name).toBe(`${REDACTED}.txt`);
    expect(await file.text()).toBe(`key=${"*".repeat(TOKEN.length)}`);
  });

  it("redacts keys, map entries, a symbol's name, and streamed parts", async () => {
    async function* items() {
      yield { [TOKEN]: TOKEN };
    }
    const back = (await redactedRoundTrip(
      {
        map: new Map([[TOKEN, TOKEN]]),
        symbol: Symbol.for(`sym-${TOKEN}`),
        later: Promise.resolve(`late ${TOKEN}`),
        stream: items(),
      },
      redactor,
    )) as {
      map: Map<string, string>;
      symbol: symbol;
      later: Promise<string>;
      stream: AsyncIterable<Record<string, string>>;
    };
    expect([...back.map]).toEqual([[REDACTED, REDACTED]]);
    expect(Symbol.keyFor(back.symbol)).toBe(`sym-${REDACTED}`);
    expect(await back.later).toBe(`late ${REDACTED}`);
    const streamed: Record<string, string>[] = [];
    for await (const item of back.stream) streamed.push(item);
    expect(streamed).toEqual([{ [REDACTED]: REDACTED }]);
  });

  it("leaves frames without a secret as they were", async () => {
    const batches = await serializeAll({ a: "$x", b: new Uint8Array([1, 2]) }, { mode: "result" });
    for (const batch of batches) expect(redactFrames([...batch], redactor)).toEqual(batch);
  });
});

describe("multi-line secrets (Opus review 8)", () => {
  const pem = [
    "-----BEGIN PRIVATE KEY-----",
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
    "c2VjcmV0LWtleS1ib2R5LWxpbmUtdHdvLW9mLXRoZS1rZXk=",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const redactor = new Redactor();
  redactor.protectSecret(pem);

  it("redacts each line of the secret as output carries it, a line at a time", () => {
    for (const line of pem.split("\n")) {
      expect(redactor.redact(`stderr: ${line}`)).toBe(`stderr: ${REDACTED}`);
    }
    expect(redactor.redact(pem)).toBe(REDACTED);
  });

  it("redacts the lines util.inspect splits a long string into", () => {
    const inspected = pem
      .split("\n")
      .map((line) => `  '${line}\\n' +`)
      .join("\n");
    for (const line of pem.split("\n")) expect(redactor.redact(inspected)).not.toContain(line);
  });
});
