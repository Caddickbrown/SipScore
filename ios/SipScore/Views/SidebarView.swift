import SwiftUI

// MARK: - Regular-width navigation
//
// At regular width (iPad, an opened-out iPhone) the four sections leave the
// bottom tab bar for a white sidebar with a gold selection, the leading "+"
// under them and the active trip at the foot. It folds to a 52pt strip that
// keeps the toggle and "+"; the choice is remembered. Compact width keeps the
// system TabView.

/// The four main sections, in tab-bar order.
enum MainSection: String, CaseIterable, Identifiable {
    case drinks, rankings, feed, trips

    var id: String { rawValue }

    var title: String {
        switch self {
        case .drinks:   "Drinks"
        case .rankings: "Rankings"
        case .feed:     "Feed"
        case .trips:    "Trips"
        }
    }

    var systemImage: String {
        switch self {
        case .drinks:   "wineglass"
        case .rankings: "trophy"
        case .feed:     "bubble.left.and.bubble.right"
        case .trips:    "suitcase"
        }
    }
}

extension Notification.Name {
    /// Posted when a drink is added from the sidebar's "+", so an open Drinks
    /// list can reload the way its own "+" does.
    static let sipScoreDrinkAdded = Notification.Name("sipScoreDrinkAdded")
}

/// The sidebar at full width.
@MainActor
struct SipSideBar: View {
    @Environment(SessionStore.self) private var session
    @Binding var section: MainSection
    var onAdd: () -> Void
    var onCollapse: () -> Void

    @State private var members: [TripMember] = []

    static let width: CGFloat = 180

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 0) {
                Text("SipScore")
                    .font(.serifTitle(22))
                    .foregroundStyle(Palette.navy)
                Spacer(minLength: 0)
                SipSidebarToggle(label: "Hide sidebar", action: onCollapse)
            }
            .padding(.bottom, 12)

            ForEach(MainSection.allCases) { item($0) }

            Button(action: onAdd) {
                HStack(spacing: 8) {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 22)
                    Text("Add drink")
                        .font(.system(size: 15, weight: .medium))
                }
                .foregroundStyle(Palette.goldDark)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 8)
            .accessibilityLabel("Add a drink")

            Spacer(minLength: 0)

            if let trip = session.activeTrip {
                Rectangle().fill(Palette.border).frame(height: 1)
                tripFoot(trip)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .frame(width: Self.width, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.white.ignoresSafeArea())
        .task(id: session.activeTrip?.id) { await loadMembers() }
    }

    private func item(_ target: MainSection) -> some View {
        let on = section == target
        return Button { section = target } label: {
            HStack(spacing: 8) {
                Image(systemName: target.systemImage)
                    .font(.system(size: 15, weight: on ? .semibold : .regular))
                    .frame(width: 22)
                Text(target.title)
                    .font(.system(size: 15, weight: on ? .semibold : .regular))
                    .lineLimit(1)
            }
            .foregroundStyle(on ? Palette.goldDark : Palette.navy)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(on ? Palette.goldPale : .clear,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// The trip being rated on, and who is on it; tapping it opens Trips.
    private func tripFoot(_ trip: Trip) -> some View {
        Button { section = .trips } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(trip.name)
                    .font(.serifTitle(16))
                    .foregroundStyle(Palette.navy)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if !members.isEmpty {
                    HStack(spacing: -6) {
                        ForEach(members.prefix(5)) { member in
                            AvatarView(name: member.name,
                                       colourHex: member.avatarColour,
                                       imageDataURL: member.avatarImage,
                                       size: 24)
                                .overlay(Circle().stroke(Color.white, lineWidth: 1.5))
                        }
                        if members.count > 5 {
                            Text("+\(members.count - 5)")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Palette.textLight)
                                .padding(.leading, 10)
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(members.count) member\(members.count == 1 ? "" : "s")")
                }
            }
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func loadMembers() async {
        guard let user = session.user, let trip = session.activeTrip else {
            members = []
            return
        }
        // The avatars are a nicety: on failure the foot shows just the name.
        members = (try? await APIClient.shared.trip(id: trip.id, userId: user.id).members) ?? []
    }
}

/// The sidebar folded: the toggle and "+".
struct SipSideRail: View {
    var onAdd: () -> Void
    var onExpand: () -> Void

    static let width: CGFloat = 52

    var body: some View {
        VStack(spacing: 6) {
            SipSidebarToggle(label: "Show sidebar", action: onExpand)
            Button(action: onAdd) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Palette.goldDark)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add a drink")
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
        .frame(width: Self.width)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.white.ignoresSafeArea())
    }
}

/// The system's sidebar glyph; ⌃⌘S, the standard Toggle Sidebar keys, works
/// from a keyboard.
struct SipSidebarToggle: View {
    let label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "sidebar.left")
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(Palette.textLight)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .keyboardShortcut("s", modifiers: [.command, .control])
        .accessibilityLabel(label)
    }
}
