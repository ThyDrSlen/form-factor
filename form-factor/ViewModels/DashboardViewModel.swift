import SwiftUI
import SwiftData
import Foundation
import Supabase

class DashboardViewModel: ObservableObject {
    @Published var heartRate: Double?
    @Published var steps: Double?
    @Published var calories: Double?
    @Published var weightLb: Double?
    @Published var bodyFatPct: Double?

    // MARK: - Chart Data Models
    struct DataPoint: Identifiable {
        let id = UUID()
        let date: Date
        let value: Double
    }
    enum Category: String, CaseIterable, Identifiable {
        var id: String { rawValue }
        case steps = "Steps", weight = "Weight", bodyFat = "Body Fat"
    }
    enum Period: String, CaseIterable, Identifiable {
        var id: String { rawValue }
        case oneMonth = "1M", threeMonths = "3M", sixMonths = "6M"
    }

    @Published var selectedCategory: Category = .steps { didSet { fetchChartData() } }
    @Published var selectedPeriod: Period = .oneMonth { didSet { fetchChartData() } }
    @Published var chartData: [DataPoint] = []
    // MARK: - Meals & Workouts
    @Published var meals: [FoodEntry] = []
    @Published var workouts: [Workout] = []

    func fetchHeartRate() {
        HealthKitManager.shared.fetchLatestHeartRate { [weak self] bpm in
            self?.heartRate = bpm
        }
    }

    func fetchSteps() {
        HealthKitManager.shared.fetchStepCount { [weak self] val in
            self?.steps = val
        }
    }

    func fetchCalories() {
        HealthKitManager.shared.fetchActiveEnergyBurned { [weak self] val in
            self?.calories = val
        }
    }

    func fetchWeight() {
        HealthKitManager.shared.fetchLatestBodyMass { [weak self] kg in
            if let kg = kg {
                self?.weightLb = kg * 2.20462
            } else {
                self?.weightLb = nil
            }
        }
    }

    func fetchBodyFat() {
        HealthKitManager.shared.fetchLatestBodyFatPercentage { [weak self] val in
            self?.bodyFatPct = val
        }
    }

    func refreshData() {
        SyncManager.shared.syncAll()
        fetchSteps()
        fetchCalories()
        fetchWeight()
        fetchBodyFat()
        fetchHeartRate()
        fetchChartData()
        // Meals
        // fetchMeals should be called from view with context
    }

    /// Generates dummy historical data for charting; replace with real HealthKit fetch.
    func fetchChartData() {
        let now = Date()
        let days: Int
        switch selectedPeriod {
        case .oneMonth: days = 30
        case .threeMonths: days = 90
        case .sixMonths: days = 180
        }
        chartData = (0..<days).map { offset in
            let date = Calendar.current.date(byAdding: .day, value: -offset, to: now)!
            // Simple mock: base value + random variance
            let base: Double
            switch selectedCategory {
            case .steps: base = Double(steps ?? 0)
            case .weight: base = Double(weightLb ?? 0)
            case .bodyFat: base = Double(bodyFatPct ?? 0)
            }
            let variance = base * 0.2
            return DataPoint(date: date, value: max(0, base + Double.random(in: -variance...variance)))
        }.sorted { $0.date < $1.date }
    }

    /// Fetches today's food entries from the given context.
    func fetchMeals(in context: ModelContext) {
        let start = Calendar.current.startOfDay(for: Date())
        let desc = FetchDescriptor<FoodEntry>(
            predicate: #Predicate { $0.date >= start },
            sortBy: [SortDescriptor(\.date, order: .reverse)]
        )
        do { meals = try context.fetch(desc) } catch { print("Meal fetch error: \(error)") }
    }

    /// Deletes a FoodEntry via context and refreshes meals.
    func deleteMeal(_ meal: FoodEntry, in context: ModelContext) {
        context.delete(meal)
        try? context.save()
        fetchMeals(in: context)
    }

    @MainActor
    func fetchWorkoutsRemote() async {
        workouts = (try? await SupabaseManager.shared.fetchWorkouts()) ?? []
    }

    @MainActor
    func fetchMealsRemote() async {
        meals = (try? await SupabaseManager.shared.fetchFoodEntries()) ?? []
    }

    /// Start realtime updates via SupabaseManager
    func startRealtime() {
        Task {
            await SupabaseManager.shared.subscribeWorkoutChanges { [weak self] in
                Task { await self?.fetchWorkoutsRemote() }
            }
            await SupabaseManager.shared.subscribeFoodEntryChanges { [weak self] in
                Task { await self?.fetchMealsRemote() }
            }
        }
    }

    init() {
        fetchSteps(); fetchCalories(); fetchWeight(); fetchBodyFat(); fetchChartData()
        Task {
            await fetchWorkoutsRemote(); await fetchMealsRemote(); startRealtime()
        }
    }
}
