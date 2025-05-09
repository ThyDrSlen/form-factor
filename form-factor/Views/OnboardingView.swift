import SwiftUI

struct OnboardingView: View {
    @State private var authorized = false

    var body: some View {
        VStack(spacing: 20) {
            Text("Welcome to Form Factor")
                .font(.largeTitle)
            Button("Grant Health Kit Access") {
                HealthKitManager.shared.requestAuthorization { ok in
                    authorized = ok
                }
            }
        }
        .fullScreenCover(isPresented: $authorized) {
            ContentView()
        }
    }
}
