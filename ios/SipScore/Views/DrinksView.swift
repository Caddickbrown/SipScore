import SwiftUI

/// Browse and search the catalogue. The scope picker is what makes the shared
/// catalogue work: "This trip" is what was added on this holiday, "All drinks"
/// is everything anyone has ever added.
@MainActor
struct DrinksView: View {
    @Environment(SessionStore.self) private var session

    @State private var drinks: [Drink] = []
    @State private var search = ""
    @State private var scope: DrinkScope = .trip
    @State private var category: DrinkCategory?
    @State private var type: String?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var showProfile = false
    /// A trip with nothing of its own opens up the catalogue, but only once —
    /// after that the picker reflects what the user chose.
    @State private var hasAutoWidened = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            filters

            Group {
                if isLoading && drinks.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage {
                    EmptyStateView(title: "Could not load drinks",
                                   message: errorMessage,
                                   systemImage: "exclamationmark.triangle")
                } else if drinks.isEmpty {
                    EmptyStateView(title: search.isEmpty ? "Nothing here yet" : "No results",
                                   message: emptyMessage)
                } else {
                    // A plain scroll view rather than a List: the cards carry
                    // their own chevron, and List would add a second one.
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(drinks) { drink in
                                NavigationLink(value: drink) {
                                    DrinkRow(drink: drink)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
        .background(Palette.ivory)
        .navigationTitle("Drinks")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Drink.self) { drink in
            DrinkDetailView(drinkId: drink.id, drinkName: drink.name)
        }
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Search drinks…")
        .toolbar {
            TripToolbarLabel(tripName: session.activeTrip?.name ?? "",
                             showProfile: $showProfile,
                             user: session.user)
            ToolbarItem(placement: .topBarLeading) {
                Button { showAdd = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Add a drink")
            }
        }
        .sheet(isPresented: $showProfile) { ProfileView() }
        .sheet(isPresented: $showAdd) {
            AddDrinkView { await load() }
        }
        .refreshable { await load() }
        .task(id: session.activeTrip?.id) {
            hasAutoWidened = false
            await load()
        }
        .onChange(of: search) { _, _ in debouncedLoad() }
        .onChange(of: scope) { _, _ in
            hasAutoWidened = true    // an explicit choice sticks
            Task { await load() }
        }
    }

    private var emptyMessage: String {
        if !search.isEmpty { return "No drinks match “\(search)”." }
        if scope == .trip, let trip = session.activeTrip {
            return "Nothing added on \(trip.name) yet — try All drinks, or add one."
        }
        return "Add a drink to get started."
    }

    private var filters: some View {
        VStack(spacing: 10) {
            Picker("Scope", selection: $scope) {
                ForEach(DrinkScope.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)

            // Chips reload directly rather than via onChange, so switching
            // category (which also clears the type) only fetches once.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip(label: "All", isOn: category == nil) { select(category: nil) }
                    ForEach(DrinkCategory.allCases) { item in
                        chip(label: item.label, isOn: category == item) { select(category: item) }
                    }
                }
                .padding(.horizontal, 16)
            }

            if let category {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        chip(label: "All \(category.label)s", isOn: type == nil) { select(type: nil) }
                        ForEach(category.types, id: \.self) { item in
                            chip(label: item, isOn: type == item) { select(type: item) }
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
        .padding(.vertical, 10)
        .background(Palette.ivory)
    }

    private func chip(label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: isOn ? .medium : .regular))
                .foregroundStyle(isOn ? .white : Palette.navy)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(isOn ? Palette.navy : Color.white, in: Capsule())
                .overlay(Capsule().stroke(isOn ? Palette.navy : Palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func select(category newCategory: DrinkCategory?) {
        category = newCategory
        type = nil        // the type list is category-specific
        Task { await load() }
    }

    private func select(type newType: String?) {
        type = newType
        Task { await load() }
    }

    private func debouncedLoad() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(320))
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    private func load() async {
        guard let user = session.user, let trip = session.activeTrip else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await APIClient.shared.drinks(
                userId: user.id, tripId: trip.id, scope: scope,
                search: search.trimmingCharacters(in: .whitespaces),
                category: category, type: type
            )
            errorMessage = nil

            if result.isEmpty, scope == .trip, !hasAutoWidened,
               search.isEmpty, category == nil, type == nil {
                hasAutoWidened = true
                scope = .all      // triggers onChange, which reloads
                return
            }
            drinks = result
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Row

struct DrinkRow: View {
    let drink: Drink

    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(drink.accentColour)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .top) {
                    Text(drink.name)
                        .font(.serifTitle(18))
                        .foregroundStyle(Palette.navy)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    BadgeView(text: drink.badgeLabel, tint: drink.accentColour)
                }

                if !drink.meta.isEmpty {
                    Text(drink.meta)
                        .font(.system(size: 12.5, weight: .light))
                        .foregroundStyle(Palette.textLight)
                }

                HStack(spacing: 8) {
                    if let count = drink.ratingCount, count > 0 {
                        StarsView(value: drink.avgStars ?? 0)
                        Text(String(format: "%.1f", drink.avgStars ?? 0))
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundStyle(Palette.navy)
                        Text("(\(count))")
                            .font(.system(size: 12, weight: .light))
                            .foregroundStyle(Palette.textLight)
                    } else {
                        Text("No ratings yet")
                            .font(.system(size: 12, weight: .light))
                            .foregroundStyle(Palette.textLight)
                    }

                    Spacer(minLength: 0)

                    if let mine = drink.myStars, mine > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "star.fill").font(.system(size: 10))
                            Text("You: \(mine)").font(.system(size: 11.5, weight: .medium))
                        }
                        .foregroundStyle(Palette.goldDark)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Palette.goldPale, in: Capsule())
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.vertical, 13)
            .padding(.horizontal, 13)

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.border)
                .padding(.trailing, 13)
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Palette.border, lineWidth: 1)
        )
        .shadow(color: Palette.navy.opacity(0.05), radius: 3, y: 1)
    }
}
