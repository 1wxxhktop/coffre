package app.coffre.desktop

import android.app.Application
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Contexte d’application exposé à Rust par `ndk_context`.
 *
 * La commande `android_updater_install` télécharge l’APK dans le cache, puis
 * appelle `installApk` par JNI. L’application peut démarrer l’installateur
 * avec `FLAG_ACTIVITY_NEW_TASK` ; le fichier est partagé par le FileProvider
 * déclaré dans le manifeste.
 */
class CoffreApplication : Application() {
  fun installApk(path: String): Boolean {
    return try {
      val file = File(path)
      if (!file.isFile || file.name != "Coffre-update.apk") return false
      // Refuser tout chemin hors du cache de l’application.
      val expected = File(cacheDir, file.name).canonicalFile
      if (file.canonicalFile != expected) return false

      if (Looper.myLooper() == Looper.getMainLooper()) {
        return launchInstaller(file)
      }

      val latch = CountDownLatch(1)
      var launched = false
      Handler(Looper.getMainLooper()).post {
        launched = launchInstaller(file)
        latch.countDown()
      }
      latch.await(5, TimeUnit.SECONDS)
      launched
    } catch (_: Exception) {
      false
    }
  }

  private fun launchInstaller(file: File): Boolean {
    return try {
      val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      startActivity(intent)
      true
    } catch (_: Exception) {
      false
    }
  }
}
