import { optionalTrackingFieldsForLoggingFormat, requiredTrackingFieldsForLoggingFormat, trackingFieldsForLoggingFormat, type LoggingFormat, type TrackingField } from "../../../lib/domain";
import { cn } from "../../../lib/presentation";
import { trackingFieldLabel } from "../exercises/exercise-library";

export function FormatTrackingFields({
  format,
  value,
  onChange,
}: {
  format: LoggingFormat;
  value: TrackingField[];
  onChange: (fields: TrackingField[]) => void;
}) {
  const required = requiredTrackingFieldsForLoggingFormat(format);
  const optional = optionalTrackingFieldsForLoggingFormat(format);
  const available = [...required, ...optional];
  if (!available.length) {
    return (
      <div className="format-tracking-empty full">
        No values to enter—show instructions only.
      </div>
    );
  }
  return (
    <fieldset className="format-tracking-field full">
      <legend>
        Track during workout <em>choose only what matters</em>
      </legend>
      <div
        className={cn(
          "format-tracking-options",
          `tracking-${available.length}`,
        )}
      >
        {available.map((field) => {
          const isRequired = required.includes(field);
          const checked = isRequired || value.includes(field);
          return (
            <label
              className={cn(
                "format-tracking-option",
                checked && "selected",
                isRequired && "required",
              )}
              key={field}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isRequired}
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
              {isRequired && <small>Required</small>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
