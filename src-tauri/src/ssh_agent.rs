//! Agent SSH côté application desktop.
//!
//! Le frontend fournit la clé maîtresse déjà déverrouillée. Rust ouvre le
//! fichier `.coffre`, construit les identités SSH en mémoire et démarre
//! `coffre-ssh-agent`. Chaque demande de signature est relayée à la WebView
//! qui doit répondre explicitement ; sans réponse sous 60 secondes, elle est
//! refusée.

use serde::Serialize;
use tauri::{AppHandle, State};

/// État partagé de l’agent SSH.
#[derive(Default)]
pub struct SshAgentState {
    #[cfg(unix)]
    inner: unix::Inner,
}

/// État exposé au frontend.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAgentStatus {
    pub running: bool,
    pub socket: Option<String>,
    pub identities: usize,
    pub fingerprints: Vec<String>,
}

impl SshAgentStatus {
    fn stopped() -> Self {
        Self {
            running: false,
            socket: None,
            identities: 0,
            fingerprints: Vec::new(),
        }
    }
}

/// Demande d’approbation envoyée à la WebView.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAgentApproval {
    pub id: u64,
    pub comment: String,
    pub fingerprint: String,
    pub algorithm: String,
    pub data_len: usize,
}

#[tauri::command(async)]
pub fn ssh_agent_start(
    app: AppHandle,
    state: State<'_, SshAgentState>,
    master_key: String,
) -> Result<SshAgentStatus, String> {
    #[cfg(unix)]
    {
        unix::start(app, &state, master_key)
    }
    #[cfg(not(unix))]
    {
        let _ = (app, state, master_key);
        Err("L’agent SSH n’est pas encore pris en charge sous Windows.".into())
    }
}

#[tauri::command(async)]
pub fn ssh_agent_stop(state: State<'_, SshAgentState>) -> Result<(), String> {
    #[cfg(unix)]
    {
        unix::stop(&state)
    }
    #[cfg(not(unix))]
    {
        let _ = state;
        Ok(())
    }
}

#[tauri::command]
pub fn ssh_agent_status(state: State<'_, SshAgentState>) -> SshAgentStatus {
    #[cfg(unix)]
    {
        unix::status(&state)
    }
    #[cfg(not(unix))]
    {
        let _ = state;
        SshAgentStatus::stopped()
    }
}

#[tauri::command]
pub fn ssh_agent_respond(
    state: State<'_, SshAgentState>,
    id: u64,
    approved: bool,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        unix::respond(&state, id, approved)
    }
    #[cfg(not(unix))]
    {
        let _ = (state, id, approved);
        Ok(())
    }
}

#[cfg(unix)]
mod unix {
    use super::{SshAgentApproval, SshAgentState, SshAgentStatus};
    use coffre_core::{VaultFile, from_base64, open_with_master_key};
    use coffre_ssh_agent::{AgentHandle, Approval, ApprovalRequest, Identity};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, mpsc};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager};

    const APPROVAL_TIMEOUT: Duration = Duration::from_secs(60);

    #[derive(Default)]
    pub(super) struct Inner {
        start_guard: Mutex<()>,
        running: Mutex<Option<Running>>,
        pending: Arc<Mutex<HashMap<u64, mpsc::Sender<bool>>>>,
        next_id: Arc<AtomicU64>,
    }

    struct Running {
        handle: AgentHandle,
        socket: PathBuf,
        fingerprints: Vec<String>,
    }

    fn vault_dir(app: &AppHandle) -> Result<PathBuf, String> {
        app.path()
            .app_data_dir()
            .map(|dir| dir.join("vault"))
            .map_err(|error| error.to_string())
    }

    fn agent_socket(app: &AppHandle) -> Result<PathBuf, String> {
        app.path()
            .app_data_dir()
            .map(|dir| dir.join("ssh").join("agent.sock"))
            .map_err(|error| error.to_string())
    }

    fn status_of(running: &Option<Running>) -> SshAgentStatus {
        match running {
            Some(running) => SshAgentStatus {
                running: true,
                socket: Some(running.socket.display().to_string()),
                identities: running.fingerprints.len(),
                fingerprints: running.fingerprints.clone(),
            },
            None => SshAgentStatus::stopped(),
        }
    }

    pub(super) fn status(state: &SshAgentState) -> SshAgentStatus {
        match state.inner.running.lock() {
            Ok(running) => status_of(&running),
            Err(_) => SshAgentStatus::stopped(),
        }
    }

    pub(super) fn start(
        app: AppHandle,
        state: &SshAgentState,
        master_key: String,
    ) -> Result<SshAgentStatus, String> {
        let _guard = state
            .inner
            .start_guard
            .lock()
            .map_err(|_| "État de l’agent SSH indisponible".to_string())?;

        if let Ok(running) = state.inner.running.lock()
            && running.is_some()
        {
            return Ok(status_of(&running));
        }

        let mut key = from_base64(&master_key).map_err(|error| error.to_string())?;
        let dir = vault_dir(&app)?;
        let text = crate::vault_store::read_current(&dir)?
            .ok_or_else(|| "Aucun coffre local à ouvrir.".to_string())?;
        let file = VaultFile::parse(&text).map_err(|error| error.to_string())?;
        let opened = match open_with_master_key(&file, &key) {
            Ok(opened) => opened,
            Err(error) => {
                key.fill(0);
                return Err(error.to_string());
            }
        };
        key.fill(0);

        let mut identities = Vec::new();
        let mut fingerprints = Vec::new();
        for item in &opened.items {
            if item.content.get("type").and_then(|value| value.as_str()) != Some("ssh-key") {
                continue;
            }
            match Identity::from_item(&item.content) {
                Ok(identity) => {
                    fingerprints.push(identity.fingerprint());
                    identities.push(identity);
                }
                Err(_) => continue,
            }
        }
        drop(opened);

        if identities.is_empty() {
            return Err("Aucune clé SSH active dans ce coffre.".into());
        }

        let socket = agent_socket(&app)?;
        let pending = Arc::clone(&state.inner.pending);
        let next_id = Arc::clone(&state.inner.next_id);
        let emitter = app.clone();
        let approval: Arc<dyn Approval> = Arc::new(move |request: &ApprovalRequest| {
            let id = next_id.fetch_add(1, Ordering::Relaxed);
            let (sender, receiver) = mpsc::channel();
            {
                let Ok(mut pending) = pending.lock() else {
                    return false;
                };
                pending.insert(id, sender);
            }
            let payload = SshAgentApproval {
                id,
                comment: request.comment.clone(),
                fingerprint: request.fingerprint.clone(),
                algorithm: request.algorithm.clone(),
                data_len: request.data.len(),
            };
            if emitter.emit("coffre:ssh-agent-approval", payload).is_err() {
                if let Ok(mut pending) = pending.lock() {
                    pending.remove(&id);
                }
                return false;
            }
            let approved = matches!(receiver.recv_timeout(APPROVAL_TIMEOUT), Ok(true));
            if let Ok(mut pending) = pending.lock() {
                pending.remove(&id);
            }
            approved
        });

        let handle =
            AgentHandle::start(&socket, identities, approval).map_err(|error| error.to_string())?;
        let status = SshAgentStatus {
            running: true,
            socket: Some(socket.display().to_string()),
            identities: fingerprints.len(),
            fingerprints: fingerprints.clone(),
        };
        let mut running = state
            .inner
            .running
            .lock()
            .map_err(|_| "État de l’agent SSH indisponible".to_string())?;
        *running = Some(Running {
            handle,
            socket,
            fingerprints,
        });
        Ok(status)
    }

    pub(super) fn stop(state: &SshAgentState) -> Result<(), String> {
        let running = state
            .inner
            .running
            .lock()
            .map_err(|_| "État de l’agent SSH indisponible".to_string())?
            .take();
        if let Some(mut running) = running {
            running.handle.stop();
        }
        if let Ok(mut pending) = state.inner.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(false);
            }
        }
        Ok(())
    }

    pub(super) fn respond(state: &SshAgentState, id: u64, approved: bool) -> Result<(), String> {
        let sender = state
            .inner
            .pending
            .lock()
            .map_err(|_| "Approbation SSH indisponible".to_string())?
            .remove(&id);
        if let Some(sender) = sender {
            let _ = sender.send(approved);
        }
        Ok(())
    }
}
