const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "..", "public");
const assetsDir = path.join(__dirname, "assets");
const src = fs.readFileSync(path.join(assetsDir, "icon-source.svg"));
const maskableSrc = fs.readFileSync(path.join(assetsDir, "icon-maskable-source.svg"));

async function run() {
  await sharp(src).resize(512, 512).png().toFile(path.join(publicDir, "icon-512.png"));
  await sharp(src).resize(192, 192).png().toFile(path.join(publicDir, "icon-192.png"));
  await sharp(src).resize(180, 180).png().toFile(path.join(publicDir, "apple-touch-icon.png"));
  await sharp(src).resize(32, 32).png().toFile(path.join(publicDir, "favicon-32.png"));
  await sharp(maskableSrc)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, "icon-maskable-512.png"));
  console.log("icons generated");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
