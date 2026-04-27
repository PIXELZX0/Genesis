package ai.genesis.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WakeWordsTest {
  @Test
  fun parseCommaSeparatedTrimsAndDropsEmpty() {
    assertEquals(listOf("genesis", "claude"), WakeWords.parseCommaSeparated("  genesis , claude, ,  "))
  }

  @Test
  fun sanitizeTrimsCapsAndFallsBack() {
    val defaults = listOf("genesis", "claude")
    val long = "x".repeat(WakeWords.maxWordLength + 10)
    val words = listOf(" ", "  hello  ", long)

    val sanitized = WakeWords.sanitize(words, defaults)
    assertEquals(2, sanitized.size)
    assertEquals("hello", sanitized[0])
    assertEquals("x".repeat(WakeWords.maxWordLength), sanitized[1])

    assertEquals(defaults, WakeWords.sanitize(listOf(" ", ""), defaults))
  }

  @Test
  fun sanitizeLimitsWordCount() {
    val defaults = listOf("genesis")
    val words = (1..(WakeWords.maxWords + 5)).map { "w$it" }
    val sanitized = WakeWords.sanitize(words, defaults)
    assertEquals(WakeWords.maxWords, sanitized.size)
    assertEquals("w1", sanitized.first())
    assertEquals("w${WakeWords.maxWords}", sanitized.last())
  }

  @Test
  fun parseIfChangedSkipsWhenUnchanged() {
    val current = listOf("genesis", "claude")
    val parsed = WakeWords.parseIfChanged(" genesis , claude ", current)
    assertNull(parsed)
  }

  @Test
  fun parseIfChangedReturnsUpdatedList() {
    val current = listOf("genesis")
    val parsed = WakeWords.parseIfChanged(" genesis , jarvis ", current)
    assertEquals(listOf("genesis", "jarvis"), parsed)
  }
}
