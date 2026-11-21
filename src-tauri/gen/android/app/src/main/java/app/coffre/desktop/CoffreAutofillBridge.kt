package app.coffre.desktop

/**
 * Pont JNI vers le cache de remplissage Rust.
 *
 * Le cache vit dans la mémoire du processus Tauri. Android peut démarrer le
 * service de remplissage sans activité : la bibliothèque Rust est alors
 * chargée à froid et le cache est vide, donc le service ne propose rien.
 * Aucun secret n’est écrit sur le disque.
 */
object CoffreAutofillBridge {
  private val loaded: Boolean =
    runCatching {
      System.loadLibrary("coffre_lib")
      true
    }.getOrDefault(false)

  /**
   * Renvoie une charge utile JSON `{ unlocked, items }` pour ce service
   * (`domaine` ou `schéma://domaine`), ou `null` si la bibliothèque native
   * n’est pas disponible.
   */
  external fun nativeMatch(service: String): String?

  fun match(service: String): String? =
    if (loaded) runCatching { nativeMatch(service) }.getOrNull() else null
}
