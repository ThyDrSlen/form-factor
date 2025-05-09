import Foundation
import SwiftData

/// Represents a logged food entry with optional macro breakdown.
@Model
final class FoodEntry: Identifiable {
    @Attribute(.unique) var id: UUID = UUID()
    var name: String
    var date: Date
    var calories: Double
    var protein: Double?
    var carbs: Double?
    var fat: Double?

    init(name: String,
         date: Date = Date(),
         calories: Double,
         protein: Double? = nil,
         carbs: Double? = nil,
         fat: Double? = nil) {
        self.name = name
        self.date = date
        self.calories = calories
        self.protein = protein
        self.carbs = carbs
        self.fat = fat
    }
}
