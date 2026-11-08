use std::io::Write;
use std::process::{Command, Stdio};

const PASSWORD: &str = "phrase de passe de test solide";

fn fixture() -> String {
    format!(
        "{}/../../../src/lib/__fixtures__/v4.coffre.json",
        env!("CARGO_MANIFEST_DIR")
    )
}

#[test]
fn liste_et_lit_le_fichier_v4() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_coffre-cli"))
        .args([fixture().as_str(), "--password-stdin", "list"])
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
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("GitHub"));
}

#[test]
fn refuse_un_mauvais_mot_de_passe() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_coffre-cli"))
        .args([fixture().as_str(), "--password-stdin", "list"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("lancement");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(b"mauvais mot de passe\n")
        .expect("mot de passe");
    let output = child.wait_with_output().expect("sortie");
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("mot de passe"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn run_with_password(arguments: &[&str]) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_coffre-cli"))
        .args(arguments)
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
    child.wait_with_output().expect("sortie")
}

#[test]
fn lit_un_champ_sans_afficher_le_reste() {
    let output = run_with_password(&[
        fixture().as_str(),
        "--password-stdin",
        "get",
        "GitHub",
        "--field",
        "password",
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "s3cret-v2!");
}

#[cfg(unix)]
#[test]
fn injecte_un_secret_dans_l_environnement() {
    let output = run_with_password(&[
        fixture().as_str(),
        "--password-stdin",
        "run",
        "--env",
        "COFFRE_TEST=GitHub",
        "--",
        "/bin/sh",
        "-c",
        "printf %s \"$COFFRE_TEST\"",
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stdout), "s3cret-v2!");
}

#[cfg(unix)]
#[test]
fn propage_le_code_de_sortie_de_la_commande() {
    let output = run_with_password(&[
        fixture().as_str(),
        "--password-stdin",
        "run",
        "--env",
        "COFFRE_TEST=GitHub",
        "--",
        "/bin/sh",
        "-c",
        "exit 7",
    ]);
    assert_eq!(output.status.code(), Some(7));
}
