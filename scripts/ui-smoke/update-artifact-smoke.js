'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function parseYamlVersion(content) {
  const matched = String(content || '').match(/^version:\s*(.+)$/m);
  return matched ? matched[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

async function runUpdateArtifactSmoke({ rootDir }) {
  const distDir = path.join(rootDir, 'dist');
  const latestYmlPath = path.join(distDir, 'latest.yml');
  const manifestPath = path.join(distDir, 'update-manifest.json');
  const buildVersionPath = path.join(distDir, 'build-version.txt');
  const zipPath = path.join(distDir, 'StudyGate-win32-x64.zip');
  const packagedUpdateConfigPath = path.join(distDir, 'StudyGate-win32-x64', 'resources', 'app-update.yml');
  const failedChecks = [];

  const [latestYml, manifestText, buildVersionText, packagedUpdateConfigText] = await Promise.all([
    fs.readFile(latestYmlPath, 'utf8').catch(() => ''),
    fs.readFile(manifestPath, 'utf8').catch(() => ''),
    fs.readFile(buildVersionPath, 'utf8').catch(() => ''),
    fs.readFile(packagedUpdateConfigPath, 'utf8').catch(() => '')
  ]);

  if (!latestYml) {
    failedChecks.push('Missing dist/latest.yml.');
  }

  if (!manifestText) {
    failedChecks.push('Missing dist/update-manifest.json.');
  }

  if (!packagedUpdateConfigText) {
    failedChecks.push('Missing dist/StudyGate-win32-x64/resources/app-update.yml.');
  }

  const manifest = manifestText ? JSON.parse(manifestText) : {};
  const expectedVersion = buildVersionText.trim();
  const yamlVersion = parseYamlVersion(latestYml);

  if (!expectedVersion) {
    failedChecks.push('Missing dist/build-version.txt.');
  }

  if (yamlVersion && yamlVersion !== expectedVersion) {
    failedChecks.push(`latest.yml version mismatch: expected ${expectedVersion}, got ${yamlVersion}`);
  }

  if (manifest.version && manifest.version !== expectedVersion) {
    failedChecks.push(`update-manifest.json version mismatch: expected ${expectedVersion}, got ${manifest.version}`);
  }

  if (!manifest.zip || manifest.zip.fileName !== path.basename(zipPath)) {
    failedChecks.push('update-manifest.json does not point to StudyGate-win32-x64.zip.');
  }

  if (packagedUpdateConfigText && !/updaterCacheDirName:\s*singlewebsite-updater/i.test(packagedUpdateConfigText)) {
    failedChecks.push('app-update.yml is missing updaterCacheDirName.');
  }

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    latestYmlPath,
    manifestPath,
    packagedUpdateConfigPath,
    expectedVersion,
    yamlVersion,
    manifestVersion: manifest.version || ''
  };
}

module.exports = {
  runUpdateArtifactSmoke
};
