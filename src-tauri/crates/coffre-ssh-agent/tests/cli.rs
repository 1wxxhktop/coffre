use coffre_core::{VaultFile, create_item, open, sign};
use rand_core::OsRng;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};
use std::io::Write;
use std::process::{Command, Stdio};

const PASSWORD: &str = "phrase de passe de test solide";

fn fixture() -> String {
    format!(
        "{}/../../../src/lib/__fixtures__/v4.coffre.json",
        env!("CARGO_MANIFEST_DIR")
    )
}

fn vault_with_ssh_key() -> (String, String, String) {
    let text = std::fs::read_to_string(fixture()).expect("fixture");
    let file = VaultFile::parse(&text).expect("parse");
    let mut opened = open(&file, PASSWORD).expect("ouverture");
    let vault_id = opened.vaults[0].id.clone();

    let mut key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).expect("clé");
    key.set_comment("serveur de test");
    let private_key = key.to_openssh(LineEnding::LF).expect("PEM").to_string();
    let public_key = key.public_key().to_openssh().expect("clé publique");
    let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
    let content = serde_json::json!({
        "type": "ssh-key",
        "title": "Serveur",
        "favorite": false,
        "notes": "",
        "tags": [],
        "customFields": [],
        "attachments": [],
        "deletedAt": null,
        "expiresAt": "",
        "privateKey": private_key,
        "publicKey": public_key,
        "fingerprint": fingerprint,
        "comment": "serveur de test",
    });
    create_item(
        &mut opened.file,
        &opened.session,
        &vault_id,
        content,
        "2026-11-08T00:00:00.000Z",
    )
    .expect("élément");
    let signed = sign(
        opened.file.clone(),
        &mut opened.session,
        Some(&file),
        "test-agent",
        "2026-11-08T00:00:01.000Z",
    )
    .expect("signature");
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "coffre-ssh-agent-list-{}-{unique}.coffre.json",
        std::process::id()
    ));
    std::fs::write(&path, serde_json::to_string_pretty(&signed).unwrap()).expect("écriture");
    (
        path.display().to_string(),
        fingerprint,
        "serveur de test".into(),
    )
}

#[test]
fn liste_les_cles_ssh_du_coffre() {
    let (path, fingerprint, comment) = vault_with_ssh_key();
    let mut child = Command::new(env!("CARGO_BIN_EXE_coffre-ssh-agent"))
        .args([path.as_str(), "--password-stdin", "--list"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("lancement");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(format!("{PASSWORD}\n").as_bytes())
        .expect("mot de passe");
    let output = child.wait_with_output().expect("sortie");
    let _ = std::fs::remove_file(&path);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("ssh-ed25519"), "{stdout}");
    assert!(
        stdout.contains(&fingerprint),
        "attendu {fingerprint}\n{stdout}"
    );
    assert!(stdout.contains(&comment), "{stdout}");
}

#[test]
fn refuse_un_coffre_sans_cle_ssh() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_coffre-ssh-agent"))
        .args([fixture().as_str(), "--password-stdin", "--list"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("lancement");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(format!("{PASSWORD}\n").as_bytes())
        .expect("mot de passe");
    let output = child.wait_with_output().expect("sortie");
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("aucune clé SSH"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[cfg(unix)]
#[test]
fn repond_au_vrai_client_ssh_add() {
    use std::time::{Duration, Instant};

    let ssh_add = ["/usr/bin/ssh-add", "/bin/ssh-add", "/usr/local/bin/ssh-add"]
        .iter()
        .find(|path| std::path::Path::new(path).exists());
    let Some(ssh_add) = ssh_add else {
        eprintln!("ssh-add absent : test ignoré");
        return;
    };

    struct KillOnDrop(std::process::Child);
    impl Drop for KillOnDrop {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    let (vault, fingerprint, comment) = vault_with_ssh_key();
    let dir =
        std::path::PathBuf::from("/tmp").join(format!("coffre-agent-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let socket = dir.join("agent.sock");
    let mut child = Command::new(env!("CARGO_BIN_EXE_coffre-ssh-agent"))
        .args([
            vault.as_str(),
            "--password-stdin",
            "--socket",
            socket.to_str().expect("socket UTF-8"),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("lancement de l’agent");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(format!("{PASSWORD}\n").as_bytes())
        .expect("mot de passe");
    drop(child.stdin.take());
    let mut guard = KillOnDrop(child);

    let deadline = Instant::now() + Duration::from_secs(5);
    while !socket.exists() {
        if let Some(status) = guard.0.try_wait().expect("état") {
            let mut stderr = String::new();
            if let Some(mut pipe) = guard.0.stderr.take() {
                use std::io::Read;
                let _ = pipe.read_to_string(&mut stderr);
            }
            panic!("l’agent s’est arrêté ({status}) : {stderr}");
        }
        assert!(
            Instant::now() < deadline,
            "le socket de l’agent n’a pas été créé"
        );
        std::thread::sleep(Duration::from_millis(50));
    }

    let output = Command::new(ssh_add)
        .arg("-l")
        .env("SSH_AUTH_SOCK", &socket)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("ssh-add");
    let _ = std::fs::remove_file(&vault);
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains(&fingerprint),
        "attendu {fingerprint}\n{stdout}"
    );
    assert!(stdout.contains(&comment), "{stdout}");
}

#[cfg(unix)]
fn start_signing_agent() -> (
    coffre_ssh_agent::AgentHandle,
    std::path::PathBuf,
    std::path::PathBuf,
) {
    use coffre_ssh_agent::{AgentHandle, Approval, ApprovalRequest};
    use std::sync::Arc;

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = std::path::PathBuf::from("/tmp").join(format!(
        "coffre-agent-sign-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let socket = dir.join("agent.sock");
    let public_key = dir.join("id_ed25519.pub");
    std::fs::create_dir_all(&dir).expect("dossier");
    let mut key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).expect("clé");
    key.set_comment("signature@coffre");
    let pem = key.to_openssh(LineEnding::LF).expect("PEM").to_string();
    std::fs::write(&public_key, key.public_key().to_openssh().unwrap()).expect("clé publique");
    let identity = coffre_ssh_agent::Identity::from_openssh(&pem, "signature").expect("identité");
    let approval: Arc<dyn Approval> = Arc::new(|_: &ApprovalRequest| true);
    let handle = AgentHandle::start(&socket, vec![identity], approval).expect("agent");
    (handle, socket, public_key)
}

#[cfg(unix)]
#[test]
fn signe_avec_ssh_keygen_via_l_agent() {
    let Some(ssh_keygen) = ["/usr/bin/ssh-keygen", "/bin/ssh-keygen"]
        .iter()
        .find(|path| std::path::Path::new(path).exists())
    else {
        eprintln!("ssh-keygen absent : test ignoré");
        return;
    };
    let (mut agent, socket, public_key) = start_signing_agent();
    let mut child = Command::new(ssh_keygen)
        .args([
            "-Y",
            "sign",
            "-f",
            public_key.to_str().unwrap(),
            "-n",
            "coffre-test",
            "-",
        ])
        .env("SSH_AUTH_SOCK", &socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("ssh-keygen");
    child.stdin.as_mut().unwrap().write_all(b"bonjour").unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().expect("sortie");
    agent.stop();
    let dir = socket.parent().unwrap().to_path_buf();
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("BEGIN SSH SIGNATURE"),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[cfg(unix)]
#[test]
fn signe_un_commit_git_via_l_agent() {
    let Some(ssh_keygen) = ["/usr/bin/ssh-keygen", "/bin/ssh-keygen"]
        .iter()
        .find(|path| std::path::Path::new(path).exists())
    else {
        eprintln!("ssh-keygen absent : test ignoré");
        return;
    };
    let Some(git) = [
        "/usr/bin/git",
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
    ]
    .iter()
    .find(|path| std::path::Path::new(path).exists()) else {
        eprintln!("git absent : test ignoré");
        return;
    };
    let (mut agent, socket, public_key) = start_signing_agent();
    let dir = socket.parent().unwrap().to_path_buf();
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).unwrap();

    let run = |args: &[&str]| {
        let output = Command::new(git)
            .args(args)
            .current_dir(&repo)
            .env("SSH_AUTH_SOCK", &socket)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("HOME", &dir)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@coffre")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@coffre")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} : {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["init", "-q"]);
    run(&["config", "gpg.format", "ssh"]);
    run(&["config", "user.signingkey", public_key.to_str().unwrap()]);
    run(&["config", "commit.gpgsign", "true"]);
    run(&["commit", "--allow-empty", "-q", "-m", "commit signé"]);

    let commit = Command::new(git)
        .args(["cat-file", "-p", "HEAD"])
        .current_dir(&repo)
        .output()
        .unwrap();
    agent.stop();
    let _ = std::fs::remove_dir_all(&dir);
    assert!(commit.status.success());
    assert!(
        String::from_utf8_lossy(&commit.stdout).contains("gpgsig"),
        "{}",
        String::from_utf8_lossy(&commit.stdout)
    );
    let _ = ssh_keygen;
}
