"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import MarkdownRenderer from "@/components/markdown-renderer";
import RsvpReader from "@/components/rsvp-reader";
import { useToast } from "@/components/toast";
import { COMPLEXITY_LEVELS, LANGUAGES } from "@/lib/constants";
import { formatRelativeDate } from "@/lib/format-date";

interface ResultViewProps {
  result: {
    id: string;
    outputContent: string;
    outputBreadtext: string;
    markdownContent: string;
    extractedImages: string[];
    readingMinutes: number;
    complexityLevel: string;
    outputLanguage: string;
    createdAt: string;
    documents: { fileName: string; isUrl: boolean; sourceUrl: string | null }[];
  };
}

export default function ResultView({ result }: ResultViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [showRsvp, setShowRsvp] = useState(false);
  const [activeTab, setActiveTab] = useState<"formatted" | "breadtext">("formatted");
  const [showReprocess, setShowReprocess] = useState(false);
  const [showExtraction, setShowExtraction] = useState(false);
  const [newMinutes, setNewMinutes] = useState(result.readingMinutes);
  const [newComplexity, setNewComplexity] = useState(result.complexityLevel);
  const [newLanguage, setNewLanguage] = useState(result.outputLanguage);
  const [reprocessing, setReprocessing] = useState(false);

  // Close reprocess panel on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && showReprocess) {
      setShowReprocess(false);
    }
  }, [showReprocess]);

  useEffect(() => {
    if (showReprocess) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [showReprocess, handleKeyDown]);

  const complexityLabel =
    COMPLEXITY_LEVELS.find((l) => l.value === result.complexityLevel)?.label ||
    result.complexityLevel;

  async function handleReprocess() {
    setReprocessing(true);
    try {
      const res = await fetch("/api/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalResultId: result.id,
          readingMinutes: newMinutes,
          complexity: newComplexity,
          language: newLanguage,
        }),
      });

      if (!res.ok) {
        let msg = "Failed to reprocess";
        try { const data = await res.json(); msg = data.error || msg; } catch {}
        toast(msg, "error");
        setReprocessing(false);
        return;
      }

      const data = await res.json();
      router.push(`/process/${data.resultId}`);
    } catch {
      toast("Something went wrong", "error");
      setReprocessing(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(result.outputContent);
      toast("Copied to clipboard", "success");
    } catch {
      toast("Failed to copy", "error");
    }
  }

  function handlePrint() {
    window.print();
  }

  function handleDownload() {
    const blob = new Blob([result.outputContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const docName = result.documents[0]?.fileName?.replace(/\.[^.]+$/, "") || "document";
    a.download = `${docName}-summary.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const wordCount = result.outputContent.split(/\s+/).filter(Boolean).length;
  const estimatedReadTime = Math.max(1, Math.round(wordCount / 230));

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Result</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className="text-sm text-gray-500">
              {formatRelativeDate(result.createdAt)}
            </span>
            <span className="text-sm text-gray-300">|</span>
            <span className="text-sm text-gray-500">~{estimatedReadTime} min read</span>
            <span className="text-sm text-gray-300">|</span>
            <span className="text-sm text-gray-500">{wordCount.toLocaleString()} words</span>
            <span className="text-sm text-gray-300">|</span>
            <span className="text-sm text-gray-500">{complexityLabel}</span>
            <span className="text-sm text-gray-300">|</span>
            <span className="text-sm text-gray-500">{result.outputLanguage}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 no-print">
          <button
            onClick={handleCopy}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            title="Copy to clipboard"
            aria-label="Copy to clipboard"
          >
            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
          </button>
          <button
            onClick={handlePrint}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            title="Print"
            aria-label="Print"
          >
            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
            </svg>
          </button>
          <button
            onClick={handleDownload}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            title="Download as Markdown"
            aria-label="Download as Markdown"
          >
            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </button>
          <button
            onClick={() => setShowReprocess(!showReprocess)}
            className="px-3.5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-sm font-medium transition-colors shadow-sm cursor-pointer"
          >
            Reprocess
          </button>
        </div>
      </div>

      {/* Reprocess panel */}
      {showReprocess && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 animate-slide-down no-print">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Reprocess with different settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reading Time (min)</label>
              <input
                type="number"
                min={1}
                max={120}
                value={newMinutes}
                onChange={(e) => setNewMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-shadow"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Complexity</label>
              <select
                value={newComplexity}
                onChange={(e) => setNewComplexity(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 transition-shadow"
              >
                {COMPLEXITY_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>{level.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Language</label>
              <select
                value={newLanguage}
                onChange={(e) => setNewLanguage(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 transition-shadow"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handleReprocess}
            disabled={reprocessing}
            className="mt-4 px-4 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors shadow-sm cursor-pointer"
          >
            {reprocessing ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Starting...
              </span>
            ) : (
              "Reprocess"
            )}
          </button>
        </div>
      )}

      {/* Source documents */}
      {result.documents.length > 0 && (
        <div className="mb-6 no-print">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Sources</h3>
          <div className="flex flex-wrap gap-2">
            {result.documents.map((doc, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-600"
              >
                <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  {doc.isUrl ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25" />
                  )}
                </svg>
                <span className="truncate max-w-[200px]">{doc.isUrl ? doc.sourceUrl : doc.fileName}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Extraction Details (collapsible) */}
      {result.markdownContent && (
        <div className="mb-6 no-print">
          <button
            onClick={() => setShowExtraction(!showExtraction)}
            className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors cursor-pointer"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showExtraction ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Extraction Details
          </button>
          {showExtraction && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl p-5 animate-slide-down space-y-4">
              {result.extractedImages.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Extracted Images ({result.extractedImages.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {result.extractedImages.map((img, i) => (
                      <a key={i} href={img} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img}
                          alt={`Extracted image ${i + 1}`}
                          className="h-20 w-auto rounded-lg border border-gray-200 hover:border-brand-300 transition-colors"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Raw Extracted Markdown
                </h4>
                <pre className="bg-white border border-gray-200 rounded-lg p-4 text-xs text-gray-700 font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
                  {result.markdownContent}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Speed Read CTA */}
      <button
        onClick={() => setShowRsvp(true)}
        className="w-full mb-6 px-6 py-3.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 active:scale-[0.99] text-sm font-semibold transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2.5 no-print"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
        </svg>
        Start Speed Reading
      </button>

      {/* Tabs + Content */}
      {result.outputBreadtext ? (
        <div>
          <div className="flex gap-1 mb-4 no-print">
            <button
              onClick={() => setActiveTab("formatted")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === "formatted"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              Formatted
            </button>
            <button
              onClick={() => setActiveTab("breadtext")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === "breadtext"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              Breadtext
            </button>
          </div>

          {activeTab === "formatted" ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm print-content">
              <MarkdownRenderer content={result.outputContent} />
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm print-content">
              <div className="prose prose-gray max-w-none text-base leading-relaxed whitespace-pre-line">
                {result.outputBreadtext}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm print-content">
          <MarkdownRenderer content={result.outputContent} />
        </div>
      )}

      {showRsvp && (
        <RsvpReader
          content={activeTab === "breadtext" && result.outputBreadtext ? result.outputBreadtext : result.outputContent}
          onClose={() => setShowRsvp(false)}
        />
      )}
    </div>
  );
}
