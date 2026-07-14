import { describe, expect, it } from "vitest";
import {
  legacyProjectV0Ambiguity,
  legacyProjectV0Fixture,
} from "./fixtures/legacyProjectV0";

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return output;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }

  return output;
}

describe("sanitized SpriteBoy legacy V0 fixture", () => {
  it("round-trips as plain JSON without Blob or Data URLs", () => {
    const serialized = JSON.stringify(legacyProjectV0Fixture);
    const parsed = JSON.parse(serialized);
    const strings = collectStrings(parsed);

    expect(parsed).toEqual(legacyProjectV0Fixture);
    expect(strings.some((value) => value.startsWith("blob:"))).toBe(false);
    expect(strings.some((value) => value.startsWith("data:"))).toBe(false);
    expect(strings.some((value) => value.includes("AIza"))).toBe(false);
  });

  it("preserves representative Slice, Collision, Builder and Animation data", () => {
    const { project } = legacyProjectV0Fixture;

    expect(project.frames).toHaveLength(3);
    expect(project.frames[0].hitboxes?.[0]).toMatchObject({ tag: "body", type: "HURTBOX" });
    expect(project.builderSlots[0]).toMatchObject({ fitMode: "fit", alignment: "center" });
    expect(project.builderFreeObjects[0]).toMatchObject({ zIndex: 2, rotation: 15 });
    expect(project.animations[0]).toMatchObject({ fps: 12, loop: true });
  });

  it("makes the legacy cel-source collision explicit instead of choosing a precedence", () => {
    const { project } = legacyProjectV0Fixture;
    const keyframe = project.animations[0].keyframes.find(
      ({ uid }) => uid === legacyProjectV0Ambiguity.keyframeUid,
    );
    const matchingFrame = project.frames.find(
      ({ id }) => id === legacyProjectV0Ambiguity.sourceIndex,
    );
    const matchingSlot = project.builderSlots[legacyProjectV0Ambiguity.sourceIndex];

    expect(keyframe).toBeDefined();
    expect(matchingFrame?.id).toBe(legacyProjectV0Ambiguity.matchingFrameId);
    expect(matchingSlot?.gridIndex).toBe(legacyProjectV0Ambiguity.matchingBuilderGridIndex);
    expect(legacyProjectV0Ambiguity.expectedIssueCode).toBe("AMBIGUOUS_LEGACY_CEL_SOURCE");
  });
});
