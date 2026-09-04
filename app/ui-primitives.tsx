import {
  BookOpen,
  ChevronLeft,
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
  useEffectEvent,
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
  editable: "Editable",
  locked: "Locked",
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

export function PageHeader({
  eyebrow,
  title,
  titleAction,
  description,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  titleAction?: ReactNode;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <div className="page-title-row">
          {typeof title === "string" ? <h1>{title}</h1> : title}
          {titleAction}
        </div>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function DetailNavigation({
  backLabel,
  title,
  onBack,
  action,
}: {
  backLabel: string;
  title: string;
  onBack: () => void;
  action?: ReactNode;
}) {
  return (
    <nav className="detail-navigation" aria-label={`${title} navigation`}>
      <button
        type="button"
        className="detail-navigation-back"
        onClick={onBack}
        aria-label={`Back to ${backLabel}`}
      >
        <ChevronLeft size={25} strokeWidth={2.15} />
        <span>{backLabel}</span>
      </button>
      <strong title={title}>{title}</strong>
      <div className="detail-navigation-action">{action}</div>
    </nav>
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
      type="button"
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
  localRecoveryAvailable = true,
}: {
  status: SessionDraftSaveStatus;
  online: boolean;
  localRecoveryAvailable?: boolean;
}) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "unsaved-offline"
        ? localRecoveryAvailable
          ? "Saved on this device · reconnect to sync"
          : "Not saved yet · keep this page open and reconnect"
        : status === "error"
          ? localRecoveryAvailable
            ? "Saved on this device · sync needs attention"
            : "Sync needs attention · keep this page open"
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

const openModalDialogs = new Set<HTMLElement>();
let overflowBeforeModals = "";

export function ModalShell({
  title,
  description,
  onClose,
  dismissible = true,
  wide = false,
  className,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  dismissible?: boolean;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dismissOnEscape = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (!dismissible) return;
    event.preventDefault();
    onClose();
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!openModalDialogs.size) overflowBeforeModals = document.body.style.overflow;
    openModalDialogs.add(dialog);
    document.body.style.overflow = "hidden";
    const focusableElements = () => {
      return [...dialog.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, summary, [tabindex]",
      )].filter((element) => {
        if (
          element.tabIndex < 0 ||
          element.matches(":disabled, input[type='hidden']") ||
          element.closest("[hidden], [inert]") ||
          getComputedStyle(element).visibility === "hidden"
        ) return false;
        for (let ancestor: HTMLElement | null = element; ancestor && ancestor !== dialog; ancestor = ancestor.parentElement) {
          if (getComputedStyle(ancestor).display === "none") return false;
        }
        return true;
      });
    };
    const initialCandidates = focusableElements();
    const initialFocus =
      initialCandidates.find((element) => element.hasAttribute("data-modal-initial-focus")) ??
      initialCandidates.find((element) => element.matches("input, select, textarea")) ??
      dialog;
    initialFocus?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const dialogs = document.querySelectorAll("[aria-modal='true']");
      if (dialogs.item(dialogs.length - 1) !== dialog) return;
      if (event.key === "Escape") {
        dismissOnEscape(event);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      const focusInside = focusable.includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (!focusInside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusInside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      openModalDialogs.delete(dialog);
      if (!openModalDialogs.size) document.body.style.overflow = overflowBeforeModals;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <button
        type="button"
        className="modal-dismiss-layer"
        tabIndex={-1}
        onClick={dismissible ? onClose : undefined}
        disabled={!dismissible}
        aria-label="Close dialog"
      />
      <section
        ref={dialogRef}
        className={cn("modal", wide && "wide", className)}
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
            type="button"
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
