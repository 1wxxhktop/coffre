package app.coffre.desktop

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Accès à `AutofillManager` par réflexion : la classe n’existe pas sur
 * Android 7 et `CoffreApplication` doit rester chargeable sur ces appareils.
 */
private object AutofillSupport {
  fun enabled(context: Application): Boolean {
    return try {
      val manager = context.getSystemService("autofill") ?: return false
      manager.javaClass
        .getMethod("hasEnabledAutofillServices")
        .invoke(manager) as? Boolean ?: false
    } catch (_: Exception) {
      false
    }
  }
}

/**
 * Contexte d’application exposé à Rust par `ndk_context`.
 *
 * La commande `android_updater_install` télécharge l’APK dans le cache, puis
 * appelle `installApk` par JNI. L’application peut démarrer l’installateur
 * avec `FLAG_ACTIVITY_NEW_TASK` ; le fichier est partagé par le FileProvider
 * déclaré dans le manifeste.
 *
 * La protection contre les captures d’écran est mémorisée dans les
 * préférences natives pour être appliquée dès la création de l’activité,
 * avant le premier rendu de la WebView.
 */
class CoffreApplication : Application() {
  companion object {
    private const val PREFS = "coffre"
    private const val SECURE_SCREEN = "secure_screen"
    private var currentActivity: WeakReference<MainActivity>? = null
  }

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

  /** Vrai si Android expose l’Autofill Framework (Android 8+). */
  fun isAutofillSupported(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

  /** Vrai si Coffre est le service de remplissage sélectionné dans Android. */
  fun isAutofillServiceEnabled(): Boolean {
    // `AutofillService` n’existe qu’à partir d’Android 8 : ne pas charger la
    // classe du service sur les anciens appareils.
    if (!isAutofillSupported()) return false
    return try {
      AutofillSupport.enabled(this)
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

  /** Ouvre l’écran Android des fournisseurs de passkeys. */
  fun openPasskeySettings(): Boolean {
    val candidates = buildList {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        add(
          Intent(Settings.ACTION_CREDENTIAL_PROVIDER).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          },
        )
      }
      add(
        Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
          data = Uri.parse("package:$packageName")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
      add(
        Intent(Settings.ACTION_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
    }
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

  fun attachActivity(activity: MainActivity) {
    currentActivity = WeakReference(activity)
  }

  fun detachActivity(activity: MainActivity) {
    if (currentActivity?.get() === activity) currentActivity = null
  }

  /** Vrai par défaut : un gestionnaire de mots de passe ne se laisse pas capturer. */
  fun isSecureScreenEnabled(): Boolean =
    getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(SECURE_SCREEN, true)

  /**
   * Mémorise le choix puis l’applique à l’activité courante. Appelée par JNI
   * depuis un thread de commande Tauri : le changement de fenêtre est renvoyé
   * sur le thread principal.
   */
  fun setSecureScreen(enabled: Boolean): Boolean {
    getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(SECURE_SCREEN, enabled)
      .apply()
    val activity = currentActivity?.get()
    if (activity != null) {
      Handler(Looper.getMainLooper()).post {
        activity.applySecureScreen(enabled)
      }
    }
    return true
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
