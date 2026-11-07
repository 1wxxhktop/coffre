const std = @import("std");
const crypto = @import("crypto.zig");
const format = @import("format.zig");
const vault = @import("vault.zig");
const write = @import("write.zig");
const items = @import("items.zig");
const importer = @import("import.zig");
const generator = @import("generator.zig");
const totp = @import("totp.zig");
const recovery = @import("recovery.zig");

const PASSWORD = "phrase de passe de test solide";

const v1 = @embedFile("fixtures/v1.coffre.json");
const v2 = @embedFile("fixtures/v2.coffre.json");
const v3 = @embedFile("fixtures/v3.coffre.json");

fn openFixture(allocator: std.mem.Allocator, text: []const u8) !std.json.Parsed(format.VaultFile) {
    return format.parse(allocator, text);
}

test "lit un fichier v1, le migre en v3 et le déverrouille" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var parsed = try openFixture(allocator, v1);
    defer parsed.deinit();
    try std.testing.expectEqual(@as(u8, 3), parsed.value.version);
    try std.testing.expectEqual(@as(usize, 2), parsed.value.items.len);

    var opened = try vault.open(allocator, &parsed.value, PASSWORD, std.testing.io);
    defer opened.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), opened.vaults.len);
    try std.testing.expectEqualStrings("Ancien format", opened.vaults[0].name);
    try std.testing.expectEqual(@as(usize, 2), opened.vaults[0].item_count);
    try std.testing.expectEqual(@as(usize, 2), opened.items.len);

    var found_github = false;
    for (opened.items) |item| {
        if (std.mem.eql(u8, item.content.title, "GitHub")) {
            found_github = true;
            try std.testing.expectEqualStrings("s3cret!", item.content.password.?);
            try std.testing.expectEqualStrings("https://github.com", item.content.urls.?[0]);
        }
    }
    try std.testing.expect(found_github);
}

test "lit un fichier v2 avec historique et corbeille" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var parsed = try openFixture(allocator, v2);
    defer parsed.deinit();
    try std.testing.expectEqual(@as(usize, 2), parsed.value.versions.len);

    var opened = try vault.open(allocator, &parsed.value, PASSWORD, std.testing.io);
    defer opened.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), opened.vaults[0].item_count);
    try std.testing.expectEqual(@as(usize, 2), opened.items.len);

    var found_active = false;
    var found_trashed = false;
    for (opened.items) |item| {
        if (std.mem.eql(u8, item.content.title, "GitHub")) {
            found_active = true;
            try std.testing.expectEqualStrings("s3cret-v3!", item.content.password.?);
            try std.testing.expect(item.content.deletedAt == null);
        }
        if (std.mem.eql(u8, item.content.title, "Ancien compte")) {
            found_trashed = true;
            try std.testing.expect(item.content.deletedAt != null);
        }
    }
    try std.testing.expect(found_active and found_trashed);
}

test "lit un fichier v3 et sa clé de récupération" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var parsed = try openFixture(allocator, v3);
    defer parsed.deinit();
    try std.testing.expect(parsed.value.recovery != null);

    var opened = try vault.open(allocator, &parsed.value, PASSWORD, std.testing.io);
    defer opened.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), opened.items.len);
    try std.testing.expect(opened.recovery_key != null);
    try std.testing.expectEqualStrings("s3cret!", opened.items[0].content.password.?);
}

test "refuse un mauvais mot de passe" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var parsed = try openFixture(allocator, v1);
    defer parsed.deinit();

    try std.testing.expectError(
        vault.Error.WrongPassword,
        vault.open(allocator, &parsed.value, "mauvais mot de passe", std.testing.io),
    );
}

test "sérialise puis relit un fichier" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var parsed = try openFixture(allocator, v3);
    defer parsed.deinit();

    const text = try format.serialize(allocator, &parsed.value);
    defer allocator.free(text);

    var reparsed = try format.parse(allocator, text);
    defer reparsed.deinit();

    var opened = try vault.open(allocator, &reparsed.value, PASSWORD, std.testing.io);
    defer opened.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 1), opened.items.len);
}

test "les chaînes du fichier survivent à la libération du texte source" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Le fichier est lu dans un tampon temporaire, puis effacé : le parse
    // doit avoir copié tout ce qui est conservé.
    const input = try std.testing.allocator.dupe(u8, v3);
    defer std.testing.allocator.free(input);

    var parsed = try format.parse(allocator, input);
    defer parsed.deinit();
    @memset(input, 0);

    var opened = try vault.open(allocator, &parsed.value, PASSWORD, std.testing.io);
    defer opened.deinit(allocator);

    try std.testing.expectEqualStrings("GitHub", opened.items[0].content.title);
    try std.testing.expectEqualStrings("s3cret!", opened.items[0].content.password.?);
}

test {
    std.testing.refAllDecls(crypto);
    std.testing.refAllDecls(write);
    std.testing.refAllDecls(items);
    std.testing.refAllDecls(importer);
    std.testing.refAllDecls(generator);
    std.testing.refAllDecls(totp);
    std.testing.refAllDecls(recovery);
}
