package ai.genesis.app.node

import ai.genesis.app.protocol.GenesisCalendarCommand
import ai.genesis.app.protocol.GenesisCanvasA2UICommand
import ai.genesis.app.protocol.GenesisCanvasCommand
import ai.genesis.app.protocol.GenesisCameraCommand
import ai.genesis.app.protocol.GenesisCapability
import ai.genesis.app.protocol.GenesisCallLogCommand
import ai.genesis.app.protocol.GenesisContactsCommand
import ai.genesis.app.protocol.GenesisDeviceCommand
import ai.genesis.app.protocol.GenesisLocationCommand
import ai.genesis.app.protocol.GenesisMotionCommand
import ai.genesis.app.protocol.GenesisNotificationsCommand
import ai.genesis.app.protocol.GenesisPhotosCommand
import ai.genesis.app.protocol.GenesisSmsCommand
import ai.genesis.app.protocol.GenesisSystemCommand

data class NodeRuntimeFlags(
  val cameraEnabled: Boolean,
  val locationEnabled: Boolean,
  val sendSmsAvailable: Boolean,
  val readSmsAvailable: Boolean,
  val smsSearchPossible: Boolean,
  val callLogAvailable: Boolean,
  val voiceWakeEnabled: Boolean,
  val motionActivityAvailable: Boolean,
  val motionPedometerAvailable: Boolean,
  val debugBuild: Boolean,
)

enum class InvokeCommandAvailability {
  Always,
  CameraEnabled,
  LocationEnabled,
  SendSmsAvailable,
  ReadSmsAvailable,
  RequestableSmsSearchAvailable,
  CallLogAvailable,
  MotionActivityAvailable,
  MotionPedometerAvailable,
  DebugBuild,
}

enum class NodeCapabilityAvailability {
  Always,
  CameraEnabled,
  LocationEnabled,
  SmsAvailable,
  CallLogAvailable,
  VoiceWakeEnabled,
  MotionAvailable,
}

data class NodeCapabilitySpec(
  val name: String,
  val availability: NodeCapabilityAvailability = NodeCapabilityAvailability.Always,
)

data class InvokeCommandSpec(
  val name: String,
  val requiresForeground: Boolean = false,
  val availability: InvokeCommandAvailability = InvokeCommandAvailability.Always,
)

object InvokeCommandRegistry {
  val capabilityManifest: List<NodeCapabilitySpec> =
    listOf(
      NodeCapabilitySpec(name = GenesisCapability.Canvas.rawValue),
      NodeCapabilitySpec(name = GenesisCapability.Device.rawValue),
      NodeCapabilitySpec(name = GenesisCapability.Notifications.rawValue),
      NodeCapabilitySpec(name = GenesisCapability.System.rawValue),
      NodeCapabilitySpec(
        name = GenesisCapability.Camera.rawValue,
        availability = NodeCapabilityAvailability.CameraEnabled,
      ),
      NodeCapabilitySpec(
        name = GenesisCapability.Sms.rawValue,
        availability = NodeCapabilityAvailability.SmsAvailable,
      ),
      NodeCapabilitySpec(
        name = GenesisCapability.VoiceWake.rawValue,
        availability = NodeCapabilityAvailability.VoiceWakeEnabled,
      ),
      NodeCapabilitySpec(
        name = GenesisCapability.Location.rawValue,
        availability = NodeCapabilityAvailability.LocationEnabled,
      ),
      NodeCapabilitySpec(name = GenesisCapability.Photos.rawValue),
      NodeCapabilitySpec(name = GenesisCapability.Contacts.rawValue),
      NodeCapabilitySpec(name = GenesisCapability.Calendar.rawValue),
      NodeCapabilitySpec(
        name = GenesisCapability.Motion.rawValue,
        availability = NodeCapabilityAvailability.MotionAvailable,
      ),
      NodeCapabilitySpec(
        name = GenesisCapability.CallLog.rawValue,
        availability = NodeCapabilityAvailability.CallLogAvailable,
      ),
    )

  val all: List<InvokeCommandSpec> =
    listOf(
      InvokeCommandSpec(
        name = GenesisCanvasCommand.Present.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = GenesisCanvasCommand.Hide.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = GenesisCanvasCommand.Navigate.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = GenesisCanvasCommand.Eval.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = GenesisCanvasCommand.Snapshot.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = GenesisCanvasA2UICommand.Push.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = GenesisCanvasA2UICommand.PushJSONL.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = GenesisCanvasA2UICommand.Reset.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = GenesisSystemCommand.Notify.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisCameraCommand.List.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = GenesisCameraCommand.Snap.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = GenesisCameraCommand.Clip.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = GenesisLocationCommand.Get.rawValue,
        availability = InvokeCommandAvailability.LocationEnabled,
      ),
      InvokeCommandSpec(
        name = GenesisDeviceCommand.Status.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisDeviceCommand.Info.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisDeviceCommand.Permissions.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisDeviceCommand.Health.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisNotificationsCommand.List.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisNotificationsCommand.Actions.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisPhotosCommand.Latest.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisContactsCommand.Search.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisContactsCommand.Add.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisCalendarCommand.Events.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisCalendarCommand.Add.rawValue,
      ),
      InvokeCommandSpec(
        name = GenesisMotionCommand.Activity.rawValue,
        availability = InvokeCommandAvailability.MotionActivityAvailable,
      ),
      InvokeCommandSpec(
        name = GenesisMotionCommand.Pedometer.rawValue,
        availability = InvokeCommandAvailability.MotionPedometerAvailable,
      ),
      InvokeCommandSpec(
        name = GenesisSmsCommand.Send.rawValue,
        availability = InvokeCommandAvailability.SendSmsAvailable,
      ),
      InvokeCommandSpec(
        name = GenesisSmsCommand.Search.rawValue,
        availability = InvokeCommandAvailability.RequestableSmsSearchAvailable,
      ),
      InvokeCommandSpec(
        name = GenesisCallLogCommand.Search.rawValue,
        availability = InvokeCommandAvailability.CallLogAvailable,
      ),
      InvokeCommandSpec(
        name = "debug.logs",
        availability = InvokeCommandAvailability.DebugBuild,
      ),
      InvokeCommandSpec(
        name = "debug.ed25519",
        availability = InvokeCommandAvailability.DebugBuild,
      ),
    )

  private val byNameInternal: Map<String, InvokeCommandSpec> = all.associateBy { it.name }

  fun find(command: String): InvokeCommandSpec? = byNameInternal[command]

  fun advertisedCapabilities(flags: NodeRuntimeFlags): List<String> {
    return capabilityManifest
      .filter { spec ->
        when (spec.availability) {
          NodeCapabilityAvailability.Always -> true
          NodeCapabilityAvailability.CameraEnabled -> flags.cameraEnabled
          NodeCapabilityAvailability.LocationEnabled -> flags.locationEnabled
          NodeCapabilityAvailability.SmsAvailable -> flags.sendSmsAvailable || flags.readSmsAvailable
          NodeCapabilityAvailability.CallLogAvailable -> flags.callLogAvailable
          NodeCapabilityAvailability.VoiceWakeEnabled -> flags.voiceWakeEnabled
          NodeCapabilityAvailability.MotionAvailable -> flags.motionActivityAvailable || flags.motionPedometerAvailable
        }
      }
      .map { it.name }
  }

  fun advertisedCommands(flags: NodeRuntimeFlags): List<String> {
    return all
      .filter { spec ->
        when (spec.availability) {
          InvokeCommandAvailability.Always -> true
          InvokeCommandAvailability.CameraEnabled -> flags.cameraEnabled
          InvokeCommandAvailability.LocationEnabled -> flags.locationEnabled
          InvokeCommandAvailability.SendSmsAvailable -> flags.sendSmsAvailable
          InvokeCommandAvailability.ReadSmsAvailable -> flags.readSmsAvailable
          InvokeCommandAvailability.RequestableSmsSearchAvailable -> flags.smsSearchPossible
          InvokeCommandAvailability.CallLogAvailable -> flags.callLogAvailable
          InvokeCommandAvailability.MotionActivityAvailable -> flags.motionActivityAvailable
          InvokeCommandAvailability.MotionPedometerAvailable -> flags.motionPedometerAvailable
          InvokeCommandAvailability.DebugBuild -> flags.debugBuild
        }
      }
      .map { it.name }
  }
}
