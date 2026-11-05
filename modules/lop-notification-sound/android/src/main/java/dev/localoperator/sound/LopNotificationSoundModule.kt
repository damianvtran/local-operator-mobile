package dev.localoperator.sound

import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.util.AtomicFile
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Private atomic files + deterministic read-granted content URIs. Android
 * retains a deleted channel's sound URI, so same-SHA re-cache must republish
 * bytes at exactly that address, not allocate a new MediaStore row.
 * Native returns success only after fsync/publication, indexing and a readable
 * effective channel. JS withdraws readiness before deletion; native enforces
 * outstanding claims too. System-settings mute/overrides remain authoritative.
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
    try { stream.write(value.toString().toByteArray()); index.finishWrite(stream); NotificationSoundFiles.syncDirectory(context.filesDir) }
    catch (e: Exception) { index.failWrite(stream); throw e }
  }
  private fun stem(sha: String): String {
    require(Regex("^[a-f0-9]{64}$").matches(sha)) { "Invalid sound digest" }
    return "c_${sha.take(16)}"
  }
  private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it) }
  private fun valid(sha: String, row: JSONObject): Boolean = try {
    val sound = NotificationSoundFiles.uri(context.packageName, sha)
    val file = NotificationSoundFiles.file(context.filesDir, sha)
    val bytesValid = file.canonicalFile == file.absoluteFile && file.isFile &&
      file.length() == row.getLong("bytes") && file.length() in 1L..2097152L && hash(file.readBytes()) == sha
    val channel = manager.getNotificationChannel("sound.${stem(sha)}")
    val chosen = channel?.sound
    // Never reset a user's mute/override. A known legacy allocation URI or a
    // different provider digest is not evidence of this sound being ready.
    val userOverride = Build.VERSION.SDK_INT >= 30 && channel?.hasUserSetSound() == true
    val legacy = row.optString("uri", "")
    val stale = !userOverride && chosen != null && (
      (legacy.isNotEmpty() && chosen.toString() == legacy) ||
      (chosen.authority == sound.authority && chosen != sound))
    val readable = channel != null && !stale && (chosen == null || chosen == sound || userOverride ||
      context.contentResolver.openAssetFileDescriptor(chosen, "r")?.use { true } == true)
    bytesValid && readable
  } catch (_: Exception) { false }

  private fun recover(value: JSONObject) {
    val entries = value.getJSONObject("entries")
    val claims = value.getJSONObject("claims")
    // A structurally readable but inconsistent index is not permission to
    // delete advertised files or stop accounting for them. Refuse new writes.
    claims.keys().forEach { owner ->
      val shas = claims.getJSONArray(owner)
      for (i in 0 until shas.length()) require(entries.has(shas.getString(i)))
    }
    NotificationSoundFiles.recover(context.filesDir, entries.keys().asSequence().toSet())
  }

  override fun definition() = ModuleDefinition {
    Name("LopNotificationSound")
    AsyncFunction("available") { Build.VERSION.SDK_INT >= 29 }
    // All functions share the default module queue; JS serializes the complete
    // cross-network transaction too. An index read error fails closed: losing
    // previous-computer claims must never make their sounds evictable.
    AsyncFunction("inventory") {
      val value = state()
      recover(value)
      // A previous killed JS receive may have left its one staging file. No
      // active writer can overlap inventory: the app owns one serialized queue.
      File(context.cacheDir, "lop-notification-sound-stage.wav").delete()
      val entries = value.getJSONObject("entries")
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
      val stageUri = Uri.parse(stage)
      require(stageUri.scheme == "file" && stageUri.query == null && stageUri.fragment == null)
      val source = File(requireNotNull(stageUri.path)).canonicalFile
      require(source == File(context.cacheDir, "lop-notification-sound-stage.wav").canonicalFile)
      require(source.length() in 1L..2097152L)
      val bytes = source.readBytes()
      require(hash(bytes) == sha) { "Sound digest mismatch" }
      val value = state(); val entries = value.getJSONObject("entries")
      require(!entries.has(sha) && entries.length() < 5)
      var total = bytes.size
      entries.keys().forEach { key ->
        require(stem(key) != name); total += entries.getJSONObject(key).getInt("bytes")
      }
      require(total <= 8388608)
      recover(value)
      val sound = NotificationSoundFiles.uri(context.packageName, sha)
      // Reserve/account before publication. A crash leaves a tracked invalid
      // slot; recovery reaps partial files and readiness is repaired from disk.
      entries.put(sha, JSONObject().put("bytes", bytes.size).put("used", used))
      save(value)
      NotificationSoundFiles.publish(context.filesDir, sha, bytes)
      val channel = NotificationChannel("sound.$name", name, NotificationManager.IMPORTANCE_DEFAULT)
      channel.setSound(sound, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
      manager.createNotificationChannel(channel)
      require(valid(sha, entries.getJSONObject(sha))) { "Sound not durable or channel absent" }
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
        NotificationSoundFiles.remove(context.filesDir, sha)
        entries.remove(sha); save(value)
      }
    }
  }
}
