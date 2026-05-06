// Wayseal /api/analyze
// Receives a base64-encoded photo of a paper notary journal page and returns
// an array of structured entries: { date, signer, document, id_type, fee }
// using Gemini 2.0 Flash multimodal.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { image_base64, mime_type } = body;
  if (!image_base64) {
    return json(400, { error: 'Missing image_base64' });
  }
  const mime = mime_type || 'image/jpeg';

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'Server not configured (no GEMINI_API_KEY)' });
  }

  const prompt = `You are an OCR + extraction system for handwritten or typed mobile notary journal pages.

Look at this image of a paper notary journal page. For each row visible, extract:
- date: The date of the notarial act in YYYY-MM-DD when possible (else best-effort string)
- signer: The signer's full name
- document: The type of document notarized (e.g. "Loan Closing", "Power of Attorney", "Affidavit", "Healthcare Directive")
- id_type: The signer's ID type if visible (e.g. "CA Driver License", "Passport", "Personal Knowledge")
- fee: The fee charged for this notarial act in dollars (e.g. "$15", "$10", "$0")

Rules:
- Return a JSON array of entries, one per row visible on the page.
- If a field is unclear or missing, return an empty string for that field but still include the row.
- Skip header rows or notes that aren't entries.
- Do not invent data. If you cannot read a row, omit it.
- Maximum 50 entries.

Return ONLY a JSON object with this exact shape, no commentary, no markdown:
{ "entries": [ { "date": "...", "signer": "...", "document": "...", "id_type": "...", "fee": "..." } ] }`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data: image_base64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      response_mime_type: 'application/json'
    }
  };

  let geminiResp;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return json(502, { error: 'Gemini request failed', detail: txt.slice(0, 400) });
    }
    geminiResp = await r.json();
  } catch (err) {
    return json(502, { error: 'Network error calling Gemini', detail: String(err) });
  }

  const text = geminiResp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Sometimes the model wraps in code fences
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
    }
  }

  let entries = [];
  if (parsed && Array.isArray(parsed.entries)) {
    entries = parsed.entries.slice(0, 50).map((e) => ({
      date: String(e.date || '').slice(0, 40),
      signer: String(e.signer || '').slice(0, 120),
      document: String(e.document || '').slice(0, 120),
      id_type: String(e.id_type || '').slice(0, 80),
      fee: String(e.fee || '').slice(0, 30),
    }));
  }

  // Best-effort log to Turso (non-blocking on errors)
  const dbUrl = process.env.TURSO_DB_URL;
  const dbToken = process.env.TURSO_DB_TOKEN;
  if (dbUrl && dbToken) {
    const httpUrl = dbUrl.replace(/^libsql:\/\//, 'https://');
    fetch(`${httpUrl}/v2/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${dbToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [
          {
            type: 'execute',
            stmt: {
              sql: 'INSERT INTO wayseal_imports (entries_json, entry_count, raw_text) VALUES (?, ?, ?)',
              args: [
                { type: 'text', value: JSON.stringify(entries) },
                { type: 'integer', value: String(entries.length) },
                { type: 'text', value: text.slice(0, 4000) }
              ]
            }
          },
          { type: 'close' }
        ]
      })
    }).catch(() => { /* swallow */ });
  }

  return json(200, { entries, raw_text: text });
};

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}
