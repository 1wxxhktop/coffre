package app.coffre.desktop

/**
 * Pont JNI vers le cache de passkeys Rust.
 *
 * La liste ne contient jamais de clé privée. La signature est faite dans Rust,
 * après l’authentification de l’activité du fournisseur.
 */
object CoffrePasskeyBridge {
  private val loaded: Boolean =
    runCatching {
      System.loadLibrary("coffre_lib")
      true
    }.getOrDefault(false)

  external fun nativeList(rpId: String, allowCredentialsJson: String): String?

  external fun nativeAssert(
    itemId: String,
    rpId: String,
    clientDataHashBase64: String,
    userVerified: Boolean,
  ): String?

  fun list(rpId: String, allowCredentialsJson: String): String? =
    if (loaded) {
      runCatching { nativeList(rpId, allowCredentialsJson) }.getOrNull()
    } else {
      null
    }

  fun assert(
    itemId: String,
    rpId: String,
    clientDataHashBase64: String,
    userVerified: Boolean,
  ): String? =
    if (loaded) {
      runCatching {
        nativeAssert(itemId, rpId, clientDataHashBase64, userVerified)
      }.getOrNull()
    } else {
      null
    }
}
