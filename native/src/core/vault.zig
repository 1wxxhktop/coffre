//! Ouverture d’un fichier `.coffre` : dérivation de la clé maîtresse,
//! déchiffrement des coffres et des éléments.

const std = @import("std");
const crypto = @import("crypto.zig");
const format = @import("format.zig");

pub const Error = error{
    WrongPassword,
    InvalidVaultKey,
    InvalidRecoveryKey,
};

pub const VaultSummary = struct {
    id: []const u8,
    name: []const u8,
    item_count: usize = 0,
};

pub const OpenedItem = struct {
    id: []const u8,
    vault_id: []const u8,
    created_at: []const u8,
    updated_at: []const u8,
    content: format.ItemContent,
};

pub const OpenedVault = struct {
    file: *const format.VaultFile,
    master_key: crypto.Key,
    recovery_key: ?crypto.Key = null,
    vaults: []VaultSummary,
    items: []OpenedItem,
    warnings: [][]const u8,
    vault_keys: std.StringHashMap(crypto.Key),

    pub fn deinit(self: *OpenedVault, allocator: std.mem.Allocator) void {
        crypto.wipeKey(&self.master_key);
        if (self.recovery_key) |*key| crypto.wipeKey(key);
        var values = self.vault_keys.valueIterator();
        while (values.next()) |key| crypto.wipeKey(key);
        self.vault_keys.deinit();

        for (self.warnings) |warning| {
            wipeString(warning);
            allocator.free(warning);
        }
        for (self.vaults) |record| {
            wipeString(record.name);
            allocator.free(record.name);
        }
        for (self.items) |*item| wipeContent(&item.content);
        allocator.free(self.warnings);
        allocator.free(self.vaults);
        allocator.free(self.items);
    }

    pub fn vaultKey(self: *const OpenedVault, vault_id: []const u8) ?crypto.Key {
        return self.vault_keys.get(vault_id);
    }

    pub fn activeItemCount(self: *const OpenedVault) usize {
        var count: usize = 0;
        for (self.items) |item| {
            if (item.content.deletedAt == null) count += 1;
        }
        return count;
    }
};

pub fn open(
    allocator: std.mem.Allocator,
    file: *const format.VaultFile,
    password: []const u8,
    io: std.Io,
) !OpenedVault {
    const salt = crypto.base64Decode(allocator, file.kdf.salt) catch return format.Error.InvalidKdf;
    defer allocator.free(salt);

    var master_key = try crypto.deriveMasterKey(
        allocator,
        password,
        salt,
        file.kdf.memoryKiB,
        file.kdf.iterations,
        file.kdf.parallelism,
        file.kdf.keyLength,
        io,
    );
    errdefer crypto.wipeKey(&master_key);

    return openWithMasterKey(allocator, file, master_key);
}

/// Ouvre un fichier avec une clé maîtresse déjà dérivée. La clé est copiée
/// dans `OpenedVault`, qui l’efface à son `deinit` ; l’appelant reste
/// propriétaire de la sienne et doit l’effacer de son côté.
pub fn openWithMasterKey(
    allocator: std.mem.Allocator,
    file: *const format.VaultFile,
    master_key: crypto.Key,
) !OpenedVault {
    var warnings: std.ArrayList([]const u8) = .empty;
    errdefer {
        for (warnings.items) |warning| allocator.free(warning);
        warnings.deinit(allocator);
    }

    var vaults: std.ArrayList(VaultSummary) = .empty;
    errdefer vaults.deinit(allocator);

    var vault_keys: std.StringHashMap(crypto.Key) = .init(allocator);
    errdefer {
        var values = vault_keys.valueIterator();
        while (values.next()) |key| crypto.wipeKey(key);
        vault_keys.deinit();
    }

    for (file.vaults) |record| {
        const aad = try vaultKeyAad(allocator, record.id);
        defer allocator.free(aad);

        const raw_key = crypto.open(allocator, record.key, master_key, aad) catch {
            try warnings.append(allocator, try allocator.dupe(u8, "Un coffre n’a pas pu être déverrouillé."));
            continue;
        };
        defer {
            crypto.wipe(raw_key);
            allocator.free(raw_key);
        }
        if (raw_key.len != crypto.KEY_BYTES) {
            try warnings.append(allocator, try allocator.dupe(u8, "Un coffre n’a pas pu être déverrouillé."));
            continue;
        }

        var vault_key: crypto.Key = undefined;
        @memcpy(&vault_key, raw_key);
        try vault_keys.putNoClobber(record.id, vault_key);

        const meta_aad = try vaultMetaAad(allocator, record.id);
        defer allocator.free(meta_aad);

        var name: []const u8 = try allocator.dupe(u8, "Coffre sans nom");
        const raw_meta = crypto.open(allocator, record.name, vault_key, meta_aad) catch {
            try warnings.append(allocator, try allocator.dupe(u8, "Le nom d’un coffre n’a pas pu être déchiffré."));
            try vaults.append(allocator, .{ .id = record.id, .name = name });
            continue;
        };
        defer {
            crypto.wipe(raw_meta);
            allocator.free(raw_meta);
        }

        const Meta = struct { name: []const u8 = "" };
        var meta = std.json.parseFromSlice(Meta, allocator, raw_meta, .{ .ignore_unknown_fields = true }) catch {
            try vaults.append(allocator, .{ .id = record.id, .name = name });
            continue;
        };
        defer meta.deinit();
        if (std.mem.trim(u8, meta.value.name, " \t\r\n").len > 0) {
            const decoded = try allocator.dupe(u8, meta.value.name);
            allocator.free(name);
            name = decoded;
        }

        try vaults.append(allocator, .{ .id = record.id, .name = name });
    }

    if (vaults.items.len == 0) return Error.WrongPassword;

    // La clé de récupération est conservée pour maintenir l’enveloppe.
    var recovery_key: ?crypto.Key = null;
    if (file.recovery) |recovery| {
        if (crypto.open(allocator, recovery.guard, master_key, "coffre:v1:recovery-guard")) |raw| {
            defer {
                crypto.wipe(raw);
                allocator.free(raw);
            }
            if (raw.len == crypto.KEY_BYTES) {
                var key: crypto.Key = undefined;
                @memcpy(&key, raw);
                recovery_key = key;
            } else {
                try warnings.append(allocator, try allocator.dupe(u8, "La clé de récupération n’a pas pu être maintenue ; régénérez la phrase depuis les réglages."));
            }
        } else |_| {
            try warnings.append(allocator, try allocator.dupe(u8, "La clé de récupération n’a pas pu être maintenue ; régénérez la phrase depuis les réglages."));
        }
    }

    var items: std.ArrayList(OpenedItem) = .empty;
    errdefer items.deinit(allocator);

    for (file.items) |record| {
        const vault_key = vault_keys.get(record.vaultId) orelse {
            try warnings.append(allocator, try allocator.dupe(u8, "Un élément appartient à un coffre inaccessible."));
            continue;
        };

        const key_aad = try itemKeyAad(allocator, record.vaultId, record.id);
        defer allocator.free(key_aad);
        const raw_item_key = crypto.open(allocator, record.key, vault_key, key_aad) catch {
            try warnings.append(allocator, try allocator.dupe(u8, "Un élément n’a pas pu être déchiffré et a été ignoré."));
            continue;
        };
        defer {
            crypto.wipe(raw_item_key);
            allocator.free(raw_item_key);
        }
        if (raw_item_key.len != crypto.KEY_BYTES) {
            try warnings.append(allocator, try allocator.dupe(u8, "Un élément n’a pas pu être déchiffré et a été ignoré."));
            continue;
        }
        var item_key: crypto.Key = undefined;
        @memcpy(&item_key, raw_item_key);
        defer crypto.wipeKey(&item_key);

        const content_aad = try itemContentAad(allocator, record.vaultId, record.id);
        defer allocator.free(content_aad);
        const raw_content = crypto.open(allocator, record.content, item_key, content_aad) catch {
            try warnings.append(allocator, try allocator.dupe(u8, "Un élément n’a pas pu être déchiffré et a été ignoré."));
            continue;
        };
        defer {
            crypto.wipe(raw_content);
            allocator.free(raw_content);
        }

        const content = std.json.parseFromSliceLeaky(
            format.ItemContent,
            allocator,
            raw_content,
            .{ .ignore_unknown_fields = true, .allocate = .alloc_always },
        ) catch {
            try warnings.append(allocator, try allocator.dupe(u8, "Un élément n’a pas pu être déchiffré et a été ignoré."));
            continue;
        };

        try items.append(allocator, .{
            .id = record.id,
            .vault_id = record.vaultId,
            .created_at = record.createdAt,
            .updated_at = record.updatedAt,
            .content = content,
        });
    }

    // Compte les éléments actifs par coffre.
    for (vaults.items) |*vault| {
        for (items.items) |item| {
            if (std.mem.eql(u8, item.vault_id, vault.id) and item.content.deletedAt == null) {
                vault.item_count += 1;
            }
        }
    }

    return .{
        .file = file,
        .master_key = master_key,
        .recovery_key = recovery_key,
        .vaults = try vaults.toOwnedSlice(allocator),
        .items = try items.toOwnedSlice(allocator),
        .warnings = try warnings.toOwnedSlice(allocator),
        .vault_keys = vault_keys,
    };
}

fn wipeString(value: []const u8) void {
    if (value.len > 0) crypto.wipe(@constCast(value));
}

fn wipeOptional(value: ?[]const u8) void {
    if (value) |text| wipeString(text);
}

fn wipeList(values: ?[]const []const u8) void {
    if (values) |list| {
        for (list) |value| wipeString(value);
    }
}

/// Efface les chaînes déchiffrées d’un élément avant que l’arène ne soit
/// libérée : le contenu ne doit pas rester lisible dans la mémoire du
/// processus après un verrouillage.
fn wipeContent(content: *const format.ItemContent) void {
    wipeString(content.title);
    wipeString(content.notes);
    wipeOptional(content.username);
    wipeOptional(content.password);
    wipeOptional(content.totp);
    wipeList(content.urls);

    wipeOptional(content.cardholder);
    wipeOptional(content.number);
    wipeOptional(content.expiry);
    wipeOptional(content.cvc);
    wipeOptional(content.pin);
    wipeOptional(content.brand);

    wipeOptional(content.firstName);
    wipeOptional(content.lastName);
    wipeOptional(content.email);
    wipeOptional(content.phone);
    wipeOptional(content.address);
    wipeOptional(content.city);
    wipeOptional(content.postalCode);
    wipeOptional(content.country);
    wipeOptional(content.birthDate);

    for (content.customFields) |field| {
        wipeString(field.label);
        wipeString(field.value);
    }
    for (content.tags) |tag| wipeString(tag);
    for (content.attachments) |attachment| {
        wipeString(attachment.name);
        wipeString(attachment.mime);
    }
}

pub fn vaultKeyAad(allocator: std.mem.Allocator, vault_id: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "coffre:v1:vault-key:{s}", .{vault_id});
}

pub fn vaultMetaAad(allocator: std.mem.Allocator, vault_id: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "coffre:v1:vault-meta:{s}", .{vault_id});
}

pub fn itemKeyAad(allocator: std.mem.Allocator, vault_id: []const u8, item_id: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "coffre:v1:item-key:{s}:{s}", .{ vault_id, item_id });
}

pub fn itemContentAad(allocator: std.mem.Allocator, vault_id: []const u8, item_id: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "coffre:v1:item-content:{s}:{s}", .{ vault_id, item_id });
}
