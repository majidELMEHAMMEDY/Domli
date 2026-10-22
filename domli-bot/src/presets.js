import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { env } from './config.js';
import { DEFAULTS, effectiveRules, normalizeRules, validateBehaviour } from './rules.js';

// A preset is a starting point for a type of client. Built-in ones ship as data (presets.json); presets you save from a
// customer live in data/presets.json. Applying one copies it into the customer, after which everything stays editable.
const BUILT_IN = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'presets.json'), 'utf8'));
const customFile = () => join(env.dataDir, 'presets.json');
const readCustom = () => (existsSync(customFile()) ? JSON.parse(readFileSync(customFile(), 'utf8')) : {});
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

export function listPresets() {
  const custom = readCustom();
  return [
    ...Object.entries(BUILT_IN).map(([name, preset]) => ({ name, description: preset.description, builtin: true })),
    ...Object.entries(custom).map(([name, preset]) => ({ name, description: preset.description || '', builtin: false })),
  ];
}

export function getPreset(name) {
  return BUILT_IN[name] || readCustom()[name] || null;
}

// Built-in presets list only what differs from the defaults (by rule id); custom ones store the complete rule list.
function mergeRules(base, overrides) {
  const rules = base.map(rule => ({ ...rule }));
  for (const override of overrides || []) {
    const index = rules.findIndex(rule => rule.id === override.id);
    if (index === -1) rules.push(override);
    else rules[index] = { ...rules[index], ...override };
  }
  return rules;
}

export function applyPreset(account, name) {
  const preset = getPreset(name);
  if (!preset) throw new Error('Onbekende preset');
  const config = preset.config;
  Object.assign(account, validateBehaviour({
    ...(config.languages && { languages: config.languages }),
    ...(config.unknownBehavior && { unknownBehavior: config.unknownBehavior }),
    ...(config.handoffMessage && { handoffMessage: config.handoffMessage }),
    ...(config.promptTemplate !== undefined && { promptTemplate: config.promptTemplate }),
  }));
  if (typeof config.instructions === 'string') account.instructions = config.instructions;
  account.rules = normalizeRules(mergeRules(DEFAULTS.rules, config.rules));
  delete account.answerPrices;
  delete account.handoffDemo;
}

export function savePreset(name, description, account) {
  if (!NAME.test(String(name))) throw new Error('Gebruik 1 tot 40 letters, cijfers, spaties of - _ in de naam');
  if (BUILT_IN[name]) throw new Error('Deze naam is gereserveerd voor een ingebouwde preset');
  const custom = readCustom();
  custom[name] = {
    description: String(description || '').slice(0, 200),
    config: {
      languages: account.languages,
      unknownBehavior: account.unknownBehavior,
      handoffMessage: account.handoffMessage,
      promptTemplate: account.promptTemplate || '',
      instructions: account.instructions || '',
      rules: effectiveRules(account),
    },
  };
  mkdirSync(env.dataDir, { recursive: true });
  const tmp = `${customFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(custom, null, 2));
  renameSync(tmp, customFile());
}

export function deletePreset(name) {
  if (BUILT_IN[name]) throw new Error('Ingebouwde presets kunnen niet worden verwijderd');
  const custom = readCustom();
  delete custom[name];
  mkdirSync(env.dataDir, { recursive: true });
  const tmp = `${customFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(custom, null, 2));
  renameSync(tmp, customFile());
}
