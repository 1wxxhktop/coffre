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
