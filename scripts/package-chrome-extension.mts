import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const extensionDirectory = resolve('extension');
const argumentsList = process.argv.slice(2);
const reserveId = argumentsList.includes('--reserve-id');
const outputArgument = argumentsList.find((argument) => !argument.startsWith('--'));

if (!outputArgument) {
  console.error(
    'Usage: npm run extension:package -- [--reserve-id] /absolute/path/to/package.zip'
  );
  process.exit(1);
}

const outputPath = resolve(outputArgument);
if (!outputPath.endsWith('.zip')) {
  console.error('The package output path must end in .zip');
  process.exit(1);
}

const packageDirectory = mkdtempSync(join(tmpdir(), 'feason-chrome-extension-'));
const files = [
  'auth.mjs',
  'background.mjs',
  'books.json',
  'feason-logo.png',
  'popup.css',
  'popup.html',
  'popup.mjs',
  'shared.mjs',
];

try {
  for (const file of files) {
    cpSync(join(extensionDirectory, file), join(packageDirectory, file));
  }

  cpSync(join(extensionDirectory, 'icons'), join(packageDirectory, 'icons'), {
    recursive: true,
  });
  cpSync(join(extensionDirectory, 'fonts'), join(packageDirectory, 'fonts'), {
    recursive: true,
  });

  const manifest = JSON.parse(
    readFileSync(join(extensionDirectory, 'manifest.json'), 'utf8')
  );

  if (reserveId) {
    delete manifest.key;
    manifest.version = '0.0.1';
  }

  writeFileSync(
    join(packageDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  rmSync(outputPath, { force: true });
  execFileSync('zip', ['-q', '-r', outputPath, '.'], { cwd: packageDirectory });

  console.log(
    `Created ${basename(outputPath)} (${reserveId ? 'ID reservation' : `v${manifest.version}`})`
  );
} finally {
  rmSync(packageDirectory, { recursive: true, force: true });
}
