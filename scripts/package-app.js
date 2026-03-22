'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const builder = require('electron-builder');
const { resolveBuildVersion } = require('./build-version');

const MODULE_BUILD_TARGETS = Object.freeze([
  Object.freeze({
    key: 'homework',
    exeName: 'HomeworkApp.exe',
    packagedDirectoryName: 'homework',
    projectRelativePath: path.join('modules', 'HomeworkApp', 'HomeworkApp.csproj'),
    publishRelativePath: path.join('modules', 'HomeworkApp', 'bin', 'Release', 'studygate-publish')
  }),
  Object.freeze({
    key: 'dictation',
    exeName: 'DictationApp.exe',
    packagedDirectoryName: 'dictation',
    projectRelativePath: path.join('modules', 'DictationApp', 'DictationApp.csproj'),
    publishRelativePath: path.join('modules', 'DictationApp', 'bin', 'Release', 'studygate-publish')
  }),
  Object.freeze({
    key: 'recitation',
    exeName: 'RecitationApp.exe',
    packagedDirectoryName: 'recitation',
    projectRelativePath: path.join('modules', 'RecitationApp', 'RecitationApp.csproj'),
    publishRelativePath: path.join('modules', 'RecitationApp', 'bin', 'Release', 'studygate-publish')
  })
]);

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
  const imageNames = ['StudyGate.exe', ...MODULE_BUILD_TARGETS.map((item) => item.exeName)];
  const args = ['/F'];

  for (const imageName of imageNames) {
    args.push('/IM', imageName);
  }

  args.push('/T');

  try {
    execFileSync(taskkillPath, args, {
      stdio: 'ignore',
      windowsHide: true
    });
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

function dotnetEnvironment(dotnetCommand, projectRoot) {
  const profileRoot = path.join(projectRoot, '.dotnet-profile');
  const userProfile = path.join(profileRoot, 'User');
  const appData = path.join(profileRoot, 'AppData', 'Roaming');
  const useSystemProfile = String(process.env.STUDYGATE_USE_SYSTEM_DOTNET_PROFILE || '').trim() === '1';
  const environment = {
    ...process.env
  };

  if (!useSystemProfile) {
    environment.APPDATA = appData;
    environment.DOTNET_CLI_HOME = path.join(projectRoot, '.dotnet-cli');
    environment.HOME = userProfile;
    environment.NUGET_PACKAGES = path.join(projectRoot, '.nuget', 'packages');
    environment.USERPROFILE = userProfile;
  }

  if (path.isAbsolute(dotnetCommand)) {
    const dotnetRoot = path.dirname(dotnetCommand);
    environment.DOTNET_ROOT = environment.DOTNET_ROOT || dotnetRoot;
    environment.DOTNET_ROOT_X64 = environment.DOTNET_ROOT_X64 || dotnetRoot;
  }

  return environment;
}

function ensureLocalNuGetFeed(projectRoot) {
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'ensure-local-nuget-feed.js')], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true
  });
}

function npmInvocation() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath]
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: []
  };
}

function productionDependencyDirectories(projectRoot) {
  const npmRun = npmInvocation();
  const npmLsOutput = execFileSync(
    npmRun.command,
    [...npmRun.args, 'ls', '--omit=dev', '--all', '--parseable'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true
    }
  );
  const nodeModulesRoot = path.join(projectRoot, 'node_modules');
  const packageDirectories = npmLsOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((entryPath) => entryPath !== projectRoot)
    .filter((entryPath) => entryPath.startsWith(nodeModulesRoot))
    .sort((left, right) => left.length - right.length);
  const selected = [];

  for (const entryPath of packageDirectories) {
    const alreadyCovered = selected.some((parentPath) =>
      entryPath.length > parentPath.length &&
      entryPath.startsWith(`${parentPath}${path.sep}`)
    );

    if (!alreadyCovered) {
      selected.push(entryPath);
    }
  }

  return selected;
}

async function copyRuntimeNodeModules(projectRoot, stagedRuntimeAppDir) {
  const stagedNodeModulesDir = path.join(stagedRuntimeAppDir, 'node_modules');
  const runtimeDependencyDirs = productionDependencyDirectories(projectRoot);

  if (!runtimeDependencyDirs.length) {
    return;
  }

  await fsPromises.mkdir(stagedNodeModulesDir, { recursive: true });

  for (const sourceDir of runtimeDependencyDirs) {
    const relativeDir = path.relative(path.join(projectRoot, 'node_modules'), sourceDir);
    const targetDir = path.join(stagedNodeModulesDir, relativeDir);
    await fsPromises.mkdir(path.dirname(targetDir), { recursive: true });
    await fsPromises.cp(sourceDir, targetDir, { recursive: true });
  }
}

function restoreDotnetProject(dotnetCommand, projectRoot, moduleTarget) {
  const projectPath = path.join(projectRoot, moduleTarget.projectRelativePath);
  const configFilePath = path.join(projectRoot, 'NuGet.Config');

  execFileSync(
    dotnetCommand,
    [
      'restore',
      projectPath,
      '-r',
      'win-x64',
      '--force-evaluate',
      '--ignore-failed-sources',
      '--configfile',
      configFilePath,
      '-p:NuGetAudit=false'
    ],
    {
      cwd: projectRoot,
      env: dotnetEnvironment(dotnetCommand, projectRoot),
      windowsHide: true,
      stdio: 'inherit'
    }
  );
}

function publishDotnetProject(dotnetCommand, projectRoot, moduleTarget) {
  const projectPath = path.join(projectRoot, moduleTarget.projectRelativePath);
  const publishDir = path.join(projectRoot, moduleTarget.publishRelativePath);
  const configFilePath = path.join(projectRoot, 'NuGet.Config');

  if (!fs.existsSync(projectPath)) {
    throw new Error(`找不到项目文件：${projectPath}`);
  }

  return removePathWithRetries(publishDir).then(() => {
    restoreDotnetProject(dotnetCommand, projectRoot, moduleTarget);
    execFileSync(
      dotnetCommand,
      [
        'publish',
        projectPath,
        '-c',
        'Release',
        '-r',
        'win-x64',
        '--no-restore',
        '--self-contained',
        'true',
        '--configfile',
        configFilePath,
        '-p:PublishSingleFile=true',
        '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-p:RestoreIgnoreFailedSources=true',
        '-p:NuGetAudit=false',
        '-o',
        publishDir
      ],
      {
        cwd: projectRoot,
        env: dotnetEnvironment(dotnetCommand, projectRoot),
        windowsHide: true,
        stdio: 'inherit'
      }
    );
  });
}

async function publishNativeTargets(dotnetCommand, projectRoot) {
  for (const moduleTarget of MODULE_BUILD_TARGETS) {
    await publishDotnetProject(dotnetCommand, projectRoot, moduleTarget);
  }
}

async function copyDirectoryIfPresent(sourcePath, targetPath) {
  const exists = await fsPromises.stat(sourcePath).then((stats) => stats.isDirectory()).catch(() => false);

  if (!exists) {
    return false;
  }

  await fsPromises.cp(sourcePath, targetPath, { recursive: true });
  return true;
}

async function copyFileIfPresent(sourcePath, targetPath) {
  const exists = await fsPromises.stat(sourcePath).then((stats) => stats.isFile()).catch(() => false);

  if (!exists) {
    return false;
  }

  await fsPromises.copyFile(sourcePath, targetPath);
  return true;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function buildWindowsInstaller(projectRoot, appDir, outputDir, buildVersion, productName) {
  const artifacts = await builder.build({
    projectDir: projectRoot,
    prepackaged: appDir,
    publish: 'never',
    targets: builder.Platform.WINDOWS.createTarget(['nsis']),
    config: {
      appId: 'com.studygate.desktop',
      extraMetadata: {
        version: buildVersion
      },
      productName,
      compression: 'normal',
      directories: {
        output: outputDir
      },
      artifactName: `${productName} Setup ${buildVersion}.\${ext}`,
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        deleteAppDataOnUninstall: false,
        differentialPackage: false,
        shortcutName: productName
      }
    }
  });

  return Array.isArray(artifacts) ? artifacts : [];
}

async function writeUpdateManifest(outputDir, buildVersion, zipPath, builderArtifacts = []) {
  const installerPath = builderArtifacts.find((artifactPath) =>
    typeof artifactPath === 'string' && artifactPath.toLowerCase().endsWith('.exe')
  ) || '';
  const latestYmlPath = path.join(outputDir, 'latest.yml');
  const manifest = {
    generatedAt: new Date().toISOString(),
    version: buildVersion,
    zip: {
      fileName: path.basename(zipPath),
      size: fs.statSync(zipPath).size,
      sha256: sha256File(zipPath)
    },
    installer: installerPath
      ? {
          fileName: path.basename(installerPath),
          size: fs.statSync(installerPath).size,
          sha256: sha256File(installerPath)
        }
      : null,
    latestYml: fs.existsSync(latestYmlPath)
      ? {
          fileName: path.basename(latestYmlPath),
          size: fs.statSync(latestYmlPath).size
        }
      : null
  };

  const manifestPath = path.join(outputDir, 'update-manifest.json');
  await fsPromises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}${os.EOL}`, 'utf8');
  await fsPromises.writeFile(path.join(outputDir, 'build-version.txt'), `${buildVersion}${os.EOL}`, 'utf8');
}

async function packageApp() {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = require(path.join(projectRoot, 'package.json'));
  const options = packageJson.singleWebsite || {};
  const productName = options.productName || 'StudyGate';
  const buildVersion = resolveBuildVersion();
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
    version: buildVersion,
    description: packageJson.description,
    main: packageJson.main,
    productName
  };

  await fsPromises.mkdir(outputDir, { recursive: true });
  ensureLocalNuGetFeed(projectRoot);
  await publishNativeTargets(dotnetCommand, projectRoot);
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
  await copyRuntimeNodeModules(projectRoot, stagedRuntimeAppDir);
  await fsPromises.mkdir(stagedRuntimeVendorPiperDir, { recursive: true });
  await fsPromises.cp(vendorPiperRuntimeDir, path.join(stagedRuntimeVendorPiperDir, 'runtime'), { recursive: true });
  await fsPromises.cp(vendorPiperModelsDir, path.join(stagedRuntimeVendorPiperDir, 'models'), { recursive: true });
  await copyFileIfPresent(configSource, path.join(stagedRuntimeAppDir, 'embedded-config.json'));
  await copyFileIfPresent(secretConfigSource, path.join(stagedRuntimeAppDir, 'embedded-config.secrets.json'));

  for (const moduleTarget of MODULE_BUILD_TARGETS) {
    const publishDir = path.join(projectRoot, moduleTarget.publishRelativePath);
    await copyDirectoryIfPresent(
      publishDir,
      path.join(stagedRuntimeModulesDir, moduleTarget.packagedDirectoryName)
    );
  }

  await copyDirectoryIfPresent(videosSourceDir, path.join(stagedAppDir, 'videos'));
  await copyDirectoryIfPresent(bannerSourceDir, path.join(stagedAppDir, 'banner'));

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

  const builderArtifacts = await buildWindowsInstaller(projectRoot, appDir, outputDir, buildVersion, productName);
  await writeUpdateManifest(outputDir, buildVersion, zipPath, builderArtifacts);
  await removePathWithRetries(stagingRootDir);

  process.stdout.write(`打包完成: ${appDir}${os.EOL}`);
  process.stdout.write(`压缩包: ${zipPath}${os.EOL}`);
  process.stdout.write(`版本: ${buildVersion}${os.EOL}`);
}

packageApp().catch((error) => {
  process.stderr.write(`${error.stack || error.message}${os.EOL}`);
  process.exitCode = 1;
});
