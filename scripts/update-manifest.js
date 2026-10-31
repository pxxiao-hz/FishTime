const fs = require("node:fs");
const path = require("node:path");

function createManifest(version, signature, notes, date = new Date()) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid update version");
  if (!signature || !/^[A-Za-z0-9+/=\r\n]+$/.test(signature)) throw new Error("Missing update signature");
  return {
    version, notes, pub_date: date.toISOString(),
    platforms: { "darwin-aarch64": {
      signature: signature.trim(),
      url: `https://github.com/pxxiao-hz/FishTime/releases/download/v${version}/FishTime.app.tar.gz`
    } }
  };
}

function writeManifest(root) {
  const version = JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version;
  const signature = fs.readFileSync(path.join(root,"src-tauri/target/release/bundle/macos/FishTime.app.tar.gz.sig"),"utf8");
  const notes = process.env.FISHTIME_RELEASE_NOTES
    ? fs.readFileSync(process.env.FISHTIME_RELEASE_NOTES,"utf8")
    : `FishTime ${version}：功能改进与问题修复。`;
  const manifest=createManifest(version,signature,notes);
  fs.mkdirSync(path.join(root,"dist"),{recursive:true});
  fs.writeFileSync(path.join(root,"dist/latest.json"),JSON.stringify(manifest,null,2)+"\n");
  console.log("Generated signed update manifest: dist/latest.json");
}
module.exports={createManifest,writeManifest};
