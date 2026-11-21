package app.coffre.desktop

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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

  /**
   * Vrai si Coffre est le service de remplissage sélectionné dans Android.
   * L’identifiant de package diffère entre un build debug (`.debug`) et un
   * build release : comparer le composant complet, pas seulement la classe.
   */
  fun isAutofillSupported(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

  fun isAutofillServiceEnabled(): Boolean {
    // `AutofillService` n’existe qu’à partir d’Android 8 : ne pas charger la
    // classe du service sur les anciens appareils.
    if (!isAutofillSupported()) return false
    return try {
      val expected = ComponentName(this, CoffreAutofillService::class.java)
      val selected = Settings.Secure.getString(
        contentResolver,
        Settings.Secure.AUTOFILL_SERVICE,
      )
      if (selected.isNullOrBlank()) {
        false
      } else {
        selected == expected.flattenToString() ||
          selected == expected.flattenToShortString() ||
          ComponentName.unflattenFromString(selected) == expected
      }
    } catch (_: Exception) {
      false
    }
  }

  /** Ouvre l’écran système de choix du service de remplissage. */
  fun openAutofillSettings(): Boolean {
    val candidates = listOf(
      Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
        data = Uri.parse("package:$packageName")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      },
      Intent(Settings.ACTION_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      },
    )
    for (intent in candidates) {
      try {
        startActivity(intent)
        return true
      } catch (_: Exception) {
        // Essayer le repli suivant.
      }
    }
    return false
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
