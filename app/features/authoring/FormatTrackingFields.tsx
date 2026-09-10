import { optionalTrackingFieldsForLoggingFormat, trackingFieldsForLoggingFormat, type LoggingFormat, type TrackingField } from "../../../lib/domain";
import { cn } from "../../../lib/presentation";
import { trackingFieldLabel } from "../exercises/exercise-library";

/** The same recording setup is used for library defaults and workout targets. */
export function RecordConfiguration({ format, value, onChange }: {
  format: LoggingFormat;
  value: TrackingField[];
  onChange: (format: LoggingFormat, fields: TrackingField[]) => void;
}) {
  const selected = format === "repetitions" && value.includes("load") ? "weighted_repetitions" : format;
  return (
    <>
      <label className="form-field full">
        <span>Record</span>
        <select value={selected} onChange={(event) => {
          const weighted = event.target.value === "weighted_repetitions";
          const nextFormat = weighted ? "repetitions" : event.target.value as LoggingFormat;
          // Preserve deliberately selected compatible extras. New exercises
          // start with no optional extras.
          const extras = value.filter((field) => field === "rpe" || field === "heartRate");
          const defaults = trackingFieldsForLoggingFormat(nextFormat);
          if (weighted || (nextFormat !== "repetitions" && value.includes("load"))) defaults.push("load");
          onChange(nextFormat, trackingFieldsForLoggingFormat(nextFormat, [...defaults, ...extras]));
        }}>
          <option value="repetitions">Reps</option>
          <option value="weighted_repetitions">Reps + weight</option>
          <option value="duration">Time</option>
          <option value="distance">{format === "distance" && !value.includes("duration") ? "Distance" : "Distance + time"}</option>
          <option value="intervals">Rounds + time</option>
          <option value="instructions">Instructions only</option>
        </select>
      </label>
      <FormatTrackingFields format={format} value={value} onChange={(fields) => onChange(format, fields)} />
    </>
  );
}

export function FormatTrackingFields({
  format,
  value,
  onChange,
}: {
  format: LoggingFormat;
  value: TrackingField[];
  onChange: (fields: TrackingField[]) => void;
}) {
  const optional = optionalTrackingFieldsForLoggingFormat(format);
  const selectedExtras = optional.filter((field) => value.includes(field)).map(trackingFieldLabel);
  if (!optional.length) {
    return (
      <div className="format-tracking-empty full">
        Show instructions without entering a result.
      </div>
    );
  }
  return (
    <details className="format-tracking-field full" key={format}>
      <summary className="text-button">Customize optional fields{selectedExtras.length > 0 && <span> · {selectedExtras.join(", ")}</span>}</summary>
      <div
        className={cn(
          "format-tracking-options",
          `tracking-${optional.length}`,
        )}
      >
        {optional.map((field) => {
          const checked = value.includes(field);
          return (
            <label
              className={cn(
                "format-tracking-option",
                checked && "selected",
              )}
              key={field}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  onChange(
                    trackingFieldsForLoggingFormat(
                      format,
                      event.target.checked
                        ? [...value, field]
                        : value.filter((candidate) => candidate !== field),
                    ),
                  )
                }
              />
              <span>{trackingFieldLabel(field)}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
