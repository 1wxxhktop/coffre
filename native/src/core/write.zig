//! Création et enregistrement d’un fichier `.coffre`.
//!
//! La création produit un fichier v3 neuf : identifiants aléatoires, sel
//! Argon2id de 16 octets, clé de coffre de 32 octets, métadonnées chiffrées.
//! L’enregistrement est atomique : le contenu est écrit dans un fichier
//! temporaire du même dossier, synchronisé, puis renommé sur la destination.
//! Les trois versions précédentes sont conservées en `…​.bak1` à `…​.bak3`.

const std = @import("std");
const crypto = @import("crypto.zig");
const format = @import("format.zig");
const vault = @import("vault.zig");

pub const Error = error{
    InvalidName,
    InvalidPassword,
    InvalidPath,
    InvalidKdf,
};

/// Nombre de sauvegardes tournantes conservées avant écrasement.
pub const BACKUP_COUNT = 3;

pub const CreateOptions = struct {
    /// Nom du coffre initial (« Personnel » par défaut).
    name: []const u8 = "Personnel",
    memory_kib: u32 = crypto.KDF_DEFAULTS.memory_kib,
    iterations: u32 = crypto.KDF_DEFAULTS.iterations,
    parallelism: u32 = crypto.KDF_DEFAULTS.parallelism,
};

/// Fichier créé, prêt à être écrit. `deinit` efface la clé maîtresse et le
/// contenu JSON avant de libérer la mémoire.
pub const Created = struct {
    /// Contenu JSON du fichier, alloué avec l’allocateur passé à `create`.
    bytes: []u8,
    /// Clé maîtresse dérivée, pour ouvrir le fichier sans redériver Argon2id.
    master_key: crypto.Key,

    pub fn deinit(self: *Created, allocator: std.mem.Allocator) void {
        crypto.wipeKey(&self.master_key);
        crypto.wipe(self.bytes);
        allocator.free(self.bytes);
        self.* = undefined;
    }
};

/// Construit un nouveau fichier `.coffre` v3 en mémoire.
pub fn create(
    allocator: std.mem.Allocator,
    password: []const u8,
    options: CreateOptions,
    io: std.Io,
) !Created {
    if (std.mem.trim(u8, options.name, " \t\r\n").len == 0) return Error.InvalidName;
    if (password.len == 0) return Error.InvalidPassword;
    if (options.memory_kib == 0 or options.iterations == 0 or options.parallelism == 0) {
        return Error.InvalidKdf;
    }

    // Tout ce qui appartient au fichier vit dans une arène temporaire ; seule
    // la chaîne JSON finale est copiée avec l’allocateur de l’appelant.
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const now = try isoNow(arena, io);

    var salt_bytes: [crypto.SALT_BYTES]u8 = undefined;
    std.Io.random(io, &salt_bytes);
    const salt_text = try crypto.base64Encode(arena, &salt_bytes);
    const salt = crypto.base64Decode(arena, salt_text) catch return Error.InvalidKdf;

    var master_key = try crypto.deriveMasterKey(
        arena,
        password,
        salt,
        options.memory_kib,
        options.iterations,
        options.parallelism,
        crypto.KEY_BYTES,
        io,
    );
    errdefer crypto.wipeKey(&master_key);

    var vault_key: crypto.Key = undefined;
    std.Io.random(io, &vault_key);
    errdefer crypto.wipeKey(&vault_key);

    const vault_id = try randomId(arena, "v", io);
    const key_aad = try vault.vaultKeyAad(arena, vault_id);
    const key_sealed = try crypto.seal(arena, &vault_key, master_key, key_aad, io);

    const meta_aad = try vault.vaultMetaAad(arena, vault_id);
    const Meta = struct { name: []const u8 };
    const meta_text = try std.json.Stringify.valueAlloc(arena, Meta{ .name = options.name }, .{});
    const name_sealed = try crypto.seal(arena, meta_text, vault_key, meta_aad, io);

    const vaults = try arena.alloc(format.VaultRecord, 1);
    vaults[0] = .{
        .id = vault_id,
        .key = .{ .n = key_sealed.n, .c = key_sealed.c },
        .name = .{ .n = name_sealed.n, .c = name_sealed.c },
        .createdAt = now,
        .updatedAt = now,
    };

    const file: format.VaultFile = .{
        .format = "coffre",
        .version = 3,
        .id = try randomId(arena, "vf", io),
        .createdAt = now,
        .updatedAt = now,
        .kdf = .{
            .algorithm = "argon2id",
            .salt = salt_text,
            .memoryKiB = options.memory_kib,
            .iterations = options.iterations,
            .parallelism = options.parallelism,
            .keyLength = crypto.KEY_BYTES,
        },
        .vaults = vaults,
        .items = &.{},
        .attachments = &.{},
        .versions = &.{},
        .recovery = null,
    };

    const text = try format.serialize(arena, &file);
    const bytes = try allocator.dupe(u8, text);
    errdefer {
        crypto.wipe(bytes);
        allocator.free(bytes);
    }

    crypto.wipeKey(&vault_key);
    return .{ .bytes = bytes, .master_key = master_key };
}

/// Écrit `bytes` dans `path` de façon atomique, puis fait tourner les
/// sauvegardes. Le fichier existant n’est remplacé qu’une fois le nouveau
/// contenu entièrement écrit et synchronisé.
pub fn saveAtomic(
    allocator: std.mem.Allocator,
    path: []const u8,
    bytes: []const u8,
    io: std.Io,
) !void {
    if (path.len == 0) return Error.InvalidPath;

    const dir_path = std.fs.path.dirname(path);
    var dir: std.Io.Dir = if (dir_path) |value| blk: {
        if (std.fs.path.isAbsolute(value)) {
            break :blk try std.Io.Dir.openDirAbsolute(io, value, .{});
        }
        break :blk try std.Io.Dir.cwd().openDir(io, value, .{});
    } else std.Io.Dir.cwd();
    defer if (dir_path != null) dir.close(io);

    const base = std.fs.path.basename(path);
    if (base.len == 0) return Error.InvalidPath;

    try rotateBackups(allocator, dir, io, base);

    // Le coffre n’a pas à être lisible par les autres comptes de la machine.
    const permissions: std.Io.File.Permissions = if (@import("builtin").os.tag == .windows)
        .default_file
    else
        @fromBackingInt(@intCast(0o600));

    var atomic = try dir.createFileAtomic(io, base, .{
        .replace = true,
        .permissions = permissions,
    });
    defer atomic.deinit(io);

    try atomic.file.writeStreamingAll(io, bytes);
    try atomic.file.sync(io);
    try atomic.replace(io);
}

fn rotateBackups(
    allocator: std.mem.Allocator,
    dir: std.Io.Dir,
    io: std.Io,
    base: []const u8,
) !void {
    _ = allocator;

    var buffers: [BACKUP_COUNT][std.fs.max_path_bytes]u8 = undefined;
    var names: [BACKUP_COUNT][]const u8 = undefined;
    for (0..BACKUP_COUNT) |index| {
        names[index] = try std.fmt.bufPrint(&buffers[index], "{s}.bak{d}", .{ base, index + 1 });
    }

    // Supprime la plus ancienne, puis décale les autres vers le haut.
    dir.deleteFile(io, names[BACKUP_COUNT - 1]) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };
    var index: usize = BACKUP_COUNT - 1;
    while (index > 0) : (index -= 1) {
        dir.rename(names[index - 1], dir, names[index], io) catch |err| switch (err) {
            error.FileNotFound => {},
            else => return err,
        };
    }

    // Le fichier courant devient la sauvegarde la plus récente. Une copie
    // atomique évite de laisser un intervalle sans fichier principal.
    const current = dir.openFile(io, base, .{}) catch |err| switch (err) {
        error.FileNotFound => return,
        else => return err,
    };
    current.close(io);

    try dir.copyFile(base, dir, names[0], io, .{ .replace = true });
}

/// Nom de fichier proposé pour un nouveau coffre : `coffre-AAAA-MM-JJ.coffre`.
pub fn suggestedFileName(allocator: std.mem.Allocator, io: std.Io) ![]u8 {
    const now = try isoNow(allocator, io);
    defer allocator.free(now);
    return std.fmt.allocPrint(allocator, "coffre-{s}.coffre", .{now[0..10]});
}

/// Identifiant `prefix_` suivi de 16 octets aléatoires en hexadécimal, comme
/// `randomId` de l’application web.
pub fn randomId(allocator: std.mem.Allocator, prefix: []const u8, io: std.Io) ![]u8 {
    var bytes: [16]u8 = undefined;
    std.Io.random(io, &bytes);
    const hex = std.fmt.bytesToHex(bytes, .lower);
    return std.fmt.allocPrint(allocator, "{s}_{s}", .{ prefix, hex });
}

/// Date ISO 8601 UTC avec millisecondes, au format du reste de Coffre.
pub fn isoNow(allocator: std.mem.Allocator, io: std.Io) ![]u8 {
    const timestamp = std.Io.Timestamp.now(io, .real);
    const total_ms: u64 = if (timestamp.nanoseconds <= 0)
        0
    else
        @intCast(@divFloor(timestamp.nanoseconds, std.time.ns_per_ms));
    const secs = total_ms / std.time.ms_per_s;
    const millis = total_ms % std.time.ms_per_s;

    const epoch_seconds: std.time.epoch.EpochSeconds = .{ .secs = secs };
    const year_day = epoch_seconds.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch_seconds.getDaySeconds();

    return std.fmt.allocPrint(
        allocator,
        "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.{d:0>3}Z",
        .{
            year_day.year,
            @backingInt(month_day.month),
            @as(u16, month_day.day_index) + 1,
            day_seconds.getHoursIntoDay(),
            day_seconds.getMinutesIntoHour(),
            day_seconds.getSecondsIntoMinute(),
            millis,
        },
    );
}

// ------------------------------------------------------------------ tests

const testing = std.testing;

test "create produit un fichier v3 valide et déverrouillable" {
    var created = try create(testing.allocator, "phrase de passe de test", .{ .name = "Essai" }, testing.io);
    defer created.deinit(testing.allocator);

    var parsed = try format.parse(testing.allocator, created.bytes);
    defer parsed.deinit();
    try testing.expectEqual(@as(u8, 3), parsed.value.version);
    try testing.expectEqualStrings("coffre", parsed.value.format);
    try testing.expectEqual(@as(usize, 1), parsed.value.vaults.len);

    var opened = try vault.openWithMasterKey(testing.allocator, &parsed.value, created.master_key);
    defer opened.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 1), opened.vaults.len);
    try testing.expectEqualStrings("Essai", opened.vaults[0].name);
    try testing.expectEqual(@as(usize, 0), opened.items.len);
}

test "create refuse un nom vide et un mot de passe vide" {
    try testing.expectError(
        Error.InvalidName,
        create(testing.allocator, "mot de passe", .{ .name = "   " }, testing.io),
    );
    try testing.expectError(
        Error.InvalidPassword,
        create(testing.allocator, "", .{ .name = "Essai" }, testing.io),
    );
}

test "saveAtomic écrit puis remplace en conservant trois sauvegardes" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    // Chemins relatifs au dossier courant, comme le fait l’application.
    const dir_path = try std.fs.path.join(testing.allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer testing.allocator.free(dir_path);
    const path = try std.fs.path.join(testing.allocator, &.{ dir_path, "coffre.coffre" });
    defer testing.allocator.free(path);

    try saveAtomic(testing.allocator, path, "version 1", testing.io);
    try expectFile(path, "version 1");

    if (@import("builtin").os.tag != .windows) {
        const stat = try std.Io.Dir.cwd().statFile(testing.io, path, .{});
        try testing.expectEqual(@as(std.posix.mode_t, 0o600), stat.permissions.toMode() & 0o777);
    }

    try saveAtomic(testing.allocator, path, "version 2", testing.io);
    try expectFile(path, "version 2");
    try expectBackup(path, 1, "version 1");

    try saveAtomic(testing.allocator, path, "version 3", testing.io);
    try saveAtomic(testing.allocator, path, "version 4", testing.io);
    try expectFile(path, "version 4");
    try expectBackup(path, 1, "version 3");
    try expectBackup(path, 2, "version 2");
    try expectBackup(path, 3, "version 1");

    // La quatrième sauvegarde remplace la plus ancienne.
    try saveAtomic(testing.allocator, path, "version 5", testing.io);
    try expectFile(path, "version 5");
    try expectBackup(path, 1, "version 4");
    try expectBackup(path, 2, "version 3");
    try expectBackup(path, 3, "version 2");
}

fn expectFile(path: []const u8, expected: []const u8) !void {
    const data = try std.Io.Dir.cwd().readFileAlloc(testing.io, path, testing.allocator, .limited(1024));
    defer testing.allocator.free(data);
    try testing.expectEqualStrings(expected, data);
}

fn expectBackup(path: []const u8, index: usize, expected: []const u8) !void {
    const backup = try std.fmt.allocPrint(testing.allocator, "{s}.bak{d}", .{ path, index });
    defer testing.allocator.free(backup);
    try expectFile(backup, expected);
}
