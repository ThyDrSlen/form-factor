import XCTest
import Supabase
import Foundation
@testable import form_factor

class SupabaseManagerTests: XCTestCase {
    @MainActor func testWorkoutMappingAndFilter() async throws {
        // Prepare two records around a cutoff date
        let early = SupabaseManager.WorkoutRecord(
            id: UUID(), exercise: "A", sets: 3, reps: 10, weight: 50, duration: nil,
            created_at: Date(timeIntervalSince1970: 1_000)
        )
        let later = SupabaseManager.WorkoutRecord(
            id: UUID(), exercise: "B", sets: 3, reps: 15, weight: 60, duration: nil,
            created_at: Date(timeIntervalSince1970: 2_000)
        )
        let cutoff = Date(timeIntervalSince1970: 1_500)

        // Map records to models
        let workouts = [early, later].map { Workout(from: $0) }
        XCTAssertEqual(workouts.count, 2)
        XCTAssertEqual(workouts[0].exercise, "A")
        XCTAssertEqual(workouts[1].exercise, "B")

        // Filter in Swift
        let filtered = workouts.filter { $0.createdAt >= cutoff }
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.exercise, "B")
    }
}
