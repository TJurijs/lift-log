import { BicepsFlexed, Dumbbell, Target } from "lucide-react";
import type { SVGProps } from "react";

export const exerciseCategoryNames = [
  "Weightlifting",
  "Strength",
  "Bodybuilding",
  "Bodyweight",
  "Functional fitness",
  "Gymnastics",
  "Cardio",
  "Conditioning",
  "Core",
  "Mobility",
  "General",
] as const;

type ExerciseCategoryIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  category?: string;
  size?: number;
};

function normalizedCategory(category?: string) {
  const normalized = category?.trim().toLowerCase();
  if (normalized === "weightlifting") return "weightlifting";
  if (normalized === "strength") return "strength";
  if (normalized === "bodybuilding") return "bodybuilding";
  if (normalized === "bodyweight") return "bodyweight";
  if (normalized === "functional fitness") return "functional";
  if (normalized === "gymnastics") return "gymnastics";
  if (normalized === "cardio") return "cardio";
  if (normalized === "conditioning") return "conditioning";
  if (normalized === "core") return "core";
  if (normalized === "mobility") return "mobility";
  return "general";
}

function CategoryGlyph({ category }: { category?: string }) {
  switch (normalizedCategory(category)) {
    case "weightlifting":
      return (
        <>
          <path d="M4 7v10M7 8.5v7M17 8.5v7M20 7v10M7 12h10" />
          <path d="M2.5 9.5v5M21.5 9.5v5" />
        </>
      );
    case "bodyweight":
      return (
        <>
          <circle cx="12" cy="5" r="2" />
          <path d="m7 10 5-2 5 2M12 8v6M12 14l-4 6M12 14l4 6" />
        </>
      );
    case "functional":
      return (
        <>
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
          <path d="M8 8h8c1.9 1.5 3 3.7 3 6a7 7 0 0 1-14 0c0-2.3 1.1-4.5 3-6Z" />
          <path d="M9 14h6" />
        </>
      );
    case "gymnastics":
      return (
        <>
          <circle cx="12" cy="17" r="1.7" />
          <path d="M12 15v-5M12 10 8 3M12 10l4-7M12 15l-5 6M12 15l5 6" />
        </>
      );
    case "cardio":
      return (
        <>
          <path d="M20.8 5.8a5.1 5.1 0 0 0-7.2 0L12 7.4l-1.6-1.6a5.1 5.1 0 0 0-7.2 7.2L12 21l8.8-8a5.1 5.1 0 0 0 0-7.2Z" />
          <path d="M3.8 13h4l1.5-3 2.5 6 1.7-3h6.7" />
        </>
      );
    case "conditioning":
      return (
        <>
          <circle cx="12" cy="13" r="7.5" />
          <path d="M9 3h6M12 5.5V3M17.3 7.7 19 6M12 9v4l2.5 1.5" />
        </>
      );
    case "mobility":
      return (
        <>
          <path d="M5 9a7 7 0 0 1 12-3l1-3 2 5-5 1" />
          <path d="M19 15a7 7 0 0 1-12 3l-1 3-2-5 5-1" />
          <circle cx="12" cy="12" r="2" />
        </>
      );
    default:
      return (
        <>
          <circle cx="7" cy="7" r="3" />
          <path d="M14 4h6v6h-6zM4 14h6v6H4zM17 14l3.5 6h-7l3.5-6Z" />
        </>
      );
  }
}

export function ExerciseCategoryIcon({
  category,
  size = 18,
  ...props
}: ExerciseCategoryIconProps) {
  const normalized = normalizedCategory(category);
  if (normalized === "bodybuilding") {
    return (
      <BicepsFlexed
        aria-hidden="true"
        size={size}
        strokeWidth={1.7}
        {...props}
      />
    );
  }
  if (normalized === "strength") {
    return (
      <Dumbbell
        aria-hidden="true"
        size={size}
        strokeWidth={1.7}
        {...props}
      />
    );
  }
  if (normalized === "core") {
    return (
      <Target
        aria-hidden="true"
        size={size}
        strokeWidth={1.7}
        {...props}
      />
    );
  }
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <CategoryGlyph category={category} />
    </svg>
  );
}

export function ExerciseCategoryMark({
  category,
  compact = false,
}: {
  category?: string;
  compact?: boolean;
}) {
  const label = category?.trim() || "General";
  return (
    <span
      aria-label={`${label} exercise`}
      className={`exercise-category-icon${compact ? " compact" : ""}`}
      title={label}
    >
      <ExerciseCategoryIcon category={category} size={compact ? 14 : 17} />
    </span>
  );
}
