package dev.localoperator.sound

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentValues
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.AtomicFile
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Only this app's own MediaStore rows are written/deleted (API 29+ needs no
 * storage permission). Private file:// sounds are not readable by SystemUI;
 * res/raw-only Expo resolution cannot play a downloaded file. A SHA-named
 * channel is never repurposed: Android retains user settings after deletion.
 * Native returns success only after bytes are fsynced/published, indexed and
 * the channel exists. The JS coordinator withdraws readiness before deletion.
 */
class LopNotificationSoundModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private val manager get() = context.getSystemService(NotificationManager::class.java)
  private val index get() = AtomicFile(File(context.filesDir, "notification-sound-index.json"))
  private fun state(): JSONObject = if (index.baseFile.exists() || File(index.baseFile.path + ".bak").exists())
    JSONObject(index.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
    else JSONObject().put("entries", JSONObject()).put("claims", JSONObject())
  private fun save(value: JSONObject) {
    val stream = index.startWrite()
    try { stream.write(value.toString().toByteArray()); index.finishWrite(stream) }
    catch (e: Exception) { index.failWrite(stream); throw e }
  }
  private fun stem(sha: String): String {
    require(Regex("^[a-f0-9]{64}$").matches(sha)) { "Invalid sound digest" }
    return "c_${sha.take(16)}"
  }
  private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it) }
  private fun uri(row: JSONObject): Uri = Uri.parse(row.getString("uri")).also {
    require(it.scheme == "content" && it.authority == "media")
  }
  private fun valid(sha: String, row: JSONObject): Boolean = try {
    val sound = uri(row)
    val bytes = context.contentResolver.openInputStream(sound)!!.use { input ->
      val output = java.io.ByteArrayOutputStream()
      val buffer = ByteArray(8192)
      while (output.size() <= 2097152) {
        val count = input.read(buffer, 0, minOf(buffer.size, 2097153 - output.size()))
        if (count < 0) break
        output.write(buffer, 0, count)
      }
      output.toByteArray() }
    val channel = manager.getNotificationChannel("sound.${stem(sha)}")
    // Android may resurrect a deleted channel with its OLD immutable URI.
    // A different readable sound (or null) is the user's system-settings
    // override and must be honored. An unreadable stale URI is NOT ready.
    val chosen = channel?.sound
    val readable = channel != null && (chosen == null || chosen == sound ||
      context.contentResolver.openAssetFileDescriptor(chosen, "r")?.use { true } == true)
    bytes.size == row.getInt("bytes") && hash(bytes) == sha && readable
  } catch (_: Exception) { false }

  override fun definition() = ModuleDefinition {
    Name("LopNotificationSound")
    AsyncFunction("available") { Build.VERSION.SDK_INT >= 29 }
    // All functions share the default module queue; JS serializes the complete
    // cross-network transaction too. An index read error fails closed: losing
    // previous-computer claims must never make their sounds evictable.
    AsyncFunction("inventory") {
      val entries = state().getJSONObject("entries")
      entries.keys().asSequence().map { sha ->
        val row = entries.getJSONObject(sha)
        mapOf("sha" to sha, "bytes" to row.getInt("bytes"), "used" to row.getDouble("used"), "valid" to valid(sha, row))
      }.toList()
    }
    AsyncFunction("claims") {
      val claims = state().getJSONObject("claims")
      claims.keys().asSequence().associateWith { owner ->
        val list = claims.getJSONArray(owner)
        (0 until list.length()).map { list.getString(it) }
      }
    }
    AsyncFunction("claim") { owner: String, shas: List<String> ->
      require(owner.length in 1..128 && shas.size <= 10)
      shas.forEach { stem(it) }
      val value = state()
      if (shas.isEmpty()) value.getJSONObject("claims").remove(owner)
      else value.getJSONObject("claims").put(owner, org.json.JSONArray(shas))
      save(value)
    }
    AsyncFunction("touch") { sha: String, used: Double ->
      stem(sha); val value = state()
      value.getJSONObject("entries").getJSONObject(sha).put("used", used); save(value)
    }
    AsyncFunction("install") { sha: String, stage: String, used: Double ->
      require(Build.VERSION.SDK_INT >= 29)
      val name = stem(sha)
      val source = File(requireNotNull(Uri.parse(stage).path)).canonicalFile
      require(source == File(context.cacheDir, "lop-notification-sound-stage.wav").canonicalFile)
      require(source.length() in 1..2097152)
      val bytes = source.readBytes()
      require(hash(bytes) == sha) { "Sound digest mismatch" }
      val value = state(); val entries = value.getJSONObject("entries")
      require(!entries.has(sha) && entries.length() < 5)
      var total = bytes.size
      entries.keys().forEach { key ->
        require(stem(key) != name); total += entries.getJSONObject(key).getInt("bytes")
      }
      require(total <= 8388608)
      val resolver = context.contentResolver
      val metadata = ContentValues().apply {
        put(MediaStore.Audio.Media.DISPLAY_NAME, "$name.wav")
        put(MediaStore.Audio.Media.MIME_TYPE, "audio/wav")
        put(MediaStore.Audio.Media.IS_NOTIFICATION, 1)
        put(MediaStore.Audio.Media.RELATIVE_PATH, "${Environment.DIRECTORY_NOTIFICATIONS}/LocalOperator/")
        put(MediaStore.Audio.Media.IS_PENDING, 1)
      }
      val sound = requireNotNull(resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, metadata))
      // Index the reserved slot BEFORE writing bytes. A crash leaves a tracked,
      // invalid row; inventory withdraws its readiness before the next cleanup.
      try {
        entries.put(sha, JSONObject().put("uri", sound.toString()).put("bytes", bytes.size).put("used", used))
        save(value)
        android.os.ParcelFileDescriptor.AutoCloseOutputStream(requireNotNull(resolver.openFileDescriptor(sound, "w"))).use { output ->
          output.write(bytes); output.fd.sync()
        }
        resolver.update(sound, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
        val channel = NotificationChannel("sound.$name", name, NotificationManager.IMPORTANCE_DEFAULT)
        channel.setSound(sound, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
        manager.createNotificationChannel(channel)
        require(valid(sha, entries.getJSONObject(sha))) { "Sound not durable or channel absent" }
      } catch (e: Exception) {
        // Keep a tracked reserved slot for retry, but if indexing itself failed
        // no bytes were written: remove the pending empty row we just inserted.
        if (!state().getJSONObject("entries").has(sha)) resolver.delete(sound, null, null)
        throw e
      }
    }
    AsyncFunction("remove") { sha: String ->
      val name = stem(sha); val value = state(); val entries = value.getJSONObject("entries")
      val claims = value.getJSONObject("claims")
      require(claims.keys().asSequence().none { owner ->
        val list = claims.getJSONArray(owner)
        (0 until list.length()).any { list.getString(it) == sha }
      }) { "Sound still advertised by a computer" }
      val row = entries.optJSONObject(sha)
      if (row != null) {
        manager.deleteNotificationChannel("sound.$name")
        context.contentResolver.delete(uri(row), null, null)
        entries.remove(sha); save(value)
      }
    }
  }
}
