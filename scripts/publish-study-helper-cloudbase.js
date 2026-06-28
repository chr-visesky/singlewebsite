'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const cloudbaseDir = path.join(rootDir, 'cloudbase');
const localCloudBaseCli = path.join(
  rootDir,
  'tools',
  'wechat-cli',
  'node_modules',
  '@cloudbase',
  'cli',
  'bin',
  'cloudbase'
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
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

run(process.execPath, [path.join(rootDir, 'scripts', 'build-study-helper-zip.js')]);
run(process.execPath, [localCloudBaseCli, 'fn', 'deploy', 'skillPublic', '--force', '--json'], {
  cwd: cloudbaseDir
});
