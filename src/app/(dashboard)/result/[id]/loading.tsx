export default function ResultLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg animate-shimmer" />
        <div className="h-7 w-56 rounded-lg animate-shimmer" />
      </div>
      <div className="flex gap-3">
        <div className="h-6 w-20 rounded-full animate-shimmer" />
        <div className="h-6 w-24 rounded-full animate-shimmer" />
        <div className="h-6 w-16 rounded-full animate-shimmer" />
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div className="h-6 w-3/4 rounded animate-shimmer" />
        <div className="h-4 w-full rounded animate-shimmer" />
        <div className="h-4 w-full rounded animate-shimmer" />
        <div className="h-4 w-5/6 rounded animate-shimmer" />
        <div className="h-4 w-full rounded animate-shimmer" />
        <div className="h-4 w-2/3 rounded animate-shimmer" />
      </div>
    </div>
  );
}
