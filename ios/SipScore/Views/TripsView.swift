import SwiftUI
import UIKit

/// Lists the holidays you're on, and lets you create, join and switch between
/// them. Doubles as onboarding when you haven't picked a trip yet.
@MainActor
struct TripsView: View {
    var isChoosingFirstTrip = false

    @Environment(SessionStore.self) private var session

    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showCreate = false
    @State private var showJoin = false
    @State private var editingTrip: Trip?
    @State private var detailTrip: Trip?
    @State private var showProfile = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                intro
                actions

                if isLoading && session.trips.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
                } else if let errorMessage {
                    EmptyStateView(title: "Could not load trips",
                                   message: errorMessage,
                                   systemImage: "exclamationmark.triangle")
                } else if session.trips.isEmpty {
                    EmptyStateView(
                        title: "No trips yet",
                        message: "Create a trip for your next holiday, or join one with a code from a friend.",
                        systemImage: "suitcase"
                    )
                } else {
                    VStack(spacing: 12) {
                        ForEach(session.trips) { trip in
                            Button {
                                detailTrip = trip
                            } label: {
                                TripCard(trip: trip, isActive: trip.id == session.activeTrip?.id)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 28)
        }
        .background(Palette.ivory)
        .navigationTitle(isChoosingFirstTrip ? "" : "Trips")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !isChoosingFirstTrip {
                TripToolbarLabel(
                    tripName: session.activeTrip?.name ?? "",
                    showProfile: $showProfile,
                    user: session.user
                )
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign Out") { session.signOut() }
                        .font(.system(size: 14))
                }
            }
        }
        .sheet(isPresented: $showProfile) { ProfileView() }
        .sheet(isPresented: $showCreate) {
            TripFormView(trip: nil) { await reload() }
        }
        .sheet(item: $editingTrip) { trip in
            TripFormView(trip: trip) { await reload() }
        }
        .sheet(isPresented: $showJoin) {
            JoinTripView { await reload() }
        }
        .sheet(item: $detailTrip) { trip in
            TripDetailView(trip: trip,
                           onEdit: { editingTrip = $0 },
                           onChanged: { await reload() })
        }
        .refreshable { await reload() }
        .task { await reload() }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(isChoosingFirstTrip ? "Welcome to SipScore" : "Your Trips")
                .font(.serifTitle(30, weight: .medium))
                .foregroundStyle(Palette.navy)
            Text(isChoosingFirstTrip
                 ? "Start a trip for your holiday, or join one with a code."
                 : "Every holiday keeps its own ratings, rankings and feed.")
                .font(.system(size: 14, weight: .light))
                .foregroundStyle(Palette.textLight)
        }
        .padding(.top, 8)
    }

    private var actions: some View {
        HStack(spacing: 10) {
            Button("＋ New Trip") { showCreate = true }
                .buttonStyle(GoldButtonStyle())
            Button("Join with Code") { showJoin = true }
                .buttonStyle(OutlineButtonStyle())
        }
    }

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        guard let user = session.user else { return }
        do {
            let trips = try await APIClient.shared.trips(userId: user.id)
            errorMessage = nil
            session.trips = trips
            // Keep the stored active trip honest.
            if let active = session.activeTrip {
                if let match = trips.first(where: { $0.id == active.id }) {
                    session.setActiveTrip(match)
                } else {
                    session.clearActiveTrip()
                }
            }
            if session.activeTrip == nil, trips.count == 1 {
                session.setActiveTrip(trips[0])
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Card

struct TripCard: View {
    let trip: Trip
    let isActive: Bool

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 9) {
                    Text(trip.name)
                        .font(.serifTitle(21))
                        .foregroundStyle(Palette.navy)
                        .lineLimit(1)
                    if isActive {
                        Text("ACTIVE")
                            .font(.system(size: 10, weight: .bold))
                            .tracking(0.8)
                            .foregroundStyle(Palette.goldDark)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Palette.goldPale, in: Capsule())
                            .overlay(Capsule().stroke(Palette.goldLight, lineWidth: 1))
                    }
                }

                if !trip.subtitle.isEmpty {
                    Text(trip.subtitle)
                        .font(.system(size: 13, weight: .light))
                        .foregroundStyle(Palette.textLight)
                }

                HStack(spacing: 6) {
                    statChip(trip.memberCount ?? 0, "member")
                    statChip(trip.drinkCount ?? 0, "drink")
                    statChip(trip.ratingCount ?? 0, "rating")
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Palette.border)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(isActive ? Palette.gold : Palette.border, lineWidth: isActive ? 2 : 1)
        )
        .shadow(color: Palette.navy.opacity(0.06), radius: 4, y: 1)
    }

    private func statChip(_ count: Int, _ noun: String) -> some View {
        Text("\(count) \(noun)\(count == 1 ? "" : "s")")
            .font(.system(size: 11.5))
            .foregroundStyle(Palette.navyMid)
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .background(Palette.navy.opacity(0.06), in: Capsule())
    }
}

// MARK: - Create / edit

@MainActor
struct TripFormView: View {
    let trip: Trip?
    let onSaved: @MainActor () async -> Void

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var destination = ""
    @State private var hasDates = false
    @State private var startDate = Date()
    @State private var endDate = Date()
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var isEditing: Bool { trip != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("e.g. Amalfi 2026", text: $name)
                        .textInputAutocapitalization(.words)
                    TextField("Destination (optional)", text: $destination)
                        .textInputAutocapitalization(.words)
                }

                Section {
                    Toggle("Set dates", isOn: $hasDates.animation())
                    if hasDates {
                        DatePicker("From", selection: $startDate, displayedComponents: .date)
                        DatePicker("To", selection: $endDate, in: startDate..., displayedComponents: .date)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).font(.system(size: 13)).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Trip" : "New Trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEditing ? "Save" : "Create") { Task { await save() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).count < 2 || isSaving)
                }
            }
            .onAppear(perform: populate)
        }
    }

    private func populate() {
        guard let trip else { return }
        name = trip.name
        destination = trip.destination ?? ""
        if let start = Trip.parseDate(trip.startDate) {
            hasDates = true
            startDate = start
            endDate = Trip.parseDate(trip.endDate) ?? start
        }
    }

    private func save() async {
        guard let user = session.user else { return }
        isSaving = true
        defer { isSaving = false }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"

        let start = hasDates ? formatter.string(from: startDate) : nil
        let end = hasDates ? formatter.string(from: endDate) : nil
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        let trimmedDestination = destination.trimmingCharacters(in: .whitespaces)

        do {
            let saved: Trip
            if let trip {
                saved = try await APIClient.shared.updateTrip(
                    userId: user.id, tripId: trip.id, name: trimmedName,
                    destination: trimmedDestination.isEmpty ? nil : trimmedDestination,
                    startDate: start, endDate: end
                )
                if session.activeTrip?.id == saved.id { session.setActiveTrip(saved) }
                session.show("Trip updated")
            } else {
                saved = try await APIClient.shared.createTrip(
                    userId: user.id, name: trimmedName,
                    destination: trimmedDestination.isEmpty ? nil : trimmedDestination,
                    startDate: start, endDate: end
                )
                // A brand-new trip becomes the one you're rating on.
                session.setActiveTrip(saved)
                session.show("\(saved.name) is ready — happy sipping!")
            }
            await onSaved()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Join

@MainActor
struct JoinTripView: View {
    let onJoined: @MainActor () async -> Void

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var code = ""
    @State private var preview: Trip?
    @State private var isJoining = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("ABC123", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(size: 22, weight: .medium, design: .monospaced))
                        .kerning(4)
                        .multilineTextAlignment(.center)
                        .onChange(of: code) { _, newValue in
                            code = String(newValue.uppercased()
                                .filter { $0.isLetter || $0.isNumber }
                                .prefix(10))
                            Task { await lookUp() }
                        }
                } header: {
                    Text("Invite code")
                } footer: {
                    Text("Ask whoever set the trip up for its 6-character code.")
                }

                // Show what you're about to join before committing to it.
                if let preview {
                    Section {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(preview.name)
                                .font(.serifTitle(19))
                                .foregroundStyle(Palette.navy)
                            Text(previewSubtitle(preview))
                                .font(.system(size: 13, weight: .light))
                                .foregroundStyle(Palette.textLight)
                            if preview.role != nil {
                                Text("You're already on this trip.")
                                    .font(.system(size: 13, weight: .light))
                                    .foregroundStyle(Palette.goldDark)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).font(.system(size: 13)).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Join a Trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Join") { Task { await join() } }
                        .disabled(code.count < 4 || isJoining)
                }
            }
        }
    }

    private func previewSubtitle(_ trip: Trip) -> String {
        let members = trip.memberCount ?? 0
        let parts = [trip.subtitle, "\(members) member\(members == 1 ? "" : "s")"]
            .filter { !$0.isEmpty }
        return parts.joined(separator: " • ")
    }

    private func lookUp() async {
        guard let user = session.user, code.count >= 4 else {
            preview = nil
            return
        }
        preview = try? await APIClient.shared.previewTrip(code: code, userId: user.id)
    }

    private func join() async {
        guard let user = session.user else { return }
        isJoining = true
        defer { isJoining = false }
        do {
            let trip = try await APIClient.shared.joinTrip(userId: user.id, inviteCode: code)
            session.setActiveTrip(trip)
            session.show("You're on \(trip.name)!")
            await onJoined()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Detail

@MainActor
struct TripDetailView: View {
    let trip: Trip
    let onEdit: @MainActor (Trip) -> Void
    let onChanged: @MainActor () async -> Void

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var members: [TripMember] = []
    @State private var isLoading = true
    @State private var confirmLeave = false
    @State private var errorMessage: String?

    private var isActive: Bool { session.activeTrip?.id == trip.id }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(trip.name)
                            .font(.serifTitle(26))
                            .foregroundStyle(Palette.navy)
                        Text(trip.subtitle.isEmpty ? "No dates set" : trip.subtitle)
                            .font(.system(size: 13, weight: .light))
                            .foregroundStyle(Palette.textLight)
                    }
                    .padding(.vertical, 4)
                }

                if let code = trip.inviteCode {
                    Section {
                        HStack {
                            Text(code)
                                .font(.system(size: 22, weight: .medium, design: .monospaced))
                                .kerning(4)
                                .foregroundStyle(Palette.navy)
                            Spacer()
                            // Both need an explicit style, or the whole List
                            // row swallows the tap.
                            ShareLink(item: shareMessage(code: code)) {
                                Image(systemName: "square.and.arrow.up")
                            }
                            .buttonStyle(.borderless)
                            Button {
                                UIPasteboard.general.string = code
                                session.show("Invite code copied")
                            } label: {
                                Image(systemName: "doc.on.doc")
                            }
                            .buttonStyle(.borderless)
                        }
                    } header: {
                        Text("Invite code")
                    } footer: {
                        Text("Share this so others can join the trip.")
                    }
                }

                Section("Who's on this trip") {
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if let errorMessage {
                        Text(errorMessage).font(.system(size: 13)).foregroundStyle(.red)
                    } else {
                        ForEach(members) { member in
                            NavigationLink {
                                MemberReviewsView(member: member, trip: trip)
                            } label: {
                                HStack(spacing: 11) {
                                    AvatarView(name: member.name,
                                               colourHex: member.avatarColour,
                                               imageDataURL: member.avatarImage,
                                               size: 34)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(member.name + (member.id == session.user?.id ? " (you)" : ""))
                                            .font(.system(size: 15))
                                        Text(memberSubtitle(member))
                                            .font(.system(size: 12, weight: .light))
                                            .foregroundStyle(Palette.textLight)
                                    }
                                }
                            }
                        }
                    }
                }

                Section {
                    if !isActive {
                        Button("Make Active Trip") {
                            session.setActiveTrip(trip)
                            session.show("Now sipping on \(trip.name)")
                            dismiss()
                        }
                    }
                    if trip.isOwner {
                        Button("Edit Details") {
                            dismiss()
                            onEdit(trip)
                        }
                    }
                    Button(trip.isOwner ? "Delete Trip" : "Leave Trip", role: .destructive) {
                        confirmLeave = true
                    }
                }
            }
            .navigationTitle("Trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog(
                trip.isOwner ? "Delete \(trip.name)?" : "Leave \(trip.name)?",
                isPresented: $confirmLeave,
                titleVisibility: .visible
            ) {
                Button(trip.isOwner ? "Delete Trip" : "Leave Trip", role: .destructive) {
                    Task { await leave() }
                }
            } message: {
                Text(trip.isOwner
                     ? "Its ratings and posts go with it — drinks stay in the catalogue."
                     : "Your ratings on this trip stay with it.")
            }
            .task { await loadMembers() }
        }
    }

    private func shareMessage(code: String) -> String {
        "Join me on \(trip.name) in SipScore — use invite code \(code)."
    }

    private func memberSubtitle(_ member: TripMember) -> String {
        let count = member.ratingCount ?? 0
        let ratings = "\(count) rating\(count == 1 ? "" : "s")"
        return member.isOwner ? "\(ratings) • Organiser" : ratings
    }

    private func loadMembers() async {
        guard let user = session.user else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            members = try await APIClient.shared.trip(id: trip.id, userId: user.id).members ?? []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func leave() async {
        guard let user = session.user else { return }
        do {
            try await APIClient.shared.leaveTrip(userId: user.id, tripId: trip.id, delete: trip.isOwner)
            if session.activeTrip?.id == trip.id { session.clearActiveTrip() }
            session.show(trip.isOwner ? "Trip deleted" : "You left the trip")
            await onChanged()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - A member's reviews

/// What one person rated on this trip — the app's version of the web
/// user-reviews page.
@MainActor
struct MemberReviewsView: View {
    let member: TripMember
    let trip: Trip

    @State private var reviews: [Drink] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if isLoading {
                    ProgressView().padding(.vertical, 60)
                } else if let errorMessage {
                    EmptyStateView(title: "Could not load reviews",
                                   message: errorMessage,
                                   systemImage: "exclamationmark.triangle")
                } else if reviews.isEmpty {
                    EmptyStateView(
                        title: "No ratings yet",
                        message: "\(member.name) hasn't rated anything on \(trip.name).",
                        systemImage: "star"
                    )
                } else {
                    ForEach(reviews) { drink in
                        NavigationLink(value: drink) {
                            MemberReviewRow(drink: drink)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Palette.ivory)
        .navigationTitle("\(member.name)'s Ratings")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Drink.self) { drink in
            DrinkDetailView(drinkId: drink.id, drinkName: drink.name)
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            reviews = try await APIClient.shared.reviews(forUserId: member.id, tripId: trip.id)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct MemberReviewRow: View {
    let drink: Drink

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(drink.name)
                    .font(.serifTitle(17))
                    .foregroundStyle(Palette.navy)
                if !drink.meta.isEmpty {
                    Text(drink.meta)
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Palette.textLight)
                        .lineLimit(1)
                }
                if let notes = drink.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.system(size: 13, weight: .light))
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 4)
            StarsView(value: Double(drink.myStars ?? 0), size: 13)
        }
        .padding(13)
        .cardStyle()
    }
}
