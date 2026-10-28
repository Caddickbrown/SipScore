import SwiftUI

/// Decides what the app shows: sign in, pick a trip, or the main tabs.
@MainActor
struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        ZStack {
            Palette.ivory.ignoresSafeArea()

            if !session.isSignedIn {
                LoginView()
            } else if session.activeTrip == nil {
                // Signed in but no holiday chosen — the trips screen doubles as
                // onboarding here, so it gets the whole window.
                NavigationStack {
                    TripsView(isChoosingFirstTrip: true)
                }
            } else {
                MainTabView()
            }
        }
        .overlay(alignment: .top) {
            if let toast = session.toast {
                ToastView(message: toast)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: toast) {
                        try? await Task.sleep(for: .seconds(2.6))
                        withAnimation { session.toast = nil }
                    }
            }
        }
        .animation(.snappy, value: session.toast)
        .animation(.default, value: session.isSignedIn)
        .animation(.default, value: session.activeTrip?.id)
    }
}

struct ToastView: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Palette.goldLight)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Palette.navy, in: Capsule())
            .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
            .padding(.horizontal, 24)
    }
}

/// The four main sections, matching the web app's bottom nav. At regular
/// width they move into a sidebar that folds to a strip.
@MainActor
struct MainTabView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.horizontalSizeClass) private var hSize

    @State private var section: MainSection = .drinks
    /// The regular-width sidebar folded to a strip; remembered across launches.
    @AppStorage("sidebarCollapsed") private var sidebarCollapsed = false
    @State private var showAdd = false
    /// The drink open beside Rankings when there is room for both.
    @State private var rankedDrink: Drink?

    /// The content column (window less the sidebar) needs this much before a
    /// drink's detail sits beside Rankings rather than being pushed over it.
    private static let splitMinWidth: CGFloat = 700
    private static let listWidth: CGFloat = 380

    var body: some View {
        if hSize == .regular {
            sidebarShell
                .task {
                    await session.refreshTrips()
                }
        } else {
            tabs
        }
    }

    /// Compact width: the system tab bar, unchanged.
    private var tabs: some View {
        TabView {
            NavigationStack { DrinksView() }
                .tabItem { Label("Drinks", systemImage: "wineglass") }

            NavigationStack { LeaderboardView() }
                .tabItem { Label("Rankings", systemImage: "trophy") }

            NavigationStack { FeedView() }
                .tabItem { Label("Feed", systemImage: "bubble.left.and.bubble.right") }

            NavigationStack { TripsView() }
                .tabItem { Label("Trips", systemImage: "suitcase") }
        }
        .task {
            await session.refreshTrips()
        }
    }

    private var sidebarShell: some View {
        HStack(spacing: 0) {
            if sidebarCollapsed {
                SipSideRail(onAdd: { showAdd = true },
                            onExpand: { withAnimation(.easeInOut(duration: 0.2)) { sidebarCollapsed = false } })
            } else {
                SipSideBar(section: $section,
                           onAdd: { showAdd = true },
                           onCollapse: { withAnimation(.easeInOut(duration: 0.2)) { sidebarCollapsed = true } })
            }
            rule
            GeometryReader { geo in
                content(split: geo.size.width >= Self.splitMinWidth)
            }
        }
        .background(Palette.ivory)
        // The same sheet as the Drinks screen's leading "+".
        .sheet(isPresented: $showAdd) {
            AddDrinkView {
                NotificationCenter.default.post(name: .sipScoreDrinkAdded, object: nil)
            }
        }
    }

    @ViewBuilder
    private func content(split: Bool) -> some View {
        switch section {
        case .drinks:
            NavigationStack { DrinksView() }
        case .rankings:
            if split {
                HStack(spacing: 0) {
                    NavigationStack {
                        LeaderboardView(onSelect: { rankedDrink = $0 }, selectedId: rankedDrink?.id)
                    }
                    .frame(width: Self.listWidth)
                    rule
                    NavigationStack { rankedDetail }
                }
            } else {
                NavigationStack { LeaderboardView() }
            }
        case .feed:
            NavigationStack { FeedView() }
        case .trips:
            NavigationStack { TripsView() }
        }
    }

    @ViewBuilder
    private var rankedDetail: some View {
        if let drink = rankedDrink {
            DrinkDetailView(drinkId: drink.id, drinkName: drink.name)
                .id(drink.id)
        } else {
            EmptyStateView(title: "Choose a drink",
                           message: "Pick one from the rankings to see its ratings here.",
                           systemImage: "trophy")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.ivory)
        }
    }

    private var rule: some View {
        Rectangle().fill(Palette.border).frame(width: 1).ignoresSafeArea().accessibilityHidden(true)
    }
}

/// Toolbar item showing the active trip; tapping it opens the profile sheet.
struct TripToolbarLabel: ToolbarContent {
    let tripName: String
    @Binding var showProfile: Bool
    let user: User?

    var body: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Text(tripName)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Palette.textLight)
                .lineLimit(1)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showProfile = true
            } label: {
                AvatarView(
                    name: user?.name ?? "?",
                    colourHex: user?.avatarColour,
                    imageDataURL: user?.avatarImage,
                    size: 30
                )
            }
            .accessibilityLabel("Profile")
        }
    }
}
