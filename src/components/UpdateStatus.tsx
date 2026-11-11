import {
  AlertTriangle,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useI18n } from "../state/I18nProvider";
import { useUpdates } from "../state/UpdateProvider";
import { progressPercent, UPDATE_ERROR_TEXTS } from "../lib/updates";

/**
 * Bas de la fenêtre, à droite : état des mises à jour puis numéro de version.
 * Sur le Web, ou sans clé de signature intégrée, seule la version s’affiche.
 */
export function UpdateStatus() {
  const { tt } = useI18n();
  const {
    supported,
    info,
    status,
    update,
    progress,
    error,
    check,
    download,
    install,
  } = useUpdates();
  const version = info?.currentVersion || __APP_VERSION__;
  const active = supported && info?.configured === true;
  const percent = progressPercent(progress);

  let state: React.ReactNode = null;
  if (active) {
    if (status === "checking") {
      state = (
        <span className="update-status__text" role="status">
          <LoaderCircle size={13} className="spin" />
          {tt("Recherche…")}
        </span>
      );
    } else if (status === "available" && update) {
      state = (
        <button
          type="button"
          className="update-status__button update-status__button--accent"
          onClick={() => void download()}
        >
          <Download size={13} />
          {tt("{version} disponible — Télécharger").replace(
            "{version}",
            update.version,
          )}
        </button>
      );
    } else if (status === "downloading") {
      state = (
        <span className="update-status__text" role="status">
          <LoaderCircle size={13} className="spin" />
          {percent === null
            ? tt("Téléchargement…")
            : tt("Téléchargement… {percent} %").replace(
                "{percent}",
                String(percent),
              )}
        </span>
      );
    } else if (status === "ready") {
      state = (
        <button
          type="button"
          className="update-status__button update-status__button--accent"
          onClick={() => void install()}
        >
          <RotateCcw size={13} />
          {tt("Redémarrer pour mettre à jour")}
        </button>
      );
    } else if (status === "installing") {
      state = (
        <span className="update-status__text" role="status">
          <LoaderCircle size={13} className="spin" />
          {tt("Installation…")}
        </span>
      );
    } else if (status === "error") {
      const message = tt(
        UPDATE_ERROR_TEXTS[error ?? ""] ?? UPDATE_ERROR_TEXTS["check-failed"],
      );
      state = (
        <button
          type="button"
          className="update-status__button update-status__button--warning"
          onClick={() => void check()}
          title={message}
          aria-label={`${message} ${tt("Réessayer")}`}
        >
          <AlertTriangle size={13} />
          {tt("Réessayer")}
        </button>
      );
    } else {
      state = (
        <button
          type="button"
          className="update-status__button"
          onClick={() => void check()}
          title={tt("Rechercher les mises à jour")}
          aria-label={tt("Rechercher les mises à jour")}
        >
          <RefreshCw size={13} />
          {status === "up-to-date" && tt("À jour")}
        </button>
      );
    }
  }

  return (
    <span className="update-status">
      {state}
      <span className="update-status__version">v{version}</span>
    </span>
  );
}
