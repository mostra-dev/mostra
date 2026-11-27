/**
 * The live chart's columns (AC-08, WP-19): appending keeps the newest `window` points in order,
 * and the points it draws on a narrow plot keep every column's first, last, lowest and highest
 * point of each series, so the line looks as it would through all of them.
 */
import { describe, expect, it } from "vitest";
import { Columns, newPointsFrom } from "../src/live-chart.tsx";

describe("the live chart's columns", () => {
  it("keeps the newest window of points, in order, across the buffer's moves", () => {
    const columns = new Columns(5, 1);
    for (let index = 0; index < 23; index++) columns.push(index, [index * 10]);
    const [xs, ys] = columns.data() as unknown as [Float64Array, Float64Array];
    expect([...xs]).toEqual([18, 19, 20, 21, 22]);
    expect([...ys]).toEqual([180, 190, 200, 210, 220]);
  });

  it("draws every point while there are at most two a pixel column", () => {
    const columns = new Columns(100, 1);
    for (let index = 0; index < 100; index++) columns.push(index, [index]);
    expect(columns.drawn(50)[0]?.length).toBe(100);
  });

  it("draws each column's first, last, lowest and highest points, every peak kept", () => {
    const columns = new Columns(10_000, 2);
    for (let index = 0; index < 10_000; index++) {
      const spike = index === 4321 ? 1000 : index === 8765 ? -1000 : 0;
      columns.push(index, [Math.sin(index / 50) + spike, Math.cos(index / 70)]);
    }
    const [xs, a, b] = columns.drawn(500) as unknown as [Float64Array, Float64Array, Float64Array];
    expect(xs.length).toBeLessThanOrEqual(500 * 6);
    expect(xs.length).toBeGreaterThan(1000);
    // In order, first and last kept.
    expect([...xs].every((x, i) => i === 0 || x > (xs[i - 1] as number))).toBe(true);
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(9999);
    // Every extreme of every series is drawn.
    expect(Math.max(...a)).toBe(1000 + Math.sin(4321 / 50));
    expect(Math.min(...a)).toBe(-1000 + Math.sin(8765 / 50));
    const all = Array.from({ length: 10_000 }, (_, i) => Math.cos(i / 70));
    expect(Math.max(...b)).toBe(Math.max(...all));
    expect(Math.min(...b)).toBe(Math.min(...all));
  });
});

describe("the points a live chart takes from each list (Opus review of WP-19, finding 4)", () => {
  const point = (t: number) => ({ t, v: t });
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => point(from + i));

  it("takes what was appended, the oldest dropped past the window", () => {
    const held = range(0, 9);
    const list = [...held.slice(3), point(10), point(11), point(12)];
    expect(newPointsFrom(held, list)).toBe(7);
    expect(newPointsFrom(held, held)).toBe(10);
    expect(newPointsFrom([], held)).toBe(0);
  });

  it("starts over when a gap was read again: the older points decoded afresh, the newer kept", () => {
    // Point 500 never arrived; 501 was drawn; 502 to 505 arrived while the source was read again.
    const held = [...range(490, 499), point(501), ...range(502, 505)];
    const recovered = [...range(490, 501), ...held.slice(-4)];
    expect(newPointsFrom(held, recovered)).toBeUndefined();
  });

  it("starts over on a list that doesn't hold the last point drawn", () => {
    expect(newPointsFrom(range(0, 4), range(10, 14))).toBeUndefined();
  });
});
