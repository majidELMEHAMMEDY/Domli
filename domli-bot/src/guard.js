// Rules that run BEFORE any text is sent to the AI provider.
// Anything sensitive is handed to a human without leaving our server (data minimisation).

const HANDOFF_RULES = [
  { reason: 'prijs', pattern: /\b(prijs|prijzen|kost|kosten|tarief|tarieven|offerte|korting|factuur|betalen|terugbetal\w*|restitutie|price|prices|pricing|cost|costs|quote|quotation|discount|invoice|refund|payment|payments|pay)\b/i },
  { reason: 'klacht', pattern: /\b(klacht\w*|ontevreden|boos|slecht\w*|schandalig|aansprakelijk\w*|advocaat|schadevergoeding|teleurgesteld|complaint\w*|complain\w*|unhappy|angry|terrible|awful|lawyer|compensation|disappointed|sue|scam|fraud\w*)\b/i },
  {
    reason: 'medisch',
    pattern:
      /\b(pijn|medicijn\w*|medicatie|symptom\w*|klachten van|huisarts|arts|diagnose|ziek\w*|bloed\w*|allergi\w*|zwanger\w*|ontsteking|behandeling|recept|pain|medicine|medication|doctor|diagnos\w*|sick|illness|blood|allerg\w*|pregnan\w*|infection|treatment|prescription|disease)\b/i,
  },
];

const APPOINTMENT = /\b(afspraak|afspraken|boeken|inplannen|reserveren|beschikbaar|beschikbaarheid|tijdslot|verzetten|annuleren|appointment|appointments|book|booking|reserve|schedule|reschedule|availability|available|cancel)\b/i;

// skip: reasons this account may answer itself (e.g. ['prijs'] for Domli's own sales chat).
// Complaints and medical topics can never be skipped.
export function checkHandoff(text, { skip = [] } = {}) {
  const rule = HANDOFF_RULES.find(r => !(r.reason === 'prijs' && skip.includes('prijs')) && r.pattern.test(text));
  return rule ? rule.reason : null;
}

export function isAppointmentIntent(text) {
  return APPOINTMENT.test(text);
}
