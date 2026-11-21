package app.coffre.desktop

import android.app.PendingIntent
import android.content.Intent
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry
import org.json.JSONArray
import org.json.JSONObject

/**
 * Fournisseur de passkeys Android (Credential Manager, Android 14+).
 *
 * Cette première version ne fait que **signer** des passkeys déjà présentes
 * dans le coffre. La création depuis Android n’est pas encore proposée : les
 * passkeys se créent depuis le site avec l’extension Coffre.
 *
 * Le service ne lit que le cache mémoire publié par l’application
 * déverrouillée. Les clés privées restent dans Rust ; Kotlin ne reçoit que les
 * métadonnées de liste, puis une assertion signée après authentification.
 */
@RequiresApi(34)
class CoffreCredentialProviderService : CredentialProviderService() {
  override fun onBeginGetCredentialRequest(
    request: BeginGetCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
  ) {
    try {
      val entries = mutableListOf<PublicKeyCredentialEntry>()
      var unlocked = true
      for (option in request.beginGetCredentialOptions) {
        if (option !is BeginGetPublicKeyCredentialOption) continue
        val rpId = JSONObject(option.requestJson).optString("rpId").trim()
        if (rpId.isEmpty()) continue
        val payload =
          CoffrePasskeyBridge.list(rpId, allowCredentials(option.requestJson)) ?: run {
            unlocked = false
            continue
          }
        val root = JSONObject(payload)
        if (!root.optBoolean("unlocked", false)) {
          unlocked = false
          continue
        }
        val items = root.optJSONArray("items") ?: continue
        for (index in 0 until items.length()) {
          val item = items.optJSONObject(index) ?: continue
          val credentialId = item.optString("credentialId")
          if (credentialId.isEmpty()) continue
          val userName = item.optString("userName")
          entries.add(
            PublicKeyCredentialEntry(
              context = applicationContext,
              username = userName.ifBlank { getString(R.string.app_name) },
              pendingIntent = entryPendingIntent(credentialId),
              beginGetPublicKeyCredentialOption = option,
              displayName = userName.takeIf { it.isNotBlank() },
            ),
          )
        }
      }

      val response = if (entries.isEmpty() && !unlocked) {
        BeginGetCredentialResponse(
          authenticationActions = listOf(
            AuthenticationAction(
              getString(R.string.passkey_unlock_title),
              unlockPendingIntent(),
            ),
          ),
        )
      } else {
        BeginGetCredentialResponse(entries)
      }
      callback.onResult(response)
    } catch (_: Exception) {
      callback.onError(GetCredentialUnknownException())
    }
  }

  override fun onBeginCreateCredentialRequest(
    request: BeginCreateCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
  ) {
    // Création Android non prise en charge dans cette version : ne pas
    // proposer Coffre comme destination, pour ne pas perdre la passkey.
    callback.onResult(BeginCreateCredentialResponse())
  }

  override fun onClearCredentialStateRequest(
    request: ProviderClearCredentialStateRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<Void?, ClearCredentialException>,
  ) {
    callback.onResult(null)
  }

  private fun allowCredentials(requestJson: String): String {
    val source = JSONObject(requestJson).optJSONArray("allowCredentials") ?: return "[]"
    val ids = JSONArray()
    for (index in 0 until source.length()) {
      val id = source.optJSONObject(index)?.optString("id").orEmpty()
      if (id.isNotEmpty()) ids.put(id)
    }
    return ids.toString()
  }

  private fun entryPendingIntent(credentialId: String): PendingIntent {
    val intent = Intent(this, PasskeyCredentialActivity::class.java).apply {
      action = PasskeyCredentialActivity.ACTION_GET_PASSKEY
      putExtra(PasskeyCredentialActivity.EXTRA_CREDENTIAL_ID, credentialId)
    }
    return PendingIntent.getActivity(
      this,
      credentialId.hashCode() and 0x7fffffff,
      intent,
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun unlockPendingIntent(): PendingIntent {
    val intent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(
      this,
      41,
      intent,
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
