package app.coffre.desktop

import android.graphics.Color
import android.os.Build
import android.os.Bundle
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
  }

  override fun onWebViewCreate(webView: WebView) {
    coffreWebView = webView
  }
}
