import Testing
@testable import Genesis

@Suite(.serialized) struct GenesisAppDelegateTests {
    @Test @MainActor func resolvesRegistryModelBeforeViewTaskAssignsDelegateModel() {
        let registryModel = NodeAppModel()
        GenesisAppModelRegistry.appModel = registryModel
        defer { GenesisAppModelRegistry.appModel = nil }

        let delegate = GenesisAppDelegate()

        #expect(delegate._test_resolvedAppModel() === registryModel)
    }

    @Test @MainActor func prefersExplicitDelegateModelOverRegistryFallback() {
        let registryModel = NodeAppModel()
        let explicitModel = NodeAppModel()
        GenesisAppModelRegistry.appModel = registryModel
        defer { GenesisAppModelRegistry.appModel = nil }

        let delegate = GenesisAppDelegate()
        delegate.appModel = explicitModel

        #expect(delegate._test_resolvedAppModel() === explicitModel)
    }
}
