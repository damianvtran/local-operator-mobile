package dev.localoperator.teambridge

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.notification.StatusBarNotification
import java.util.UUID

/** One generic summary per conversation. It is not an Expo message or a tap
 * target, and GROUP_ALERT_CHILDREN leaves the child's original alert policy in
 * charge. Never copy sender, preview, avatar or Expo extras into a summary. */
internal object BridgeNotificationGroups {
  const val CHILD_REMOVED = "dev.localoperator.teambridge.CHILD_REMOVED"
  const val CHILD_ID = 0 // Expo’s default getNotifyId().
  private const val SUMMARY_ID = 1
  private const val SUBMISSION = "dev.localoperator.teambridge.groupSubmission"
  private data class Submission(val group: String?, val stamp: String)

  // notify/cancel queue work in system_server. The presentation lock owns both
  // collections; a snapshot acknowledges a submission, not just a reused tag.
  private val unobserved = mutableMapOf<Pair<String?, Int>, Submission>()
  private val cancelingSummaries = mutableSetOf<String>()

  private fun manager(context: Context) = requireNotNull(context.getSystemService(NotificationManager::class.java))

  fun isSummary(record: StatusBarNotification): Boolean = record.id == SUMMARY_ID &&
    isBridge(record) && record.tag == record.notification.group &&
    record.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0

  private fun isBridge(record: StatusBarNotification): Boolean =
    record.notification.group?.startsWith(BridgePush.KEY_PREFIX) == true

  private fun observe(lease: String, snapshot: List<StatusBarNotification>): List<StatusBarNotification> {
    // An account/channel retirement can leave old records visible until its
    // queued cancels execute; those records cannot acknowledge the new lease.
    val current = snapshot.filter {
      it.notification.extras.getString(SUBMISSION)?.startsWith("$lease:") == true
    }
    val summaries = current.filter(::isSummary).mapNotNull { it.tag }.toSet()
    cancelingSummaries.retainAll(summaries)
    return current.filter { record ->
      val key = record.tag to record.id
      val matches = unobserved[key]?.stamp == record.notification.extras.getString(SUBMISSION)
      if (matches) {
        unobserved.remove(key)
        if (isSummary(record)) record.tag?.let(cancelingSummaries::remove)
      }
      // Seeing the old summary after cancel (even after queuing its replacement)
      // does not let us reuse it or mark the replacement as delivered.
      isBridge(record) && (!isSummary(record) || record.tag !in cancelingSummaries)
    }
  }

  private fun submit(system: NotificationManager, lease: String, tag: String, id: Int, notification: Notification) {
    val stamp = "$lease:${UUID.randomUUID()}"
    notification.extras.putString(SUBMISSION, stamp)
    unobserved[tag to id] = Submission(notification.group, stamp)
    system.notify(tag, id, notification)
  }

  @Suppress("DEPRECATION")
  fun post(context: Context, tag: String, id: Int, child: Notification, snapshot: List<StatusBarNotification>? = null) {
    val lease = BridgePresentationScope.current(context) ?: return
    val system = manager(context)
    val active = observe(lease, snapshot ?: system.activeNotifications.toList())
    if (!system.areNotificationsEnabled()) return
    if (Build.VERSION.SDK_INT >= 26 &&
      system.getNotificationChannel(child.channelId)?.importance == NotificationManager.IMPORTANCE_NONE) return
    val group = child.group
    val icon = child.smallIcon
    if (group == null || icon == null) {
      submit(system, lease, tag, id, child)
      return
    }
    // Match the individual child's tap/dismiss lifecycle, without changing its
    // Expo content intent. A swipe of the child needs cleanup even with no JS.
    child.deleteIntent = PendingIntent.getBroadcast(context, 0,
      Intent(context, LoNotificationsService::class.java).apply {
        action = CHILD_REMOVED
        data = Uri.Builder().scheme("localoperator").authority("bridge-child-removed").appendPath(tag).build()
      }, PendingIntent.FLAG_IMMUTABLE)
    submit(system, lease, tag, id, child)
    if (active.any { isSummary(it) && it.tag == group } || (group to SUMMARY_ID) in unobserved) return
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      Notification.Builder(context, child.channelId)
        .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
    } else Notification.Builder(context)
    val summary = builder
      .setSmallIcon(icon)
      .setColor(child.color)
      .setContentTitle(PresentationStrings.hiddenPreview(context))
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setGroup(group)
      .setGroupSummary(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .build()
    submit(system, lease, group, SUMMARY_ID, summary)
  }

  /** Cancel only orphan Bridge summaries; never infer membership from an Expo
   * message tag. Some Android versions do not remove app-posted summaries. */
  fun prune(context: Context, removed: Set<Pair<String?, Int>> = emptySet(), snapshot: List<StatusBarNotification>? = null) {
    val lease = BridgePresentationScope.current(context) ?: return
    val system = manager(context)
    val records = observe(lease, snapshot ?: system.activeNotifications.toList())
    unobserved.keys.removeAll(removed)
    val remaining = records.filterNot { isSummary(it) || (it.tag to it.id) in removed }
      .mapTo(mutableSetOf<String?>()) { it.notification.group }
    val summaries = records.filter(::isSummary).mapNotNullTo(mutableSetOf()) { it.tag }
    unobserved.forEach { (key, submission) ->
      if (key.second == SUMMARY_ID) submission.group?.let(summaries::add)
      else remaining.add(submission.group)
    }
    for (group in summaries) {
      if (group in remaining) continue
      unobserved.remove(group to SUMMARY_ID)
      cancelingSummaries.add(group)
      system.cancel(group, SUMMARY_ID)
    }
  }

  fun removeAll(context: Context) {
    try {
      val system = manager(context)
      val active = system.activeNotifications.filter(::isBridge).map { it.tag to it.id }
      (unobserved.keys + active).forEach { (tag, id) -> system.cancel(tag, id) }
    } finally {
      unobserved.clear()
      cancelingSummaries.clear()
    }
  }
}
