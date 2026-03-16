'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

async function packageApp() {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = require(path.join(projectRoot, 'package.json'));
  const options = packageJson.singleWebsite || {};
  const productName = options.productName || 'StudyGate';
  const outputDir = path.join(projectRoot, options.outputDir || 'dist');
  const appDir = path.join(outputDir, `${productName}-win32-x64`);
  const zipPath = path.join(outputDir, `${productName}-win32-x64.zip`);
  const configSource = path.join(projectRoot, 'config.json');
  const videosSourceDir = path.join(projectRoot, 'videos');
  const homeworkProjectPath = path.join(projectRoot, 'modules', 'HomeworkApp', 'HomeworkApp.csproj');
  const homeworkPublishDir = path.join(projectRoot, 'modules', 'HomeworkApp', 'bin', 'Release', 'studygate-publish');
  const electronDistDir = path.join(projectRoot, 'node_modules', 'electron', 'dist');
  const runtimeAppDir = path.join(appDir, 'resources', 'app');
  const runtimeModulesDir = path.join(appDir, 'modules');
  const vendorPiperRuntimeDir = path.join(projectRoot, 'vendor', 'piper', 'runtime');
  const vendorPiperModelsDir = path.join(projectRoot, 'vendor', 'piper', 'models');
  const runtimeVendorPiperDir = path.join(runtimeAppDir, 'vendor', 'piper');
  const tarPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const runtimePackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    main: packageJson.main,
    productName
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.rm(appDir, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  if (await fs.stat(homeworkProjectPath).then((stats) => stats.isFile()).catch(() => false)) {
    await fs.rm(homeworkPublishDir, { recursive: true, force: true });
    execFileSync(
      'dotnet',
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
  await fs.cp(electronDistDir, appDir, { recursive: true });
  await fs.rename(path.join(appDir, 'electron.exe'), path.join(appDir, `${productName}.exe`));
  await fs.mkdir(runtimeAppDir, { recursive: true });
  await fs.mkdir(runtimeModulesDir, { recursive: true });
  await fs.writeFile(
    path.join(runtimeAppDir, 'package.json'),
    `${JSON.stringify(runtimePackageJson, null, 2)}${os.EOL}`,
    'utf8'
  );
  await fs.cp(path.join(projectRoot, 'src'), path.join(runtimeAppDir, 'src'), { recursive: true });
  await fs.mkdir(runtimeVendorPiperDir, { recursive: true });
  await fs.cp(vendorPiperRuntimeDir, path.join(runtimeVendorPiperDir, 'runtime'), { recursive: true });
  await fs.cp(vendorPiperModelsDir, path.join(runtimeVendorPiperDir, 'models'), { recursive: true });
  await fs.copyFile(configSource, path.join(runtimeAppDir, 'embedded-config.json'));
  if (await fs.stat(homeworkPublishDir).then((stats) => stats.isDirectory()).catch(() => false)) {
    await fs.cp(homeworkPublishDir, path.join(runtimeModulesDir, 'homework'), { recursive: true });
  }
  if (await fs.stat(videosSourceDir).then((stats) => stats.isDirectory()).catch(() => false)) {
    await fs.cp(videosSourceDir, path.join(appDir, 'videos'), { recursive: true });
  }
  execFileSync(tarPath, ['-a', '-c', '-f', zipPath, path.basename(appDir)], {
    cwd: outputDir,
    windowsHide: true
  });

  process.stdout.write(`打包完成: ${appDir}${os.EOL}`);
  process.stdout.write(`压缩包: ${zipPath}${os.EOL}`);
}

packageApp().catch((error) => {
  process.stderr.write(`${error.stack || error.message}${os.EOL}`);
  process.exitCode = 1;
});
