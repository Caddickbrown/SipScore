import Foundation
import Observation

/// Holds who is signed in and which trip they're rating on — the two pieces of
/// state nearly every screen needs. Mirrors the localStorage keys the web app
/// uses (`sipscore_user` / `sipscore_trip`).
@MainActor
@Observable
final class SessionStore {
    private enum Keys {
        static let user = "sipscore.user"
        static let trip = "sipscore.activeTrip"
    }

    private(set) var user: User?
    private(set) var activeTrip: Trip?
    var trips: [Trip] = []

    /// Surfaced as a banner by RootView; set by any screen that wants to
    /// report something without owning its own alert.
    var toast: String?

    var isSignedIn: Bool { user != nil }

    init() {
        user = Keychain.load(User.self, for: Keys.user)
        activeTrip = Keychain.load(Trip.self, for: Keys.trip)
    }

    // MARK: Auth

    func signIn(user: User, trips: [Trip]) {
        self.user = user
        self.trips = trips
        Keychain.store(user, for: Keys.user)

        // One trip is unambiguous, so drop straight into it; otherwise let the
        // user choose on the Trips tab.
        if trips.count == 1 {
            setActiveTrip(trips[0])
        } else if let active = activeTrip, !trips.contains(where: { $0.id == active.id }) {
            clearActiveTrip()
        }
    }

    func signOut() {
        user = nil
        trips = []
        activeTrip = nil
        Keychain.remove(Keys.user)
        Keychain.remove(Keys.trip)
    }

    func update(user: User) {
        self.user = user
        Keychain.store(user, for: Keys.user)
    }

    // MARK: Trips

    func setActiveTrip(_ trip: Trip) {
        activeTrip = trip
        Keychain.store(trip, for: Keys.trip)
    }

    func clearActiveTrip() {
        activeTrip = nil
        Keychain.remove(Keys.trip)
    }

    /// Refreshes the trip list and keeps the active trip consistent with it:
    /// drop it if we've been removed, and auto-select when there's only one.
    func refreshTrips() async {
        guard let user else { return }
        do {
            let fresh = try await APIClient.shared.trips(userId: user.id)
            trips = fresh
            if let active = activeTrip {
                if let match = fresh.first(where: { $0.id == active.id }) {
                    setActiveTrip(match)
                } else {
                    clearActiveTrip()
                }
            }
            if activeTrip == nil, fresh.count == 1 {
                setActiveTrip(fresh[0])
            }
        } catch {
            // Leave the cached list in place — the trips screen surfaces errors.
        }
    }

    func show(_ message: String) {
        toast = message
    }
}
