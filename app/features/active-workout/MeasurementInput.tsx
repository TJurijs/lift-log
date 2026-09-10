import { useState, type InputHTMLAttributes } from "react";
import type { OwnProfile } from "../../../lib/domain";
import {
  distanceInputValue,
  distanceKilometresValue,
  weightInputValue,
  weightKgValue,
} from "../../../lib/units";

type Measurement =
  | { quantity: "weight"; unit: OwnProfile["weightUnit"] }
  | { quantity: "distance"; unit: OwnProfile["distanceUnit"] };

type Props = Measurement & Omit<
  InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"
> & {
  value: string;
  onChange: (canonicalValue: string) => void;
};

/**
 * Keep the user's decimal separator and trailing zeroes while editing. Each
 * valid value still reaches autosave immediately, in kg or km. Normalizing the
 * controlled input on every keypress would turn, for example, 72.5 into 725.
 */
export function MeasurementInput({ quantity, unit, value, onChange, onBlur, ...inputProps }: Props) {
  const [draft, setDraft] = useState<{ value: string; text: string; unit: string } | null>(null);
  const displayed = quantity === "weight"
    ? weightInputValue(value, unit as OwnProfile["weightUnit"])
    : distanceInputValue(value, unit as OwnProfile["distanceUnit"]);

  return <input
    {...inputProps}
    inputMode="decimal"
    value={draft?.value === value && draft.unit === unit ? draft.text : displayed}
    onChange={(event) => {
      const text = event.target.value;
      // Both decimal keyboards are supported; reject input that cannot be saved
      // as a nonnegative measurement instead of silently saving it as null.
      if (!/^\d*(?:[.,]\d*)?$/.test(text)) return;
      const normalized = text.replace(",", ".");
      const numeric = normalized === "." ? "" : normalized;
      const canonical = quantity === "weight"
        ? weightKgValue(numeric, unit as OwnProfile["weightUnit"])
        : distanceKilometresValue(numeric, unit as OwnProfile["distanceUnit"]);
      setDraft({ value: canonical, text, unit });
      onChange(canonical);
    }}
    onBlur={(event) => {
      setDraft(null);
      onBlur?.(event);
    }}
  />;
}
