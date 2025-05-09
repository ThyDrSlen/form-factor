import Foundation
import XCTest

class ConfigurationTests: XCTestCase {
    func testSupabaseKeysExist() {
        let url = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String
        XCTAssertNotNil(url, " SUPABASE_URL missing in Info.plist")

        let anon = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String
        XCTAssertNotNil(anon, " SUPABASE_ANON_KEY missing in Info.plist")
    }
}
