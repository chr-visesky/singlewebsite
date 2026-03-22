'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const REQUIRED_PACKAGES = Object.freeze([
  Object.freeze({ id: 'PDFtoImage', version: '5.2.0' }),
  Object.freeze({ id: 'SkiaSharp', version: '3.119.1' }),
  Object.freeze({ id: 'SkiaSharp.NativeAssets.Linux.NoDependencies', version: '3.119.1' }),
  Object.freeze({ id: 'SkiaSharp.NativeAssets.WebAssembly', version: '3.119.1' }),
  Object.freeze({ id: 'SkiaSharp.NativeAssets.Win32', version: '3.119.1' }),
  Object.freeze({ id: 'SkiaSharp.NativeAssets.macOS', version: '3.119.1' }),
  Object.freeze({ id: 'Sungaila.PDFium.BlazorWebAssembly', version: '134.0.6982' }),
  Object.freeze({ id: 'bblanchon.PDFium.Linux', version: '139.0.7215' }),
  Object.freeze({ id: 'bblanchon.PDFium.Win32', version: '139.0.7215' }),
  Object.freeze({ id: 'bblanchon.PDFium.macOS', version: '139.0.7215' }),
  Object.freeze({ id: 'Microsoft.NETCore.App.Runtime.win-x64', version: '10.0.5' }),
  Object.freeze({ id: 'Microsoft.WindowsDesktop.App.Runtime.win-x64', version: '10.0.5' }),
  Object.freeze({ id: 'Microsoft.AspNetCore.App.Runtime.win-x64', version: '10.0.5' })
]);

function flatContainerUrl(packageId, version) {
  const normalizedId = String(packageId).trim().toLowerCase();
  const normalizedVersion = String(version).trim().toLowerCase();
  return `https://api.nuget.org/v3-flatcontainer/${normalizedId}/${normalizedVersion}/${normalizedId}.${normalizedVersion}.nupkg`;
}

async function ensurePackage(feedDir, item) {
  const fileName = `${item.id.toLowerCase()}.${item.version.toLowerCase()}.nupkg`;
  const filePath = path.join(feedDir, fileName);

  if (fs.existsSync(filePath)) {
    const stats = await fsPromises.stat(filePath);
    return {
      id: item.id,
      version: item.version,
      filePath,
      downloaded: false,
      sizeBytes: stats.size
    };
  }

  const response = await fetch(flatContainerUrl(item.id, item.version));

  if (!response.ok) {
    throw new Error(`下载 ${item.id} ${item.version} 失败：HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fsPromises.writeFile(filePath, buffer);

  return {
    id: item.id,
    version: item.version,
    filePath,
    downloaded: true,
    sizeBytes: buffer.length
  };
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const feedDir = path.join(rootDir, '.nuget-local-feed');
  await fsPromises.mkdir(feedDir, { recursive: true });

  const files = [];

  for (const item of REQUIRED_PACKAGES) {
    files.push(await ensurePackage(feedDir, item));
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    feedDir,
    files
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
