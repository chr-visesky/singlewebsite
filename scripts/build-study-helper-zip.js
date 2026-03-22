'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function escapePowerShellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function readSkillVersion(skillMarkdownPath) {
  const content = fs.readFileSync(skillMarkdownPath, 'utf8');
  const matched = content.match(/^version:\s*"([^"]+)"/m);

  if (!matched) {
    throw new Error(`Unable to find version frontmatter in ${skillMarkdownPath}`);
  }

  return matched[1];
}

async function ensureDirectory(dirPath) {
  await fsPromises.mkdir(dirPath, {
    recursive: true
  });
}

async function removeFileIfExists(filePath) {
  try {
    await fsPromises.rm(filePath, {
      force: true
    });
  } catch {
    // Ignore cleanup failures.
  }
}

function buildZipWithPowerShell(sourceDir, destinationZip) {
  const command = `
$source = '${escapePowerShellSingleQuoted(sourceDir)}'
$destination = '${escapePowerShellSingleQuoted(destinationZip)}'
Compress-Archive -Path $source -DestinationPath $destination -Force
`;

  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      stdio: 'inherit',
      windowsHide: true
    }
  );
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const skillDir = path.join(rootDir, 'skills', 'study-helper');
  const skillMarkdownPath = path.join(skillDir, 'SKILL.md');
  const distDir = path.join(rootDir, 'dist', 'openclaw-skills');
  const distZipPath = path.join(distDir, 'study-helper.zip');
  const skillPublicAssetDir = path.join(rootDir, 'cloudbase', 'functions', 'skillPublic', 'assets');
  const skillPublicZipPath = path.join(skillPublicAssetDir, 'study-helper.zip');
  const version = readSkillVersion(skillMarkdownPath);

  await ensureDirectory(distDir);
  await ensureDirectory(skillPublicAssetDir);
  await removeFileIfExists(distZipPath);
  await removeFileIfExists(skillPublicZipPath);

  buildZipWithPowerShell(skillDir, distZipPath);
  await fsPromises.copyFile(distZipPath, skillPublicZipPath);

  const stats = await fsPromises.stat(distZipPath);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      version,
      distZipPath,
      skillPublicZipPath,
      sizeBytes: stats.size
    }, null, 2)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
