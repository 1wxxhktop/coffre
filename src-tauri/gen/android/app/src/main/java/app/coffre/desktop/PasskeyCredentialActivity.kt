package app.coffre.desktop

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.provider.ProviderGetCredentialRequest
import androidx.fragment.app.FragmentActivity
import org.json.JSONObject

/**
 * Activité de sélection d’une passkey Coffre.
 *
 * L’origine est vérifiée avec la liste des navigateurs privilégiés ; une
 * authentification système est demandée avant de signer. La clé privée reste
 * dans Rust : seuls les champs WebAuthn publics et la signature sortent.
 */
class PasskeyCredentialActivity : FragmentActivity() {
  companion object {
    const val ACTION_GET_PASSKEY = "app.coffre.desktop.action.GET_PASSKEY"
    const val EXTRA_CREDENTIAL_ID = "credentialId"
  }

  private var finished = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (savedInstanceState != null) return

    val request = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
    if (request == null) {
      cancel()
      return
    }
    val option = request.credentialOptions
      .firstOrNull { it is GetPublicKeyCredentialOption } as? GetPublicKeyCredentialOption
    val credentialId = intent.getStringExtra(EXTRA_CREDENTIAL_ID)
    if (option == null || credentialId.isNullOrEmpty()) {
      cancel()
      return
    }
    val requestJson = try {
      JSONObject(option.requestJson)
    } catch (_: Exception) {
      cancel()
      return
    }
    val rpId = requestJson.optString("rpId").trim()
    val clientDataHash = option.clientDataHash
    if (rpId.isEmpty() || clientDataHash == null) {
      cancel()
      return
    }
    val allowlist = try {
      assets.open("privileged-apps.json").bufferedReader().use { it.readText() }
    } catch (_: Exception) {
      cancel()
      return
    }
    // Une origine n’est retournée que pour un navigateur de la liste de
    // confiance ; un appel natif non privilégié est refusé.
    val origin = try {
      request.callingAppInfo.getOrigin(allowlist)
    } catch (_: Exception) {
      null
    }
    if (origin.isNullOrBlank()) {
      cancel()
      return
    }

    val hashBase64 = Base64.encodeToString(clientDataHash, Base64.NO_WRAP)
    authenticate(rpId) {
      complete(credentialId, rpId, hashBase64)
    }
  }

  private fun authenticate(rpId: String, onSuccess: () -> Unit) {
    val prompt = BiometricPrompt(
      this,
      ContextCompat.getMainExecutor(this),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          cancel()
        }

        override fun onAuthenticationFailed() {
          // Laisser réessayer.
        }

        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          onSuccess()
        }
      },
    )
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle(getString(R.string.passkey_prompt_title))
      .setSubtitle(rpId)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      info.setAllowedAuthenticators(
        BiometricManager.Authenticators.BIOMETRIC_STRONG or
          BiometricManager.Authenticators.DEVICE_CREDENTIAL,
      )
    } else {
      @Suppress("DEPRECATION")
      info.setDeviceCredentialAllowed(true)
    }
    prompt.authenticate(info.build())
  }

  private fun complete(credentialId: String, rpId: String, hashBase64: String) {
    val payload = CoffrePasskeyBridge.assert(credentialId, rpId, hashBase64, true)
    if (payload == null) {
      cancel()
      return
    }
    try {
      val data = JSONObject(payload)
      val response = JSONObject()
        .put("id", data.getString("credentialId"))
        .put("rawId", data.getString("credentialId"))
        .put("type", "public-key")
        .put("authenticatorAttachment", "platform")
        .put(
          "response",
          JSONObject()
            // Le clientDataJSON est construit par le navigateur ; la
            // signature porte sur son empreinte fournie par Android.
            .put("clientDataJSON", "e30")
            .put("authenticatorData", data.getString("authenticatorData"))
            .put("signature", data.getString("signature"))
            .put("userHandle", data.getString("userHandle")),
        )
      val credential = PublicKeyCredential(response.toString())
      val result = Intent()
      PendingIntentHandler.setGetCredentialResponse(
        result,
        GetCredentialResponse(credential),
      )
      setResult(RESULT_OK, result)
      finishOnce()
    } catch (_: Exception) {
      cancel()
    }
  }

  private fun cancel() {
    if (finished) return
    setResult(RESULT_CANCELED)
    finishOnce()
  }

  private fun finishOnce() {
    if (finished) return
    finished = true
    finish()
  }
}
