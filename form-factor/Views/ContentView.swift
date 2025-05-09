//
//  ContentView.swift
//  form-factor
//
//  Created by Fabrizio Corrales on 12/6/24.
//

import SwiftUI

struct ContentView: View {

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Home", systemImage: "house") }
            WorkoutEntryView()
                .tabItem { Label("Log", systemImage: "plus.circle") }
        }
    }
    
}

#Preview {
    ContentView()
}
