import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildTv, projectRoot } from './build-tv.mjs';

const profile = process.argv[2];
if (!profile || process.argv.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(profile)) {
  console.error('Usage: node scripts/package-tv.mjs CertificateProfile');
  console.error('Create a Samsung TV certificate profile first. Use letters, numbers, underscores, or hyphens in its name.');
  process.exit(1);
}

const cli = process.env.TIZEN_CLI || (process.platform === 'win32' ? 'tizen.bat' : 'tizen');

function runTizen(args, cwd) {
  let result;
  if (process.platform === 'win32') {
    // .bat launchers need cmd.exe. Quote every argument; reject expansion characters.
    const quote = (value) => {
      if (/["%!\r\n]/.test(value)) throw new Error('SDK/project paths cannot contain quotes, %, !, or newlines on Windows.');
      return `"${value}"`;
    };
    const command = `"${[cli, ...args].map(quote).join(' ')}"`;
    result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      cwd, stdio: 'inherit', windowsVerbatimArguments: true,
    });
  } else {
    result = spawnSync(cli, args, { cwd, stdio: 'inherit' });
  }
  if (result.error) throw new Error(`Cannot run Tizen CLI: ${result.error.message}. Set TIZEN_CLI to the installed launcher path.`);
  if (result.status !== 0) throw new Error(`Tizen ${args[0]} failed (exit ${result.status ?? result.signal}).`);
}

try {
  const output = await buildTv();
  runTizen(['build-web', '--', output], projectRoot);
  const built = path.join(output, '.buildResult');
  if (!existsSync(path.join(built, 'config.xml'))) throw new Error('Tizen build did not produce dist/tv/.buildResult/config.xml.');
  runTizen(['package', '-t', 'wgt', '-s', profile, '--', built], built);
  const packages = (await readdir(built)).filter((name) => name.endsWith('.wgt'));
  if (packages.length !== 1) throw new Error(`Expected one .wgt in ${built}; found ${packages.length}. Inspect the Tizen CLI output.`);
  const destination = path.join(projectRoot, 'dist', 'AniHarbor.wgt');
  await cp(path.join(built, packages[0]), destination);
  console.log(`Signed TV package: ${destination}`);
  console.log('Install only on the TV registered in your Samsung distributor certificate. See docs/INSTALL-TV.md.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
