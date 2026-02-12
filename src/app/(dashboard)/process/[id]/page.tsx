"use client";

import { useEffect, useState, useRef, use } from "react";
import { useRouter } from "next/navigation";
import MarkdownRenderer from "@/components/markdown-renderer";

type ProcessingStep = "fetching" | "extracting" | "summarizing" | "done" | "error";

export default function ProcessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<ProcessingStep>("fetching");
  const [statusMessage, setStatusMessage] = useState("Starting...");
  const [errors, setErrors] = useState<string[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll to bottom as content streams in
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    function handleScroll() {
      const scrollBottom = window.innerHeight + window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      shouldAutoScroll.current = docHeight - scrollBottom < 150;
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (content && shouldAutoScroll.current && status === "summarizing") {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    }
  }, [content, status]);

  const [connectionKey, setConnectionKey] = useState(0);

  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 3;
    let retryTimeout: ReturnType<typeof setTimeout>;
    let closed = false;

    function connect() {
      if (closed) return;

      const eventSource = new EventSource(`/api/result/${id}`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        retryCount = 0; // Reset on successful message

        switch (data.type) {
          case "status":
            setStatusMessage(data.message);
            if (data.message.includes("Fetching")) setStatus("fetching");
            else if (data.message.includes("Extracting")) setStatus("extracting");
            else if (data.message.includes("Summarizing")) setStatus("summarizing");
            else if (data.message === "Complete") setStatus("done");
            break;

          case "chunk":
            setContent((prev) => prev + data.text);
            break;

          case "content":
            setContent(data.text);
            break;

          case "error":
            setErrors((prev) => [...prev, data.message]);
            break;

          case "done":
            setStatus("done");
            eventSource.close();
            break;
        }
      };

      eventSource.onerror = () => {
        eventSource.close();

        if (closed) return;

        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          retryCount++;
          setStatusMessage("Reconnecting...");
          retryTimeout = setTimeout(connect, delay);
        } else {
          setStatus("error");
          setErrors((prev) => [...prev, "Connection lost."]);
        }
      };
    }

    connect();

    return () => {
      closed = true;
      clearTimeout(retryTimeout);
      eventSourceRef.current?.close();
    };
  }, [id, connectionKey]);

  function handleRetry() {
    setStatus("fetching");
    setStatusMessage("Reconnecting...");
    setErrors([]);
    setConnectionKey((k) => k + 1);
  }

  const steps = [
    { key: "fetching", label: "Fetching", sublabel: "Loading content" },
    { key: "extracting", label: "Extracting", sublabel: "OCR processing" },
    { key: "summarizing", label: "Summarizing", sublabel: "AI restructuring" },
    { key: "done", label: "Done", sublabel: "Ready to read" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === status);
  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Processing</h2>
          {wordCount > 0 && (
            <p className="text-sm text-gray-400 mt-0.5">{wordCount.toLocaleString()} words generated</p>
          )}
        </div>
        {status === "done" && content && (
          <button
            onClick={() => router.push(`/result/${id}`)}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-sm font-medium transition-colors shadow-sm cursor-pointer"
          >
            View Result
          </button>
        )}
      </div>

      {/* Screen reader status announcement */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>

      {/* Progress Steps */}
      <div className="mb-8 bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between">
          {steps.map((step, i) => (
            <div key={step.key} className="flex items-center flex-1">
              <div className="flex flex-col items-center text-center flex-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                    i < currentStepIndex
                      ? "bg-emerald-500 text-white"
                      : i === currentStepIndex
                      ? status === "error"
                        ? "bg-red-500 text-white"
                        : "bg-brand-600 text-white ring-4 ring-brand-100"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {i < currentStepIndex ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : i === currentStepIndex && status !== "error" && status !== "done" ? (
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <p className={`text-xs font-medium mt-2 ${
                  i <= currentStepIndex ? "text-gray-900" : "text-gray-400"
                }`}>
                  {step.label}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5 hidden sm:block">{step.sublabel}</p>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-0.5 flex-1 mx-2 rounded-full transition-colors ${
                  i < currentStepIndex ? "bg-emerald-500" : "bg-gray-200"
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="mb-6 space-y-2">
          {errors.map((err, i) => (
            <div key={i} className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 animate-slide-down">
              <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-sm text-red-700">{err}</p>
            </div>
          ))}
          {status === "error" && (
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-sm font-medium transition-colors shadow-sm cursor-pointer"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {/* Streaming Content */}
      {content && (
        <div
          ref={contentRef}
          className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm"
        >
          <MarkdownRenderer content={content} />
          {status !== "done" && (
            <span className="inline-block w-2 h-5 bg-brand-500 animate-pulse rounded-sm ml-0.5" />
          )}
        </div>
      )}

      {/* Loading indicator when no content yet */}
      {!content && status !== "done" && status !== "error" && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-brand-600 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">{statusMessage}</p>
            <p className="text-xs text-gray-400 mt-1">This may take a minute depending on document size</p>
          </div>
        </div>
      )}
    </div>
  );
}
