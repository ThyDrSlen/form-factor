import SwiftUI
import SwiftData
import Supabase

/// ViewModel for creating and fetching FoodEntry objects.
@MainActor
class FoodEntryViewModel: ObservableObject {
    @Published var name: String = ""
    @Published var calories: String = ""
    @Published var protein: String = ""
    @Published var carbs: String = ""
    @Published var fat: String = ""
    @Published var date: Date = Date()
    
    @Published var entries: [FoodEntry] = []
    
    /// Saves a new FoodEntry to the given context.
    func save(in context: ModelContext) {
        guard let cal = Double(calories) else { return }
        let entry = FoodEntry(name: name,
                              date: date,
                              calories: cal,
                              protein: Double(protein) ?? nil,
                              carbs: Double(carbs) ?? nil,
                              fat: Double(fat) ?? nil)
        context.insert(entry)
        do {
            try context.save()
            entries.append(entry)
            Task {
                do {
                    try await SupabaseManager.shared.upsertFoodEntry(entry)
                } catch {
                    print("Supabase upsert food entry error: \(error)")
                }
            }
            clearForm()
        } catch {
            print("Failed to save FoodEntry: \(error)")
        }
    }
    

    func fetchToday(in context: ModelContext) {
        let start = Calendar.current.startOfDay(for: Date())
        let desc = FetchDescriptor<FoodEntry>( // This is the line in question
            predicate: #Predicate { $0.date >= start }, // Ensure 'predicate:' (singular) and #Predicate macro
            sortBy: [SortDescriptor(\.date, order: .reverse)]
        )
        do {
            entries = try context.fetch(desc)
        } catch {
            print("Fetch error: \(error)")
        }
    }
    
    /// Deletes an existing entry locally and in Supabase.
    func delete(_ entry: FoodEntry, in context: ModelContext) {
        context.delete(entry)
        do {
            try context.save()
        } catch {
            print("Failed to delete FoodEntry locally: \(error)")
        }
        Task {
            do {
                try await SupabaseManager.shared.deleteFoodEntry(id: entry.id)
            } catch {
                print("Supabase delete food entry error: \(error)")
            }
        }
        fetchToday(in: context)
    }
    
    private func clearForm() {
        name = ""
        calories = ""
        protein = ""
        carbs = ""
        fat = ""
        date = Date()
    }
}
