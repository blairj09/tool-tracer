// Copies the prebuilt OpenCV.js runtime from node_modules into public/ so it
// can be served as a static asset and loaded via a <script> tag at runtime.
// Run automatically via the "postinstall" npm script.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const src = join(projectRoot, 'node_modules', '@techstark', 'opencv-js', 'dist', 'opencv.js');
const publicDir = join(projectRoot, 'public');
const dest = join(publicDir, 'opencv.js');

if (!existsSync(src)) {
  console.warn(`[copy-opencv] source file not found at ${src}; skipping copy.`);
  process.exit(0);
}

if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}

copyFileSync(src, dest);
console.log(`[copy-opencv] copied opencv.js -> ${dest}`);
