import SwiftUI
import PhotosUI
import UIKit

/// Your profile: avatar, stats for the active trip, server address and sign out.
@MainActor
struct ProfileView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var photoItem: PhotosPickerItem?
    @State private var isUploading = false
    @State private var stats: User?
    @State private var errorMessage: String?
    @State private var serverOverride = AppConfig.baseURLOverride
    @State private var confirmSignOut = false
    @State private var showNewTrip = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        ZStack(alignment: .bottomTrailing) {
                            AvatarView(name: session.user?.name ?? "?",
                                       colourHex: session.user?.avatarColour,
                                       imageDataURL: session.user?.avatarImage,
                                       size: 68)
                            if isUploading {
                                ProgressView().controlSize(.small)
                            } else {
                                PhotosPicker(selection: $photoItem, matching: .images) {
                                    Image(systemName: "camera.fill")
                                        .font(.system(size: 11))
                                        .foregroundStyle(.white)
                                        .padding(6)
                                        .background(Palette.gold, in: Circle())
                                        .overlay(Circle().stroke(.white, lineWidth: 2))
                                }
                            }
                        }

                        VStack(alignment: .leading, spacing: 3) {
                            Text(session.user?.name ?? "")
                                .font(.serifTitle(22))
                                .foregroundStyle(Palette.navy)
                            Text(statsLine)
                                .font(.system(size: 13, weight: .light))
                                .foregroundStyle(Palette.textLight)
                        }
                    }
                    .padding(.vertical, 6)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).font(.system(size: 13)).foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        showNewTrip = true
                    } label: {
                        Label("New Trip", systemImage: "suitcase.fill")
                    }
                } footer: {
                    Text("Starting a trip makes it the one you're rating on.")
                }

                Section {
                    TextField(AppConfig.defaultBaseURL, text: $serverOverride)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onSubmit { AppConfig.baseURLOverride = serverOverride }
                    if serverOverride != AppConfig.baseURLOverride {
                        Button("Save server address") {
                            AppConfig.baseURLOverride = serverOverride
                            session.show("Server updated")
                        }
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text("Leave empty to use the default deployment. Handy for pointing a debug build at a preview URL.")
                }

                Section {
                    Button("Sign Out", role: .destructive) { confirmSignOut = true }
                }
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog("Sign out of SipScore?", isPresented: $confirmSignOut,
                                titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    session.signOut()
                    dismiss()
                }
            }
            .sheet(isPresented: $showNewTrip) {
                TripFormView(trip: nil) {
                    await session.refreshTrips()
                    // The new trip is now active, so the stats below it are stale.
                    await loadStats()
                }
            }
            .onChange(of: photoItem) { _, newValue in
                guard let newValue else { return }
                Task { await upload(newValue) }
            }
            .task { await loadStats() }
        }
    }

    private var statsLine: String {
        let count = stats?.ratingCount ?? 0
        let drinks = "\(count) drink\(count == 1 ? "" : "s") rated"
        if let trip = session.activeTrip { return "\(drinks) on \(trip.name)" }
        return drinks
    }

    private func loadStats() async {
        guard let user = session.user else { return }
        stats = try? await APIClient.shared.profile(userId: user.id, tripId: session.activeTrip?.id)
    }

    /// The API stores avatars as small base64 data URLs, so downscale hard
    /// before uploading — it caps the payload at ~200KB.
    private func upload(_ item: PhotosPickerItem) async {
        guard let user = session.user else { return }
        isUploading = true
        defer { isUploading = false; photoItem = nil }

        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data),
                  let dataURL = Self.squareDataURL(from: image) else {
                errorMessage = "Could not read that image"
                return
            }
            let updated = try await APIClient.shared.updateAvatar(userId: user.id, dataURL: dataURL)
            var refreshed = user
            refreshed.avatarImage = updated.avatarImage
            refreshed.avatarColour = updated.avatarColour
            session.update(user: refreshed)
            session.show("Avatar updated!")
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Centre-crops to a square, scales to 100pt and returns a JPEG data URL,
    /// matching what the web app's cropper produces.
    static func squareDataURL(from image: UIImage, side: CGFloat = 100) -> String? {
        let size = min(image.size.width, image.size.height)
        let origin = CGPoint(x: (image.size.width - size) / 2, y: (image.size.height - size) / 2)

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side),
                                               format: {
                                                   let format = UIGraphicsImageRendererFormat.default()
                                                   format.scale = 1
                                                   return format
                                               }())
        let square = renderer.image { _ in
            image.draw(in: CGRect(x: -origin.x * side / size,
                                  y: -origin.y * side / size,
                                  width: image.size.width * side / size,
                                  height: image.size.height * side / size))
        }

        guard let jpeg = square.jpegData(compressionQuality: 0.82) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }
}
