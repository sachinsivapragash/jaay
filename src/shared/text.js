// Removes invisible and direction-changing Unicode (zero-width spaces, joiners, bidi overrides, BOM)
// and control characters from anything a person types: customer names, items, notes, shop name.
// Otherwise a name could look like "Awa" on screen but read differently in a WhatsApp message,
// or hide instructions from the seller while still reaching the AI.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F­؜ᅟᅠ᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ￹-￻]/g;
export function cleanText(s, max = 300) {
  return String(s ?? '').normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
export const hasHidden = (s) => { INVISIBLE.lastIndex = 0; return INVISIBLE.test(String(s ?? '')); };
