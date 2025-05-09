import Network

final class SyncManager {
    static let shared = SyncManager()
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "sync.queue")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            if path.status == .satisfied {
                self?.syncAll()
            }
        }
        monitor.start(queue: queue)
    }

    func syncAll() {
        pushLocal { [weak self] in
            self?.pullRemote()
        }
    }

    private func pushLocal(completion: @escaping () -> Void) {
        // fetch Core Data entities with needsSync = true,
        // call SupabaseManager.insertOrUpdate, then clear flag & save context,
        // then call completion()
    }

    private func pullRemote() {
        // call SupabaseManager.fetchWorkouts(since: lastSyncDate),
        // upsert into Core Data, update lastSyncDate
    }
}
