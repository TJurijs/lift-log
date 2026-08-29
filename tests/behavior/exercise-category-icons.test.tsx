import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ExerciseCategoryMark,
  exerciseCategoryNames,
} from "../../app/exercise-category-icons";

describe("exercise category icons", () => {
  it("provides a labelled SVG mark for every library category", () => {
    render(
      <>
        {exerciseCategoryNames.map((category) => (
          <ExerciseCategoryMark category={category} key={category} />
        ))}
      </>,
    );

    for (const category of exerciseCategoryNames) {
      const mark = screen.getByLabelText(`${category} exercise`);
      expect(mark).toHaveAttribute("title", category);
      expect(mark.querySelector("svg")).not.toBeNull();
    }
  });

  it("uses the General identity for missing category metadata", () => {
    render(<ExerciseCategoryMark />);

    expect(screen.getByLabelText("General exercise")).toBeVisible();
  });
});
