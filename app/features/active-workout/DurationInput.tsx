import { useState, type InputHTMLAttributes } from "react";
import { durationMinutesValue, durationSecondsValue } from "../../../lib/duration";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (minutes: string) => void;
  unit?: "sec" | "min";
};

export function DurationInput({ value, onChange, unit = "sec", onBlur, ...props }: Props) {
  const [draft, setDraft] = useState<{ canonical: string; text: string; unit: string } | null>(null);
  return <input {...props} inputMode="decimal"
    value={draft?.canonical === value && draft.unit === unit ? draft.text : unit === "sec" ? durationSecondsValue(value) : value}
    onChange={(event) => {
      const text = event.target.value;
      if (!/^\d*(?:[.,]\d*)?$/.test(text)) return;
      const normalized = text.replace(",", ".");
      const numeric = normalized === "." ? "" : normalized;
      const canonical = unit === "sec" ? durationMinutesValue(numeric) : numeric;
      setDraft({ canonical, text, unit });
      onChange(canonical);
    }}
    onBlur={(event) => { setDraft(null); onBlur?.(event); }}
  />;
}

export function DurationField({ value, onChange, disabled }: Pick<Props, "value" | "onChange" | "disabled">) {
  const [unit, setUnit] = useState<"sec" | "min">(() => Number(value) >= 1 ? "min" : "sec");
  return <label className="result-input duration-input">
    <span>Time <select aria-label="Time unit" value={unit} disabled={disabled} onChange={(event) => setUnit(event.target.value as "sec" | "min")}>
      <option value="sec">sec</option><option value="min">min</option>
    </select></span>
    <DurationInput aria-label={`Time in ${unit === "sec" ? "seconds" : "minutes"}`} unit={unit} value={value} onChange={onChange} disabled={disabled} placeholder="—" />
  </label>;
}
