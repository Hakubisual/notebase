// Builds the release assets Obsidian downloads (main.js, manifest.json, styles.css) into dist/<version>/
// and a zip for manual installs. Run after `npm run build`. Never uploads anything.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const problems = [];
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) problems.push('manifest.version must be x.y.z');
if (pkg.version !== manifest.version) problems.push(`package.json version ${pkg.version} != manifest ${manifest.version}`);
if (versions[manifest.version] !== manifest.minAppVersion) problems.push('versions.json must map the current version to minAppVersion');
if (!/^[a-z-]+$/.test(manifest.id) || manifest.id.includes('obsidian') || manifest.id.endsWith('plugin')) problems.push('invalid manifest.id');
if (/obsidian|plugin/i.test(manifest.name)) problems.push('manifest.name must not contain Obsidian or Plugin');
for (const f of ['main.js', 'manifest.json', 'styles.css']) if (!existsSync(f)) problems.push(`missing ${f} (run npm run build)`);
if (problems.length > 0) {
	console.error(problems.join('\n'));
	process.exit(1);
}
const dir = `dist/${manifest.version}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(`${dir}/${manifest.id}`, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
	copyFileSync(f, `${dir}/${f}`);
	copyFileSync(f, `${dir}/${manifest.id}/${f}`);
}
const zip = `${manifest.id}-${manifest.version}.zip`;
const r = spawnSync('tar', ['-a', '-c', '-f', zip, manifest.id], { cwd: dir, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
rmSync(`${dir}/${manifest.id}`, { recursive: true });
console.log(`Release assets in ${dir}: main.js manifest.json styles.css ${zip}`);
