import SwiftUI

struct AccountView: View {
    var body: some View {
        VStack(spacing: 20) {
            Text("User Profile")
                .font(.largeTitle)
                .foregroundColor(.blue)
                .padding(.top)
            Text("Placeholder content for the user profile page.")
                .font(.body)
                .foregroundColor(.secondary)
            Spacer()
        }
        .navigationTitle("Account")
        .padding()
    }
}

struct AccountView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            AccountView()
        }
    }
}
