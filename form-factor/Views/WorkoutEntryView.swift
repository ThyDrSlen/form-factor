import SwiftUI
import SwiftData

struct WorkoutEntryView: View {
    @StateObject private var vm = WorkoutEntryViewModel()
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case exercise, sets, reps, weight }
    private let commonExercises = ["Bench Press", "Squat", "Deadlift", "Shoulder Press", "Pull-up", "Push-up", "Plank"]

    var body: some View {
        Form {
            Section("Exercise Details") {
                Picker("Exercise", selection: $vm.exercise) {
                    Text("Custom").tag("")
                    ForEach(commonExercises, id: \.self) { ex in Text(ex).tag(ex) }
                }
                .pickerStyle(.menu)
                if vm.exercise.isEmpty {
                    TextField("Custom Exercise", text: $vm.exercise)
                        .textInputAutocapitalization(.words)
                        .disableAutocorrection(true)
                        .focused($focusedField, equals: .exercise)
                        .submitLabel(.done)
                        .onSubmit { focusedField = nil }
                        .textFieldStyle(.plain)
                }
            }

            Section("Sets & Reps") {
                HStack {
                    Text("Sets")
                    TextField("", text: $vm.sets)
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .sets)
                        .submitLabel(.done)
                        .onSubmit { focusedField = nil }
                        .textFieldStyle(.plain)
                    Spacer()
                    Stepper("", value: $vm.setsValue, in: 1...10)
                        .fixedSize()
                }
                HStack {
                    Text("Reps")
                    TextField("", text: $vm.reps)
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .reps)
                        .submitLabel(.done)
                        .onSubmit { focusedField = nil }
                        .textFieldStyle(.plain)
                    Spacer()
                    Stepper("", onIncrement: { vm.incrementReps() }, onDecrement: { vm.decrementReps() })
                        .fixedSize()
                }
            }

            Section("Weight & Duration") {
                HStack {
                    Text("Weight (lbs)")
                    TextField("", text: $vm.weight)
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .weight)
                        .submitLabel(.done)
                        .onSubmit { focusedField = nil }
                        .textFieldStyle(.plain)
                    Spacer()
                    Stepper("", onIncrement: { vm.incrementWeight() }, onDecrement: { vm.decrementWeight() })
                        .fixedSize()
                }
                Toggle("Include Duration", isOn: $vm.includeDuration)
                if vm.includeDuration {
                    HStack { Text("Duration: \(vm.duration) sec"); Spacer() }
                    Slider(value: Binding(get: { Double(vm.duration) }, set: { vm.duration = Int($0) }), in: 0...300, step: 10)
                }
            }

            Button(action: {
                vm.save(in: modelContext)
                dismiss()
            }) {
                HStack { Spacer(); Image(systemName: "plus.circle.fill"); Text("Save Workout"); Spacer() }
            }
            .disabled(vm.exercise.isEmpty || vm.sets.isEmpty)
        }
        .scrollDismissesKeyboard(.interactively)
        .transaction { $0.disablesAnimations = true }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
            }
        }
        .navigationTitle("Log Workout")
    }
}
