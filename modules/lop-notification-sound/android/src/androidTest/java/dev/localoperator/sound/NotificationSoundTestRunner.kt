package dev.localoperator.sound

import android.app.Activity
import android.app.Instrumentation
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ProviderInfo
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.Process
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest

/** Framework-only instrumentation: no new runner/test dependency. These tests
 * perform real private-file publication/open/unlink and channel resurrection
 * on the disposable library test APK. They never play audio. Permission-policy
 * injection below tests our additional check, NOT NMS grants to another UID;
 * separate receiver APK / actual notification delivery remain device gates.
 */
class NotificationSoundTestRunner : Instrumentation() {
  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
  override fun onStart() {
    val cases = listOf<Pair<String, () -> Unit>>(
      "manifest" to ::manifest,
      "uriPolicy" to ::uriPolicy,
      "openAndWriteDenials" to ::openAndWriteDenials,
      "permissionPolicy" to ::permissionPolicy,
      "sameDigestReCache" to ::sameDigestReCache,
      "allocationNegativeControl" to ::allocationNegativeControl,
      "crashRecovery" to ::crashRecovery,
    )
    var passed = 0
    for ((i, case) in cases.withIndex()) {
      val status = Bundle().apply {
        putString("class", NotificationSoundTestRunner::class.java.name); putString("test", case.first)
        putInt("numtests", cases.size); putInt("current", i + 1)
      }
      sendStatus(1, status)
      try { case.second(); passed++; sendStatus(0, status) }
      catch (error: Throwable) {
        status.putString("stack", error.stackTraceToString()); sendStatus(-2, status)
      }
    }
    finish(if (passed == cases.size) Activity.RESULT_OK else Activity.RESULT_CANCELED, Bundle().apply { putString("stream", "$passed/${cases.size} notification sound native checks passed\n") })
  }

  private val bytes = byteArrayOf(1, 2, 3, 4) // IO fixture only, never scheduled/played.
  private val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
  private val otherSha = "a".repeat(64)
  private fun uri(digest: String = sha) = NotificationSoundFiles.uri(targetContext.packageName, digest)
  private fun disposable(block: (Context, NotificationSoundProvider) -> Unit) {
    check(targetContext.packageName.endsWith(".test")) { "Disposable library test APK required" }
    val scratch = File(targetContext.cacheDir, "sound-provider-test-${System.nanoTime()}")
    check(scratch.mkdirs())
    val owner = object : ContextWrapper(targetContext) { override fun getFilesDir() = scratch }
    val provider = NotificationSoundProvider()
    provider.attachInfo(owner, ProviderInfo().apply {
      authority = "${owner.packageName}.notification-sounds"
      applicationInfo = owner.applicationInfo; exported = false; grantUriPermissions = true
    })
    try { block(owner, provider) } finally { provider.shutdown(); check(scratch.deleteRecursively()) }
  }
  private inline fun <reified T : Throwable> refuses(block: () -> Unit) {
    try { block() } catch (error: Throwable) { check(error is T) { "Expected ${T::class.java.name}, got $error" }; return }
    error("Expected ${T::class.java.name}")
  }
  private fun manifest() {
    val info = targetContext.packageManager.resolveContentProvider("${targetContext.packageName}.notification-sounds", 0)
      ?: error("Provider absent from compiled test manifest")
    check(!info.exported && info.grantUriPermissions)
    check(info.name == NotificationSoundProvider::class.java.name)
  }
  private fun uriPolicy() {
    check(NotificationSoundFiles.digest(targetContext.packageName, uri()) == sha)
    refuses<IllegalArgumentException> { NotificationSoundFiles.uri(targetContext.packageName, "../index") }
    refuses<IllegalArgumentException> { NotificationSoundFiles.file(targetContext.filesDir, sha.uppercase()) }
    val base = "content://${targetContext.packageName}.notification-sounds"
    val bad = listOf(
      "$base/v1/../$sha.wav", "$base/v1/%2e%2e/$sha.wav", "$base/v1/%2f$sha.wav",
      "$base/v1/$sha.wav/extra", "$base/v1/$sha.wav?x=1", "$base/v1/$sha.wav#x",
      "$base/v1/${sha.uppercase()}.wav", "$base/v1/${sha.drop(1)}.wav",
      "$base/v1/$sha.pending", "$base/notification-sound-index.json",
      "content://foreign/v1/$sha.wav", "file:///v1/$sha.wav",
    )
    for (value in bad) check(NotificationSoundFiles.digest(targetContext.packageName, Uri.parse(value)) == null) { value }
  }
  private fun openAndWriteDenials() = disposable { owner, provider ->
    refuses<FileNotFoundException> { provider.openFile(uri(), "r") }
    NotificationSoundFiles.publish(owner.filesDir, sha, bytes)
    val read = ParcelFileDescriptor.AutoCloseInputStream(provider.openFile(uri(), "r")).use { it.readBytes() }
    check(read.contentEquals(bytes))
    for (mode in listOf("w", "rw", "rwt", "wa", "wt")) refuses<SecurityException> { provider.openFile(uri(), mode) }
    refuses<UnsupportedOperationException> { provider.insert(uri(), null) }
    refuses<UnsupportedOperationException> { provider.update(uri(), null, null, null) }
    refuses<UnsupportedOperationException> { provider.delete(uri(), null, null) }
    refuses<UnsupportedOperationException> { provider.query(uri(), null, null, null, null) }
    refuses<FileNotFoundException> { provider.openFile(uri().buildUpon().appendPath("extra").build(), "r") }
    // No symlink can smuggle an unrelated private file into the provider.
    val outside = File(owner.filesDir, "outside").apply { writeBytes(bytes) }
    val final = NotificationSoundFiles.file(owner.filesDir, sha)
    check(final.delete()); android.system.Os.symlink(outside.path, final.path)
    refuses<FileNotFoundException> { provider.openFile(uri(), "r") }
  }
  private fun permissionPolicy() = disposable { owner, provider ->
    val stranger = Process.myUid() + 10000
    val granted = object : ContextWrapper(owner) {
      override fun checkUriPermission(value: Uri, pid: Int, uid: Int, flags: Int): Int =
        if (uid == stranger && value == uri() && flags == Intent.FLAG_GRANT_READ_URI_PERMISSION)
          PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED
    }
    provider.enforceReader(granted, uri(), 1, Process.myUid()) // own UID
    provider.enforceReader(granted, uri(), 1, stranger) // exact temporary READ grant
    refuses<SecurityException> { provider.enforceReader(granted, uri(otherSha), 1, stranger) }
    val denied = object : ContextWrapper(owner) {
      override fun checkUriPermission(value: Uri, pid: Int, uid: Int, flags: Int) = PackageManager.PERMISSION_DENIED
    }
    refuses<SecurityException> { provider.enforceReader(denied, uri(), 1, stranger) }
  }
  private fun sameDigestReCache() = disposable { owner, provider ->
    val manager = owner.getSystemService(NotificationManager::class.java)
    val id = "sound.c_${sha.take(16)}"
    val first = uri()
    try {
      NotificationSoundFiles.publish(owner.filesDir, sha, bytes)
      manager.createNotificationChannel(NotificationChannel(id, id, NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(first, null) })
      manager.deleteNotificationChannel(id); NotificationSoundFiles.remove(owner.filesDir, sha)
      refuses<FileNotFoundException> { provider.openFile(first, "r") }
      check(owner.filesDir.listFiles()?.all { it.name != "notification-sounds" || it.listFiles().isNullOrEmpty() } == true)
      // No historical entry/row is retained. Same digest alone recovers identity.
      NotificationSoundFiles.publish(owner.filesDir, sha, bytes)
      val second = uri()
      manager.createNotificationChannel(NotificationChannel(id, id, NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(second, null) })
      check(first == second && manager.getNotificationChannel(id).sound == first)
      check(ParcelFileDescriptor.AutoCloseInputStream(provider.openFile(first, "r")).use { it.readBytes() }.contentEquals(bytes))
    } finally { manager.deleteNotificationChannel(id) }
  }
  private fun allocationNegativeControl() {
    val manager = targetContext.getSystemService(NotificationManager::class.java)
    val id = "sound.c_${otherSha.take(16)}"
    // Model allocation-based publication while retaining an old channel URI.
    // It must remain detectable as stale, even on an OEM that purges deleted
    // channels unusually early. This does NOT claim MediaStore reproduction.
    val old = uri(otherSha).buildUpon().appendQueryParameter("row", "1").build()
    val newlyAllocated = uri(otherSha).buildUpon().appendQueryParameter("row", "2").build()
    try {
      manager.createNotificationChannel(NotificationChannel(id, id, NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(old, null) })
      manager.createNotificationChannel(NotificationChannel(id, id, NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(newlyAllocated, null) })
      check(old != newlyAllocated && manager.getNotificationChannel(id).sound != newlyAllocated)
    } finally { manager.deleteNotificationChannel(id) }
  }
  private fun crashRecovery() = disposable { owner, _ ->
    val orphan = NotificationSoundFiles.file(owner.filesDir, otherSha)
    NotificationSoundFiles.publish(owner.filesDir, sha, bytes)
    NotificationSoundFiles.publish(owner.filesDir, otherSha, bytes)
    val pending = File(orphan.parentFile, "$sha.pending").apply { writeBytes(bytes) }
    NotificationSoundFiles.recover(owner.filesDir, setOf(sha))
    check(!orphan.exists() && !pending.exists() && NotificationSoundFiles.file(owner.filesDir, sha).exists())
  }
}
