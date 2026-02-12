"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { COMPLEXITY_LEVELS, LANGUAGES, MAX_FILE_SIZE, MAX_FILES } from "@/lib/constants";

const ACCEPTED_TYPES = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.rtf,.csv,.png,.jpg,.jpeg,.gif,.bmp,.tiff,.webp,.svg,.html,.htm";

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([""]);
  const [readingMinutes, setReadingMinutes] = useState(5);
  const [complexity, setComplexity] = useState("simple");
  const [language, setLanguage] = useState("English");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  // Fetch daily usage on mount
  useEffect(() => {
    fetch("/api/usage")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setUsage(data); })
      .catch(() => {});
  }, []);

  // Warn before leaving with unsaved work
  const hasUnsavedWork = files.length > 0 || urls.some((u) => u.trim() !== "");
  useEffect(() => {
    if (!hasUnsavedWork) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedWork]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of fileArray) {
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name} exceeds 50MB limit`);
        continue;
      }
      if (file.size === 0) {
        errors.push(`${file.name} is empty`);
        continue;
      }
      validFiles.push(file);
    }

    if (files.length + validFiles.length > MAX_FILES) {
      errors.push(`Maximum ${MAX_FILES} files allowed`);
      validFiles.splice(MAX_FILES - files.length);
    }

    if (errors.length > 0) {
      toast(errors.join(". "), "error");
    }

    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles]);
    }
  }, [files.length, toast]);

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function addUrlField() {
    setUrls((prev) => [...prev, ""]);
  }

  function updateUrl(index: number, value: string) {
    setUrls((prev) => prev.map((u, i) => (i === index ? value : u)));
  }

  function removeUrl(index: number) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validUrls = urls.filter((u) => u.trim() !== "");
    if (files.length === 0 && validUrls.length === 0) {
      setError("Please upload at least one file or enter a URL");
      return;
    }

    if (readingMinutes < 1) {
      setError("Reading time must be at least 1 minute");
      return;
    }

    setLoading(true);

    try {
      // Upload files to blob storage
      const uploadedFiles: { fileName: string; blobUrl: string; fileType: string; fileSize: number }[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);

        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }

        const data = await res.json();
        uploadedFiles.push({
          fileName: file.name,
          blobUrl: data.url,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
        });
      }

      setUploadProgress(null);

      // Start processing
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: uploadedFiles,
          urls: validUrls,
          readingMinutes,
          complexity,
          language,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start processing");
      }

      const data = await res.json();
      router.push(`/process/${data.resultId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setUploadProgress(null);
      setLoading(false);
    }
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(name: string) {
    const ext = name.split(".").pop()?.toLowerCase();
    if (["pdf"].includes(ext || "")) return "text-red-500";
    if (["doc", "docx"].includes(ext || "")) return "text-blue-500";
    if (["xls", "xlsx", "csv"].includes(ext || "")) return "text-emerald-500";
    if (["ppt", "pptx"].includes(ext || "")) return "text-orange-500";
    if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "tiff"].includes(ext || "")) return "text-purple-500";
    return "text-gray-500";
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">New Document</h2>
        <p className="text-sm text-gray-500 mt-1">Upload documents or paste URLs to compress them to your reading time.</p>
        {usage && (
          <div className={`mt-2 inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full ${
            usage.used >= usage.limit
              ? "bg-red-50 text-red-700"
              : usage.used >= usage.limit * 0.8
              ? "bg-amber-50 text-amber-700"
              : "bg-gray-100 text-gray-500"
          }`}>
            <span>{usage.used} of {usage.limit} used today</span>
            {usage.used >= usage.limit && (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File Upload Area */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload Documents
          </label>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              dragOver
                ? "border-brand-500 bg-brand-50 scale-[1.01]"
                : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex flex-col items-center gap-2">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                dragOver ? "bg-brand-100" : "bg-gray-100"
              }`}>
                <svg className={`w-5 h-5 transition-colors ${dragOver ? "text-brand-600" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-brand-600">Click to browse</span> or drag and drop
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  PDF, Word, Excel, PowerPoint, images, and more &middot; Max {MAX_FILES} files, {MAX_FILE_SIZE / (1024 * 1024)}MB each
                </p>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((file, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:border-gray-300 transition-colors group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <svg className={`w-4 h-4 shrink-0 ${getFileIcon(file.name)}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <span className="text-sm text-gray-700 truncate">{file.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{formatFileSize(file.size)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-gray-300 hover:text-red-500 ml-2 shrink-0 transition-colors group-hover:text-gray-400 cursor-pointer"
                    aria-label={`Remove ${file.name}`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* URL Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Website URLs
          </label>
          <div className="space-y-2">
            {urls.map((url, i) => (
              <div key={i} className="flex gap-2">
                <div className="flex-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.121a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.57" />
                    </svg>
                  </div>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => updateUrl(i, e.target.value)}
                    placeholder="https://example.com/article"
                    className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm transition-shadow"
                  />
                </div>
                {urls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeUrl(i)}
                    className="px-2.5 text-gray-300 hover:text-red-500 transition-colors cursor-pointer"
                    aria-label="Remove URL"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addUrlField}
            className="mt-2 text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors cursor-pointer"
          >
            + Add another URL
          </button>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200" />

        {/* Settings */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Output Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="readingMinutes" className="block text-xs font-medium text-gray-500 mb-1.5">
                Reading Time (minutes)
              </label>
              <input
                id="readingMinutes"
                type="number"
                min={1}
                max={120}
                value={readingMinutes}
                onChange={(e) => setReadingMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm transition-shadow"
              />
            </div>

            <div>
              <label htmlFor="complexity" className="block text-xs font-medium text-gray-500 mb-1.5">
                Complexity
              </label>
              <select
                id="complexity"
                value={complexity}
                onChange={(e) => setComplexity(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm bg-white transition-shadow"
              >
                {COMPLEXITY_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="language" className="block text-xs font-medium text-gray-500 mb-1.5">
                Output Language
              </label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm bg-white transition-shadow"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 animate-slide-down">
            <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors shadow-sm cursor-pointer"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {uploadProgress || "Processing..."}
            </span>
          ) : (
            "Process Documents"
          )}
        </button>
      </form>
    </div>
  );
}
