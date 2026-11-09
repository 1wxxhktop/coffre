/** Mise à jour directe ou fonctionnelle d’un état React. */
export type StateUpdate<T> = T | ((previous: T) => T)
