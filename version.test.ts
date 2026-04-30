import { describe, expect, test } from "bun:test";
import { isOlder } from "./version";

describe("isOlder", () => {
  test("returns true when patch version is older", () => {
    expect(isOlder("1.0.36", "1.0.37")).toBe(true);
  });

  test("returns true when minor version is older", () => {
    expect(isOlder("1.0.99", "1.1.0")).toBe(true);
  });

  test("returns true when major version is older", () => {
    expect(isOlder("1.99.99", "2.0.0")).toBe(true);
  });

  test("returns false when versions match", () => {
    expect(isOlder("1.0.37", "1.0.37")).toBe(false);
  });

  test("returns false when current is newer", () => {
    expect(isOlder("1.0.37", "1.0.36")).toBe(false);
  });

  test("treats missing trailing segment as zero", () => {
    // `"1.0"` -> [1, 0, 0]; equal to `"1.0.0"`, so neither is older.
    expect(isOlder("1.0", "1.0.0")).toBe(false);
    // `"1.0"` < `"1.0.1"` because the missing segment defaults to 0.
    expect(isOlder("1.0", "1.0.1")).toBe(true);
  });

  test("coerces non-numeric segments to zero rather than throwing", () => {
    // The npm registry should never feed us this, but keep the guard.
    expect(isOlder("1.0.x", "1.0.1")).toBe(true);
    expect(isOlder("garbage", "0.0.0")).toBe(false);
  });

  test("does not naively lexicographically compare (10 > 9)", () => {
    expect(isOlder("1.0.9", "1.0.10")).toBe(true);
    expect(isOlder("1.0.10", "1.0.9")).toBe(false);
  });
});
