//! Format de fichier `.coffre` (versions 1, 2 et 3).
//!
//! Le fichier est du JSON : seuls les identifiants, les dates, les paramètres
//! KDF et l’enveloppe de récupération sont visibles. Tout le reste est chiffré.
//! Les fichiers v1 et v2 sont lus puis migrés en v3 à l’écriture.

const std = @import("std");

pub const Error = error{
    InvalidJson,
    InvalidFormat,
    UnsupportedVersion,
    InvalidKdf,
    DuplicateVaultId,
    DuplicateItemId,
    UnknownVault,
    DuplicateAttachmentId,
    UnknownItem,
    AttachmentVaultMismatch,
    DuplicateVersionId,
    VersionVaultMismatch,
    DuplicateRecoveryWrap,
    RecoveryVaultMismatch,
    IncompleteRecovery,
};

pub const KdfParams = struct {
    algorithm: []const u8 = "argon2id",
    salt: []const u8,
    memoryKiB: u32,
    iterations: u32,
    parallelism: u32,
    keyLength: u32,
};

pub const Sealed = struct {
    n: []const u8,
    c: []const u8,
};

pub const VaultRecord = struct {
    id: []const u8,
    key: Sealed,
    name: Sealed,
    createdAt: []const u8,
    updatedAt: []const u8,
};

pub const ItemRecord = struct {
    id: []const u8,
    vaultId: []const u8,
    key: Sealed,
    content: Sealed,
    createdAt: []const u8,
    updatedAt: []const u8,
};

pub const AttachmentRecord = struct {
    id: []const u8,
    itemId: []const u8,
    vaultId: []const u8,
    data: Sealed,
    createdAt: []const u8,
};

pub const VersionRecord = struct {
    id: []const u8,
    itemId: []const u8,
    vaultId: []const u8,
    content: Sealed,
    createdAt: []const u8,
};

pub const RecoveryWrap = struct {
    vaultId: []const u8,
    key: Sealed,
};

pub const RecoveryEnvelope = struct {
    version: u8 = 1,
    kdf: KdfParams,
    createdAt: []const u8,
    key: Sealed,
    guard: Sealed,
    wraps: []RecoveryWrap,
};

pub const VaultFile = struct {
    format: []const u8 = "coffre",
    version: u8,
    id: []const u8,
    createdAt: []const u8,
    updatedAt: []const u8,
    kdf: KdfParams,
    vaults: []VaultRecord,
    items: []ItemRecord,
    attachments: []AttachmentRecord = &.{},
    versions: []VersionRecord = &.{},
    recovery: ?RecoveryEnvelope = null,
};

pub const CustomField = struct {
    id: []const u8 = "",
    label: []const u8 = "",
    value: []const u8 = "",
    type: []const u8 = "text",
};

pub const AttachmentMeta = struct {
    id: []const u8 = "",
    name: []const u8 = "",
    mime: []const u8 = "",
    size: u64 = 0,
    createdAt: []const u8 = "",
};

/// Contenu déchiffré d’un élément. Les champs propres à un type sont optionnels
/// afin de conserver un seul type de lecture pour les quatre types d’éléments.
pub const ItemContent = struct {
    type: []const u8,
    title: []const u8 = "",
    favorite: bool = false,
    notes: []const u8 = "",
    tags: []const []const u8 = &.{},
    customFields: []CustomField = &.{},
    attachments: []AttachmentMeta = &.{},
    deletedAt: ?[]const u8 = null,

    // Connexion
    username: ?[]const u8 = null,
    password: ?[]const u8 = null,
    urls: ?[]const []const u8 = null,
    totp: ?[]const u8 = null,

    // Carte
    cardholder: ?[]const u8 = null,
    number: ?[]const u8 = null,
    expiry: ?[]const u8 = null,
    cvc: ?[]const u8 = null,
    pin: ?[]const u8 = null,
    brand: ?[]const u8 = null,

    // Identité
    firstName: ?[]const u8 = null,
    lastName: ?[]const u8 = null,
    email: ?[]const u8 = null,
    phone: ?[]const u8 = null,
    address: ?[]const u8 = null,
    city: ?[]const u8 = null,
    postalCode: ?[]const u8 = null,
    country: ?[]const u8 = null,
    birthDate: ?[]const u8 = null,
};

pub fn parse(allocator: std.mem.Allocator, text: []const u8) !std.json.Parsed(VaultFile) {
    const trimmed = std.mem.trim(u8, text, " \t\r\n");
    if (trimmed.len == 0) return Error.InvalidJson;

    var parsed = std.json.parseFromSlice(
        VaultFile,
        allocator,
        trimmed,
        .{ .ignore_unknown_fields = true, .allocate = .alloc_always },
    ) catch return Error.InvalidJson;

    errdefer parsed.deinit();
    try validate(&parsed.value);

    // Les fichiers v1 et v2 sont migrés en v3 en mémoire.
    parsed.value.version = 3;
    return parsed;
}

pub fn validate(file: *const VaultFile) !void {
    if (!std.mem.eql(u8, file.format, "coffre")) return Error.InvalidFormat;
    if (file.version < 1 or file.version > 3) return Error.UnsupportedVersion;
    if (!std.mem.eql(u8, file.kdf.algorithm, "argon2id")) return Error.InvalidKdf;
    if (file.kdf.keyLength != 32) return Error.InvalidKdf;
    if (file.kdf.salt.len == 0) return Error.InvalidKdf;

    for (file.vaults, 0..) |vault, i| {
        for (file.vaults[0..i]) |previous| {
            if (std.mem.eql(u8, vault.id, previous.id)) return Error.DuplicateVaultId;
        }
    }

    for (file.items, 0..) |item, i| {
        for (file.items[0..i]) |previous| {
            if (std.mem.eql(u8, item.id, previous.id)) return Error.DuplicateItemId;
        }
        if (findVault(file, item.vaultId) == null) return Error.UnknownVault;
    }

    for (file.attachments, 0..) |attachment, i| {
        for (file.attachments[0..i]) |previous| {
            if (std.mem.eql(u8, attachment.id, previous.id)) return Error.DuplicateAttachmentId;
        }
        const item = findItem(file, attachment.itemId) orelse return Error.UnknownItem;
        if (!std.mem.eql(u8, item.vaultId, attachment.vaultId)) {
            return Error.AttachmentVaultMismatch;
        }
    }

    for (file.versions, 0..) |version, i| {
        for (file.versions[0..i]) |previous| {
            if (std.mem.eql(u8, version.id, previous.id)) return Error.DuplicateVersionId;
        }
        const item = findItem(file, version.itemId) orelse return Error.UnknownItem;
        if (!std.mem.eql(u8, item.vaultId, version.vaultId)) {
            return Error.VersionVaultMismatch;
        }
    }

    if (file.recovery) |recovery| {
        for (recovery.wraps, 0..) |wrap, i| {
            for (recovery.wraps[0..i]) |previous| {
                if (std.mem.eql(u8, wrap.vaultId, previous.vaultId)) {
                    return Error.DuplicateRecoveryWrap;
                }
            }
            if (findVault(file, wrap.vaultId) == null) return Error.RecoveryVaultMismatch;
        }
        for (file.vaults) |vault| {
            var found = false;
            for (recovery.wraps) |wrap| {
                if (std.mem.eql(u8, wrap.vaultId, vault.id)) {
                    found = true;
                    break;
                }
            }
            if (!found) return Error.IncompleteRecovery;
        }
    }
}

pub fn findVault(file: *const VaultFile, id: []const u8) ?*const VaultRecord {
    for (file.vaults) |*vault| {
        if (std.mem.eql(u8, vault.id, id)) return vault;
    }
    return null;
}

pub fn findItem(file: *const VaultFile, id: []const u8) ?*const ItemRecord {
    for (file.items) |*item| {
        if (std.mem.eql(u8, item.id, id)) return item;
    }
    return null;
}

pub fn serialize(allocator: std.mem.Allocator, file: *const VaultFile) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, file.*, .{
        .whitespace = .indent_2,
        .emit_null_optional_fields = false,
    });
}

test "parse et sérialise un fichier minimal" {
    const allocator = std.testing.allocator;
    const text =
        \\{
        \\  "format": "coffre",
        \\  "version": 2,
        \\  "id": "vf_test",
        \\  "createdAt": "2026-01-01T00:00:00.000Z",
        \\  "updatedAt": "2026-01-01T00:00:00.000Z",
        \\  "kdf": {
        \\    "algorithm": "argon2id",
        \\    "salt": "nqQv3f1uWdttPDNpBx5vTQ==",
        \\    "memoryKiB": 8192,
        \\    "iterations": 1,
        \\    "parallelism": 1,
        \\    "keyLength": 32
        \\  },
        \\  "vaults": [],
        \\  "items": []
        \\}
    ;
    var parsed = try parse(allocator, text);
    defer parsed.deinit();
    try std.testing.expectEqual(@as(u8, 3), parsed.value.version);

    const out = try serialize(allocator, &parsed.value);
    defer allocator.free(out);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"format\": \"coffre\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"version\": 3") != null);
}
