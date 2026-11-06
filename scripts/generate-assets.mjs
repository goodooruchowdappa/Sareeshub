// Regenerates icons and the default social-share image. Run: node scripts/generate-assets.mjs
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const logo = readFileSync("public/favicon.svg");
const png = (size, svg = logo) => sharp(svg, { density: 512 }).resize(size, size).png().toBuffer();

writeFileSync("public/icons/icon-192.png", await png(192));
writeFileSync("public/icons/icon-512.png", await png(512));
writeFileSync("public/icons/apple-touch-icon.png", await png(180));
const maskable = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2f4938"/><g transform="translate(6 6) scale(0.7)">${logo
    .toString()
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")}</g></svg>`,
);
writeFileSync("public/icons/icon-maskable-512.png", await png(512, maskable));

// favicon.ico = ICO header wrapping a 32px PNG
const p32 = await png(32);
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(p32.length, 14); head.writeUInt32LE(22, 18);
writeFileSync("public/favicon.ico", Buffer.concat([head, p32]));

const stripes = Array.from({ length: 60 }, (_, i) =>
  `<rect x="${i * 20}" y="0" width="14" height="18" fill="#2f4938"/><rect x="${i * 20 + 14}" y="0" width="4" height="18" fill="#b0792a"/>`,
).join("");
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f9f5ee"/>
  <circle cx="1080" cy="80" r="260" fill="#e6b374" opacity="0.35"/>
  <circle cx="120" cy="620" r="240" fill="#c0d8c7" opacity="0.45"/>
  <g>${stripes}</g><g transform="translate(0 612)">${stripes}</g>
  <g transform="translate(90 150) scale(4.2)">${logo.toString().replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</g>
  <text x="290" y="235" font-family="Georgia, serif" font-size="92" font-weight="700" fill="#24382b">Sarees Hub</text>
  <text x="294" y="290" font-family="Helvetica, Arial, sans-serif" font-size="26" letter-spacing="6" fill="#78521c">SHOPS · WEAVERS · SAREES</text>
  <text x="90" y="420" font-family="Georgia, serif" font-size="54" fill="#18130e">Every saree shop and weaver,</text>
  <text x="90" y="485" font-family="Georgia, serif" font-size="54" font-style="italic" fill="#2f4938">on one map.</text>
  <text x="90" y="555" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#655c52">Pure pattu · Kanchipuram · Banarasi · Handloom — call or WhatsApp sellers directly</text>
</svg>`;
writeFileSync("public/og-default.png", await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toBuffer());
console.log("assets generated");
