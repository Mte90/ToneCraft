const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const version = JSON.parse(fs.readFileSync('manifest.json', 'utf8')).version;
const distDir = 'dist';
const xpiPath = path.join(distDir, `tonecraft-${version}.xpi`);

// An .xpi is a zip archive, and zip is the only tool here that writes one
const entries = [
  'manifest.json',
  'background.js',
  'src',
  'icons',
  'options',
  'dialog',
  'common.css',
  'LICENSE'
];

if (spawnSync('zip', ['-v'], { stdio: 'ignore' }).status !== 0) {
  console.error('The zip command is required to build the add-on: install it from your package manager.');
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(xpiPath, { force: true });

const result = spawnSync('zip', ['-r', xpiPath, ...entries], { stdio: 'inherit' });
process.exit(result.status ?? 1);
