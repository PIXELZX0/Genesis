import Foundation
import Testing
@testable import Genesis

@Suite(.serialized) struct NodeServiceManagerTests {
    @Test func `builds node service commands with current CLI shape`() async throws {
        try await TestIsolation.withUserDefaultsValues(["genesis.gatewayProjectRootPath": nil]) {
            let tmp = try makeTempDirForTests()
            CommandResolver.setProjectRoot(tmp.path)

            let genesisPath = tmp.appendingPathComponent("node_modules/.bin/genesis")
            try makeExecutableForTests(at: genesisPath)

            let start = NodeServiceManager._testServiceCommand(["start"])
            #expect(start == [genesisPath.path, "node", "start", "--json"])

            let stop = NodeServiceManager._testServiceCommand(["stop"])
            #expect(stop == [genesisPath.path, "node", "stop", "--json"])
        }
    }
}
