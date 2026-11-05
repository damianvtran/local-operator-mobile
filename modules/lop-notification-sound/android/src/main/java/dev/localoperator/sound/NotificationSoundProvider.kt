package dev.localoperator.sound

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.ParcelFileDescriptor
import android.os.Process
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import android.system.Os
import android.system.OsConstants

/** A digest is the address, not an allocation in MediaStore. Android restores
 * a deleted channel with its old immutable sound URI, so evict/re-cache MUST
 * yield the same URI without retaining unbounded media-row tombstones.
 *
 * This provider is NOT exported. On API 29+ NotificationManagerService grants
 * the channel's sound URI to notification rendering recipients. The provider
 * additionally checks the exact read grant at open time; we do not guess a
 * SystemUI package name or grant every app access to potentially private audio.
 * These grant/delivery semantics still require real-device validation.
 */
class NotificationSoundProvider : ContentProvider() {
  override fun onCreate() = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw SecurityException("Notification sounds are read-only")
    val owner = requireNotNull(context)
    val sha = NotificationSoundFiles.digest(owner.packageName, uri)
      ?: throw FileNotFoundException("Invalid notification sound URI")
    enforceReader(owner, uri, Binder.getCallingPid(), Binder.getCallingUid())
    val file = NotificationSoundFiles.file(owner.filesDir, sha)
    // Never follow a symlink or expose a staging/index file. Only atomically
    // published full-digest final files exist in this directory.
    if (file.canonicalFile != file.absoluteFile || !file.isFile || file.length() !in 1L..2097152L) {
      throw FileNotFoundException("Notification sound is not cached")
    }
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun getType(uri: Uri): String? =
    if (NotificationSoundFiles.digest(requireNotNull(context).packageName, uri) != null) "audio/wav" else null

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?,
    selectionArgs: Array<out String>?, sortOrder: String?): Cursor? =
    throw UnsupportedOperationException("Notification sound metadata is private")
  override fun insert(uri: Uri, values: ContentValues?): Uri? =
    throw UnsupportedOperationException("Notification sounds are read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int =
    throw UnsupportedOperationException("Notification sounds are read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
    throw UnsupportedOperationException("Notification sounds are read-only")

  internal fun enforceReader(owner: Context, uri: Uri, pid: Int, uid: Int) {
    if (uid != Process.myUid() && owner.checkUriPermission(uri, pid, uid,
        Intent.FLAG_GRANT_READ_URI_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
      throw SecurityException("Notification sound read grant required")
    }
  }
}

/** One path policy shared by the writer, inventory and provider. Full SHA in
 * both URI and file path prevents a truncated channel-id collision from ever
 * addressing another file. URI parsing rejects alternate/encoded spellings,
 * queries, fragments and foreign authorities, rather than normalizing them. */
internal object NotificationSoundFiles {
  private val shaPattern = Regex("^[a-f0-9]{64}$")
  private val pathPattern = Regex("^/v1/([a-f0-9]{64})\\.wav$")
  fun check(sha: String): String {
    require(shaPattern.matches(sha)) { "Invalid sound digest" }
    return sha
  }
  fun uri(packageName: String, sha: String): Uri = Uri.Builder()
    .scheme("content").authority("$packageName.notification-sounds")
    .path("/v1/${check(sha)}.wav").build()
  fun digest(packageName: String, uri: Uri): String? {
    if (uri.scheme != "content" || uri.authority != "$packageName.notification-sounds" ||
        uri.encodedQuery != null || uri.encodedFragment != null) return null
    return pathPattern.matchEntire(uri.encodedPath ?: "")?.groupValues?.get(1)
  }
  fun file(filesDir: File, sha: String): File =
    File(File(filesDir.canonicalFile, "notification-sounds"), "${check(sha)}.wav")

  private fun pending(filesDir: File, sha: String): File =
    File(file(filesDir, sha).parentFile, "${check(sha)}.pending")

  fun syncDirectory(directory: File) {
    // O_DIRECTORY is hidden from the public Android SDK. Verify the opened
    // descriptor's type through public API21+ fstat/S_ISDIR instead; never
    // weaken this to a best-effort or file-only barrier.
    val descriptor = Os.open(directory.absolutePath, OsConstants.O_RDONLY, 0)
    try {
      require(OsConstants.S_ISDIR(Os.fstat(descriptor).st_mode))
      Os.fsync(descriptor)
    } finally { Os.close(descriptor) }
  }

  fun publish(filesDir: File, sha: String, bytes: ByteArray) {
    require(bytes.size in 1..2097152)
    val final = file(filesDir, sha)
    require(final.parentFile!!.mkdirs() || final.parentFile!!.isDirectory)
    require(final.parentFile!!.canonicalFile == final.parentFile!!.absoluteFile && !final.exists())
    // Persist first creation of the dedicated directory as well as its entries.
    syncDirectory(filesDir.canonicalFile)
    val temp = pending(filesDir, sha)
    require(temp.canonicalFile == temp.absoluteFile)
    try {
      FileOutputStream(temp).use { stream -> stream.write(bytes); stream.fd.sync() }
      check(temp.renameTo(final)) { "Notification sound publication failed" }
      syncDirectory(final.parentFile!!)
    } finally { if (temp.exists()) check(temp.delete()) }
  }

  fun remove(filesDir: File, sha: String) {
    for (path in listOf(file(filesDir, sha), pending(filesDir, sha))) {
      require(path.canonicalFile == path.absoluteFile)
      if (path.exists()) check(path.delete()) { "Notification sound removal failed" }
    }
    val directory = file(filesDir, sha).parentFile!!
    if (directory.exists()) syncDirectory(directory)
  }

  /** Only our dedicated directory and exact final/pending names are visited.
   * A corrupt index is rejected by the caller BEFORE recovery. No historical
   * SHA metadata is retained: retired final files and every partial are reaped.
   * Provider reads need no index or JS; only complete final names are readable.
   */
  fun recover(filesDir: File, active: Set<String>) {
    val directory = File(filesDir.canonicalFile, "notification-sounds")
    require(directory.canonicalFile == directory.absoluteFile)
    var changed = false
    for (path in directory.listFiles() ?: emptyArray()) {
      val match = Regex("^([a-f0-9]{64})\\.(wav|pending)$").matchEntire(path.name) ?: continue
      if (match.groupValues[2] == "pending" || match.groupValues[1] !in active) {
        require(path.canonicalFile == path.absoluteFile)
        check(path.delete()) { "Notification sound recovery failed" }
        changed = true
      }
    }
    if (changed) syncDirectory(directory)
  }
}
