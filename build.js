const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const version = JSON.parse(fs.readFileSync('manifest.json', 'utf8')).version;
const distDir = 'dist';
const xpiPath = path.join(distDir, `tonecraft-${version}.xpi`);

// Files and directories to include (exact list from spec)
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

// Create dist directory
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Remove existing XPI
if (fs.existsSync(xpiPath)) {
  fs.unlinkSync(xpiPath);
}

// Try zip command first
const whichCmd = process.platform === 'win32' ? 'where' : 'which';
const whichResult = spawnSync(whichCmd, ['zip'], { encoding: 'utf8' });
const hasZip = whichResult.status === 0;

if (hasZip) {
  // Use zip command with explicit file list
  const result = spawnSync('zip', ['-r', '-FS', xpiPath, ...entries], {
    stdio: 'inherit'
  });
  process.exit(result.status || 0);
} else {
  // Fallback to Python zipfile
  const pythonArgs = [
    '-c',
    `import sys, zipfile, os
zf = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)
for entry in sys.argv[2:]:
    if os.path.isfile(entry):
        zf.write(entry)
    else:
        for root, dirs, files in os.walk(entry):
            for f in files:
                fp = os.path.join(root, f)
                arcname = os.path.relpath(fp, '.')
                zf.write(fp, arcname)
zf.close()`,
    xpiPath,
    ...entries
  ];
  const result = spawnSync('python3', pythonArgs, { stdio: 'inherit' });
  process.exit(result.status || 0);
}
