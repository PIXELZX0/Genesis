package ai.genesis.app.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class GenesisProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", GenesisCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", GenesisCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", GenesisCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", GenesisCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", GenesisCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", GenesisCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", GenesisCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", GenesisCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", GenesisCapability.Canvas.rawValue)
    assertEquals("camera", GenesisCapability.Camera.rawValue)
    assertEquals("voiceWake", GenesisCapability.VoiceWake.rawValue)
    assertEquals("location", GenesisCapability.Location.rawValue)
    assertEquals("sms", GenesisCapability.Sms.rawValue)
    assertEquals("device", GenesisCapability.Device.rawValue)
    assertEquals("notifications", GenesisCapability.Notifications.rawValue)
    assertEquals("system", GenesisCapability.System.rawValue)
    assertEquals("photos", GenesisCapability.Photos.rawValue)
    assertEquals("contacts", GenesisCapability.Contacts.rawValue)
    assertEquals("calendar", GenesisCapability.Calendar.rawValue)
    assertEquals("motion", GenesisCapability.Motion.rawValue)
    assertEquals("callLog", GenesisCapability.CallLog.rawValue)
  }

  @Test
  fun cameraCommandsUseStableStrings() {
    assertEquals("camera.list", GenesisCameraCommand.List.rawValue)
    assertEquals("camera.snap", GenesisCameraCommand.Snap.rawValue)
    assertEquals("camera.clip", GenesisCameraCommand.Clip.rawValue)
  }

  @Test
  fun notificationsCommandsUseStableStrings() {
    assertEquals("notifications.list", GenesisNotificationsCommand.List.rawValue)
    assertEquals("notifications.actions", GenesisNotificationsCommand.Actions.rawValue)
  }

  @Test
  fun deviceCommandsUseStableStrings() {
    assertEquals("device.status", GenesisDeviceCommand.Status.rawValue)
    assertEquals("device.info", GenesisDeviceCommand.Info.rawValue)
    assertEquals("device.permissions", GenesisDeviceCommand.Permissions.rawValue)
    assertEquals("device.health", GenesisDeviceCommand.Health.rawValue)
  }

  @Test
  fun systemCommandsUseStableStrings() {
    assertEquals("system.notify", GenesisSystemCommand.Notify.rawValue)
  }

  @Test
  fun photosCommandsUseStableStrings() {
    assertEquals("photos.latest", GenesisPhotosCommand.Latest.rawValue)
  }

  @Test
  fun contactsCommandsUseStableStrings() {
    assertEquals("contacts.search", GenesisContactsCommand.Search.rawValue)
    assertEquals("contacts.add", GenesisContactsCommand.Add.rawValue)
  }

  @Test
  fun calendarCommandsUseStableStrings() {
    assertEquals("calendar.events", GenesisCalendarCommand.Events.rawValue)
    assertEquals("calendar.add", GenesisCalendarCommand.Add.rawValue)
  }

  @Test
  fun motionCommandsUseStableStrings() {
    assertEquals("motion.activity", GenesisMotionCommand.Activity.rawValue)
    assertEquals("motion.pedometer", GenesisMotionCommand.Pedometer.rawValue)
  }

  @Test
  fun smsCommandsUseStableStrings() {
    assertEquals("sms.send", GenesisSmsCommand.Send.rawValue)
    assertEquals("sms.search", GenesisSmsCommand.Search.rawValue)
  }

  @Test
  fun callLogCommandsUseStableStrings() {
    assertEquals("callLog.search", GenesisCallLogCommand.Search.rawValue)
  }

}
