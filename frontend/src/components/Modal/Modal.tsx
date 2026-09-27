import { useEffect, useRef, useCallback, ReactNode } from "react";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl";
  closeOnBackdropClick?: boolean;
  closeOnEscapeKey?: boolean;
}

const sizeClasses: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
};

export function Modal({
  isOpen,
  onClose,
  children,
  title,
  ariaLabelledBy,
  ariaDescribedBy,
  size = "md",
  closeOnBackdropClick = true,
  closeOnEscapeKey = true,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscapeKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, closeOnEscapeKey]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!closeOnBackdropClick) return;
      if (e.target === backdropRef.current) {
        onClose();
      }
    },
    [onClose, closeOnBackdropClick]
  );

  // Handle focus trap (Tab cycles inside dialog) + restore focus on close
  useEffect(() => {
    if (!isOpen) return;

    const previousActiveElement = document.activeElement as HTMLElement;

    // Focus the modal content when it opens
    if (contentRef.current) {
      const focusableElements = contentRef.current.querySelectorAll(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"
      );
      const firstFocusableElement = focusableElements[0] as HTMLElement;
      (firstFocusableElement ?? contentRef.current)?.focus();
    }

    const handleTabTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !contentRef.current) return;
      const focusable = Array.from(
        contentRef.current.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTabTrap);
    return () => {
      document.removeEventListener("keydown", handleTabTrap);
      // Restore focus when modal closes
      previousActiveElement?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-4 py-6 flex items-center justify-center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={contentRef}
        className={`relative w-full ${sizeClasses[size]} bg-stellar-card border border-stellar-border rounded-lg shadow-xl`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : (title ?? "Dialog")}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
      >
        {title && !ariaLabelledBy ? (
          <h2 className="sr-only">{title}</h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
