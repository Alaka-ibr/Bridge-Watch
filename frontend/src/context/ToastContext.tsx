import {
  useCallback,
  useId,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { ToastContext, ToastVariant, ToastItem } from "./ToastContextValue";

function ToastViewport({
  toasts,
  onDismiss,
  titleId,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  titleId: string;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-relevant="additions text"
    >
      <span id={titleId} className="sr-only">
        Notifications
      </span>
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.variant === "error" ? "alert" : "status"}
          aria-live={t.variant === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          aria-labelledby={titleId}
          className={`pointer-events-auto rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm ${
            t.variant === "error"
              ? "border-red-500/40 bg-red-950/90 text-red-100"
              : t.variant === "success"
                ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
                : "border-stellar-border bg-stellar-card/95 text-stellar-text-primary"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-current opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-stellar-blue"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const titleId = useId();
  const timersRef = useRef<Record<string, number>>({});

  const remove = useCallback((id: string) => {
    if (timersRef.current[id]) {
      window.clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, variant = "info" }: { message: string; variant?: ToastVariant }) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, message, variant }]);
      timersRef.current[id] = window.setTimeout(() => remove(id), 6000);
    },
    [remove]
  );

  const showError = useCallback(
    (message: string) => showToast({ message, variant: "error" }),
    [showToast]
  );

  const showSuccess = useCallback(
    (message: string) => showToast({ message, variant: "success" }),
    [showToast]
  );

  const value = useMemo(
    () => ({ showToast, showError, showSuccess }),
    [showToast, showError, showSuccess]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={remove} titleId={titleId} />
    </ToastContext.Provider>
  );
}


