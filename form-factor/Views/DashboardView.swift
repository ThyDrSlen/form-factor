import SwiftUI
import Charts
import SwiftData
import Supabase

struct DashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var workouts: [Workout] = []
    @StateObject private var vm = DashboardViewModel()

    // MARK: - Subviews
    private var chartSection: some View {
        Section(header: Text("Trends").font(.headline).foregroundColor(.blue)) {
            Picker("Category", selection: $vm.selectedCategory) {
                ForEach(DashboardViewModel.Category.allCases) { cat in
                    Text(cat.rawValue).tag(cat)
                }
            }
            .pickerStyle(.segmented)
            .padding(.vertical, 4)
            Picker("Period", selection: $vm.selectedPeriod) {
                ForEach(DashboardViewModel.Period.allCases) { per in
                    Text(per.rawValue).tag(per)
                }
            }
            .pickerStyle(.segmented)
            .padding(.bottom, 8)
            Chart(vm.chartData) { point in
                if vm.selectedCategory == .steps {
                    BarMark(
                        x: .value("Date", point.date, unit: .day),
                        y: .value(vm.selectedCategory.rawValue, point.value)
                    )
                } else {
                    LineMark(
                        x: .value("Date", point.date, unit: .day),
                        y: .value(vm.selectedCategory.rawValue, point.value)
                    )
                    PointMark(
                        x: .value("Date", point.date, unit: .day),
                        y: .value(vm.selectedCategory.rawValue, point.value)
                    )
                }
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .month))
            }
            .frame(height: 200)
        }
    }

    private var todayActivitySection: some View {
        Section(header: Text("Today’s Activity")) {
            HStack { Text("Steps:"); Text(vm.steps.map { String(format: "%.0f", $0) } ?? "--") }
                .font(.headline).foregroundColor(.blue)
            HStack { Text("Calories:"); Text(vm.calories.map { String(format: "%.0f kcal", $0) } ?? "--") }
                .font(.headline).foregroundColor(.blue)
        }
    }
    private var measurementsSection: some View {
        Section(header: Text("Measurements")) {
            HStack {
                Text("Weight:")
                Text(vm.weightLb.map { String(format: "%.1f lb", $0) } ?? "--")
            }
            .font(.headline)
            .foregroundColor(.blue)
            HStack {
                Text("Body Fat:")
                Text(vm.bodyFatPct.map { String(format: "%.1f%%", $0 * 100) } ?? "--")
            }
            .font(.headline)
            .foregroundColor(.blue)
        }
    }
    private var latestHRSection: some View {
        Section(header: Text("Latest HR")) {
            Text(vm.heartRate.map { "\($0) bpm" } ?? "--")
                .onAppear { vm.fetchHeartRate() }
        }
    }

    // MARK: - Meals & Workouts Sections
    private var mealsSection: some View {
        Section(header: Text("Meals")) {
            ForEach(vm.meals) { meal in
                HStack {
                    VStack(alignment: .leading) {
                        Text(meal.name).font(.headline)
                        Text(meal.date, style: .time).font(.caption)
                    }
                    Spacer()
                    Text(String(format: "%.0f kcal", meal.calories))
                }
                .swipeActions {
                    Button(role: .destructive) {
                        Task {
                            do {
                                try await SupabaseManager.shared.deleteFoodEntry(id: meal.id)
                                vm.meals = try await SupabaseManager.shared.fetchFoodEntries()
                            } catch {
                                print("Supabase delete food entry error: \(error)")
                            }
                        }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
    }
    private var workoutsSection: some View {
        Section(header: Text("Workouts")) {
            ForEach(workouts) { workout in
                VStack(alignment: .leading, spacing: 8) {
                    Text(workout.exercise).font(.headline)
                    Text(workout.setsText)
                        .font(.subheadline)
                    Text(workout.createdAt, format: .dateTime.year().month().day().hour().minute())
                        .font(.caption).foregroundColor(.secondary)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(.secondarySystemBackground)))
                .swipeActions {
                    Button(role: .destructive) {
                        Task {
                            do {
                                try await SupabaseManager.shared.deleteWorkout(id: workout.id)
                                workouts = try await SupabaseManager.shared.fetchWorkouts()
                            } catch {
                                print("Supabase delete workout error: \(error)")
                            }
                        }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
    }

    var body: some View {
        NavigationView {
            List {
                chartSection
                mealsSection
                todayActivitySection
                measurementsSection
                latestHRSection
                workoutsSection
            }
            .toolbar {
                HStack {
                    NavigationLink("Log+", destination: WorkoutEntryView())
                    NavigationLink("Log Meal+", destination: FoodEntryView())
                    NavigationLink(destination: AccountView()) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.title2)
                            .foregroundColor(.blue)
                    }
                }
            }
            .onAppear {
                vm.refreshData()
                Task {
                    do {
                        workouts = try await SupabaseManager.shared.fetchWorkouts()
                    } catch {
                        print("Supabase fetch workouts error: \(error)")
                    }
                    do {
                        vm.meals = try await SupabaseManager.shared.fetchFoodEntries()
                    } catch {
                        print("Supabase fetch food entries error: \(error)")
                    }
                }
            }
            .navigationTitle("Dashboard")
            .listStyle(.insetGrouped)
        }
    }
}
