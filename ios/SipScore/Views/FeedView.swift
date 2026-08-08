import SwiftUI

/// The trip's shared feed — posts, likes and replies, all scoped to the
/// holiday you're on.
@MainActor
struct FeedView: View {
    @Environment(SessionStore.self) private var session

    @State private var posts: [FeedPost] = []
    @State private var draft = ""
    @State private var isLoading = true
    @State private var isPosting = false
    @State private var errorMessage: String?
    @State private var openPost: FeedPost?
    @State private var showProfile = false
    @FocusState private var composeFocused: Bool

    private let maxLength = 500

    var body: some View {
        VStack(spacing: 0) {
            composer

            Group {
                if isLoading && posts.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage {
                    EmptyStateView(title: "Could not load the feed",
                                   message: errorMessage,
                                   systemImage: "exclamationmark.triangle")
                } else if posts.isEmpty {
                    EmptyStateView(
                        title: "Nothing posted yet",
                        message: "Share what you're drinking on \(session.activeTrip?.name ?? "this trip").",
                        systemImage: "bubble.left.and.bubble.right"
                    )
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(posts) { post in
                                FeedPostRow(
                                    post: post,
                                    isMine: post.userId == session.user?.id,
                                    onLike: { await toggleLike(post) },
                                    onOpen: { openPost = post },
                                    onDelete: { await delete(post) }
                                )
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
        .navigationTitle("Feed")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            TripToolbarLabel(tripName: session.activeTrip?.name ?? "",
                             showProfile: $showProfile,
                             user: session.user)
        }
        .sheet(isPresented: $showProfile) { ProfileView() }
        .sheet(item: $openPost) { post in
            PostRepliesView(post: post) { await load() }
        }
        .refreshable { await load() }
        .task(id: session.activeTrip?.id) { await load() }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                AvatarView(name: session.user?.name ?? "?",
                           colourHex: session.user?.avatarColour,
                           imageDataURL: session.user?.avatarImage,
                           size: 34)

                TextField("Share your thoughts and comments…", text: $draft, axis: .vertical)
                    .font(.system(size: 15))
                    .lineLimit(1...5)
                    .focused($composeFocused)
                    .onChange(of: draft) { _, newValue in
                        if newValue.count > maxLength { draft = String(newValue.prefix(maxLength)) }
                    }
            }

            HStack {
                Text("\(maxLength - draft.count)")
                    .font(.system(size: 12))
                    .foregroundStyle(draft.count > maxLength - 50 ? .orange : Palette.textLight)
                Spacer()
                Button {
                    Task { await post() }
                } label: {
                    if isPosting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Post").font(.system(size: 14, weight: .semibold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.gold)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isPosting)
            }
        }
        .padding(14)
        .background(Color.white)
        .overlay(alignment: .bottom) { Divider() }
    }

    // MARK: Actions

    private func load() async {
        guard let user = session.user, let trip = session.activeTrip else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            posts = try await APIClient.shared.feed(userId: user.id, tripId: trip.id)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func post() async {
        guard let user = session.user, let trip = session.activeTrip else { return }
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        isPosting = true
        defer { isPosting = false }
        do {
            try await APIClient.shared.createPost(userId: user.id, tripId: trip.id, content: content)
            draft = ""
            composeFocused = false
            await load()
            session.show("Posted!")
        } catch {
            session.show(error.localizedDescription)
        }
    }

    private func toggleLike(_ post: FeedPost) async {
        guard let user = session.user else { return }
        do {
            let response = try await APIClient.shared.toggleLike(userId: user.id, postId: post.id)
            if let index = posts.firstIndex(where: { $0.id == post.id }) {
                posts[index].likedByViewer = response.liked
                posts[index].likeCount = response.likeCount
            }
        } catch {
            session.show(error.localizedDescription)
        }
    }

    private func delete(_ post: FeedPost) async {
        guard let user = session.user else { return }
        do {
            try await APIClient.shared.deletePost(userId: user.id, postId: post.id)
            posts.removeAll { $0.id == post.id }
        } catch {
            session.show(error.localizedDescription)
        }
    }
}

// MARK: - Post row

@MainActor
struct FeedPostRow: View {
    let post: FeedPost
    let isMine: Bool
    let onLike: @MainActor () async -> Void
    let onOpen: @MainActor () -> Void
    let onDelete: @MainActor () async -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            AvatarView(name: post.userName ?? "?",
                       colourHex: post.avatarColour,
                       imageDataURL: post.avatarImage,
                       size: 38)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(post.userName ?? "Someone")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Palette.navy)
                    Text(RelativeTime.string(from: post.createdAt))
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Palette.textLight)
                    Spacer()
                    if isMine {
                        Menu {
                            Button("Delete", role: .destructive) { Task { await onDelete() } }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 13))
                                .foregroundStyle(Palette.textLight)
                                .frame(width: 28, height: 22)
                        }
                    }
                }

                Text(post.content)
                    .font(.system(size: 15, weight: .light))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 18) {
                    Button {
                        Task { await onLike() }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: (post.likedByViewer ?? false) ? "heart.fill" : "heart")
                            Text("\(post.likeCount ?? 0)")
                        }
                        .font(.system(size: 13))
                        .foregroundStyle((post.likedByViewer ?? false) ? Color(hex: 0xC4526C) : Palette.textLight)
                    }
                    .buttonStyle(.plain)

                    Button(action: onOpen) {
                        HStack(spacing: 5) {
                            Image(systemName: "bubble.right")
                            Text("\(post.replyCount ?? 0)")
                        }
                        .font(.system(size: 13))
                        .foregroundStyle(Palette.textLight)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 2)
            }
        }
        .padding(14)
        .cardStyle()
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
    }
}

// MARK: - Replies

@MainActor
struct PostRepliesView: View {
    let post: FeedPost
    let onChanged: @MainActor () async -> Void

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var replies: [FeedReply] = []
    @State private var draft = ""
    @State private var replyingTo: FeedReply?
    @State private var isLoading = true
    @State private var isSending = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        // The post being replied to.
                        HStack(alignment: .top, spacing: 11) {
                            AvatarView(name: post.userName ?? "?",
                                       colourHex: post.avatarColour,
                                       imageDataURL: post.avatarImage,
                                       size: 38)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(post.userName ?? "Someone")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Palette.navy)
                                Text(post.content)
                                    .font(.system(size: 15, weight: .light))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(14)
                        .cardStyle()

                        if isLoading {
                            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else if replies.isEmpty {
                            Text("No replies yet.")
                                .font(.system(size: 14, weight: .light))
                                .foregroundStyle(Palette.textLight)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 24)
                        } else {
                            ForEach(topLevel) { reply in
                                ReplyRow(reply: reply,
                                         isMine: reply.userId == session.user?.id,
                                         onLike: { await toggleLike(reply) },
                                         onReply: { replyingTo = reply },
                                         onDelete: { await delete(reply) })

                                ForEach(children(of: reply)) { child in
                                    ReplyRow(reply: child,
                                             isMine: child.userId == session.user?.id,
                                             onLike: { await toggleLike(child) },
                                             onReply: { replyingTo = reply },
                                             onDelete: { await delete(child) })
                                        .padding(.leading, 30)
                                }
                            }
                        }
                    }
                    .padding(16)
                }
                .background(Palette.ivory)

                composer
            }
            .navigationTitle("Replies")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private var topLevel: [FeedReply] { replies.filter { $0.parentReplyId == nil } }
    private func children(of reply: FeedReply) -> [FeedReply] {
        replies.filter { $0.parentReplyId == reply.id }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if let replyingTo {
                HStack {
                    Text("Replying to \(replyingTo.userName ?? "someone")")
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Palette.textLight)
                    Spacer()
                    Button("Cancel") { self.replyingTo = nil }
                        .font(.system(size: 12))
                }
            }
            HStack(spacing: 10) {
                TextField("Add a reply…", text: $draft, axis: .vertical)
                    .font(.system(size: 15))
                    .lineLimit(1...4)
                    .onChange(of: draft) { _, newValue in
                        if newValue.count > 280 { draft = String(newValue.prefix(280)) }
                    }
                Button {
                    Task { await send() }
                } label: {
                    if isSending {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up.circle.fill").font(.system(size: 27))
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.gold)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
            }
        }
        .padding(14)
        .background(Color.white)
        .overlay(alignment: .top) { Divider() }
    }

    private func load() async {
        guard let user = session.user else { return }
        isLoading = true
        defer { isLoading = false }
        replies = (try? await APIClient.shared.replies(postId: post.id, viewerId: user.id)) ?? []
    }

    private func send() async {
        guard let user = session.user else { return }
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        isSending = true
        defer { isSending = false }
        do {
            try await APIClient.shared.createReply(userId: user.id, postId: post.id,
                                                   parentReplyId: replyingTo?.id, content: content)
            draft = ""
            replyingTo = nil
            await load()
            await onChanged()
        } catch {
            session.show(error.localizedDescription)
        }
    }

    private func toggleLike(_ reply: FeedReply) async {
        guard let user = session.user else { return }
        do {
            let response = try await APIClient.shared.toggleReplyLike(userId: user.id, replyId: reply.id)
            if let index = replies.firstIndex(where: { $0.id == reply.id }) {
                replies[index].likedByViewer = response.liked
                replies[index].likeCount = response.likeCount
            }
        } catch {
            session.show(error.localizedDescription)
        }
    }

    private func delete(_ reply: FeedReply) async {
        guard let user = session.user else { return }
        do {
            try await APIClient.shared.deleteReply(userId: user.id, replyId: reply.id)
            await load()
            await onChanged()
        } catch {
            session.show(error.localizedDescription)
        }
    }
}

@MainActor
struct ReplyRow: View {
    let reply: FeedReply
    let isMine: Bool
    let onLike: @MainActor () async -> Void
    let onReply: @MainActor () -> Void
    let onDelete: @MainActor () async -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(name: reply.userName ?? "?",
                       colourHex: reply.avatarColour,
                       imageDataURL: reply.avatarImage,
                       size: 30)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(reply.userName ?? "Someone")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.navy)
                    Text(RelativeTime.string(from: reply.createdAt))
                        .font(.system(size: 11, weight: .light))
                        .foregroundStyle(Palette.textLight)
                    Spacer()
                    if isMine {
                        Menu {
                            Button("Delete", role: .destructive) { Task { await onDelete() } }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 12))
                                .foregroundStyle(Palette.textLight)
                                .frame(width: 26, height: 20)
                        }
                    }
                }

                Text(reply.content)
                    .font(.system(size: 14, weight: .light))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 16) {
                    Button {
                        Task { await onLike() }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: (reply.likedByViewer ?? false) ? "heart.fill" : "heart")
                            Text("\(reply.likeCount ?? 0)")
                        }
                        .font(.system(size: 12))
                        .foregroundStyle((reply.likedByViewer ?? false) ? Color(hex: 0xC4526C) : Palette.textLight)
                    }
                    .buttonStyle(.plain)

                    Button("Reply", action: onReply)
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.textLight)
                        .buttonStyle(.plain)
                }
            }
        }
        .padding(12)
        .cardStyle()
    }
}

// MARK: - Timestamps

enum RelativeTime {
    private static let formatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

    static func string(from raw: String?) -> String {
        guard let raw else { return "" }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        guard let date else { return "" }
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
