const { spawnSync } = require('child_process');
const path = require('path');

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: true
  });
  return result.status === 0;
}

function runOrThrow(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env
  });

  if (result.status !== 0) {
    const cmd = [command, ...args].join(' ');
    throw new Error(`Command failed (${result.status}): ${cmd}`);
  }
}

function main() {
  const dashboardDir = path.join(__dirname, '..', 'dashboard');

  const hasBun = commandExists('bun');
  const installer = hasBun ? 'bun' : 'npm';

  if (installer === 'bun') {
    runOrThrow('bun', ['install'], dashboardDir);
    runOrThrow('bun', ['run', 'build'], dashboardDir);
    return;
  }

  runOrThrow('npm', ['ci'], dashboardDir);
  runOrThrow('npm', ['run', 'build'], dashboardDir);
}

try {
  main();
} catch (err) {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
}
