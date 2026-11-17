"use server";

/** A greeting, as a plain call and as an action run. */
export async function greet(name: string): Promise<string> {
  return `Hello, ${name}`;
}
