import Darwin
import Foundation
import Testing
@testable import Genesis

struct LogLocatorTests {
    @Test func `launchd gateway log path ensures tmp dir exists`() {
        let fm = FileManager()
        let baseDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let logDir = baseDir.appendingPathComponent("genesis-tests-\(UUID().uuidString)")

        setenv("GENESIS_LOG_DIR", logDir.path, 1)
        defer {
            unsetenv("GENESIS_LOG_DIR")
            try? fm.removeItem(at: logDir)
        }

        _ = LogLocator.launchdGatewayLogPath

        var isDir: ObjCBool = false
        #expect(fm.fileExists(atPath: logDir.path, isDirectory: &isDir))
        #expect(isDir.boolValue == true)
    }
}
