package ai.genesis.app.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class GenesisCanvasA2UIActionTest {
  @Test
  fun extractActionNameAcceptsNameOrAction() {
    val nameObj = Json.parseToJsonElement("{\"name\":\"Hello\"}").jsonObject
    assertEquals("Hello", GenesisCanvasA2UIAction.extractActionName(nameObj))

    val actionObj = Json.parseToJsonElement("{\"action\":\"Wave\"}").jsonObject
    assertEquals("Wave", GenesisCanvasA2UIAction.extractActionName(actionObj))

    val fallbackObj =
      Json.parseToJsonElement("{\"name\":\"  \",\"action\":\"Fallback\"}").jsonObject
    assertEquals("Fallback", GenesisCanvasA2UIAction.extractActionName(fallbackObj))
  }

  @Test
  fun formatAgentMessageMatchesSharedSpec() {
    val msg =
      GenesisCanvasA2UIAction.formatAgentMessage(
        actionName = "Get Weather",
        sessionKey = "main",
        surfaceId = "main",
        sourceComponentId = "btnWeather",
        host = "Peter’s iPad",
        instanceId = "ipad16,6",
        contextJson = "{\"city\":\"Vienna\"}",
      )

    assertEquals(
      "CANVAS_A2UI action=Get_Weather session=main surface=main component=btnWeather host=Peter_s_iPad instance=ipad16_6 ctx={\"city\":\"Vienna\"} default=update_canvas",
      msg,
    )
  }

  @Test
  fun jsDispatchA2uiStatusIsStable() {
    val js = GenesisCanvasA2UIAction.jsDispatchA2UIActionStatus(actionId = "a1", ok = true, error = null)
    assertEquals(
      "window.dispatchEvent(new CustomEvent('genesis:a2ui-action-status', { detail: { id: \"a1\", ok: true, error: \"\" } }));",
      js,
    )
  }

  @Test
  fun jsDispatchA2uiStatusQuotesControlCharacters() {
    val js =
      GenesisCanvasA2UIAction.jsDispatchA2UIActionStatus(
        actionId = "a1\n\u2028\"",
        ok = false,
        error = "parse failed\n\t\u2029\\",
      )
    assertEquals(
      "window.dispatchEvent(new CustomEvent('genesis:a2ui-action-status', { detail: { id: \"a1\\n\\u2028\\\"\", ok: false, error: \"parse failed\\n\\t\\u2029\\\\\" } }));",
      js,
    )
  }
}
