//! Phrase de récupération et ré-enveloppement de la clé maîtresse.
//!
//! Dix mots de la liste EFF (environ 129 bits) dérivent une clé qui ouvre
//! l’enveloppe de récupération. La phrase n’est jamais stockée : elle sert
//! uniquement à sceller puis à rouvrir la clé de récupération, qui elle-même
//! scelle les clés des coffres.

const std = @import("std");
const crypto = @import("crypto.zig");
const format = @import("format.zig");
const vault = @import("vault.zig");
const write = @import("write.zig");
const generator = @import("generator.zig");

pub const WORDS = 10;
pub const MIN_PASSWORD = 12;

pub const Error = error{
    InvalidPhrase,
    InvalidPassword,
    MissingRecovery,
    WrongPhrase,
    CorruptEnvelope,
};

pub const BuildResult = struct {
    envelope: format.RecoveryEnvelope,
    recovery_key: crypto.Key,
};

pub const Recovered = struct {
    file: format.VaultFile,
    master_key: crypto.Key,
};

/// Génère une phrase de dix mots EFF, séparés par une espace.
pub fn generate(allocator: std.mem.Allocator, io: std.Io) ![]u8 {
    return generator.passphrase(allocator, .{
        .words = WORDS,
        .separator = " ",
        .capitalize = false,
        .include_number = false,
    }, io);
}

/// Normalise une phrase : minuscules, espaces multiples réduits, bords
/// supprimés. L’ordre des mots reste significatif.
pub fn normalize(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const buffer = try allocator.alloc(u8, value.len);
    defer allocator.free(buffer);

    var len: usize = 0;
    var pending_space = false;
    for (value) |ch| {
        if (ch == ' ' or ch == '\t' or ch == '\r' or ch == '\n') {
            pending_space = len > 0;
            continue;
        }
        if (pending_space) {
            buffer[len] = ' ';
            len += 1;
            pending_space = false;
        }
        buffer[len] = std.ascii.toLower(ch);
        len += 1;
    }
    return allocator.dupe(u8, buffer[0..len]);
}

pub fn isPhrase(value: []const u8) bool {
    var words: usize = 0;
    var current: usize = 0;
    for (value) |ch| {
        if (ch == ' ' or ch == '\t' or ch == '\r' or ch == '\n') {
            if (current > 0) {
                if (current < 3) return false;
                words += 1;
                current = 0;
            }
            continue;
        }
        current += 1;
    }
    if (current > 0) {
        if (current < 3) return false;
        words += 1;
    }
    return words == WORDS;
}

fn isNormalizedPhrase(value: []const u8) bool {
    var words: usize = 0;
    var current: usize = 0;
    for (value) |ch| {
        if (ch == ' ') {
            if (current == 0) return false;
            if (current < 3) return false;
            words += 1;
            current = 0;
            continue;
        }
        current += 1;
    }
    if (current < 3) return false;
    return words + 1 == WORDS;
}

/// Construit une enveloppe de récupération pour toutes les clés de coffre.
pub fn buildEnvelope(
    allocator: std.mem.Allocator,
    file: *const format.VaultFile,
    opened: *const vault.OpenedVault,
    phrase: []const u8,
    io: std.Io,
) !BuildResult {
    const normalized = try normalize(allocator, phrase);
    defer {
        crypto.wipe(normalized);
        allocator.free(normalized);
    }
    if (!isNormalizedPhrase(normalized)) return Error.InvalidPhrase;

    var salt: [crypto.SALT_BYTES]u8 = undefined;
    std.Io.random(io, &salt);
    const salt_text = try crypto.base64Encode(allocator, &salt);

    var phrase_key = try crypto.deriveMasterKey(
        allocator,
        normalized,
        &salt,
        crypto.KDF_DEFAULTS.memory_kib,
        crypto.KDF_DEFAULTS.iterations,
        crypto.KDF_DEFAULTS.parallelism,
        crypto.KEY_BYTES,
        io,
    );
    defer crypto.wipeKey(&phrase_key);

    var recovery_key: crypto.Key = undefined;
    std.Io.random(io, &recovery_key);
    errdefer crypto.wipeKey(&recovery_key);

    const key_sealed = try crypto.seal(allocator, &recovery_key, phrase_key, "coffre:v1:recovery-key", io);
    const guard_sealed = try crypto.seal(allocator, &recovery_key, opened.master_key, "coffre:v1:recovery-guard", io);

    const wraps = try allocator.alloc(format.RecoveryWrap, file.vaults.len);
    for (file.vaults, 0..) |record, index| {
        const vault_key = opened.vaultKey(record.id) orelse return Error.CorruptEnvelope;
        const aad = try std.fmt.allocPrint(allocator, "coffre:v1:recovery-vault-key:{s}", .{record.id});
        defer allocator.free(aad);
        const sealed = try crypto.seal(allocator, &vault_key, recovery_key, aad, io);
        wraps[index] = .{
            .vaultId = record.id,
            .key = .{ .n = sealed.n, .c = sealed.c },
        };
    }

    return .{
        .envelope = .{
            .version = 1,
            .kdf = .{
                .algorithm = "argon2id",
                .salt = salt_text,
                .memoryKiB = crypto.KDF_DEFAULTS.memory_kib,
                .iterations = crypto.KDF_DEFAULTS.iterations,
                .parallelism = crypto.KDF_DEFAULTS.parallelism,
                .keyLength = crypto.KEY_BYTES,
            },
            .createdAt = try write.isoNow(allocator, io),
            .key = .{ .n = key_sealed.n, .c = key_sealed.c },
            .guard = .{ .n = guard_sealed.n, .c = guard_sealed.c },
            .wraps = wraps,
        },
        .recovery_key = recovery_key,
    };
}

/// Ouvre un fichier avec la phrase de récupération et ré-enveloppe toutes les
/// clés de coffre sous une nouvelle phrase de passe maîtresse.
pub fn unlock(
    allocator: std.mem.Allocator,
    file: *const format.VaultFile,
    phrase: []const u8,
    new_password: []const u8,
    io: std.Io,
) !Recovered {
    if (new_password.len < MIN_PASSWORD) return Error.InvalidPassword;
    const recovery = file.recovery orelse return Error.MissingRecovery;

    const normalized = try normalize(allocator, phrase);
    defer {
        crypto.wipe(normalized);
        allocator.free(normalized);
    }
    if (!isNormalizedPhrase(normalized)) return Error.InvalidPhrase;

    const salt = crypto.base64Decode(allocator, recovery.kdf.salt) catch return Error.CorruptEnvelope;
    defer allocator.free(salt);

    var phrase_key = crypto.deriveMasterKey(
        allocator,
        normalized,
        salt,
        recovery.kdf.memoryKiB,
        recovery.kdf.iterations,
        recovery.kdf.parallelism,
        recovery.kdf.keyLength,
        io,
    ) catch return Error.CorruptEnvelope;
    defer crypto.wipeKey(&phrase_key);

    const raw_recovery = crypto.open(allocator, recovery.key, phrase_key, "coffre:v1:recovery-key") catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return Error.WrongPhrase,
    };
    defer {
        crypto.wipe(raw_recovery);
        allocator.free(raw_recovery);
    }
    if (raw_recovery.len != crypto.KEY_BYTES) return Error.CorruptEnvelope;

    var recovery_key: crypto.Key = undefined;
    @memcpy(&recovery_key, raw_recovery);
    defer crypto.wipeKey(&recovery_key);

    var vault_keys: std.StringHashMap(crypto.Key) = .init(allocator);
    defer {
        var values = vault_keys.valueIterator();
        while (values.next()) |key| crypto.wipeKey(key);
        vault_keys.deinit();
    }

    for (recovery.wraps) |wrap| {
        const aad = try std.fmt.allocPrint(allocator, "coffre:v1:recovery-vault-key:{s}", .{wrap.vaultId});
        defer allocator.free(aad);
        const raw = crypto.open(allocator, wrap.key, recovery_key, aad) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return Error.CorruptEnvelope,
        };
        defer {
            crypto.wipe(raw);
            allocator.free(raw);
        }
        if (raw.len != crypto.KEY_BYTES) return Error.CorruptEnvelope;
        var key: crypto.Key = undefined;
        @memcpy(&key, raw);
        try vault_keys.putNoClobber(wrap.vaultId, key);
    }

    for (file.vaults) |record| {
        if (!vault_keys.contains(record.id)) return Error.CorruptEnvelope;
    }

    var new_salt: [crypto.SALT_BYTES]u8 = undefined;
    std.Io.random(io, &new_salt);
    const new_salt_text = try crypto.base64Encode(allocator, &new_salt);
    var master_key = try crypto.deriveMasterKey(
        allocator,
        new_password,
        &new_salt,
        crypto.KDF_DEFAULTS.memory_kib,
        crypto.KDF_DEFAULTS.iterations,
        crypto.KDF_DEFAULTS.parallelism,
        crypto.KEY_BYTES,
        io,
    );
    errdefer crypto.wipeKey(&master_key);

    const now = try write.isoNow(allocator, io);
    const vaults = try allocator.alloc(format.VaultRecord, file.vaults.len);
    for (file.vaults, 0..) |record, index| {
        const vault_key = vault_keys.get(record.id) orelse return Error.CorruptEnvelope;
        const aad = try vault.vaultKeyAad(allocator, record.id);
        defer allocator.free(aad);
        const sealed = try crypto.seal(allocator, &vault_key, master_key, aad, io);
        vaults[index] = .{
            .id = record.id,
            .key = .{ .n = sealed.n, .c = sealed.c },
            .name = record.name,
            .createdAt = record.createdAt,
            .updatedAt = now,
        };
    }

    const guard = try crypto.seal(allocator, &recovery_key, master_key, "coffre:v1:recovery-guard", io);

    return .{
        .file = .{
            .format = file.format,
            .version = 3,
            .id = file.id,
            .createdAt = file.createdAt,
            .updatedAt = now,
            .kdf = .{
                .algorithm = "argon2id",
                .salt = new_salt_text,
                .memoryKiB = crypto.KDF_DEFAULTS.memory_kib,
                .iterations = crypto.KDF_DEFAULTS.iterations,
                .parallelism = crypto.KDF_DEFAULTS.parallelism,
                .keyLength = crypto.KEY_BYTES,
            },
            .vaults = vaults,
            .items = file.items,
            .attachments = file.attachments,
            .versions = file.versions,
            .recovery = .{
                .version = recovery.version,
                .kdf = recovery.kdf,
                .createdAt = recovery.createdAt,
                .key = recovery.key,
                .guard = .{ .n = guard.n, .c = guard.c },
                .wraps = recovery.wraps,
            },
        },
        .master_key = master_key,
    };
}

// ------------------------------------------------------------------ tests

const testing = std.testing;
const v3 = @embedFile("fixtures/v3.coffre.json");
const MASTER_PASSWORD = "phrase de passe de test solide";
const RECOVERY_PHRASE = "abacus abdomen abdominal abide abiding ability abject ablaze abode abort";

test "la phrase générée contient dix mots EFF" {
    const phrase = try generate(testing.allocator, testing.io);
    defer testing.allocator.free(phrase);

    var words = std.mem.splitScalar(u8, phrase, ' ');
    var count: usize = 0;
    while (words.next()) |word| {
        count += 1;
        try testing.expect(word.len >= 3);
        try testing.expect(std.ascii.isLower(word[0]));
    }
    try testing.expectEqual(@as(usize, WORDS), count);
    try testing.expect(isPhrase(phrase));
}

test "la normalisation neutralise la casse et les espaces" {
    const value = try normalize(testing.allocator, "  ABACUS   abdomen\nAbdominal abide  ");
    defer testing.allocator.free(value);
    try testing.expectEqualStrings("abacus abdomen abdominal abide", value);
    try testing.expect(!isPhrase(value));
}

test "la phrase de récupération de la fixture ouvre le coffre" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var parsed = try format.parse(arena, v3);
    defer parsed.deinit();

    var recovered = try unlock(arena, &parsed.value, RECOVERY_PHRASE, "nouvelle phrase de passe solide", testing.io);
    defer crypto.wipeKey(&recovered.master_key);

    try testing.expect(recovered.file.recovery != null);
    try testing.expectEqual(@as(usize, 1), recovered.file.vaults.len);

    var opened = try vault.openWithMasterKey(arena, &recovered.file, recovered.master_key);
    defer opened.deinit(arena);
    try testing.expectEqual(@as(usize, 1), opened.items.len);
    try testing.expectEqualStrings("GitHub", opened.items[0].content.title);
}

test "une phrase de récupération incorrecte est refusée" {
    var parsed = try format.parse(testing.allocator, v3);
    defer parsed.deinit();

    try testing.expectError(
        Error.WrongPhrase,
        unlock(testing.allocator, &parsed.value, "abacus abdomen abdominal abide abiding ability abject ablaze abode abandon", "nouvelle phrase de passe solide", testing.io),
    );
}

test "une enveloppe construite se rouvre avec la phrase" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var parsed = try format.parse(arena, v3);
    defer parsed.deinit();
    var opened = try vault.open(arena, &parsed.value, MASTER_PASSWORD, testing.io);
    defer opened.deinit(arena);

    const phrase = try generate(testing.allocator, testing.io);
    defer testing.allocator.free(phrase);

    var built = try buildEnvelope(arena, &parsed.value, &opened, phrase, testing.io);
    defer crypto.wipeKey(&built.recovery_key);
    parsed.value.recovery = built.envelope;

    var recovered = try unlock(arena, &parsed.value, phrase, "autre phrase de passe solide", testing.io);
    defer crypto.wipeKey(&recovered.master_key);

    var reopened = try vault.openWithMasterKey(arena, &recovered.file, recovered.master_key);
    defer reopened.deinit(arena);
    try testing.expectEqualStrings("GitHub", reopened.items[0].content.title);
}
