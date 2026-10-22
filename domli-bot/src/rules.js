import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Behaviour is data, not code: the default rules live in defaults.json and each customer's own copy is edited
// from the super admin. This module only evaluates them.
export const DEFAULTS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'defaults.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

export const RULE_TYPES = ['handoff', 'reply', 'appointment'];
export const LANGUAGES = ['nl', 'en'];
export const UNKNOWN_BEHAVIORS = ['handoff', 'say_unknown'];
const LIMITS = { rules: 60, triggers: 200, trigger: 80, text: 1000, name: 80, template: 6000 };

const normalize = text => String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const regexCache = new Map();
// "klacht*" matches any word that starts with klacht; anything else must match whole words/phrases.
function triggerRegex(trigger) {
  if (regexCache.has(trigger)) return regexCache.get(trigger);
  const text = normalize(trigger).trim();
  let regex = null;
  if (text) {
    const prefix = text.endsWith('*');
    const body = (prefix ? text.slice(0, -1) : text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    regex = body ? new RegExp(`(?:^|[^a-z0-9])${body}${prefix ? '' : '(?![a-z0-9])'}`) : null;
  }
  regexCache.set(trigger, regex);
  return regex;
}

export function ruleMatches(rule, text) {
  if (!rule.enabled || !rule.triggers?.length) return false;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (rule.maxWords > 0 && words > rule.maxWords) return false;
  const haystack = normalize(text);
  return rule.triggers.some(trigger => triggerRegex(trigger)?.test(haystack));
}

export function firstMatch(rules, text, type) {
  return rules.find(rule => rule.type === type && ruleMatches(rule, text)) || null;
}

const string = (value, max, label) => {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new Error(`${label} is te lang (maximaal ${max} tekens)`);
  return text;
};

function normalizeRule(input) {
  if (!input || typeof input !== 'object') throw new Error('Ongeldige regel');
  const type = String(input.type);
  if (!RULE_TYPES.includes(type)) throw new Error('Ongeldig type regel');
  const name = string(input.name, LIMITS.name, 'Naam');
  if (!name) throw new Error('Elke regel heeft een naam nodig');
  const triggers = (Array.isArray(input.triggers) ? input.triggers : String(input.triggers || '').split('\n'))
    .map(item => String(item).trim())
    .filter(Boolean);
  if (triggers.length > LIMITS.triggers) throw new Error(`Maximaal ${LIMITS.triggers} woorden per regel`);
  if (triggers.some(item => item.length > LIMITS.trigger)) throw new Error(`Een woord of zin is te lang (maximaal ${LIMITS.trigger} tekens)`);
  const maxWords = Number(input.maxWords ?? 0);
  if (!Number.isInteger(maxWords) || maxWords < 0 || maxWords > 50) throw new Error('Maximaal aantal woorden moet tussen 0 en 50 liggen');
  const id = /^[a-z0-9_-]{1,40}$/.test(String(input.id || '')) ? String(input.id) : `${normalize(name).replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'regel'}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    type,
    name,
    locked: input.locked === true,
    enabled: input.enabled === true || input.enabled === 'true',
    reason: string(input.reason, 60, 'Reden'),
    maxWords,
    promptHint: string(input.promptHint, 200, 'Omschrijving voor de AI'),
    disabledNote: string(input.disabledNote, 300, 'Notitie'),
    triggers,
    message: { nl: string(input.message?.nl, LIMITS.text, 'Bericht'), en: string(input.message?.en, LIMITS.text, 'Bericht') },
  };
}

// Locked rules (complaints, health) can be edited but never switched off or removed.
function enforceLocked(rules) {
  const result = [...rules];
  for (const base of DEFAULTS.rules.filter(rule => rule.locked)) {
    const index = result.findIndex(rule => rule.id === base.id);
    if (index === -1) result.unshift(clone(base));
    else result[index] = { ...result[index], locked: true, enabled: true, type: 'handoff' };
  }
  return result;
}

export function normalizeRules(input) {
  if (!Array.isArray(input)) throw new Error('Regels moeten een lijst zijn');
  if (input.length > LIMITS.rules) throw new Error(`Maximaal ${LIMITS.rules} regels`);
  const ids = new Set();
  const rules = input.map(item => {
    const rule = normalizeRule(item);
    while (ids.has(rule.id)) rule.id = `${rule.id.slice(0, 34)}-${Math.random().toString(36).slice(2, 5)}`;
    ids.add(rule.id);
    return rule;
  });
  return enforceLocked(rules);
}

// Accounts without their own rules start from the defaults. The two old switches still work as a starting point.
export function effectiveRules(account) {
  if (Array.isArray(account.rules)) return enforceLocked(account.rules);
  const rules = clone(DEFAULTS.rules);
  const prices = rules.find(rule => rule.id === 'prices');
  if (prices && account.answerPrices === true) prices.enabled = false;
  const demo = rules.find(rule => rule.id === 'demo');
  if (demo && account.handoffDemo === true) demo.enabled = true;
  return rules;
}

export function effectiveBehaviour(account) {
  return {
    languages: Array.isArray(account.languages) && account.languages.length ? account.languages : DEFAULTS.languages,
    unknownBehavior: account.unknownBehavior || DEFAULTS.unknownBehavior,
    handoffMessage: { ...DEFAULTS.handoffMessage, ...(account.handoffMessage || {}) },
    promptTemplate: account.promptTemplate || DEFAULTS.promptTemplate,
    assistantName: account.assistantName || '',
    model: account.model || '',
  };
}

export function validateBehaviour(patch) {
  const out = {};
  if ('languages' in patch) {
    const list = [...new Set((Array.isArray(patch.languages) ? patch.languages : [patch.languages]).filter(Boolean))];
    if (!list.length || list.some(code => !LANGUAGES.includes(code))) throw new Error('Kies minstens één taal (nl of en)');
    out.languages = list;
  }
  if ('unknownBehavior' in patch) {
    if (!UNKNOWN_BEHAVIORS.includes(patch.unknownBehavior)) throw new Error('Ongeldige keuze voor onbekende vragen');
    out.unknownBehavior = patch.unknownBehavior;
  }
  if ('assistantName' in patch) out.assistantName = string(patch.assistantName, 40, 'Naam');
  if ('model' in patch) {
    const model = String(patch.model || '').trim();
    if (model && !/^[a-z0-9][a-z0-9.-]{1,79}$/i.test(model)) throw new Error('Ongeldige modelnaam');
    out.model = model;
  }
  if ('handoffMessage' in patch) {
    out.handoffMessage = { nl: string(patch.handoffMessage?.nl, LIMITS.text, 'Bericht'), en: string(patch.handoffMessage?.en, LIMITS.text, 'Bericht') };
  }
  if ('promptTemplate' in patch) {
    const template = string(patch.promptTemplate, LIMITS.template, 'Basisregels');
    out.promptTemplate = template === DEFAULTS.promptTemplate ? '' : template;
  }
  return out;
}

// {{booking_url}}, {{business}} and {{assistant}} can be used in any message.
export function renderMessage(template, { bookingUrl = '', business = '', assistant = '' } = {}) {
  return String(template || '')
    .replace(/\{\{booking_url\}\}/g, bookingUrl)
    .replace(/\{\{business\}\}/g, business)
    .replace(/\{\{assistant\}\}/g, assistant)
    .replace(/[ \t]+$/gm, '')
    .trim();
}
