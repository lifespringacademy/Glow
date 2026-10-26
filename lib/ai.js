// Ask Claude to look at one photo and answer in JSON. Returns the parsed object, or null if it couldn't.
export async function askAboutPhoto(dataUrl, prompt) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m || m[2].length > 4_000_000 || !process.env.ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: prompt }
        ] }]
      })
    });
    const data = await r.json();
    if (!r.ok) { console.error('Anthropic error', data); return null; }
    const text = (data.content || []).map((c) => c.text || '').join('');
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch (e) {
    console.error('Photo check failed', e);
    return null;
  }
}
