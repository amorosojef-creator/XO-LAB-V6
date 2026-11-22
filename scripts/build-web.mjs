// XO LAB — copies the web app into www/ (the folder the iPhone app is built from).
// The app itself has no build step: index.html + css/ + js/ + vendor/ + assets/ run as-is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
const ITEMS = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'vendor', 'assets'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0, bytes = 0;
for (const item of ITEMS) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) { console.error('Missing: ' + item); process.exit(1); }
  fs.cpSync(src, path.join(out, item), { recursive: true });
}
(function count(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) count(p); else { files++; bytes += fs.statSync(p).size; } } })(out);
// sanity: every <script src> in index.html must exist in the build
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const missing = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !fs.existsSync(path.join(out, s)));
if (missing.length) { console.error('index.html references missing files: ' + missing.join(', ')); process.exit(1); }
console.log(`Built www/ — ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
