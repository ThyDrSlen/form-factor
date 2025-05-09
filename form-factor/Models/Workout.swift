import Foundation
import SwiftData

@Model
final class Workout: Identifiable {
    @Attribute(.unique) var id: UUID = UUID()
    var exercise: String
    var sets: Int
    var reps: Int?
    var weight: Int?
    var duration: Int?
    var createdAt: Date = Date()

    init(exercise: String, sets: Int, reps: Int? = nil, weight: Int? = nil, duration: Int? = nil) {
        self.exercise = exercise
        self.sets = sets
        self.reps = reps
        self.weight = weight
        self.duration = duration
    }

    convenience init(from record: SupabaseManager.WorkoutRecord) {
        self.init(exercise: record.exercise, sets: record.sets, reps: record.reps, weight: record.weight, duration: record.duration)
        self.id = record.id
        self.createdAt = record.created_at
    }
}

// Provides a friendly string for sets, reps, and weight
extension Workout {
    var setsText: String {
        var text = "\(sets) sets"
        if let reps = reps {
            text += " × \(reps) reps"
        }
        if let weight = weight {
            text += " @ \(weight) lbs"
        }
        return text
    }
}
