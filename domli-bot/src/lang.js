// Tiny Dutch/English detector for short chat messages. Used to answer fixed texts (booking link) in the visitor's language.
const ENGLISH = new Set('the is are you your can could how what when where do does did i my me we to a an of and for with have has will would please want need price prices cost book booking appointment hello hi hey thanks thank thx good morning afternoon evening'.split(' '));
const DUTCH = new Set('de het een en van ik je jij u uw we wij wat hoe waar wanneer kan kunnen niet met voor op aan ook als om is zijn heb heeft wil willen graag mijn jullie hallo hoi hai goedendag goedemorgen goedemiddag goedenavond bedankt dank dankjewel afspraak prijs kosten'.split(' '));

export function detectLanguage(text) {
  const words = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter(Boolean);
  let en = 0;
  let nl = 0;
  for (const word of words) {
    if (ENGLISH.has(word)) en += 1;
    if (DUTCH.has(word)) nl += 1;
  }
  return en > nl ? 'en' : 'nl';
}
