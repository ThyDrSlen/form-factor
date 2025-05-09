import SwiftUI
import SwiftData

struct FoodEntryView: View {
    @StateObject private var vm = FoodEntryViewModel()
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case name, calories, protein, carbs, fat }

    var body: some View {
        Form {
            Section("Meal Details") {
                TextField("Food Name", text: $vm.name)
                    .textInputAutocapitalization(.words)
                    .disableAutocorrection(true)
                    .focused($focusedField, equals: .name)
                    .submitLabel(.done)
                    .onSubmit { focusedField = nil }
                DatePicker("Date & Time", selection: $vm.date)
            }

            Section("Nutrition (optional)") {
                TextField("Calories", text: $vm.calories)
                    .keyboardType(.decimalPad)
                    .focused($focusedField, equals: .calories)
                    .submitLabel(.done)
                    .onSubmit { focusedField = nil }
                HStack {
                    TextField("Protein (g)", text: $vm.protein)
                        .keyboardType(.decimalPad)
                        .focused($focusedField, equals: .protein)
                        .submitLabel(.done)
                        .onSubmit { focusedField = nil }
                    Spacer()
                    Text("g")
                }
                HStack {
                    TextField("Carbs (g)", text: $vm.carbs)
                        .keyboardType(.decimalPad)
                        .focused($focusedField, equals: .carbs)
                        .submitLabel(.done)
                        .onSubmit { focusedField = nil }
                    Spacer()
                    Text("g")
                }
                HStack {
                    TextField("Fat (g)", text: $vm.fat)
                        .keyboardType(.decimalPad)
                        .focused($focusedField, equals: .fat)
                        .submitLabel(.done)
                        .onSubmit { focusedField = nil }
                    Spacer()
                    Text("g")
                }
            }

            Button(action: {
                vm.save(in: modelContext)
                dismiss()
            }) {
                HStack { Spacer(); Image(systemName: "plus.circle.fill"); Text("Save Meal"); Spacer() }
            }
            .disabled(vm.name.isEmpty || vm.calories.isEmpty)
        }
        .navigationTitle("Log Meal")
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
            }
        }
    }
}
