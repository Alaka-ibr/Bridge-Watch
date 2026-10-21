import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  icon?: ReactNode;
  compact?: boolean;
  className?: string;
  testId?: string;
}

function DefaultIllustration({ size }: { size: number }) {
  return (
    <svg
      className="text-stellar-text-muted"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="6" y="10" width="36" height="28" rx="3" />
      <path d="M6 18h36" strokeLinecap="round" />
      <circle cx="12" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="17" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <path
        d="M16 30l5-5 4 4 8-8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="33" cy="21" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  icon,
  compact = false,
  className = "",
  testId,
}: EmptyStateProps) {
  const actionClasses =
    "mt-4 rounded-md border border-stellar-blue bg-stellar-blue/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stellar-blue/20 focus:outline-none focus:ring-2 focus:ring-stellar-blue";

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "px-4 py-8" : "px-6 py-12"
      } ${className}`}
      data-testid={testId ?? "empty-state"}
    >
      <div className="mb-3">
        {icon ?? <DefaultIllustration size={compact ? 40 : 56} />}
      </div>
      <p className="text-sm font-medium text-white">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-stellar-text-secondary">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className={actionClasses}>
          {actionLabel}
        </button>
      )}
      {actionLabel && !onAction && actionHref && (
        <a href={actionHref} className={actionClasses}>
          {actionLabel}
        </a>
      )}
    </div>
  );
}
