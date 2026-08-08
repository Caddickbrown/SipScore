import SwiftUI

@main
struct SipScoreApp: App {
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .tint(Palette.gold)
        }
    }
}
