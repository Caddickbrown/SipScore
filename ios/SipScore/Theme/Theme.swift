import SwiftUI
import UIKit

/// Mirrors the design tokens in public/css/style.css so the app and the web
/// version look like the same product.
enum Palette {
    static let navy      = Color(hex: 0x1A2744)
    static let navyMid   = Color(hex: 0x243460)
    static let gold      = Color(hex: 0xC9A96E)
    static let goldDark  = Color(hex: 0xB8924D)
    static let goldLight = Color(hex: 0xE8D5B0)
    static let goldPale  = Color(hex: 0xF8F2E6)
    static let ivory     = Color(hex: 0xFAF8F3)
    static let border    = Color(hex: 0xE5DECE)
    static let text      = Color(hex: 0x1E2D47)
    static let textLight = Color(hex: 0x64748B)

    /// Avatar fallback colours, matching api/auth.js.
    static let avatarColours: [Color] = [
        Color(hex: 0xC9A96E), Color(hex: 0x1A6B5C), Color(hex: 0x7C5CBF), Color(hex: 0xC17B5C),
        Color(hex: 0x4A8FA8), Color(hex: 0xC4526C), Color(hex: 0x5A7D5A), Color(hex: 0xA06B3C),
    ]
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue:  Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }

    /// Parses the "#rrggbb" strings the API stores for avatars.
    init?(cssHex: String?) {
        guard let cssHex else { return nil }
        var trimmed = cssHex.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("#") { trimmed.removeFirst() }
        guard trimmed.count == 6, let value = UInt32(trimmed, radix: 16) else { return nil }
        self.init(hex: value)
    }
}

extension Font {
    /// The web app pairs Cormorant Garamond with Jost; the system serif face is
    /// the closest match available without bundling fonts.
    static func serifTitle(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
}

/// Category accent colours, matching the coloured card edges on the web.
extension DrinkCategory {
    func accent(type: String?) -> Color {
        switch self {
        case .wine:
            switch (type ?? "").lowercased() {
            case let t where t.hasPrefix("red"):       return Color(hex: 0xA13744)
            case let t where t.hasPrefix("rosé"),
                 let t where t.hasPrefix("rose"):      return Color(hex: 0xE1849A)
            case let t where t.hasPrefix("sparkling"): return Color(hex: 0xD9C27A)
            case let t where t.hasPrefix("dessert"):   return Color(hex: 0xA9743C)
            default:                                   return Color(hex: 0xD8CB9A)
            }
        case .cocktail:  return Color(hex: 0x4FA98C)
        case .beer:      return Color(hex: 0xD2A03C)
        case .cider:     return Color(hex: 0xC2703C)
        case .spirit:    return Color(hex: 0x7C5CBF)
        case .mocktail:  return Color(hex: 0x59A9C4)
        case .hotdrink:  return Color(hex: 0x8A6247)
        case .softdrink: return Color(hex: 0x5D7FC4)
        case .milkshake: return Color(hex: 0xD98FA8)
        }
    }
}

extension Drink {
    var accentColour: Color {
        DrinkCategory(rawValue: category)?.accent(type: type) ?? Palette.gold
    }
}

// MARK: - Shared building blocks

struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Palette.border, lineWidth: 1)
            )
            .shadow(color: Palette.navy.opacity(0.06), radius: 4, y: 1)
    }
}

extension View {
    func cardStyle() -> some View { modifier(CardBackground()) }
}

/// Read-only star row, with support for half stars on averages.
struct StarsView: View {
    let value: Double
    var size: CGFloat = 13
    var colour: Color = Palette.gold

    var body: some View {
        HStack(spacing: 1) {
            ForEach(1...5, id: \.self) { index in
                Image(systemName: symbol(for: index))
                    .font(.system(size: size))
                    .foregroundStyle(colour)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(format: "%.1f out of 5 stars", value))
    }

    private func symbol(for index: Int) -> String {
        let whole = floor(value)
        if Double(index) <= whole { return "star.fill" }
        if Double(index) == whole + 1, value - whole >= 0.5 { return "star.leadinghalf.filled" }
        return "star"
    }
}

/// Circular avatar: photo when the user has one, coloured initials otherwise.
struct AvatarView: View {
    let name: String
    var colourHex: String?
    var imageDataURL: String?
    var size: CGFloat = 36

    var body: some View {
        Group {
            if let image = decodedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                (Color(cssHex: colourHex) ?? Palette.gold)
                    .overlay(
                        Text(initials)
                            .font(.system(size: size * 0.38, weight: .semibold))
                            .foregroundStyle(.white)
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initials: String {
        let parts = name.split(separator: " ")
        if parts.count >= 2, let a = parts[0].first, let b = parts[1].first {
            return "\(a)\(b)".uppercased()
        }
        return String(name.prefix(2)).uppercased()
    }

    private var decodedImage: UIImage? {
        guard let imageDataURL else { return nil }
        return AvatarImageCache.image(for: imageDataURL)
    }
}

/// Avatars arrive as base64 data URLs. Decoding one on every redraw makes
/// scrolling lists stutter, so keep the decoded images around.
enum AvatarImageCache {
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 120
        return cache
    }()

    static func image(for dataURL: String) -> UIImage? {
        let key = dataURL as NSString
        if let cached = cache.object(forKey: key) { return cached }

        guard dataURL.hasPrefix("data:image/"),
              let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let image = UIImage(data: data) else { return nil }

        cache.setObject(image, forKey: key)
        return image
    }
}

/// Small pill used for categories and trip stats.
struct BadgeView: View {
    let text: String
    var tint: Color = Palette.navyMid

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

/// Consistent empty / error state.
struct EmptyStateView: View {
    let title: String
    let message: String
    var systemImage: String = "wineglass"

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Palette.goldLight)
            Text(title)
                .font(.serifTitle(20))
                .foregroundStyle(Palette.navy)
            Text(message)
                .font(.system(size: 14, weight: .light))
                .foregroundStyle(Palette.textLight)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.vertical, 48)
    }
}

/// Gold primary button, matching .btn-gold on the web.
struct GoldButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Palette.gold.opacity(configuration.isPressed ? 0.8 : 1), in: Capsule())
    }
}

struct OutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(Palette.navy)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                Capsule().stroke(Palette.border, lineWidth: 1)
                    .background(Capsule().fill(configuration.isPressed ? Palette.navy.opacity(0.04) : .clear))
            )
    }
}
