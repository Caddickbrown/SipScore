import Foundation

// MARK: - Configuration

enum AppConfig {
    /// Where the SipScore API lives. Set `SIPSCORE_API_BASE_URL` in the target's
    /// build settings (it is copied into Info.plist), or override it at runtime
    /// from Profile → Server, which is handy for pointing a debug build at a
    /// preview deployment.
    static let defaultBaseURL = "https://sipscore.vercel.app"

    private static let overrideKey = "sipscore.api.baseURL"

    static var baseURL: URL {
        if let override = UserDefaults.standard.string(forKey: overrideKey),
           let url = URL(string: override), !override.isEmpty {
            return url
        }
        let configured = Bundle.main.object(forInfoDictionaryKey: "SIPSCORE_API_BASE_URL") as? String
        let raw = (configured?.isEmpty == false ? configured! : defaultBaseURL)
        return URL(string: raw) ?? URL(string: defaultBaseURL)!
    }

    static var baseURLOverride: String {
        get { UserDefaults.standard.string(forKey: overrideKey) ?? "" }
        set {
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                UserDefaults.standard.removeObject(forKey: overrideKey)
            } else {
                UserDefaults.standard.set(trimmed, forKey: overrideKey)
            }
        }
    }
}

// MARK: - Errors

enum APIError: LocalizedError, Equatable {
    case server(String)
    case notFound(String)
    case transport(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .server(let message), .notFound(let message):
            return message
        case .transport(let message):
            return message
        case .decoding(let message):
            return "Unexpected response from the server (\(message))"
        }
    }

    /// The web app keys its "offer to register" flow off this message.
    var isNoProfileFound: Bool {
        if case .notFound(let message) = self {
            return message.lowercased().contains("no profile found")
        }
        return false
    }
}

// MARK: - Client

/// Thin wrapper over the SipScore HTTP API. Every trip-scoped call takes an
/// explicit `tripId` so the caller can't forget which holiday it is writing to.
struct APIClient {
    static let shared = APIClient()

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    private var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }

    // MARK: Request plumbing

    private func makeURL(_ path: String, query: [String: String?]) throws -> URL {
        guard var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.transport("Invalid server address")
        }
        let items = query.compactMap { key, value -> URLQueryItem? in
            guard let value, !value.isEmpty else { return nil }
            return URLQueryItem(name: key, value: value)
        }
        components.queryItems = items.isEmpty ? nil : items.sorted { $0.name < $1.name }
        guard let url = components.url else {
            throw APIError.transport("Invalid server address")
        }
        return url
    }

    private func perform<Response: Decodable>(
        _ request: URLRequest,
        as type: Response.Type
    ) async throws -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard (200..<300).contains(status) else {
            let message = (try? decoder.decode(ErrorPayload.self, from: data))?.error
                ?? "Request failed (\(status))"
            throw status == 404 ? APIError.notFound(message) : APIError.server(message)
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    private func get<Response: Decodable>(
        _ path: String,
        query: [String: String?] = [:],
        as type: Response.Type
    ) async throws -> Response {
        var request = URLRequest(url: try makeURL(path, query: query))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await perform(request, as: type)
    }

    private func send<Body: Encodable, Response: Decodable>(
        _ method: String,
        _ path: String,
        body: Body,
        query: [String: String?] = [:],
        as type: Response.Type
    ) async throws -> Response {
        var request = URLRequest(url: try makeURL(path, query: query))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try encoder.encode(body)
        return try await perform(request, as: type)
    }

    private struct ErrorPayload: Decodable {
        let error: String
    }

    // MARK: Auth

    func login(name: String, pin: String) async throws -> AuthResponse {
        try await send("POST", "api/auth",
                       body: AuthRequest(action: "login", name: name, pin: pin),
                       as: AuthResponse.self)
    }

    func register(name: String, pin: String) async throws -> AuthResponse {
        try await send("POST", "api/auth",
                       body: AuthRequest(action: "register", name: name, pin: pin),
                       as: AuthResponse.self)
    }

    // MARK: Trips

    func trips(userId: Int) async throws -> [Trip] {
        try await get("api/trips",
                      query: ["user_id": String(userId)],
                      as: TripsResponse.self).trips ?? []
    }

    func trip(id: Int, userId: Int) async throws -> TripDetailResponse {
        try await get("api/trips",
                      query: ["id": String(id), "user_id": String(userId)],
                      as: TripDetailResponse.self)
    }

    /// Looks a trip up by invite code without joining it.
    func previewTrip(code: String, userId: Int) async throws -> Trip {
        let response: TripResponse = try await get(
            "api/trips",
            query: ["code": code, "user_id": String(userId)],
            as: TripResponse.self
        )
        guard let trip = response.trip else { throw APIError.notFound("No trip found with that code") }
        return trip
    }

    func createTrip(userId: Int, name: String, destination: String?,
                    startDate: String?, endDate: String?) async throws -> Trip {
        let body = TripWriteRequest(action: "create", userId: userId, tripId: nil,
                                    name: name, destination: destination,
                                    startDate: startDate, endDate: endDate, inviteCode: nil)
        let response = try await send("POST", "api/trips", body: body, as: TripResponse.self)
        guard let trip = response.trip else { throw APIError.server("Could not create the trip") }
        return trip
    }

    func updateTrip(userId: Int, tripId: Int, name: String, destination: String?,
                    startDate: String?, endDate: String?) async throws -> Trip {
        let body = TripWriteRequest(action: nil, userId: userId, tripId: tripId,
                                    name: name, destination: destination,
                                    startDate: startDate, endDate: endDate, inviteCode: nil)
        let response = try await send("PATCH", "api/trips", body: body, as: TripResponse.self)
        guard let trip = response.trip else { throw APIError.server("Could not save the trip") }
        return trip
    }

    func joinTrip(userId: Int, inviteCode: String) async throws -> Trip {
        let body = TripWriteRequest(action: "join", userId: userId, tripId: nil,
                                    name: nil, destination: nil,
                                    startDate: nil, endDate: nil, inviteCode: inviteCode)
        let response = try await send("POST", "api/trips", body: body, as: TripResponse.self)
        guard let trip = response.trip else { throw APIError.server("Could not join the trip") }
        return trip
    }

    /// `delete: true` removes the trip entirely (owner only); otherwise the
    /// caller just leaves it.
    func leaveTrip(userId: Int, tripId: Int, delete: Bool) async throws {
        _ = try await send("DELETE", "api/trips",
                           body: LeaveTripRequest(userId: userId, tripId: tripId,
                                                  action: delete ? "delete" : "leave"),
                           as: SuccessResponse.self)
    }

    // MARK: Drinks

    func drinks(userId: Int, tripId: Int, scope: DrinkScope,
                search: String, category: DrinkCategory?, type: String?) async throws -> [Drink] {
        try await get("api/drinks", query: [
            "user_id": String(userId),
            "trip_id": String(tripId),
            "scope": scope.rawValue,
            "search": search,
            "category": category?.rawValue,
            "type": type,
        ], as: DrinksResponse.self).drinks ?? []
    }

    func drink(id: Int, userId: Int, tripId: Int) async throws -> DrinkDetailResponse {
        try await get("api/drink", query: [
            "id": String(id),
            "user_id": String(userId),
            "trip_id": String(tripId),
        ], as: DrinkDetailResponse.self)
    }

    func addDrink(userId: Int, tripId: Int, name: String, category: DrinkCategory,
                  type: String?, varietal: String?, style: String?, source: String?) async throws -> Drink {
        let body = AddDrinkRequest(userId: userId, tripId: tripId, name: name,
                                   category: category.rawValue, type: type,
                                   varietal: varietal, style: style, source: source)
        let response = try await send("POST", "api/drinks", body: body, as: DrinkResponse.self)
        guard let drink = response.drink else { throw APIError.server("Could not add the drink") }
        return drink
    }

    // MARK: Ratings

    func saveRating(userId: Int, tripId: Int, drinkId: Int,
                    stars: Int, notes: String?) async throws {
        _ = try await send("POST", "api/ratings",
                           body: SaveRatingRequest(userId: userId, tripId: tripId,
                                                   drinkId: drinkId, stars: stars, notes: notes),
                           as: SaveRatingResponse.self)
    }

    func deleteRating(userId: Int, tripId: Int, drinkId: Int) async throws {
        _ = try await send("DELETE", "api/ratings",
                           body: DeleteRatingRequest(userId: userId, tripId: tripId, drinkId: drinkId),
                           as: SuccessResponse.self)
    }

    // MARK: Rankings

    func leaderboard(type: LeaderboardKind, userId: Int, tripId: Int,
                     category: DrinkCategory?) async throws -> [Drink] {
        try await get("api/leaderboard", query: [
            "type": type.rawValue,
            "user_id": String(userId),
            "trip_id": String(tripId),
            "category": category?.rawValue,
        ], as: LeaderboardResponse.self).leaderboard ?? []
    }

    /// Someone else's ratings on this trip.
    func reviews(forUserId profileUserId: Int, tripId: Int) async throws -> [Drink] {
        try await get("api/leaderboard", query: [
            "type": "personal",
            "user_id": String(profileUserId),
            "trip_id": String(tripId),
        ], as: LeaderboardResponse.self).leaderboard ?? []
    }

    // MARK: Feed

    func feed(userId: Int, tripId: Int) async throws -> [FeedPost] {
        try await get("api/feed", query: [
            "user_id": String(userId),
            "trip_id": String(tripId),
        ], as: FeedResponse.self).posts ?? []
    }

    func createPost(userId: Int, tripId: Int, content: String) async throws {
        _ = try await send("POST", "api/feed",
                           body: CreatePostRequest(userId: userId, tripId: tripId, content: content),
                           as: CreatePostResponse.self)
    }

    func deletePost(userId: Int, postId: Int) async throws {
        _ = try await send("DELETE", "api/feed",
                           body: DeletePostRequest(userId: userId, postId: postId),
                           as: SuccessResponse.self)
    }

    func toggleLike(userId: Int, postId: Int) async throws -> LikeResponse {
        try await send("POST", "api/feed-like",
                       body: LikeRequest(userId: userId, postId: postId, replyId: nil),
                       as: LikeResponse.self)
    }

    func toggleReplyLike(userId: Int, replyId: Int) async throws -> LikeResponse {
        try await send("POST", "api/feed-reply-like",
                       body: LikeRequest(userId: userId, postId: nil, replyId: replyId),
                       as: LikeResponse.self)
    }

    func replies(postId: Int, viewerId: Int) async throws -> [FeedReply] {
        try await get("api/feed-replies", query: [
            "post_id": String(postId),
            "viewer_id": String(viewerId),
        ], as: RepliesResponse.self).replies ?? []
    }

    func createReply(userId: Int, postId: Int, parentReplyId: Int?, content: String) async throws {
        _ = try await send("POST", "api/feed-replies",
                           body: CreateReplyRequest(userId: userId, postId: postId,
                                                    parentReplyId: parentReplyId, content: content),
                           as: CreateReplyResponse.self)
    }

    func deleteReply(userId: Int, replyId: Int) async throws {
        _ = try await send("DELETE", "api/feed-replies",
                           body: DeleteReplyRequest(userId: userId, replyId: replyId),
                           as: SuccessResponse.self)
    }

    // MARK: Profile

    func profile(userId: Int, tripId: Int?) async throws -> User {
        let response: ProfileResponse = try await get("api/profile", query: [
            "id": String(userId),
            "trip_id": tripId.map(String.init),
        ], as: ProfileResponse.self)
        guard let user = response.user else { throw APIError.notFound("User not found") }
        return user
    }

    func updateAvatar(userId: Int, dataURL: String?) async throws -> User {
        let response = try await send("PATCH", "api/profile",
                                      body: AvatarRequest(userId: userId, avatarImage: dataURL),
                                      as: ProfileResponse.self)
        guard let user = response.user else { throw APIError.server("Could not save the avatar") }
        return user
    }
}

// MARK: - Scopes

enum DrinkScope: String, CaseIterable, Identifiable, Sendable {
    case trip, all
    var id: String { rawValue }
    var label: String { self == .trip ? "This trip" : "All drinks" }
}

enum LeaderboardKind: String, CaseIterable, Identifiable, Sendable {
    case personal, social, consensus
    var id: String { rawValue }

    var label: String {
        switch self {
        case .personal:  "My Top"
        case .social:    "Group"
        case .consensus: "Consensus"
        }
    }
}

// MARK: - Wire types

struct AuthRequest: Encodable { let action: String; let name: String; let pin: String }
struct AuthResponse: Decodable { let user: User?; let trips: [Trip]? }

struct TripsResponse: Decodable { let trips: [Trip]? }
struct TripResponse: Decodable { let trip: Trip? }
struct TripDetailResponse: Decodable { let trip: Trip?; let members: [TripMember]? }

struct TripWriteRequest: Encodable {
    let action: String?
    let userId: Int
    let tripId: Int?
    let name: String?
    let destination: String?
    let startDate: String?
    let endDate: String?
    let inviteCode: String?
}

struct LeaveTripRequest: Encodable { let userId: Int; let tripId: Int; let action: String }
struct SuccessResponse: Decodable { let success: Bool? }

struct DrinksResponse: Decodable { let drinks: [Drink]?; let scope: String? }
struct DrinkResponse: Decodable { let drink: Drink? }
struct DrinkDetailResponse: Decodable {
    let drink: Drink?
    let ratings: [Rating]?
    let myRating: MyRating?
}

struct AddDrinkRequest: Encodable {
    let userId: Int
    let tripId: Int
    let name: String
    let category: String
    let type: String?
    let varietal: String?
    let style: String?
    let source: String?
}

struct SaveRatingRequest: Encodable {
    let userId: Int; let tripId: Int; let drinkId: Int; let stars: Int; let notes: String?
}
struct SaveRatingResponse: Decodable { let rating: Rating? }
struct DeleteRatingRequest: Encodable { let userId: Int; let tripId: Int; let drinkId: Int }

struct LeaderboardResponse: Decodable { let leaderboard: [Drink]? }

struct FeedResponse: Decodable { let posts: [FeedPost]? }
struct CreatePostRequest: Encodable { let userId: Int; let tripId: Int; let content: String }
struct CreatePostResponse: Decodable { let post: FeedPost? }
struct DeletePostRequest: Encodable { let userId: Int; let postId: Int }
struct LikeRequest: Encodable { let userId: Int; let postId: Int?; let replyId: Int? }
struct LikeResponse: Decodable { let liked: Bool?; let likeCount: Int? }
struct RepliesResponse: Decodable { let replies: [FeedReply]? }
struct CreateReplyRequest: Encodable {
    let userId: Int; let postId: Int; let parentReplyId: Int?; let content: String
}
struct CreateReplyResponse: Decodable { let reply: FeedReply? }
struct DeleteReplyRequest: Encodable { let userId: Int; let replyId: Int }

struct ProfileResponse: Decodable { let user: User? }
struct AvatarRequest: Encodable { let userId: Int; let avatarImage: String? }
