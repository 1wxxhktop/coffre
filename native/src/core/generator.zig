//! Générateur de mots de passe et de phrases de passe.
//!
//! Tirage uniforme par rejet (pas de biais modulo) et garantie qu’au moins un
//! caractère de chaque classe sélectionnée est présent. La liste de mots est
//! la liste EFF « large wordlist » (7 776 mots), également utilisée par
//! l’application web et Proton Pass.

const std = @import("std");

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/";
const AMBIGUOUS = "O0oIl1|`'\"";

const wordlist = @embedFile("eff_large_wordlist.txt");

pub const Error = error{
    NoCharacterClass,
    InvalidLength,
};

pub const PasswordOptions = struct {
    length: u8 = 20,
    lowercase: bool = true,
    uppercase: bool = true,
    digits: bool = true,
    symbols: bool = true,
    exclude_ambiguous: bool = true,
};

pub const PassphraseOptions = struct {
    words: u8 = 5,
    separator: []const u8 = "-",
    capitalize: bool = true,
    include_number: bool = true,
};

/// Génère un mot de passe et renvoie une copie allouée.
pub fn password(
    allocator: std.mem.Allocator,
    options: PasswordOptions,
    io: std.Io,
) ![]u8 {
    const length = @min(@max(options.length, 4), 128);

    var sets: [4][]const u8 = undefined;
    var set_count: usize = 0;
    if (options.lowercase) {
        sets[set_count] = filterAmbiguous(LOWERCASE, options.exclude_ambiguous);
        set_count += 1;
    }
    if (options.uppercase) {
        sets[set_count] = filterAmbiguous(UPPERCASE, options.exclude_ambiguous);
        set_count += 1;
    }
    if (options.digits) {
        sets[set_count] = filterAmbiguous(DIGITS, options.exclude_ambiguous);
        set_count += 1;
    }
    if (options.symbols) {
        sets[set_count] = filterAmbiguous(SYMBOLS, options.exclude_ambiguous);
        set_count += 1;
    }

    var pool: [128]u8 = undefined;
    var pool_len: usize = 0;
    for (sets[0..set_count]) |set| {
        @memcpy(pool[pool_len..][0..set.len], set);
        pool_len += set.len;
    }
    if (pool_len == 0) return Error.NoCharacterClass;

    var result: std.ArrayList(u8) = .empty;
    defer result.deinit(allocator);
    try result.ensureTotalCapacity(allocator, length);

    // Un caractère de chaque classe, pour garantir la composition annoncée.
    for (sets[0..set_count]) |set| {
        if (result.items.len >= length) break;
        if (set.len == 0) continue;
        try result.append(allocator, try pick(io, set));
    }
    while (result.items.len < length) {
        try result.append(allocator, try pick(io, pool[0..pool_len]));
    }

    try shuffle(io, result.items);
    return result.toOwnedSlice(allocator);
}

/// Génère une phrase de passe à partir de la liste EFF.
pub fn passphrase(
    allocator: std.mem.Allocator,
    options: PassphraseOptions,
    io: std.Io,
) ![]u8 {
    const count = @min(@max(options.words, 3), 12);
    const separator = if (options.separator.len == 0)
        "-"
    else
        options.separator[0..@min(options.separator.len, 3)];

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);

    for (0..count) |index| {
        if (index > 0) try out.appendSlice(allocator, separator);
        const word = wordAt(try randomInt(io, @intCast(wordCount())));
        if (options.capitalize and word.len > 0) {
            try out.append(allocator, std.ascii.toUpper(word[0]));
            try out.appendSlice(allocator, word[1..]);
        } else {
            try out.appendSlice(allocator, word);
        }
    }

    if (options.include_number) {
        const number = try randomInt(io, 100);
        try out.append(allocator, '0' + @as(u8, @intCast(number / 10)));
        try out.append(allocator, '0' + @as(u8, @intCast(number % 10)));
    }

    return out.toOwnedSlice(allocator);
}

/// Entropie approximative d’un mot de passe, en bits.
pub fn passwordEntropy(options: PasswordOptions) f32 {
    var pool: usize = 0;
    if (options.lowercase) pool += filterAmbiguous(LOWERCASE, options.exclude_ambiguous).len;
    if (options.uppercase) pool += filterAmbiguous(UPPERCASE, options.exclude_ambiguous).len;
    if (options.digits) pool += filterAmbiguous(DIGITS, options.exclude_ambiguous).len;
    if (options.symbols) pool += filterAmbiguous(SYMBOLS, options.exclude_ambiguous).len;
    if (pool == 0) return 0;
    return @as(f32, @floatFromInt(@min(@max(options.length, 4), 128))) *
        @log2(@as(f32, @floatFromInt(pool)));
}

/// Entropie approximative d’une phrase de passe, en bits.
pub fn passphraseEntropy(options: PassphraseOptions) f32 {
    const count = @min(@max(options.words, 3), 12);
    const words_bits = @as(f32, @floatFromInt(count)) *
        @log2(@as(f32, @floatFromInt(wordCount())));
    const bonus: f32 = if (options.include_number) 6.6 else 0;
    return words_bits + bonus;
}

// ------------------------------------------------------------------ outils

fn filterAmbiguous(chars: []const u8, enabled: bool) []const u8 {
    if (!enabled) return chars;
    if (std.mem.eql(u8, chars, LOWERCASE)) return "abcdefghijkmnpqrstuvwxyz";
    if (std.mem.eql(u8, chars, UPPERCASE)) return "ABCDEFGHJKLMNPQRSTUVWXYZ";
    if (std.mem.eql(u8, chars, DIGITS)) return "23456789";
    // La classe des symboles ne contient aucun caractère ambigu.
    return chars;
}

fn randomInt(io: std.Io, max: u32) !u32 {
    if (max == 0) return Error.InvalidLength;
    const limit: u64 = (@as(u64, 1) << 32) / max * max;
    var buffer: [4]u8 = undefined;
    while (true) {
        std.Io.random(io, &buffer);
        const value = std.mem.readInt(u32, &buffer, .little);
        if (value < limit) return value % max;
    }
}

fn pick(io: std.Io, set: []const u8) !u8 {
    return set[try randomInt(io, @intCast(set.len))];
}

fn shuffle(io: std.Io, items: []u8) !void {
    var index = items.len;
    while (index > 1) {
        index -= 1;
        const other = try randomInt(io, @intCast(index + 1));
        const swap = items[index];
        items[index] = items[other];
        items[other] = swap;
    }
}

fn wordCount() usize {
    var count: usize = 0;
    var it = std.mem.splitScalar(u8, wordlist, '\n');
    while (it.next()) |line| {
        if (std.mem.trim(u8, line, " \t\r").len > 0) count += 1;
    }
    return count;
}

fn wordAt(index: usize) []const u8 {
    var current: usize = 0;
    var it = std.mem.splitScalar(u8, wordlist, '\n');
    while (it.next()) |line| {
        const trimmed = std.mem.trim(u8, line, " \t\r");
        if (trimmed.len == 0) continue;
        if (current == index) {
            const space = std.mem.indexOfAny(u8, trimmed, " \t") orelse return trimmed;
            return trimmed[space + 1 ..];
        }
        current += 1;
    }
    return "";
}

// ------------------------------------------------------------------ tests

const testing = std.testing;

test "un mot de passe respecte la longueur et les classes demandées" {
    const options: PasswordOptions = .{
        .length = 24,
        .lowercase = true,
        .uppercase = true,
        .digits = true,
        .symbols = true,
        .exclude_ambiguous = true,
    };
    const value = try password(testing.allocator, options, testing.io);
    defer testing.allocator.free(value);

    try testing.expectEqual(@as(usize, 24), value.len);
    var has_lower = false;
    var has_upper = false;
    var has_digit = false;
    var has_symbol = false;
    for (value) |ch| {
        if (std.ascii.isLower(ch)) has_lower = true;
        if (std.ascii.isUpper(ch)) has_upper = true;
        if (std.ascii.isDigit(ch)) has_digit = true;
        if (std.mem.indexOfScalar(u8, SYMBOLS, ch) != null) has_symbol = true;
        try testing.expect(std.mem.indexOfScalar(u8, AMBIGUOUS, ch) == null);
    }
    try testing.expect(has_lower and has_upper and has_digit and has_symbol);
}

test "le générateur refuse une sélection vide" {
    try testing.expectError(
        Error.NoCharacterClass,
        password(testing.allocator, .{
            .lowercase = false,
            .uppercase = false,
            .digits = false,
            .symbols = false,
        }, testing.io),
    );
}

test "une phrase de passe suit les options" {
    const value = try passphrase(testing.allocator, .{
        .words = 4,
        .separator = "-",
        .capitalize = true,
        .include_number = true,
    }, testing.io);
    defer testing.allocator.free(value);

    var parts = std.mem.splitScalar(u8, value, '-');
    var count: usize = 0;
    var last: []const u8 = "";
    while (parts.next()) |part| {
        count += 1;
        last = part;
        try testing.expect(part.len > 0);
        try testing.expect(std.ascii.isUpper(part[0]));
    }
    try testing.expectEqual(@as(usize, 4), count);
    try testing.expect(std.ascii.isDigit(last[last.len - 1]));
}

test "les entropies sont plausibles" {
    try testing.expect(passwordEntropy(.{ .length = 20 }) > 100);
    try testing.expect(passphraseEntropy(.{ .words = 5 }) > 60);
    try testing.expectEqual(@as(f32, 0), passwordEntropy(.{
        .lowercase = false,
        .uppercase = false,
        .digits = false,
        .symbols = false,
    }));
}
