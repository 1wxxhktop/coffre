package app.coffre.desktop

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var coffreWebView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    // Barres système totalement transparentes : la barre de navigation
    // flottante doit laisser voir le contenu autour d’elle.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    // Par défaut, Android termine l’activité. La WebView décide d’abord si
    // une couche interne (modale, détail, tiroir, onglet) peut être fermée.
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          val webView = coffreWebView
          if (webView == null) {
            finish()
            return
          }
          webView.evaluateJavascript(
            "window.__coffreHandleBack ? window.__coffreHandleBack() : false",
          ) { result ->
            if (result != "true") finish()
          }
        }
      },
    )

    val app = application as CoffreApplication
    app.attachActivity(this)
    applySecureScreen(app.isSecureScreenEnabled())
  }

  override fun onResume() {
    super.onResume()
    // Tauri ou le système peuvent recréer la fenêtre : réappliquer le drapeau.
    applySecureScreen((application as CoffreApplication).isSecureScreenEnabled())
  }

  override fun onDestroy() {
    (application as CoffreApplication).detachActivity(this)
    super.onDestroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    coffreWebView = webView
  }

  /** Bloque captures d’écran, enregistrements et aperçu dans les récents. */
  fun applySecureScreen(enabled: Boolean) {
    try {
      if (enabled) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    } catch (_: Exception) {
      // Fenêtre déjà détruite : le drapeau sera réappliqué à la prochaine
      // création de l’activité depuis la préférence native.
    }
  }
}
