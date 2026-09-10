import { ChevronDown, Gauge } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../../lib/presentation";
const rpeOptions = [
  { value: "5", label: "Light", detail: "5+ left" },
  { value: "6", label: "Easy", detail: "4+ left" },
  { value: "7", label: "Moderate", detail: "3 left" },
  { value: "8", label: "Hard", detail: "2 left" },
  { value: "9", label: "Very hard", detail: "1 left" },
  { value: "10", label: "Max", detail: "None left" },
] as const;

export function wholeRpe(value: string) {
  const values = value
    .split(/[–-]/)
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
  const selected = values.at(-1);
  return selected && selected >= 5 && selected <= 10 ? String(selected) : "";
}

export function rpeTone(value: string) {
  const rpe = Number(wholeRpe(value));
  if (rpe <= 6) return "easy";
  if (rpe === 7) return "moderate";
  if (rpe === 8) return "hard";
  return "very-hard";
}

export function RpeLegend() {
  return (
    <details className="rpe-legend">
      <summary><Gauge size={14} /> RPE guide</summary>
      <div>
        {rpeOptions.map((option) => (
          <span key={option.value}>
            <strong>{option.value}</strong>
            <b>{option.label}</b>
            <small>{option.detail}</small>
          </span>
        ))}
      </div>
    </details>
  );
}

export function RpeChoiceButtons({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rpe-selector" aria-label="Select session RPE">
      {rpeOptions.map((option) => (
        <button
          type="button"
          key={option.value}
          className={cn(value === option.value && "selected", `rpe-${rpeTone(option.value)}`)}
          onClick={() => onChange(option.value)}
          aria-label={`RPE ${option.value}: ${option.label}, ${option.detail}`}
          aria-pressed={value === option.value}
        >
          <strong>{option.value}</strong>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PlannedRpeSelect({
  value,
  onChange,
  disabled = false,
  ariaLabel = "Planned RPE",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="planned-rpe-select">
      <RpeSelect
        disabled={disabled}
        ariaLabel={ariaLabel}
        value={value}
        emptyLabel="No target"
        intent="planned"
        onChange={onChange}
      />
    </div>
  );
}

export function RpeSelect({
  disabled,
  value,
  onChange,
  ariaLabel = "Actual RPE",
  emptyLabel = "Not logged",
  intent = "actual",
}: {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  emptyLabel?: string;
  intent?: "actual" | "planned";
}) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const helpId = useId();
  const selectionId = useId();
  const listId = useId();
  const selected = rpeOptions.find((option) => option.value === value);
  const currentIndex = Math.max(0, rpeOptions.findIndex((option) => option.value === value) + 1);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (next: string) => {
    onChange(next);
    close();
  };

  useEffect(() => {
    if (open && !disabled) optionRefs.current[focusedIndex]?.focus();
  }, [disabled, focusedIndex, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={cn("rpe-select", open && "open")} ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}>
      <span id={selectionId} hidden>{selected ? `Selected RPE ${selected.value}: ${selected.label}, ${selected.detail}` : emptyLabel}</span>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={cn("rpe-select-trigger", value && "selected", value && `rpe-${rpeTone(value)}`)}
        aria-label={ariaLabel}
        aria-describedby={selectionId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setFocusedIndex(currentIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          setFocusedIndex(event.key === "Home" ? 0 : event.key === "End" ? rpeOptions.length : currentIndex);
          setOpen(true);
        }}
      >
        <strong>{selected?.value ?? "—"}</strong>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && !disabled && (
        <div className="rpe-select-menu">
          <p className="rpe-select-help" id={helpId}>
            <strong>RPE</strong>{" "}
            {intent === "planned"
              ? "sets the intended difficulty by how many good reps should remain."
              : "shows how hard the set felt by how many good reps you had left."}
          </p>
          <div
            id={listId}
            className="rpe-select-options"
            role="listbox"
            tabIndex={-1}
            aria-label={`${ariaLabel} options`}
            aria-describedby={helpId}
            onKeyDown={(event) => {
              let next: number | undefined;
              if (event.key === "ArrowDown") next = Math.min(rpeOptions.length, focusedIndex + 1);
              else if (event.key === "ArrowUp") next = Math.max(0, focusedIndex - 1);
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = rpeOptions.length;
              else if (/^[5-9]$/.test(event.key)) next = Number(event.key) - 4;
              if (next === undefined) return;
              event.preventDefault();
              setFocusedIndex(next);
              optionRefs.current[next]?.focus();
            }}
          >
            <button
              ref={(element) => { optionRefs.current[0] = element; }}
              type="button"
              role="option"
              tabIndex={focusedIndex === 0 ? 0 : -1}
              onFocus={() => setFocusedIndex(0)}
              aria-selected={!value}
              className={!value ? "selected" : undefined}
              onClick={() => choose("")}
            >
              <strong>—</strong>
              <span>{emptyLabel}</span>
            </button>
            {rpeOptions.map((option, index) => (
              <button
                ref={(element) => { optionRefs.current[index + 1] = element; }}
                type="button"
                role="option"
                tabIndex={focusedIndex === index + 1 ? 0 : -1}
                onFocus={() => setFocusedIndex(index + 1)}
                key={option.value}
                aria-label={`RPE ${option.value}: ${option.detail}`}
                aria-selected={value === option.value}
                className={cn(
                  value === option.value && "selected",
                  `rpe-${rpeTone(option.value)}`,
                )}
                onClick={() => choose(option.value)}
              >
                <strong>{option.value}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
