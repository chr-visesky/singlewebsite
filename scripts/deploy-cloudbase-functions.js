'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const cloudbaseDir = path.join(rootDir, 'cloudbase');
const cloudbaseConfigPath = path.join(cloudbaseDir, 'cloudbaserc.json');
const cloudbaseCliPath = path.join(rootDir, 'tools', 'wechat-cli', 'node_modules', '@cloudbase', 'cli', 'bin', 'cloudbase');

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

function main() {
  const config = JSON.parse(fs.readFileSync(cloudbaseConfigPath, 'utf8'));
  const functions = Array.isArray(config.functions) ? config.functions : [];

  if (!functions.length) {
    throw new Error(`No functions configured in ${cloudbaseConfigPath}`);
  }

  for (const item of functions) {
    const name = item && item.name;

    if (!name) {
      continue;
    }

    process.stdout.write(`\n=== deploy ${name} ===\n`);
    run(process.execPath, [cloudbaseCliPath, 'fn', 'deploy', name, '--force', '--json'], {
      cwd: cloudbaseDir
    });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
