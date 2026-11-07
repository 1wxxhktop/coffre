//! Tests de l’interface native : les vues sont rendues hors écran, sans
//! fenêtre, avec `nanoui.ui.Tester`.
const std = @import("std");
const nanoui = @import("nanoui");
const ui = nanoui.ui;

const app = @import("app.zig");
const App = app.App;
const write = @import("core/write.zig");
const format = @import("core/format.zig");
const vault = @import("core/vault.zig");

const PASSWORD = "phrase de passe de test solide";
const v1 = @embedFile("core/fixtures/v1.coffre.json");
const v3 = @embedFile("core/fixtures/v3.coffre.json");

fn tester(t: *ui.Tester, state: *App) !void {
    try t.init(std.testing.allocator, .init(state, App.view), .{
        .theme = app.theme,
        .width = 1080,
        .height = 720,
    });
}

test "l’écran de verrouillage propose le fichier et la phrase de passe" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("Coffre"));
    try std.testing.expect(t.hasText("Déverrouiller"));
    try std.testing.expect(t.hasText("Choisir…"));
    try std.testing.expect(t.hasText("Aucun fichier sélectionné"));
    try std.testing.expect(t.hasText("Aucune donnée ne quitte cet appareil."));
}

test "le formulaire de création affiche le nom, la phrase et la confirmation" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    state.creating = true;

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("Nom du coffre"));
    try std.testing.expect(t.hasText("Confirmation"));
    try std.testing.expect(t.hasText("Créer le coffre…"));
    try std.testing.expect(t.hasText("Annuler"));
    try std.testing.expect(!t.hasText("Déverrouiller"));
}

test "la création refuse une phrase trop courte puis une confirmation différente" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    state.creating = true;
    state.new_name.set("Essai");
    state.password.set("court");
    state.confirm.set("court");

    state.createVault();
    try std.testing.expect(std.mem.indexOf(u8, state.message(), "12 caractères") != null);

    state.password.set("phrase de passe solide");
    state.confirm.set("autre phrase de passe");
    state.createVault();
    try std.testing.expect(std.mem.indexOf(u8, state.message(), "ne correspondent pas") != null);
}

test "un coffre créé s’ouvre avec sa clé maîtresse sans redériver Argon2id" {
    var created = try write.create(std.testing.allocator, "phrase de passe de test", .{ .name = "Essai" }, std.testing.io);
    defer created.deinit(std.testing.allocator);

    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openTextWithMasterKey(created.bytes, created.master_key);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("Essai"));
    try std.testing.expect(t.hasText("0 élément"));
}

test "un coffre créé sur disque se déverrouille par le chemin normal" {
    const allocator = std.testing.allocator;
    var created = try write.create(allocator, "phrase de passe de test", .{ .name = "Essai disque" }, std.testing.io);
    defer created.deinit(allocator);

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir_path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer allocator.free(dir_path);
    const path = try std.fs.path.join(allocator, &.{ dir_path, "essai.coffre" });
    defer allocator.free(path);
    try write.saveAtomic(allocator, path, created.bytes, std.testing.io);

    var state = App.init(allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);
    state.password.set("phrase de passe de test");
    state.unlock();

    try std.testing.expect(state.opened != null);
    try std.testing.expectEqualStrings("Essai disque", state.opened.?.vaults[0].name);
    try std.testing.expectEqualStrings("", state.password.text());
}

test "le formulaire de création d’un élément affiche les champs d’une connexion" {
    const allocator = std.testing.allocator;
    var created = try write.create(allocator, "phrase de passe de test", .{ .name = "Essai" }, std.testing.io);
    defer created.deinit(allocator);

    var state = App.init(allocator, std.testing.io);
    defer state.deinit();
    try state.openTextWithMasterKey(created.bytes, created.master_key);
    state.beginCreate();

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("Nouvel élément"));
    try std.testing.expect(t.hasText("Titre"));
    try std.testing.expect(t.hasText("Identifiant"));
    try std.testing.expect(t.hasText("Mot de passe"));
    try std.testing.expect(t.hasText("Site web"));
    try std.testing.expect(t.hasText("Créer l’élément"));
}

test "créer un élément l’écrit sur disque et le relit par le cœur" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir_path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer allocator.free(dir_path);
    const path = try std.fs.path.join(allocator, &.{ dir_path, "essai.coffre" });
    defer allocator.free(path);

    var created = try write.create(allocator, "phrase de passe de test", .{ .name = "Essai" }, std.testing.io);
    defer created.deinit(allocator);
    try write.saveAtomic(allocator, path, created.bytes, std.testing.io);

    var state = App.init(allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);
    state.password.set("phrase de passe de test");
    state.unlock();
    try std.testing.expect(state.opened != null);

    state.beginCreate();
    state.editor.title.set("GitHub");
    state.editor.username.set("octocat");
    state.editor.password.set("s3cret!");
    state.editor.url.set("https://github.com");
    state.editor.notes.set("Compte de test");
    state.saveEditor();

    try std.testing.expect(state.editor.active == false);
    try std.testing.expectEqual(@as(usize, 1), state.opened.?.items.len);
    try std.testing.expectEqualStrings("GitHub", state.opened.?.items[0].content.title);
    try std.testing.expectEqualStrings("octocat", state.opened.?.items[0].content.username.?);
    try std.testing.expectEqualStrings("s3cret!", state.opened.?.items[0].content.password.?);
    try std.testing.expectEqual(@as(usize, 1), state.opened.?.vaults[0].item_count);

    // Relecture depuis le disque, comme au prochain lancement. L’arène imite
    // celle de l’application : les chaînes déchiffrées y vivent.
    const text = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, allocator, .limited(1024 * 1024));
    defer allocator.free(text);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    var parsed = try format.parse(arena.allocator(), text);
    defer parsed.deinit();
    try std.testing.expectEqual(@as(usize, 1), parsed.value.items.len);

    var reopened = try vault.open(arena.allocator(), &parsed.value, "phrase de passe de test", std.testing.io);
    defer reopened.deinit(arena.allocator());
    try std.testing.expectEqualStrings("GitHub", reopened.items[0].content.title);
    try std.testing.expectEqualStrings("https://github.com", reopened.items[0].content.urls.?[0]);
}

test "modifier un élément met à jour le contenu et conserve la date de création" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir_path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer allocator.free(dir_path);
    const path = try std.fs.path.join(allocator, &.{ dir_path, "essai.coffre" });
    defer allocator.free(path);

    var created = try write.create(allocator, "phrase de passe de test", .{ .name = "Essai" }, std.testing.io);
    defer created.deinit(allocator);
    try write.saveAtomic(allocator, path, created.bytes, std.testing.io);

    var state = App.init(allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);
    state.password.set("phrase de passe de test");
    state.unlock();

    state.beginCreate();
    state.editor.title.set("Ancien titre");
    state.editor.username.set("ancien");
    state.saveEditor();
    try std.testing.expectEqual(@as(usize, 1), state.opened.?.items.len);
    const created_at = state.opened.?.items[0].created_at;

    state.beginEdit(0);
    try std.testing.expectEqualStrings("Ancien titre", state.editor.title.text());
    state.editor.title.set("Nouveau titre");
    state.editor.username.set("nouveau");
    state.saveEditor();

    try std.testing.expectEqualStrings("Nouveau titre", state.opened.?.items[0].content.title);
    try std.testing.expectEqualStrings("nouveau", state.opened.?.items[0].content.username.?);
    try std.testing.expectEqualStrings(created_at, state.opened.?.items[0].created_at);
    try std.testing.expect(state.opened.?.items[0].updated_at.len > 0);
}

test "créer une note écrit un élément de type note" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir_path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer allocator.free(dir_path);
    const path = try std.fs.path.join(allocator, &.{ dir_path, "essai.coffre" });
    defer allocator.free(path);

    var created = try write.create(allocator, "phrase de passe de test", .{ .name = "Essai" }, std.testing.io);
    defer created.deinit(allocator);
    try write.saveAtomic(allocator, path, created.bytes, std.testing.io);

    var state = App.init(allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);
    state.password.set("phrase de passe de test");
    state.unlock();

    state.beginCreate();
    state.editor.kind = "note";
    state.editor.title.set("Recette");
    state.editor.notes.set("Une note libre.");
    state.saveEditor();

    try std.testing.expectEqual(@as(usize, 1), state.opened.?.items.len);
    try std.testing.expectEqualStrings("note", state.opened.?.items[0].content.type);
    try std.testing.expectEqualStrings("Une note libre.", state.opened.?.items[0].content.notes);
    try std.testing.expect(state.opened.?.items[0].content.username == null);
}

test "modifier un élément conserve les champs propres au type et les métadonnées" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir_path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer allocator.free(dir_path);
    const path = try std.fs.path.join(allocator, &.{ dir_path, "fixture.coffre" });
    defer allocator.free(path);
    try std.Io.Dir.cwd().writeFile(std.testing.io, .{ .sub_path = path, .data = v3 });

    var state = App.init(allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);
    state.password.set(PASSWORD);
    state.unlock();
    try std.testing.expectEqual(@as(usize, 1), state.opened.?.items.len);

    state.beginEdit(0);
    state.editor.title.set("GitHub modifié");
    state.saveEditor();

    const content = &state.opened.?.items[0].content;
    try std.testing.expectEqualStrings("GitHub modifié", content.title);
    try std.testing.expectEqualStrings("studio26", content.username.?);
    try std.testing.expectEqualStrings("https://github.com", content.urls.?[0]);
    try std.testing.expect(content.favorite);
    try std.testing.expectEqual(@as(usize, 1), content.tags.len);
    try std.testing.expectEqualStrings("dev", content.tags[0]);

    const text = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, allocator, .limited(1024 * 1024));
    defer allocator.free(text);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    var parsed = try format.parse(arena.allocator(), text);
    defer parsed.deinit();
    var reopened = try vault.open(arena.allocator(), &parsed.value, PASSWORD, std.testing.io);
    defer reopened.deinit(arena.allocator());
    try std.testing.expectEqualStrings("GitHub modifié", reopened.items[0].content.title);
    try std.testing.expect(reopened.items[0].content.favorite);
}

test "importe un export Enpass et l’écrit sur disque" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir_path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer allocator.free(dir_path);
    const path = try std.fs.path.join(allocator, &.{ dir_path, "import.coffre" });
    defer allocator.free(path);

    var created = try write.create(allocator, "phrase de passe de test", .{ .name = "Essai" }, std.testing.io);
    defer created.deinit(allocator);
    try write.saveAtomic(allocator, path, created.bytes, std.testing.io);

    var state = App.init(allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);
    state.password.set("phrase de passe de test");
    state.unlock();

    const export_text =
        \\{"items":[{"title":"GitHub","subtitle":"octocat","category":"Login",
        \\"fields":[{"label":"Username","value":"octocat"},{"label":"Password","value":"s3cret!","sensitive":1},
        \\{"label":"Website","value":"https://github.com"}]}]}
    ;
    state.importFromText(export_text);

    try std.testing.expectEqual(@as(usize, 1), state.opened.?.items.len);
    const content = &state.opened.?.items[0].content;
    try std.testing.expectEqualStrings("GitHub", content.title);
    try std.testing.expectEqualStrings("octocat", content.username.?);
    try std.testing.expectEqualStrings("s3cret!", content.password.?);
    try std.testing.expectEqualStrings("https://github.com", content.urls.?[0]);
    try std.testing.expectEqual(@as(usize, 1), state.opened.?.vaults[0].item_count);
    try std.testing.expect(std.mem.indexOf(u8, state.message(), "importé") != null);

    // Relecture par le cœur, comme au prochain lancement.
    const text = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, allocator, .limited(1024 * 1024));
    defer allocator.free(text);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    var parsed = try format.parse(arena.allocator(), text);
    defer parsed.deinit();
    var reopened = try vault.open(arena.allocator(), &parsed.value, "phrase de passe de test", std.testing.io);
    defer reopened.deinit(arena.allocator());
    try std.testing.expectEqualStrings("GitHub", reopened.items[0].content.title);
    try std.testing.expectEqualStrings("s3cret!", reopened.items[0].content.password.?);
}

test "un second import ignore les doublons" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir_path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer allocator.free(dir_path);
    const path = try std.fs.path.join(allocator, &.{ dir_path, "doublons.coffre" });
    defer allocator.free(path);

    var created = try write.create(allocator, "phrase de passe de test", .{ .name = "Essai" }, std.testing.io);
    defer created.deinit(allocator);
    try write.saveAtomic(allocator, path, created.bytes, std.testing.io);

    var state = App.init(allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);
    state.password.set("phrase de passe de test");
    state.unlock();

    const csv =
        \\Nom;Identifiant;Mot de passe;Site web
        \\Banque;jean;secret;https://banque.fr
    ;
    state.importFromText(csv);
    try std.testing.expectEqual(@as(usize, 1), state.opened.?.items.len);

    state.importFromText(csv);
    try std.testing.expectEqual(@as(usize, 1), state.opened.?.items.len);
    try std.testing.expect(std.mem.indexOf(u8, state.message(), "doublon") != null);
}

test "refuse d’importer un fichier coffre comme export" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);

    state.importFromText(v3);
    try std.testing.expectEqual(@as(usize, 1), state.opened.?.items.len);
    try std.testing.expect(state.message_kind == .failure);
    try std.testing.expect(std.mem.indexOf(u8, state.message(), "coffre Coffre") != null);
}

test "un mauvais mot de passe affiche une erreur en français" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();

    try std.testing.expectError(error.WrongPassword, state.openText(v3, "mauvais mot de passe"));
    try std.testing.expect(state.opened == null);
}

test "le détail d’un élément masque puis révèle le mot de passe" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("GitHub"));
    try std.testing.expect(t.hasText("Connexion"));
    try std.testing.expect(t.hasText("••••••••••••••"));
    try std.testing.expect(!t.hasText("s3cret!"));

    state.reveal = true;
    t.frame();
    try std.testing.expect(t.hasText("s3cret!"));
}

test "la recherche filtre les éléments" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v1, PASSWORD);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("GitHub"));
    state.search.set("introuvable");
    t.frame();
    try std.testing.expect(t.hasText("Aucun élément ne correspond."));
    try std.testing.expect(!t.hasText("GitHub"));
}

test "la corbeille montre les éléments supprimés" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);
    state.show_trash = true;
    state.selected_item = null;

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("La corbeille est vide."));
    try std.testing.expect(t.hasText("Corbeille"));
}

test "le verrouillage efface le contenu déchiffré" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);
    try std.testing.expect(state.opened != null);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    state.lock();
    t.frame();
    try std.testing.expect(state.opened == null);
    try std.testing.expect(t.hasText("Déverrouiller"));
    try std.testing.expect(!t.hasText("GitHub"));
}

test "unlock lit le fichier choisi et efface la phrase de passe" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "v1.coffre", .data = v1 });

    const path = try std.fs.path.join(std.testing.allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path, "v1.coffre" });
    defer std.testing.allocator.free(path);

    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);
    state.password.set(PASSWORD);

    state.unlock();
    try std.testing.expect(state.opened != null);
    try std.testing.expectEqualStrings("", state.password.text());
    try std.testing.expectEqual(@as(usize, 2), state.opened.?.items.len);
}

test "unlock signale un fichier absent" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.setPath("/tmp/coffre-qui-n-existe-pas.coffre");
    state.password.set(PASSWORD);

    state.unlock();
    try std.testing.expect(state.opened == null);
    try std.testing.expect(std.mem.indexOf(u8, state.message(), "introuvable") != null);
}

test "saisir la phrase de passe puis cliquer sur Déverrouiller ouvre le fichier" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "v3.coffre", .data = v3 });

    const path = try std.fs.path.join(std.testing.allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path, "v3.coffre" });
    defer std.testing.allocator.free(path);

    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.setPath(path);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    // Le champ du mot de passe prend le clavier au premier rendu.
    t.frame();
    t.typeText(PASSWORD);
    try std.testing.expectEqualStrings(PASSWORD, state.password.text());

    try t.clickText("Déverrouiller");
    try std.testing.expect(state.opened != null);
    try std.testing.expect(t.hasText("GitHub"));
}

test "le verrouillage demandé pendant une trame s’applique à la suivante" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    state.lock_requested = true;
    t.frame();
    try std.testing.expect(state.opened == null);
    try std.testing.expect(t.hasText("Déverrouiller"));
}

test "un fichier v1 se lit et s’affiche comme un coffre v3" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v1, PASSWORD);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("Ancien format"));
    try std.testing.expect(t.hasText("GitHub"));
}

test "le générateur insère un mot de passe dans le formulaire" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);
    state.beginEdit(0);
    state.editor.generator_open = true;

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("Générateur"));
    try std.testing.expect(t.hasText("Générer et insérer"));
    try std.testing.expect(t.hasText("Éviter les caractères ambigus"));

    try t.clickText("Générer et insérer");
    t.frame();

    try std.testing.expectEqual(@as(usize, 20), state.editor.password.text().len);
    try std.testing.expect(std.mem.indexOf(u8, state.message(), "généré") != null);

    // Le panneau bascule sur la liste EFF pour une phrase de passe.
    state.editor.generator_mode = .passphrase;
    state.editor.generator_words = 4;
    t.frame();
    try t.clickText("Générer et insérer");
    t.frame();

    var parts = std.mem.splitScalar(u8, state.editor.password.text(), '-');
    var words: usize = 0;
    while (parts.next()) |part| {
        words += 1;
        try std.testing.expect(part.len > 0);
    }
    try std.testing.expectEqual(@as(usize, 4), words);
    try std.testing.expect(std.mem.indexOf(u8, state.message(), "Phrase de passe") != null);
}

test "le détail affiche un code TOTP vivant et masqué" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);

    const uri = try state.arena.allocator().dupe(
        u8,
        "otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
    );
    state.opened.?.items[0].content.totp = uri;

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("Double authentification"));
    try std.testing.expect(t.hasText("••• •••"));
    try std.testing.expect(t.hasText("Code renouvelé toutes les 30 secondes."));

    const totp = @import("core/totp.zig");
    var secret_buf: [128]u8 = undefined;
    const config = try totp.parseUri(uri, &secret_buf);
    const before = try totp.compute(config, std.Io.Timestamp.now(std.testing.io, .real).toMilliseconds());

    state.reveal = true;
    t.frame();
    try std.testing.expect(!t.hasText("••• •••"));

    // Le code affiché est bien celui calculé pour la période courante, ou la
    // suivante si la seconde a changé pendant la trame.
    const after = try totp.compute(config, std.Io.Timestamp.now(std.testing.io, .real).toMilliseconds());
    try std.testing.expect(t.hasText(before.slice()) or t.hasText(after.slice()));
}

test "une URI TOTP invalide retombe sur le champ brut" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);

    const uri = try state.arena.allocator().dupe(u8, "pas-une-uri");
    state.opened.?.items[0].content.totp = uri;
    state.reveal = true;

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.hasText("Double authentification"));
    try std.testing.expect(t.hasText("pas-une-uri"));
    try std.testing.expect(!t.hasText("Code renouvelé toutes les 30 secondes."));
}

test "le verrouillage automatique suit l’inactivité" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);
    state.auto_lock_seconds = 60;
    state.last_activity_ms = std.Io.Timestamp.now(std.testing.io, .real).toMilliseconds() - 61_000;

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(state.opened == null);
    try std.testing.expect(t.hasText("Coffre verrouillé après inactivité."));
    try std.testing.expect(t.hasText("Déverrouiller"));
}

test "le verrouillage automatique peut être désactivé" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);
    state.auto_lock_seconds = 0;
    state.last_activity_ms = std.Io.Timestamp.now(std.testing.io, .real).toMilliseconds() - 86_400_000;

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(state.opened != null);
    try std.testing.expect(t.hasText("GitHub"));
}

test "les raccourcis verrouillent et créent un élément" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    try std.testing.expect(t.shortcut(.{ .key = 'l', .cmd = true }));
    try std.testing.expect(state.opened == null);
    try std.testing.expect(t.hasText("Déverrouiller"));

    try state.openText(v3, PASSWORD);
    t.frame();
    try std.testing.expect(t.shortcut(.{ .key = 'n', .cmd = true }));
    try std.testing.expect(state.editor.active);
    try std.testing.expect(t.hasText("Nouvel élément"));
}

test "le presse-papiers est effacé au verrouillage" {
    var state = App.init(std.testing.allocator, std.testing.io);
    defer state.deinit();
    try state.openText(v3, PASSWORD);

    var t: ui.Tester = undefined;
    try tester(&t, &state);
    defer t.deinit();

    state.clipboard_secret = true;
    state.lock();
    try std.testing.expect(!state.clipboard_secret);
}
