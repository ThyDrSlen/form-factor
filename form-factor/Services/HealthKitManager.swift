import HealthKit

final class HealthKitManager {
    static let shared = HealthKitManager()
    private let store = HKHealthStore()

    func requestAuthorization(_ completion: @escaping (Bool) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else {
            completion(false)
            return
        }
        let readTypes: Set<HKObjectType> = [
            HKQuantityType.quantityType(forIdentifier: .stepCount)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKQuantityType.quantityType(forIdentifier: .bodyMass)!,
            HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage)!,
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .restingHeartRate)!,
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKQuantityType.quantityType(forIdentifier: .flightsClimbed)!,
            HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned)!,
            HKObjectType.workoutType()
        ]
        store.requestAuthorization(toShare: [], read: readTypes) { success, _ in
            DispatchQueue.main.async {
                if success {
                    UserDefaults.standard.set(true, forKey: "HealthKitAuthorized")
                }
                completion(success)
            }
        }
    }

    func fetchLatestHeartRate(_ completion: @escaping (Double?) -> Void) {
        let type = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        let query = HKSampleQuery(sampleType: type,
                                  predicate: nil,
                                  limit: 1,
                                  sortDescriptors: [
                                    NSSortDescriptor(key: HKSampleSortIdentifierEndDate,
                                                     ascending: false)
                                  ]) { _, samples, _ in
            let bpm = (samples?.first as? HKQuantitySample)?
                        .quantity
                        .doubleValue(for: HKUnit(from: "count/min"))
            DispatchQueue.main.async { completion(bpm) }
        }
        store.execute(query)
    }

    /// Fetch today's total step count
    func fetchStepCount(for date: Date = Date(), completion: @escaping (Double?) -> Void) {
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        let startOfDay = Calendar.current.startOfDay(for: date)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: date, options: [])
        let query = HKStatisticsQuery(
            quantityType: stepType,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, stats, _ in
            let count = stats?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
            DispatchQueue.main.async { completion(count) }
        }
        store.execute(query)
    }

    /// Fetch today's total active energy burned (kcal)
    func fetchActiveEnergyBurned(for date: Date = Date(), completion: @escaping (Double?) -> Void) {
        guard let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        let startOfDay = Calendar.current.startOfDay(for: date)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: date, options: [])
        let query = HKStatisticsQuery(
            quantityType: energyType,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, stats, _ in
            let kcals = stats?.sumQuantity()?.doubleValue(for: HKUnit.kilocalorie()) ?? 0
            DispatchQueue.main.async { completion(kcals) }
        }
        store.execute(query)
    }

    /// Fetch the latest recorded body mass (kg)
    func fetchLatestBodyMass(completion: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(
            sampleType: type,
            predicate: nil,
            limit: 1,
            sortDescriptors: [sort]
        ) { _, samples, _ in
            let mass = (samples?.first as? HKQuantitySample)?
                .quantity
                .doubleValue(for: HKUnit.gramUnit(with: .kilo))
            DispatchQueue.main.async { completion(mass) }
        }
        store.execute(query)
    }

    /// Fetch the latest recorded body fat percentage
    func fetchLatestBodyFatPercentage(completion: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(
            sampleType: type,
            predicate: nil,
            limit: 1,
            sortDescriptors: [sort]
        ) { _, samples, _ in
            let pct = (samples?.first as? HKQuantitySample)?
                .quantity
                .doubleValue(for: HKUnit.percent())
            DispatchQueue.main.async { completion(pct) }
        }
        store.execute(query)
    }

    /// Fetch today's walking and running distance (meters)
    func fetchDistanceWalkingRunning(for date: Date = Date(), completion: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        let startOfDay = Calendar.current.startOfDay(for: date)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: date, options: [])
        let query = HKStatisticsQuery(
            quantityType: type,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, stats, _ in
            let meters = stats?.sumQuantity()?.doubleValue(for: HKUnit.meter()) ?? 0
            DispatchQueue.main.async { completion(meters) }
        }
        store.execute(query)
    }

    /// Fetch today's flights climbed
    func fetchFlightsClimbed(for date: Date = Date(), completion: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .flightsClimbed) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        let startOfDay = Calendar.current.startOfDay(for: date)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: date, options: [])
        let query = HKStatisticsQuery(
            quantityType: type,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, stats, _ in
            let flights = stats?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
            DispatchQueue.main.async { completion(flights) }
        }
        store.execute(query)
    }

    /// Fetch the latest resting heart rate
    func fetchRestingHeartRate(completion: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(
            sampleType: type,
            predicate: nil,
            limit: 1,
            sortDescriptors: [sort]
        ) { _, samples, _ in
            let bpm = (samples?.first as? HKQuantitySample)?
                .quantity
                .doubleValue(for: HKUnit(from: "count/min"))
            DispatchQueue.main.async { completion(bpm) }
        }
        store.execute(query)
    }

    /// Fetch today's basal energy burned (kcal)
    func fetchBasalEnergyBurned(for date: Date = Date(), completion: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        let startOfDay = Calendar.current.startOfDay(for: date)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: date, options: [])
        let query = HKStatisticsQuery(
            quantityType: type,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, stats, _ in
            let kcals = stats?.sumQuantity()?.doubleValue(for: HKUnit.kilocalorie()) ?? 0
            DispatchQueue.main.async { completion(kcals) }
        }
        store.execute(query)
    }
}
