import Foundation

// MARK: - Lenient numbers
//
// Postgres returns `numeric` and `bigint` columns as JSON *strings* to avoid
// losing precision, while `int` columns come back as numbers. Rather than
// guessing which is which per field, decode both shapes.

@propertyWrapper
struct Lenient<T>: Hashable, Sendable where T: LosslessStringConvertible & Hashable & Sendable {
    var wrappedValue: T?

    init(wrappedValue: T?) {
        self.wrappedValue = wrappedValue
    }
}

extension Lenient: Decodable where T: Decodable {
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            wrappedValue = nil
        } else if let value = try? container.decode(T.self) {
            wrappedValue = value
        } else if let text = try? container.decode(String.self) {
            wrappedValue = T(text)
        } else if let number = try? container.decode(Double.self) {
            wrappedValue = T(String(number))
        } else {
            wrappedValue = nil
        }
    }
}

extension Lenient: Encodable where T: Encodable {
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let wrappedValue {
            try container.encode(wrappedValue)
        } else {
            try container.encodeNil()
        }
    }
}

// Makes a missing key decode as nil rather than throwing. Synthesised Codable
// conformances route property-wrapped properties through `decode(_:forKey:)`,
// and this overload is more specialised than the general one, so it wins.
extension KeyedDecodingContainer {
    func decode<T>(_ type: Lenient<T>.Type, forKey key: Key) throws -> Lenient<T>
    where T: LosslessStringConvertible & Hashable & Sendable & Decodable {
        try decodeIfPresent(type, forKey: key) ?? Lenient<T>(wrappedValue: nil)
    }
}

// MARK: - User

struct User: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    var avatarColour: String?
    var avatarImage: String?
    @Lenient var ratingCount: Int?
    @Lenient var overallRatingCount: Int?
    @Lenient var tripCount: Int?

    var initials: String {
        let parts = name.split(separator: " ")
        if parts.count >= 2, let a = parts[0].first, let b = parts[1].first {
            return "\(a)\(b)".uppercased()
        }
        return String(name.prefix(2)).uppercased()
    }
}

// MARK: - Trip

struct Trip: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    var name: String
    var destination: String?
    var startDate: String?
    var endDate: String?
    var inviteCode: String?
    var role: String?
    var createdByUserId: Int?
    @Lenient var memberCount: Int?
    @Lenient var drinkCount: Int?
    @Lenient var ratingCount: Int?
    @Lenient var myRatingCount: Int?

    var isOwner: Bool { role == "owner" }

    /// "1 Sept 2026 – 10 Sept 2026", or empty when no dates are set.
    var dateRange: String {
        let start = Self.display(startDate)
        let end = Self.display(endDate)
        switch (start, end) {
        case let (start?, end?): return "\(start) – \(end)"
        case let (start?, nil):  return start
        case let (nil, end?):    return end
        default:                 return ""
        }
    }

    var subtitle: String {
        [destination, dateRange.isEmpty ? nil : dateRange]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " • ")
    }

    // The API hands back either a bare date ("2026-09-01") or a full
    // timestamp, depending on the driver, so accept both.
    static func parseDate(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let date = ISO8601DateFormatter().date(from: raw) { return date }
        let plain = DateFormatter()
        plain.locale = Locale(identifier: "en_US_POSIX")
        plain.timeZone = TimeZone(identifier: "UTC")
        plain.dateFormat = "yyyy-MM-dd"
        return plain.date(from: String(raw.prefix(10)))
    }

    private static func display(_ raw: String?) -> String? {
        guard let date = parseDate(raw) else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "d MMM yyyy"
        return formatter.string(from: date)
    }
}

// MARK: - Drink

struct Drink: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let category: String
    var type: String?
    var varietal: String?
    var style: String?
    var source: String?
    var tripId: Int?

    /// Scoped to the active trip.
    @Lenient var avgStars: Double?
    @Lenient var ratingCount: Int?
    /// Across every trip this drink has been rated on.
    @Lenient var overallAvgStars: Double?
    @Lenient var overallRatingCount: Int?
    @Lenient var tripsRatedOn: Int?
    /// The signed-in user's rating, on the active trip.
    @Lenient var myStars: Int?

    /// Personal-rankings rows reuse this shape.
    @Lenient var consensusScore: Double?
    var notes: String?
    var tripName: String?

    var meta: String {
        [varietal, style, source]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " • ")
    }

    var badgeLabel: String {
        DrinkCategory(rawValue: category)?.badgeLabel(type: type) ?? (type ?? category)
    }
}

// MARK: - Ratings

struct Rating: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let stars: Int
    var notes: String?
    var updatedAt: String?
    var tripId: Int?
    var tripName: String?
    var userId: Int?
    var userName: String?
    var avatarColour: String?
    var avatarImage: String?
}

/// The current user's own rating, as returned alongside a drink.
struct MyRating: Codable, Hashable, Sendable {
    let id: Int
    let stars: Int
    var notes: String?
    var tripId: Int?
}

// MARK: - Feed

struct FeedPost: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let content: String
    var createdAt: String?
    var tripId: Int?
    var userId: Int?
    var userName: String?
    var avatarColour: String?
    var avatarImage: String?
    @Lenient var likeCount: Int?
    var likedByViewer: Bool?
    @Lenient var replyCount: Int?
}

struct FeedReply: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let content: String
    var createdAt: String?
    var parentReplyId: Int?
    var userId: Int?
    var userName: String?
    var avatarColour: String?
    var avatarImage: String?
    @Lenient var likeCount: Int?
    var likedByViewer: Bool?
}

struct TripMember: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    var avatarColour: String?
    var avatarImage: String?
    var role: String?
    @Lenient var ratingCount: Int?

    var isOwner: Bool { role == "owner" }
}

// MARK: - Categories

enum DrinkCategory: String, CaseIterable, Identifiable, Sendable {
    case wine, cocktail, beer, cider, spirit, mocktail, hotdrink, softdrink, milkshake, mead, other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .wine:      "Wine"
        case .cocktail:  "Cocktail"
        case .beer:      "Beer"
        case .cider:     "Cider"
        case .spirit:    "Spirit"
        case .mocktail:  "Mocktail"
        case .hotdrink:  "Coffee & Tea"
        case .softdrink: "Soft Drink"
        case .milkshake: "Milkshake"
        case .mead:      "Mead"
        case .other:     "Other"
        }
    }

    /// Wine shows its type (White, Red…) rather than the word "Wine".
    func badgeLabel(type: String?) -> String {
        guard self == .wine else { return label }
        return type ?? label
    }

    // Keep in step with the Type options on the web forms and the Drinks
    // filters (public/js/drinks.js); tests/lists.test.js checks all three.
    var types: [String] {
        switch self {
        case .wine:      ["White", "Rosé", "Red", "Sparkling", "Dessert and Fortified"]
        case .cocktail:  ["Rum-based", "Vodka-based", "Gin-based", "Tequila-based",
                          "Whiskey-based", "Wine-based", "Liqueur-based", "Mixed", "Other"]
        case .beer:      ["Lager", "Ale", "IPA", "Stout", "Wheat Beer", "Pilsner", "Porter", "Other"]
        case .cider:     ["Apple", "Pear (Perry)", "Fruit", "Rosé"]
        case .spirit:    ["Vodka", "Gin", "Rum", "Tequila", "Whiskey", "Brandy", "Ouzo",
                          "Tsipouro", "Grappa", "Liqueur", "Other"]
        case .mocktail:  ["Virgin Classic", "Fruit-based", "Herbal", "Sparkling", "Creamy", "Other"]
        case .hotdrink:  ["Espresso", "Americano", "Cappuccino", "Latte", "Flat White", "Mocha",
                          "Greek Coffee", "Freddo Espresso", "Freddo Cappuccino", "Frappé",
                          "Iced Coffee", "Cold Brew", "Black Tea", "Green Tea", "Herbal Tea",
                          "Chai", "Hot Chocolate", "Other"]
        case .softdrink: ["Cola", "Lemonade", "Fruit Soda", "Juice", "Energy Drink",
                          "Sparkling Water", "Iced Tea", "Other"]
        case .milkshake: ["Classic", "Thick Shake", "Smoothie", "Other"]
        case .mead:      ["Traditional", "Fruit", "Spiced", "Sparkling", "Other"]
        case .other:     []
        }
    }

    /// What the style field means for this category. Stored in drinks.style.
    var styleLabel: String {
        switch self {
        case .cider, .mead: "Sweetness"
        case .spirit:       "Serve"
        case .milkshake:    "Flavour"
        default:            "Style"
        }
    }

    /// Options for the style field (the web lets you pick several; iOS picks one).
    var styles: [String] {
        switch self {
        case .wine:      ["Dry", "Off-Dry", "Sweet", "Crisp", "Fruity", "Aromatic", "Oaked",
                          "Tannic", "Smooth", "Full-Bodied", "Light", "Earthy", "Mineral"]
        case .cocktail:  ["Refreshing", "Sweet", "Sour", "Bitter", "Fruity", "Tropical",
                          "Bubbly", "Rich", "Strong", "Classic"]
        case .cider:     ["Dry", "Medium Dry", "Medium", "Sweet"]
        case .spirit:    ["Neat", "On the Rocks", "Mixed", "Shot"]
        case .mocktail:  ["Refreshing", "Sweet", "Sour", "Fruity", "Tropical"]
        case .hotdrink:  ["Black", "Milky", "Sweet", "Iced"]
        case .milkshake: ["Chocolatey", "Vanilla", "Strawberry", "Caramel", "Fruity", "Nutty"]
        case .mead:      ["Dry", "Semi-Sweet", "Sweet"]
        case .beer, .softdrink, .other: []
        }
    }
}

let starLabels = ["", "Poor", "Fair", "Good", "Great", "Outstanding"]
