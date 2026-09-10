import { LoaderCircle, type LucideIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { actionUi } from "./ui-semantics";

export type ObjectAction = {
  label: string;
  accessibleLabel: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  destructive?: boolean;
};

export function ObjectActionMenu({ title, primary, actions }: {
  title: string;
  primary?: ObjectAction;
  actions: ObjectAction[];
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  function close(restoreFocus = true) {
    if (!menuRef.current) return;
    menuRef.current.open = false;
    if (restoreFocus) menuRef.current.querySelector("summary")?.focus();
  }
  function escape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && menuRef.current?.open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }
  const PrimaryIcon = primary?.loading ? LoaderCircle : primary?.icon;
  const MoreIcon = actionUi.more.icon;
  return (
    <div className="program-card-actions">
      {primary && PrimaryIcon && (
        <button type="button" className="button primary small program-card-action-schedule"
          disabled={primary.disabled || primary.loading} aria-label={primary.accessibleLabel}
          aria-busy={primary.loading || undefined} onClick={primary.onClick}>
          <PrimaryIcon className={primary.loading ? "button-spinner" : undefined} size={15} />{primary.label}
        </button>
      )}
      {actions.length > 0 && (
        <details className="program-card-more" name="object-actions" ref={menuRef}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(false);
          }}>
          <summary className="button secondary small" aria-label={`More actions for ${title}`} onKeyDown={escape}>
            <MoreIcon size={16} />{actionUi.more.label}
          </summary>
          <div className="program-card-more-actions">
            {actions.map(({ label, accessibleLabel, icon: Icon, onClick, disabled, loading, destructive }) => (
              <button key={accessibleLabel} type="button" className={destructive ? "danger-text" : undefined}
                disabled={disabled || loading} aria-label={accessibleLabel} aria-busy={loading || undefined}
                onKeyDown={escape} onClick={() => { close(); onClick(); }}>
                {loading ? <LoaderCircle className="button-spinner" size={15} /> : <Icon size={15} />}{label}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
