// electron-builder never copies node_modules folders from extraResources, but the
// bundled invariant-ui needs its dependencies beside it. Runs before code signing.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack({ appOutDir, packager, electronPlatformName }) {
  const resources =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const from = path.join(__dirname, "..", "resources", "invariant", "node_modules");
  if (!fs.existsSync(from)) throw new Error(`${from} is missing; run npm run fetch-invariant first.`);
  // Skip .bin: cpSync copies its links as absolute paths into this checkout, which codesign rejects.
  fs.cpSync(from, path.join(resources, "invariant", "node_modules"), {
    recursive: true,
    filter: (src) => path.basename(src) !== ".bin",
  });
};
