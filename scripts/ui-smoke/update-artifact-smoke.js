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
  const failedChecks = [];

  const [latestYml, manifestText, buildVersionText] = await Promise.all([
    fs.readFile(latestYmlPath, 'utf8').catch(() => ''),
    fs.readFile(manifestPath, 'utf8').catch(() => ''),
    fs.readFile(buildVersionPath, 'utf8').catch(() => '')
  ]);

  if (!latestYml) {
    failedChecks.push('缺少 dist/latest.yml，自升级元数据没有生成。');
  }

  if (!manifestText) {
    failedChecks.push('缺少 dist/update-manifest.json，自升级发布清单没有生成。');
  }

  const manifest = manifestText ? JSON.parse(manifestText) : {};
  const expectedVersion = buildVersionText.trim();
  const yamlVersion = parseYamlVersion(latestYml);

  if (!expectedVersion) {
    failedChecks.push('缺少 dist/build-version.txt，自升级构建版本没有落盘。');
  }

  if (yamlVersion && yamlVersion !== expectedVersion) {
    failedChecks.push(`latest.yml 版本不一致：expected ${expectedVersion}, got ${yamlVersion}`);
  }

  if (manifest.version && manifest.version !== expectedVersion) {
    failedChecks.push(`update-manifest.json 版本不一致：expected ${expectedVersion}, got ${manifest.version}`);
  }

  if (!manifest.zip || manifest.zip.fileName !== path.basename(zipPath)) {
    failedChecks.push('update-manifest.json 没有指向 StudyGate-win32-x64.zip。');
  }

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    latestYmlPath,
    manifestPath,
    expectedVersion,
    yamlVersion,
    manifestVersion: manifest.version || ''
  };
}

module.exports = {
  runUpdateArtifactSmoke
};
