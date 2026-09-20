import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const tvOutput = path.join(projectRoot, 'dist', 'tv');

// A small dependency-free PNG encoder for the application's geometric play icon.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createIcon() {
  const size = 117;
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      const radius = Math.hypot(x - 58, y - 58);
      let color = [13, 21, 34];
      if (radius < 45) color = [20, 48, 59];
      if (radius > 42 && radius < 45) color = [84, 223, 189];
      if (x >= 45 && x <= 80 && Math.abs(y - 58) <= (80 - x) * 0.68) color = [125, 248, 214];
      pixels.set([...color, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function buildTv() {
  const source = path.join(projectRoot, 'tv');
  for (const required of ['index.html', 'config.xml']) {
    if (!existsSync(path.join(source, required))) throw new Error(`Missing tv/${required}`);
  }
  // Only this generated output directory is replaced; source and credentials stay outside it.
  await rm(tvOutput, { recursive: true, force: true });
  await mkdir(tvOutput, { recursive: true });
  await cp(source, tvOutput, {
    recursive: true,
    filter: (file) => !path.relative(source, file).split(path.sep).some((part) => part.startsWith('.') || part.endsWith('.wgt')),
  });
  await writeFile(path.join(tvOutput, 'icon.png'), createIcon());
  const hlsSource = path.join(projectRoot, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
  if (existsSync(hlsSource)) {
    await mkdir(path.join(tvOutput, 'vendor'), { recursive: true });
    await cp(hlsSource, path.join(tvOutput, 'vendor', 'hls.min.js'));
    const license = path.join(projectRoot, 'node_modules', 'hls.js', 'LICENSE');
    if (existsSync(license)) await cp(license, path.join(tvOutput, 'vendor', 'hls.LICENSE'));
  } else {
    console.warn('hls.js is not installed. The Samsung app uses native AVPlay; browser HLS playback needs npm install.');
  }
  const manifest = await readFile(path.join(tvOutput, 'config.xml'), 'utf8');
  if (!manifest.includes('required_version="2.4"')) throw new Error('TV manifest must target Tizen 2.4.');
  console.log(`TV files prepared: ${tvOutput}`);
  console.log('This is an unsigned app directory. Use package-tv with your Samsung certificate profile to create a .wgt.');
  return tvOutput;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildTv().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
