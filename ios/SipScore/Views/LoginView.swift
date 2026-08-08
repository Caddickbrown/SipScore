import SwiftUI

/// Name + 4-digit PIN, matching the web flow: try to sign in first, and offer
/// to create a profile if the name isn't registered yet.
@MainActor
struct LoginView: View {
    @Environment(SessionStore.self) private var session

    @State private var name = ""
    @State private var pin = ""
    @State private var errorMessage: String?
    @State private var isWorking = false
    @State private var offerRegistration = false
    @FocusState private var pinFocused: Bool

    private var canSubmit: Bool {
        name.trimmingCharacters(in: .whitespaces).count >= 2 && pin.count == 4 && !isWorking
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header
                card
            }
        }
        .background(Palette.navy.ignoresSafeArea(edges: .top))
        .scrollDismissesKeyboard(.interactively)
        .alert("New profile?", isPresented: $offerRegistration) {
            Button("Yes, create my profile") { Task { await register() } }
            Button("No, try a different name", role: .cancel) { }
        } message: {
            Text("“\(name.trimmingCharacters(in: .whitespaces))” isn't registered yet. Would you like to create a new profile?")
        }
    }

    private var header: some View {
        VStack(spacing: 6) {
            Text("SipScore")
                .font(.serifTitle(44, weight: .medium))
                .foregroundStyle(Palette.goldLight)
            Text("Your holiday drinks companion")
                .font(.system(size: 15, weight: .light))
                .foregroundStyle(.white.opacity(0.65))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
        .padding(.bottom, 44)
        .background(Palette.navy)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Welcome")
                .font(.serifTitle(26))
                .foregroundStyle(Palette.navy)

            VStack(alignment: .leading, spacing: 7) {
                fieldLabel("Your Name")
                TextField("e.g. Alex or Smith Family", text: $name)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .onSubmit { pinFocused = true }
                    .padding(14)
                    .background(Palette.ivory, in: RoundedRectangle(cornerRadius: 9))
                    .overlay(
                        RoundedRectangle(cornerRadius: 9).stroke(Palette.border, lineWidth: 1)
                    )
            }

            VStack(alignment: .leading, spacing: 7) {
                fieldLabel("4-Digit PIN")
                PinField(pin: $pin, isFocused: $pinFocused)
                Text("Your PIN keeps your ratings private")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Palette.textLight)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(.red)
            }

            Button {
                Task { await signIn() }
            } label: {
                if isWorking {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text("Continue")
                }
            }
            .buttonStyle(GoldButtonStyle())
            .disabled(!canSubmit)
            .opacity(canSubmit ? 1 : 0.55)
        }
        .padding(26)
        .frame(maxWidth: .infinity)
        .background(Color.white)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 26, topTrailingRadius: 26))
        .padding(.top, -20)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.9)
            .foregroundStyle(Palette.textLight)
    }

    // MARK: Actions

    private func signIn() async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }

        do {
            let response = try await APIClient.shared.login(
                name: name.trimmingCharacters(in: .whitespaces), pin: pin
            )
            guard let user = response.user else {
                errorMessage = "Unexpected response from the server"
                return
            }
            session.signIn(user: user, trips: response.trips ?? [])
        } catch let error as APIError where error.isNoProfileFound {
            offerRegistration = true
        } catch {
            errorMessage = error.localizedDescription
            pin = ""
        }
    }

    private func register() async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }

        do {
            let response = try await APIClient.shared.register(
                name: name.trimmingCharacters(in: .whitespaces), pin: pin
            )
            guard let user = response.user else {
                errorMessage = "Unexpected response from the server"
                return
            }
            session.signIn(user: user, trips: response.trips ?? [])
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Four PIN boxes backed by a single hidden text field.
struct PinField: View {
    @Binding var pin: String
    var isFocused: FocusState<Bool>.Binding

    var body: some View {
        ZStack {
            TextField("", text: $pin)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused(isFocused)
                .opacity(0.001)
                .onChange(of: pin) { _, newValue in
                    let digits = newValue.filter(\.isNumber)
                    pin = String(digits.prefix(4))
                }

            HStack(spacing: 12) {
                ForEach(0..<4, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 9)
                        .fill(Palette.ivory)
                        .overlay(
                            RoundedRectangle(cornerRadius: 9)
                                .stroke(index == pin.count && isFocused.wrappedValue
                                        ? Palette.gold : Palette.border,
                                        lineWidth: index == pin.count && isFocused.wrappedValue ? 2 : 1)
                        )
                        .frame(height: 56)
                        .overlay {
                            if index < pin.count {
                                Circle()
                                    .fill(Palette.navy)
                                    .frame(width: 11, height: 11)
                            }
                        }
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { isFocused.wrappedValue = true }
        }
    }
}
