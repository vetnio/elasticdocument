"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 4000;
const EXIT_ANIMATION_MS = 300;

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    // Start exit animation
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    // Remove after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = nextId++;

      setToasts((prev) => {
        const next = [...prev, { id, message, type, exiting: false }];
        // Cap at MAX_TOASTS — remove oldest (start exit on it)
        if (next.length > MAX_TOASTS) {
          const oldest = next.find((t) => !t.exiting);
          if (oldest) {
            oldest.exiting = true;
            setTimeout(() => {
              setToasts((p) => p.filter((t) => t.id !== oldest.id));
            }, EXIT_ANIMATION_MS);
          }
        }
        return next;
      });

      return id;
    },
    []
  );

  const bgColor = {
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
    error: "bg-red-50 border-red-200 text-red-800",
    info: "bg-brand-50 border-brand-100 text-brand-800",
  };

  const iconPath = {
    success: "M5 13l4 4L19 7",
    error: "M6 18L18 6M6 6l12 12",
    info: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  };

  return (
    <ToastContext value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm" role="status" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            bgColor={bgColor[t.type]}
            iconPath={iconPath[t.type]}
            onDismiss={removeToast}
            autoDismissMs={AUTO_DISMISS_MS}
          />
        ))}
      </div>
    </ToastContext>
  );
}

function ToastItem({
  toast: t,
  bgColor,
  iconPath,
  onDismiss,
  autoDismissMs,
}: {
  toast: Toast;
  bgColor: string;
  iconPath: string;
  onDismiss: (id: number) => void;
  autoDismissMs: number;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onDismiss(t.id);
    }, autoDismissMs);
  }, [t.id, onDismiss, autoDismissMs]);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startTimer]);

  const handleMouseEnter = () => {
    hoveredRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    hoveredRef.current = false;
    startTimer();
  };

  return (
    <div
      className={`${t.exiting ? "animate-fade-out" : "animate-slide-down"} flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg text-sm font-medium ${bgColor}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
      </svg>
      <span className="flex-1">{t.message}</span>
      <button
        onClick={() => onDismiss(t.id)}
        className="shrink-0 p-0.5 rounded hover:bg-black/5 transition-colors cursor-pointer"
        aria-label="Dismiss notification"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
