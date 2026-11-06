import { describe, expect, it } from "vitest";
import { polarRotation } from "./math2";

describe("polarRotation", () => {
  it("keeps a 90 degree rotation", () => {
    const [r00, r01, r10, r11] = polarRotation(0, -1, 1, 0);
    expect(r00).toBeCloseTo(0, 5);
    expect(r01).toBeCloseTo(-1, 5);
    expect(r10).toBeCloseTo(1, 5);
    expect(r11).toBeCloseTo(0, 5);
  });

  it("removes uniform scale", () => {
    const [r00, r01, r10, r11] = polarRotation(2.5, 0, 0, 2.5);
    expect(r00).toBeCloseTo(1, 5);
    expect(r01).toBeCloseTo(0, 5);
    expect(r10).toBeCloseTo(0, 5);
    expect(r11).toBeCloseTo(1, 5);
  });

  it("extracts rotation from a scaled 40 degree turn", () => {
    const angle = (40 * Math.PI) / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const [r00, r01, r10, r11] = polarRotation(c * 1.7, -s * 1.4, s * 1.7, c * 1.4);
    expect(r00 * r11 - r01 * r10).toBeCloseTo(1, 4);
    expect(Math.hypot(r00, r10)).toBeCloseTo(1, 4);
    expect(Math.atan2(r10, r00)).toBeCloseTo(angle, 2);
  });
});
