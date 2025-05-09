import SwiftUI
import GoogleSignIn

struct GoogleSignInView: View {
    @EnvironmentObject var googleSignInVM: GoogleSignInViewModel
    @State private var showErrorAlert: Bool = false
    @State private var presentingViewController: UIViewController?
    
    var body: some View {
        VStack {
            Button(action: {
                // Obtain the topmost UIViewController
                if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootVC = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController {
                    googleSignInVM.signInWithGoogle(presentingViewController: rootVC)
                }            }) {
                HStack {
                    Image("google_logo") // Add a Google logo image to Assets.xcassets
                        .resizable()
                        .frame(width: 24, height: 24)
                    Text("Sign in with Google")
                        .foregroundColor(.white)
                        .font(.headline)
                }
                .padding()
                .background(Color.red)
                .cornerRadius(8)
            }
        }
        .padding()
        .alert(isPresented: $showErrorAlert) {
            Alert(title: Text("Error"), message: Text(googleSignInVM.errorMessage ?? "Unknown error"), dismissButton: .default(Text("OK")))
        }
        .onReceive(googleSignInVM.$errorMessage) { errorMessage in
            if errorMessage != nil {
                showErrorAlert = true
            }
        }
    }
}
