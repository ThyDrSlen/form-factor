import SwiftUI
import SwiftData
import Supabase

class WorkoutEntryViewModel: ObservableObject {
    @Published var exercise = ""
    @Published var sets = ""
    @Published var reps = ""
    @Published var weight = ""
    @Published var duration = 60
    @Published var includeDuration = false
    
    // Computed property for sets stepper
    var setsValue: Int {
        get { return Int(sets) ?? 1 }
        set { sets = "\(newValue)" }
    }
    
    // Helper methods for steppers
    func incrementReps() {
        let currentValue = Int(reps) ?? 0
        reps = "\(currentValue + 1)"
    }
    
    func decrementReps() {
        let currentValue = Int(reps) ?? 0
        if currentValue > 0 {
            reps = "\(currentValue - 1)"
        } else if !reps.isEmpty {
            reps = ""
        }
    }
    
    func incrementWeight() {
        let currentValue = Int(weight) ?? 0
        weight = "\(currentValue + 5)"
    }
    
    func decrementWeight() {
        let currentValue = Int(weight) ?? 0
        if currentValue >= 5 {
            weight = "\(currentValue - 5)"
        } else if !weight.isEmpty {
            weight = ""
        }
    }

    /// Save a new Workout via SwiftData
    func save(in context: ModelContext) {
        let workout = Workout(
            exercise: exercise,
            sets: Int(sets) ?? 1,
            reps: Int(reps),
            weight: Int(weight),
            duration: includeDuration ? duration : nil
        )
        context.insert(workout)
        do {
            try context.save()
            // Sync local and push to Supabase
            SyncManager.shared.syncAll()
            Task {
                do {
                    try await SupabaseManager.shared.upsertWorkout(workout)
                } catch {
                    print("Supabase upsert workout error: \(error)")
                }
            }
            // Reset form
            exercise = ""
            sets = ""
            reps = ""
            weight = ""
            duration = 60
        } catch {
            print("Save error:", error)
        }
    }
}
