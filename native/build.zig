const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const nanoui = b.dependency("nanoui", .{ .target = target, .optimize = optimize }).module("nanoui");

    const exe = b.addExecutable(.{ .name = "coffre", .root_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "nanoui", .module = nanoui }},
    }) });
    // Une fenêtre à elle sur Windows, sans console.
    if (target.result.os.tag == .windows) exe.subsystem = .windows;
    b.installArtifact(exe);

    const run = b.addRunArtifact(exe);
    run.addPassthruArgs();
    b.step("run", "Lancer Coffre (ouvre sa fenêtre)").dependOn(&run.step);

    // Binaire de démonstration : ouvre le jeu d’essai v3 sans fichier externe.
    const demo = b.addExecutable(.{ .name = "coffre-demo", .root_module = b.createModule(.{
        .root_source_file = b.path("src/demo.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "nanoui", .module = nanoui }},
    }) });
    if (target.result.os.tag == .windows) demo.subsystem = .windows;
    b.installArtifact(demo);
    const run_demo = b.addRunArtifact(demo);
    run_demo.addPassthruArgs();
    b.step("demo", "Lancer la démonstration avec le jeu d’essai v3").dependOn(&run_demo.step);

    // Les tests du cœur ne dépendent pas de l’interface.
    const core_tests = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("src/core/tests.zig"),
        .target = target,
        .optimize = optimize,
    }) });
    b.step("test-core", "Tests du cœur (crypto, format, coffre)").dependOn(&b.addRunArtifact(core_tests).step);

    // Les tests de l’interface rendent la vue hors écran, sans fenêtre.
    const ui_tests = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("src/tests.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "nanoui", .module = nanoui }},
    }) });
    const test_step = b.step("test", "Tous les tests");
    test_step.dependOn(&b.addRunArtifact(core_tests).step);
    test_step.dependOn(&b.addRunArtifact(ui_tests).step);
}
