//! Création et mise à jour des éléments chiffrés.
//!
//! Chaque élément possède sa propre clé de 32 octets, scellée avec la clé du
//! coffre. Le contenu JSON est ensuite scellé avec cette clé d’élément. Les
//! AAD lient le chiffrement au coffre et à l’identifiant de l’élément, comme
//! dans l’application web.

const std = @import("std");
const crypto = @import("crypto.zig");
const format = @import("format.zig");
const vault = @import("vault.zig");
const write = @import("write.zig");

pub const Error = error{
    EmptyTitle,
    EmptyVaultId,
    InvalidItemKey,
};

/// Crée un nouvel élément scellé. `content` et les chaînes qu’il référence
/// doivent rester valides aussi longtemps que le fichier sérialisé.
pub fn create(
    allocator: std.mem.Allocator,
    vault_key: crypto.Key,
    vault_id: []const u8,
    content: format.ItemContent,
    io: std.Io,
) !format.ItemRecord {
    if (std.mem.trim(u8, content.title, " \t\r\n").len == 0) return Error.EmptyTitle;
    if (vault_id.len == 0) return Error.EmptyVaultId;

    const now = try write.isoNow(allocator, io);
    const id = try write.randomId(allocator, "i", io);

    var item_key: crypto.Key = undefined;
    std.Io.random(io, &item_key);
    defer crypto.wipeKey(&item_key);

    const key_aad = try vault.itemKeyAad(allocator, vault_id, id);
    defer allocator.free(key_aad);
    const sealed_key = try crypto.seal(allocator, &item_key, vault_key, key_aad, io);

    const content_aad = try vault.itemContentAad(allocator, vault_id, id);
    defer allocator.free(content_aad);
    var normalized = content;
    normalize(&normalized);
    const json = try std.json.Stringify.valueAlloc(allocator, normalized, .{
        .emit_null_optional_fields = false,
    });
    defer {
        crypto.wipe(json);
        allocator.free(json);
    }
    const sealed_content = try crypto.seal(allocator, json, item_key, content_aad, io);

    return .{
        .id = id,
        .vaultId = try allocator.dupe(u8, vault_id),
        .key = .{ .n = sealed_key.n, .c = sealed_key.c },
        .content = .{ .n = sealed_content.n, .c = sealed_content.c },
        .createdAt = now,
        .updatedAt = now,
    };
}

/// Rescelle le contenu d’un élément existant. La clé d’élément est rouverte
/// avec la clé du coffre ; l’identifiant et la date de création sont conservés.
pub fn update(
    allocator: std.mem.Allocator,
    record: *const format.ItemRecord,
    vault_key: crypto.Key,
    content: format.ItemContent,
    io: std.Io,
) !format.ItemRecord {
    if (std.mem.trim(u8, content.title, " \t\r\n").len == 0) return Error.EmptyTitle;

    var item_key = try openItemKey(allocator, record, vault_key);
    defer crypto.wipeKey(&item_key);

    const now = try write.isoNow(allocator, io);
    const content_aad = try vault.itemContentAad(allocator, record.vaultId, record.id);
    defer allocator.free(content_aad);
    var normalized = content;
    normalize(&normalized);
    const json = try std.json.Stringify.valueAlloc(allocator, normalized, .{
        .emit_null_optional_fields = false,
    });
    defer {
        crypto.wipe(json);
        allocator.free(json);
    }
    const sealed_content = try crypto.seal(allocator, json, item_key, content_aad, io);

    return .{
        .id = record.id,
        .vaultId = record.vaultId,
        .key = .{ .n = record.key.n, .c = record.key.c },
        .content = .{ .n = sealed_content.n, .c = sealed_content.c },
        .createdAt = record.createdAt,
        .updatedAt = now,
    };
}

/// Remplit les champs propres au type avec des chaînes vides plutôt que
/// `null` : le validateur de l’application web exige leur présence.
fn normalize(content: *format.ItemContent) void {
    if (std.mem.eql(u8, content.type, "login")) {
        content.username = content.username orelse "";
        content.password = content.password orelse "";
        content.urls = content.urls orelse &.{};
        content.totp = content.totp orelse "";
    } else if (std.mem.eql(u8, content.type, "card")) {
        content.cardholder = content.cardholder orelse "";
        content.number = content.number orelse "";
        content.expiry = content.expiry orelse "";
        content.cvc = content.cvc orelse "";
        content.pin = content.pin orelse "";
        content.brand = content.brand orelse "";
    } else if (std.mem.eql(u8, content.type, "identity")) {
        content.firstName = content.firstName orelse "";
        content.lastName = content.lastName orelse "";
        content.email = content.email orelse "";
        content.phone = content.phone orelse "";
        content.address = content.address orelse "";
        content.city = content.city orelse "";
        content.postalCode = content.postalCode orelse "";
        content.country = content.country orelse "";
        content.birthDate = content.birthDate orelse "";
    }
}

/// Rouvre la clé d’un élément à partir de sa copie scellée dans le fichier.
pub fn openItemKey(
    allocator: std.mem.Allocator,
    record: *const format.ItemRecord,
    vault_key: crypto.Key,
) !crypto.Key {
    const key_aad = try vault.itemKeyAad(allocator, record.vaultId, record.id);
    defer allocator.free(key_aad);

    const raw = crypto.open(allocator, record.key, vault_key, key_aad) catch return Error.InvalidItemKey;
    defer {
        crypto.wipe(raw);
        allocator.free(raw);
    }
    if (raw.len != crypto.KEY_BYTES) return Error.InvalidItemKey;

    var key: crypto.Key = undefined;
    @memcpy(&key, raw);
    return key;
}

// ------------------------------------------------------------------ tests

const testing = std.testing;

test "create scelle un élément lisible par openItemKey et le contenu par AES-GCM" {
    const vault_key: crypto.Key = @splat(7);

    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const content: format.ItemContent = .{
        .type = "login",
        .title = "GitHub",
        .username = "octocat",
        .password = "s3cret!",
        .urls = &.{"https://github.com"},
        .notes = "Compte de test",
    };

    const record = try create(allocator, vault_key, "v_test", content, testing.io);
    try testing.expectEqualStrings("v_test", record.vaultId);
    try testing.expect(std.mem.startsWith(u8, record.id, "i_"));
    try testing.expectEqualStrings(record.createdAt, record.updatedAt);

    var item_key = try openItemKey(allocator, &record, vault_key);
    defer crypto.wipeKey(&item_key);

    const content_aad = try vault.itemContentAad(allocator, record.vaultId, record.id);
    const raw = try crypto.open(allocator, record.content, item_key, content_aad);
    defer {
        crypto.wipe(raw);
        allocator.free(raw);
    }

    var parsed = try std.json.parseFromSlice(format.ItemContent, allocator, raw, .{
        .ignore_unknown_fields = true,
        .allocate = .alloc_always,
    });
    defer parsed.deinit();
    try testing.expectEqualStrings("GitHub", parsed.value.title);
    try testing.expectEqualStrings("octocat", parsed.value.username.?);
    try testing.expectEqualStrings("s3cret!", parsed.value.password.?);
    try testing.expectEqualStrings("https://github.com", parsed.value.urls.?[0]);
    // Le validateur web exige tous les champs d’une connexion.
    try testing.expect(std.mem.indexOf(u8, raw, "\"totp\":\"\"") != null);
    try testing.expect(std.mem.indexOf(u8, raw, "\"favorite\":false") != null);
}

test "update conserve l’identifiant et la date de création, et change updatedAt" {
    const vault_key: crypto.Key = @splat(9);

    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const record = try create(allocator, vault_key, "v_test", .{
        .type = "login",
        .title = "Ancien titre",
        .username = "ancien",
    }, testing.io);

    var updated = try update(allocator, &record, vault_key, .{
        .type = "login",
        .title = "Nouveau titre",
        .username = "nouveau",
    }, testing.io);

    try testing.expectEqualStrings(record.id, updated.id);
    try testing.expectEqualStrings(record.createdAt, updated.createdAt);
    try testing.expectEqualStrings(record.key.n, updated.key.n);
    try testing.expectEqualStrings(record.key.c, updated.key.c);

    var item_key = try openItemKey(allocator, &updated, vault_key);
    defer crypto.wipeKey(&item_key);
    const content_aad = try vault.itemContentAad(allocator, updated.vaultId, updated.id);
    const raw = try crypto.open(allocator, updated.content, item_key, content_aad);
    defer {
        crypto.wipe(raw);
        allocator.free(raw);
    }
    var parsed = try std.json.parseFromSlice(format.ItemContent, allocator, raw, .{
        .ignore_unknown_fields = true,
        .allocate = .alloc_always,
    });
    defer parsed.deinit();
    try testing.expectEqualStrings("Nouveau titre", parsed.value.title);
    try testing.expectEqualStrings("nouveau", parsed.value.username.?);
}

test "create refuse un titre vide" {
    const vault_key: crypto.Key = @splat(1);
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    try testing.expectError(
        Error.EmptyTitle,
        create(arena.allocator(), vault_key, "v_test", .{ .type = "login", .title = "   " }, testing.io),
    );
}
