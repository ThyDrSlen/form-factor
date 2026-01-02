import ExpoModulesCore
import Foundation
import HealthKit

public class FFHealthKitModule: Module {
  private lazy var healthStore: HKHealthStore? = {
    guard self.isHealthKitSupported else { return nil }
    return HKHealthStore()
  }()

  private var isHealthKitSupported: Bool {
    if #available(iOS 14.0, *) {
      // iOS apps running on macOS (MacFamily) often cannot use HealthKit and may crash
      // during initialization/calls.
      if ProcessInfo.processInfo.isiOSAppOnMac {
        return false
      }
    }
    return HKHealthStore.isHealthDataAvailable()
  }

  private static func debugLog(_ location: String, _ message: String, _ data: [String: Any]) {
    let enabled = (Bundle.main.object(forInfoDictionaryKey: "FFDebugLoggingEnabled") as? Bool) ?? false
    guard enabled else { return }

    let payload: [String: Any] = [
      "sessionId": "debug-session",
      "runId": "run1",
      "hypothesisId": "H_native_healthkit",
      "location": location,
      "message": message,
      "data": data,
      "timestamp": Int(Date().timeIntervalSince1970 * 1000)
    ]

    // Attempt POST to local ingest (best-effort).
    if let url = URL(string: "http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f"),
       JSONSerialization.isValidJSONObject(payload),
       let body = try? JSONSerialization.data(withJSONObject: payload, options: []) {
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = body
      URLSession.shared.dataTask(with: request).resume()
    }

    // Always write to a local file inside the app container for Mac/iOS retrieval.
    if let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      let logURL = documents.appendingPathComponent("ff-healthkit-debug.ndjson")
      if let body = try? JSONSerialization.data(withJSONObject: payload, options: []) {
        do {
          if !FileManager.default.fileExists(atPath: logURL.path) {
            _ = FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: nil)
          }
          let handle = try FileHandle(forWritingTo: logURL)
          handle.seekToEndOfFile()
          handle.write(body)
          handle.write("\n".data(using: .utf8)!)
          try handle.close()
        } catch {
          // Swallow I/O errors; logging is best-effort.
        }
      }
    }
  }

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
      let supported = self.isHealthKitSupported
      let isOnMac: Bool
      if #available(iOS 14.0, *) {
        isOnMac = ProcessInfo.processInfo.isiOSAppOnMac
      } else {
        isOnMac = false
      }
      // #region agent log
      FFHealthKitModule.debugLog(
        "FFHealthKitModule.swift:isAvailable",
        "isAvailable called",
        ["supported": supported, "isIOSAppOnMac": isOnMac]
      )
      // #endregion
      return supported
    }

    Function("getAuthorizationStatus") { (readTypes: [String], writeTypes: [String]) -> [String: Bool] in
      guard self.isHealthKitSupported, self.healthStore != nil else {
        // #region agent log
        FFHealthKitModule.debugLog(
          "FFHealthKitModule.swift:getAuthorizationStatus",
          "HealthKit unsupported; returning defaults",
          ["readCount": readTypes.count, "writeCount": writeTypes.count]
        )
        // #endregion
        return ["hasReadPermission": false, "hasSharePermission": false]
      }
      return self.authorizationSummary(readTypes: readTypes, writeTypes: writeTypes)
    }

    AsyncFunction("requestAuthorization") { (readTypes: [String], writeTypes: [String], promise: Promise) in
      guard self.isHealthKitSupported, let store = self.healthStore else {
        // #region agent log
        FFHealthKitModule.debugLog(
          "FFHealthKitModule.swift:requestAuthorization",
          "HealthKit unsupported; resolving defaults",
          ["readCount": readTypes.count, "writeCount": writeTypes.count]
        )
        // #endregion
        promise.resolve(["hasReadPermission": false, "hasSharePermission": false])
        return
      }
      let readSet = Set(readTypes.compactMap { self.hkObjectType(for: $0) })
      let writeSet = Set(writeTypes.compactMap { self.hkSampleType(for: $0) })

      store.requestAuthorization(toShare: writeSet, read: readSet) { _, error in
        if let error = error {
          promise.reject("E_HEALTHKIT_AUTH", error.localizedDescription)
          return
        }
        promise.resolve(self.authorizationSummary(readTypes: readTypes, writeTypes: writeTypes))
      }
    }

    AsyncFunction("getBiologicalSex") { (promise: Promise) in
      guard self.isHealthKitSupported, let store = self.healthStore else {
        promise.resolve(NSNull())
        return
      }
      do {
        let sexObject = try store.biologicalSex()
        promise.resolve(self.biologicalSexString(sexObject.biologicalSex))
      } catch {
        promise.resolve(NSNull())
      }
    }

    AsyncFunction("getDateOfBirth") { (promise: Promise) in
      guard self.isHealthKitSupported, let store = self.healthStore else {
        promise.resolve(["birthDate": NSNull(), "age": NSNull()])
        return
      }
      do {
        let components = try store.dateOfBirthComponents()
        let calendar = Calendar.current
        let date = calendar.date(from: components)
        let birthDate = date.map { self.isoString(from: $0) }
        let age = date.flatMap { calendar.dateComponents([.year], from: $0, to: Date()).year }
        let birthValue: Any = birthDate == nil ? NSNull() : birthDate!
        let ageValue: Any = age == nil ? NSNull() : age!
        promise.resolve([
          "birthDate": birthValue,
          "age": ageValue
        ])
      } catch {
        promise.resolve([
          "birthDate": NSNull(),
          "age": NSNull()
        ])
      }
    }

    AsyncFunction("getQuantitySamples") { (type: String, startDate: String, endDate: String, unit: String, limit: Int?, ascending: Bool?, promise: Promise) in
      guard self.isHealthKitSupported, let store = self.healthStore else {
        promise.resolve([])
        return
      }
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
          promise.reject("E_HEALTHKIT_QUERY", error.localizedDescription)
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
      store.execute(query)
    }

    AsyncFunction("getLatestQuantitySample") { (type: String, unit: String, promise: Promise) in
      guard self.isHealthKitSupported, let store = self.healthStore else {
        promise.resolve(NSNull())
        return
      }
      guard let quantityType = self.hkQuantityType(for: type) else {
        promise.resolve(NSNull())
        return
      }

      let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let hkUnit = self.hkUnit(from: unit)
      let query = HKSampleQuery(sampleType: quantityType, predicate: nil, limit: 1, sortDescriptors: [sortDescriptor]) { _, samples, error in
        if let error = error {
          promise.reject("E_HEALTHKIT_QUERY", error.localizedDescription)
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
      store.execute(query)
    }

    AsyncFunction("getDailySumSamples") { (type: String, startDate: String, endDate: String, unit: String, promise: Promise) in
      guard self.isHealthKitSupported, let store = self.healthStore else {
        promise.resolve([])
        return
      }
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
          promise.reject("E_HEALTHKIT_QUERY", error.localizedDescription)
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

      store.execute(query)
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
    guard let store = healthStore else {
      return ["hasReadPermission": false, "hasSharePermission": false]
    }
    let hasReadPermission = readTypes.contains { type in
      guard let objectType = hkObjectType(for: type) else { return false }
      return store.authorizationStatus(for: objectType) == .sharingAuthorized
    }
    let hasSharePermission = writeTypes.contains { type in
      guard let objectType = hkObjectType(for: type) else { return false }
      return store.authorizationStatus(for: objectType) == .sharingAuthorized
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
