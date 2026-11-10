// Sous Windows, l’agent SSH n’est pas disponible : le binaire doit le dire
// clairement et échouer, sans rien lire ni ouvrir.
#![cfg(not(unix))]

use std::process::Command;

#[test]
fn signale_clairement_l_absence_d_agent_sous_windows() {
    let output = Command::new(env!("CARGO_BIN_EXE_coffre-ssh-agent"))
        .arg("--list")
        .output()
        .expect("lancement");
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("pas encore pris en charge sous Windows"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
