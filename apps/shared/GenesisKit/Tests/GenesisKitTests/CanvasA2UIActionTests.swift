import GenesisKit
import Foundation
import Testing

@Suite struct CanvasA2UIActionTests {
    @Test func sanitizeTagValueIsStable() {
        #expect(GenesisCanvasA2UIAction.sanitizeTagValue("Hello World!") == "Hello_World_")
        #expect(GenesisCanvasA2UIAction.sanitizeTagValue("  ") == "-")
        #expect(GenesisCanvasA2UIAction.sanitizeTagValue("macOS 26.2") == "macOS_26.2")
    }

    @Test func extractActionNameAcceptsNameOrAction() {
        #expect(GenesisCanvasA2UIAction.extractActionName(["name": "Hello"]) == "Hello")
        #expect(GenesisCanvasA2UIAction.extractActionName(["action": "Wave"]) == "Wave")
        #expect(GenesisCanvasA2UIAction.extractActionName(["name": "  ", "action": "Fallback"]) == "Fallback")
        #expect(GenesisCanvasA2UIAction.extractActionName(["action": " "]) == nil)
    }

    @Test func formatAgentMessageIsTokenEfficientAndUnambiguous() {
        let messageContext = GenesisCanvasA2UIAction.AgentMessageContext(
            actionName: "Get Weather",
            session: .init(key: "main", surfaceId: "main"),
            component: .init(id: "btnWeather", host: "Peter’s iPad", instanceId: "ipad16,6"),
            contextJSON: "{\"city\":\"Vienna\"}")
        let msg = GenesisCanvasA2UIAction.formatAgentMessage(messageContext)

        #expect(msg.contains("CANVAS_A2UI "))
        #expect(msg.contains("action=Get_Weather"))
        #expect(msg.contains("session=main"))
        #expect(msg.contains("surface=main"))
        #expect(msg.contains("component=btnWeather"))
        #expect(msg.contains("host=Peter_s_iPad"))
        #expect(msg.contains("instance=ipad16_6 ctx={\"city\":\"Vienna\"}"))
        #expect(msg.hasSuffix(" default=update_canvas"))
    }
}
