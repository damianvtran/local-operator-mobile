package com.localoperator.mobile.installedproof

import android.app.Activity
import android.app.Instrumentation
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutManager
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.model.RemoteNotificationContent
import expo.modules.notifications.notifications.model.triggers.FirebaseNotificationTrigger
import expo.modules.notifications.service.NotificationsService
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Date

/**
 * HOSTED INSTALLED-APP PROOF ONLY (scripts/ci/android-installed-app-proof/README.md).
 *
 * WHY an instrumentation in the APP's process rather than a library test APK:
 * the library runner (modules/lop-team-bridge-push androidTest) proves the
 * delegates against a self-targeting test APK, which has no launcher icon, no
 * app channels created by the real JS, no tap router and no Team Bridge
 * screens. This runner is compiled into a job-only `androidTest` source set of
 * the generated `android/app` project, signed with the SAME debug key, and
 * targets the real app package, so `NotificationsService.receive` delivers to the
 * app's own merged-manifest receiver (LoNotificationsService) exactly as
 * Expo's FirebaseMessagingDelegate does after an FCM delivery
 * (expo-notifications 57.0.21 FirebaseMessagingDelegate.onMessageReceived:
 * identifier = data["tag"] ?: messageId, then NotificationsService.receive).
 *
 * WHY a loopback command socket rather than one instrumentation per step: `am
 * instrument` force-restarts the target process, so a per-step instrumentation
 * could never post into a WARM app (foreground suppression, warm tap). One
 * long-lived `serve` instrumentation launches the app's own launcher activity
 * in this process and then waits for line-delimited JSON commands on
 * 127.0.0.1:54833, reachable only through `adb forward` from the runner. It is
 * not a receiver, is not exported, and exists only in the test APK, which the
 * normal build never produces.
 *
 * Nothing here touches FCM, a production endpoint or a credential. Framework
 * APIs only plus the two artifacts the app already links (expo-notifications,
 * firebase-messaging for the RemoteMessage model class), same choice as the
 * module's own runner.
 */
class InstalledAppProofRunner : Instrumentation() {
  private var args: Bundle = Bundle()
  private val ctx: Context get() = targetContext

  override fun onCreate(arguments: Bundle?) {
    super.onCreate(arguments)
    args = arguments ?: Bundle()
    start()
  }

  override fun onStart() {
    val result = Bundle()
    try {
      when (args.getString("mode", "serve")) {
        "serve" -> serve()
        "identity" -> result.putString("identity", identity().toString())
        else -> error("unknown mode")
      }
      result.putString("lop_proof", "ok")
      finish(Activity.RESULT_OK, result)
    } catch (t: Throwable) {
      result.putString("lop_proof", "error: ${t.javaClass.simpleName}: ${t.message}")
      finish(Activity.RESULT_CANCELED, result)
    }
  }

  /** What preflight compares: the driver must target the app it was built for. */
  private fun identity() = JSONObject()
    .put("target", ctx.packageName)
    .put("driver", context.packageName)
    .put("sdk", Build.VERSION.SDK_INT)
    .put("receiver", receiverName())

  private fun receiverName(): String? {
    val intent = Intent("expo.modules.notifications.NOTIFICATION_EVENT").setPackage(ctx.packageName)
    @Suppress("DEPRECATION")
    return ctx.packageManager.queryBroadcastReceivers(intent, 0).firstOrNull()?.activityInfo?.name
  }

  private fun serve() {
    ServerSocket(PORT, 4, InetAddress.getByName("127.0.0.1")).use { server ->
      // Launch AFTER the socket is bound: the host's readiness probe is "socket
      // answers `ping`", so the app cannot start before the driver can see it.
      launchApp()
      while (true) {
        server.accept().use { socket ->
          val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
          val writer = PrintWriter(socket.getOutputStream(), true)
          val line = reader.readLine() ?: return@use
          val command = JSONObject(line)
          val op = command.optString("op")
          val reply = try {
            JSONObject().put("ok", true).put("result", handle(op, command))
          } catch (t: Throwable) {
            JSONObject().put("ok", false).put("error", "${t.javaClass.simpleName}: ${t.message}")
          }
          writer.println(reply.toString())
          writer.flush()
          if (op == "finish") return
          if (op == "die") {
            // Process death with the notifications left in the shade: the next
            // tap is a COLD start. Force-stop is not used because it cancels the
            // app's notifications and would erase the thing under test.
            SystemClock.sleep(300)
            Process.killProcess(Process.myPid())
          }
        }
      }
    }
  }

  private fun launchApp() {
    val launch = requireNotNull(ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)) { "no launcher activity" }
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(launch)
  }

  private fun handle(op: String, c: JSONObject): Any = when (op) {
    "ping" -> identity()
    "lease" -> { invokeObject("BridgePresentationScope", "enable", c.getString("account")); current() }
    "origin" -> { invokeObject("HubOrigin", "save", c.getString("origin")); c.getString("origin") }
    "post" -> post(c)
    "active" -> active()
    "channels" -> channels()
    "shortcuts" -> shortcuts()
    "finish", "die" -> "bye"
    else -> error("unknown op $op")
  }

  /** The module's state objects are Kotlin `internal`; their members are public
   *  JVM methods on a non-public class, reached reflectively from this other
   *  Gradle module. The harness seeds what a successful push REGISTRATION would
   *  have set (no FCM token exists here) and records that it did so. */
  private fun invokeObject(name: String, method: String, value: String) {
    val cls = Class.forName("dev.localoperator.teambridge.$name")
    val instance = cls.getField("INSTANCE").get(null)
    cls.getMethod(method, Context::class.java, String::class.java).apply { isAccessible = true }.invoke(instance, ctx, value)
  }

  private fun current(): Any? {
    val cls = Class.forName("dev.localoperator.teambridge.BridgePresentationScope")
    return cls.getMethod("current", Context::class.java).invoke(cls.getField("INSTANCE").get(null), ctx) != null
  }

  /** A RemoteMessage shaped as agent-server's bridge push / the relay's session
   *  push, wrapped exactly as FirebaseMessagingDelegate.createNotification does. */
  private fun post(c: JSONObject): JSONObject {
    val data = c.getJSONObject("data")
    val map = data.keys().asSequence().associateWith { data.getString(it) }
    val message = RemoteMessage.Builder("proof@local-operator.invalid")
      .setMessageId(c.optString("messageId", "proof-${SystemClock.elapsedRealtimeNanos()}"))
      .setData(map)
      .build()
    val identifier = message.data["tag"] ?: message.messageId!!
    val notification = Notification(
      NotificationRequest(identifier, RemoteNotificationContent(message), FirebaseNotificationTrigger(message)),
      Date(),
    )
    NotificationsService.receive(ctx, notification)
    // Presentation is asynchronous (broadcast → delegate → JS handler when
    // foregrounded). Wait for the tag, or the whole window when absence is the
    // expectation (foreground same-thread suppression).
    val deadline = SystemClock.uptimeMillis() + c.optLong("waitMs", 8_000)
    val expectAbsent = c.optBoolean("expectAbsent", false)
    var present = false
    while (SystemClock.uptimeMillis() < deadline) {
      present = manager().activeNotifications.any { it.tag == identifier }
      if (present && !expectAbsent) break
      SystemClock.sleep(200)
    }
    return JSONObject().put("identifier", identifier).put("present", present)
  }

  private fun manager() = ctx.getSystemService(NotificationManager::class.java)

  private fun active(): JSONArray {
    val out = JSONArray()
    for (sbn in manager().activeNotifications) {
      val n = sbn.notification
      val extras = n.extras
      out.put(JSONObject()
        .put("tag", sbn.tag).put("id", sbn.id).put("group", n.group)
        .put("isGroupSummary", (n.flags and android.app.Notification.FLAG_GROUP_SUMMARY) != 0)
        .put("channel", if (Build.VERSION.SDK_INT >= 26) n.channelId else null)
        .put("shortcutId", if (Build.VERSION.SDK_INT >= 26) n.shortcutId else null)
        .put("locusId", if (Build.VERSION.SDK_INT >= 29) n.locusId?.id else null)
        .put("visibility", n.visibility)
        .put("hasPublicVersion", n.publicVersion != null)
        .put("publicText", n.publicVersion?.extras?.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString())
        .put("template", extras.getString(android.app.Notification.EXTRA_TEMPLATE))
        .put("title", extras.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString())
        .put("conversationTitle", extras.getCharSequence(android.app.Notification.EXTRA_CONVERSATION_TITLE)?.toString())
        .put("messages", extras.getParcelableArray(android.app.Notification.EXTRA_MESSAGES)?.size ?: 0)
        .put("hasLargeIcon", extras.get(android.app.Notification.EXTRA_LARGE_ICON) != null || (Build.VERSION.SDK_INT >= 23 && n.getLargeIcon() != null))
        .put("number", n.number)
        .put("badgeIconType", if (Build.VERSION.SDK_INT >= 26) n.badgeIconType else null))
    }
    return out
  }

  private fun channels(): JSONArray {
    val out = JSONArray()
    if (Build.VERSION.SDK_INT < 26) return out
    for (ch in manager().notificationChannels) {
      out.put(JSONObject().put("id", ch.id).put("name", ch.name?.toString())
        .put("importance", ch.importance).put("lockscreenVisibility", ch.lockscreenVisibility)
        .put("showBadge", ch.canShowBadge())
        .put("conversationId", if (Build.VERSION.SDK_INT >= 30) ch.conversationId else null)
        .put("parent", if (Build.VERSION.SDK_INT >= 30) ch.parentChannelId else null))
    }
    return out
  }

  private fun shortcuts(): JSONArray {
    val out = JSONArray()
    if (Build.VERSION.SDK_INT < 25) return out
    val sm = ctx.getSystemService(ShortcutManager::class.java)
    val all = if (Build.VERSION.SDK_INT >= 30) {
      sm.getShortcuts(ShortcutManager.FLAG_MATCH_DYNAMIC or ShortcutManager.FLAG_MATCH_CACHED or ShortcutManager.FLAG_MATCH_PINNED)
    } else sm.dynamicShortcuts
    for (s in all) {
      out.put(JSONObject().put("id", s.id).put("shortLabel", s.shortLabel?.toString())
        .put("longLived", if (Build.VERSION.SDK_INT >= 30) s.isLongLived else null)
        .put("cached", if (Build.VERSION.SDK_INT >= 30) s.isCached else null)
        .put("dynamic", s.isDynamic)
        .put("persons", if (Build.VERSION.SDK_INT >= 29) (s.persons?.size ?: 0) else null)
        .put("locusId", if (Build.VERSION.SDK_INT >= 29) s.locusId?.id else null))
    }
    return out
  }

  companion object {
    const val PORT = 54833
  }
}
