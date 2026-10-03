# Releasing

Obsidian installs a plugin from the GitHub release whose tag equals `version` in `manifest.json`, downloading
`main.js`, `manifest.json` and `styles.css`.

Official references:
- Submit your plugin: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Manifest: https://docs.obsidian.md/Reference/Manifest · Versions: https://docs.obsidian.md/Reference/Versions

## Checklist for a new version

1. Update `version` in `package.json`, then `npm run version` (updates `manifest.json`; adds to `versions.json` only
   when `minAppVersion` changes).
2. `npm run typecheck && bun test && npm run build && npm run lint && npm run package`
   (`package` validates the manifest and writes `dist/<version>/` with the three assets and a zip).
3. Commit, then tag with the bare version (no `v` prefix) and push the tag.
4. Create the GitHub release for that tag and attach `dist/<version>/main.js`, `manifest.json`, `styles.css`
   (or run the "Release Obsidian plugin" workflow manually from the Actions tab).
5. Install the release in a disposable vault and check the plugin loads.

## Policy notes

- No network access, telemetry, ads or self-updates. Files stay inside the vault.
- The plugin `id` (`obtion`) never changes. `name` must not contain "Obsidian" or "Plugin".
- Community directory submission happens at https://community.obsidian.md (Obsidian account + GitHub link).
