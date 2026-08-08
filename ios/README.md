# SipScore for iOS

A native SwiftUI client for SipScore. It talks to the same Vercel API as the
web app, so ratings, trips and the feed are shared between them.

> **Heads up:** this project was written on Linux, where no Swift toolchain or
> Xcode is available, so **it has not been compiled**. Expect to fix a small
> number of compiler complaints on first build. The API layer is exercised by
> the server-side integration tests, so the request/response shapes are known
> good.

## Requirements

- Xcode 16 or later (the project uses file-system-synchronized groups, so new
  files in `SipScore/` are picked up automatically — no `.pbxproj` editing)
- iOS 17.0 or later (the app uses `@Observable` and the two-parameter
  `onChange`)

## Getting started

1. Open `ios/SipScore.xcodeproj`.
2. Select the **SipScore** scheme and a simulator or device.
3. Set your API address — either edit `SIPSCORE_API_BASE_URL` in
   `SipScore/Info.plist`, or leave it and change it at runtime from
   **Profile → Server**. It defaults to `https://sipscore.vercel.app`.
4. For a device build, pick your own team under **Signing & Capabilities** and
   change `PRODUCT_BUNDLE_IDENTIFIER` from `com.sipscore.app` to something you
   own.

## What's in it

| Screen | Notes |
|---|---|
| Sign in | Name + 4-digit PIN. Offers to create a profile if the name is new, same as the web flow. |
| Trips | Create, join by invite code, switch active trip, see members, share the code, rename, leave/delete. |
| Drinks | Search, category and type filters, and the **This trip / All drinks** scope toggle. |
| Drink detail | Star picker and tasting notes, this trip's reviews, and the all-time average across trips. |
| Add drink | Category-aware fields; the drink is tagged with the trip it was added on. |
| Rankings | My Top, Group and Consensus boards, scoped to the active trip. |
| Feed | Posts, likes, threaded replies — per trip. |
| Profile | Avatar upload via PhotosPicker, per-trip stats, server address, sign out. |

## How it's laid out

```
SipScore/
  SipScoreApp.swift      App entry; owns the SessionStore
  Models/                Codable models + lenient numeric decoding
  Networking/            APIClient, configuration, wire types
  Store/                 SessionStore (signed-in user + active trip), Keychain
  Theme/                 Palette, shared components (stars, avatars, badges)
  Views/                 One file per screen
```

### A couple of things worth knowing

**Lenient numbers.** Postgres returns `numeric` and `bigint` columns as JSON
*strings* to preserve precision, while `int` columns come back as numbers. The
`@Lenient` property wrapper in `Models.swift` accepts either, and treats a
missing key as `nil`.

**Trips are explicit.** Every trip-scoped API call takes a `tripId` argument
rather than reading it from a global, so it's impossible to forget which
holiday you're writing to. The active trip lives in `SessionStore` and is
persisted in the Keychain alongside the signed-in user.

**Sign-in is a name and a PIN.** The server identifies callers by `user_id`
thereafter, so that id is effectively the credential — hence the Keychain. The
PIN itself is never stored. This matches the web app's security model; it keeps
group members apart rather than defending against a determined attacker.

## App icon

`Assets.xcassets/AppIcon.appiconset` is a placeholder with no image. Drop a
1024×1024 PNG in before submitting to the App Store.
