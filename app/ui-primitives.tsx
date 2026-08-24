import {
  BookOpen,
  CircleHelp,
  CircleUserRound,
  Info,
  LoaderCircle,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { cn, type DisplayStatus, type EntitySource } from "../lib/presentation";
import type { ProvenancePresentation } from "../lib/provenance";
import type { SessionDraftSaveStatus } from "../lib/session-draft-coordinator";

const sourceMetadata = {
  library: {
    label: "Library",
    title: "Lift Log library",
    icon: BookOpen,
  },
  self: {
    label: "Own",
    title: "Created by you",
    icon: CircleUserRound,
  },
  coach: {
    label: "Coach",
    title: "Created by your coach",
    icon: Users,
  },
  unknown: {
    label: "Source unavailable",
    title: "Content provenance is unavailable",
    icon: CircleHelp,
  },
} as const;

const statusLabels: Record<DisplayStatus, string> = {
  draft: "Draft",
  ready: "Final",
  in_schedule: "In schedule",
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
  pending: "Pending",
  connected: "Connected",
};

export function SourceTag({
  source,
  presentation,
  compact = false,
  className,
}: {
  source?: EntitySource;
  presentation?: ProvenancePresentation;
  compact?: boolean;
  className?: string;
}) {
  const sourceKind =
    presentation?.tone === "neutral"
      ? "unknown"
      : presentation?.tone ?? source?.kind ?? "unknown";
  const metadata = sourceMetadata[sourceKind];
  const Icon = metadata.icon;
  const label = presentation?.label ??
    (sourceKind === "coach" && source?.creatorName
      ? `${metadata.label} · ${source.creatorName}`
      : metadata.label);
  const title = presentation?.title ??
    (sourceKind === "coach" && source?.creatorName
      ? `${metadata.title}, ${source.creatorName}`
      : metadata.title);
  return (
    <span className={cn("source-tag", sourceKind, compact && "compact", className)} title={title}>
      <Icon size={compact ? 10 : 12} />
      {label}
    </span>
  );
}

export function StatusBadge({
  status,
  label,
  compact = false,
  className,
}: {
  status: DisplayStatus;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("status-badge", status, compact && "compact", className)}>
      <i aria-hidden="true" />
      {label ?? statusLabels[status]}
    </span>
  );
}

export function WorkoutSectionHeading({
  title,
  itemCount,
  className,
}: {
  title: string;
  itemCount: number;
  className?: string;
}) {
  return (
    <div className={cn("section-heading", className)}>
      <span>{title}</span>
      <small>{itemCount === 1 ? "1 item" : `${itemCount} items`}</small>
    </div>
  );
}

export function PersonAvatar({
  initials,
  name,
  size = "default",
}: {
  initials: string;
  name?: string;
  size?: "default" | "large";
}) {
  return (
    <span className={cn("avatar", size === "large" && "large")} aria-label={name} title={name}>
      {initials}
    </span>
  );
}

export type SegmentedTab<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
  badge?: number;
};

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  compact = false,
  className,
  panelId,
  selectionMode = "tabs",
}: {
  tabs: Array<SegmentedTab<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
  className?: string;
  panelId?: string;
  selectionMode?: "tabs" | "buttons";
}) {
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());

  function moveFocus(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentValue: T,
  ) {
    const enabledTabs = tabs.filter((tab) => !tab.disabled);
    const currentIndex = enabledTabs.findIndex((tab) => tab.value === currentValue);
    if (currentIndex < 0) return;

    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % enabledTabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + enabledTabs.length) % enabledTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabledTabs.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = enabledTabs[nextIndex];
    onChange(nextTab.value);
    tabRefs.current.get(nextTab.value)?.focus();
  }

  return (
    <div
      className={cn("segmented-control", compact && "compact", className)}
      role={selectionMode === "tabs" ? "tablist" : "group"}
      aria-label={label}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            type="button"
            role={selectionMode === "tabs" ? "tab" : undefined}
            aria-selected={
              selectionMode === "tabs" ? value === tab.value : undefined
            }
            aria-pressed={
              selectionMode === "buttons" ? value === tab.value : undefined
            }
            aria-controls={selectionMode === "tabs" ? panelId : undefined}
            className={value === tab.value ? "active" : ""}
            disabled={tab.disabled}
            id={
              selectionMode === "tabs" && panelId
                ? `${panelId}-${tab.value}-tab`
                : undefined
            }
            ref={(node) => {
              if (node) tabRefs.current.set(tab.value, node);
              else tabRefs.current.delete(tab.value);
            }}
            tabIndex={
              selectionMode === "tabs"
                ? value === tab.value
                  ? 0
                  : -1
                : undefined
            }
            onClick={() => onChange(tab.value)}
            onKeyDown={
              selectionMode === "tabs"
                ? (event) => moveFocus(event, tab.value)
                : undefined
            }
          >
            {Icon && <Icon size={15} />}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="request-count-badge" aria-label={`${tab.badge} pending`}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AsyncButton({
  loading = false,
  loadingLabel,
  icon: Icon,
  children,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <button
      className={className}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <LoaderCircle className="button-spinner" size={15} />
          {loadingLabel ?? children}
        </>
      ) : (
        <>
          {Icon && <Icon size={15} />}
          {children}
        </>
      )}
    </button>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">
      <Info size={16} aria-hidden="true" />
      {message}
    </div>
  );
}

export function SessionSaveIndicator({
  status,
  online,
}: {
  status: SessionDraftSaveStatus;
  online: boolean;
}) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "unsaved-offline"
        ? "Unsaved — reconnect to save"
        : status === "error"
          ? "Unsaved — retry to save"
          : online
            ? "Saved"
            : "Saved · reconnect to finish";
  return (
    <p
      className={cn("session-save-status", status)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {label}
    </p>
  );
}

export function InlineError({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("auth-error", className)} role="alert">
      {children}
    </p>
  );
}

export function ModalShell({
  title,
  description,
  onClose,
  dismissible = true,
  wide = false,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  dismissible?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const initialFocus =
      dialog?.querySelector<HTMLElement>("[data-modal-initial-focus]") ??
      dialog?.querySelector<HTMLElement>(
        "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
      ) ??
      dialog;
    initialFocus?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      ];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [dismissible, onClose]);

  return (
    <div className="modal-backdrop">
      <button
        className="modal-dismiss-layer"
        tabIndex={-1}
        onClick={dismissible ? onClose : undefined}
        disabled={!dismissible}
        aria-label="Close dialog"
      />
      <section
        ref={dialogRef}
        className={cn("modal", wide && "wide")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={!dismissible || undefined}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Lift Log</p>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
