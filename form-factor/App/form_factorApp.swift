//
//  form_factorApp.swift
//  form-factor
//
//  Created by Fabrizio Corrales on 12/6/24.
//

import SwiftUI
import SwiftData
import Foundation
import HealthKit
import Supabase

@main
struct form_factorApp: App {
    // Using SwiftData ModelContainer—no Core Data setup needed
    // Root view switches based on HealthKit auth stored in AppStorage
    @AppStorage("HealthKitAuthorized") private var authorized = false

    var body: some Scene {
        WindowGroup {
            if authorized {
                ContentView()
            } else {
                OnboardingView()
            }
        }
        .modelContainer(for: [Workout.self, FoodEntry.self])
    }
}
