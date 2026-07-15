import { describe, expect, it } from "vitest";
import { isEntityId, isISO8601Timestamp } from "../../core/project/primitives";

describe("project primitive guards", () => {
  it("validates entity IDs and timezone/calendar timestamp boundaries", () => {
    expect(isEntityId(" project-1 ")).toBe(true);
    expect(isEntityId("   ")).toBe(false);
    expect(isEntityId(null)).toBe(false);

    expect(isISO8601Timestamp("2024-02-29T23:59:59.123456789+14:00")).toBe(true);
    expect(isISO8601Timestamp("2023-02-29T23:59:59Z")).toBe(false);
    expect(isISO8601Timestamp("2026-07-15T12:00:00+14:01")).toBe(false);
    expect(isISO8601Timestamp("2026-07-15T12:00:00+03:60")).toBe(false);
    expect(isISO8601Timestamp("2026-13-15T12:00:00Z")).toBe(false);
  });
});
