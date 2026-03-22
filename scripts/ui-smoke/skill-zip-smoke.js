'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function parseVersionFromSkillMarkdown(content) {
  const matched = String(content || '').match(/^version:\s*"([^"]+)"/m);
  return matched ? matched[1] : '';
}

function parseSkillPublicVersion(content) {
  const matched = String(content || '').match(/const\s+SKILL_VERSION\s*=\s*'([^']+)'/);
  return matched ? matched[1] : '';
}

function extractCommands(content) {
  const commandsSection = String(content || '').match(/commands:\s*\[([\s\S]*?)\]/m);

  if (!commandsSection) {
    return [];
  }

  const matches = commandsSection[1].match(/'([^']+)'/g) || [];
  return matches.map((item) => item.slice(1, -1));
}

function hasRemovedDeleteCommand(content) {
  const text = String(content || '');
  return (
    /^\s*-\s*删除作业\s*$/m.test(text) ||
    /^\s*-\s*批量删除作业\s*$/m.test(text) ||
    /study-helper\.js\s+删除作业\b/.test(text) ||
    /study-helper\.js\s+批量删除作业\b/.test(text)
  );
}

function readZipEntry(zipPath, entryPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-helper-zip-'));

  try {
    const command = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('${String(zipPath).replace(/'/g, "''")}')
$entry = $zip.Entries | Where-Object { $_.FullName -eq '${String(entryPath).replace(/'/g, "''")}' } | Select-Object -First 1
if (-not $entry) { throw 'Zip entry not found: ${String(entryPath).replace(/'/g, "''")}' }
$target = '${String(path.join(tempDir, 'entry.txt')).replace(/'/g, "''")}'
[System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
$zip.Dispose()
`;

    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        stdio: 'ignore',
        windowsHide: true
      }
    );

    return fs.readFileSync(path.join(tempDir, 'entry.txt'), 'utf8');
  } finally {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true
    });
  }
}

async function maybeDownloadRemoteSkill(remoteUrl, outputDir) {
  if (!remoteUrl) {
    return null;
  }

  const response = await fetch(remoteUrl);

  if (!response.ok) {
    throw new Error(`Failed to download remote skill zip: HTTP ${response.status}`);
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer());
  const remoteZipPath = path.join(outputDir, 'downloaded-skill.zip');
  await fsPromises.writeFile(remoteZipPath, zipBuffer);
  return {
    remoteZipPath,
    sha256: crypto.createHash('sha256').update(zipBuffer).digest('hex')
  };
}

async function runSkillZipSmoke({ rootDir, outputDir }) {
  const failedChecks = [];
  const localSkillMarkdownPath = path.join(rootDir, 'skills', 'study-helper', 'SKILL.md');
  const localSkillMarkdown = await fsPromises.readFile(localSkillMarkdownPath, 'utf8');
  const expectedVersion = parseVersionFromSkillMarkdown(localSkillMarkdown);
  const skillPublicIndexPath = path.join(rootDir, 'cloudbase', 'functions', 'skillPublic', 'index.js');
  const skillPublicIndexContent = await fsPromises.readFile(skillPublicIndexPath, 'utf8');
  const skillPublicVersion = parseSkillPublicVersion(skillPublicIndexContent);
  const expectedCommands = extractCommands(skillPublicIndexContent);
  const localAssetZipPath = path.join(rootDir, 'cloudbase', 'functions', 'skillPublic', 'assets', 'study-helper.zip');
  const assetSkillMarkdown = readZipEntry(localAssetZipPath, 'study-helper/SKILL.md');
  const assetVersion = parseVersionFromSkillMarkdown(assetSkillMarkdown);

  if (!expectedVersion) {
    failedChecks.push('Unable to parse local skill version.');
  }

  if (assetVersion !== expectedVersion) {
    failedChecks.push(`skillPublic asset zip version mismatch: expected ${expectedVersion}, got ${assetVersion || '[missing]'}.`);
  }

  if (skillPublicVersion !== expectedVersion) {
    failedChecks.push(`skillPublic metadata version mismatch: expected ${expectedVersion}, got ${skillPublicVersion || '[missing]'}.`);
  }

  if (hasRemovedDeleteCommand(assetSkillMarkdown)) {
    failedChecks.push('skillPublic asset zip still contains removed homework delete commands.');
  }

  for (const commandName of expectedCommands) {
    if (!assetSkillMarkdown.includes(commandName)) {
      failedChecks.push(`skillPublic asset zip is missing command: ${commandName}`);
    }
  }

  let remote = null;
  const remoteUrl = process.env.STUDYGATE_SKILL_DOWNLOAD_URL || '';

  if (remoteUrl) {
    remote = await maybeDownloadRemoteSkill(remoteUrl, outputDir);
    const remoteSkillMarkdown = readZipEntry(remote.remoteZipPath, 'study-helper/SKILL.md');
    const remoteVersion = parseVersionFromSkillMarkdown(remoteSkillMarkdown);

    if (remoteVersion !== expectedVersion) {
      failedChecks.push(`remote skill zip version mismatch: expected ${expectedVersion}, got ${remoteVersion || '[missing]'}.`);
    }

    if (hasRemovedDeleteCommand(remoteSkillMarkdown)) {
      failedChecks.push('remote skill zip still contains removed homework delete commands.');
    }

    for (const commandName of expectedCommands) {
      if (!remoteSkillMarkdown.includes(commandName)) {
        failedChecks.push(`remote skill zip is missing command: ${commandName}`);
      }
    }
  }

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    expectedVersion,
    skillPublicVersion,
    assetVersion,
    localAssetZipPath,
    remote
  };
}

module.exports = {
  runSkillZipSmoke
};
