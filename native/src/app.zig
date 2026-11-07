//! Coffre — application desktop native (Zig + nanoui).
//!
//! Le cœur (crypto, format `.coffre`, ouverture, écriture) vit dans
//! `src/core/` et ne dépend pas de l’interface. Ce fichier ne contient que
//! l’état de la fenêtre et la vue immédiate : écran de verrouillage, création
//! d’un coffre, liste des coffres et des éléments, détail d’un élément.

const std = @import("std");
const nanoui = @import("nanoui");
const ui = nanoui.ui;

const crypto = @import("core/crypto.zig");
const format = @import("core/format.zig");
const vault = @import("core/vault.zig");
const write = @import("core/write.zig");
const items = @import("core/items.zig");
const importer = @import("core/import.zig");
const generator = @import("core/generator.zig");
const totp = @import("core/totp.zig");
const recovery = @import("core/recovery.zig");

/// Taille maximale d’un fichier lu : 50 Mo de pièces jointes, leur base64 et
/// le reste du JSON tiennent largement dedans.
const MAX_FILE_BYTES = 128 * 1024 * 1024;

/// Couleurs de Coffre : fond presque noir, violet et teal, comme l’application
/// web et l’extension.
pub const theme: ui.Theme = .{
    .dark = true,
    .background = .hex(0x07090e),
    .surface = .hex(0x10131c),
    .surface_hover = .hex(0x151925),
    .text = .hex(0xeef0f6),
    .muted = .hex(0x9ba4b5),
    .border = .hex(0x232838),
    .accent = .hex(0x8b7cf6),
    .accent_hover = .hex(0xa99bff),
    .accent_text = .hex(0x0b0e15),
    .track = .hex(0x1a1f2d),
    .knob = .hex(0xeef0f6),
    .danger = .hex(0xf87171),
    .success = .hex(0x34d399),
    .shadow = .{ .a = 0.5 },
};

const warning = ui.Color.hex(0xfbbf24);
const teal = ui.Color.hex(0x5eead4);

const MessageKind = enum { none, info, failure };

const FieldOpts = struct {
    secret: bool = false,
    mono: bool = false,
    copy: bool = true,
    /// Le champ est une adresse web : un bouton ouvre le navigateur.
    open_url: bool = false,
};

/// Formulaire de création ou de modification d’un élément. Les tampons sont
/// réutilisés d’une ouverture à l’autre et effacés à la fermeture.
const Editor = struct {
    active: bool = false,
    /// Index dans `opened.items` ; null pour une création.
    item_index: ?usize = null,
    vault_index: usize = 0,
    /// Type de l’élément : « login » ou « note » à la création, conservé à la
    /// modification.
    kind: []const u8 = "login",
    title: ui.TextBuffer = .{},
    username: ui.TextBuffer = .{},
    password: ui.TextBuffer = .{},
    url: ui.TextBuffer = .{},
    notes: ui.TextBuffer = .{},
    show_password: bool = false,
    focus_title: bool = false,
    /// Panneau du générateur de mots de passe.
    generator_open: bool = false,
    generator_mode: enum { password, passphrase } = .password,
    generator_length: u8 = 20,
    generator_lowercase: bool = true,
    generator_uppercase: bool = true,
    generator_digits: bool = true,
    generator_symbols: bool = true,
    generator_exclude_ambiguous: bool = true,
    generator_words: u8 = 5,
    generator_capitalize: bool = true,
    generator_include_number: bool = true,

    fn deinit(self: *Editor) void {
        self.title.deinit();
        self.username.deinit();
        self.password.deinit();
        self.url.deinit();
        self.notes.deinit();
    }

    fn clearFields(self: *Editor) void {
        wipeBuffer(&self.title);
        wipeBuffer(&self.username);
        wipeBuffer(&self.password);
        wipeBuffer(&self.url);
        wipeBuffer(&self.notes);
        self.show_password = false;
        self.focus_title = false;
        self.generator_open = false;
    }

    fn close(self: *Editor) void {
        self.clearFields();
        self.active = false;
        self.item_index = null;
        self.kind = "login";
    }
};

pub const App = struct {
    gpa: std.mem.Allocator,
    io: std.Io,

    /// Chemin du fichier choisi, alloué par `gpa`.
    path: ?[]u8 = null,
    /// Ancien chemin encore affiché dans la trame en cours ; libéré à la
    /// trame suivante, pour ne pas invalider un nœud déjà construit.
    retired_path: ?[]u8 = null,
    /// Verrouillage demandé pendant une trame : appliqué au début de la
    /// suivante, quand plus aucun nœud ne référence le contenu déchiffré.
    lock_requested: bool = false,
    password: ui.TextBuffer = .{},
    confirm: ui.TextBuffer = .{},
    new_name: ui.TextBuffer = .{},
    search: ui.TextBuffer = .{},
    /// Le champ du mot de passe prend le clavier une fois.
    focus_password: bool = true,
    /// L’écran de verrouillage montre le formulaire de création.
    creating: bool = false,

    message_buf: [512]u8 = undefined,
    message_len: usize = 0,
    message_kind: MessageKind = .none,

    /// Arène de la session déverrouillée : tout le contenu déchiffré y vit et
    /// disparaît d’un coup au verrouillage.
    arena: std.heap.ArenaAllocator,
    parsed: ?std.json.Parsed(format.VaultFile) = null,
    opened: ?vault.OpenedVault = null,

    /// Index dans `opened.vaults` ; null : tous les coffres.
    selected_vault: ?usize = null,
    /// Index dans `opened.items` ; null : aucun détail.
    selected_item: ?usize = null,
    /// Affiche la corbeille au lieu des éléments actifs.
    show_trash: bool = false,
    /// Révèle les champs masqués du détail.
    reveal: bool = false,
    /// Formulaire de création ou de modification en cours.
    editor: Editor = .{},
    /// Texte brut du dernier import, conservé dans l’arène pour être effacé au
    /// verrouillage : les éléments retenus en possèdent une copie.
    import_text: ?[]u8 = null,
    /// Délai de verrouillage automatique en secondes ; 0 = jamais.
    auto_lock_seconds: u32 = 300,
    /// Dernière interaction connue, en millisecondes Unix.
    last_activity_ms: i64 = 0,
    last_mouse_x: f32 = -1e6,
    last_mouse_y: f32 = -1e6,
    /// Un secret a été copié : le presse-papiers est effacé au verrouillage.
    clipboard_secret: bool = false,
    /// Phrase de récupération affichée une fois, après génération.
    recovery_phrase: ui.TextBuffer = .{},
    recovery_visible: bool = false,
    /// Saisie de la phrase de récupération sur l’écran de verrouillage.
    recovery_input: ui.TextBuffer = .{},
    recovering: bool = false,
    /// Les réglages remplacent le détail d’un élément.
    show_settings: bool = false,

    pub fn init(gpa: std.mem.Allocator, io: std.Io) App {
        return .{
            .gpa = gpa,
            .io = io,
            .arena = std.heap.ArenaAllocator.init(gpa),
        };
    }

    /// Charge les préférences persistantes. Appelé au lancement réel, pas par
    /// les tests, qui gardent les valeurs par défaut.
    pub fn loadSettings(self: *App) void {
        const kv = nanoui.kv.standard();
        if (kv.get(self.gpa, "auto_lock_seconds") catch null) |value| {
            defer self.gpa.free(value);
            const parsed = std.fmt.parseInt(u32, value, 10) catch 300;
            self.auto_lock_seconds = if (isAutoLockOption(parsed)) parsed else 300;
        }
    }

    pub fn deinit(self: *App) void {
        self.lock();
        self.arena.deinit();
        self.password.deinit();
        self.confirm.deinit();
        self.new_name.deinit();
        self.search.deinit();
        self.editor.deinit();
        self.recovery_phrase.deinit();
        self.recovery_input.deinit();
        if (self.path) |path| self.gpa.free(path);
        if (self.retired_path) |path| self.gpa.free(path);
    }

    // ---------------------------------------------------------------- état

    pub fn setPath(self: *App, path: []const u8) !void {
        const copy = try self.gpa.dupe(u8, path);
        if (self.retired_path) |old| self.gpa.free(old);
        self.retired_path = self.path;
        self.path = copy;
        self.clearMessage();
    }

    fn setMessage(self: *App, kind: MessageKind, comptime fmt: []const u8, args: anytype) void {
        const text = std.fmt.bufPrint(&self.message_buf, fmt, args) catch {
            self.message_len = 0;
            self.message_kind = .none;
            return;
        };
        self.message_len = text.len;
        self.message_kind = kind;
    }

    fn clearMessage(self: *App) void {
        self.message_len = 0;
        self.message_kind = .none;
    }

    pub fn message(self: *const App) []const u8 {
        return self.message_buf[0..self.message_len];
    }

    fn wipePassword(self: *App) void {
        const text = self.password.text();
        if (text.len > 0) crypto.wipe(@constCast(text));
        self.password.clear();
    }

    /// Efface la phrase de passe et sa confirmation.
    fn wipeSecrets(self: *App) void {
        self.wipePassword();
        const confirmation = self.confirm.text();
        if (confirmation.len > 0) crypto.wipe(@constCast(confirmation));
        self.confirm.clear();
    }

    /// Efface la phrase de récupération affichée et sa saisie.
    fn wipeRecovery(self: *App) void {
        wipeBuffer(&self.recovery_phrase);
        self.recovery_visible = false;
        wipeBuffer(&self.recovery_input);
    }

    /// Ouvre le dialogue natif de choix de fichier.
    pub fn chooseFile(self: *App) void {
        const paths = nanoui.dialog.open(self.gpa, .{
            .title = "Ouvrir un coffre",
            .button = "Ouvrir",
            .message = "Choisissez un fichier .coffre",
            .extensions = &.{ "coffre", "json" },
        }) catch {
            self.setMessage(.failure, "Le sélecteur de fichier n’a pas pu s’ouvrir.", .{});
            return;
        };
        const list = paths orelse return;
        defer nanoui.dialog.freePaths(self.gpa, list);
        if (list.len == 0) return;

        self.setPath(list[0]) catch {
            self.setMessage(.failure, "Le chemin du fichier est trop long.", .{});
            return;
        };
        self.wipePassword();
        self.focus_password = true;
        // Mémorise le dernier coffre pour le proposer au prochain lancement.
        nanoui.kv.standard().set("last_vault", list[0]) catch {};
    }

    /// Lit le fichier choisi, le déchiffre et remplit la session.
    pub fn unlock(self: *App) void {
        const path = self.path orelse {
            self.setMessage(.failure, "Choisissez d’abord un fichier .coffre.", .{});
            return;
        };
        const password = self.password.text();
        if (password.len == 0) {
            self.setMessage(.failure, "Saisissez la phrase de passe du coffre.", .{});
            return;
        }

        const text = std.Io.Dir.cwd().readFileAlloc(self.io, path, self.gpa, .limited(MAX_FILE_BYTES)) catch |err| {
            self.setMessage(.failure, "{s}", .{fileErrorMessage(err)});
            return;
        };
        defer {
            crypto.wipe(text);
            self.gpa.free(text);
        }

        self.openText(text, password) catch |err| {
            self.setMessage(.failure, "{s}", .{openErrorMessage(err)});
            return;
        };

        self.wipePassword();
        self.focus_password = false;
        self.clearMessage();
        if (self.opened.?.warnings.len > 0) {
            self.setMessage(.info, "{s}", .{self.opened.?.warnings[0]});
        }
    }

    /// Déchiffre un fichier déjà en mémoire. Utilisé par `unlock` et par les
    /// tests de l’interface, sans accès disque.
    pub fn openText(self: *App, text: []const u8, password: []const u8) !void {
        self.lock();
        errdefer _ = self.arena.reset(.retain_capacity);

        var parsed = format.parse(self.arena.allocator(), text) catch return error.InvalidFile;
        errdefer parsed.deinit();

        const opened = vault.open(self.arena.allocator(), &parsed.value, password, self.io) catch |err| return switch (err) {
            vault.Error.WrongPassword => error.WrongPassword,
            error.OutOfMemory => error.OutOfMemory,
            else => error.InvalidFile,
        };

        self.finishOpen(parsed, opened);
    }

    /// Ouvre un fichier dont la clé maîtresse a déjà été dérivée, par exemple
    /// juste après sa création : cela évite une seconde dérivation Argon2id.
    pub fn openTextWithMasterKey(self: *App, text: []const u8, master_key: crypto.Key) !void {
        self.lock();
        errdefer _ = self.arena.reset(.retain_capacity);

        var parsed = format.parse(self.arena.allocator(), text) catch return error.InvalidFile;
        errdefer parsed.deinit();

        const opened = vault.openWithMasterKey(self.arena.allocator(), &parsed.value, master_key) catch |err| return switch (err) {
            vault.Error.WrongPassword => error.WrongPassword,
            error.OutOfMemory => error.OutOfMemory,
            else => error.InvalidFile,
        };

        self.finishOpen(parsed, opened);
    }

    fn finishOpen(self: *App, parsed: std.json.Parsed(format.VaultFile), opened: vault.OpenedVault) void {
        self.parsed = parsed;
        self.opened = opened;
        self.selected_vault = null;
        self.show_trash = false;
        self.reveal = false;
        self.recovering = false;
        self.creating = false;
        self.show_settings = false;
        self.last_activity_ms = nowMs(self.io);
        self.selectFirst();
    }

    /// Crée un fichier `.coffre` neuf à l’emplacement choisi, puis l’ouvre.
    pub fn createVault(self: *App) void {
        const name = std.mem.trim(u8, self.new_name.text(), " \t");
        if (name.len == 0) {
            self.setMessage(.failure, "Donnez un nom au coffre.", .{});
            return;
        }

        const password = self.password.text();
        if (password.len < 12) {
            self.setMessage(.failure, "Choisissez une phrase de passe de 12 caractères minimum.", .{});
            return;
        }
        if (!std.mem.eql(u8, password, self.confirm.text())) {
            self.setMessage(.failure, "Les deux phrases de passe ne correspondent pas.", .{});
            return;
        }

        const suggested = write.suggestedFileName(self.gpa, self.io) catch {
            self.setMessage(.failure, "Le nom de fichier proposé n’a pas pu être construit.", .{});
            return;
        };
        defer self.gpa.free(suggested);

        const chosen = nanoui.dialog.save(self.gpa, .{
            .title = "Créer un coffre",
            .button = "Créer",
            .message = "Le fichier .coffre sera créé à cet emplacement.",
            .name = suggested,
            .extensions = &.{"coffre"},
        }) catch {
            self.setMessage(.failure, "Le sélecteur de fichier n’a pas pu s’ouvrir.", .{});
            return;
        };
        const path = chosen orelse return;
        defer self.gpa.free(path);

        var created = write.create(self.gpa, password, .{ .name = name }, self.io) catch |err| {
            self.setMessage(.failure, "{s}", .{createErrorMessage(err)});
            return;
        };
        defer created.deinit(self.gpa);

        write.saveAtomic(self.gpa, path, created.bytes, self.io) catch |err| {
            self.setMessage(.failure, "{s}", .{writeErrorMessage(err)});
            return;
        };

        self.openTextWithMasterKey(created.bytes, created.master_key) catch |err| {
            self.setMessage(.failure, "{s}", .{openErrorMessage(err)});
            return;
        };

        self.setPath(path) catch {
            self.setMessage(.failure, "Le chemin du fichier est trop long.", .{});
            return;
        };
        self.wipeSecrets();
        self.creating = false;
        self.focus_password = false;
        self.clearMessage();
        self.setMessage(.info, "Coffre créé : {s}", .{path});
        nanoui.kv.standard().set("last_vault", path) catch {};
    }

    /// Verrouille : efface les clés, le contenu déchiffré et la recherche.
    pub fn lock(self: *App) void {
        if (self.clipboard_secret) {
            nanoui.clipboard.writeText("");
            self.clipboard_secret = false;
        }
        self.editor.close();
        if (self.import_text) |text| {
            crypto.wipe(text);
            self.import_text = null;
        }
        if (self.opened) |*opened| opened.deinit(self.arena.allocator());
        if (self.parsed) |*parsed| parsed.deinit();
        self.opened = null;
        self.parsed = null;
        _ = self.arena.reset(.retain_capacity);
        self.selected_vault = null;
        self.selected_item = null;
        self.show_trash = false;
        self.reveal = false;
        self.search.clear();
        self.show_settings = false;
        self.wipeRecovery();
        self.clearMessage();
    }

    // ------------------------------------------------------------- édition

    /// Ouvre le formulaire de création d’un élément dans le coffre courant.
    pub fn beginCreate(self: *App) void {
        const opened = if (self.opened) |*o| o else return;
        if (opened.vaults.len == 0) {
            self.setMessage(.failure, "Aucun coffre n’est disponible.", .{});
            return;
        }

        self.editor.active = true;
        self.editor.item_index = null;
        self.editor.kind = "login";
        self.editor.vault_index = self.selected_vault orelse 0;
        if (self.editor.vault_index >= opened.vaults.len) self.editor.vault_index = 0;
        self.editor.clearFields();
        self.editor.focus_title = true;
        self.selected_item = null;
        self.reveal = false;
        self.clearMessage();
    }

    /// Ouvre le formulaire de modification de l’élément sélectionné.
    pub fn beginEdit(self: *App, index: usize) void {
        const opened = if (self.opened) |*o| o else return;
        if (index >= opened.items.len) return;
        const item = &opened.items[index];
        if (item.content.deletedAt != null) return;

        self.editor.active = true;
        self.editor.item_index = index;
        self.editor.kind = item.content.type;
        self.editor.vault_index = self.vaultIndex(opened, item.vault_id) orelse 0;
        self.editor.clearFields();
        self.editor.title.set(item.content.title);
        self.editor.username.set(item.content.username orelse "");
        self.editor.password.set(item.content.password orelse "");
        self.editor.url.set(if (item.content.urls) |urls|
            if (urls.len > 0) urls[0] else ""
        else
            "");
        self.editor.notes.set(item.content.notes);
        self.editor.focus_title = true;
        self.clearMessage();
    }

    pub fn cancelEdit(self: *App) void {
        self.editor.close();
        self.clearMessage();
    }

    /// Chiffre le formulaire et enregistre le fichier de façon atomique.
    pub fn saveEditor(self: *App) void {
        const opened = if (self.opened) |*o| o else return;
        const title = std.mem.trim(u8, self.editor.title.text(), " \t\r\n");
        if (title.len == 0) {
            self.setMessage(.failure, "Le titre est obligatoire.", .{});
            return;
        }
        if (self.editor.vault_index >= opened.vaults.len) {
            self.setMessage(.failure, "Choisissez un coffre.", .{});
            return;
        }

        const arena = self.arena.allocator();
        const vault_id = opened.vaults[self.editor.vault_index].id;
        const vault_key = opened.vaultKey(vault_id) orelse {
            self.setMessage(.failure, "La clé du coffre n’est pas disponible.", .{});
            return;
        };

        var content: format.ItemContent = if (self.editor.item_index) |index|
            opened.items[index].content
        else
            .{ .type = self.editor.kind };

        content.title = arena.dupe(u8, title) catch {
            self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
            return;
        };
        content.notes = arena.dupe(u8, self.editor.notes.text()) catch {
            self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
            return;
        };
        content.username = optionalDup(arena, self.editor.username.text()) catch {
            self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
            return;
        };
        content.password = optionalDup(arena, self.editor.password.text()) catch {
            self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
            return;
        };

        const url = std.mem.trim(u8, self.editor.url.text(), " \t");
        if (url.len > 0) {
            // Les adresses suivantes d’un élément existant sont conservées.
            const existing = content.urls orelse &.{};
            const urls = arena.alloc([]const u8, @max(existing.len, 1)) catch {
                self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
                return;
            };
            if (existing.len > 1) @memcpy(urls[1..], existing[1..]);
            urls[0] = arena.dupe(u8, url) catch {
                self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
                return;
            };
            content.urls = urls;
        } else {
            content.urls = null;
        }

        const parsed = if (self.parsed) |*p| p else return;

        if (self.editor.item_index) |index| {
            if (index >= opened.items.len) return;
            const item_id = opened.items[index].id;
            var record_index: ?usize = null;
            for (parsed.value.items, 0..) |record, i| {
                if (std.mem.eql(u8, record.id, item_id)) {
                    record_index = i;
                    break;
                }
            }
            const target = record_index orelse {
                self.setMessage(.failure, "L’élément n’existe plus dans le fichier.", .{});
                return;
            };

            const record = items.update(arena, &parsed.value.items[target], vault_key, content, self.io) catch |err| {
                self.setMessage(.failure, "{s}", .{itemErrorMessage(err)});
                return;
            };

            var next = parsed.value;
            next.items = arena.dupe(format.ItemRecord, parsed.value.items) catch {
                self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
                return;
            };
            next.items[target] = record;
            next.updatedAt = record.updatedAt;

            self.persistFile(&next) catch |err| {
                self.setMessage(.failure, "{s}", .{writeErrorMessage(err)});
                return;
            };

            parsed.value.items = next.items;
            parsed.value.updatedAt = next.updatedAt;
            self.opened.?.items[index].content = content;
            self.opened.?.items[index].updated_at = record.updatedAt;
            self.selected_item = index;
            self.editor.close();
            self.setMessage(.info, "Élément enregistré.", .{});
            return;
        }

        const record = items.create(arena, vault_key, vault_id, content, self.io) catch |err| {
            self.setMessage(.failure, "{s}", .{itemErrorMessage(err)});
            return;
        };

        var next = parsed.value;
        next.items = arena.alloc(format.ItemRecord, parsed.value.items.len + 1) catch {
            self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
            return;
        };
        @memcpy(next.items[0..parsed.value.items.len], parsed.value.items);
        next.items[parsed.value.items.len] = record;
        next.updatedAt = record.updatedAt;

        self.persistFile(&next) catch |err| {
            self.setMessage(.failure, "{s}", .{writeErrorMessage(err)});
            return;
        };

        parsed.value.items = next.items;
        parsed.value.updatedAt = next.updatedAt;

        const open_items = arena.alloc(vault.OpenedItem, opened.items.len + 1) catch {
            self.setMessage(.failure, "Mémoire insuffisante pour enregistrer l’élément.", .{});
            return;
        };
        @memcpy(open_items[0..opened.items.len], opened.items);
        open_items[opened.items.len] = .{
            .id = record.id,
            .vault_id = record.vaultId,
            .created_at = record.createdAt,
            .updated_at = record.updatedAt,
            .content = content,
        };
        self.opened.?.items = open_items;
        for (self.opened.?.vaults) |*summary| {
            if (std.mem.eql(u8, summary.id, vault_id)) summary.item_count += 1;
        }
        self.selected_item = open_items.len - 1;
        self.editor.close();
        self.setMessage(.info, "Élément créé.", .{});
    }

    // ------------------------------------------------------------- import

    /// Choisit un export (JSON ou CSV) et l’importe dans le coffre courant.
    pub fn chooseImportFile(self: *App) void {
        if (self.opened == null) return;
        const paths = nanoui.dialog.open(self.gpa, .{
            .title = "Importer des éléments",
            .button = "Importer",
            .message = "Choisissez un export JSON ou CSV",
            .extensions = &.{ "json", "csv", "txt" },
        }) catch {
            self.setMessage(.failure, "Le sélecteur de fichier n’a pas pu s’ouvrir.", .{});
            return;
        };
        const list = paths orelse return;
        defer nanoui.dialog.freePaths(self.gpa, list);
        if (list.len == 0) return;

        // Le texte et les chaînes déchiffrées restent dans l’arène : les
        // éléments importés y font référence jusqu’au verrouillage.
        if (self.import_text) |previous| {
            crypto.wipe(previous);
            self.import_text = null;
        }
        const text = std.Io.Dir.cwd().readFileAlloc(
            self.io,
            list[0],
            self.arena.allocator(),
            .limited(MAX_FILE_BYTES),
        ) catch {
            self.setMessage(.failure, "Le fichier d’import n’a pas pu être lu.", .{});
            return;
        };
        self.import_text = text;
        self.importFromText(text);
    }

    /// Analyse un export et ajoute au coffre courant les éléments qui n’y
    /// figurent pas déjà. Le fichier n’est écrit que si un élément est ajouté.
    pub fn importFromText(self: *App, text: []const u8) void {
        const opened = if (self.opened) |*o| o else return;
        const parsed_file = if (self.parsed) |*p| p else return;
        const arena = self.arena.allocator();

        const result = importer.parse(arena, text) catch |err| {
            self.setMessage(.failure, "{s}", .{importErrorMessage(err)});
            return;
        };

        // Coffre cible : celui qui est sélectionné, sinon le premier.
        var vault_index: usize = self.selected_vault orelse 0;
        if (vault_index >= opened.vaults.len) vault_index = 0;
        const vault_id = opened.vaults[vault_index].id;
        const vault_key = opened.vaultKey(vault_id) orelse {
            self.setMessage(.failure, "La clé du coffre n’est pas disponible.", .{});
            return;
        };

        var added: std.ArrayList(format.ItemRecord) = .empty;
        var added_open: std.ArrayList(vault.OpenedItem) = .empty;
        var duplicates: usize = 0;
        var rejected: usize = 0;

        for (result.items) |content| {
            var duplicate = false;
            for (opened.items) |existing| {
                if (importer.sameContent(&existing.content, &content)) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) {
                for (added_open.items) |existing| {
                    if (importer.sameContent(&existing.content, &content)) {
                        duplicate = true;
                        break;
                    }
                }
            }
            if (duplicate) {
                duplicates += 1;
                continue;
            }

            const record = items.create(arena, vault_key, vault_id, content, self.io) catch {
                rejected += 1;
                continue;
            };
            added.append(arena, record) catch {
                rejected += 1;
                continue;
            };
            added_open.append(arena, .{
                .id = record.id,
                .vault_id = record.vaultId,
                .created_at = record.createdAt,
                .updated_at = record.updatedAt,
                .content = content,
            }) catch {
                rejected += 1;
                continue;
            };
        }

        if (added.items.len == 0) {
            if (result.items.len == 0) {
                self.setMessage(.info, "Aucun élément importable n’a été trouvé.", .{});
            } else if (duplicates > 0 and rejected == 0) {
                self.setMessage(.info, "Aucun nouvel élément : {d} doublon(s) ignoré(s).", .{duplicates});
            } else {
                self.setMessage(.failure, "Aucun élément n’a pu être importé.", .{});
            }
            return;
        }

        const next_items = arena.alloc(
            format.ItemRecord,
            parsed_file.value.items.len + added.items.len,
        ) catch {
            self.setMessage(.failure, "Mémoire insuffisante pour importer les éléments.", .{});
            return;
        };
        @memcpy(next_items[0..parsed_file.value.items.len], parsed_file.value.items);
        @memcpy(next_items[parsed_file.value.items.len..], added.items);

        const open_items = arena.alloc(
            vault.OpenedItem,
            opened.items.len + added_open.items.len,
        ) catch {
            self.setMessage(.failure, "Mémoire insuffisante pour importer les éléments.", .{});
            return;
        };
        @memcpy(open_items[0..opened.items.len], opened.items);
        @memcpy(open_items[opened.items.len..], added_open.items);

        var next = parsed_file.value;
        next.items = next_items;
        next.updatedAt = added.items[added.items.len - 1].updatedAt;

        self.persistFile(&next) catch |err| {
            self.setMessage(.failure, "{s}", .{writeErrorMessage(err)});
            return;
        };

        parsed_file.value.items = next_items;
        parsed_file.value.updatedAt = next.updatedAt;
        self.opened.?.items = open_items;
        for (self.opened.?.vaults) |*summary| {
            if (std.mem.eql(u8, summary.id, vault_id)) summary.item_count += added.items.len;
        }
        self.selected_item = null;
        self.editor.close();

        if (duplicates > 0 or rejected > 0) {
            self.setMessage(
                .info,
                "{d} élément(s) importé(s) depuis {s} ; {d} doublon(s) ignoré(s), {d} échec(s).",
                .{ added.items.len, importer.sourceLabel(result.source), duplicates, rejected },
            );
        } else {
            self.setMessage(
                .info,
                "{d} élément(s) importé(s) depuis {s}.",
                .{ added.items.len, importer.sourceLabel(result.source) },
            );
        }
    }

    /// Active (ou remplace) la phrase de récupération. La phrase générée est
    /// affichée une fois, puis effacée au verrouillage.
    pub fn enableRecovery(self: *App) void {
        const opened = if (self.opened) |*o| o else return;
        const parsed = if (self.parsed) |*p| p else return;
        if (self.path == null) {
            self.setMessage(.failure, "Choisissez d’abord un fichier .coffre.", .{});
            return;
        }

        var generated: ?[]u8 = null;
        defer if (generated) |value| {
            crypto.wipe(value);
            self.gpa.free(value);
        };
        const phrase = if (self.recovery_phrase.text().len > 0)
            self.recovery_phrase.text()
        else blk: {
            const value = recovery.generate(self.gpa, self.io) catch {
                self.setMessage(.failure, "La phrase de récupération n’a pas pu être générée.", .{});
                return;
            };
            generated = value;
            break :blk value;
        };

        const arena = self.arena.allocator();
        var built = recovery.buildEnvelope(arena, &parsed.value, opened, phrase, self.io) catch |err| {
            self.setMessage(.failure, "{s}", .{recoveryErrorMessage(err)});
            return;
        };

        const now = write.isoNow(arena, self.io) catch {
            crypto.wipeKey(&built.recovery_key);
            self.setMessage(.failure, "La date de mise à jour n’a pas pu être construite.", .{});
            return;
        };
        var next = parsed.value;
        next.recovery = built.envelope;
        next.updatedAt = now;

        self.persistFile(&next) catch |err| {
            crypto.wipeKey(&built.recovery_key);
            self.setMessage(.failure, "{s}", .{writeErrorMessage(err)});
            return;
        };

        if (opened.recovery_key) |*previous| crypto.wipeKey(previous);
        opened.recovery_key = built.recovery_key;
        parsed.value.recovery = next.recovery;
        parsed.value.updatedAt = next.updatedAt;

        self.recovery_phrase.set(phrase);
        self.recovery_visible = true;
        self.setMessage(.info, "Phrase de récupération activée. Notez-la maintenant : elle ne sera plus affichée après le verrouillage.", .{});
    }

    /// Retire l’enveloppe de récupération du fichier.
    pub fn disableRecovery(self: *App) void {
        const opened = if (self.opened) |*o| o else return;
        const parsed = if (self.parsed) |*p| p else return;
        if (parsed.value.recovery == null) {
            self.setMessage(.info, "Aucune phrase de récupération n’est active.", .{});
            return;
        }

        const arena = self.arena.allocator();
        const now = write.isoNow(arena, self.io) catch {
            self.setMessage(.failure, "La date de mise à jour n’a pas pu être construite.", .{});
            return;
        };
        var next = parsed.value;
        next.recovery = null;
        next.updatedAt = now;

        self.persistFile(&next) catch |err| {
            self.setMessage(.failure, "{s}", .{writeErrorMessage(err)});
            return;
        };

        if (opened.recovery_key) |*key| crypto.wipeKey(key);
        opened.recovery_key = null;
        parsed.value.recovery = null;
        parsed.value.updatedAt = next.updatedAt;
        wipeBuffer(&self.recovery_phrase);
        self.recovery_visible = false;
        self.setMessage(.info, "Phrase de récupération désactivée.", .{});
    }

    fn settingsView(self: *App, c: *ui.Context, opened: *const vault.OpenedVault) void {
        _ = opened;
        const th = c.theme;
        const has_recovery = if (self.parsed) |*parsed| parsed.value.recovery != null else false;

        // ------------------------------------------ phrase de récupération
        section(c, "Phrase de récupération");
        ui.text(c, if (has_recovery)
            "Active. Elle permet de rouvrir le coffre si la phrase de passe est perdue."
        else
            "Non configurée. Une phrase de dix mots protège l’accès au coffre en cas de perte de la phrase de passe.", .{
            .size = 12,
            .color = th.muted,
            .wrap = true,
            .leading = 1.35,
        });

        if (self.recovery_phrase.text().len > 0) {
            ui.column(c, .{
                .width = .fill,
                .padding = .all(14),
                .gap = 8,
                .background = th.background,
                .border = th.border,
                .radius = 12,
            });
            defer ui.end(c);

            {
                ui.row(c, .{ .width = .fill, .gap = 6, .align_items = .center });
                defer ui.end(c);
                ui.text(c, "Votre phrase de récupération", .{ .size = 11, .weight = .semibold, .color = th.muted });
                ui.spacer(c);
                if (ui.button(c, "", .{
                    .variant = .ghost,
                    .icon = if (self.recovery_visible) "eye.slash" else "eye",
                    .size = 11,
                }).clicked) {
                    self.recovery_visible = !self.recovery_visible;
                }
                if (ui.button(c, "", .{ .variant = .ghost, .icon = "doc.on.doc", .size = 11 }).clicked) {
                    self.copyToClipboard(self.recovery_phrase.text());
                }
            }
            if (self.recovery_visible) {
                ui.text(c, self.recovery_phrase.text(), .{
                    .size = 15,
                    .mono = true,
                    .wrap = true,
                    .leading = 1.4,
                });
            } else {
                ui.text(c, "••••••••••••••••••••••••••••••••••••••••••••••", .{
                    .size = 15,
                    .mono = true,
                    .tracking = 1,
                });
            }
            ui.text(c, "Notez ces dix mots maintenant : ils ne seront plus affichés après le verrouillage.", .{
                .size = 11,
                .color = warning,
                .wrap = true,
            });
        }

        {
            ui.row(c, .{ .width = .fill, .gap = 8, .align_items = .center });
            defer ui.end(c);
            if (!has_recovery) {
                if (ui.button(c, "Activer la récupération", .{
                    .variant = .primary,
                    .icon = "key.fill",
                    .size = 12,
                }).clicked) {
                    self.enableRecovery();
                }
            } else {
                if (ui.button(c, "Remplacer la phrase", .{
                    .variant = .secondary,
                    .icon = "arrow.triangle.2.circlepath",
                    .size = 12,
                }).clicked) {
                    self.enableRecovery();
                }
                if (ui.button(c, "Désactiver", .{
                    .variant = .ghost,
                    .size = 12,
                }).clicked) {
                    self.disableRecovery();
                }
            }
        }
        sectionEnd(c);

        // ------------------------------------------ verrouillage automatique
        section(c, "Verrouillage automatique");
        ui.text(c, "Le coffre se verrouille après une période sans interaction. Le choix est mémorisé sur cet appareil.", .{
            .size = 12,
            .color = th.muted,
            .wrap = true,
            .leading = 1.35,
        });
        {
            ui.row(c, .{ .width = .fill, .gap = 6, .align_items = .center });
            defer ui.end(c);
            const options = [_]u32{ 0, 60, 300, 900, 3600 };
            for (options) |option| {
                if (ui.button(c, autoLockLabel(option), .{
                    .variant = if (self.auto_lock_seconds == option) .primary else .secondary,
                    .size = 12,
                }).clicked) {
                    self.setAutoLock(option);
                }
            }
        }
        sectionEnd(c);

        // ------------------------------------------ données
        section(c, "Données");
        ui.text(c, "Aucune donnée ne quitte cet appareil. Le fichier est chiffré avec Argon2id et AES-256-GCM, et chaque enregistrement conserve trois sauvegardes tournantes.", .{
            .size = 12,
            .color = th.muted,
            .wrap = true,
            .leading = 1.35,
        });
        sectionEnd(c);
    }

    fn persistFile(self: *App, file: *const format.VaultFile) !void {
        const path = self.path orelse return error.InvalidPath;
        const text = try format.serialize(self.arena.allocator(), file);
        defer crypto.wipe(text);
        try write.saveAtomic(self.gpa, path, text, self.io);
    }

    fn vaultIndex(self: *const App, opened: *const vault.OpenedVault, id: []const u8) ?usize {
        _ = self;
        for (opened.vaults, 0..) |record, index| {
            if (std.mem.eql(u8, record.id, id)) return index;
        }
        return null;
    }

    fn selectFirst(self: *App) void {
        const opened = if (self.opened) |*o| o else return;
        for (opened.items, 0..) |item, index| {
            if (item.content.deletedAt == null) {
                self.selected_item = index;
                return;
            }
        }
        self.selected_item = null;
    }

    fn itemVisible(self: *const App, item: *const vault.OpenedItem) bool {
        const deleted = item.content.deletedAt != null;
        if (self.show_trash != deleted) return false;

        if (self.selected_vault) |index| {
            const opened = self.opened orelse return false;
            if (index >= opened.vaults.len) return false;
            if (!std.mem.eql(u8, item.vault_id, opened.vaults[index].id)) return false;
        }

        const query = std.mem.trim(u8, self.search.text(), " \t");
        if (query.len == 0) return true;
        if (containsFold(item.content.title, query)) return true;
        if (item.content.username) |username| {
            if (containsFold(username, query)) return true;
        }
        if (item.content.urls) |urls| {
            for (urls) |url| {
                if (containsFold(url, query)) return true;
            }
        }
        return false;
    }

    // ---------------------------------------------------------------- vue

    pub fn view(self: *App, c: *ui.Context) void {
        self.tick(c);
        if (self.retired_path) |path| {
            self.gpa.free(path);
            self.retired_path = null;
        }
        if (self.lock_requested) {
            self.lock_requested = false;
            self.lock();
            self.focus_password = true;
        }
        if (self.opened != null) self.handleShortcuts(c);
        if (self.opened) |*opened| {
            self.vaultView(c, opened);
        } else {
            self.lockView(c);
        }
    }

    /// Verrouille après inactivité et demande la trame suivante au bon moment.
    fn tick(self: *App, c: *ui.Context) void {
        if (self.opened == null) return;

        const now = nowMs(self.io);
        if (self.last_activity_ms == 0) self.last_activity_ms = now;

        const input = c.input;
        const moved = input.mouse.x != self.last_mouse_x or input.mouse.y != self.last_mouse_y;
        if (moved) {
            self.last_mouse_x = input.mouse.x;
            self.last_mouse_y = input.mouse.y;
        }
        const active = moved or input.pressed or input.released or input.down or
            input.scroll.x != 0 or input.scroll.y != 0 or input.key != null or
            input.chars.len > 0 or input.shortcut != null or input.a11y_press != 0 or
            input.drop != null;
        if (active) self.last_activity_ms = now;

        if (self.auto_lock_seconds == 0) return;
        const limit = @as(i64, @intCast(self.auto_lock_seconds)) * 1000;
        const elapsed = now - self.last_activity_ms;
        if (elapsed >= limit) {
            self.lock();
            self.focus_password = true;
            self.setMessage(.info, "Coffre verrouillé après inactivité.", .{});
            return;
        }
        const remaining = @max(@divTrunc(limit - elapsed + 999, 1000), 1);
        c.frameIn(@floatFromInt(remaining));
    }

    fn cycleAutoLock(self: *App) void {
        const options = [_]u32{ 0, 60, 300, 900, 3600 };
        var next: u32 = 300;
        for (options, 0..) |option, index| {
            if (option == self.auto_lock_seconds) {
                next = options[(index + 1) % options.len];
                break;
            }
        }
        self.setAutoLock(next);
    }

    fn setAutoLock(self: *App, seconds: u32) void {
        self.auto_lock_seconds = seconds;
        self.last_activity_ms = nowMs(self.io);
        var buf: [16]u8 = undefined;
        const text = std.fmt.bufPrint(&buf, "{d}", .{seconds}) catch "300";
        nanoui.kv.standard().set("auto_lock_seconds", text) catch {};
        if (seconds == 0) {
            self.setMessage(.info, "Verrouillage automatique désactivé.", .{});
        } else {
            self.setMessage(.info, "Verrouillage automatique après {s}.", .{autoLockLabel(seconds)});
        }
    }

    fn handleShortcuts(self: *App, c: *ui.Context) void {
        if (c.shortcut(.{ .key = 'l', .cmd = true })) {
            self.lock_requested = true;
        } else if (c.shortcut(.{ .key = 'n', .cmd = true })) {
            self.beginCreate();
        } else if (c.shortcut(.{ .key = 'f', .cmd = true })) {
            self.search.focus();
        } else if (c.shortcut(.{ .key = 'i', .cmd = true })) {
            self.chooseImportFile();
        } else if (self.editor.active and c.shortcut(.{ .key = ui.Shortcut.escape })) {
            self.cancelEdit();
        }
    }

    pub fn menuLock(self: *App, _: *nanoui.menu.Item) void {
        self.lock_requested = true;
    }

    pub fn menuCreate(self: *App, _: *nanoui.menu.Item) void {
        self.beginCreate();
    }

    pub fn menuImport(self: *App, _: *nanoui.menu.Item) void {
        self.chooseImportFile();
    }

    pub fn menuSearch(self: *App, _: *nanoui.menu.Item) void {
        self.search.focus();
    }

    fn copyToClipboard(self: *App, text: []const u8) void {
        nanoui.clipboard.writeText(text);
        self.clipboard_secret = true;
        self.setMessage(.info, "Copié ; le presse-papiers sera effacé au verrouillage.", .{});
    }

    fn lockView(self: *App, c: *ui.Context) void {
        const th = c.theme;

        ui.column(c, .{
            .width = .fill,
            .height = .fill,
            .padding = .all(32),
            .align_items = .center,
            .justify = .center,
        });
        defer ui.end(c);

        ui.column(c, .{
            .width = .{ .px = 460 },
            .padding = .all(28),
            .gap = 18,
            .background = th.surface,
            .border = th.border,
            .radius = 20,
            .shadow = .{ .color = th.shadow, .blur = 40, .y = 16 },
        });
        defer ui.end(c);

        // Marque
        {
            ui.row(c, .{ .width = .fill, .gap = 14, .align_items = .center });
            defer ui.end(c);
            {
                ui.column(c, .{
                    .width = .{ .px = 48 },
                    .height = .{ .px = 48 },
                    .align_items = .center,
                    .justify = .center,
                    .background = th.accent.alpha(0.16),
                    .radius = 14,
                });
                defer ui.end(c);
                ui.icon(c, "lock.shield.fill", .{ .size = 24, .color = th.accent });
            }
            {
                ui.column(c, .{ .gap = 1, .grow = 1 });
                defer ui.end(c);
                ui.text(c, "Coffre", .{ .size = 30, .weight = .bold, .serif = true });
                ui.text(c, "Gestionnaire de mots de passe local", .{ .size = 12, .color = th.muted });
            }
        }

        ui.divider(c);

        if (self.creating) {
            self.createForm(c);
        } else if (self.recovering) {
            self.recoveryForm(c);
        } else {
            self.unlockForm(c);
        }

        ui.text(c, "Aucune donnée ne quitte cet appareil.", .{
            .size = 11,
            .color = th.muted,
            .wrap = true,
        });
    }

    fn filePicker(self: *App, c: *ui.Context) void {
        const th = c.theme;

        ui.text(c, "Fichier du coffre", .{ .size = 11, .weight = .semibold, .color = th.muted });
        const file_row = ui.div(c).row().wFull().p(10).gap(8).itemsCenter().rounded(10).bg(th.background).border(th.border);
        defer file_row.end();
        ui.icon(c, "doc.text", .{ .size = 14, .color = th.muted, .frame = 18 });
        {
            const path_column = ui.div(c).column().grow();
            defer path_column.end();
            if (self.path) |path| {
                ui.text(c, path, .{ .size = 12, .mono = true, .color = th.text, .wrap = true, .max_lines = 1 });
            } else {
                ui.text(c, "Aucun fichier sélectionné", .{ .size = 12, .color = th.muted });
            }
        }
        if (ui.button(c, "Choisir…", .{ .variant = .ghost, .size = 12 }).clicked) {
            self.chooseFile();
        }
    }

    fn unlockForm(self: *App, c: *ui.Context) void {
        const th = c.theme;

        self.filePicker(c);

        // Mot de passe
        ui.text(c, "Phrase de passe", .{ .size = 11, .weight = .semibold, .color = th.muted });
        if (self.focus_password) {
            self.password.focus();
            self.focus_password = false;
        }
        const result = ui.textField(c, &self.password, .{
            .placeholder = "Votre phrase de passe",
            .width = .fill,
            .size = 15,
            .password = true,
        });

        self.messageLine(c);

        if (result.submitted) self.unlock();
        if (ui.button(c, "Déverrouiller", .{
            .variant = .primary,
            .width = .fill,
            .size = 15,
            .disabled = self.path == null or self.password.text().len == 0,
        }).clicked) {
            self.unlock();
        }

        if (ui.button(c, "Utiliser une phrase de récupération…", .{ .variant = .ghost, .width = .fill, .size = 12 }).clicked) {
            self.beginRecovery();
        }

        if (ui.button(c, "Créer un nouveau coffre…", .{ .variant = .ghost, .width = .fill, .size = 12 }).clicked) {
            self.creating = true;
            self.clearMessage();
            if (self.new_name.text().len == 0) self.new_name.set("Personnel");
            self.focus_password = true;
        }
    }

    fn createForm(self: *App, c: *ui.Context) void {
        const th = c.theme;

        ui.text(c, "Nom du coffre", .{ .size = 11, .weight = .semibold, .color = th.muted });
        _ = ui.textField(c, &self.new_name, .{
            .placeholder = "Personnel",
            .width = .fill,
            .size = 15,
        });

        ui.text(c, "Phrase de passe", .{ .size = 11, .weight = .semibold, .color = th.muted });
        if (self.focus_password) {
            self.password.focus();
            self.focus_password = false;
        }
        const result = ui.textField(c, &self.password, .{
            .placeholder = "12 caractères minimum",
            .width = .fill,
            .size = 15,
            .password = true,
        });

        ui.text(c, "Confirmation", .{ .size = 11, .weight = .semibold, .color = th.muted });
        _ = ui.textField(c, &self.confirm, .{
            .placeholder = "Répétez la phrase de passe",
            .width = .fill,
            .size = 15,
            .password = true,
        });

        ui.text(c, "La phrase de passe ne peut pas être récupérée. Notez-la en lieu sûr ; vous pourrez activer une phrase de récupération dans les réglages.", .{
            .size = 11,
            .color = th.muted,
            .wrap = true,
            .leading = 1.3,
        });

        self.messageLine(c);

        if (result.submitted) self.createVault();
        {
            ui.row(c, .{ .width = .fill, .gap = 8 });
            defer ui.end(c);
            if (ui.button(c, "Annuler", .{ .variant = .ghost, .size = 13 }).clicked) {
                self.creating = false;
                self.wipeSecrets();
                self.clearMessage();
            }
            if (ui.button(c, "Créer le coffre…", .{
                .variant = .primary,
                .width = .fill,
                .size = 14,
                .disabled = self.new_name.text().len == 0 or self.password.text().len < 12 or self.confirm.text().len == 0,
            }).clicked) {
                self.createVault();
            }
        }
    }

    /// Bascule l’écran de verrouillage vers la récupération par phrase.
    pub fn beginRecovery(self: *App) void {
        self.recovering = true;
        self.creating = false;
        self.wipeSecrets();
        self.recovery_input.clear();
        self.recovery_input.focus();
        self.clearMessage();
    }

    fn recoveryForm(self: *App, c: *ui.Context) void {
        const th = c.theme;

        ui.text(c, "Récupération", .{ .size = 22, .weight = .bold, .serif = true });
        ui.text(c, "Saisissez les dix mots de votre phrase de récupération, puis choisissez une nouvelle phrase de passe.", .{
            .size = 11,
            .color = th.muted,
            .wrap = true,
            .leading = 1.3,
        });

        self.filePicker(c);

        ui.text(c, "Phrase de récupération", .{ .size = 11, .weight = .semibold, .color = th.muted });
        const phrase_result = ui.textField(c, &self.recovery_input, .{
            .placeholder = "dix mots séparés par des espaces",
            .width = .fill,
            .size = 14,
        });

        ui.text(c, "Nouvelle phrase de passe", .{ .size = 11, .weight = .semibold, .color = th.muted });
        const password_result = ui.textField(c, &self.password, .{
            .placeholder = "12 caractères minimum",
            .width = .fill,
            .size = 15,
            .password = true,
        });

        ui.text(c, "Confirmation", .{ .size = 11, .weight = .semibold, .color = th.muted });
        _ = ui.textField(c, &self.confirm, .{
            .placeholder = "Répétez la nouvelle phrase de passe",
            .width = .fill,
            .size = 15,
            .password = true,
        });

        self.messageLine(c);

        if (phrase_result.submitted or password_result.submitted) self.recoverVault();
        {
            ui.row(c, .{ .width = .fill, .gap = 8 });
            defer ui.end(c);
            if (ui.button(c, "Annuler", .{ .variant = .ghost, .size = 13 }).clicked) {
                self.recovering = false;
                self.wipeSecrets();
                self.clearMessage();
            }
            if (ui.button(c, "Récupérer le coffre", .{
                .variant = .primary,
                .width = .fill,
                .size = 14,
                .disabled = self.path == null or self.recovery_input.text().len == 0 or self.password.text().len < 12 or self.confirm.text().len == 0,
            }).clicked) {
                self.recoverVault();
            }
        }
    }

    /// Ouvre un fichier avec sa phrase de récupération, ré-enveloppe ses clés
    /// sous une nouvelle phrase de passe et remplace le fichier.
    pub fn recoverVault(self: *App) void {
        const path = self.path orelse {
            self.setMessage(.failure, "Choisissez d’abord un fichier .coffre.", .{});
            return;
        };
        const phrase = self.recovery_input.text();
        if (!recovery.isPhrase(phrase)) {
            self.setMessage(.failure, "La phrase de récupération doit contenir dix mots.", .{});
            return;
        }
        const new_password = self.password.text();
        if (new_password.len < recovery.MIN_PASSWORD) {
            self.setMessage(.failure, "Choisissez une phrase de passe de 12 caractères minimum.", .{});
            return;
        }
        if (!std.mem.eql(u8, new_password, self.confirm.text())) {
            self.setMessage(.failure, "Les deux phrases de passe ne correspondent pas.", .{});
            return;
        }

        const text = std.Io.Dir.cwd().readFileAlloc(self.io, path, self.gpa, .limited(MAX_FILE_BYTES)) catch |err| {
            self.setMessage(.failure, "{s}", .{fileErrorMessage(err)});
            return;
        };
        defer {
            crypto.wipe(text);
            self.gpa.free(text);
        }

        // L’arène temporaire porte le fichier ré-enveloppé : elle disparaît
        // dès que le nouveau coffre est ouvert dans l’arène de session.
        var scratch_state = std.heap.ArenaAllocator.init(self.gpa);
        defer scratch_state.deinit();
        const scratch = scratch_state.allocator();

        var parsed = format.parse(scratch, text) catch {
            self.setMessage(.failure, "Ce fichier n’est pas un coffre Coffre valide.", .{});
            return;
        };
        defer parsed.deinit();

        var recovered = recovery.unlock(scratch, &parsed.value, phrase, new_password, self.io) catch |err| {
            self.setMessage(.failure, "{s}", .{recoveryErrorMessage(err)});
            return;
        };
        defer crypto.wipeKey(&recovered.master_key);

        const serialized = format.serialize(scratch, &recovered.file) catch {
            self.setMessage(.failure, "Le coffre récupéré n’a pas pu être préparé.", .{});
            return;
        };
        defer crypto.wipe(serialized);

        write.saveAtomic(self.gpa, path, serialized, self.io) catch |err| {
            self.setMessage(.failure, "{s}", .{writeErrorMessage(err)});
            return;
        };

        self.openTextWithMasterKey(serialized, recovered.master_key) catch |err| {
            self.setMessage(.failure, "{s}", .{openErrorMessage(err)});
            return;
        };

        self.wipeSecrets();
        self.recovering = false;
        self.focus_password = false;
        self.clearMessage();
        self.setMessage(.info, "Coffre récupéré : la nouvelle phrase de passe est active.", .{});
    }

    fn messageLine(self: *App, c: *ui.Context) void {
        if (self.message_kind == .none) return;
        const color = if (self.message_kind == .failure) c.theme.danger else teal;
        ui.text(c, self.message(), .{ .size = 12, .color = color, .wrap = true });
    }

    fn vaultView(self: *App, c: *ui.Context, opened: *vault.OpenedVault) void {
        const th = c.theme;

        ui.row(c, .{ .width = .fill, .height = .fill });
        defer ui.end(c);

        // ------------------------------------------------------- barre latérale
        {
            ui.column(c, .{
                .width = .{ .px = 272 },
                .height = .fill,
                .background = th.surface,
                .padding = .all(14),
                .gap = 10,
            });
            defer ui.end(c);

            {
                ui.row(c, .{ .width = .fill, .gap = 10, .align_items = .center, .padding = .xy(4, 4) });
                defer ui.end(c);
                ui.icon(c, "lock.shield.fill", .{ .size = 18, .color = th.accent, .frame = 20 });
                ui.text(c, "Coffre", .{ .size = 18, .weight = .bold, .serif = true });
                ui.spacer(c);
                if (ui.button(c, "", .{ .variant = .ghost, .icon = "lock.fill", .size = 13 }).clicked) {
                    self.lock_requested = true;
                }
            }

            _ = ui.textField(c, &self.search, .{
                .placeholder = "Rechercher",
                .width = .fill,
                .size = 13,
            });

            {
                ui.scroll(c, .{
                    .grow = 1,
                    .width = .fill,
                    .height = .fill,
                    .gap = 2,
                    .scrollbar = .{ .overlay = th.muted.alpha(0.4) },
                });
                defer ui.end(c);

                if (navRow(c, "Tous les éléments", "square.grid.2x2", opened.activeItemCount(), !self.show_settings and self.selected_vault == null and !self.show_trash)) {
                    self.selected_vault = null;
                    self.show_trash = false;
                    self.selected_item = null;
                    self.show_settings = false;
                }

                ui.text(c, "COFFRES", .{ .size = 10, .weight = .semibold, .color = th.muted, .tracking = 1 });
                for (opened.vaults, 0..) |record, index| {
                    if (navRow(c, record.name, "folder", record.item_count, !self.show_settings and !self.show_trash and self.selected_vault == index)) {
                        self.selected_vault = index;
                        self.show_trash = false;
                        self.selected_item = null;
                        self.show_settings = false;
                    }
                }

                ui.spacer(c);
                const trash_count = opened.items.len - opened.activeItemCount();
                if (navRow(c, "Corbeille", "trash", trash_count, !self.show_settings and self.show_trash)) {
                    self.show_trash = true;
                    self.selected_vault = null;
                    self.selected_item = null;
                    self.show_settings = false;
                }
                if (navRow(c, "Réglages", "gearshape", 0, self.show_settings)) {
                    self.show_settings = true;
                    self.show_trash = false;
                    self.selected_vault = null;
                    self.selected_item = null;
                    self.editor.close();
                }
            }

            {
                ui.row(c, .{ .width = .fill, .gap = 8, .align_items = .center, .padding = .xy(4, 2) });
                defer ui.end(c);
                ui.icon(c, "lock", .{ .size = 11, .color = th.muted, .frame = 16 });
                ui.text(c, "Verrouillage auto", .{ .size = 10, .color = th.muted });
                ui.spacer(c);
                if (ui.button(c, autoLockLabel(self.auto_lock_seconds), .{
                    .variant = .ghost,
                    .size = 10,
                }).clicked) {
                    self.cycleAutoLock();
                }
            }

            ui.text(c, "Version native · expérimental", .{ .size = 10, .color = th.muted });
        }

        // ------------------------------------------------------------- contenu
        {
            ui.column(c, .{ .grow = 1, .width = .fill, .height = .fill });
            defer ui.end(c);

            const title = if (self.show_settings) "Réglages" else self.heading(opened);
            const count = self.visibleCount(opened);

            {
                ui.row(c, .{ .width = .fill, .padding = .xy(24, 16), .gap = 12, .align_items = .center });
                defer ui.end(c);
                {
                    ui.column(c, .{ .gap = 1, .grow = 1 });
                    defer ui.end(c);
                    ui.text(c, title, .{ .size = 22, .weight = .bold, .serif = true });
                    if (self.show_settings) {
                        ui.text(c, "Préférences locales de ce coffre.", .{ .size = 12, .color = th.muted });
                    } else {
                        ui.textf(c, .{ .size = 12, .color = th.muted }, "{d} élément{s}", .{ count, if (count > 1) "s" else "" });
                    }
                    if (self.message_kind == .info) {
                        ui.text(c, self.message(), .{ .size = 11, .color = teal });
                    }
                }
                if (!self.show_settings and !self.show_trash and !self.editor.active) {
                    if (ui.button(c, "Nouvel élément", .{
                        .variant = .primary,
                        .icon = "plus",
                        .size = 13,
                    }).clicked) {
                        self.beginCreate();
                    }
                    if (ui.button(c, "Importer", .{
                        .variant = .secondary,
                        .icon = "doc.text",
                        .size = 13,
                    }).clicked) {
                        self.chooseImportFile();
                    }
                }
            }

            ui.divider(c);

            if (self.show_settings) {
                ui.scroll(c, .{
                    .grow = 1,
                    .width = .fill,
                    .height = .fill,
                    .padding = .all(26),
                    .gap = 16,
                    .scrollbar = .{ .overlay = th.muted.alpha(0.4) },
                });
                defer ui.end(c);
                self.settingsView(c, opened);
            } else {
                {
                    ui.row(c, .{ .width = .fill, .grow = 1 });
                    defer ui.end(c);

                    // Liste des éléments
                    {
                        ui.column(c, .{
                            .width = .{ .px = 340 },
                            .height = .fill,
                            .padding = .all(10),
                            .gap = 2,
                            .background = th.background,
                        });
                        defer ui.end(c);

                        {
                            ui.scroll(c, .{
                                .grow = 1,
                                .width = .fill,
                                .height = .fill,
                                .gap = 2,
                                .scrollbar = .{ .overlay = th.muted.alpha(0.4) },
                            });
                            defer ui.end(c);

                            var shown: usize = 0;
                            for (opened.items, 0..) |*item, index| {
                                if (!self.itemVisible(item)) continue;
                                shown += 1;
                                if (itemRow(c, item, self.selected_item == index) and !self.editor.active) {
                                    self.selected_item = index;
                                    self.reveal = false;
                                }
                            }
                            if (shown == 0) {
                                ui.column(c, .{ .width = .fill, .padding = .all(24), .gap = 6, .align_items = .center });
                                defer ui.end(c);
                                ui.icon(c, if (self.show_trash) "trash" else "magnifyingglass", .{ .size = 22, .color = th.muted });
                                ui.text(c, if (self.show_trash) "La corbeille est vide." else "Aucun élément ne correspond.", .{
                                    .size = 13,
                                    .color = th.muted,
                                    .wrap = true,
                                });
                            }
                        }
                    }

                    // Trait vertical entre la liste et le détail.
                    {
                        ui.column(c, .{ .width = .{ .px = 1 }, .height = .fill, .background = th.border });
                        defer ui.end(c);
                    }

                    // Détail
                    {
                        ui.scroll(c, .{
                            .grow = 1,
                            .width = .fill,
                            .height = .fill,
                            .padding = .all(26),
                            .gap = 16,
                            .scrollbar = .{ .overlay = th.muted.alpha(0.4) },
                        });
                        defer ui.end(c);

                        if (self.editor.active) {
                            self.editorForm(c, opened);
                        } else if (self.selected_item) |index| {
                            if (index < opened.items.len and self.itemVisible(&opened.items[index])) {
                                self.itemDetail(c, opened, &opened.items[index], index);
                            } else {
                                self.emptyDetail(c);
                            }
                        } else {
                            self.emptyDetail(c);
                        }
                    }
                }
            }
        }
    }

    fn heading(self: *const App, opened: *const vault.OpenedVault) []const u8 {
        if (self.show_trash) return "Corbeille";
        if (self.selected_vault) |index| {
            if (index < opened.vaults.len) return opened.vaults[index].name;
        }
        if (std.mem.trim(u8, self.search.text(), " \t").len > 0) return "Recherche";
        return "Tous les éléments";
    }

    fn visibleCount(self: *const App, opened: *const vault.OpenedVault) usize {
        var count: usize = 0;
        for (opened.items) |*item| {
            if (self.itemVisible(item)) count += 1;
        }
        return count;
    }

    fn emptyDetail(self: *App, c: *ui.Context) void {
        _ = self;
        const th = c.theme;
        ui.column(c, .{
            .width = .fill,
            .height = .fill,
            .align_items = .center,
            .justify = .center,
            .gap = 8,
        });
        defer ui.end(c);
        ui.icon(c, "sidebar.left", .{ .size = 30, .color = th.muted });
        ui.text(c, "Sélectionnez un élément", .{ .size = 15, .weight = .medium, .color = th.muted });
        ui.text(c, "Son contenu s’affiche ici, déchiffré en mémoire.", .{
            .size = 12,
            .color = th.muted,
            .wrap = true,
        });
    }

    fn editorForm(self: *App, c: *ui.Context, opened: *const vault.OpenedVault) void {
        const th = c.theme;
        const creating = self.editor.item_index == null;

        {
            ui.row(c, .{ .width = .fill, .gap = 14, .align_items = .center });
            defer ui.end(c);
            {
                ui.column(c, .{ .gap = 2, .grow = 1 });
                defer ui.end(c);
                ui.text(c, if (creating) "Nouvel élément" else "Modifier l’élément", .{
                    .size = 24,
                    .weight = .bold,
                    .serif = true,
                });
                ui.text(c, if (creating)
                    "Le contenu sera chiffré avec la clé du coffre."
                else
                    "Les champs non modifiés sont conservés.", .{
                    .size = 12,
                    .color = th.muted,
                });
            }
        }

        if (creating) {
            ui.text(c, "Type", .{ .size = 11, .weight = .semibold, .color = th.muted });
            var choice: usize = if (std.mem.eql(u8, self.editor.kind, "note")) 1 else 0;
            const labels = [_][]const u8{ "Connexion", "Note" };
            if (ui.segmented(c, &labels, &choice)) {
                self.editor.kind = if (choice == 1) "note" else "login";
            }

            if (opened.vaults.len > 1) {
                ui.text(c, "Coffre", .{ .size = 11, .weight = .semibold, .color = th.muted });
                ui.row(c, .{ .width = .fill, .gap = 8 });
                defer ui.end(c);
                for (opened.vaults, 0..) |record, index| {
                    if (ui.button(c, record.name, .{
                        .variant = if (self.editor.vault_index == index) .primary else .secondary,
                        .size = 12,
                    }).clicked) {
                        self.editor.vault_index = index;
                    }
                }
            }
        }

        ui.text(c, "Titre", .{ .size = 11, .weight = .semibold, .color = th.muted });
        if (self.editor.focus_title) {
            self.editor.title.focus();
            self.editor.focus_title = false;
        }
        _ = ui.textField(c, &self.editor.title, .{
            .placeholder = "Ex. GitHub",
            .width = .fill,
            .size = 15,
        });

        if (std.mem.eql(u8, self.editor.kind, "login")) {
            ui.text(c, "Identifiant", .{ .size = 11, .weight = .semibold, .color = th.muted });
            _ = ui.textField(c, &self.editor.username, .{
                .placeholder = "Nom d’utilisateur ou courriel",
                .width = .fill,
                .size = 15,
            });

            ui.text(c, "Mot de passe", .{ .size = 11, .weight = .semibold, .color = th.muted });
            {
                ui.row(c, .{ .width = .fill, .gap = 8, .align_items = .center });
                defer ui.end(c);
                _ = ui.textField(c, &self.editor.password, .{
                    .placeholder = "Mot de passe",
                    .width = .fill,
                    .size = 15,
                    .password = !self.editor.show_password,
                });
                if (ui.button(c, "", .{
                    .variant = .ghost,
                    .icon = if (self.editor.show_password) "eye.slash" else "eye",
                    .size = 12,
                }).clicked) {
                    self.editor.show_password = !self.editor.show_password;
                }
                if (ui.button(c, "Générer", .{
                    .variant = .secondary,
                    .icon = "wand.and.stars",
                    .size = 12,
                }).clicked) {
                    self.editor.generator_open = !self.editor.generator_open;
                }
            }

            if (self.editor.generator_open) self.generatorPanel(c);

            ui.text(c, "Site web", .{ .size = 11, .weight = .semibold, .color = th.muted });
            _ = ui.textField(c, &self.editor.url, .{
                .placeholder = "https://…",
                .width = .fill,
                .size = 15,
            });
        }

        ui.text(c, "Notes", .{ .size = 11, .weight = .semibold, .color = th.muted });
        _ = ui.textArea(c, &self.editor.notes, .{
            .placeholder = "Notes libres",
            .width = .fill,
            .min_lines = 3,
            .max_lines = 10,
            .bare = false,
        });

        self.messageLine(c);

        {
            ui.row(c, .{ .width = .fill, .gap = 8 });
            defer ui.end(c);
            if (ui.button(c, "Annuler", .{ .variant = .ghost, .size = 13 }).clicked) {
                self.cancelEdit();
            }
            if (ui.button(c, if (creating) "Créer l’élément" else "Enregistrer", .{
                .variant = .primary,
                .width = .fill,
                .size = 14,
                .disabled = std.mem.trim(u8, self.editor.title.text(), " \t\r\n").len == 0,
            }).clicked) {
                self.saveEditor();
            }
        }

        ui.text(c, "Le contenu est chiffré en mémoire puis écrit de façon atomique.", .{
            .size = 11,
            .color = th.muted,
            .wrap = true,
        });
    }

    fn generatorOptions(self: *const App) generator.PasswordOptions {
        return .{
            .length = self.editor.generator_length,
            .lowercase = self.editor.generator_lowercase,
            .uppercase = self.editor.generator_uppercase,
            .digits = self.editor.generator_digits,
            .symbols = self.editor.generator_symbols,
            .exclude_ambiguous = self.editor.generator_exclude_ambiguous,
        };
    }

    fn passphraseOptions(self: *const App) generator.PassphraseOptions {
        return .{
            .words = self.editor.generator_words,
            .separator = "-",
            .capitalize = self.editor.generator_capitalize,
            .include_number = self.editor.generator_include_number,
        };
    }

    fn generatorPanel(self: *App, c: *ui.Context) void {
        const th = c.theme;
        const options = self.generatorOptions();
        const phrase = self.passphraseOptions();
        const entropy = if (self.editor.generator_mode == .passphrase)
            generator.passphraseEntropy(phrase)
        else
            generator.passwordEntropy(options);

        ui.column(c, .{
            .width = .fill,
            .padding = .all(14),
            .gap = 10,
            .background = th.background,
            .border = th.border,
            .radius = 12,
        });
        defer ui.end(c);

        {
            ui.row(c, .{ .width = .fill, .gap = 8, .align_items = .center });
            defer ui.end(c);
            ui.icon(c, "wand.and.stars", .{ .size = 13, .color = th.accent });
            ui.text(c, "Générateur", .{ .size = 12, .weight = .semibold });
            ui.spacer(c);
            ui.textf(c, .{ .size = 11, .color = th.muted, .tabular = true }, "{d:.0} bits", .{entropy});
        }

        {
            var choice: usize = if (self.editor.generator_mode == .passphrase) 1 else 0;
            const labels = [_][]const u8{ "Mot de passe", "Phrase de passe" };
            if (ui.segmented(c, &labels, &choice)) {
                self.editor.generator_mode = if (choice == 1) .passphrase else .password;
            }
        }

        if (self.editor.generator_mode == .passphrase) {
            {
                var words: f32 = @floatFromInt(self.editor.generator_words);
                if (ui.slider(c, &words, .{
                    .min = 3,
                    .max = 12,
                    .width = .fill,
                    .label = "Mots",
                })) {
                    self.editor.generator_words = @intFromFloat(@round(words));
                }
                ui.textf(c, .{ .size = 11, .color = th.muted }, "{d} mots, séparés par un tiret", .{self.editor.generator_words});
            }
            {
                ui.row(c, .{ .width = .fill, .gap = 18 });
                defer ui.end(c);
                _ = ui.checkbox(c, "Majuscule initiale", &self.editor.generator_capitalize);
                _ = ui.checkbox(c, "Nombre final", &self.editor.generator_include_number);
            }
        } else {
            {
                var length: f32 = @floatFromInt(self.editor.generator_length);
                if (ui.slider(c, &length, .{
                    .min = 8,
                    .max = 64,
                    .width = .fill,
                    .label = "Longueur",
                })) {
                    self.editor.generator_length = @intFromFloat(@round(length));
                }
                ui.textf(c, .{ .size = 11, .color = th.muted }, "{d} caractères", .{self.editor.generator_length});
            }

            {
                ui.row(c, .{ .width = .fill, .gap = 18 });
                defer ui.end(c);
                {
                    ui.column(c, .{ .gap = 6, .grow = 1 });
                    defer ui.end(c);
                    _ = ui.checkbox(c, "Minuscules", &self.editor.generator_lowercase);
                    _ = ui.checkbox(c, "Majuscules", &self.editor.generator_uppercase);
                }
                {
                    ui.column(c, .{ .gap = 6, .grow = 1 });
                    defer ui.end(c);
                    _ = ui.checkbox(c, "Chiffres", &self.editor.generator_digits);
                    _ = ui.checkbox(c, "Symboles", &self.editor.generator_symbols);
                }
            }
            _ = ui.checkbox(c, "Éviter les caractères ambigus", &self.editor.generator_exclude_ambiguous);
        }

        {
            ui.row(c, .{ .width = .fill, .gap = 8 });
            defer ui.end(c);
            if (ui.button(c, "Générer et insérer", .{
                .variant = .primary,
                .icon = "wand.and.stars",
                .size = 12,
            }).clicked) {
                self.generateIntoEditor();
            }
            if (ui.button(c, "Fermer", .{ .variant = .ghost, .size = 12 }).clicked) {
                self.editor.generator_open = false;
            }
        }
    }

    fn generateIntoEditor(self: *App) void {
        const value = if (self.editor.generator_mode == .passphrase)
            generator.passphrase(self.gpa, self.passphraseOptions(), self.io) catch {
                self.setMessage(.failure, "La phrase de passe n’a pas pu être générée.", .{});
                return;
            }
        else
            generator.password(self.gpa, self.generatorOptions(), self.io) catch {
                self.setMessage(.failure, "Sélectionnez au moins une classe de caractères.", .{});
                return;
            };
        defer {
            crypto.wipe(value);
            self.gpa.free(value);
        }
        self.editor.password.set(value);
        self.editor.show_password = true;
        if (self.editor.generator_mode == .passphrase) {
            self.setMessage(.info, "Phrase de passe générée et insérée.", .{});
        } else {
            self.setMessage(.info, "Mot de passe généré et inséré.", .{});
        }
    }

    fn totpRow(self: *App, c: *ui.Context, uri: []const u8) void {
        const th = c.theme;

        var secret_buf: [128]u8 = undefined;
        defer crypto.wipe(&secret_buf);

        const config = totp.parseUri(uri, &secret_buf) catch {
            self.fieldRow(c, "Double authentification", uri, .{ .secret = true, .mono = true });
            return;
        };
        const now = std.Io.Timestamp.now(self.io, .real).toMilliseconds();
        const code = totp.compute(config, now) catch {
            self.fieldRow(c, "Double authentification", uri, .{ .secret = true, .mono = true });
            return;
        };
        const left = totp.remaining(config.period, now);
        // Le code vit sur la pile de cette fonction : on en garde une copie
        // dans l’arène de la trame, car le rendu a lieu après le retour.
        const code_text = c.print("{s}", .{code.slice()});

        // Le code et le compte à rebours changent chaque seconde : la vue
        // demande une nouvelle trame au lieu de rester figée.
        c.frameIn(1.0);

        ui.column(c, .{ .width = .fill, .gap = 4 });
        defer ui.end(c);

        {
            ui.row(c, .{ .width = .fill, .gap = 4, .align_items = .center });
            defer ui.end(c);
            ui.text(c, "Double authentification", .{ .size = 11, .weight = .semibold, .color = th.muted });
            ui.spacer(c);
            if (ui.button(c, "", .{
                .variant = .ghost,
                .icon = if (self.reveal) "eye.slash" else "eye",
                .size = 11,
            }).clicked) {
                self.reveal = !self.reveal;
            }
            if (ui.button(c, "", .{ .variant = .ghost, .icon = "doc.on.doc", .size = 11 }).clicked) {
                self.copyToClipboard(code_text);
            }
        }

        {
            ui.row(c, .{ .width = .fill, .gap = 10, .align_items = .center });
            defer ui.end(c);
            if (self.reveal) {
                ui.text(c, code_text, .{ .size = 18, .mono = true, .tracking = 1.5 });
            } else {
                ui.text(c, "••• •••", .{ .size = 18, .mono = true, .tracking = 1.5 });
            }
            ui.spacer(c);
            ui.badge(c, c.print("{d} s", .{left}), if (left <= 5) warning else teal);
        }
        ui.textf(c, .{
            .size = 10,
            .color = th.muted,
        }, "Code renouvelé toutes les {d} secondes.", .{config.period});
    }

    fn itemDetail(self: *App, c: *ui.Context, opened: *const vault.OpenedVault, item: *const vault.OpenedItem, index: usize) void {
        const th = c.theme;
        const content = &item.content;

        // En-tête
        {
            ui.row(c, .{ .width = .fill, .gap = 14, .align_items = .center });
            defer ui.end(c);
            {
                ui.column(c, .{
                    .width = .{ .px = 44 },
                    .height = .{ .px = 44 },
                    .align_items = .center,
                    .justify = .center,
                    .background = th.accent.alpha(0.14),
                    .radius = 12,
                });
                defer ui.end(c);
                ui.icon(c, typeIcon(content.type), .{ .size = 20, .color = th.accent });
            }
            {
                ui.column(c, .{ .gap = 2, .grow = 1 });
                defer ui.end(c);
                ui.text(c, if (content.title.len > 0) content.title else "Sans titre", .{
                    .size = 24,
                    .weight = .bold,
                    .serif = true,
                });
                ui.text(c, typeLabel(content.type), .{ .size = 12, .color = th.muted });
            }
            if (content.favorite) {
                ui.icon(c, "star.fill", .{ .size = 15, .color = warning });
            }
            if (content.deletedAt != null) {
                ui.badge(c, "Dans la corbeille", th.danger);
            }
            if (content.deletedAt == null) {
                if (ui.button(c, "Modifier", .{
                    .variant = .secondary,
                    .icon = "pencil",
                    .size = 12,
                }).clicked) {
                    self.beginEdit(index);
                }
            }
        }

        // Connexion
        if (std.mem.eql(u8, content.type, "login")) {
            section(c, "Connexion");
            if (content.username) |value| self.fieldRow(c, "Identifiant", value, .{ .mono = true });
            if (content.password) |value| self.fieldRow(c, "Mot de passe", value, .{ .secret = true, .mono = true });
            if (content.totp) |value| {
                if (value.len > 0) self.totpRow(c, value);
            }
            if (content.urls) |urls| {
                for (urls) |url| {
                    if (url.len == 0) continue;
                    self.fieldRow(c, "Site web", url, .{ .mono = true, .open_url = true });
                }
            }
            sectionEnd(c);
        }

        // Carte
        if (std.mem.eql(u8, content.type, "card")) {
            section(c, "Carte");
            if (content.cardholder) |value| self.fieldRow(c, "Titulaire", value, .{});
            if (content.number) |value| self.fieldRow(c, "Numéro", value, .{ .secret = true, .mono = true });
            if (content.expiry) |value| self.fieldRow(c, "Expiration", value, .{ .mono = true });
            if (content.cvc) |value| self.fieldRow(c, "Cryptogramme", value, .{ .secret = true, .mono = true });
            if (content.pin) |value| self.fieldRow(c, "Code PIN", value, .{ .secret = true, .mono = true });
            if (content.brand) |value| self.fieldRow(c, "Réseau", value, .{});
            sectionEnd(c);
        }

        // Identité
        if (std.mem.eql(u8, content.type, "identity")) {
            section(c, "Identité");
            if (content.firstName) |value| self.fieldRow(c, "Prénom", value, .{});
            if (content.lastName) |value| self.fieldRow(c, "Nom", value, .{});
            if (content.email) |value| self.fieldRow(c, "Courriel", value, .{ .mono = true });
            if (content.phone) |value| self.fieldRow(c, "Téléphone", value, .{ .mono = true });
            if (content.address) |value| self.fieldRow(c, "Adresse", value, .{});
            if (content.city) |value| self.fieldRow(c, "Ville", value, .{});
            if (content.postalCode) |value| self.fieldRow(c, "Code postal", value, .{ .mono = true });
            if (content.country) |value| self.fieldRow(c, "Pays", value, .{});
            if (content.birthDate) |value| self.fieldRow(c, "Date de naissance", value, .{ .mono = true });
            sectionEnd(c);
        }

        // Champs personnalisés
        if (content.customFields.len > 0) {
            section(c, "Champs personnalisés");
            for (content.customFields) |field| {
                self.fieldRow(
                    c,
                    if (field.label.len > 0) field.label else "Champ",
                    field.value,
                    .{
                        .secret = std.mem.eql(u8, field.type, "hidden"),
                        .mono = std.mem.eql(u8, field.type, "url"),
                    },
                );
            }
            sectionEnd(c);
        }

        // Notes
        if (content.notes.len > 0) {
            section(c, "Notes");
            ui.text(c, content.notes, .{ .size = 13, .wrap = true, .leading = 1.4 });
            sectionEnd(c);
        }

        // Étiquettes
        if (content.tags.len > 0) {
            ui.row(c, .{ .width = .fill, .gap = 6, .align_items = .center });
            defer ui.end(c);
            for (content.tags) |tag| ui.badge(c, tag, th.accent);
        }

        // Métadonnées
        ui.divider(c);
        {
            ui.row(c, .{ .width = .fill, .gap = 16 });
            defer ui.end(c);
            meta(c, "Créé", shortDate(item.created_at));
            meta(c, "Modifié", shortDate(item.updated_at));
            if (content.deletedAt) |value| meta(c, "Supprimé", shortDate(value));
            ui.spacer(c);
            const vault_name = self.vaultName(opened, item.vault_id);
            if (vault_name.len > 0) meta(c, "Coffre", vault_name);
        }
    }

    fn fieldRow(self: *App, c: *ui.Context, label: []const u8, value: []const u8, opts: FieldOpts) void {
        if (value.len == 0) return;
        const th = c.theme;
        const hidden = opts.secret and !self.reveal;

        ui.column(c, .{ .width = .fill, .gap = 4 });
        defer ui.end(c);

        {
            ui.row(c, .{ .width = .fill, .gap = 4, .align_items = .center });
            defer ui.end(c);
            ui.text(c, label, .{ .size = 11, .weight = .semibold, .color = th.muted });
            ui.spacer(c);
            if (opts.secret) {
                if (ui.button(c, "", .{
                    .variant = .ghost,
                    .icon = if (self.reveal) "eye.slash" else "eye",
                    .size = 11,
                }).clicked) {
                    self.reveal = !self.reveal;
                }
            }
            if (opts.copy) {
                if (ui.button(c, "", .{ .variant = .ghost, .icon = "doc.on.doc", .size = 11 }).clicked) {
                    self.copyToClipboard(value);
                }
            }
            if (opts.open_url) {
                if (ui.button(c, "", .{ .variant = .ghost, .icon = "arrow.up.right.square", .size = 11 }).clicked) {
                    if (!nanoui.shell.openUrl(value)) {
                        self.setMessage(.failure, "Le navigateur n’a pas pu être ouvert.", .{});
                    }
                }
            }
        }

        if (hidden) {
            ui.text(c, "••••••••••••••", .{ .size = 14, .mono = true, .tracking = 1 });
        } else {
            ui.text(c, value, .{ .size = 14, .mono = opts.mono, .wrap = true });
        }
    }

    fn vaultName(self: *const App, opened: *const vault.OpenedVault, id: []const u8) []const u8 {
        _ = self;
        for (opened.vaults) |record| {
            if (std.mem.eql(u8, record.id, id)) return record.name;
        }
        return "";
    }
};

// ------------------------------------------------------------------ outils

fn nowMs(io: std.Io) i64 {
    return std.Io.Timestamp.now(io, .real).toMilliseconds();
}

fn isAutoLockOption(seconds: u32) bool {
    return switch (seconds) {
        0, 60, 300, 900, 3600 => true,
        else => false,
    };
}

fn autoLockLabel(seconds: u32) []const u8 {
    return switch (seconds) {
        0 => "Jamais",
        60 => "1 min",
        300 => "5 min",
        900 => "15 min",
        3600 => "1 h",
        else => "5 min",
    };
}

fn navRow(c: *ui.Context, label: []const u8, icon_name: []const u8, count: usize, selected: bool) bool {
    const th = c.theme;
    const row = ui.div(c)
        .row()
        .wFull()
        .p(9)
        .gap(9)
        .itemsCenter()
        .rounded(8)
        .bg(if (selected) th.accent.alpha(0.16) else .transparent)
        .hover(th.surface_hover);
    defer row.end();
    ui.icon(c, icon_name, .{ .size = 14, .color = if (selected) th.accent else th.muted, .frame = 18 });
    ui.text(c, label, .{
        .size = 13,
        .weight = if (selected) .semibold else .regular,
        .color = if (selected) th.text else th.muted,
        .wrap = true,
        .max_lines = 1,
    });
    if (count > 0) {
        ui.textf(c, .{ .size = 11, .color = th.muted, .tabular = true }, "{d}", .{count});
    }
    return row.clicked();
}

fn itemRow(c: *ui.Context, item: *const vault.OpenedItem, selected: bool) bool {
    const th = c.theme;
    const content = &item.content;

    const row = ui.div(c)
        .row()
        .wFull()
        .p(10)
        .gap(10)
        .itemsCenter()
        .rounded(10)
        .bg(if (selected) th.accent.alpha(0.15) else .transparent)
        .hover(th.surface_hover);
    defer row.end();

    ui.icon(c, typeIcon(content.type), .{
        .size = 15,
        .color = if (selected) th.accent else th.muted,
        .frame = 20,
    });

    {
        ui.column(c, .{ .gap = 1, .grow = 1 });
        defer ui.end(c);
        ui.text(c, if (content.title.len > 0) content.title else "Sans titre", .{
            .size = 13,
            .weight = .medium,
            .wrap = true,
            .max_lines = 1,
        });
        const subtitle = itemSubtitle(item);
        if (subtitle.len > 0) {
            ui.text(c, subtitle, .{ .size = 11, .color = th.muted, .wrap = true, .max_lines = 1 });
        }
    }

    if (content.favorite) {
        ui.icon(c, "star.fill", .{ .size = 10, .color = warning });
    }
    if (content.deletedAt != null) {
        ui.icon(c, "trash", .{ .size = 10, .color = th.danger });
    }
    return row.clicked();
}

/// Ouvre une section ; l’appelant la referme avec `sectionEnd`.
fn section(c: *ui.Context, title: []const u8) void {
    const th = c.theme;
    ui.column(c, .{
        .width = .fill,
        .padding = .all(16),
        .gap = 12,
        .background = th.surface,
        .border = th.border,
        .radius = 14,
    });
    ui.text(c, title, .{ .size = 11, .weight = .semibold, .color = th.muted, .tracking = 0.6 });
}

fn sectionEnd(c: *ui.Context) void {
    ui.end(c);
}

fn meta(c: *ui.Context, label: []const u8, value: []const u8) void {
    const th = c.theme;
    ui.column(c, .{ .gap = 1 });
    defer ui.end(c);
    ui.text(c, label, .{ .size = 10, .weight = .semibold, .color = th.muted });
    ui.text(c, value, .{ .size = 11, .color = th.text, .mono = true });
}

fn itemSubtitle(item: *const vault.OpenedItem) []const u8 {
    const content = &item.content;
    if (content.username) |username| {
        if (username.len > 0) return username;
    }
    if (content.urls) |urls| {
        if (urls.len > 0) return urls[0];
    }
    if (content.email) |email| {
        if (email.len > 0) return email;
    }
    if (content.notes.len > 0) return content.notes;
    return typeLabel(content.type);
}

fn typeLabel(kind: []const u8) []const u8 {
    if (std.mem.eql(u8, kind, "login")) return "Connexion";
    if (std.mem.eql(u8, kind, "note")) return "Note";
    if (std.mem.eql(u8, kind, "card")) return "Carte";
    if (std.mem.eql(u8, kind, "identity")) return "Identité";
    return "Élément";
}

fn typeIcon(kind: []const u8) []const u8 {
    if (std.mem.eql(u8, kind, "login")) return "key.fill";
    if (std.mem.eql(u8, kind, "note")) return "note.text";
    if (std.mem.eql(u8, kind, "card")) return "creditcard.fill";
    if (std.mem.eql(u8, kind, "identity")) return "person.crop.circle.fill";
    return "doc.fill";
}

/// Duplique un champ facultatif ; une valeur vide devient `null`.
fn optionalDup(allocator: std.mem.Allocator, text: []const u8) !?[]const u8 {
    const trimmed = std.mem.trim(u8, text, " \t");
    if (trimmed.len == 0) return null;
    return try allocator.dupe(u8, trimmed);
}

/// Efface le contenu d’un tampon avant de le réutiliser.
fn wipeBuffer(buffer: *ui.TextBuffer) void {
    const text = buffer.text();
    if (text.len > 0) crypto.wipe(@constCast(text));
    buffer.clear();
}

/// Comparaison insensible à la casse ASCII, sans allocation.
fn containsFold(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0) return true;
    if (needle.len > haystack.len) return false;
    var i: usize = 0;
    while (i + needle.len <= haystack.len) : (i += 1) {
        if (std.ascii.eqlIgnoreCase(haystack[i .. i + needle.len], needle)) return true;
    }
    return false;
}

fn shortDate(iso: []const u8) []const u8 {
    if (iso.len >= 10) return iso[0..10];
    return iso;
}

fn fileErrorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.FileNotFound => "Fichier introuvable.",
        error.AccessDenied => "Accès refusé à ce fichier.",
        error.StreamTooLong => "Ce fichier dépasse la taille maximale prise en charge (128 Mo).",
        error.IsDir => "Ce chemin désigne un dossier, pas un fichier.",
        else => "Le fichier n’a pas pu être lu.",
    };
}

fn createErrorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.InvalidName => "Donnez un nom au coffre.",
        error.InvalidPassword => "Saisissez une phrase de passe.",
        error.InvalidKdf => "Les paramètres de chiffrement sont invalides.",
        error.OutOfMemory => "Mémoire insuffisante pour créer ce coffre.",
        else => "Le coffre n’a pas pu être créé.",
    };
}

fn writeErrorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.AccessDenied => "Écriture refusée à cet emplacement.",
        error.FileNotFound => "Le dossier de destination n’existe pas.",
        error.IsDir => "Ce chemin désigne un dossier, pas un fichier.",
        error.NoSpaceLeft => "Il n’y a plus assez d’espace disque.",
        error.InvalidPath => "Ce chemin de fichier est invalide.",
        error.OutOfMemory => "Mémoire insuffisante pour enregistrer le coffre.",
        else => "Le fichier n’a pas pu être enregistré.",
    };
}

fn importErrorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.EmptyFile => "Le fichier d’import est vide.",
        error.UnrecognizedFormat => "Format non reconnu. Utilisez un export JSON Bitwarden, Proton Pass ou Enpass, ou un fichier CSV.",
        error.InvalidJson => "Le fichier JSON est illisible.",
        error.EncryptedExport => "Les exports chiffrés ne sont pas pris en charge. Exportez d’abord en clair.",
        error.CoffreFile => "Ce fichier est un coffre Coffre. Utilisez « Ouvrir un coffre » avec son mot de passe.",
        error.InvalidCsv => "Le fichier CSV ne contient aucune ligne de données.",
        else => "L’import a échoué.",
    };
}

fn itemErrorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.EmptyTitle => "Le titre est obligatoire.",
        error.EmptyVaultId => "Choisissez un coffre.",
        error.InvalidItemKey => "La clé de cet élément est invalide.",
        error.OutOfMemory => "Mémoire insuffisante pour enregistrer l’élément.",
        else => "L’élément n’a pas pu être enregistré.",
    };
}

fn openErrorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.WrongPassword => "Mot de passe incorrect ou coffre corrompu.",
        error.InvalidFile => "Ce fichier n’est pas un coffre Coffre valide.",
        error.OutOfMemory => "Mémoire insuffisante pour ouvrir ce coffre.",
        else => "Le coffre n’a pas pu être ouvert.",
    };
}

fn recoveryErrorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.InvalidPhrase => "La phrase de récupération doit contenir dix mots.",
        error.InvalidPassword => "Choisissez une phrase de passe de 12 caractères minimum.",
        error.MissingRecovery => "Ce coffre n’a pas de phrase de récupération.",
        error.WrongPhrase => "Phrase de récupération incorrecte.",
        error.CorruptEnvelope => "L’enveloppe de récupération est corrompue.",
        error.OutOfMemory => "Mémoire insuffisante pour récupérer ce coffre.",
        else => "La récupération a échoué.",
    };
}
