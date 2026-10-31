// Remove machine-specific source paths from Rust diagnostics in public bundles.
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
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
  env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") }
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
