package app.coffre.desktop

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import java.util.Locale
import org.json.JSONObject

// Ces deux hints ne font pas partie des constantes historiques de `View`.
private const val HINT_NEW_PASSWORD = "newPassword"
private const val HINT_NEW_USERNAME = "newUsername"

/**
 * Remplissage des identifiants Coffre dans les autres applications.
 *
 * Le service ne lit que le cache mémoire publié par l’application lorsqu’elle
 * est déverrouillée. Il ne propose une connexion que si le domaine du
 * formulaire correspond à l’une de ses adresses, avec la même règle que
 * l’extension. Les formulaires sans domaine web (applications natives) ne
 * reçoivent aucune proposition pour l’instant.
 *
 * Coffre ne propose jamais d’enregistrer un mot de passe saisi dans une autre
 * application : `onSaveRequest` ne fait rien.
 */
class CoffreAutofillService : AutofillService() {
  private data class AutofillItem(
    val title: String,
    val username: String,
    val password: String,
  ) {
    // Ne jamais laisser un mot de passe apparaître dans une trace.
    override fun toString(): String = "AutofillItem(title=$title, username=$username)"
  }

  private data class Form(
    val usernameIds: List<AutofillId>,
    val passwordIds: List<AutofillId>,
    val webDomain: String?,
  )

  private class FormVisitor {
    // Identifiant explicite (« username », « identifiant »…), puis champs
    // e-mail plus faibles, utilisés seulement si un mot de passe les accompagne.
    val strongUsernameIds = mutableListOf<AutofillId>()
    val emailIds = mutableListOf<AutofillId>()
    val passwordIds = mutableListOf<AutofillId>()
    var webDomain: String? = null

    fun visit(node: AssistStructure.ViewNode?) {
      if (node == null) return
      if (!node.webDomain.isNullOrBlank()) webDomain = node.webDomain

      val id = node.autofillId
      val hints = node.autofillHints?.map { it.lowercase(Locale.ROOT) } ?: emptyList()
      val inputClass = node.inputType and InputType.TYPE_MASK_CLASS
      // Les WebViews exposent parfois des champs sans type Android : un
      // `autofillHints` explicite suffit alors à les reconnaître.
      val editable =
        inputClass == InputType.TYPE_CLASS_TEXT ||
          inputClass == InputType.TYPE_CLASS_NUMBER ||
          node.className?.toString().orEmpty().contains("EditText") ||
          hints.isNotEmpty()
      if (id != null && editable && node.isEnabled && node.visibility == View.VISIBLE) {
        val variation = node.inputType and InputType.TYPE_MASK_VARIATION
        val label = "${node.hint ?: ""} ${node.idEntry ?: ""}"
          .lowercase(Locale.ROOT)
        // Les champs « nouveau mot de passe » d’une inscription ne doivent pas
        // recevoir un mot de passe existant.
        val newPassword = hints.any {
          it.equals(HINT_NEW_PASSWORD, ignoreCase = true)
        }
        val newUsername = hints.any {
          it.equals(HINT_NEW_USERNAME, ignoreCase = true)
        }

        val password =
          !newPassword &&
            (hints.any { it.equals(View.AUTOFILL_HINT_PASSWORD, ignoreCase = true) } ||
              variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
              variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
              variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
              variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD ||
              label.contains("password") ||
              label.contains("passwd") ||
              label.contains("mot de passe"))

        val strongUsername =
          !newUsername &&
            (hints.any { it.equals(View.AUTOFILL_HINT_USERNAME, ignoreCase = true) } ||
              label.contains("username") ||
              label.contains("user name") ||
              label.contains("identifiant") ||
              label.contains("utilisateur") ||
              label.contains("login"))

        val emailUsername =
          !newUsername &&
            (hints.any { it.equals(View.AUTOFILL_HINT_EMAIL_ADDRESS, ignoreCase = true) } ||
              variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
              variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS ||
              label.contains("email") ||
              label.contains("e-mail") ||
              label.contains("courriel"))

        // Un champ e-mail peut être une newsletter : il n’est proposé seul que
        // s’il est explicitement marqué comme identifiant. Avec un mot de
        // passe, il complète le couple identifiant / mot de passe.
        if (password) {
          passwordIds.add(id)
        } else if (strongUsername) {
          strongUsernameIds.add(id)
        } else if (emailUsername) {
          emailIds.add(id)
        }
      }

      for (index in 0 until node.childCount) visit(node.getChildAt(index))
    }
  }

  private fun formOf(request: FillRequest): Form? {
    val structure = request.fillContexts.lastOrNull()?.structure ?: return null
    val visitor = FormVisitor()
    for (index in 0 until structure.windowNodeCount) {
      visitor.visit(structure.getWindowNodeAt(index).rootViewNode)
    }
    val usernameIds = if (visitor.passwordIds.isEmpty()) {
      visitor.strongUsernameIds.toList()
    } else {
      (visitor.strongUsernameIds + visitor.emailIds).distinct()
    }
    return Form(usernameIds, visitor.passwordIds, visitor.webDomain)
  }

  private fun itemsOf(payload: String?): List<AutofillItem> {
    if (payload == null) return emptyList()
    return try {
      val root = JSONObject(payload)
      if (!root.optBoolean("unlocked", false)) return emptyList()
      val array = root.optJSONArray("items") ?: return emptyList()
      buildList {
        for (index in 0 until array.length()) {
          val item = array.optJSONObject(index) ?: continue
          val password = item.optString("password")
          if (password.isEmpty()) continue
          add(
            AutofillItem(
              title = item.optString("title"),
              username = item.optString("username"),
              password = password,
            ),
          )
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun presentation(item: AutofillItem): RemoteViews =
    RemoteViews(packageName, R.layout.autofill_item).apply {
      setTextViewText(
        R.id.autofill_title,
        item.title.ifBlank { getString(R.string.app_name) },
      )
      setTextViewText(
        R.id.autofill_username,
        item.username.ifBlank { getString(R.string.autofill_login_fallback) },
      )
    }

  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback,
  ) {
    try {
      val form = formOf(request)
      val domain = form?.webDomain?.trim()
      if (form == null || domain.isNullOrEmpty()) {
        callback.onSuccess(null)
        return
      }

      val usernameId = form.usernameIds.firstOrNull()
      val passwordId = form.passwordIds.firstOrNull()
      // Un formulaire à deux étapes peut ne demander que l’identifiant.
      if (usernameId == null && passwordId == null) {
        callback.onSuccess(null)
        return
      }

      val items = itemsOf(CoffreAutofillBridge.match(domain))
      if (items.isEmpty()) {
        callback.onSuccess(null)
        return
      }

      val response = FillResponse.Builder()
      var added = 0
      for (item in items) {
        // Sans champ de mot de passe, une entrée sans identifiant ne
        // remplirait rien.
        if (passwordId == null && item.username.isEmpty()) continue
        val row = presentation(item)
        val dataset = Dataset.Builder(row)
        if (item.username.isNotEmpty()) {
          usernameId?.let {
            dataset.setValue(it, AutofillValue.forText(item.username), row)
          }
        }
        passwordId?.let {
          dataset.setValue(it, AutofillValue.forText(item.password), row)
        }
        response.addDataset(dataset.build())
        added += 1
      }
      if (added == 0) {
        callback.onSuccess(null)
        return
      }
      callback.onSuccess(response.build())
    } catch (_: Exception) {
      // Aucun détail dans les journaux : une trace peut contenir un secret.
      callback.onSuccess(null)
    }
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    // Coffre ne capture pas les mots de passe saisis dans d’autres
    // applications : l’utilisateur garde la maîtrise de ce qui entre dans le
    // coffre.
    callback.onSuccess()
  }
}
