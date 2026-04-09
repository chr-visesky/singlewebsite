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
    throw new Error(`Missing required environment variable: ${name}`);
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

  if (!fs.existsSync(latestYmlPath) || !fs.existsSync(manifestPath)) {
    return {
      metadataFiles: [latestYmlPath, manifestPath].filter((filePath) => fs.existsSync(filePath)),
      payloadFiles: []
    };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const payloadFiles = [];
  const zipFileName = normalizePrefix(manifest && manifest.zip && manifest.zip.fileName);
  const installerFileName = normalizePrefix(manifest && manifest.installer && manifest.installer.fileName);

  if (zipFileName) {
    payloadFiles.push(path.join(outputDir, zipFileName));
  }

  if (installerFileName) {
    payloadFiles.push(path.join(outputDir, installerFileName));
    const installerBlockmapPath = path.join(outputDir, `${installerFileName}.blockmap`);

    if (fs.existsSync(installerBlockmapPath)) {
      payloadFiles.push(installerBlockmapPath);
    }
  }

  return {
    metadataFiles: [latestYmlPath, manifestPath],
    payloadFiles: payloadFiles.filter((filePath) => fs.existsSync(filePath))
  };
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
  const prefix = normalizePrefix(process.env.STUDYGATE_COS_PREFIX) || 'studygate-updates/latest';
  const cos = new COS({
    SecretId: secretId,
    SecretKey: secretKey
  });
  const { metadataFiles, payloadFiles } = findArtifacts(outputDir);
  const artifacts = [...payloadFiles, ...metadataFiles];

  if (!artifacts.length) {
    throw new Error('No update artifacts were found in dist. Run npm run build first.');
  }

  if (!payloadFiles.length || !metadataFiles.length) {
    throw new Error('Update artifacts are incomplete. Generate the installer and latest.yml/update-manifest.json first.');
  }

  const uploaded = [];

  for (const filePath of payloadFiles) {
    uploaded.push(await uploadFile(cos, {
      bucket,
      region,
      prefix
    }, filePath));
  }

  for (const filePath of metadataFiles) {
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
