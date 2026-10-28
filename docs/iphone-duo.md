# iPhone Duo

Design canvas: https://claude.ai/artifact/L8kjQ6MXNqsNdFPr6WpGPX

The foldable has two shapes. Closed, the outer screen is about 466 × 678 pt:
compact width, so SipScore looks as it does on an iPhone. Open, the inner screen
is about 890 × 626 pt, regular × regular, landscape, with a hinge down the
middle and the system status area on the right edge. The inner screen ignores
orientation locks.

## Closed

The system TabView (tinted gold) and one-column screens, unchanged. The iPhone
stays portrait-locked in `Info.plist`; that only affects the closed screen.

## Open

- Regular width, so the leading sidebar from the iPad work is the navigation
  (folds to a 52 pt strip, ⌃⌘S, remembered).
- Rankings sits beside the chosen drink and "What the group thought" once the
  content column is 700 pt or wider (`RootView.swift`), so the open phone can be
  passed round the table without pushing and popping.
- Drink photos (new on this branch): the detail now shows the drink's first
  photo. At compact width it is cropped to a 220 pt banner. At regular width it
  fits whole, up to 380 pt tall (`DrinkDetailView.photoView`).
- iPad already allows all four orientations (`UISupportedInterfaceOrientations~ipad`),
  so the same split works in iPad landscape.
- Layout keys off `horizontalSizeClass` and the view's own width only. No screen,
  orientation or device-type checks.

## Waiting on the iOS 27.1 SDK or a device

- The system tab bar going vertical on the inner screen.
- Fold and unfold with a drink open: the selection is held in `RootView`
  state and the detail is keyed by `.id(drink.id)`. Check that a half-typed
  note survives.
- The status area on the right edge against the detail's trailing safe area.
- Large photos: decoding happens once per load, on the main actor.
