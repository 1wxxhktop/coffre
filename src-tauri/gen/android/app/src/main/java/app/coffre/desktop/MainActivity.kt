package app.coffre.desktop

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var coffreWebView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

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
