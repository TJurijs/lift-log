import { cloneElement, useId, type AriaAttributes, type ReactElement } from "react";
import "./ghost-value-cell.css";

/** Previous actuals are a description, never an input value or a fill action. */
export function GhostValueCell({ previous, children }: {
  previous?: string;
  children: ReactElement<AriaAttributes>;
}) {
  const hintId = useId();
  const hint = previous?.trim();
  const describedBy = [children.props["aria-describedby"], hintId].filter(Boolean).join(" ");
  // Keep the parent stable when history arrives after the athlete starts typing.
  return <div className={hint ? "ghost-value-cell has-previous" : "ghost-value-cell"}>
    {hint ? cloneElement(children, { "aria-describedby": describedBy }) : children}
    {hint && <span className="ghost-value-cell-hint" id={hintId} aria-hidden="true">Last: {hint}</span>}
  </div>;
}
