//! Import depuis d’autres gestionnaires de mots de passe.
//!
//! Formats pris en charge :
//! - exports JSON non chiffrés de Bitwarden, Proton Pass et Enpass ;
//! - CSV avec détection des colonnes courantes (Enpass, 1Password, LastPass,
//!   Chrome, Firefox, Dashlane, KeePass, etc.).
//!
//! Les données sont converties en contenus d’éléments ; rien du fichier
//! importé n’est conservé tel quel. La déduplication compare le type, le
//! titre, l’identifiant et le mot de passe.

const std = @import("std");
const format = @import("format.zig");

pub const MAX_IMPORT_ITEMS = 5_000;
pub const MAX_CUSTOM_FIELDS = 100;

pub const Source = enum { bitwarden, protonpass, enpass, csv };

pub const Error = error{
    EmptyFile,
    UnrecognizedFormat,
    InvalidJson,
    EncryptedExport,
    CoffreFile,
    InvalidCsv,
};

pub const Parsed = struct {
    source: Source,
    items: []format.ItemContent,
    warnings: [][]const u8,
};

pub fn sourceLabel(source: Source) []const u8 {
    return switch (source) {
        .bitwarden => "Bitwarden",
        .protonpass => "Proton Pass",
        .enpass => "Enpass",
        .csv => "CSV",
    };
}

/// Détecte le format à partir du contenu, sans rien conserver.
pub fn detect(allocator: std.mem.Allocator, text: []const u8) !?Source {
    const trimmed = try trimBom(allocator, text);
    if (trimmed.len == 0) return null;

    if (trimmed[0] == '{' or trimmed[0] == '[') {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, trimmed, .{
            .allocate = .alloc_always,
        }) catch return Error.InvalidJson;
        defer parsed.deinit();
        const root = switch (parsed.value) {
            .object => |obj| obj,
            else => return null,
        };
        if (root.get("vaults") != null) return .protonpass;
        if (root.get("format")) |value| {
            if (value == .string and std.mem.eql(u8, value.string, "coffre")) return Error.CoffreFile;
        }
        if (isEnpassRoot(root)) return .enpass;
        if (root.get("items") != null) return .bitwarden;
        return null;
    }

    const first_line = firstLine(trimmed);
    if (std.mem.indexOfAny(u8, first_line, ",;\t") != null) return .csv;
    return null;
}

/// Analyse un export et renvoie les contenus prêts à être scellés.
///
/// L’analyse se fait dans une arène temporaire, effacée à la sortie : les
/// chaînes retenues sont recopiées dans `allocator`. Les doublons et les
/// éléments ignorés ne laissent donc aucun secret en mémoire.
pub fn parse(allocator: std.mem.Allocator, text: []const u8) !Parsed {
    var scratch = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer scratch.deinit();
    const work = scratch.allocator();

    const trimmed = try trimBom(work, text);
    if (trimmed.len == 0) return Error.EmptyFile;

    if (trimmed[0] == '{' or trimmed[0] == '[') {
        var parsed = std.json.parseFromSlice(std.json.Value, work, trimmed, .{
            .allocate = .alloc_always,
        }) catch return Error.InvalidJson;
        defer parsed.deinit();
        defer wipeValue(&parsed.value);

        const root = switch (parsed.value) {
            .object => |obj| obj,
            else => return Error.UnrecognizedFormat,
        };

        if (root.get("format")) |value| {
            if (value == .string and std.mem.eql(u8, value.string, "coffre")) return Error.CoffreFile;
        }
        const raw = if (root.get("vaults") != null)
            try parseProtonPass(work, root)
        else if (isEnpassRoot(root))
            try parseEnpass(work, root)
        else if (root.get("items") != null)
            try parseBitwarden(work, root)
        else
            return Error.UnrecognizedFormat;

        return cloneParsed(allocator, raw);
    }

    const first_line = firstLine(trimmed);
    if (std.mem.indexOfAny(u8, first_line, ",;\t") == null) return Error.UnrecognizedFormat;
    const raw = try parseCsv(work, trimmed);
    return cloneParsed(allocator, raw);
}

/// Deux éléments sont considérés identiques s’ils ont le même type, le même
/// titre (insensible à la casse), le même identifiant et le même mot de passe.
pub fn sameContent(a: *const format.ItemContent, b: *const format.ItemContent) bool {
    if (!containsFold(a.type, b.type) and !containsFold(b.type, a.type)) return false;
    if (!eqlFold(a.title, b.title)) return false;
    if (!eqlFold(a.username orelse "", b.username orelse "")) return false;
    return std.mem.eql(u8, a.password orelse "", b.password orelse "");
}

// ------------------------------------------------------- copie et effacement

fn wipeText(text: []const u8) void {
    if (text.len > 0) @memset(@constCast(text), 0);
}

fn wipeOpt(text: ?[]const u8) void {
    if (text) |value| wipeText(value);
}

fn wipeContent(content: *format.ItemContent) void {
    wipeText(content.type);
    wipeText(content.title);
    wipeText(content.notes);
    for (content.tags) |tag| wipeText(tag);
    if (content.urls) |urls| {
        for (urls) |url| wipeText(url);
    }
    for (content.customFields) |field| {
        wipeText(field.id);
        wipeText(field.label);
        wipeText(field.value);
        wipeText(field.type);
    }
    for (content.attachments) |attachment| {
        wipeText(attachment.id);
        wipeText(attachment.name);
        wipeText(attachment.mime);
        wipeText(attachment.createdAt);
    }
    wipeOpt(content.deletedAt);
    wipeOpt(content.username);
    wipeOpt(content.password);
    wipeOpt(content.totp);
    wipeOpt(content.cardholder);
    wipeOpt(content.number);
    wipeOpt(content.expiry);
    wipeOpt(content.cvc);
    wipeOpt(content.pin);
    wipeOpt(content.brand);
    wipeOpt(content.firstName);
    wipeOpt(content.lastName);
    wipeOpt(content.email);
    wipeOpt(content.phone);
    wipeOpt(content.address);
    wipeOpt(content.city);
    wipeOpt(content.postalCode);
    wipeOpt(content.country);
    wipeOpt(content.birthDate);
}

fn wipeValue(value: *std.json.Value) void {
    switch (value.*) {
        .string => |text| wipeText(text),
        .array => |array| {
            for (array.items) |*entry| wipeValue(entry);
        },
        .object => |object| {
            var it = object.iterator();
            while (it.next()) |entry| wipeValue(entry.value_ptr);
        },
        else => {},
    }
}

fn cloneOpt(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    const text = value orelse return null;
    return try allocator.dupe(u8, text);
}

fn cloneStrings(allocator: std.mem.Allocator, values: []const []const u8) ![]const []const u8 {
    if (values.len == 0) return &.{};
    const out = try allocator.alloc([]const u8, values.len);
    for (values, 0..) |value, index| out[index] = try allocator.dupe(u8, value);
    return out;
}

fn cloneContent(allocator: std.mem.Allocator, src: format.ItemContent) !format.ItemContent {
    var out = src;
    out.type = try allocator.dupe(u8, src.type);
    out.title = try allocator.dupe(u8, src.title);
    out.notes = try allocator.dupe(u8, src.notes);
    out.tags = try cloneStrings(allocator, src.tags);
    out.urls = if (src.urls) |urls| try cloneStrings(allocator, urls) else null;

    out.customFields = try allocator.alloc(format.CustomField, src.customFields.len);
    for (src.customFields, 0..) |field, index| {
        out.customFields[index] = .{
            .id = try allocator.dupe(u8, field.id),
            .label = try allocator.dupe(u8, field.label),
            .value = try allocator.dupe(u8, field.value),
            .type = try allocator.dupe(u8, field.type),
        };
    }

    out.attachments = try allocator.alloc(format.AttachmentMeta, src.attachments.len);
    for (src.attachments, 0..) |attachment, index| {
        out.attachments[index] = .{
            .id = try allocator.dupe(u8, attachment.id),
            .name = try allocator.dupe(u8, attachment.name),
            .mime = try allocator.dupe(u8, attachment.mime),
            .size = attachment.size,
            .createdAt = try allocator.dupe(u8, attachment.createdAt),
        };
    }

    out.deletedAt = try cloneOpt(allocator, src.deletedAt);
    out.username = try cloneOpt(allocator, src.username);
    out.password = try cloneOpt(allocator, src.password);
    out.totp = try cloneOpt(allocator, src.totp);
    out.cardholder = try cloneOpt(allocator, src.cardholder);
    out.number = try cloneOpt(allocator, src.number);
    out.expiry = try cloneOpt(allocator, src.expiry);
    out.cvc = try cloneOpt(allocator, src.cvc);
    out.pin = try cloneOpt(allocator, src.pin);
    out.brand = try cloneOpt(allocator, src.brand);
    out.firstName = try cloneOpt(allocator, src.firstName);
    out.lastName = try cloneOpt(allocator, src.lastName);
    out.email = try cloneOpt(allocator, src.email);
    out.phone = try cloneOpt(allocator, src.phone);
    out.address = try cloneOpt(allocator, src.address);
    out.city = try cloneOpt(allocator, src.city);
    out.postalCode = try cloneOpt(allocator, src.postalCode);
    out.country = try cloneOpt(allocator, src.country);
    out.birthDate = try cloneOpt(allocator, src.birthDate);
    return out;
}

fn cloneParsed(allocator: std.mem.Allocator, raw: Parsed) !Parsed {
    const items = try allocator.alloc(format.ItemContent, raw.items.len);
    for (raw.items, 0..) |*content, index| {
        items[index] = try cloneContent(allocator, content.*);
        wipeContent(content);
    }

    const warnings = try allocator.alloc([]const u8, raw.warnings.len);
    for (raw.warnings, 0..) |warning, index| {
        warnings[index] = try allocator.dupe(u8, warning);
        wipeText(warning);
    }

    return .{ .source = raw.source, .items = items, .warnings = warnings };
}

// ------------------------------------------------------------------ outils

fn trimBom(allocator: std.mem.Allocator, text: []const u8) ![]const u8 {
    _ = allocator;
    var start: usize = 0;
    if (text.len >= 3 and text[0] == 0xEF and text[1] == 0xBB and text[2] == 0xBF) start = 3;
    return std.mem.trim(u8, text[start..], " \t\r\n");
}

fn firstLine(text: []const u8) []const u8 {
    const end = std.mem.indexOfScalar(u8, text, '\n') orelse text.len;
    return std.mem.trimEnd(u8, text[0..end], "\r");
}

fn clip(text: []const u8, max: usize) []const u8 {
    const trimmed = std.mem.trim(u8, text, " \t\r\n");
    return trimmed[0..@min(trimmed.len, max)];
}

fn isEmptyOpt(value: ?[]const u8) bool {
    const text = value orelse return true;
    return text.len == 0;
}

fn eqlFold(a: []const u8, b: []const u8) bool {
    return std.ascii.eqlIgnoreCase(a, b);
}

fn containsFold(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0) return true;
    if (needle.len > haystack.len) return false;
    var i: usize = 0;
    while (i + needle.len <= haystack.len) : (i += 1) {
        if (std.ascii.eqlIgnoreCase(haystack[i .. i + needle.len], needle)) return true;
    }
    return false;
}

fn hasAny(text: []const u8, needles: []const []const u8) bool {
    for (needles) |needle| {
        if (containsFold(text, needle)) return true;
    }
    return false;
}

fn objObject(obj: std.json.ObjectMap, key: []const u8) ?std.json.ObjectMap {
    const value = obj.get(key) orelse return null;
    return switch (value) {
        .object => |inner| inner,
        else => null,
    };
}

fn objArray(obj: std.json.ObjectMap, key: []const u8) ?[]std.json.Value {
    const value = obj.get(key) orelse return null;
    return switch (value) {
        .array => |inner| inner.items,
        else => null,
    };
}

fn str(obj: std.json.ObjectMap, key: []const u8) []const u8 {
    const value = obj.get(key) orelse return "";
    return switch (value) {
        .string => |inner| inner,
        else => "",
    };
}

fn boolField(obj: std.json.ObjectMap, key: []const u8) bool {
    const value = obj.get(key) orelse return false;
    return switch (value) {
        .bool => |inner| inner,
        .integer => |inner| inner != 0,
        else => false,
    };
}

fn intField(obj: std.json.ObjectMap, key: []const u8) ?i64 {
    const value = obj.get(key) orelse return null;
    return switch (value) {
        .integer => |inner| inner,
        else => null,
    };
}

/// Liste d’objets, que la source utilise un tableau ou un objet indexé.
fn records(allocator: std.mem.Allocator, value: std.json.Value) ![]std.json.ObjectMap {
    var list: std.ArrayList(std.json.ObjectMap) = .empty;
    switch (value) {
        .array => |array| {
            for (array.items) |entry| {
                if (entry == .object) try list.append(allocator, entry.object);
            }
        },
        .object => |obj| {
            var it = obj.iterator();
            while (it.next()) |entry| {
                if (entry.value_ptr.* == .object) try list.append(allocator, entry.value_ptr.object);
            }
        },
        else => {},
    }
    return list.toOwnedSlice(allocator);
}

fn recordsField(allocator: std.mem.Allocator, obj: std.json.ObjectMap, key: []const u8) ![]std.json.ObjectMap {
    const value = obj.get(key) orelse return &.{};
    return records(allocator, value);
}

fn warn(allocator: std.mem.Allocator, warnings: *std.ArrayList([]const u8), text: []const u8) !void {
    try warnings.append(allocator, try allocator.dupe(u8, text));
}

fn warnCount(
    allocator: std.mem.Allocator,
    warnings: *std.ArrayList([]const u8),
    comptime fmt: []const u8,
    count: usize,
) !void {
    try warnings.append(allocator, try std.fmt.allocPrint(allocator, fmt, .{count}));
}

fn titleFromUrl(url: []const u8) []const u8 {
    var rest = std.mem.trim(u8, url, " \t");
    if (std.mem.indexOf(u8, rest, "://")) |index| rest = rest[index + 3 ..];
    const end = std.mem.indexOfAny(u8, rest, "/?#") orelse rest.len;
    rest = rest[0..end];
    if (std.mem.startsWith(u8, rest, "www.")) rest = rest[4..];
    return rest;
}

// ------------------------------------------------------------------ contenu

const Builder = struct {
    allocator: std.mem.Allocator,
    kind: []const u8 = "login",
    title: []const u8 = "",
    notes: []const u8 = "",
    favorite: bool = false,
    username: ?[]const u8 = null,
    password: ?[]const u8 = null,
    totp: ?[]const u8 = null,
    urls: std.ArrayList([]const u8) = .empty,
    tags: std.ArrayList([]const u8) = .empty,
    custom_fields: std.ArrayList(format.CustomField) = .empty,

    cardholder: ?[]const u8 = null,
    number: ?[]const u8 = null,
    expiry: ?[]const u8 = null,
    cvc: ?[]const u8 = null,
    pin: ?[]const u8 = null,
    brand: ?[]const u8 = null,

    first_name: ?[]const u8 = null,
    last_name: ?[]const u8 = null,
    email: ?[]const u8 = null,
    phone: ?[]const u8 = null,
    address: ?[]const u8 = null,
    city: ?[]const u8 = null,
    postal_code: ?[]const u8 = null,
    country: ?[]const u8 = null,
    birth_date: ?[]const u8 = null,

    fn addUrl(self: *Builder, text: []const u8) !void {
        const value = clip(text, 2_000);
        if (value.len == 0 or self.urls.items.len >= 10) return;
        for (self.urls.items) |existing| {
            if (std.mem.eql(u8, existing, value)) return;
        }
        try self.urls.append(self.allocator, value);
    }

    fn addTag(self: *Builder, text: []const u8) !void {
        const value = clip(text, 40);
        if (value.len == 0 or self.tags.items.len >= 30) return;
        for (self.tags.items) |existing| {
            if (eqlFold(existing, value)) return;
        }
        try self.tags.append(self.allocator, value);
    }

    fn addCustom(self: *Builder, label: []const u8, value: []const u8, sensitive: bool) !void {
        const name = clip(label, 80);
        const content = clip(value, 10_000);
        if (name.len == 0 or content.len == 0 or self.custom_fields.items.len >= MAX_CUSTOM_FIELDS) return;
        const id = try std.fmt.allocPrint(self.allocator, "f_{d}", .{self.custom_fields.items.len + 1});
        try self.custom_fields.append(self.allocator, .{
            .id = id,
            .label = name,
            .value = content,
            .type = if (sensitive) "hidden" else "text",
        });
    }

    fn finish(self: *Builder) !format.ItemContent {
        // Toutes les chaînes sont recopiées : les littéraux du code ne doivent
        // jamais être effacés avec les données de l’import.
        const raw: format.ItemContent = .{
            .type = self.kind,
            .title = if (self.title.len > 0) self.title else "Sans titre",
            .favorite = self.favorite,
            .notes = self.notes,
            .tags = try self.tags.toOwnedSlice(self.allocator),
            .customFields = try self.custom_fields.toOwnedSlice(self.allocator),
            .username = self.username,
            .password = self.password,
            .urls = if (self.urls.items.len > 0) try self.urls.toOwnedSlice(self.allocator) else null,
            .totp = self.totp,
            .cardholder = self.cardholder,
            .number = self.number,
            .expiry = self.expiry,
            .cvc = self.cvc,
            .pin = self.pin,
            .brand = self.brand,
            .firstName = self.first_name,
            .lastName = self.last_name,
            .email = self.email,
            .phone = self.phone,
            .address = self.address,
            .city = self.city,
            .postalCode = self.postal_code,
            .country = self.country,
            .birthDate = self.birth_date,
        };
        return cloneContent(self.allocator, raw);
    }
};

fn normalizeTotp(allocator: std.mem.Allocator, raw: []const u8, title: []const u8) !?[]const u8 {
    const value = std.mem.trim(u8, raw, " \t\r\n");
    if (value.len == 0) return null;
    if (containsFold(value, "otpauth://")) return try allocator.dupe(u8, value);

    var secret = std.ArrayList(u8).empty;
    for (value) |ch| {
        if (ch == ' ' or ch == '-') continue;
        try secret.append(allocator, std.ascii.toUpper(ch));
    }
    if (secret.items.len < 8) return try allocator.dupe(u8, value);
    for (secret.items) |ch| {
        if (!((ch >= 'A' and ch <= 'Z') or (ch >= '2' and ch <= '7') or ch == '=')) {
            return try allocator.dupe(u8, value);
        }
    }
    return try std.fmt.allocPrint(
        allocator,
        "otpauth://totp/{s}?secret={s}&issuer=Coffre",
        .{ if (title.len > 0) title else "Compte", secret.items },
    );
}

// ------------------------------------------------------------------ Enpass

const ENPASS_LOGIN = [_][]const u8{ "login", "password", "connexion", "credential", "website" };
const ENPASS_NOTE = [_][]const u8{ "note", "secure note" };
const ENPASS_CARD = [_][]const u8{ "credit card", "card", "carte bancaire", "payment card" };
const ENPASS_IDENTITY = [_][]const u8{ "identity", "identite", "personal info", "contact" };

fn isEnpassRoot(root: std.json.ObjectMap) bool {
    if (root.get("vault")) |value| {
        if (value == .object) {
            const inner = value.object;
            if (inner.get("items") != null or inner.get("folders") != null) return true;
        }
    }
    const items = objArray(root, "items") orelse return false;
    if (items.len == 0) return false;
    const first = switch (items[0]) {
        .object => |obj| obj,
        else => return false,
    };
    if (first.get("category")) |category| {
        if (category == .string) return true;
    }
    if (first.get("folders") != null) return true;
    return false;
}

fn parseEnpass(allocator: std.mem.Allocator, root: std.json.ObjectMap) !Parsed {
    const vault_root = objObject(root, "vault") orelse root;

    var folder_names: std.StringHashMap([]const u8) = .init(allocator);
    for (try recordsField(allocator, vault_root, "folders")) |folder| {
        const uuid = clip(str(folder, "uuid"), 100);
        const title = clip(str(folder, "title"), 100);
        if (uuid.len > 0 and title.len > 0) try folder_names.put(uuid, title);
    }

    var warnings: std.ArrayList([]const u8) = .empty;
    var items: std.ArrayList(format.ItemContent) = .empty;
    var skipped_trashed: usize = 0;
    var unsupported: usize = 0;

    for (try recordsField(allocator, vault_root, "items")) |source| {
        if (items.items.len >= MAX_IMPORT_ITEMS) {
            try warnCount(allocator, &warnings, "Seuls les {d} premiers éléments ont été importés.", MAX_IMPORT_ITEMS);
            break;
        }
        if (boolField(source, "trashed") or boolField(source, "deleted")) {
            skipped_trashed += 1;
            continue;
        }

        const category = clip(str(source, "category"), 60);
        const fields = try enpassFields(allocator, source);
        var builder = Builder{ .allocator = allocator, .kind = enpassType(category, fields) };
        if (std.mem.eql(u8, builder.kind, "note") and category.len > 0 and !hasAny(category, &ENPASS_NOTE)) {
            unsupported += 1;
        }

        const subtitle = clip(str(source, "subtitle"), 500);
        builder.title = clip(str(source, "title"), 200);
        if (builder.title.len == 0) builder.title = subtitle;

        for (objArray(source, "folders") orelse &.{}) |entry| {
            if (entry != .string) continue;
            if (folder_names.get(entry.string)) |name| try builder.addTag(name);
        }

        for (fields) |field| {
            const value = clip(str(field, "value"), 10_000);
            if (value.len == 0) continue;
            const label = clip(str(field, "label"), 80);
            const field_type = clip(str(field, "type"), 60);
            const kind_text = try normalizeHeader(allocator, try std.fmt.allocPrint(
                allocator,
                "{s} {s}",
                .{ field_type, label },
            ));
            const sensitive = (intField(field, "sensitive") orelse 0) > 0;
            const display_label = if (label.len > 0) label else if (field_type.len > 0) field_type else "Champ";

            if (std.mem.eql(u8, builder.kind, "login")) {
                if (hasAny(kind_text, &.{ "password", "passwd", "mot de passe" })) {
                    if (builder.password == null) builder.password = value else try builder.addCustom(display_label, value, true);
                } else if (hasAny(kind_text, &.{ "username", "user name", "login", "email", "e mail", "identifiant" })) {
                    if (builder.username == null) builder.username = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "url", "website", "site", "link", "uri" })) {
                    try builder.addUrl(value);
                } else if (hasAny(kind_text, &.{ "totp", "otp", "2fa", "authenticator" })) {
                    if (builder.totp == null) builder.totp = try normalizeTotp(allocator, value, builder.title) else try builder.addCustom(display_label, value, true);
                } else {
                    try builder.addCustom(display_label, value, sensitive);
                }
            } else if (std.mem.eql(u8, builder.kind, "card")) {
                if (hasAny(kind_text, &.{ "card number", "cardnumber", "numero de carte" })) {
                    if (builder.number == null) builder.number = value else try builder.addCustom(display_label, value, true);
                } else if (hasAny(kind_text, &.{ "cardholder", "card holder", "titulaire" })) {
                    if (builder.cardholder == null) builder.cardholder = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{"expir"})) {
                    if (builder.expiry == null) builder.expiry = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "cvc", "cvv", "csc", "security code" })) {
                    if (builder.cvc == null) builder.cvc = value else try builder.addCustom(display_label, value, true);
                } else if (hasAny(kind_text, &.{"pin"})) {
                    if (builder.pin == null) builder.pin = value else try builder.addCustom(display_label, value, true);
                } else if (hasAny(kind_text, &.{ "brand", "card type", "card network" })) {
                    if (builder.brand == null) builder.brand = value else try builder.addCustom(display_label, value, sensitive);
                } else {
                    try builder.addCustom(display_label, value, sensitive);
                }
            } else if (std.mem.eql(u8, builder.kind, "identity")) {
                if (hasAny(kind_text, &.{ "full name", "fullname", "nom complet" })) {
                    var parts = std.mem.tokenizeAny(u8, value, " \t");
                    if (builder.first_name == null) builder.first_name = parts.next() orelse value;
                    if (builder.last_name == null) builder.last_name = parts.rest();
                } else if (hasAny(kind_text, &.{ "first name", "firstname", "given name", "prenom" })) {
                    if (builder.first_name == null) builder.first_name = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "last name", "lastname", "surname", "nom de famille" })) {
                    if (builder.last_name == null) builder.last_name = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "email", "e mail", "courriel" })) {
                    if (builder.email == null) builder.email = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "phone", "telephone", "mobile" })) {
                    if (builder.phone == null) builder.phone = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "address", "adresse", "street" })) {
                    if (builder.address == null) builder.address = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "city", "ville" })) {
                    if (builder.city == null) builder.city = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "postal", "zip", "code postal" })) {
                    if (builder.postal_code == null) builder.postal_code = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "country", "pays" })) {
                    if (builder.country == null) builder.country = value else try builder.addCustom(display_label, value, sensitive);
                } else if (hasAny(kind_text, &.{ "birth", "naissance", "dob" })) {
                    if (builder.birth_date == null) builder.birth_date = value else try builder.addCustom(display_label, value, sensitive);
                } else {
                    try builder.addCustom(display_label, value, sensitive);
                }
            } else {
                if (hasAny(kind_text, &.{ "note", "notes" })) {
                    if (builder.notes.len == 0) builder.notes = value else try builder.addCustom(display_label, value, sensitive);
                } else {
                    try builder.addCustom(display_label, value, sensitive);
                }
            }
        }

        if (std.mem.eql(u8, builder.kind, "login") and builder.username == null and subtitle.len > 0) {
            if (std.mem.indexOf(u8, subtitle, "://") == null) builder.username = subtitle;
        }
        try items.append(allocator, try builder.finish());
    }

    if (skipped_trashed > 0) try warnCount(allocator, &warnings, "{d} élément(s) en corbeille ignoré(s).", skipped_trashed);
    if (unsupported > 0) try warnCount(allocator, &warnings, "{d} catégorie(s) Enpass importée(s) comme notes.", unsupported);
    if (items.items.len == 0) try warn(allocator, &warnings, "Aucun élément importable trouvé.");

    return .{
        .source = .enpass,
        .items = try items.toOwnedSlice(allocator),
        .warnings = try warnings.toOwnedSlice(allocator),
    };
}

fn enpassType(category: []const u8, fields: []std.json.ObjectMap) []const u8 {
    if (hasAny(category, &ENPASS_CARD)) return "card";
    if (hasAny(category, &ENPASS_IDENTITY)) return "identity";
    if (hasAny(category, &ENPASS_NOTE)) return "note";
    if (hasAny(category, &ENPASS_LOGIN)) return "login";
    for (fields) |field| {
        const combined = str(field, "type");
        if (hasAny(combined, &.{ "username", "password", "url", "website", "totp", "otp" })) return "login";
    }
    return "note";
}

fn enpassFields(allocator: std.mem.Allocator, item: std.json.ObjectMap) ![]std.json.ObjectMap {
    var list: std.ArrayList(std.json.ObjectMap) = .empty;
    for (try recordsField(allocator, item, "fields")) |field| try list.append(allocator, field);
    for (try recordsField(allocator, item, "entries")) |section| {
        for (try recordsField(allocator, section, "fields")) |field| try list.append(allocator, field);
    }
    return list.toOwnedSlice(allocator);
}

// ------------------------------------------------------------- Proton Pass

fn parseProtonPass(allocator: std.mem.Allocator, root: std.json.ObjectMap) !Parsed {
    if (boolField(root, "encrypted")) return Error.EncryptedExport;

    var warnings: std.ArrayList([]const u8) = .empty;
    var items: std.ArrayList(format.ItemContent) = .empty;
    var skipped_trashed: usize = 0;
    var unsupported_types: usize = 0;

    const vaults_value = root.get("vaults") orelse return Error.UnrecognizedFormat;
    for (try records(allocator, vaults_value)) |vault| {
        const vault_name = clip(str(vault, "name"), 40);
        for (try recordsField(allocator, vault, "items")) |entry| {
            if (items.items.len >= MAX_IMPORT_ITEMS) {
                try warnCount(allocator, &warnings, "Seuls les {d} premiers éléments ont été importés.", MAX_IMPORT_ITEMS);
                break;
            }
            if ((intField(entry, "state") orelse 0) == 2) {
                skipped_trashed += 1;
                continue;
            }
            const data = objObject(entry, "data") orelse continue;
            const metadata = objObject(data, "metadata") orelse std.json.ObjectMap.empty;
            const content = objObject(data, "content") orelse std.json.ObjectMap.empty;
            const raw_type = clip(str(data, "type"), 40);
            const kind = protonType(raw_type, content);
            if (std.mem.eql(u8, kind, "note") and !std.mem.eql(u8, raw_type, "note")) unsupported_types += 1;

            var builder = Builder{ .allocator = allocator, .kind = kind };
            builder.title = clip(str(metadata, "name"), 200);
            if (builder.title.len == 0) builder.title = clip(str(entry, "aliasEmail"), 200);
            builder.notes = clip(str(metadata, "note"), 100_000);
            builder.favorite = boolField(metadata, "pinned");
            if (vault_name.len > 0) try builder.addTag(vault_name);

            if (std.mem.eql(u8, raw_type, "alias")) {
                const alias = clip(str(entry, "aliasEmail"), 500);
                if (alias.len > 0) {
                    builder.notes = try std.fmt.allocPrint(allocator, "{s}\n\nAlias Proton : {s}", .{ builder.notes, alias });
                }
            }

            for (try recordsField(allocator, data, "extraFields")) |extra| {
                const label = clip(str(extra, "fieldName"), 80);
                const value = protonExtraValue(extra);
                const field_type = clip(str(extra, "type"), 20);
                try builder.addCustom(label, value, std.mem.eql(u8, field_type, "hidden") or std.mem.eql(u8, field_type, "totp"));
            }

            if (std.mem.eql(u8, kind, "login")) {
                const alias = clip(str(entry, "aliasEmail"), 500);
                builder.username = clip(str(content, "username"), 500);
                if ((if (builder.username) |u| u.len else 0) == 0 and std.mem.eql(u8, raw_type, "alias")) builder.username = alias;
                builder.password = clip(str(content, "password"), 2_000);
                builder.totp = try normalizeTotp(allocator, str(content, "totpUri"), builder.title);
                for (objArray(content, "urls") orelse &.{}) |url| {
                    switch (url) {
                        .string => |value| try builder.addUrl(value),
                        .object => |obj| try builder.addUrl(str(obj, "url")),
                        else => {},
                    }
                }
            } else if (std.mem.eql(u8, kind, "card")) {
                builder.cardholder = clip(str(content, "cardholderName"), 200);
                builder.number = clip(str(content, "number"), 40);
                builder.expiry = clip(protonExpiry(allocator, str(content, "expirationDate")), 10);
                builder.cvc = clip(str(content, "securityCode"), 8);
                builder.pin = clip(str(content, "pin"), 12);
                builder.brand = clip(str(content, "cardType"), 40);
            } else if (std.mem.eql(u8, kind, "identity")) {
                const full_name = clip(str(content, "fullName"), 400);
                var parts = std.mem.tokenizeAny(u8, full_name, " \t");
                builder.first_name = clip(str(content, "firstName"), 200);
                if (isEmptyOpt(builder.first_name)) builder.first_name = parts.next() orelse "";
                builder.last_name = clip(str(content, "lastName"), 200);
                if (isEmptyOpt(builder.last_name)) builder.last_name = parts.rest();
                builder.email = clip(str(content, "email"), 500);
                builder.phone = clip(str(content, "phoneNumber"), 100);
                builder.address = clip(str(content, "streetAddress"), 500);
                builder.city = clip(str(content, "city"), 200);
                builder.postal_code = clip(str(content, "zipCode"), 40);
                builder.country = clip(str(content, "country"), 200);
                builder.birth_date = clip(str(content, "birthdate"), 40);
            }

            try items.append(allocator, try builder.finish());
        }
    }

    if (skipped_trashed > 0) try warnCount(allocator, &warnings, "{d} élément(s) en corbeille ignoré(s).", skipped_trashed);
    if (unsupported_types > 0) try warnCount(allocator, &warnings, "{d} type(s) Proton Pass importé(s) comme notes.", unsupported_types);
    if (items.items.len == 0) try warn(allocator, &warnings, "Aucun élément importable trouvé.");

    return .{
        .source = .protonpass,
        .items = try items.toOwnedSlice(allocator),
        .warnings = try warnings.toOwnedSlice(allocator),
    };
}

fn protonType(raw_type: []const u8, content: std.json.ObjectMap) []const u8 {
    if (std.mem.eql(u8, raw_type, "login") or std.mem.eql(u8, raw_type, "alias")) return "login";
    if (std.mem.eql(u8, raw_type, "creditCard") or std.mem.eql(u8, raw_type, "card")) return "card";
    if (std.mem.eql(u8, raw_type, "identity")) return "identity";
    if (std.mem.eql(u8, raw_type, "note")) return "note";
    if (str(content, "username").len > 0 or str(content, "password").len > 0) return "login";
    return "note";
}

fn protonExtraValue(extra: std.json.ObjectMap) []const u8 {
    const value = extra.get("data") orelse return "";
    return switch (value) {
        .string => |text| text,
        .object => |obj| str(obj, "content"),
        else => "",
    };
}

fn protonExpiry(allocator: std.mem.Allocator, value: []const u8) []const u8 {
    const raw = clip(value, 40);
    if (raw.len == 7 and raw[4] == '-') {
        return std.fmt.allocPrint(allocator, "{s}/{s}", .{ raw[5..7], raw[2..4] }) catch raw;
    }
    return raw;
}

// --------------------------------------------------------------- Bitwarden

fn parseBitwarden(allocator: std.mem.Allocator, root: std.json.ObjectMap) !Parsed {
    if (boolField(root, "encrypted")) return Error.EncryptedExport;

    var folder_names: std.StringHashMap([]const u8) = .init(allocator);
    for (try recordsField(allocator, root, "folders")) |folder| {
        const id = clip(str(folder, "id"), 100);
        const name = clip(str(folder, "name"), 100);
        if (id.len > 0 and name.len > 0) try folder_names.put(id, name);
    }

    var warnings: std.ArrayList([]const u8) = .empty;
    var items: std.ArrayList(format.ItemContent) = .empty;
    var skipped_trashed: usize = 0;

    for (try recordsField(allocator, root, "items")) |source| {
        if (items.items.len >= MAX_IMPORT_ITEMS) {
            try warnCount(allocator, &warnings, "Seuls les {d} premiers éléments ont été importés.", MAX_IMPORT_ITEMS);
            break;
        }
        if (clip(str(source, "deletedDate"), 40).len > 0) {
            skipped_trashed += 1;
            continue;
        }

        const kind = switch (intField(source, "type") orelse 1) {
            2 => "note",
            3 => "card",
            4 => "identity",
            else => "login",
        };
        var builder = Builder{ .allocator = allocator, .kind = kind };
        builder.title = clip(str(source, "name"), 200);
        builder.notes = clip(str(source, "notes"), 100_000);
        builder.favorite = boolField(source, "favorite");
        if (folder_names.get(str(source, "folderId"))) |name| try builder.addTag(name);

        for (try recordsField(allocator, source, "fields")) |field| {
            const label = clip(str(field, "name"), 80);
            const value = clip(str(field, "value"), 10_000);
            const hidden = (intField(field, "type") orelse 0) == 1;
            try builder.addCustom(label, value, hidden);
        }

        if (objObject(source, "login")) |login| {
            builder.username = clip(str(login, "username"), 500);
            builder.password = clip(str(login, "password"), 2_000);
            builder.totp = try normalizeTotp(allocator, str(login, "totp"), builder.title);
            for (objArray(login, "uris") orelse &.{}) |uri| {
                switch (uri) {
                    .string => |value| try builder.addUrl(value),
                    .object => |obj| try builder.addUrl(str(obj, "uri")),
                    else => {},
                }
            }
            if (builder.urls.items.len == 0) try builder.addUrl(str(login, "uri"));
        }

        if (objObject(source, "card")) |card| {
            builder.cardholder = clip(str(card, "cardholderName"), 200);
            builder.number = clip(str(card, "number"), 40);
            const month = clip(str(card, "expMonth"), 10);
            const year = clip(str(card, "expYear"), 10);
            if (month.len > 0 or year.len > 0) {
                builder.expiry = try std.fmt.allocPrint(allocator, "{s}/{s}", .{
                    month,
                    if (year.len > 2) year[year.len - 2 ..] else year,
                });
            }
            builder.cvc = clip(str(card, "code"), 8);
            builder.brand = clip(str(card, "brand"), 40);
        }

        if (objObject(source, "identity")) |identity| {
            builder.first_name = clip(str(identity, "firstName"), 200);
            builder.last_name = clip(str(identity, "lastName"), 200);
            builder.email = clip(str(identity, "email"), 500);
            builder.phone = clip(str(identity, "phone"), 100);
            builder.address = clip(str(identity, "address1"), 500);
            builder.city = clip(str(identity, "city"), 200);
            builder.postal_code = clip(str(identity, "postalCode"), 40);
            builder.country = clip(str(identity, "country"), 200);
            builder.birth_date = clip(str(identity, "birthDate"), 40);
        }

        try items.append(allocator, try builder.finish());
    }

    if (skipped_trashed > 0) try warnCount(allocator, &warnings, "{d} élément(s) en corbeille ignoré(s).", skipped_trashed);
    if (items.items.len == 0) try warn(allocator, &warnings, "Aucun élément importable trouvé.");

    return .{
        .source = .bitwarden,
        .items = try items.toOwnedSlice(allocator),
        .warnings = try warnings.toOwnedSlice(allocator),
    };
}

// ---------------------------------------------------------------------- CSV

const CsvField = enum {
    title,
    url,
    username,
    password,
    notes,
    totp,
    favorite,
    archived,
    type,
    folder,
    tags,
    full_name,
    cardholder,
    number,
    expiry,
    cvc,
    pin,
    brand,
    first_name,
    last_name,
    email,
    phone,
    address,
    city,
    postal_code,
    country,
    birth_date,
};

fn aliases(field: CsvField) []const []const u8 {
    return switch (field) {
        .title => &.{ "name", "nom", "title", "account", "item name", "item", "entry", "record", "website name" },
        .url => &.{ "url", "urls", "website", "site web", "web site", "web address", "site", "login uri", "login url", "login website", "uri", "site url", "link" },
        .username => &.{ "username", "user", "user name", "login username", "login name", "login", "login id", "userid", "user id", "email", "email address", "e mail", "identifiant" },
        .password => &.{ "password", "pass", "passwd", "pwd", "login password", "mot de passe" },
        .notes => &.{ "notes", "note", "extra", "comments", "comment", "description", "memo", "remarque" },
        .totp => &.{ "totp", "otpauth", "otp", "one time password", "login totp", "otp secret", "otpsecret", "totp secret", "otpauth url", "otp auth", "two factor", "2fa", "authenticator key" },
        .favorite => &.{ "favorite", "favourite", "fav", "starred", "pinned" },
        .archived => &.{"archived"},
        .type => &.{ "type", "category", "item type", "kind" },
        .folder => &.{ "folder", "folder name", "grouping", "group", "group name", "collection", "vault", "category name", "path" },
        .tags => &.{ "tags", "tag", "labels" },
        .full_name => &.{ "full name", "fullname", "nom complet" },
        .cardholder => &.{ "cardholder", "cardholder name", "cardholdername", "card holder", "card holder name", "name on card", "titulaire", "titulaire de la carte" },
        .number => &.{ "card number", "cardnumber", "card no", "cc number", "credit card number", "numero de carte" },
        .expiry => &.{ "expiry", "expirydate", "expiry date", "expiration", "expirationdate", "expiration date", "exp date", "expires", "exp month", "date d expiration" },
        .cvc => &.{ "cvc", "cvv", "cvv2", "security code", "securitycode", "csc", "card code" },
        .pin => &.{ "pin", "card pin", "code pin" },
        .brand => &.{ "brand", "card type", "cardtype", "card network", "network" },
        .first_name => &.{ "first name", "firstname", "given name", "givenname", "prenom" },
        .last_name => &.{ "last name", "lastname", "surname", "family name", "familyname", "nom de famille" },
        .email => &.{ "email", "email address", "emailaddress", "e mail", "courriel", "mail" },
        .phone => &.{ "phone", "phone number", "phonenumber", "telephone", "tel", "mobile", "mobile phone" },
        .address => &.{ "address", "address1", "address 1", "street", "street address", "adresse", "adresse 1" },
        .city => &.{ "city", "ville", "town" },
        .postal_code => &.{ "postal code", "postalcode", "zip", "zip code", "zipcode", "postcode", "code postal" },
        .country => &.{ "country", "pays" },
        .birth_date => &.{ "birthdate", "birthday", "date of birth", "dob", "date de naissance" },
    };
}

const metadata_headers = [_][]const u8{
    "id",         "uuid",               "guid",          "created",        "created at",            "createdate", "modified",   "modified at",
    "updated",    "updated at",         "last modified", "revision",       "archived",              "deleted",    "deleted at", "reprompt",
    "http realm", "form action origin", "time created",  "time last used", "time password changed",
};

const Row = struct { cells: []const []const u8 };

fn parseCsv(allocator: std.mem.Allocator, text: []const u8) !Parsed {
    const first_line = firstLine(text);
    const delimiter = detectDelimiter(first_line);
    const rows = try parseRows(allocator, text, delimiter);
    if (rows.len < 2) return Error.InvalidCsv;

    const original_headers = rows[0].cells;
    const headers = try allocator.alloc([]const u8, original_headers.len);
    for (original_headers, 0..) |header, index| headers[index] = try normalizeHeader(allocator, header);

    var warnings: std.ArrayList([]const u8) = .empty;
    var items: std.ArrayList(format.ItemContent) = .empty;

    var recognized = false;
    inline for (@typeInfo(CsvField).@"enum".field_values) |value| {
        if (findHeader(headers, @fromBackingInt(@intCast(value))) >= 0) recognized = true;
    }
    if (!recognized) {
        try warn(allocator, &warnings, "Les en-têtes CSV sont inhabituels ; les colonnes non reconnues deviennent des champs personnalisés.");
    }

    const data_rows = rows[1..];
    for (data_rows, 0..) |row, index| {
        if (items.items.len >= MAX_IMPORT_ITEMS) {
            try warnCount(allocator, &warnings, "Seuls les {d} premiers éléments ont été importés.", MAX_IMPORT_ITEMS);
            break;
        }
        _ = index;

        var builder = Builder{ .allocator = allocator };
        const raw_type = pick(row, headers, .type);
        builder.kind = csvType(raw_type, row, headers);
        builder.title = clip(pick(row, headers, .title), 200);
        builder.notes = clip(pick(row, headers, .notes), 100_000);
        builder.favorite = parseFavorite(pick(row, headers, .favorite));

        if (builder.title.len == 0) {
            const first_url = firstUrl(pick(row, headers, .url));
            builder.title = clip(titleFromUrl(first_url), 200);
        }

        const folder = pick(row, headers, .folder);
        const tag_text = pick(row, headers, .tags);
        try addSplitTags(&builder, folder);
        try addSplitTags(&builder, tag_text);
        if (parseFavorite(pick(row, headers, .archived))) try builder.addTag("Archivé");

        for (try splitUrls(allocator, pick(row, headers, .url))) |url| try builder.addUrl(url);

        builder.username = clip(pick(row, headers, .username), 500);
        builder.password = clip(pick(row, headers, .password), 2_000);
        builder.totp = try normalizeTotp(allocator, pick(row, headers, .totp), builder.title);

        builder.cardholder = clip(pick(row, headers, .cardholder), 200);
        builder.number = clip(pick(row, headers, .number), 40);
        builder.expiry = clip(pick(row, headers, .expiry), 10);
        builder.cvc = clip(pick(row, headers, .cvc), 8);
        builder.pin = clip(pick(row, headers, .pin), 12);
        builder.brand = clip(pick(row, headers, .brand), 40);

        const full_name = clip(pick(row, headers, .full_name), 400);
        var parts = std.mem.tokenizeAny(u8, full_name, " \t");
        builder.first_name = clip(pick(row, headers, .first_name), 200);
        if (isEmptyOpt(builder.first_name)) builder.first_name = parts.next() orelse "";
        builder.last_name = clip(pick(row, headers, .last_name), 200);
        if (isEmptyOpt(builder.last_name)) builder.last_name = parts.rest();
        builder.email = clip(pick(row, headers, .email), 500);
        builder.phone = clip(pick(row, headers, .phone), 100);
        builder.address = clip(pick(row, headers, .address), 500);
        builder.city = clip(pick(row, headers, .city), 200);
        builder.postal_code = clip(pick(row, headers, .postal_code), 40);
        builder.country = clip(pick(row, headers, .country), 200);
        builder.birth_date = clip(pick(row, headers, .birth_date), 40);

        // Colonnes inconnues : champs personnalisés.
        for (headers, 0..) |header, column| {
            const value = if (column < row.cells.len) std.mem.trim(u8, row.cells[column], " \t") else "";
            if (header.len == 0 or value.len == 0) continue;
            if (isKnownHeader(header) or isMetadataHeader(header)) continue;
            const sensitive = hasAny(header, &.{ "password", "secret", "token", "key", "pin", "api" });
            const original = if (column < original_headers.len) original_headers[column] else header;
            try builder.addCustom(original, value, sensitive);
        }

        try items.append(allocator, try builder.finish());
    }

    if (data_rows.len > MAX_IMPORT_ITEMS) {
        try warnCount(allocator, &warnings, "Seuls les {d} premiers éléments ont été importés.", MAX_IMPORT_ITEMS);
    }
    if (items.items.len == 0) try warn(allocator, &warnings, "Aucun élément importable trouvé.");

    // Les cellules et les en-têtes sont des copies : elles peuvent être
    // effacées, les éléments retenus en possèdent leur propre copie.
    for (rows) |row| {
        for (row.cells) |cell| wipeText(cell);
    }
    for (headers) |header| wipeText(header);

    return .{
        .source = .csv,
        .items = try items.toOwnedSlice(allocator),
        .warnings = try warnings.toOwnedSlice(allocator),
    };
}

fn detectDelimiter(line: []const u8) u8 {
    var commas: usize = 0;
    var semicolons: usize = 0;
    var tabs: usize = 0;
    var quoted = false;
    var i: usize = 0;
    while (i < line.len) : (i += 1) {
        const ch = line[i];
        if (ch == '"') {
            if (quoted and i + 1 < line.len and line[i + 1] == '"') {
                i += 1;
            } else {
                quoted = !quoted;
            }
        } else if (!quoted) {
            switch (ch) {
                ',' => commas += 1,
                ';' => semicolons += 1,
                '\t' => tabs += 1,
                else => {},
            }
        }
    }
    if (tabs >= commas and tabs >= semicolons and tabs > 0) return '\t';
    if (semicolons > commas) return ';';
    return ',';
}

fn parseRows(allocator: std.mem.Allocator, text: []const u8, delimiter: u8) ![]Row {
    var rows: std.ArrayList(Row) = .empty;
    var row: std.ArrayList([]const u8) = .empty;
    var field: std.ArrayList(u8) = .empty;
    var quoted = false;
    var i: usize = 0;

    while (i < text.len) : (i += 1) {
        const ch = text[i];
        if (quoted) {
            if (ch == '"') {
                if (i + 1 < text.len and text[i + 1] == '"') {
                    try field.append(allocator, '"');
                    i += 1;
                } else {
                    quoted = false;
                }
            } else {
                try field.append(allocator, ch);
            }
            continue;
        }

        if (ch == '"') {
            quoted = true;
            continue;
        }
        if (ch == delimiter) {
            try row.append(allocator, try field.toOwnedSlice(allocator));
            field = .empty;
            continue;
        }
        if (ch == '\r' or ch == '\n') {
            if (ch == '\r' and i + 1 < text.len and text[i + 1] == '\n') i += 1;
            try row.append(allocator, try field.toOwnedSlice(allocator));
            field = .empty;
            if (row.items.len > 1 or (row.items.len == 1 and row.items[0].len > 0)) {
                try rows.append(allocator, .{ .cells = try row.toOwnedSlice(allocator) });
            }
            row = .empty;
            continue;
        }
        try field.append(allocator, ch);
    }

    if (field.items.len > 0 or row.items.len > 0) {
        try row.append(allocator, try field.toOwnedSlice(allocator));
        try rows.append(allocator, .{ .cells = try row.toOwnedSlice(allocator) });
    }
    return rows.toOwnedSlice(allocator);
}

fn normalizeHeader(allocator: std.mem.Allocator, text: []const u8) ![]const u8 {
    var out: std.ArrayList(u8) = .empty;
    var space = false;
    var i: usize = 0;
    while (i < text.len) : (i += 1) {
        const ch = text[i];
        var mapped: ?u8 = null;
        if (ch < 0x80) {
            if (std.ascii.isAlphanumeric(ch)) mapped = std.ascii.toLower(ch);
        } else if (i + 1 < text.len) {
            const pair = [_]u8{ ch, text[i + 1] };
            mapped = switch (pair[0]) {
                0xC3 => switch (pair[1]) {
                    0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 => 'a',
                    0xA7 => 'c',
                    0xA8, 0xA9, 0xAA, 0xAB => 'e',
                    0xAC, 0xAD, 0xAE, 0xAF => 'i',
                    0xB2, 0xB3, 0xB4, 0xB5, 0xB6 => 'o',
                    0xB9, 0xBA, 0xBB, 0xBC => 'u',
                    0xBF => null,
                    else => null,
                },
                0xC5 => switch (pair[1]) {
                    0x93, 0x92 => 'e',
                    else => null,
                },
                else => null,
            };
            if (mapped != null) i += 1;
        }
        if (mapped) |value| {
            if (space and out.items.len > 0) try out.append(allocator, ' ');
            try out.append(allocator, value);
            space = false;
        } else {
            space = out.items.len > 0;
        }
    }
    return out.toOwnedSlice(allocator);
}

fn findHeader(headers: []const []const u8, field: CsvField) i64 {
    for (aliases(field)) |alias| {
        const normalized = normalizeHeaderStatic(alias);
        for (headers, 0..) |header, index| {
            if (std.mem.eql(u8, header, normalized)) return @intCast(index);
        }
    }
    return -1;
}

/// Les alias sont déjà en ASCII minuscule : pas besoin d’allouer.
fn normalizeHeaderStatic(text: []const u8) []const u8 {
    return text;
}

fn pick(row: Row, headers: []const []const u8, field: CsvField) []const u8 {
    const index = findHeader(headers, field);
    if (index < 0) return "";
    const at: usize = @intCast(index);
    if (at >= row.cells.len) return "";
    return std.mem.trim(u8, row.cells[at], " \t");
}

fn isKnownHeader(header: []const u8) bool {
    inline for (@typeInfo(CsvField).@"enum".field_values) |value| {
        for (aliases(@fromBackingInt(@intCast(value)))) |alias| {
            if (std.mem.eql(u8, header, alias)) return true;
        }
    }
    return false;
}

fn isMetadataHeader(header: []const u8) bool {
    for (metadata_headers) |name| {
        if (std.mem.eql(u8, header, name)) return true;
    }
    return false;
}

fn csvType(value: []const u8, row: Row, headers: []const []const u8) []const u8 {
    const kind = value;
    if (kind.len > 0) {
        if (hasAny(kind, &.{ "card", "credit", "debit", "carte" })) return "card";
        if (hasAny(kind, &.{ "identity", "identite", "personal info", "contact" })) return "identity";
        if (hasAny(kind, &.{ "note", "secure note" })) return "note";
        if (hasAny(kind, &.{ "login", "password", "connexion", "credential" })) return "login";
        if (std.mem.eql(u8, kind, "1")) return "login";
        if (std.mem.eql(u8, kind, "2")) return "note";
        if (std.mem.eql(u8, kind, "3")) return "card";
        if (std.mem.eql(u8, kind, "4")) return "identity";
    }
    if (pick(row, headers, .number).len > 0) return "card";
    if (pick(row, headers, .first_name).len > 0 or pick(row, headers, .last_name).len > 0 or
        pick(row, headers, .full_name).len > 0 or pick(row, headers, .address).len > 0) return "identity";
    if (pick(row, headers, .username).len > 0 or pick(row, headers, .password).len > 0 or
        pick(row, headers, .url).len > 0 or pick(row, headers, .totp).len > 0) return "login";
    return "note";
}

fn addSplitTags(builder: *Builder, text: []const u8) !void {
    var it = std.mem.tokenizeAny(u8, text, ";,");
    while (it.next()) |tag| try builder.addTag(tag);
}

fn splitUrls(allocator: std.mem.Allocator, text: []const u8) ![]const []const u8 {
    // Les URL sont séparées par des retours à la ligne.
    var list: std.ArrayList([]const u8) = .empty;
    var it = std.mem.splitScalar(u8, text, '\n');
    while (it.next()) |url| {
        const value = std.mem.trim(u8, url, " \t\r");
        if (value.len == 0 or list.items.len >= 10) continue;
        try list.append(allocator, value);
    }
    return list.toOwnedSlice(allocator);
}

fn firstUrl(text: []const u8) []const u8 {
    var it = std.mem.splitScalar(u8, text, '\n');
    while (it.next()) |url| {
        const value = std.mem.trim(u8, url, " \t\r");
        if (value.len > 0) return value;
    }
    return "";
}

fn parseFavorite(value: []const u8) bool {
    const text = std.mem.trim(u8, value, " \t");
    return eqlFold(text, "1") or eqlFold(text, "true") or eqlFold(text, "yes") or
        eqlFold(text, "y") or eqlFold(text, "oui") or eqlFold(text, "on") or
        eqlFold(text, "fav") or eqlFold(text, "favorite");
}

// ------------------------------------------------------------------ tests

const testing = std.testing;

test "détecte et importe un export Enpass minimal" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const text =
        \\{"items":[{"title":"GitHub","subtitle":"octocat","category":"Login",
        \\"fields":[{"label":"Username","value":"octocat"},{"label":"Password","value":"s3cret!","sensitive":1},
        \\{"label":"Website","value":"https://github.com"}]}]}
    ;
    try testing.expectEqual(Source.enpass, (try detect(allocator, text)).?);
    const parsed = try parse(allocator, text);
    try testing.expectEqual(@as(usize, 1), parsed.items.len);
    const item = parsed.items[0];
    try testing.expectEqualStrings("login", item.type);
    try testing.expectEqualStrings("GitHub", item.title);
    try testing.expectEqualStrings("octocat", item.username.?);
    try testing.expectEqualStrings("s3cret!", item.password.?);
    try testing.expectEqualStrings("https://github.com", item.urls.?[0]);
}

test "importe un CSV avec en-têtes français et colonne personnalisée" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const text =
        \\Nom;Identifiant;Mot de passe;Site web;Notes;Numéro de compte
        \\Banque;jean;secret;https://banque.fr;Compte courant;FR76
    ;
    try testing.expectEqual(Source.csv, (try detect(allocator, text)).?);
    const parsed = try parse(allocator, text);
    try testing.expectEqual(@as(usize, 1), parsed.items.len);
    const item = parsed.items[0];
    try testing.expectEqualStrings("Banque", item.title);
    try testing.expectEqualStrings("jean", item.username.?);
    try testing.expectEqualStrings("secret", item.password.?);
    try testing.expectEqualStrings("FR76", item.customFields[0].value);
}

test "importe un export Bitwarden avec dossier et champ caché" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const text =
        \\{"encrypted":false,"folders":[{"id":"f1","name":"Travail"}],
        \\"items":[{"type":1,"name":"GitHub","notes":"Compte","favorite":true,"folderId":"f1",
        \\"login":{"username":"octocat","password":"s3cret!","totp":"JBSWY3DPEHPK3PXP",
        \\"uris":[{"uri":"https://github.com"}]},"fields":[{"name":"PIN","value":"1234","type":1}]}]}
    ;
    try testing.expectEqual(Source.bitwarden, (try detect(allocator, text)).?);
    const parsed = try parse(allocator, text);
    try testing.expectEqual(@as(usize, 1), parsed.items.len);
    const item = parsed.items[0];
    try testing.expectEqualStrings("GitHub", item.title);
    try testing.expectEqualStrings("octocat", item.username.?);
    try testing.expectEqualStrings("s3cret!", item.password.?);
    try testing.expect(item.favorite);
    try testing.expectEqualStrings("Travail", item.tags[0]);
    try testing.expectEqualStrings("PIN", item.customFields[0].label);
    try testing.expectEqualStrings("hidden", item.customFields[0].type);
    try testing.expect(std.mem.indexOf(u8, item.totp.?, "otpauth://totp/") != null);
}

test "importe un export Proton Pass et refuse un export chiffré" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const text =
        \\{"vaults":[{"name":"Perso","items":[{"data":{"type":"login",
        \\"metadata":{"name":"GitHub","note":"Compte","pinned":true},
        \\"content":{"username":"octocat","password":"s3cret!","urls":[{"url":"https://github.com"}]},
        \\"extraFields":[{"fieldName":"PIN","type":"hidden","data":{"content":"1234"}}]}}]}]}
    ;
    try testing.expectEqual(Source.protonpass, (try detect(allocator, text)).?);
    const parsed = try parse(allocator, text);
    try testing.expectEqual(@as(usize, 1), parsed.items.len);
    const item = parsed.items[0];
    try testing.expectEqualStrings("GitHub", item.title);
    try testing.expectEqualStrings("s3cret!", item.password.?);
    try testing.expectEqualStrings("Perso", item.tags[0]);
    try testing.expectEqualStrings("hidden", item.customFields[0].type);

    try testing.expectError(
        Error.EncryptedExport,
        parse(allocator, "{\"encrypted\":true,\"vaults\":[]}"),
    );
}

test "sameContent compare type, titre, identifiant et mot de passe" {
    const a: format.ItemContent = .{ .type = "login", .title = "GitHub", .username = "octocat", .password = "secret" };
    const b: format.ItemContent = .{ .type = "login", .title = "github", .username = "OCTOCAT", .password = "secret" };
    const c: format.ItemContent = .{ .type = "login", .title = "GitHub", .username = "octocat", .password = "autre" };
    try testing.expect(sameContent(&a, &b));
    try testing.expect(!sameContent(&a, &c));
}
