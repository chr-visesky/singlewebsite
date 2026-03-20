'use strict';

const fs = require('fs');
const fsPromises = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDotnetCommand() {
  const systemDrive = process.env.SystemDrive || 'C:';
  const candidates = [
    process.env.DOTNET_ROOT ? path.join(process.env.DOTNET_ROOT, 'dotnet.exe') : '',
    process.env.DOTNET_ROOT_X64 ? path.join(process.env.DOTNET_ROOT_X64, 'dotnet.exe') : '',
    path.join(systemDrive, 'dotnet', 'dotnet.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'dotnet.exe'),
    'dotnet'
  ].filter(Boolean);

  return candidates.find((candidate) => candidate === 'dotnet' || fs.existsSync(candidate)) || 'dotnet';
}

function stopRunningProcesses() {
  const taskkillPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');

  try {
    execFileSync(
      taskkillPath,
      ['/F', '/IM', 'StudyGate.exe', '/IM', 'HomeworkApp.exe', '/T'],
      {
        stdio: 'ignore',
        windowsHide: true
      }
    );
  } catch {
    // Ignore when processes are not running.
  }
}

async function removePathWithRetries(targetPath, options = {}) {
  const {
    retries = 8,
    delayMs = 500,
    rmOptions = { recursive: true, force: true }
  } = options;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await fsPromises.rm(targetPath, rmOptions);
      return;
    } catch (error) {
      const code = error && error.code ? error.code : '';

      if ((code === 'EBUSY' || code === 'EPERM') && attempt < retries) {
        await sleep(delayMs);
        continue;
      }

      throw error;
    }
  }
}

async function packageApp() {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = require(path.join(projectRoot, 'package.json'));
  const options = packageJson.singleWebsite || {};
  const productName = options.productName || 'StudyGate';
  const outputDir = path.join(projectRoot, options.outputDir || 'dist');
  const appDirName = `${productName}-win32-x64`;
  const appDir = path.join(outputDir, appDirName);
  const zipPath = path.join(outputDir, `${appDirName}.zip`);
  const stagingRootDir = path.join(outputDir, '.packaging');
  const stagedAppDir = path.join(stagingRootDir, appDirName);
  const stagedZipPath = path.join(stagingRootDir, `${appDirName}.zip`);
  const configSource = path.join(projectRoot, 'config.json');
  const secretConfigSource = path.join(projectRoot, 'config.secrets.json');
  const videosSourceDir = path.join(projectRoot, 'videos');
  const bannerSourceDir = path.join(projectRoot, 'banner');
  const homeworkProjectPath = path.join(projectRoot, 'modules', 'HomeworkApp', 'HomeworkApp.csproj');
  const homeworkPublishDir = path.join(projectRoot, 'modules', 'HomeworkApp', 'bin', 'Release', 'studygate-publish');
  const electronDistDir = path.join(projectRoot, 'node_modules', 'electron', 'dist');
  const stagedRuntimeAppDir = path.join(stagedAppDir, 'resources', 'app');
  const stagedRuntimeModulesDir = path.join(stagedAppDir, 'modules');
  const vendorPiperRuntimeDir = path.join(projectRoot, 'vendor', 'piper', 'runtime');
  const vendorPiperModelsDir = path.join(projectRoot, 'vendor', 'piper', 'models');
  const stagedRuntimeVendorPiperDir = path.join(stagedRuntimeAppDir, 'vendor', 'piper');
  const tarPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const dotnetCommand = resolveDotnetCommand();
  const runtimePackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    main: packageJson.main,
    productName
  };

  await fsPromises.mkdir(outputDir, { recursive: true });

  if (await fsPromises.stat(homeworkProjectPath).then((stats) => stats.isFile()).catch(() => false)) {
    await removePathWithRetries(homeworkPublishDir);
    execFileSync(
      dotnetCommand,
      [
        'publish',
        homeworkProjectPath,
        '-c',
        'Release',
        '-r',
        'win-x64',
        '--self-contained',
        'true',
        '-p:PublishSingleFile=true',
        '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-o',
        homeworkPublishDir
      ],
      {
        cwd: projectRoot,
        windowsHide: true
      }
    );
  }

  await removePathWithRetries(stagingRootDir);
  await fsPromises.mkdir(stagingRootDir, { recursive: true });
  await fsPromises.cp(electronDistDir, stagedAppDir, { recursive: true });
  await fsPromises.rename(path.join(stagedAppDir, 'electron.exe'), path.join(stagedAppDir, `${productName}.exe`));
  await fsPromises.mkdir(stagedRuntimeAppDir, { recursive: true });
  await fsPromises.mkdir(stagedRuntimeModulesDir, { recursive: true });
  await fsPromises.writeFile(
    path.join(stagedRuntimeAppDir, 'package.json'),
    `${JSON.stringify(runtimePackageJson, null, 2)}${os.EOL}`,
    'utf8'
  );
  await fsPromises.cp(path.join(projectRoot, 'src'), path.join(stagedRuntimeAppDir, 'src'), { recursive: true });
  await fsPromises.mkdir(stagedRuntimeVendorPiperDir, { recursive: true });
  await fsPromises.cp(vendorPiperRuntimeDir, path.join(stagedRuntimeVendorPiperDir, 'runtime'), { recursive: true });
  await fsPromises.cp(vendorPiperModelsDir, path.join(stagedRuntimeVendorPiperDir, 'models'), { recursive: true });
  await fsPromises.copyFile(configSource, path.join(stagedRuntimeAppDir, 'embedded-config.json'));

  if (await fsPromises.stat(secretConfigSource).then((stats) => stats.isFile()).catch(() => false)) {
    await fsPromises.copyFile(secretConfigSource, path.join(stagedRuntimeAppDir, 'embedded-config.secrets.json'));
  }

  if (await fsPromises.stat(homeworkPublishDir).then((stats) => stats.isDirectory()).catch(() => false)) {
    await fsPromises.cp(homeworkPublishDir, path.join(stagedRuntimeModulesDir, 'homework'), { recursive: true });
  }

  if (await fsPromises.stat(videosSourceDir).then((stats) => stats.isDirectory()).catch(() => false)) {
    await fsPromises.cp(videosSourceDir, path.join(stagedAppDir, 'videos'), { recursive: true });
  }

  if (await fsPromises.stat(bannerSourceDir).then((stats) => stats.isDirectory()).catch(() => false)) {
    await fsPromises.cp(bannerSourceDir, path.join(stagedAppDir, 'banner'), { recursive: true });
  }

  stopRunningProcesses();
  await sleep(800);
  await removePathWithRetries(appDir);
  await fsPromises.rename(stagedAppDir, appDir);

  execFileSync(tarPath, ['-a', '-c', '-f', stagedZipPath, path.basename(appDir)], {
    cwd: outputDir,
    windowsHide: true
  });

  await removePathWithRetries(zipPath, {
    rmOptions: { force: true },
    retries: 5,
    delayMs: 300
  });
  await fsPromises.rename(stagedZipPath, zipPath);
  await removePathWithRetries(stagingRootDir);

  process.stdout.write(`打包完成: ${appDir}${os.EOL}`);
  process.stdout.write(`压缩包: ${zipPath}${os.EOL}`);
}

packageApp().catch((error) => {
  process.stderr.write(`${error.stack || error.message}${os.EOL}`);
  process.exitCode = 1;
});
