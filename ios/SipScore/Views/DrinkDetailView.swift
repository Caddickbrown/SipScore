import SwiftUI

/// A drink, its ratings on this trip, and the star picker for your own.
@MainActor
struct DrinkDetailView: View {
    let drinkId: Int
    let drinkName: String

    @Environment(SessionStore.self) private var session

    @State private var drink: Drink?
    @State private var ratings: [Rating] = []
    @State private var myRating: MyRating?
    @State private var selectedStars = 0
    @State private var notes = ""
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                hero
                ratingCard

                if let drink, (drink.ratingCount ?? 0) > 0 {
                    communityCard(drink)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(Palette.ivory)
        .navigationTitle(drink?.name ?? drinkName)
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isLoading && drink == nil {
                ProgressView()
            }
        }
        .confirmationDialog("Remove your rating for this drink?",
                            isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Remove Rating", role: .destructive) { Task { await deleteRating() } }
        }
        .task { await load() }
    }

    // MARK: Sections

    private var hero: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let drink {
                BadgeView(text: drink.badgeLabel, tint: drink.accentColour)
                Text(drink.name)
                    .font(.serifTitle(30, weight: .medium))
                    .foregroundStyle(Palette.navy)
                if !drink.meta.isEmpty {
                    Text(drink.meta)
                        .font(.system(size: 14, weight: .light))
                        .foregroundStyle(Palette.textLight)
                }
                // The payoff of a shared catalogue: how this drink has fared
                // beyond the trip you're on.
                if let trips = drink.tripsRatedOn, trips > 1,
                   let overall = drink.overallAvgStars,
                   let overallCount = drink.overallRatingCount {
                    Text(String(format: "%.1f across %d trips (%d ratings all-time)",
                                overall, trips, overallCount))
                        .font(.system(size: 12.5, weight: .light))
                        .foregroundStyle(Palette.goldDark)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 12)
    }

    private var ratingCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(myRating == nil ? "Rate this drink" : "Your rating")
                    .font(.serifTitle(20))
                    .foregroundStyle(Palette.navy)
                Spacer()
                if let trip = session.activeTrip {
                    Text("on \(trip.name)")
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Palette.textLight)
                }
            }

            HStack(spacing: 10) {
                ForEach(1...5, id: \.self) { value in
                    Button {
                        selectedStars = value
                    } label: {
                        Image(systemName: value <= selectedStars ? "star.fill" : "star")
                            .font(.system(size: 32))
                            .foregroundStyle(value <= selectedStars ? Palette.gold : Palette.border)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(value) star\(value == 1 ? "" : "s")")
                }
                Spacer()
            }

            Text(selectedStars > 0 ? starLabels[selectedStars] : "Tap a star to rate")
                .font(.system(size: 13, weight: .light))
                .foregroundStyle(Palette.textLight)

            TextField("Tasting notes (optional)", text: $notes, axis: .vertical)
                .lineLimit(3...6)
                .font(.system(size: 15))
                .padding(12)
                .background(Palette.ivory, in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(Palette.border, lineWidth: 1))

            if let errorMessage {
                Text(errorMessage).font(.system(size: 13)).foregroundStyle(.red)
            }

            Button {
                Task { await save() }
            } label: {
                if isSaving {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text(myRating == nil ? "Save Rating" : "Update Rating")
                }
            }
            .buttonStyle(GoldButtonStyle())
            .disabled(selectedStars == 0 || isSaving)
            .opacity(selectedStars == 0 ? 0.55 : 1)

            if myRating != nil {
                Button("Remove Rating", role: .destructive) { confirmDelete = true }
                    .font(.system(size: 14))
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(18)
        .cardStyle()
    }

    private func communityCard(_ drink: Drink) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("What the group thought")
                .font(.serifTitle(20))
                .foregroundStyle(Palette.navy)

            HStack(alignment: .center, spacing: 14) {
                Text(String(format: "%.1f", drink.avgStars ?? 0))
                    .font(.serifTitle(44, weight: .medium))
                    .foregroundStyle(Palette.navy)
                VStack(alignment: .leading, spacing: 3) {
                    StarsView(value: drink.avgStars ?? 0, size: 16)
                    Text("\(drink.ratingCount ?? 0) rating\((drink.ratingCount ?? 0) == 1 ? "" : "s") on this trip")
                        .font(.system(size: 12.5, weight: .light))
                        .foregroundStyle(Palette.textLight)
                }
            }

            Divider()

            VStack(spacing: 14) {
                ForEach(ratings) { rating in
                    RatingRow(rating: rating, isMe: rating.userId == session.user?.id)
                }
            }
        }
        .padding(18)
        .cardStyle()
    }

    // MARK: Actions

    private func load() async {
        guard let user = session.user, let trip = session.activeTrip else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await APIClient.shared.drink(id: drinkId, userId: user.id, tripId: trip.id)
            drink = response.drink
            ratings = response.ratings ?? []
            myRating = response.myRating
            if let mine = response.myRating {
                selectedStars = mine.stars
                notes = mine.notes ?? ""
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func save() async {
        guard let user = session.user, let trip = session.activeTrip, selectedStars > 0 else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            try await APIClient.shared.saveRating(
                userId: user.id, tripId: trip.id, drinkId: drinkId,
                stars: selectedStars, notes: trimmed.isEmpty ? nil : trimmed
            )
            session.show("Rating saved!")
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteRating() async {
        guard let user = session.user, let trip = session.activeTrip else { return }
        do {
            try await APIClient.shared.deleteRating(userId: user.id, tripId: trip.id, drinkId: drinkId)
            myRating = nil
            selectedStars = 0
            notes = ""
            session.show("Rating removed")
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct RatingRow: View {
    let rating: Rating
    let isMe: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            AvatarView(name: rating.userName ?? "?",
                       colourHex: rating.avatarColour,
                       imageDataURL: rating.avatarImage,
                       size: 34)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text((rating.userName ?? "Someone") + (isMe ? " (you)" : ""))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Palette.navy)
                    Spacer()
                    StarsView(value: Double(rating.stars), size: 12)
                }
                if let notes = rating.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.system(size: 13.5, weight: .light))
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
