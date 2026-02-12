export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 rounded-lg animate-shimmer" />
      <div className="space-y-4">
        <div className="h-4 w-full rounded animate-shimmer" />
        <div className="h-4 w-3/4 rounded animate-shimmer" />
        <div className="h-4 w-1/2 rounded animate-shimmer" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-32 rounded-xl animate-shimmer" />
        <div className="h-32 rounded-xl animate-shimmer" />
      </div>
    </div>
  );
}
