//! Agent SSH local en ligne de commande.
//!
//! Le mot de passe est lu sur le terminal ou sur stdin avec
//! `--password-stdin`. Chaque signature doit être approuvée dans le terminal ;
//! aucun mode automatique n’est proposé.

#[cfg(unix)]
mod unix {
    use clap::Parser;
    use coffre_core::{OpenedVault, VaultFile, open};
    use coffre_ssh_agent::{Approval, ApprovalRequest, Identity, bind_socket, serve};
    use std::io::{BufRead, BufReader, Write};
    use std::path::{Path, PathBuf};
    use std::process::ExitCode;
    use std::sync::{Arc, Mutex, Once};

    #[derive(Parser)]
    #[command(
        name = "coffre-ssh-agent",
        version,
        about = "Agent SSH local pour les clés d’un coffre Coffre"
    )]
    struct Cli {
        /// Fichier `.coffre`.
        file: PathBuf,
        /// Lit le mot de passe sur stdin plutôt que sur le terminal.
        #[arg(long)]
        password_stdin: bool,
        /// Socket Unix à créer (par défaut : dossier temporaire de l’utilisateur).
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Liste les identités SSH puis quitte.
        #[arg(long)]
        list: bool,
    }

    struct TerminalApproval {
        lock: Mutex<()>,
        warned: Once,
    }

    impl TerminalApproval {
        fn new() -> Self {
            Self {
                lock: Mutex::new(()),
                warned: Once::new(),
            }
        }
    }

    impl Approval for TerminalApproval {
        fn approve(&self, request: &ApprovalRequest) -> bool {
            let _guard = self
                .lock
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let tty = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open("/dev/tty");
            let Ok(mut tty) = tty else {
                self.warned.call_once(|| {
                    eprintln!(
                        "coffre-ssh-agent : approbation impossible sans terminal ; signature refusée."
                    );
                });
                return false;
            };
            if writeln!(
                tty,
                "\nDemande de signature SSH\n  Clé : {}\n  Empreinte : {}\n  Algorithme : {}\n  Données : {} octets",
                request.comment,
                request.fingerprint,
                request.algorithm,
                request.data.len()
            )
            .is_err()
                || write!(tty, "Signer ? [o/N] ").is_err()
                || tty.flush().is_err()
            {
                return false;
            }
            let mut answer = String::new();
            if BufReader::new(tty).read_line(&mut answer).is_err() {
                return false;
            }
            matches!(
                answer.trim().to_ascii_lowercase().as_str(),
                "o" | "oui" | "y" | "yes"
            )
        }
    }

    fn read_password(stdin: bool) -> Result<String, String> {
        if stdin {
            let mut line = String::new();
            std::io::stdin()
                .read_line(&mut line)
                .map_err(|_| "lecture du mot de passe impossible".to_string())?;
            Ok(line.trim_end_matches(['\r', '\n']).to_string())
        } else {
            rpassword::prompt_password("Mot de passe maître : ")
                .map_err(|_| "lecture du mot de passe impossible".to_string())
        }
    }

    fn open_vault(path: &Path, password_stdin: bool) -> Result<OpenedVault, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|_| format!("fichier inaccessible : {}", path.display()))?;
        let file = VaultFile::parse(&text).map_err(|error| error.to_string())?;
        let password = read_password(password_stdin)?;
        open(&file, &password).map_err(|error| error.to_string())
    }

    fn identities(opened: &OpenedVault) -> Result<Vec<Identity>, String> {
        let mut identities = Vec::new();
        let mut errors = Vec::new();
        for item in &opened.items {
            let is_ssh =
                item.content.get("type").and_then(|value| value.as_str()) == Some("ssh-key");
            if !is_ssh {
                continue;
            }
            match Identity::from_item(&item.content) {
                Ok(identity) => identities.push(identity),
                Err(error) => errors.push(format!("{} : {error}", item.id)),
            }
        }
        for error in errors {
            eprintln!("coffre-ssh-agent : clé ignorée — {error}");
        }
        Ok(identities)
    }

    fn default_socket() -> PathBuf {
        if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
            return PathBuf::from(runtime).join("coffre-ssh-agent.sock");
        }
        std::env::temp_dir().join(format!("coffre-ssh-agent-{}.sock", current_uid()))
    }

    fn current_uid() -> u32 {
        unsafe extern "C" {
            fn geteuid() -> u32;
        }
        // geteuid ne peut pas échouer.
        unsafe { geteuid() }
    }

    struct SocketGuard {
        path: PathBuf,
        device: u64,
        inode: u64,
    }

    impl SocketGuard {
        fn new(path: &Path) -> Result<Self, String> {
            use std::os::unix::fs::MetadataExt;
            let metadata = std::fs::symlink_metadata(path)
                .map_err(|_| "socket de l’agent introuvable".to_string())?;
            Ok(Self {
                path: path.to_path_buf(),
                device: metadata.dev(),
                inode: metadata.ino(),
            })
        }
    }

    impl Drop for SocketGuard {
        fn drop(&mut self) {
            use std::os::unix::fs::MetadataExt;
            if let Ok(metadata) = std::fs::symlink_metadata(&self.path)
                && metadata.dev() == self.device
                && metadata.ino() == self.inode
            {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }

    pub fn main() -> ExitCode {
        let cli = Cli::parse();
        let result = run(cli);
        match result {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("coffre-ssh-agent : {error}");
                ExitCode::FAILURE
            }
        }
    }

    fn run(cli: Cli) -> Result<(), String> {
        let opened = open_vault(&cli.file, cli.password_stdin)?;
        let identities = identities(&opened)?;
        if identities.is_empty() {
            return Err("aucune clé SSH active dans ce coffre".into());
        }
        if cli.list {
            for identity in &identities {
                println!(
                    "{}\t{}\t{}",
                    identity.algorithm(),
                    identity.fingerprint(),
                    identity.comment()
                );
            }
            return Ok(());
        }

        let socket = cli.socket.unwrap_or_else(default_socket);
        let listener = bind_socket(&socket).map_err(|error| error.to_string())?;
        let guard = SocketGuard::new(&socket)?;
        println!("Agent SSH actif");
        println!("  Socket : {}", socket.display());
        println!("  export SSH_AUTH_SOCK={}", socket.display());
        let approval = Arc::new(TerminalApproval::new());
        let result = serve(listener, Arc::new(identities), approval);
        drop(guard);
        result.map_err(|error| error.to_string())
    }
}

#[cfg(unix)]
fn main() -> std::process::ExitCode {
    unix::main()
}

#[cfg(not(unix))]
fn main() -> std::process::ExitCode {
    eprintln!("coffre-ssh-agent : l’agent SSH n’est pas encore pris en charge sous Windows.");
    std::process::ExitCode::FAILURE
}
