package dev.localoperator.teambridge

import android.app.Activity
import android.app.Instrumentation
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.service.notification.StatusBarNotification
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationContent
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.model.RemoteNotificationContent
import expo.modules.notifications.notifications.model.triggers.FirebaseNotificationTrigger
import expo.modules.notifications.service.NotificationsService
import expo.modules.notifications.service.delegates.ExpoPresentationDelegate
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.FutureTask
import kotlinx.coroutines.runBlocking
import java.util.Date
import android.app.Notification as AndroidNotification

/**
 * Framework-only instrumentation for ADR 0010 S2/S4, the same shape as
 * `lop-notification-sound`'s runner: no new test dependency, a fixed case list,
 * a machine-checkable summary line (`scripts/ci/team-bridge-push-android-tests.sh`).
 *
 * WHAT IT PROVES on a real Android runtime: the API-tier gate; payload parsing;
 * every shared-fixture row through parse → spec → rendered pixels; the
 * decorator's platform MessagingStyle extras, group, PRIVATE visibility and
 * sender-free public version, at the device's real API level and at a forced
 * pre-28 tier; that Expo's extras survive recoverBuilder; the session channel
 * remap against real NotificationManager channels; the foreground rewrap; and
 * that the Expo extension points this module overrides still exist (an Expo
 * bump that renames them fails here, not on phones — ADR 0010 §9).
 *
 * WHAT IT DOES NOT PROVE: app-APK behavior, real FCM delivery, or shade rendering.
 * Launch activity and NotificationManager records here belong to the test APK.
 */
class TeamBridgePushTestRunner : Instrumentation() {
  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

  override fun onStart() {
    val cases = listOf<Pair<String, () -> Unit>>(
      "tierGate" to ::tierGate,
      "payloadParsing" to ::payloadParsing,
      "fixtureRows" to ::fixtureRows,
      "decorateMessaging" to ::decorateMessaging,
      "decoratePlainTier" to ::decoratePlainTier,
      "decorateWithoutSender" to ::decorateWithoutSender,
      "nonBridgeUntouched" to ::nonBridgeUntouched,
      "sessionRemap" to ::sessionRemap,
      "foregroundRewrap" to ::foregroundRewrap,
      "expoExtensionPoints" to ::expoExtensionPoints,
      "photoTargetRules" to ::photoTargetRules,
      "photoFetchStub" to ::photoFetchStub,
      "photoFetchAfterServerIdleClose" to ::photoFetchAfterServerIdleClose,
      "photoDecoratorFallback" to ::photoDecoratorFallback,
      "retiredPresentation" to ::retiredPresentation,
      "conversationSummary" to ::conversationSummary,
    )
    var passed = 0
    for ((i, case) in cases.withIndex()) {
      val status = Bundle().apply {
        putString("class", TeamBridgePushTestRunner::class.java.name); putString("test", case.first)
        putInt("numtests", cases.size); putInt("current", i + 1)
      }
      sendStatus(1, status)
      try { case.second(); passed++; sendStatus(0, status) }
      catch (error: Throwable) { status.putString("stack", error.stackTraceToString()); sendStatus(-2, status) }
    }
    finish(
      if (passed == cases.size) Activity.RESULT_OK else Activity.RESULT_CANCELED,
      Bundle().apply { putString("stream", "$passed/${cases.size} team bridge push native checks passed\n") },
    )
  }

  private val ctx: Context get() = targetContext

  private fun body(sender: String? = """{"kind":"person","initials":"bc","tone":1}""", conv: String? = """{"group":true,"members":3}"""): JSONObject {
    val json = JSONObject("""{"v":1,"type":"team_bridge_message","tenant_id":"t1","conversation_id":"c1","message_id":"m1","seq":4}""")
    sender?.let { json.put("sender", JSONObject(it)) }
    conv?.let { json.put("conv", JSONObject(it)) }
    return json
  }

  private fun remote(data: Map<String, String>): RemoteMessage =
    RemoteMessage.Builder("test@local-operator").setMessageId("mid-1").setData(data).build()

  private fun bridgeNotification(body: JSONObject = body()): Notification {
    val message = remote(mapOf(
      "title" to "Ben Carter", "message" to "Lunch?", "subtitle" to "#design",
      "channelId" to "team-bridge", "tag" to "tb:c1:m1", "body" to body.toString(),
    ))
    return Notification(NotificationRequest("tb:c1:m1", RemoteNotificationContent(message), FirebaseNotificationTrigger(message)), Date(1_700_000_000_000))
  }

  /** What Expo hands the decorator: a built notification carrying Expo's extras. */
  @Suppress("DEPRECATION")
  private fun expoBuilt(): AndroidNotification {
    val builder = if (Build.VERSION.SDK_INT >= 26) AndroidNotification.Builder(ctx, "team-bridge") else AndroidNotification.Builder(ctx)
    return builder.setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Ben Carter").setContentText("Lunch?").setSubText("#design")
      .setExtras(Bundle().apply { putByteArray("expo.notification_request", byteArrayOf(7, 7, 7)); putString("body", "{}") })
      .build()
  }

  private fun tierGate() {
    for (sdk in listOf(24, 25, 26, 27)) check(PresentationTier.forSdk(sdk) == PresentationTier.PLAIN) { "sdk $sdk" }
    for (sdk in listOf(28, 29)) check(PresentationTier.forSdk(sdk) == PresentationTier.MESSAGING) { "sdk $sdk" }
    for (sdk in listOf(30, 33, 36)) check(PresentationTier.forSdk(sdk) == PresentationTier.CONVERSATION) { "sdk $sdk" }
  }

  private fun payloadParsing() {
    val push = checkNotNull(BridgePushPayload.parse(body()))
    check(push.conversationKey == "tb:c1" && push.messageId == "m1")
    check(push.sender == BridgeSender(BridgeSender.Kind.PERSON, "bc", 1))
    check(push.conv == BridgeConv(true, 3))
    // v as a string, as some FCM paths stringify.
    check(BridgePushPayload.parse(body().put("v", "1")) != null)
    // Not ours, or an unknown version: never decorated.
    check(BridgePushPayload.parse(body().put("type", "session_complete")) == null)
    check(BridgePushPayload.parse(body().put("v", 2)) == null)
    check(BridgePushPayload.parse(body().put("conversation_id", "..")) == null)
    check(BridgePushPayload.parse(null) == null)
    // Absent blocks: today's notification.
    check(BridgePushPayload.parse(body(sender = null, conv = null))!!.let { it.sender == null && it.conv == null })
    // Out-of-range tone or unknown kind: no face rather than a wrong colour.
    check(BridgePushPayload.parse(body(sender = """{"kind":"person","initials":"B","tone":8}"""))!!.sender == null)
    check(BridgePushPayload.parse(body(sender = """{"kind":"robot","tone":1}"""))!!.sender == null)
    // An agent never shows letters, even if a payload carried some.
    check(BridgePushPayload.parse(body(sender = """{"kind":"agent","initials":"DT","tone":2}"""))!!.sender == BridgeSender(BridgeSender.Kind.AGENT, "", 2))
    // Initials beyond the cloud's rule become the silhouette, never a partial guess.
    check(BridgePushPayload.cleanInitials("ABC") == "")
    check(BridgePushPayload.cleanInitials("B!") == "")
    check(BridgePushPayload.cleanInitials("Ⅻ") == "Ⅻ")
    check(BridgePushPayload.cleanInitials("李") == "李")
  }

  private fun fixtureRows() {
    val text = context.assets.open("bridge_push_avatar_fixture.json").use { it.readBytes().toString(Charsets.UTF_8) }
    val rows = JSONObject(text).getJSONArray("senders")
    check(rows.length() >= 30) { "fixture rows: ${rows.length()}" }
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      val expect = row.getJSONObject("expect")
      val block = JSONObject().put("kind", row.getString("kind")).put("tone", expect.getInt("tone"))
      if (row.getString("kind") == "person") block.put("initials", expect.getString("initials"))
      val sender = checkNotNull(BridgePushPayload.sender(block)) { "row ${row.getString("name")} refused" }
      val spec = AvatarRenderer.spec(sender)
      val name = row.getString("name")
      check(spec.background == AvatarRenderer.PALETTE[expect.getInt("tone")]) { "$name tone" }
      when {
        row.getString("kind") == "agent" -> check(spec.glyph == AvatarRenderer.Glyph.Agent) { "$name agent" }
        expect.getString("initials").isEmpty() -> check(spec.glyph == AvatarRenderer.Glyph.Person) { "$name silhouette" }
        else -> check(spec.glyph == AvatarRenderer.Glyph.Initials(java.text.Normalizer.normalize(expect.getString("initials"), java.text.Normalizer.Form.NFC).uppercase(java.util.Locale.ROOT))) { "$name initials" }
      }
      val bitmap = AvatarRenderer.render(spec, 192)
      // Top-centre, inside the circle and clear of every glyph: the tone.
      check(bitmap.getPixel(96, 14) == spec.background) { "$name background pixel" }
      // A corner is outside the circle: transparent, so the OS crop has no halo.
      check(Color.alpha(bitmap.getPixel(1, 1)) == 0) { "$name corner" }
      // Something light was drawn on the tone (a glyph exists). Measured as
      // "every channel well above the background's", not "near-white": the
      // silhouette is white at 90 % alpha (core's 230), so on tone 1 its
      // blended green is ~237 and a >240 test missed it (CI, API 29 and 36).
      var ink = false
      val bg = spec.background
      for (y in 40 until 152 step 2) for (x in 40 until 152 step 2) {
        val p = bitmap.getPixel(x, y)
        if (Color.red(p) - Color.red(bg) > 60 || Color.green(p) - Color.green(bg) > 60 || Color.blue(p) - Color.blue(bg) > 60) {
          if (Color.red(p) >= Color.red(bg) && Color.green(p) >= Color.green(bg) && Color.blue(p) >= Color.blue(bg)) ink = true
        }
      }
      check(ink) { "$name drew no glyph" }
      bitmap.recycle()
    }
  }

  private fun decorateMessaging() {
    val sdk = Build.VERSION.SDK_INT
    val built = expoBuilt()
    val out = TeamBridgeDecorator.decorate(ctx, bridgeNotification(), built)
    check(out.group == "tb:c1") { "group ${out.group}" }
    check(out.visibility == AndroidNotification.VISIBILITY_PRIVATE)
    val public = checkNotNull(out.publicVersion)
    check(public.extras.getCharSequence(AndroidNotification.EXTRA_TITLE)?.toString() == PresentationStrings.hiddenPreview(ctx))
    check(public.extras.getCharSequence(AndroidNotification.EXTRA_TEXT) == null) { "public version leaks the preview" }
    check(!public.extras.containsKey("expo.notification_request")) { "public version carries Expo's request" }
    // Expo's tap/dismiss extras survive recoverBuilder.
    check(out.extras.getByteArray("expo.notification_request")?.contentEquals(byteArrayOf(7, 7, 7)) == true) { "expo extras lost" }
    if (sdk >= 28) {
      check(out.extras.getString(AndroidNotification.EXTRA_TEMPLATE) == AndroidNotification.MessagingStyle::class.java.name) { "template ${out.extras.getString(AndroidNotification.EXTRA_TEMPLATE)}" }
      check(out.extras.getBoolean(AndroidNotification.EXTRA_IS_GROUP_CONVERSATION)) { "group conversation" }
      check(out.extras.getCharSequence(AndroidNotification.EXTRA_CONVERSATION_TITLE)?.toString() == "#design")
      val messages = checkNotNull(out.extras.getParcelableArray(AndroidNotification.EXTRA_MESSAGES)) { "no messages" }
      check(messages.size == 1)
      // A DM is not a group conversation and carries no conversation title.
      val dm = TeamBridgeDecorator.decorate(ctx, bridgeNotification(body(conv = """{"group":false,"members":2}""")), expoBuilt())
      check(!dm.extras.getBoolean(AndroidNotification.EXTRA_IS_GROUP_CONVERSATION))
      check(dm.extras.getCharSequence(AndroidNotification.EXTRA_CONVERSATION_TITLE) == null)
    }
    if (sdk >= 30) {
      // This is a launcher-capable test package. On 30–32 the old exclusion
      // returns true without publishing; a mere return-value check misses it.
      val published = (ctx.getSystemService(android.content.pm.ShortcutManager::class.java)?.dynamicShortcuts ?: emptyList()).any { it.id == "tb:c1" }
      check(published) { "launcher-capable fixture failed to publish on API $sdk" }
      check(published == (out.shortcutId == "tb:c1")) { "shortcut id ${out.shortcutId} vs published $published" }
      check(published == (out.locusId?.id == "tb:c1")) { "locus ${out.locusId}" }
      // U7/D3 (PR #304): the shade draws the SHORTCUT's icon on every row of a
      // conversation, so a group shortcut must not wear the latest sender's
      // face. A published ShortcutInfo comes back with its icon stripped, so
      // the choice is checked at `shortcutFace`, the one place `publish` takes
      // its icon from.
      val benFace = AvatarRenderer.render(AvatarRenderer.spec(BridgeSender(BridgeSender.Kind.PERSON, "bc", 1)), 192)
      val adaFace = AvatarRenderer.render(AvatarRenderer.spec(BridgeSender(BridgeSender.Kind.PERSON, "al", 5)), 192)
      val conversationFace = AvatarRenderer.render(AvatarRenderer.CONVERSATION_SPEC, 192)
      val groupPush = checkNotNull(BridgePushPayload.parse(body()))
      val dmPush = checkNotNull(BridgePushPayload.parse(body(conv = """{"group":false,"members":2}""")))
      val fromBen = ConversationShortcuts.shortcutFace(groupPush, benFace)
      val fromAda = ConversationShortcuts.shortcutFace(groupPush, adaFace)
      check(fromBen.sameAs(fromAda) && fromBen.sameAs(conversationFace)) { "group shortcut icon follows the sender" }
      check(!fromBen.sameAs(benFace)) { "group shortcut wears a sender face" }
      check(ConversationShortcuts.shortcutFace(dmPush, benFace) === benFace) { "DM shortcut lost the person's face" }
    }
    // Forced MESSAGING tier on a 30+ device: no shortcut at all.
    if (sdk >= 30) {
      val m = TeamBridgeDecorator.decorate(ctx, bridgeNotification(), expoBuilt(), sdk = 29)
      check(m.shortcutId == null && m.locusId == null) { "tier 29 set a shortcut" }
    }
  }

  private fun decoratePlainTier() {
    val out = TeamBridgeDecorator.decorate(ctx, bridgeNotification(), expoBuilt(), sdk = 27)
    check(out.group == "tb:c1")
    check(out.visibility == AndroidNotification.VISIBILITY_PRIVATE && out.publicVersion != null)
    check(out.extras.getString(AndroidNotification.EXTRA_TEMPLATE) != AndroidNotification.MessagingStyle::class.java.name) { "pre-28 got MessagingStyle" }
  }

  private fun decorateWithoutSender() {
    val out = TeamBridgeDecorator.decorate(ctx, bridgeNotification(body(sender = null)), expoBuilt())
    check(out.group == "tb:c1" && out.publicVersion != null)
    check(out.extras.getString(AndroidNotification.EXTRA_TEMPLATE) != AndroidNotification.MessagingStyle::class.java.name) { "no sender must keep today's look" }
  }

  private fun nonBridgeUntouched() {
    val message = remote(mapOf("title" to "Done", "channelId" to "sound.soft-pulse", "body" to """{"type":"session_complete"}"""))
    val n = Notification(NotificationRequest("s1", RemoteNotificationContent(message), FirebaseNotificationTrigger(message)))
    val built = expoBuilt()
    check(TeamBridgeDecorator.decorate(ctx, n, built) === built)
  }

  private fun sessionRemap() {
    check(SessionChannels.deviceChannelFor("sound.soft-pulse") == "alert.soft-pulse")
    check(SessionChannels.deviceChannelFor("team-bridge") == null)
    check(SessionChannels.deviceChannelFor("sound.") == null)
    check(SessionChannels.deviceChannelFor(null) == null)
    if (Build.VERSION.SDK_INT < 26) return
    val manager = ctx.getSystemService(NotificationManager::class.java)
    val wire = "sound.rt-${System.nanoTime()}"
    val target = SessionChannels.deviceChannelFor(wire)!!
    val message = remote(mapOf("title" to "Done", "message" to "ok", "channelId" to wire, "tag" to "s-tag", "body" to """{"type":"session_complete","sessionId":"s1"}"""))
    val n = Notification(NotificationRequest("s-tag", RemoteNotificationContent(message), FirebaseNotificationTrigger(message)), Date(42))
    // Target absent: untouched (a phone that has not migrated keeps its channel).
    check(SessionChannels.remap(ctx, n) === n)
    manager.createNotificationChannel(NotificationChannel(target, "t", NotificationManager.IMPORTANCE_HIGH))
    try {
      val out = SessionChannels.remap(ctx, n)
      val trigger = out.notificationRequest.trigger as FirebaseNotificationTrigger
      check(trigger.getNotificationChannel() == target) { "channel ${trigger.getNotificationChannel()}" }
      check(out.notificationRequest.identifier == "s-tag" && out.originDate.time == 42L)
      check(out.notificationRequest.content.body?.optString("sessionId") == "s1") { "body lost" }
      check(out.notificationRequest.content.title == "Done" && out.notificationRequest.content.text == "ok")
      check((out.notificationRequest.content as RemoteNotificationContent).isDataOnly)
    } finally {
      manager.deleteNotificationChannel(target)
    }
  }

  private fun foregroundRewrap() {
    val n = bridgeNotification()
    val out = ForegroundBridge.rewrap(n, "synthetic-lease")
    val content = out.notificationRequest.content
    check(content is NotificationContent) { "still remote: the handler would drop it" }
    check(content.title == "Ben Carter" && content.text == "Lunch?" && content.subText == "#design")
    check(BridgePushPayload.parse(content.body)?.conversationId == "c1")
    check(content.body?.optString(BridgePresentationScope.LOCAL_LEASE) == "synthetic-lease")
    check(out.notificationRequest.identifier == "tb:c1:m1")
    val admitted = ForegroundBridge.rewrap(n, "synthetic-lease")
    check(admitted.notificationRequest.content.body?.optString(BridgePresentationScope.LOCAL_LEASE) == "synthetic-lease")
    check(n.notificationRequest.content.body?.has(BridgePresentationScope.LOCAL_LEASE) == false)
    check(out.notificationRequest.trigger === n.notificationRequest.trigger) { "trigger must stay (tap dataString)" }
    // A session push is left alone: its JS rule is "not shown in the foreground".
    val session = remote(mapOf("title" to "Done", "body" to """{"type":"session_complete"}"""))
    val s = Notification(NotificationRequest("s1", RemoteNotificationContent(session), FirebaseNotificationTrigger(session)))
    check(ForegroundBridge.rewrap(s) === s)
    // No title: nothing to show, left to Expo's data-only path.
    val silent = remote(mapOf("body" to body().toString()))
    val q = Notification(NotificationRequest("q", RemoteNotificationContent(silent), FirebaseNotificationTrigger(silent)))
    check(ForegroundBridge.rewrap(q) === q)
  }

  private fun expoExtensionPoints() {
    val service = LoNotificationsService()
    val present = NotificationsService::class.java.getDeclaredMethod("getPresentationDelegate", Context::class.java).apply { isAccessible = true }
    check(present.invoke(service, ctx) is LoPresentationDelegate) { "presentation override not reached" }
    val handle = NotificationsService::class.java.getDeclaredMethod("getHandlingDelegate", Context::class.java).apply { isAccessible = true }
    check(handle.invoke(service, ctx) is LoHandlingDelegate) { "handling override not reached" }
    // The suspend override's JVM shape: (Notification, NotificationBehaviorRecord, Continuation).
    check(ExpoPresentationDelegate::class.java.declaredMethods.any { it.name == "createNotification" && it.parameterTypes.size == 3 }) { "Expo renamed createNotification" }
  }

  private fun withBridgeChannel(block: (NotificationManager) -> Unit) {
    val manager = requireNotNull(ctx.getSystemService(NotificationManager::class.java))
    manager.createNotificationChannel(NotificationChannel("team-bridge", "Bridge test", NotificationManager.IMPORTANCE_HIGH))
    try { block(manager) } finally {
      BridgePresentationScope.retire(ctx, null)
      manager.cancel("session-control", 0)
      manager.deleteNotificationChannel("team-bridge")
    }
  }

  private fun retiredPresentation() = withBridgeChannel { manager ->
    BridgePresentationScope.enable(ctx, "synthetic-A")
    val lease = checkNotNull(BridgePresentationScope.current(ctx))
    val photo = """{"kind":"person","initials":"BC","tone":1,"photo":{"url":"https://unused.example","nonce":"$nonce"}}"""
    val notification = bridgeNotification(body(photo))
    val push = checkNotNull(BridgePushPayload.parse(notification.notificationRequest.content.body))
    val fetching = CountDownLatch(1)
    val resume = CountDownLatch(1)
    val delegate = LoPresentationDelegate(ctx) {
      fetching.countDown()
      check(resume.await(5, TimeUnit.SECONDS))
      null
    }
    val run = FutureTask { runBlocking { delegate.publishBridge(notification, null, push, lease) } }
    Thread(run).start()
    try {
      check(fetching.await(5, TimeUnit.SECONDS)) { "never reached photo fetch" }
      BridgePresentationScope.retire(ctx, "synthetic-A")
      check(BridgePresentationScope.current(ctx) == null) { "disabled push still admitted" }
      // New account may publish, but must not inherit the in-flight push.
      BridgePresentationScope.enable(ctx, "synthetic-B")
      check(BridgePresentationScope.current(ctx) != lease)
    } finally { resume.countDown() }
    run.get(5, TimeUnit.SECONDS)
    check(manager.activeNotifications.none { it.notification.group == "tb:c1" }) { "retired work posted" }
    if (Build.VERSION.SDK_INT >= 30) {
      val shortcuts = requireNotNull(ctx.getSystemService(android.content.pm.ShortcutManager::class.java))
      check(shortcuts.dynamicShortcuts.none { it.id == "tb:c1" }) { "retired work published a shortcut" }
    }
  }

  private fun awaitRecords(manager: NotificationManager, predicate: (List<StatusBarNotification>) -> Boolean): List<StatusBarNotification> {
    // notify/cancel enqueue work in system_server. Wait for the record, not an
    // assumed round trip duration between the framework call and the snapshot.
    val end = SystemClock.elapsedRealtime() + 5_000
    do {
      val records = manager.activeNotifications.toList()
      if (predicate(records)) return records
      SystemClock.sleep(20)
    } while (SystemClock.elapsedRealtime() < end)
    error("notification records did not converge: ${manager.activeNotifications.map { it.tag }}")
  }

  private fun conversationSummary() = withBridgeChannel { manager ->
    val delegate = LoPresentationDelegate(ctx)
    BridgePresentationScope.enable(ctx, "synthetic-A")
    val lease = checkNotNull(BridgePresentationScope.current(ctx))
    // Use the real delegate builder, notification records and Expo dismissal.
    fun post(thread: String, tag: String) {
      val original = bridgeNotification(body().put("conversation_id", thread))
      val request = original.notificationRequest
      val notification = Notification(NotificationRequest(tag, request.content, request.trigger), original.originDate)
      val push = checkNotNull(BridgePushPayload.parse(request.content.body))
      runBlocking { delegate.publishBridge(notification, null, push, lease) }
    }
    manager.notify("session-control", 0, expoBuilt())
    post("c1", "test-child-1")
    post("c1", "test-child-2")
    post("c2", "test-child-3")
    val records = awaitRecords(manager) { it.size == 6 }
    val summaries = records.filter(BridgeNotificationGroups::isSummary)
    check(summaries.map { it.notification.group }.toSet() == setOf("tb:c1", "tb:c2"))
    check(summaries.all { it.notification.groupAlertBehavior == AndroidNotification.GROUP_ALERT_CHILDREN })
    check(summaries.all { it.notification.extras.getCharSequence(AndroidNotification.EXTRA_TEXT) == null && it.notification.contentIntent == null })
    check(records.count { it.notification.group == "tb:c1" && !BridgeNotificationGroups.isSummary(it) } == 2)
    check(records.count { it.notification.group == "tb:c2" && !BridgeNotificationGroups.isSummary(it) } == 1)
    delegate.dismissNotifications(listOf("test-child-1"))
    check(awaitRecords(manager) { rows -> rows.none { it.tag == "test-child-1" } }.any { it.tag == "tb:c1" }) { "summary removed with children still present" }
    delegate.dismissNotifications(listOf("test-child-2"))
    awaitRecords(manager) { rows -> rows.none { it.notification.group == "tb:c1" } }
    BridgePresentationScope.retire(ctx, "synthetic-A")
    awaitRecords(manager) { rows -> rows.map { it.tag } == listOf("session-control") }

    BridgePresentationScope.enable(ctx, "synthetic-B")
    // Hold the framework read at A + summary while submits/cancels go to the
    // real manager. This forces both orders without racing system_server.
    fun exerciseStaleSnapshot(thread: String, postFirst: Boolean) {
      val group = "tb:$thread"
      val a = "$thread-a"
      val b = "$thread-b"
      fun submit(tag: String, snapshot: List<StatusBarNotification>? = null) {
        val child = AndroidNotification.Builder.recoverBuilder(ctx, expoBuilt()).setGroup(group).build()
        synchronized(BridgePresentationScope) {
          BridgeNotificationGroups.post(ctx, tag, BridgeNotificationGroups.CHILD_ID, child, snapshot)
        }
      }
      submit(a)
      val stale = awaitRecords(manager) { rows ->
        rows.any { it.tag == a } && rows.any { it.tag == group && BridgeNotificationGroups.isSummary(it) }
      }
      if (postFirst) submit(b, stale)
      fun dismiss(tag: String, snapshot: List<StatusBarNotification>) {
        synchronized(BridgePresentationScope) {
          manager.cancel(tag, BridgeNotificationGroups.CHILD_ID)
          BridgeNotificationGroups.prune(ctx, setOf(tag to BridgeNotificationGroups.CHILD_ID), snapshot)
        }
      }
      dismiss(a, stale)
      if (!postFirst) {
        // Positive control: the orphan really is removed, but the next post
        // still gets the pre-cancel read, not that newer framework result.
        awaitRecords(manager) { rows -> rows.none { it.notification.group == group } }
        submit(b, stale)
        synchronized(BridgePresentationScope) {
          BridgeNotificationGroups.prune(ctx, setOf(a to BridgeNotificationGroups.CHILD_ID), stale)
        }
      }
      // A later, ungrouped post is a queue witness: do not accept a brief B +
      // summary snapshot before an erroneous earlier cancel has run. Use a
      // separate tag so it cannot recreate the session alert under test.
      val witness = "$thread-witness"
      manager.notify(witness, 0, expoBuilt())
      val after = awaitRecords(manager) { rows -> rows.any { it.tag == witness } }
      check(after.none { it.tag == a } && after.any { it.tag == b } &&
        after.any { it.tag == group && BridgeNotificationGroups.isSummary(it) }) {
        "$thread did not retain the new child and summary: ${after.map { it.tag }}"
      }
      manager.cancel(witness, 0)
      check(after.any { it.tag == "session-control" }) { "pruning Bridge touched a session alert" }
      dismiss(b, after)
      check(awaitRecords(manager) { rows -> rows.none { it.notification.group == group } }
        .any { it.tag == "session-control" }) { "orphan cleanup touched a session alert" }
    }
    exerciseStaleSnapshot("post-before-prune", postFirst = true)
    exerciseStaleSnapshot("prune-before-post", postFirst = false)
  }

  // ---- ADR 0010 S5: the push-avatar photo, against a loopback stub hub ----

  private val nonce = "AbCdEfGhIjKlMnOpQrStUv" // 22 chars, base64url alphabet

  private fun photoTargetRules() {
    val hub = "https://api.radienthq.com"
    val ok = PushAvatarFetcher.Photo("https://api.radienthq.com/v1/push-avatars", nonce)
    check(PushAvatarFetcher.target(ok, hub) != null)
    // Another origin never gets a request (and so never sees the nonce).
    check(PushAvatarFetcher.target(ok.copy(url = "https://evil.example/v1/push-avatars"), hub) == null)
    check(PushAvatarFetcher.target(ok.copy(url = "https://api.radienthq.com:8443/v1/push-avatars"), hub) == null)
    check(PushAvatarFetcher.target(ok.copy(url = "http://api.radienthq.com/v1/push-avatars"), hub) == null)
    // The nonce is never accepted in a URL, and must be the 22-char shape.
    check(PushAvatarFetcher.target(ok.copy(url = "https://api.radienthq.com/v1/push-avatars?n=$nonce"), hub) == null)
    check(PushAvatarFetcher.target(ok.copy(nonce = "short"), hub) == null)
    check(PushAvatarFetcher.target(ok.copy(nonce = "AbCdEfGhIjKlMnOpQrStU/"), hub) == null)
    // No registered origin: initials only.
    check(PushAvatarFetcher.target(ok, null) == null)
    // Payload parsing carries the block through; absent stays null.
    val withPhoto = BridgePushPayload.sender(JSONObject("""{"kind":"person","initials":"BC","tone":1,"photo":{"url":"https://api.radienthq.com/v1/push-avatars","nonce":"$nonce"}}"""))
    check(withPhoto?.photo == ok) { "photo block lost" }
    check(BridgePushPayload.sender(JSONObject("""{"kind":"person","initials":"BC","tone":1,"photo":{"url":5}}"""))?.photo == null)
  }

  /** A one-response-per-connection HTTP stub on 127.0.0.1. `respond` gets the
   *  request head and writes the full response. */
  private fun <T> stub(
    respond: (String, java.io.OutputStream) -> Unit,
    clientClosed: CountDownLatch? = null,
    block: (String) -> T,
  ): T {
    val server = java.net.ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
    val thread = Thread {
      try {
        while (!server.isClosed) {
          val socket = server.accept()
          try {
            val reader = socket.getInputStream().bufferedReader()
            val head = StringBuilder()
            while (true) { val line = reader.readLine() ?: break; if (line.isEmpty()) break; head.append(line).append('\n') }
            respond(head.toString(), socket.getOutputStream())
            socket.getOutputStream().flush()
            if (clientClosed != null) {
              socket.soTimeout = 2_000
              if (socket.getInputStream().read() == -1) clientClosed.countDown()
            }
          } catch (_: java.net.SocketException) {
            // A reset also proves the in-flight socket did not stay open.
            clientClosed?.countDown()
          } catch (_: Throwable) {
          } finally { socket.close() }
        }
      } catch (_: Throwable) {}
    }.apply { isDaemon = true; start() }
    try { return block("http://127.0.0.1:${server.localPort}") } finally { server.close(); thread.join(2_000) }
  }

  private fun png(color: Int): ByteArray {
    val bmp = android.graphics.Bitmap.createBitmap(64, 64, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
    return java.io.ByteArrayOutputStream().also { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
  }

  private fun respondBytes(out: java.io.OutputStream, status: String, body: ByteArray, extra: String = "", keepAlive: Boolean = false) {
    val connection = if (keepAlive) "" else "Connection: close\r\n"
    out.write("HTTP/1.1 $status\r\nContent-Type: image/png\r\nContent-Length: ${body.size}\r\n$extra$connection\r\n".toByteArray())
    out.write(body)
  }

  private fun photoFetchStub() {
    val red = png(Color.RED)
    var seenAuth: String? = null
    var seenPath: String? = null
    // 200 with the right header: the photo, centre-cropped to a circle.
    stub({ head, out ->
      seenPath = head.lineSequence().first()
      seenAuth = head.lineSequence().firstOrNull { it.startsWith("Authorization:", ignoreCase = true) }
      respondBytes(out, "200 OK", red)
    }) { origin ->
      val bmp = checkNotNull(PushAvatarFetcher.fetch(PushAvatarFetcher.Photo("$origin/v1/push-avatars", nonce), origin, 192)) { "stub 200 not used" }
      check(bmp.getPixel(96, 96) == Color.RED) { "centre ${Integer.toHexString(bmp.getPixel(96, 96))}" }
      check(Color.alpha(bmp.getPixel(1, 1)) == 0) { "corner not transparent" }
    }
    check(seenAuth?.trim() == "Authorization: PushAvatar $nonce") { "auth header" }
    check(seenPath == "GET /v1/push-avatars HTTP/1.1") { "path carries no nonce: $seenPath" }

    // The uniform 404: initials.
    stub({ _, out -> respondBytes(out, "404 Not Found", ByteArray(0)) }) { origin ->
      check(PushAvatarFetcher.fetch(PushAvatarFetcher.Photo("$origin/v1/push-avatars", nonce), origin, 192) == null)
    }
    // A redirect is NOT followed (it could carry the header elsewhere).
    var followed = false
    stub({ head, out ->
      if (head.contains("/elsewhere")) { followed = true; respondBytes(out, "200 OK", red) }
      else respondBytes(out, "302 Found", ByteArray(0), "Location: /elsewhere\r\n")
    }) { origin ->
      check(PushAvatarFetcher.fetch(PushAvatarFetcher.Photo("$origin/v1/push-avatars", nonce), origin, 192) == null)
    }
    check(!followed) { "redirect followed" }
    // Not an image: decode fails, initials.
    stub({ _, out -> respondBytes(out, "200 OK", "not a png".toByteArray()) }) { origin ->
      check(PushAvatarFetcher.fetch(PushAvatarFetcher.Photo("$origin/v1/push-avatars", nonce), origin, 192) == null)
    }
    // A partial response must not restart the total budget, and the socket
    // must close even though the server never sends the rest of the image.
    val clientClosed = CountDownLatch(1)
    stub({ _, out ->
      Thread.sleep(350)
      out.write("HTTP/1.1 200 OK\r\nContent-Length: ${red.size}\r\nConnection: close\r\n\r\n".toByteArray())
      out.write(red, 0, 1)
    }, clientClosed) { origin ->
      val started = System.nanoTime()
      check(PushAvatarFetcher.fetch(PushAvatarFetcher.Photo("$origin/v1/push-avatars", nonce), origin, 192, budgetMs = 500) == null)
      val elapsed = (System.nanoTime() - started) / 1_000_000
      check(elapsed < 750) { "whole-fetch deadline not enforced: $elapsed ms" }
      check(clientClosed.await(1, TimeUnit.SECONDS)) { "client left slow socket open" }
    }
  }

  /**
   * #304 QA R5 Q10: the second photo push in a live process drew initials.
   * The server answers keep-alive (no `Connection: close`, like the cloud and
   * the installed-proof hub) and then closes the idle socket, as Node's 5 s
   * keep-alive timeout or a load balancer's idle timeout does between pushes.
   * A pooled socket is reused for a GET without an EOF probe and, with retries
   * off, the next fetch failed at once. Both fetches must get the photo, each
   * on its own connection.
   */
  private fun photoFetchAfterServerIdleClose() {
    val red = png(Color.RED)
    val requests = java.util.concurrent.atomic.AtomicInteger()
    stub({ _, out -> requests.incrementAndGet(); respondBytes(out, "200 OK", red, keepAlive = true) }) { origin ->
      val photo = PushAvatarFetcher.Photo("$origin/v1/push-avatars", nonce)
      checkNotNull(PushAvatarFetcher.fetch(photo, origin, 192)) { "first photo" }
      // The stub has closed its end; give the FIN time to land on the client.
      Thread.sleep(300)
      val second = checkNotNull(PushAvatarFetcher.fetch(photo, origin, 192)) { "second photo after server idle close" }
      check(second.getPixel(96, 96) == Color.RED) { "second centre ${Integer.toHexString(second.getPixel(96, 96))}" }
    }
    check(requests.get() == 2) { "stub saw ${requests.get()} requests" }
  }

  private fun photoDecoratorFallback() {
    val withPhoto = body(sender = """{"kind":"person","initials":"bc","tone":1,"photo":{"url":"https://api.radienthq.com/v1/push-avatars","nonce":"$nonce"}}""")
    var asked = 0
    // Photo fetch fails: still the messaging look, with initials.
    val out = TeamBridgeDecorator.decorate(ctx, bridgeNotification(withPhoto), expoBuilt(), photoFor = { asked++; null })
    check(asked == 1) { "photo not attempted" }
    if (Build.VERSION.SDK_INT >= 28) {
      check(out.extras.getString(AndroidNotification.EXTRA_TEMPLATE) == AndroidNotification.MessagingStyle::class.java.name)
    }
    // No photo block: never fetched.
    TeamBridgeDecorator.decorate(ctx, bridgeNotification(), expoBuilt(), photoFor = { asked++; null })
    check(asked == 1) { "fetched without a photo block" }
  }
}

/** Launcher component for the isolated test APK, not a shipping entry point. */
class BridgeTestLauncher : Activity()
