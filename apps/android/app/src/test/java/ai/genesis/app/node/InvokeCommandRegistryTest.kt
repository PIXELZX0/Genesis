package ai.genesis.app.node

import ai.genesis.app.protocol.GenesisCalendarCommand
import ai.genesis.app.protocol.GenesisCameraCommand
import ai.genesis.app.protocol.GenesisCallLogCommand
import ai.genesis.app.protocol.GenesisCapability
import ai.genesis.app.protocol.GenesisContactsCommand
import ai.genesis.app.protocol.GenesisDeviceCommand
import ai.genesis.app.protocol.GenesisLocationCommand
import ai.genesis.app.protocol.GenesisMotionCommand
import ai.genesis.app.protocol.GenesisNotificationsCommand
import ai.genesis.app.protocol.GenesisPhotosCommand
import ai.genesis.app.protocol.GenesisSmsCommand
import ai.genesis.app.protocol.GenesisSystemCommand
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InvokeCommandRegistryTest {
  private val coreCapabilities =
    setOf(
      GenesisCapability.Canvas.rawValue,
      GenesisCapability.Device.rawValue,
      GenesisCapability.Notifications.rawValue,
      GenesisCapability.System.rawValue,
      GenesisCapability.Photos.rawValue,
      GenesisCapability.Contacts.rawValue,
      GenesisCapability.Calendar.rawValue,
    )

  private val optionalCapabilities =
    setOf(
      GenesisCapability.Camera.rawValue,
      GenesisCapability.Location.rawValue,
      GenesisCapability.Sms.rawValue,
      GenesisCapability.CallLog.rawValue,
      GenesisCapability.VoiceWake.rawValue,
      GenesisCapability.Motion.rawValue,
    )

  private val coreCommands =
    setOf(
      GenesisDeviceCommand.Status.rawValue,
      GenesisDeviceCommand.Info.rawValue,
      GenesisDeviceCommand.Permissions.rawValue,
      GenesisDeviceCommand.Health.rawValue,
      GenesisNotificationsCommand.List.rawValue,
      GenesisNotificationsCommand.Actions.rawValue,
      GenesisSystemCommand.Notify.rawValue,
      GenesisPhotosCommand.Latest.rawValue,
      GenesisContactsCommand.Search.rawValue,
      GenesisContactsCommand.Add.rawValue,
      GenesisCalendarCommand.Events.rawValue,
      GenesisCalendarCommand.Add.rawValue,
    )

  private val optionalCommands =
    setOf(
      GenesisCameraCommand.Snap.rawValue,
      GenesisCameraCommand.Clip.rawValue,
      GenesisCameraCommand.List.rawValue,
      GenesisLocationCommand.Get.rawValue,
      GenesisMotionCommand.Activity.rawValue,
      GenesisMotionCommand.Pedometer.rawValue,
      GenesisSmsCommand.Send.rawValue,
      GenesisSmsCommand.Search.rawValue,
      GenesisCallLogCommand.Search.rawValue,
    )

  private val debugCommands = setOf("debug.logs", "debug.ed25519")

  @Test
  fun advertisedCapabilities_respectsFeatureAvailability() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags())

    assertContainsAll(capabilities, coreCapabilities)
    assertMissingAll(capabilities, optionalCapabilities)
  }

  @Test
  fun advertisedCapabilities_includesFeatureCapabilitiesWhenEnabled() {
    val capabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(
          cameraEnabled = true,
          locationEnabled = true,
          sendSmsAvailable = true,
          readSmsAvailable = true,
          smsSearchPossible = true,
          callLogAvailable = true,
          voiceWakeEnabled = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
        ),
      )

    assertContainsAll(capabilities, coreCapabilities + optionalCapabilities)
  }

  @Test
  fun advertisedCommands_respectsFeatureAvailability() {
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags())

    assertContainsAll(commands, coreCommands)
    assertMissingAll(commands, optionalCommands + debugCommands)
  }

  @Test
  fun advertisedCommands_includesFeatureCommandsWhenEnabled() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(
          cameraEnabled = true,
          locationEnabled = true,
          sendSmsAvailable = true,
          readSmsAvailable = true,
          smsSearchPossible = true,
          callLogAvailable = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
          debugBuild = true,
        ),
      )

    assertContainsAll(commands, coreCommands + optionalCommands + debugCommands)
  }

  @Test
  fun advertisedCommands_onlyIncludesSupportedMotionCommands() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        NodeRuntimeFlags(
          cameraEnabled = false,
          locationEnabled = false,
          sendSmsAvailable = false,
          readSmsAvailable = false,
          smsSearchPossible = false,
          callLogAvailable = false,
          voiceWakeEnabled = false,
          motionActivityAvailable = true,
          motionPedometerAvailable = false,
          debugBuild = false,
        ),
      )

    assertTrue(commands.contains(GenesisMotionCommand.Activity.rawValue))
    assertFalse(commands.contains(GenesisMotionCommand.Pedometer.rawValue))
  }

  @Test
  fun advertisedCommands_splitsSmsSendAndSearchAvailability() {
    val readOnlyCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(readSmsAvailable = true, smsSearchPossible = true),
      )
    val sendOnlyCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(sendSmsAvailable = true),
      )
    val requestableSearchCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(smsSearchPossible = true),
      )

    assertTrue(readOnlyCommands.contains(GenesisSmsCommand.Search.rawValue))
    assertFalse(readOnlyCommands.contains(GenesisSmsCommand.Send.rawValue))
    assertTrue(sendOnlyCommands.contains(GenesisSmsCommand.Send.rawValue))
    assertFalse(sendOnlyCommands.contains(GenesisSmsCommand.Search.rawValue))
    assertTrue(requestableSearchCommands.contains(GenesisSmsCommand.Search.rawValue))
  }

  @Test
  fun advertisedCapabilities_includeSmsWhenEitherSmsPathIsAvailable() {
    val readOnlyCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(readSmsAvailable = true),
      )
    val sendOnlyCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(sendSmsAvailable = true),
      )
    val requestableSearchCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(smsSearchPossible = true),
      )

    assertTrue(readOnlyCapabilities.contains(GenesisCapability.Sms.rawValue))
    assertTrue(sendOnlyCapabilities.contains(GenesisCapability.Sms.rawValue))
    assertFalse(requestableSearchCapabilities.contains(GenesisCapability.Sms.rawValue))
  }

  @Test
  fun advertisedCommands_excludesCallLogWhenUnavailable() {
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags(callLogAvailable = false))

    assertFalse(commands.contains(GenesisCallLogCommand.Search.rawValue))
  }

  @Test
  fun advertisedCapabilities_excludesCallLogWhenUnavailable() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags(callLogAvailable = false))

    assertFalse(capabilities.contains(GenesisCapability.CallLog.rawValue))
  }

  @Test
  fun advertisedCapabilities_includesVoiceWakeWithoutAdvertisingCommands() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags(voiceWakeEnabled = true))
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags(voiceWakeEnabled = true))

    assertTrue(capabilities.contains(GenesisCapability.VoiceWake.rawValue))
    assertFalse(commands.any { it.contains("voice", ignoreCase = true) })
  }

  @Test
  fun find_returnsForegroundMetadataForCameraCommands() {
    val list = InvokeCommandRegistry.find(GenesisCameraCommand.List.rawValue)
    val location = InvokeCommandRegistry.find(GenesisLocationCommand.Get.rawValue)

    assertNotNull(list)
    assertEquals(true, list?.requiresForeground)
    assertNotNull(location)
    assertEquals(false, location?.requiresForeground)
  }

  @Test
  fun find_returnsNullForUnknownCommand() {
    assertNull(InvokeCommandRegistry.find("not.real"))
  }

  private fun defaultFlags(
    cameraEnabled: Boolean = false,
    locationEnabled: Boolean = false,
    sendSmsAvailable: Boolean = false,
    readSmsAvailable: Boolean = false,
    smsSearchPossible: Boolean = false,
    callLogAvailable: Boolean = false,
    voiceWakeEnabled: Boolean = false,
    motionActivityAvailable: Boolean = false,
    motionPedometerAvailable: Boolean = false,
    debugBuild: Boolean = false,
  ): NodeRuntimeFlags =
    NodeRuntimeFlags(
      cameraEnabled = cameraEnabled,
      locationEnabled = locationEnabled,
      sendSmsAvailable = sendSmsAvailable,
      readSmsAvailable = readSmsAvailable,
      smsSearchPossible = smsSearchPossible,
      callLogAvailable = callLogAvailable,
      voiceWakeEnabled = voiceWakeEnabled,
      motionActivityAvailable = motionActivityAvailable,
      motionPedometerAvailable = motionPedometerAvailable,
      debugBuild = debugBuild,
    )

  private fun assertContainsAll(actual: List<String>, expected: Set<String>) {
    expected.forEach { value -> assertTrue(actual.contains(value)) }
  }

  private fun assertMissingAll(actual: List<String>, forbidden: Set<String>) {
    forbidden.forEach { value -> assertFalse(actual.contains(value)) }
  }
}
