import SwiftUI

/// Adds a drink to the catalogue, tagged with the trip it was added on.
@MainActor
struct AddDrinkView: View {
    let onAdded: @MainActor () async -> Void

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var category: DrinkCategory = .wine
    @State private var type: String?
    @State private var style: String?
    @State private var varietal = ""
    @State private var source = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("What is it?") {
                    TextField("Drink name", text: $name)
                        .textInputAutocapitalization(.words)

                    Picker("Category", selection: $category) {
                        ForEach(DrinkCategory.allCases) { Text($0.label).tag($0) }
                    }
                }

                Section("Details") {
                    Picker("Type", selection: $type) {
                        Text("Not sure").tag(String?.none)
                        ForEach(category.types, id: \.self) { item in
                            Text(item).tag(String?.some(item))
                        }
                    }

                    if !category.styles.isEmpty {
                        Picker("Style", selection: $style) {
                            Text("Not sure").tag(String?.none)
                            ForEach(category.styles, id: \.self) { item in
                                Text(item).tag(String?.some(item))
                            }
                        }
                    }

                    if category == .wine {
                        TextField("Grape / varietal (optional)", text: $varietal)
                            .textInputAutocapitalization(.words)
                    }

                    TextField("Where it's from (optional)", text: $source)
                        .textInputAutocapitalization(.words)
                }

                if let trip = session.activeTrip {
                    Section {
                        Text("Added on \(trip.name). It stays in the shared catalogue, so other trips can rate it too.")
                            .font(.system(size: 13, weight: .light))
                            .foregroundStyle(Palette.textLight)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).font(.system(size: 13)).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Add a Drink")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { Task { await save() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).count < 2 || isSaving)
                }
            }
            // Type and style lists are category-specific, so reset them on change.
            .onChange(of: category) { _, _ in
                type = nil
                style = nil
            }
        }
    }

    private func save() async {
        guard let user = session.user, let trip = session.activeTrip else { return }
        isSaving = true
        defer { isSaving = false }

        let trimmedVarietal = varietal.trimmingCharacters(in: .whitespaces)
        let trimmedSource = source.trimmingCharacters(in: .whitespaces)

        do {
            let drink = try await APIClient.shared.addDrink(
                userId: user.id, tripId: trip.id,
                name: name.trimmingCharacters(in: .whitespaces),
                category: category, type: type, varietal: trimmedVarietal.isEmpty ? nil : trimmedVarietal,
                style: style, source: trimmedSource.isEmpty ? nil : trimmedSource
            )
            session.show("\(drink.name) added!")
            await onAdded()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
