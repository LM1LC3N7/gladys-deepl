// -----------------------------------------------------------------------------
// Text helpers (pure): the characters DeepL counts, and the cut of an output
// to the 10,000 characters Gladys keeps.
// -----------------------------------------------------------------------------

/** Characters as DeepL counts them: Unicode code points (most emoji are one, some several). */
export const countChars = (text) => {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
};

/** At most `max` UTF-16 units, never half of a surrogate pair. */
export function cut(text, max) {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}
