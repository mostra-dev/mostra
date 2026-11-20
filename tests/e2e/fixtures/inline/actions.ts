"use server";

/** A greeting, as a plain call and as an action run. */
export async function greet(name: string): Promise<string> {
  return `Hello, ${name}`;
}

/** Three values, streamed one batch at a time. */
export async function* count(): AsyncIterable<number> {
  for (const value of [1, 2, 3]) yield value;
}
