import XCTest
@testable import Hello

final class HelloTests: XCTestCase {
    func testGreetsByName() {
        XCTAssertEqual(greet("Ingot"), "Hello, Ingot!")
    }
}
