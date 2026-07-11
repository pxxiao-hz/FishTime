const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".tauri-dist");
const files = ["index.html", "style.css", "main.js"];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, "assets", "bgm"), { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.copyFileSync(
  path.join(root, "assets", "bgm", "track1.mp3"),
  path.join(output, "assets", "bgm", "track1.mp3")
);

console.log(`Prepared Tauri web assets in ${output}`);
