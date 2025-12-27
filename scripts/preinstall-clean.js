const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const patchesDir = path.join(repoRoot, 'patches');
const nodeModulesDir = path.join(repoRoot, 'node_modules');

if (!fs.existsSync(patchesDir) || !fs.existsSync(nodeModulesDir)) {
  process.exit(0);
}

const removed = [];

for (const file of fs.readdirSync(patchesDir)) {
  if (!file.endsWith('.patch')) continue;
  const base = file.slice(0, -'.patch'.length);
  const parts = base.split('+');
  if (parts.length < 2) continue;

  let pkg;
  if (parts[0].startsWith('@') && parts.length >= 3) {
    pkg = `${parts[0]}/${parts[1]}`;
  } else {
    pkg = parts[0];
  }

  const target = path.join(nodeModulesDir, ...pkg.split('/'));
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(path.relative(repoRoot, target));
  }
}

if (removed.length > 0) {
  console.log(`[preinstall] Removed patched packages to avoid stale node_modules: ${removed.join(', ')}`);
}
