export interface SampleNote {
	readonly folder: string;
	readonly title: string;
	readonly content: string;
}

export interface SampleItem {
	readonly folder: string;
	readonly title: string;
	readonly projectTitle: string;
	/** Content for the item once the project's real file name is known (it may be uniquified, e.g. "Garden planner 2"). */
	readonly content: (projectLink: string) => string;
}

const project = (title: string, status: string, extra: string, body: string): SampleNote => ({
	folder: 'Samples/Projects',
	title,
	content: `---\nkit: project\nstatus: ${status}\n${extra}sample: true\n---\n> [!note] Sample data\n> Created by "Insert sample projects". Delete the Samples folder when you are done exploring.\n\n${body}`,
});

const item = (kind: 'task' | 'decision', title: string, status: string, projectTitle: string, extra = ''): SampleItem => ({
	folder: kind === 'task' ? 'Samples/Tasks' : 'Samples/Decisions',
	title,
	projectTitle,
	content: (projectLink) => `---\nkit: ${kind}\nstatus: ${status}\nproject: "[[${projectLink}]]"\n${extra}sample: true\n---\n`,
});

export const SAMPLE_PROJECTS: readonly SampleNote[] = [
	project(
		'Garden planner',
		'active',
		'owner: Alex\ndue: 2026-11-15\n',
		[
			'## Principle',
			'- Plan beds by sunlight hours, then pick plants that fit each bed.',
			'',
			'## To do',
			'- [ ] Order compost for the north bed',
			'- [ ] Sketch the drip line layout',
			'- [x] Measure sunlight per bed',
			'',
			'## Done',
			'- Built two raised beds',
			'',
			'## Verification limits',
			'- Soil pH not tested yet; plant choices may change.',
			'',
		].join('\n'),
	),
	project(
		'Recipe box',
		'paused',
		'',
		[
			'## Principle',
			'- One note per recipe, tagged by meal and season.',
			'',
			'## To do',
			'- [ ] Add three weeknight dinners',
			'',
			'## Done',
			'- Imported ten breakfast recipes',
			'- Agreed on the tag list',
			'',
			'## Verification limits',
			'- Cooking times are copied from the original cards and not re-timed.',
			'',
		].join('\n'),
	),
	project(
		'Reading log',
		'active',
		'owner: Sam\n',
		['## Principle', '- Log every finished book with a three-line takeaway.', '', '## To do', '', '## Done', '', '## Verification limits', ''].join('\n'),
	),
];

export const SAMPLE_ITEMS: readonly SampleItem[] = [
	item('task', 'Order compost', 'todo', 'Garden planner', 'due: 2026-10-20\nowner: Alex\n'),
	item('task', 'Sketch drip line', 'doing', 'Garden planner'),
	item('decision', 'Raised beds or in-ground rows', 'decided', 'Garden planner', 'decided: 2026-09-01\n'),
	item('decision', 'Which drip kit to buy', 'open', 'Garden planner'),
	item('task', 'Add weeknight dinners', 'todo', 'Recipe box'),
];
