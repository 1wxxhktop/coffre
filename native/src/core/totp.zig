//! Codes TOTP (RFC 6238), compatibles avec les URI `otpauth://`.
//!
//! Le secret est décodé depuis le base32 de l’URI, puis utilisé pour un HMAC
//! SHA-1, SHA-256 ou SHA-512. Aucun secret ne quitte la mémoire du processus.

const std = @import("std");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub const Algorithm = enum { sha1, sha256, sha512 };

pub const Config = struct {
    secret: []const u8,
    digits: u8 = 6,
    period: u32 = 30,
    algorithm: Algorithm = .sha1,
};

pub const Code = struct {
    buf: [8]u8 = undefined,
    len: u8 = 6,

    pub fn slice(self: *const Code) []const u8 {
        return self.buf[8 - self.len ..];
    }
};

pub const Error = error{
    InvalidUri,
    MissingSecret,
    InvalidBase32,
    SecretTooLong,
};

/// Analyse une URI `otpauth://totp/...` et écrit le secret décodé dans
/// `secret_buf`. Les champs `issuer` et `account` ne sont pas conservés : ils
/// ne servent qu’à l’affichage, que l’application gère déjà.
pub fn parseUri(uri: []const u8, secret_buf: []u8) !Config {
    const trimmed = std.mem.trim(u8, uri, " \t\r\n");
    if (trimmed.len == 0) return Error.InvalidUri;

    const prefix = "otpauth://";
    if (!startsWithIgnoreCase(trimmed, prefix)) return Error.InvalidUri;

    var rest = trimmed[prefix.len..];
    const host_end = std.mem.indexOfAny(u8, rest, "/?") orelse rest.len;
    if (!std.ascii.eqlIgnoreCase(rest[0..host_end], "totp")) return Error.InvalidUri;
    rest = rest[host_end..];
    if (rest.len > 0 and rest[0] == '/') rest = rest[1..];

    const query_start = std.mem.indexOfScalar(u8, rest, '?') orelse return Error.MissingSecret;
    const query = rest[query_start + 1 ..];

    var secret_raw: []const u8 = "";
    var digits: u8 = 6;
    var period: u32 = 30;
    var algorithm: Algorithm = .sha1;

    var params = std.mem.splitScalar(u8, query, '&');
    while (params.next()) |pair| {
        if (pair.len == 0) continue;
        const equals = std.mem.indexOfScalar(u8, pair, '=') orelse continue;
        const key = pair[0..equals];
        const value = pair[equals + 1 ..];
        if (std.ascii.eqlIgnoreCase(key, "secret")) {
            secret_raw = value;
        } else if (std.ascii.eqlIgnoreCase(key, "digits")) {
            digits = std.fmt.parseInt(u8, value, 10) catch 6;
            if (digits < 6 or digits > 8) digits = 6;
        } else if (std.ascii.eqlIgnoreCase(key, "period")) {
            period = std.fmt.parseInt(u32, value, 10) catch 30;
            if (period < 10 or period > 120) period = 30;
        } else if (std.ascii.eqlIgnoreCase(key, "algorithm")) {
            if (std.ascii.eqlIgnoreCase(value, "SHA256")) {
                algorithm = .sha256;
            } else if (std.ascii.eqlIgnoreCase(value, "SHA512")) {
                algorithm = .sha512;
            } else {
                algorithm = .sha1;
            }
        }
    }

    if (secret_raw.len == 0) return Error.MissingSecret;
    const secret = try decodeBase32(secret_raw, secret_buf);
    return .{
        .secret = secret,
        .digits = digits,
        .period = period,
        .algorithm = algorithm,
    };
}

/// Calcule le code pour un horodatage en millisecondes depuis l’époque Unix.
pub fn compute(config: Config, timestamp_ms: i64) !Code {
    if (config.digits < 6 or config.digits > 8) return Error.InvalidUri;
    if (config.period == 0) return Error.InvalidUri;

    const seconds: u64 = if (timestamp_ms <= 0)
        0
    else
        @intCast(@divFloor(timestamp_ms, 1000));
    const counter = seconds / config.period;

    var message: [8]u8 = undefined;
    std.mem.writeInt(u64, &message, counter, .big);

    var signature: [64]u8 = undefined;
    const signature_len: usize = switch (config.algorithm) {
        .sha1 => blk: {
            var mac: [20]u8 = undefined;
            std.crypto.auth.hmac.HmacSha1.create(&mac, &message, config.secret);
            @memcpy(signature[0..20], &mac);
            std.crypto.secureZero(u8, &mac);
            break :blk 20;
        },
        .sha256 => blk: {
            var mac: [32]u8 = undefined;
            std.crypto.auth.hmac.sha2.HmacSha256.create(&mac, &message, config.secret);
            @memcpy(signature[0..32], &mac);
            std.crypto.secureZero(u8, &mac);
            break :blk 32;
        },
        .sha512 => blk: {
            var mac: [64]u8 = undefined;
            std.crypto.auth.hmac.sha2.HmacSha512.create(&mac, &message, config.secret);
            @memcpy(signature[0..64], &mac);
            std.crypto.secureZero(u8, &mac);
            break :blk 64;
        },
    };
    defer std.crypto.secureZero(u8, signature[0..signature_len]);

    const offset = signature[signature_len - 1] & 0x0f;
    const binary = (@as(u32, signature[offset] & 0x7f) << 24) |
        (@as(u32, signature[offset + 1]) << 16) |
        (@as(u32, signature[offset + 2]) << 8) |
        @as(u32, signature[offset + 3]);

    var modulus: u32 = 1;
    for (0..config.digits) |_| modulus *= 10;

    var value = binary % modulus;
    var code = Code{ .len = config.digits };
    @memset(&code.buf, '0');
    var index: usize = 8;
    while (value > 0) {
        index -= 1;
        code.buf[index] = '0' + @as(u8, @intCast(value % 10));
        value /= 10;
    }
    return code;
}

/// Secondes restantes avant le prochain code.
pub fn remaining(period: u32, timestamp_ms: i64) u32 {
    if (period == 0) return 0;
    const seconds: u64 = if (timestamp_ms <= 0)
        0
    else
        @intCast(@divFloor(timestamp_ms, 1000));
    const elapsed: u32 = @intCast(seconds % period);
    return period - elapsed;
}

// ------------------------------------------------------------------ outils

fn startsWithIgnoreCase(text: []const u8, prefix: []const u8) bool {
    if (text.len < prefix.len) return false;
    return std.ascii.eqlIgnoreCase(text[0..prefix.len], prefix);
}

fn decodeBase32(input: []const u8, out: []u8) ![]const u8 {
    var value: u32 = 0;
    var bits: u8 = 0;
    var len: usize = 0;

    for (input) |ch| {
        if (ch == ' ' or ch == '\t' or ch == '-' or ch == '=') continue;
        const index = base32Value(ch) orelse return Error.InvalidBase32;
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            if (len >= out.len) return Error.SecretTooLong;
            out[len] = @intCast((value >> @intCast(bits)) & 0xff);
            len += 1;
        }
    }

    if (len == 0) return Error.InvalidBase32;
    return out[0..len];
}

fn base32Value(ch: u8) ?u8 {
    return switch (ch) {
        'A'...'Z' => ch - 'A',
        'a'...'z' => ch - 'a',
        '2'...'7' => ch - '2' + 26,
        else => null,
    };
}

// ------------------------------------------------------------------ tests

const testing = std.testing;

fn expectCode(config: Config, timestamp_ms: i64, expected: []const u8) !void {
    const code = try compute(config, timestamp_ms);
    try testing.expectEqualStrings(expected, code.slice());
}

test "vecteurs RFC 6238 SHA-1" {
    const config: Config = .{ .secret = "12345678901234567890", .digits = 8 };
    try expectCode(config, 59_000, "94287082");
    try expectCode(config, 1_111_111_109_000, "07081804");
    try expectCode(config, 1_111_111_111_000, "14050471");
    try expectCode(config, 1_234_567_890_000, "89005924");
    try expectCode(config, 2_000_000_000_000, "69279037");
    try expectCode(config, 20_000_000_000_000, "65353130");
}

test "vecteurs RFC 6238 SHA-256 et SHA-512" {
    const sha256: Config = .{
        .secret = "12345678901234567890123456789012",
        .digits = 8,
        .algorithm = .sha256,
    };
    try expectCode(sha256, 59_000, "46119246");
    try expectCode(sha256, 1_111_111_109_000, "68084774");

    const sha512: Config = .{
        .secret = "1234567890123456789012345678901234567890123456789012345678901234",
        .digits = 8,
        .algorithm = .sha512,
    };
    try expectCode(sha512, 59_000, "90693936");
    try expectCode(sha512, 1_111_111_109_000, "25091201");
}

test "analyse une URI otpauth et décode le base32" {
    var secret_buf: [64]u8 = undefined;
    const config = try parseUri(
        "otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=8&period=60&algorithm=SHA256",
        &secret_buf,
    );
    try testing.expectEqual(@as(u8, 8), config.digits);
    try testing.expectEqual(@as(u32, 60), config.period);
    try testing.expectEqual(Algorithm.sha256, config.algorithm);
    try testing.expectEqual(@as(usize, 10), config.secret.len);
    try testing.expectEqualStrings("Hello!\xDE\xAD\xBE\xEF", config.secret);
}

test "refuse une URI invalide ou un secret incorrect" {
    var secret_buf: [64]u8 = undefined;
    try testing.expectError(Error.InvalidUri, parseUri("https://example.com", &secret_buf));
    try testing.expectError(Error.InvalidUri, parseUri("otpauth://hotp/x?secret=JBSWY3DP", &secret_buf));
    try testing.expectError(Error.MissingSecret, parseUri("otpauth://totp/x", &secret_buf));
    try testing.expectError(Error.InvalidBase32, parseUri("otpauth://totp/x?secret=$$$$", &secret_buf));
}

test "les secondes restantes suivent la période" {
    try testing.expectEqual(@as(u32, 30), remaining(30, 0));
    try testing.expectEqual(@as(u32, 29), remaining(30, 1_000));
    try testing.expectEqual(@as(u32, 1), remaining(30, 29_000));
    try testing.expectEqual(@as(u32, 30), remaining(30, 30_000));
}
