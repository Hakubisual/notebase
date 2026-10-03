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
4. Pushing the tag runs the `Release` workflow (`.github/workflows/release.yml`): it checks that the tag equals the
   manifest version, runs the checks, creates build provenance attestations for `main.js` and `styles.css`
   (`actions/attest-build-provenance`) and publishes the GitHub release with `main.js`, `manifest.json` and
   `styles.css`. It can also be run manually for an existing tag.
5. Verify: `gh attestation verify main.js --repo Hakubisual/notebase` on the downloaded asset, then install the release
   in a disposable vault and check the plugin loads. Attestations for 0.1.0 and 0.1.1 were signed before the
   repository was renamed, so verify those with `--repo Hakubisual/obtion` (or `--owner Hakubisual`).

## Policy notes

- No network access, telemetry, ads or self-updates. Files stay inside the vault.
- The plugin `id` (`obtion`) never changes; the display `name` is Notebase. `name` must not contain "Obsidian",
  parts of it, or "Plugin".
- Community directory submission happens at https://community.obsidian.md (Obsidian account + GitHub link).
