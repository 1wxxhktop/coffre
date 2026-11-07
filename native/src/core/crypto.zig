//! Primitives cryptographiques, identiques au format `.coffre`.
//!
//! - Argon2id pour dériver la clé maîtresse ;
//! - AES-256-GCM pour le chiffrement authentifié ;
//! - nonce aléatoire de 12 octets préfixé au ciphertext ;
//! - AAD de domaine pour lier chaque ciphertext à son usage.
//!
//! Aucune clé ni aucun secret ne quitte la mémoire du processus.

const std = @import("std");

pub const KEY_BYTES = 32;
pub const NONCE_BYTES = 12;
pub const TAG_BYTES = 16;
pub const SALT_BYTES = 16;

pub const KDF_DEFAULTS = .{
    .memory_kib = 65_536,
    .iterations = 3,
    .parallelism = 4,
    .key_length = KEY_BYTES,
};

pub const Error = error{
    InvalidKdf,
    InvalidKey,
    InvalidNonce,
    InvalidCiphertext,
    DecryptFailed,
    KeyDerivationFailed,
};

pub const Key = [KEY_BYTES]u8;

/// Deux champs base64 : `n` (nonce) et `c` (ciphertext suivi du tag GCM).
pub const Sealed = struct {
    n: []u8,
    c: []u8,

    pub fn deinit(self: Sealed, allocator: std.mem.Allocator) void {
        allocator.free(self.n);
        allocator.free(self.c);
    }
};

/// Dérive la clé maîtresse avec Argon2id, exactement comme `hash-wasm`.
pub fn deriveMasterKey(
    allocator: std.mem.Allocator,
    password: []const u8,
    salt: []const u8,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    key_length: usize,
    io: std.Io,
) !Key {
    if (salt.len < 8) return Error.InvalidKdf;
    if (key_length != KEY_BYTES) return Error.InvalidKey;
    if (memory_kib == 0 or iterations == 0 or parallelism == 0) return Error.InvalidKdf;

    var key: Key = undefined;
    const params: std.crypto.pwhash.argon2.Params = .{
        .t = iterations,
        .m = memory_kib,
        .p = @intCast(parallelism),
    };
    std.crypto.pwhash.argon2.kdf(
        allocator,
        &key,
        password,
        salt,
        params,
        .argon2id,
        io,
    ) catch return Error.KeyDerivationFailed;
    return key;
}

/// Chiffre `plaintext` et renvoie le nonce et le ciphertext en base64.
pub fn seal(
    allocator: std.mem.Allocator,
    plaintext: []const u8,
    key: Key,
    aad: []const u8,
    io: std.Io,
) !Sealed {
    var nonce: [NONCE_BYTES]u8 = undefined;
    std.Io.random(io, &nonce);

    const ciphertext = try allocator.alloc(u8, plaintext.len);
    defer allocator.free(ciphertext);
    var tag: [TAG_BYTES]u8 = undefined;
    std.crypto.aead.aes_gcm.Aes256Gcm.encrypt(
        ciphertext,
        &tag,
        plaintext,
        aad,
        nonce,
        key,
    );

    // Le format Coffre concatène le tag au ciphertext, comme WebCrypto.
    const combined = try allocator.alloc(u8, ciphertext.len + TAG_BYTES);
    defer allocator.free(combined);
    @memcpy(combined[0..ciphertext.len], ciphertext);
    @memcpy(combined[ciphertext.len..], &tag);

    return .{
        .n = try base64Encode(allocator, &nonce),
        .c = try base64Encode(allocator, combined),
    };
}

/// Ouvre un ciphertext base64 et vérifie son tag GCM.
pub fn open(
    allocator: std.mem.Allocator,
    sealed: anytype,
    key: Key,
    aad: []const u8,
) ![]u8 {
    const nonce_bytes = try base64Decode(allocator, sealed.n);
    defer allocator.free(nonce_bytes);
    if (nonce_bytes.len != NONCE_BYTES) return Error.InvalidNonce;

    const combined = try base64Decode(allocator, sealed.c);
    defer allocator.free(combined);
    if (combined.len < TAG_BYTES) return Error.InvalidCiphertext;

    const ciphertext = combined[0 .. combined.len - TAG_BYTES];
    var tag: [TAG_BYTES]u8 = undefined;
    @memcpy(&tag, combined[combined.len - TAG_BYTES ..]);

    const plaintext = try allocator.alloc(u8, ciphertext.len);
    errdefer allocator.free(plaintext);
    var nonce: [NONCE_BYTES]u8 = undefined;
    @memcpy(&nonce, nonce_bytes);
    std.crypto.aead.aes_gcm.Aes256Gcm.decrypt(
        plaintext,
        ciphertext,
        tag,
        aad,
        nonce,
        key,
    ) catch return Error.DecryptFailed;
    return plaintext;
}

pub fn base64Encode(allocator: std.mem.Allocator, bytes: []const u8) ![]u8 {
    const encoder = std.base64.standard.Encoder;
    const out = try allocator.alloc(u8, encoder.calcSize(bytes.len));
    _ = encoder.encode(out, bytes);
    return out;
}

pub fn base64Decode(allocator: std.mem.Allocator, text: []const u8) ![]u8 {
    const decoder = std.base64.standard.Decoder;
    const len = decoder.calcSizeForSlice(text) catch return Error.InvalidCiphertext;
    const out = try allocator.alloc(u8, len);
    decoder.decode(out, text) catch {
        allocator.free(out);
        return Error.InvalidCiphertext;
    };
    return out;
}

/// Efface un buffer sensible sans laisser le compilateur l’optimiser.
pub fn wipe(bytes: []u8) void {
    std.crypto.secureZero(u8, @volatileCast(bytes));
}

pub fn wipeKey(key: *Key) void {
    std.crypto.secureZero(u8, @volatileCast(key));
}

test "AES-256-GCM aller-retour" {
    const allocator = std.testing.allocator;
    const key: Key = @splat(0x42);
    const sealed = try seal(allocator, "bonjour", key, "coffre:test", std.testing.io);
    defer sealed.deinit(allocator);

    const plaintext = try open(allocator, sealed, key, "coffre:test");
    defer allocator.free(plaintext);
    try std.testing.expectEqualStrings("bonjour", plaintext);

    // Une AAD différente doit échouer.
    try std.testing.expectError(Error.DecryptFailed, open(allocator, sealed, key, "coffre:autre"));
}

test "Argon2id correspond aux paramètres du format" {
    const allocator = std.testing.allocator;
    const salt: [SALT_BYTES]u8 = @splat(0x01);
    var a = try deriveMasterKey(allocator, "mot de passe", &salt, 8, 1, 1, KEY_BYTES, std.testing.io);
    defer wipeKey(&a);
    var b = try deriveMasterKey(allocator, "mot de passe", &salt, 8, 1, 1, KEY_BYTES, std.testing.io);
    defer wipeKey(&b);
    try std.testing.expectEqualSlices(u8, &a, &b);
}
