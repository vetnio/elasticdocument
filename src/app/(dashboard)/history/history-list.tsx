"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import ConfirmDialog from "@/components/confirm-dialog";
import { COMPLEXITY_LEVELS } from "@/lib/constants";
import { formatRelativeDate } from "@/lib/format-date";

interface HistoryResult {
  id: string;
  readingMinutes: number;
  complexityLevel: string;
  outputLanguage: string;
  createdAt: string;
  hasOutput: boolean;
  documents: { fileName: string; isUrl: boolean; sourceUrl: string | null }[];
}

export default function HistoryList({ results: initialResults }: { results: HistoryResult[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [results, setResults] = useState(initialResults);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortNewest, setSortNewest] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filtered = useMemo(() => {
    let list = results;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.documents.some(
          (d) =>
            d.fileName.toLowerCase().includes(q) ||
            (d.sourceUrl && d.sourceUrl.toLowerCase().includes(q))
        ) ||
        r.outputLanguage.toLowerCase().includes(q) ||
        r.complexityLevel.toLowerCase().includes(q)
      );
    }
    if (!sortNewest) {
      return [...list].reverse();
    }
    return list;
  }, [results, search, sortNewest]);

  const selectionMode = selectedIds.size > 0;
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)));
    }
  }

  async function handleDelete(id: string) {
    setConfirmDelete(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/result/${id}/delete`, { method: "DELETE" });
      if (!res.ok) {
        toast("Failed to delete", "error");
        return;
      }
      setResults((prev) => prev.filter((r) => r.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      toast("Result deleted", "success");
    } catch {
      toast("Failed to delete", "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    setConfirmBulkDelete(false);
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      const res = await fetch("/api/result/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        toast("Failed to delete selected items", "error");
        return;
      }
      const data = await res.json();
      setResults((prev) => prev.filter((r) => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      toast(`${data.deleted} result${data.deleted !== 1 ? "s" : ""} deleted`, "success");
    } catch {
      toast("Failed to delete selected items", "error");
    } finally {
      setBulkDeleting(false);
    }
  }

  function navigateToResult(result: HistoryResult) {
    router.push(`/result/${result.id}`);
  }

  if (results.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">History</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-xl mx-auto mb-4 flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm mb-1">No summarized documents yet</p>
          <p className="text-gray-400 text-xs mb-4">Your summarized documents will appear here</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-sm font-medium transition-colors shadow-sm cursor-pointer"
          >
            Summarize your first document
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">History</h2>
        <span className="text-sm text-gray-400">{results.length} result{results.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Search + Sort */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by filename, URL, or language..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm bg-white transition-shadow"
          />
        </div>
        <button
          onClick={() => setSortNewest((prev) => !prev)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
          title={sortNewest ? "Showing newest first" : "Showing oldest first"}
        >
          {sortNewest ? "Newest" : "Oldest"}
          <svg className={`w-3 h-3 inline-block ml-1 transition-transform ${sortNewest ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Bulk actions bar */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={toggleSelectAll}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
        >
          {allFilteredSelected ? "Deselect all" : "Select all"}
        </button>
        {selectionMode && (
          <button
            onClick={() => setConfirmBulkDelete(true)}
            disabled={bulkDeleting}
            className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {bulkDeleting ? "Deleting..." : `Delete selected (${selectedIds.size})`}
          </button>
        )}
        {selectionMode && (
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>

      {filtered.length === 0 && search && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500 mb-3">No results match &quot;{search}&quot;</p>
          <button
            onClick={() => setSearch("")}
            className="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors cursor-pointer"
          >
            Clear search
          </button>
        </div>
      )}

      <div className="space-y-2" role="list">
        {filtered.map((result) => {
          const complexityLabel =
            COMPLEXITY_LEVELS.find((l) => l.value === result.complexityLevel)?.label ||
            result.complexityLevel;

          const sourceNames = result.documents.map((d) =>
            d.isUrl ? d.sourceUrl || "URL" : d.fileName
          );
          const displayName = sourceNames.length > 0 ? sourceNames.join(", ") : "Untitled";
          const isSelected = selectedIds.has(result.id);

          return (
            <div
              key={result.id}
              role="listitem"
              tabIndex={0}
              onClick={() => {
                if (selectionMode) {
                  toggleSelect(result.id);
                } else {
                  navigateToResult(result);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (selectionMode) {
                    toggleSelect(result.id);
                  } else {
                    navigateToResult(result);
                  }
                }
              }}
              className={`w-full text-left bg-white border rounded-xl px-4 py-3.5 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer group ${
                isSelected ? "border-brand-300 bg-brand-50/30" : "border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleSelect(result.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer shrink-0"
                    aria-label={`Select ${displayName}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                      <span className="text-xs text-gray-400">
                        {formatRelativeDate(result.createdAt)}
                      </span>
                      <span className="text-xs text-gray-300">&middot;</span>
                      <span className="text-xs text-gray-400">{result.readingMinutes} min</span>
                      <span className="text-xs text-gray-300">&middot;</span>
                      <span className="text-xs text-gray-400">{complexityLabel}</span>
                      <span className="text-xs text-gray-300">&middot;</span>
                      <span className="text-xs text-gray-400">{result.outputLanguage}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  {result.hasOutput ? (
                    <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                      Complete
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                      Summarizing
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(result.id);
                    }}
                    disabled={deletingId === result.id}
                    className="p-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-red-50 cursor-pointer"
                    aria-label="Delete result"
                  >
                    {deletingId === result.id ? (
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete result"
        message="This will permanently delete this summarized document and its output. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.size} result${selectedIds.size !== 1 ? "s" : ""}`}
        message={`This will permanently delete ${selectedIds.size} selected result${selectedIds.size !== 1 ? "s" : ""}. This action cannot be undone.`}
        confirmLabel="Delete All"
        destructive
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
