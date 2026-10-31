// Remove machine-specific source paths from Rust diagnostics in public bundles.
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY || path.join(os.homedir(),".config","fishtime","signing","updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !fs.existsSync(signingKey)) {
  console.error("A release requires the FishTime updater signing key. Set TAURI_SIGNING_PRIVATE_KEY or build locally with createUpdaterArtifacts disabled.");
  process.exit(1);
}
const existingFlags = process.env.CARGO_ENCODED_RUSTFLAGS
  ? process.env.CARGO_ENCODED_RUSTFLAGS.split("\x1f")
  : (process.env.RUSTFLAGS || "").split(/\s+/).filter(Boolean);
const flags = [
  ...existingFlags,
  `--remap-path-prefix=${os.homedir()}=/build`,
  `--remap-path-prefix=${root}=/source/fishtime`
];
const result = spawnSync(process.execPath, [
  path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
  "build", ...process.argv.slice(2)
], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f"),
    TAURI_SIGNING_PRIVATE_KEY: signingKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || ""
  }
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status === 0) require("./update-manifest").writeManifest(root);
process.exit(result.status ?? 1);
