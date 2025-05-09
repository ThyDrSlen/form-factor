import Foundation
import Supabase

final class SupabaseManager {
    static let shared = SupabaseManager()
    let client: SupabaseClient

    private init() {
        guard let urlString = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
              let anonKey = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String,
              let url = URL(string: urlString) else {
            fatalError("Supabase configuration missing in Info.plist")
        }
        client = SupabaseClient(supabaseURL: url, supabaseKey: anonKey)
    }

    // MARK: - Data Transfer Objects
    internal struct WorkoutRecord: Codable {
        let id: UUID
        let exercise: String
        let sets: Int
        let reps: Int?
        let weight: Int?
        let duration: Int?
        let created_at: Date
    }

    internal struct FoodEntryRecord: Codable {
        let id: UUID
        let name: String
        let date: Date
        let calories: Double
        let protein: Double?
        let carbs: Double?
        let fat: Double?
        let created_at: Date
    }

    // MARK: - Workout CRUD
    func upsertWorkout(_ workout: Workout) async throws {
        let record = WorkoutRecord(
            id: workout.id,
            exercise: workout.exercise,
            sets: workout.sets,
            reps: workout.reps,
            weight: workout.weight,
            duration: workout.duration,
            created_at: workout.createdAt
        )
        _ = try await client
            .from("workouts")
            .upsert(record, onConflict: "id")
            .execute()
    }

    func fetchWorkouts(since date: Date? = nil) async throws -> [Workout] {
        let records: [WorkoutRecord] = try await client
            .from("workouts")
            .select()
            .order("created_at", ascending: false)
            .execute()
            .value

        var workouts = records.map { rec in
            let w = Workout(
                exercise: rec.exercise,
                sets: rec.sets,
                reps: rec.reps,
                weight: rec.weight,
                duration: rec.duration
            )
            w.id = rec.id
            w.createdAt = rec.created_at
            return w
        }
        if let sinceDate = date {
            workouts = workouts.filter { $0.createdAt >= sinceDate }
        }
        return workouts
    }

    func deleteWorkout(id: UUID) async throws {
        _ = try await client
            .from("workouts")
            .delete()
            .eq("id", value: id.uuidString)
            .execute()
    }

    // MARK: - FoodEntry CRUD
    func upsertFoodEntry(_ entry: FoodEntry) async throws {
        let record = FoodEntryRecord(
            id: entry.id,
            name: entry.name,
            date: entry.date,
            calories: entry.calories,
            protein: entry.protein,
            carbs: entry.carbs,
            fat: entry.fat,
            created_at: entry.date
        )
        _ = try await client
            .from("food_entries")
            .upsert(record, onConflict: "id")
            .execute()
    }

    func fetchFoodEntries(since date: Date? = nil) async throws -> [FoodEntry] {
        let records: [FoodEntryRecord] = try await client
            .from("food_entries")
            .select()
            .order("date", ascending: false)
            .execute()
            .value

        var entries = records.map { rec in
            let e = FoodEntry(
                name: rec.name,
                date: rec.date,
                calories: rec.calories,
                protein: rec.protein,
                carbs: rec.carbs,
                fat: rec.fat
            )
            e.id = rec.id
            e.date = rec.date
            return e
        }
        if let sinceDate = date {
            entries = entries.filter { $0.date >= sinceDate }
        }
        return entries
    }

    func deleteFoodEntry(id: UUID) async throws {
        _ = try await client
            .from("food_entries")
            .delete()
            .eq("id", value: id.uuidString)
            .execute()
    }

    // MARK: - Realtime Subscriptions
    /// Subscribe to workout changes (insert/update/delete)
    @MainActor
    func subscribeWorkoutChanges(_ onChange: @escaping () -> Void) async {
        let channel = client.realtimeV2.channel("public:workouts")
        await channel.subscribe()
        Task {
            for await _ in channel.postgresChange(InsertAction.self, table: "workouts") {
                onChange()
            }
        }
        Task {
            for await _ in channel.postgresChange(UpdateAction.self, table: "workouts") {
                onChange()
            }
        }
        Task {
            for await _ in channel.postgresChange(DeleteAction.self, table: "workouts") {
                onChange()
            }
        }
    }

    /// Subscribe to food entry changes (insert/update/delete)
    @MainActor
    func subscribeFoodEntryChanges(_ onChange: @escaping () -> Void) async {
        let channel = client.realtimeV2.channel("public:food_entries")
        await channel.subscribe()
        Task {
            for await _ in channel.postgresChange(InsertAction.self, table: "food_entries") {
                onChange()
            }
        }
        Task {
            for await _ in channel.postgresChange(UpdateAction.self, table: "food_entries") {
                onChange()
            }
        }
        Task {
            for await _ in channel.postgresChange(DeleteAction.self, table: "food_entries") {
                onChange()
            }
        }
    }
}
