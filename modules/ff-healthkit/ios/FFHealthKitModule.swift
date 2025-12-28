import ExpoModulesCore
import HealthKit

public class FFHealthKitModule: Module {
  private let healthStore = HKHealthStore()

  // TODO: Add HealthKit write APIs (e.g., workouts) when supported.
  private static let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  private static let isoFormatterWithFractional: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  public func definition() -> ModuleDefinition {
    Name("FFHealthKit")

    Function("isAvailable") { () -> Bool in
      return HKHealthStore.isHealthDataAvailable()
    }

    Function("getAuthorizationStatus") { (readTypes: [String], writeTypes: [String]) -> [String: Bool] in
      return self.authorizationSummary(readTypes: readTypes, writeTypes: writeTypes)
    }

    AsyncFunction("requestAuthorization") { (readTypes: [String], writeTypes: [String], promise: Promise) in
      let readSet = Set(readTypes.compactMap { self.hkObjectType(for: $0) })
      let writeSet = Set(writeTypes.compactMap { self.hkSampleType(for: $0) })

      self.healthStore.requestAuthorization(toShare: writeSet, read: readSet) { _, error in
        if let error = error {
          promise.reject("E_HEALTHKIT_AUTH", error.localizedDescription, error)
          return
        }
        promise.resolve(self.authorizationSummary(readTypes: readTypes, writeTypes: writeTypes))
      }
    }

    AsyncFunction("getBiologicalSex") { (promise: Promise) in
      do {
        let sexObject = try self.healthStore.biologicalSex()
        promise.resolve(self.biologicalSexString(sexObject.biologicalSex))
      } catch {
        promise.resolve(NSNull())
      }
    }

    AsyncFunction("getDateOfBirth") { (promise: Promise) in
      do {
        let components = try self.healthStore.dateOfBirthComponents()
        let calendar = Calendar.current
        let date = calendar.date(from: components)
        let birthDate = date.map { self.isoString(from: $0) }
        let age = date.flatMap { calendar.dateComponents([.year], from: $0, to: Date()).year }
        promise.resolve([
          "birthDate": birthDate ?? NSNull(),
          "age": age ?? NSNull()
        ])
      } catch {
        promise.resolve([
          "birthDate": NSNull(),
          "age": NSNull()
        ])
      }
    }

    AsyncFunction("getQuantitySamples") { (type: String, startDate: String, endDate: String, unit: String, limit: Int?, ascending: Bool?, promise: Promise) in
      guard let quantityType = self.hkQuantityType(for: type) else {
        promise.resolve([])
        return
      }
      guard let start = self.parseISODate(startDate), let end = self.parseISODate(endDate) else {
        promise.resolve([])
        return
      }

      let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
      let sortAscending = ascending ?? true
      let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: sortAscending)
      let queryLimit = limit ?? HKObjectQueryNoLimit
      let hkUnit = self.hkUnit(from: unit)

      let query = HKSampleQuery(sampleType: quantityType, predicate: predicate, limit: queryLimit, sortDescriptors: [sortDescriptor]) { _, samples, error in
        if let error = error {
          promise.reject("E_HEALTHKIT_QUERY", error.localizedDescription, error)
          return
        }
        let mapped = (samples as? [HKQuantitySample] ?? []).map { sample in
          return [
            "value": sample.quantity.doubleValue(for: hkUnit),
            "startDate": self.isoString(from: sample.startDate),
            "endDate": self.isoString(from: sample.endDate)
          ]
        }
        promise.resolve(mapped)
      }
      self.healthStore.execute(query)
    }

    AsyncFunction("getLatestQuantitySample") { (type: String, unit: String, promise: Promise) in
      guard let quantityType = self.hkQuantityType(for: type) else {
        promise.resolve(NSNull())
        return
      }

      let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let hkUnit = self.hkUnit(from: unit)
      let query = HKSampleQuery(sampleType: quantityType, predicate: nil, limit: 1, sortDescriptors: [sortDescriptor]) { _, samples, error in
        if let error = error {
          promise.reject("E_HEALTHKIT_QUERY", error.localizedDescription, error)
          return
        }
        guard let sample = (samples as? [HKQuantitySample])?.first else {
          promise.resolve(NSNull())
          return
        }
        promise.resolve([
          "value": sample.quantity.doubleValue(for: hkUnit),
          "startDate": self.isoString(from: sample.startDate),
          "endDate": self.isoString(from: sample.endDate)
        ])
      }
      self.healthStore.execute(query)
    }

    AsyncFunction("getDailySumSamples") { (type: String, startDate: String, endDate: String, unit: String, promise: Promise) in
      guard let quantityType = self.hkQuantityType(for: type) else {
        promise.resolve([])
        return
      }
      guard let start = self.parseISODate(startDate), let end = self.parseISODate(endDate) else {
        promise.resolve([])
        return
      }

      let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
      let interval = DateComponents(day: 1)
      let anchor = Calendar.current.startOfDay(for: start)
      let hkUnit = self.hkUnit(from: unit)

      let query = HKStatisticsCollectionQuery(
        quantityType: quantityType,
        quantitySamplePredicate: predicate,
        options: .cumulativeSum,
        anchorDate: anchor,
        intervalComponents: interval
      )

      query.initialResultsHandler = { _, results, error in
        if let error = error {
          promise.reject("E_HEALTHKIT_QUERY", error.localizedDescription, error)
          return
        }
        var output: [[String: Any]] = []
        results?.enumerateStatistics(from: start, to: end) { statistics, _ in
          if let sum = statistics.sumQuantity() {
            output.append([
              "value": sum.doubleValue(for: hkUnit),
              "startDate": self.isoString(from: statistics.startDate),
              "endDate": self.isoString(from: statistics.endDate)
            ])
          }
        }
        promise.resolve(output)
      }

      self.healthStore.execute(query)
    }
  }

  private func parseISODate(_ value: String) -> Date? {
    if let date = FFHealthKitModule.isoFormatterWithFractional.date(from: value) {
      return date
    }
    return FFHealthKitModule.isoFormatter.date(from: value)
  }

  private func isoString(from date: Date) -> String {
    return FFHealthKitModule.isoFormatterWithFractional.string(from: date)
  }

  private func authorizationSummary(readTypes: [String], writeTypes: [String]) -> [String: Bool] {
    let hasReadPermission = readTypes.contains { type in
      guard let objectType = hkObjectType(for: type) else { return false }
      return healthStore.authorizationStatus(for: objectType) == .sharingAuthorized
    }
    let hasSharePermission = writeTypes.contains { type in
      guard let objectType = hkObjectType(for: type) else { return false }
      return healthStore.authorizationStatus(for: objectType) == .sharingAuthorized
    }
    return [
      "hasReadPermission": hasReadPermission,
      "hasSharePermission": hasSharePermission
    ]
  }

  private func hkObjectType(for type: String) -> HKObjectType? {
    if let quantity = hkQuantityType(for: type) {
      return quantity
    }
    switch type {
    case "sleepAnalysis":
      return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
    case "workouts":
      return HKObjectType.workoutType()
    case "workoutRoute":
      return HKSeriesType.workoutRoute()
    default:
      return nil
    }
  }

  private func hkSampleType(for type: String) -> HKSampleType? {
    return hkObjectType(for: type) as? HKSampleType
  }

  private func hkQuantityType(for type: String) -> HKQuantityType? {
    let identifier: HKQuantityTypeIdentifier?
    switch type {
    case "heartRate":
      identifier = .heartRate
    case "respiratoryRate":
      identifier = .respiratoryRate
    case "walkingHeartRateAverage":
      identifier = .walkingHeartRateAverage
    case "activeEnergyBurned":
      identifier = .activeEnergyBurned
    case "basalEnergyBurned":
      identifier = .basalEnergyBurned
    case "stepCount":
      identifier = .stepCount
    case "bodyMass":
      identifier = .bodyMass
    case "height":
      identifier = .height
    case "distanceWalkingRunning":
      identifier = .distanceWalkingRunning
    case "distanceCycling":
      identifier = .distanceCycling
    case "distanceSwimming":
      identifier = .distanceSwimming
    case "restingHeartRate":
      identifier = .restingHeartRate
    case "heartRateVariability":
      identifier = .heartRateVariabilitySDNN
    case "vo2Max":
      identifier = .vo2Max
    default:
      identifier = nil
    }
    guard let validIdentifier = identifier else { return nil }
    return HKQuantityType.quantityType(forIdentifier: validIdentifier)
  }

  private func hkUnit(from unit: String) -> HKUnit {
    let normalized = unit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    switch normalized {
    case "bpm", "count/min", "count/minute":
      return HKUnit.count().unitDivided(by: HKUnit.minute())
    case "count":
      return HKUnit.count()
    case "meter", "m":
      return HKUnit.meter()
    case "km", "kilometer", "kilometers":
      return HKUnit.meterUnit(with: .kilo)
    case "kcal", "kilocalorie", "kilocalories":
      return HKUnit.kilocalorie()
    case "kg", "kilogram", "kilograms":
      return HKUnit.gramUnit(with: .kilo)
    case "g", "gram", "grams":
      return HKUnit.gram()
    default:
      return HKUnit.count()
    }
  }

  private func biologicalSexString(_ sex: HKBiologicalSex) -> String {
    switch sex {
    case .female:
      return "female"
    case .male:
      return "male"
    case .other:
      return "other"
    default:
      return "unknown"
    }
  }
}
