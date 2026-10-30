// Team name filter for the public Family Hunt leaderboard.
// Layer 1: a word list (catches common profanity, including l33t spellings like "sh1t").
// Layer 2: a quick AI check for anything clever the list misses (skipped if the AI is unavailable).

// Words blocked anywhere inside a name, even squashed together ("bigsh1tteam").
// Only words that don't appear inside normal words go here.
const ANYWHERE = [
  'fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut',
  'bastard', 'asshole', 'motherf', 'nigg', 'fag', 'retard', 'porn', 'penis', 'vagina', 'boob',
  'tits', 'titty', 'dildo', 'jizz', 'blowjob', 'handjob', 'nazi', 'hitler', 'kkk',
  'wank', 'twat', 'bollock', 'douche', 'chink', 'kike', 'tranny', 'molest', 'pedophil'
];
// Words blocked only as whole words, because they hide inside normal words
// (ass in "Glass", hell in "Hello", hoe in "Shoe", sex in "Sussex").
const WHOLE = [
  'ass', 'arse', 'hell', 'damn', 'hoe', 'hoes', 'sex', 'sexy', 'crap', 'piss', 'butt', 'nude',
  'nudes', 'naked', 'weed', 'meth', 'drunk', 'booze', 'kill', 'gay', 'homo', 'balls', 'nut', 'nuts',
  'thot', 'milf', 'cum', 'rape', 'spic', 'pedo', 'pedos', 'sht', 'dyke', 'jap', 'gook', 'wop', 'coon', 'negro', 'beaner', 'satan', 'devil', '69', '420'
];
// Normal words that contain a blocked piece, so they're allowed.
const OK = ['scunthorpe', 'cocktail', 'cockerel', 'cockatoo', 'cockpit', 'peacock', 'hitchcock', 'woodcock', 'shuttlecock', 'babcock', 'hancock', 'dickens', 'dickinson', 'dickerson', 'benedick', 'shitake', 'shiitake', 'fagan', 'titsworth'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '+': 't', '|': 'i' };

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$!+|9]/g, (c) => LEET[c] || c);
}

export function listCheck(name) {
  const raw = String(name || '').toLowerCase();
  const norm = normalize(name);
  const tokens = norm.split(/[^a-z]+/).filter(Boolean);
  // Check each word, plus any spaced-out letters joined back up ("s h i t", "f.u.c.k").
  const singles = tokens.filter((t) => t.length === 1).join('');
  const pieces = [...tokens, singles].filter(Boolean).map((w) => {
    for (const ok of OK) w = w.split(ok).join(' ');
    return w;
  });
  for (const w of pieces) {
    const deduped = w.replace(/(.)\1+/g, '$1'); // "fuuuck" -> "fuck"
    if (ANYWHERE.some((b) => w.includes(b) || deduped.includes(b))) return false;
  }
  const words = new Set([...tokens, ...raw.split(/[^a-z0-9]+/)].filter(Boolean));
  for (const t of [...words]) words.add(t.replace(/(.)\1{2,}/g, '$1$1')).add(t.replace(/(.)\1+/g, '$1')); // "asssss" -> "ass"
  if (WHOLE.some((w) => words.has(w))) return false;
  return true;
}

async function aiCheck(name) {
  if (!process.env.ANTHROPIC_API_KEY) return true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: 60,
        messages: [{ role: 'user', content: `A family entered this team name for a public Christmas lights scavenger hunt leaderboard that kids will see and that may be posted on social media:\n\n<name>${String(name).slice(0, 40)}</name>\n\nIs it fine for that audience? Block profanity (including disguised spellings or sound-alikes), sexual references or innuendo, slurs or insults about any group, drugs, violence, hate symbols, and names that impersonate Glow or a real business. Ordinary silly, punny or holiday names are fine. Reply with only JSON like {"ok":true}.` }]
      })
    });
    clearTimeout(timer);
    if (!r.ok) return true;
    const data = await r.json();
    const text = (data.content || []).map((c) => c.text || '').join('');
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return j.ok !== false;
  } catch {
    return true; // if the AI is slow or down, the word list alone decides
  }
}

// true = OK to use
export async function teamNameOk(name) {
  if (!listCheck(name)) return false;
  return aiCheck(name);
}

export const NAME_REJECTED = "Let's keep it family friendly. Please pick a different team name.";
