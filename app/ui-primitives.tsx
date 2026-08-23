import {
  BookOpen,
  CircleUserRound,
  LoaderCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, type DisplayStatus, type EntitySource } from "../lib/presentation";

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
} as const;

const statusLabels: Record<DisplayStatus, string> = {
  draft: "Draft",
  ready: "Ready",
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
  compact = false,
  className,
}: {
  source: EntitySource;
  compact?: boolean;
  className?: string;
}) {
  const metadata = sourceMetadata[source.kind];
  const Icon = metadata.icon;
  const label =
    source.kind === "coach" && source.creatorName
      ? `${metadata.label} · ${source.creatorName}`
      : metadata.label;
  const title =
    source.kind === "coach" && source.creatorName
      ? `${metadata.title}, ${source.creatorName}`
      : metadata.title;
  return (
    <span className={cn("source-tag", source.kind, compact && "compact", className)} title={title}>
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
}: {
  tabs: Array<SegmentedTab<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("segmented-control", compact && "compact", className)}
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={value === tab.value}
            className={value === tab.value ? "active" : ""}
            disabled={tab.disabled}
            onClick={() => onChange(tab.value)}
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
    <button className={className} disabled={disabled || loading} {...props}>
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
