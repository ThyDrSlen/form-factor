import Foundation
import XCTest
import SwiftData
@testable import form_factor

class DashboardViewModelTests: XCTestCase {
    @MainActor
    func testFetchMealsInMemory() throws {
        // Setup in-memory model context
        let schema = Schema([FoodEntry.self])
        let container = try ModelContainer(for: schema)
        let context = container.mainContext

        // Seed two entries: one old and one fresh
        let todayStart = Calendar.current.startOfDay(for: Date())
        let oldEntry = FoodEntry(name: "Old", date: todayStart.addingTimeInterval(-86_400), calories: 100)
        let freshEntry = FoodEntry(name: "Fresh", date: todayStart, calories: 200)
        context.insert(oldEntry)
        context.insert(freshEntry)
        try context.save()

        // Fetch via ViewModel
        let vm = DashboardViewModel()
        vm.fetchMeals(in: context)

        // Only 'Fresh' should remain
        XCTAssertEqual(vm.meals.count, 1)
        XCTAssertEqual(vm.meals.first?.name, "Fresh")
    }
}
