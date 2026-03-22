'use strict';

const fs = require('fs');
const path = require('path');
const COS = require('cos-nodejs-sdk-v5');

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredEnv(name) {
  const value = normalizePrefix(process.env[name]);

  if (!value) {
    throw new Error(`缺少环境变量 ${name}。`);
  }

  return value;
}

function cacheControlForFile(fileName) {
  const normalized = String(fileName || '').toLowerCase();

  if (normalized.endsWith('latest.yml') || normalized.endsWith('update-manifest.json')) {
    return 'no-cache';
  }

  return 'public, max-age=31536000, immutable';
}

function joinCosKey(prefix, fileName) {
  const normalizedPrefix = normalizePrefix(prefix).replace(/^\/+|\/+$/g, '');
  return normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName;
}

async function putObject(cos, options) {
  return new Promise((resolve, reject) => {
    cos.putObject(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

async function uploadFile(cos, baseOptions, filePath) {
  const fileName = path.basename(filePath);
  const key = joinCosKey(baseOptions.prefix, fileName);

  await putObject(cos, {
    Bucket: baseOptions.bucket,
    Region: baseOptions.region,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: fs.statSync(filePath).size,
    CacheControl: cacheControlForFile(fileName)
  });

  return {
    fileName,
    key,
    size: fs.statSync(filePath).size
  };
}

function findArtifacts(outputDir) {
  const latestYmlPath = path.join(outputDir, 'latest.yml');
  const manifestPath = path.join(outputDir, 'update-manifest.json');
  const zipPath = path.join(outputDir, 'StudyGate-win32-x64.zip');
  const files = [latestYmlPath, manifestPath, zipPath];
  const installerPaths = fs.readdirSync(outputDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.exe') || fileName.toLowerCase().endsWith('.blockmap'))
    .map((fileName) => path.join(outputDir, fileName));

  return [...files, ...installerPaths].filter((filePath) => fs.existsSync(filePath));
}

function publicBaseUrl(bucket, region, prefix) {
  const configured = normalizePrefix(process.env.STUDYGATE_COS_PUBLIC_BASE_URL);

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const normalizedPrefix = normalizePrefix(prefix).replace(/^\/+|\/+$/g, '');
  const baseUrl = `https://${bucket}.cos.${region}.myqcloud.com`;
  return normalizedPrefix ? `${baseUrl}/${normalizedPrefix}` : baseUrl;
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const outputDir = path.join(rootDir, 'dist');
  const bucket = requiredEnv('STUDYGATE_COS_BUCKET');
  const region = requiredEnv('STUDYGATE_COS_REGION');
  const secretId = requiredEnv('STUDYGATE_COS_SECRET_ID');
  const secretKey = requiredEnv('STUDYGATE_COS_SECRET_KEY');
  const prefix = normalizePrefix(process.env.STUDYGATE_COS_PREFIX) || 'studygate/releases/latest';
  const cos = new COS({
    SecretId: secretId,
    SecretKey: secretKey
  });
  const artifacts = findArtifacts(outputDir);

  if (!artifacts.length) {
    throw new Error('dist 目录下找不到可上传的更新产物。先运行 npm run build。');
  }

  const uploaded = [];

  for (const filePath of artifacts) {
    uploaded.push(await uploadFile(cos, {
      bucket,
      region,
      prefix
    }, filePath));
  }

  const baseUrl = publicBaseUrl(bucket, region, prefix);
  const report = {
    uploadedAt: new Date().toISOString(),
    baseUrl,
    files: uploaded
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
