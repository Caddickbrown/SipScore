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

/// The four main sections, matching the web app's bottom nav.
@MainActor
struct MainTabView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
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
