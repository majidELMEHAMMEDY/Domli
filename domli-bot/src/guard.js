// Rules that run BEFORE any text is sent to the AI provider.
// Anything sensitive is handed to a human without leaving our server (data minimisation).

const HANDOFF_RULES = [
  { reason: 'prijs', pattern: /\b(prijs|prijzen|kost|kosten|tarief|tarieven|offerte|korting|factuur|betalen|terugbetal\w*|restitutie)\b/i },
  { reason: 'klacht', pattern: /\b(klacht\w*|ontevreden|boos|slecht\w*|schandalig|aansprakelijk\w*|advocaat|schadevergoeding|teleurgesteld)\b/i },
  {
    reason: 'medisch',
    pattern:
      /\b(pijn|medicijn\w*|medicatie|symptom\w*|klachten van|huisarts|arts|diagnose|ziek\w*|bloed\w*|allergi\w*|zwanger\w*|ontsteking|behandeling|recept)\b/i,
  },
];

const APPOINTMENT = /\b(afspraak|afspraken|boeken|inplannen|reserveren|beschikbaar|beschikbaarheid|tijdslot|verzetten|annuleren)\b/i;

// skip: reasons this account may answer itself (e.g. ['prijs'] for Domli's own sales chat).
// Complaints and medical topics can never be skipped.
export function checkHandoff(text, { skip = [] } = {}) {
  const rule = HANDOFF_RULES.find(r => !(r.reason === 'prijs' && skip.includes('prijs')) && r.pattern.test(text));
  return rule ? rule.reason : null;
}

export function isAppointmentIntent(text) {
  return APPOINTMENT.test(text);
}
