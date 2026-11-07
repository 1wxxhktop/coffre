//! Démonstration de l’interface avec le jeu d’essai v3, sans fichier externe.
//!
//!     zig build demo
//!     ./zig-out/bin/coffre-demo --nanoui-snapshot=/tmp/coffre-demo.png
//!
//! Le jeu d’essai et sa phrase de passe sont publics (ils ne protègent rien) ;
//! ce binaire n’est pas installé avec l’application.
const std = @import("std");
const nanoui = @import("nanoui");
const app = @import("app.zig");

const fixture = @embedFile("core/fixtures/v3.coffre.json");
const password = "phrase de passe de test solide";

pub fn main(init: std.process.Init) !void {
    const application = try nanoui.App.create(init, .{ .name = "Coffre (démo)" });
    defer application.destroy();

    var state = app.App.init(init.gpa, init.io);
    defer state.deinit();
    try state.openText(fixture, password);

    _ = try application.newWindow(.{
        .title = "Coffre — démonstration",
        .width = 1080,
        .height = 720,
        .min_width = 860,
        .min_height = 560,
        .theme = app.theme,
        .content = .{ .view = .init(&state, app.App.view) },
    });
    try application.run();
}
