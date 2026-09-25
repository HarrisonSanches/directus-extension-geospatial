import { RuleConfigSeverity, type SyncRule, type UserConfig } from '@commitlint/types';

// Subjects that tell someone reading the history nothing about the change (docs/padroes/git-e-entrega.md).
const vagueSubjects = ['update files', 'fix bug', 'changes', 'wip', 'review', 'misc'];

// commitlint has no rule that refuses a list of subjects (V-67), so this local one does.
const subjectVague: SyncRule<string[]> = ({ subject }, when = 'never', subjects = []) => {
	const isVague = subjects.includes((subject ?? '').trim().toLowerCase());

	return [
		when === 'never' ? !isVague : isVague,
		`subject must say what changes for someone reading the history, not "${subject}"`,
	];
};

const config: UserConfig = {
	extends: ['@commitlint/config-conventional'],
	plugins: [{ rules: { 'subject-vague': subjectVague } }],
	rules: {
		'header-max-length': [RuleConfigSeverity.Error, 'always', 72],
		'scope-case': [RuleConfigSeverity.Error, 'always', 'kebab-case'],
		'body-leading-blank': [RuleConfigSeverity.Error, 'always'],
		'footer-leading-blank': [RuleConfigSeverity.Error, 'always'],
		'subject-vague': [RuleConfigSeverity.Error, 'never', vagueSubjects],
	},
};

export default config;
