import SwiftUI

/// Rankings for the active trip: your own top picks, the group average, and a
/// Bayesian consensus that doesn't let a single 5-star review win outright.
@MainActor
struct LeaderboardView: View {
    @Environment(SessionStore.self) private var session

    @State private var kind: LeaderboardKind = .personal
    @State private var category: DrinkCategory?
    @State private var rows: [Drink] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showProfile = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("Board", selection: $kind) {
                ForEach(LeaderboardKind.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 10)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip(label: "All", isOn: category == nil) { category = nil }
                    ForEach(DrinkCategory.allCases) { item in
                        chip(label: item.label, isOn: category == item) { category = item }
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 10)

            Group {
                if isLoading && rows.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage {
                    EmptyStateView(title: "Could not load rankings",
                                   message: errorMessage,
                                   systemImage: "exclamationmark.triangle")
                } else if rows.isEmpty {
                    EmptyStateView(title: "Nothing ranked yet",
                                   message: emptyMessage,
                                   systemImage: "trophy")
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(Array(rows.enumerated()), id: \.element.id) { index, drink in
                                NavigationLink(value: drink) {
                                    LeaderboardRow(rank: index + 1, drink: drink, kind: kind)
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
        .navigationTitle("Rankings")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Drink.self) { drink in
            DrinkDetailView(drinkId: drink.id, drinkName: drink.name)
        }
        .toolbar {
            TripToolbarLabel(tripName: session.activeTrip?.name ?? "",
                             showProfile: $showProfile,
                             user: session.user)
        }
        .sheet(isPresented: $showProfile) { ProfileView() }
        .refreshable { await load() }
        .task(id: session.activeTrip?.id) { await load() }
        .onChange(of: kind) { _, _ in Task { await load() } }
        .onChange(of: category) { _, _ in Task { await load() } }
    }

    private var emptyMessage: String {
        let trip = session.activeTrip?.name ?? "this trip"
        return kind == .personal
            ? "Rate a few drinks on \(trip) and your top picks show up here."
            : "No ratings on \(trip) yet — be the first."
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

    private func load() async {
        guard let user = session.user, let trip = session.activeTrip else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            rows = try await APIClient.shared.leaderboard(
                type: kind, userId: user.id, tripId: trip.id, category: category
            )
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct LeaderboardRow: View {
    let rank: Int
    let drink: Drink
    let kind: LeaderboardKind

    var body: some View {
        HStack(spacing: 12) {
            Text("\(rank)")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(rank <= 3 ? .white : Palette.textLight)
                .frame(width: 30, height: 30)
                .background(medalColour, in: Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(drink.name)
                    .font(.serifTitle(17))
                    .foregroundStyle(Palette.navy)
                    .lineLimit(1)
                if !drink.meta.isEmpty {
                    Text(drink.meta)
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Palette.textLight)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 2) {
                Text(scoreText)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.navy)
                Text(detailText)
                    .font(.system(size: 11, weight: .light))
                    .foregroundStyle(Palette.textLight)
            }
        }
        .padding(13)
        .cardStyle()
    }

    private var medalColour: Color {
        switch rank {
        case 1:  Palette.gold
        case 2:  Color(hex: 0xA8B0BC)
        case 3:  Color(hex: 0xC08552)
        default: Palette.navy.opacity(0.06)
        }
    }

    private var scoreText: String {
        switch kind {
        case .personal:
            return "\(drink.myStars ?? 0)★"
        case .social:
            return String(format: "%.1f★", drink.avgStars ?? 0)
        case .consensus:
            return String(format: "%.2f", drink.consensusScore ?? 0)
        }
    }

    private var detailText: String {
        switch kind {
        case .personal:
            return drink.avgStars.map { String(format: "group %.1f", $0) } ?? "no group score"
        case .social, .consensus:
            let count = drink.ratingCount ?? 0
            return "\(count) rating\(count == 1 ? "" : "s")"
        }
    }
}
