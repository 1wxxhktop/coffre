//! Coffre — application desktop native (Zig + nanoui).
//!
//! Le cœur (crypto, format `.coffre`, import) vit dans `src/core/` et ne dépend
//! pas de l’interface. L’interface est une vue immédiate nanoui.
const std = @import("std");
const nanoui = @import("nanoui");
const App = @import("app.zig").App;
const theme = @import("app.zig").theme;

pub fn main(init: std.process.Init) !void {
    const app = try nanoui.App.create(init, .{ .name = "Coffre" });
    defer app.destroy();

    var state = App.init(init.gpa, init.io);
    defer state.deinit();
    state.loadSettings();

    // Propose le dernier coffre ouvert au lancement précédent.
    const kv = nanoui.kv.standard();
    if (kv.get(init.gpa, "last_vault") catch null) |path| {
        defer init.gpa.free(path);
        state.setPath(path) catch {};
    }

    try app.setMenu(&.{
        .{ .role = .app_menu },
        .{ .label = "Fichier", .submenu = &.{
            .{ .label = "Nouvel élément", .accelerator = "CmdOrCtrl+N", .click = .of(&state, App.menuCreate) },
            .{ .label = "Importer…", .accelerator = "CmdOrCtrl+I", .click = .of(&state, App.menuImport) },
            .{ .label = "Rechercher", .accelerator = "CmdOrCtrl+F", .click = .of(&state, App.menuSearch) },
            .separator,
            .{ .label = "Verrouiller", .accelerator = "CmdOrCtrl+L", .click = .of(&state, App.menuLock) },
        } },
        .{ .role = .edit_menu },
        .{ .role = .window_menu },
    });

    _ = try app.newWindow(.{
        .title = "Coffre",
        .width = 1080,
        .height = 720,
        .min_width = 860,
        .min_height = 560,
        .theme = theme,
        .content = .{ .view = .init(&state, App.view) },
    });
    try app.run();
}
