/**
 * 将 Cornerstone 各编解码器的 WASM 文件复制到 dist/wasm/，
 * 使发布后的 @open-med/viewer 包自带压缩 DICOM 解码能力。
 *
 * 运行时默认从 <base>/wasm/ 加载，可通过
 * `CornerstoneImageDecoder.setWasmBasePath('/your/path/')` 覆盖。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'dist/wasm');

const FILES = [
  ['node_modules/@cornerstonejs/codec-libjpeg-turbo-8bit/dist', 'libjpegturbowasm_decode.wasm'],
  ['node_modules/@cornerstonejs/codec-openjpeg/dist', 'openjpegwasm_decode.wasm'],
  ['node_modules/@cornerstonejs/codec-charls/dist', 'charlswasm_decode.wasm'],
  ['node_modules/@cornerstonejs/codec-openjph/dist', 'openjphjs.wasm'],
  ['node_modules/@cornerstonejs/codec-libjxl/dist', 'jpegxlwasm_decode.wasm']
];

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const [fromDir, file] of FILES) {
  const src = resolve(root, fromDir, file);
  if (!existsSync(src)) {
    console.warn(`[copy-wasm] 跳过（未安装对应编解码器）: ${file}`);
    continue;
  }
  copyFileSync(src, resolve(outDir, file));
  copied++;
}

console.log(`[copy-wasm] 已复制 ${copied} 个 WASM 编解码器到 dist/wasm/`);
