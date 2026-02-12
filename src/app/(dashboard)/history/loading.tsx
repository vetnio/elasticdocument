export default function HistoryLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 rounded-lg animate-shimmer" />
        <div className="h-9 w-28 rounded-lg animate-shimmer" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-100">
            <div className="h-10 w-10 rounded-lg animate-shimmer shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 rounded animate-shimmer" />
              <div className="h-3 w-32 rounded animate-shimmer" />
            </div>
            <div className="h-3 w-20 rounded animate-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
