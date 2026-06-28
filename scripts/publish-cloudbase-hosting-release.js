'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCloudPath(value) {
  return normalizePrefix(value).replace(/^\/+|\/+$/g, '');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readEnvId(rootDir) {
  const configured = normalizePrefix(process.env.STUDYGATE_CLOUDBASE_ENV_ID || process.env.CLOUDBASE_ENV_ID);

  if (configured) {
    return configured;
  }

  const rootCloudbaseRc = readJsonIfExists(path.join(rootDir, 'cloudbaserc.json'));
  return normalizePrefix(rootCloudbaseRc && rootCloudbaseRc.envId) || 'selfuse-5g3tkjfq0ede092b';
}

function readBaseUrl(rootDir, prefix) {
  const configured = normalizePrefix(process.env.STUDYGATE_CLOUDBASE_HOSTING_BASE_URL);

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const appConfig = readJsonIfExists(path.join(rootDir, 'config.json'));
  const updateUrl = normalizePrefix(appConfig && appConfig.autoUpdate && appConfig.autoUpdate.url);

  if (updateUrl) {
    return updateUrl.replace(/\/+$/, '');
  }

  return `https://selfuse-5g3tkjfq0ede092b-1324687027.tcloudbaseapp.com/${prefix}`.replace(/\/+$/, '');
}

function findArtifacts(outputDir) {
  const latestYmlPath = path.join(outputDir, 'latest.yml');
  const manifestPath = path.join(outputDir, 'update-manifest.json');

  if (!fs.existsSync(latestYmlPath) || !fs.existsSync(manifestPath)) {
    return {
      metadataFiles: [latestYmlPath, manifestPath].filter((filePath) => fs.existsSync(filePath)),
      payloadFiles: []
    };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const zipFileName = normalizePrefix(manifest && manifest.zip && manifest.zip.fileName);
  const installerFileName = normalizePrefix(manifest && manifest.installer && manifest.installer.fileName);
  const payloadFiles = [zipFileName, installerFileName]
    .filter(Boolean)
    .map((fileName) => path.join(outputDir, fileName))
    .filter((filePath) => fs.existsSync(filePath));

  return {
    metadataFiles: [latestYmlPath, manifestPath],
    payloadFiles
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}\n${result.stderr || result.stdout || ''}`);
  }

  return `${result.stdout || ''}${result.stderr || ''}`;
}

function parseFirstJsonObject(output) {
  const text = String(output || '');
  const start = text.indexOf('{');

  if (start < 0) {
    throw new Error(`Unable to parse JSON output: ${text}`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return JSON.parse(text.slice(start, index + 1));
      }
    }
  }

  throw new Error(`Unable to find complete JSON object in output: ${text}`);
}

function uploadFile({ nodePath, cliPath, envId, prefix, filePath }) {
  const fileName = path.basename(filePath);
  const cloudPath = `${prefix}/${fileName}`;

  run(nodePath, [cliPath, 'hosting', 'deploy', filePath, cloudPath, '--env-id', envId, '--json']);

  return {
    fileName,
    cloudPath,
    size: fs.statSync(filePath).size
  };
}

function cleanupStaleFiles({ nodePath, cliPath, envId, prefix, currentFileNames }) {
  const output = runCapture(nodePath, [cliPath, 'hosting', 'list', prefix, '--env-id', envId, '--json']);
  const listing = parseFirstJsonObject(output);
  const items = Array.isArray(listing.data) ? listing.data : [];
  const keep = new Set(currentFileNames);
  const deleted = [];

  for (const item of items) {
    const key = item && item.key;
    const fileName = path.posix.basename(String(key || '').replace(/\\/g, '/'));

    if (!key || keep.has(fileName)) {
      continue;
    }

    run(nodePath, [cliPath, 'hosting', 'delete', key, '--env-id', envId, '--json']);
    deleted.push(key);
  }

  return deleted;
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const outputDir = path.join(rootDir, 'dist');
  const prefix = normalizeCloudPath(process.env.STUDYGATE_CLOUDBASE_HOSTING_PREFIX || process.env.STUDYGATE_COS_PREFIX) || 'studygate-updates/latest';
  const envId = readEnvId(rootDir);
  const baseUrl = readBaseUrl(rootDir, prefix);
  const cliPath = path.join(rootDir, 'tools', 'wechat-cli', 'node_modules', '@cloudbase', 'cli', 'bin', 'cloudbase');
  const { metadataFiles, payloadFiles } = findArtifacts(outputDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'update-manifest.json'), 'utf8'));

  if (!payloadFiles.length || !metadataFiles.length) {
    throw new Error('Update artifacts are incomplete. Run npm run build before publishing.');
  }

  const uploaded = [];

  for (const filePath of payloadFiles) {
    uploaded.push(uploadFile({
      nodePath: process.execPath,
      cliPath,
      envId,
      prefix,
      filePath
    }));
  }

  for (const filePath of metadataFiles) {
    uploaded.push(uploadFile({
      nodePath: process.execPath,
      cliPath,
      envId,
      prefix,
      filePath
    }));
  }

  const currentFileNames = [...payloadFiles, ...metadataFiles].map((filePath) => path.basename(filePath));
  const deletedStaleFiles = cleanupStaleFiles({
    nodePath: process.execPath,
    cliPath,
    envId,
    prefix,
    currentFileNames
  });

  const report = {
    uploadedAt: new Date().toISOString(),
    envId,
    baseUrl,
    deletedStaleFiles,
    files: uploaded.map((file) => ({
      ...file,
      url: `${baseUrl}/${encodeURIComponent(file.fileName)}`
    }))
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
