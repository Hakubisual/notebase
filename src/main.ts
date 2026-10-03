import { Notice, Plugin, PluginSettingTab, Setting, type App, type SettingDefinitionItem } from 'obsidian';
import type { KitContext } from './core/context';
import { VaultKitIndex } from './core/index-service';
import { checkRootFolder } from './core/paths';
import { DEFAULT_SETTINGS, parseSettings, parseSettingsChecked, type KitSettings } from './core/settings';
import { VaultSafeWriter } from './core/writer';
import { FEATURES } from './features/registry';

const HEADING_KEYS = [
	['principle', 'Principle heading'],
	['todo', 'To-do heading'],
	['done', 'Done heading'],
	['limits', 'Verification limits heading'],
] as const;

interface SettingsSection {
	readonly title: string;
	readonly render: (containerEl: HTMLElement) => void;
}

export class ObtionPlugin extends Plugin {
	private current: KitSettings = DEFAULT_SETTINGS;
	private readonly sections: SettingsSection[] = [];
	index!: VaultKitIndex;

	async onload(): Promise<void> {
		const loaded = parseSettingsChecked(await this.loadData());
		this.current = loaded.settings;
		if (loaded.rootError !== null) {
			new Notice(`Obtion: the saved workspace folder ${loaded.rootError} Using "${loaded.settings.rootFolder}" until you choose another folder in settings.`, 0);
		}
		const root = () => this.current.rootFolder;
		this.index = new VaultKitIndex(this.app, root);
		this.index.attach(this);
		const ctx: KitContext = {
			app: this.app,
			plugin: this,
			settings: () => this.current,
			index: this.index,
			writer: new VaultSafeWriter(this.app, root),
			featureData: (id) => this.current.features[id],
			setFeatureData: async (id, value) => {
				await this.saveSettings({ ...this.current, features: { ...this.current.features, [id]: value } });
			},
			addSettingsSection: (title, render) => {
				this.sections.push({ title, render });
			},
		};
		for (const feature of FEATURES) feature.register(ctx);
		this.addSettingTab(new KitSettingTab(this.app, this, this.sections));
	}

	kitSettings(): KitSettings {
		return this.current;
	}

	async saveSettings(next: KitSettings): Promise<void> {
		const rootChanged = next.rootFolder !== this.current.rootFolder || next.headings !== this.current.headings;
		this.current = next;
		await this.saveData(next);
		if (rootChanged) this.index.invalidate();
	}
}

class KitSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly kit: ObtionPlugin, private readonly sections: readonly SettingsSection[]) {
		super(app, kit);
	}

	// Obsidian 1.13+: declarative definitions (searchable settings). display() below serves older apps (minAppVersion 1.7.2).
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				items: [
					{
						name: 'Workspace folder',
						desc: 'Vault folder the kit reads from and writes into. Notes outside it are never touched.',
						control: {
							type: 'text',
							key: 'rootFolder',
							placeholder: DEFAULT_SETTINGS.rootFolder,
							validate: (value: string) => {
								const check = checkRootFolder(value);
								return check.ok ? undefined : check.error;
							},
						},
					},
					...HEADING_KEYS.map(([key, label]) => ({
						name: label,
						desc: 'Section heading used in project notes.',
						control: { type: 'text' as const, key: `headings.${key}`, placeholder: DEFAULT_SETTINGS.headings[key] },
					})),
				],
			},
			...this.sections.map((section) => ({
				type: 'group' as const,
				heading: section.title,
				items: [
					{
						name: section.title,
						render: (setting: Setting) => {
							setting.settingEl.empty();
							section.render(setting.settingEl);
						},
					},
				],
			})),
		];
	}

	getControlValue(key: string): unknown {
		const s = this.kit.kitSettings();
		if (key === 'rootFolder') return s.rootFolder;
		const heading = HEADING_KEYS.find(([k]) => `headings.${k}` === key);
		return heading === undefined ? undefined : s.headings[heading[0]];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (typeof value !== 'string') return;
		const cur = this.kit.kitSettings();
		if (key === 'rootFolder') {
			const check = checkRootFolder(value);
			if (check.ok) await this.kit.saveSettings({ ...cur, rootFolder: check.root });
			return;
		}
		const heading = HEADING_KEYS.find(([k]) => `headings.${k}` === key);
		if (heading !== undefined) await this.kit.saveSettings(parseSettings({ ...cur, headings: { ...cur.headings, [heading[0]]: value } }));
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.kit.kitSettings();
		const folderDesc = 'Vault folder the kit reads from and writes into. Notes outside it are never touched.';
		const folder = new Setting(containerEl).setName('Workspace folder').setDesc(folderDesc);
		folder.addText((text) =>
			text.setValue(s.rootFolder).onChange(async (value) => {
				const check = checkRootFolder(value);
				folder.descEl.toggleClass('mod-warning', !check.ok);
				folder.setDesc(check.ok ? folderDesc : check.error);
				if (check.ok) await this.kit.saveSettings({ ...this.kit.kitSettings(), rootFolder: check.root });
			}),
		);
		for (const [key, label] of HEADING_KEYS) {
			new Setting(containerEl)
				.setName(label)
				.setDesc('Section heading used in project notes.')
				.addText((text) =>
					text.setValue(s.headings[key]).onChange(async (value) => {
						const cur = this.kit.kitSettings();
						await this.kit.saveSettings(parseSettings({ ...cur, headings: { ...cur.headings, [key]: value } }));
					}),
				);
		}
		for (const section of this.sections) {
			new Setting(containerEl).setName(section.title).setHeading();
			section.render(containerEl);
		}
	}
}

export default ObtionPlugin;
