export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-40 bg-panel rounded-lg" />
          <div className="h-4 w-56 bg-panel rounded-lg mt-2" />
        </div>
        <div className="h-10 w-28 bg-panel rounded-xl" />
      </div>

      <div className="space-y-3">
        {['card-1', 'card-2', 'card-3', 'card-4'].map((id) => (
          <div key={id} className="bg-card border border-line rounded-2xl p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="space-y-2">
                <div className="h-5 w-36 bg-panel rounded-lg" />
                <div className="h-4 w-24 bg-panel rounded-lg" />
              </div>
            </div>
            <div className="flex gap-4">
              <div className="h-14 w-20 bg-panel rounded-xl" />
              <div className="h-14 w-20 bg-panel rounded-xl" />
              <div className="h-14 w-20 bg-panel rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
