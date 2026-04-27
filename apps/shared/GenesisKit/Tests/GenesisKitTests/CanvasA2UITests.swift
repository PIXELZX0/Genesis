import GenesisKit
import Testing

@Suite struct CanvasA2UITests {
    @Test func commandStringsAreStable() {
        #expect(GenesisCanvasA2UICommand.push.rawValue == "canvas.a2ui.push")
        #expect(GenesisCanvasA2UICommand.pushJSONL.rawValue == "canvas.a2ui.pushJSONL")
        #expect(GenesisCanvasA2UICommand.reset.rawValue == "canvas.a2ui.reset")
    }

    @Test func jsonlDecodesAndValidatesV0_8() throws {
        let jsonl = """
        {"beginRendering":{"surfaceId":"main","timestamp":1}}
        {"surfaceUpdate":{"surfaceId":"main","ops":[]}}
        {"dataModelUpdate":{"dataModel":{"title":"Hello"}}}
        {"deleteSurface":{"surfaceId":"main"}}
        """

        let messages = try GenesisCanvasA2UIJSONL.decodeMessagesFromJSONL(jsonl)
        #expect(messages.count == 4)
    }

    @Test func jsonlRejectsV0_9CreateSurface() {
        let jsonl = """
        {"createSurface":{"surfaceId":"main"}}
        """

        #expect(throws: Error.self) {
            _ = try GenesisCanvasA2UIJSONL.decodeMessagesFromJSONL(jsonl)
        }
    }

    @Test func jsonlRejectsUnknownShape() {
        let jsonl = """
        {"wat":{"nope":1}}
        """

        #expect(throws: Error.self) {
            _ = try GenesisCanvasA2UIJSONL.decodeMessagesFromJSONL(jsonl)
        }
    }
}
