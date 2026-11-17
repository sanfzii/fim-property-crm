// Instant loading UI untuk seluruh halaman protected App Router.
// Server Component murni: tidak menambah JavaScript client.

export default function ProtectedLoading() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-live="polite"
      aria-label="Memuat halaman"
    >
      <span className="sr-only">Memuat halaman, mohon tunggu.</span>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="h-6 w-48 animate-pulse rounded-md bg-slate-200" />
          <div className="h-3 w-72 max-w-full animate-pulse rounded bg-slate-200" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-md bg-slate-200" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-xs"
          >
            <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-4 h-8 w-28 animate-pulse rounded-md bg-slate-200" />
            <div className="mt-3 h-3 w-36 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between gap-4 border-b border-[#E2E8F0] pb-4">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-slate-100" />
        </div>
        <div className="space-y-4 pt-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-slate-100" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
              <div className="h-7 w-20 animate-pulse rounded-md bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
