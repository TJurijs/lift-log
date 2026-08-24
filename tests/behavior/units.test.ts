import { describe, expect, it } from "vitest";

import {
  KG_PER_LB,
  formatWeight,
  weightInputValue,
  weightKgValue,
} from "../../lib/units";

describe("weight units", () => {
  describe("formatWeight", () => {
    it.each([
      [0, "kg", "0"],
      [12.345, "kg", "12.35"],
      [12.3, "kg", "12.3"],
      [1, "lb", "2.2"],
      [100, "lb", "220.5"],
    ] as const)("formats %s kg in %s as %s", (valueKg, weightUnit, expected) => {
      expect(formatWeight(valueKg, weightUnit)).toBe(expected);
    });
  });

  describe("weightInputValue", () => {
    it.each([
      ["12.345", "kg", "12.35"],
      ["100", "lb", "220.5"],
      ["0", "lb", "0"],
      ["", "kg", ""],
      ["   ", "lb", "   "],
      ["not-a-number", "kg", "not-a-number"],
      ["Infinity", "lb", "Infinity"],
    ] as const)("maps %j from kg to %s as %j", (valueKg, weightUnit, expected) => {
      expect(weightInputValue(valueKg, weightUnit)).toBe(expected);
    });
  });

  describe("weightKgValue", () => {
    it.each([
      ["12.3456", "kg", "12.346"],
      ["220.5", "lb", "100.017"],
      ["0", "lb", "0"],
      ["", "kg", ""],
      ["   ", "lb", "   "],
      ["not-a-number", "kg", "not-a-number"],
      ["Infinity", "lb", "Infinity"],
    ] as const)("maps %j from %s to kg as %j", (value, weightUnit, expected) => {
      expect(weightKgValue(value, weightUnit)).toBe(expected);
    });
  });

  it.each([1, 20, 100, 250])(
    "round-trips %s kg through the displayed pound precision",
    (valueKg) => {
      const displayedPounds = weightInputValue(String(valueKg), "lb");
      const convertedBackKg = Number(weightKgValue(displayedPounds, "lb"));

      expect(Math.abs(convertedBackKg - valueKg)).toBeLessThanOrEqual(
        0.05 * KG_PER_LB + 0.0005,
      );
    },
  );

  it.each([2.2, 45.5, 220.5, 551.2])(
    "round-trips %s lb through stored kilogram precision",
    (valueLb) => {
      const storedKg = weightKgValue(String(valueLb), "lb");
      const displayedAgainLb = Number(weightInputValue(storedKg, "lb"));

      expect(Math.abs(displayedAgainLb - valueLb)).toBeLessThanOrEqual(
        0.0005 / KG_PER_LB + 0.05,
      );
    },
  );
});
