// Wayseal /api/subscribe
// Email signup + optional save of latest parsed entries.
// Writes to Turso `subscribers` table and (if entries provided) `wayseal_imports`.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON body' }); }

  const email = String(body.email || '').trim().toLowerCase();
  const entries = Array.isArray(body.entries) ? body.entries : null;
  const source = String(body.source || 'tool').slice(0, 40);

  if (!email || !email.includes('@') || email.length > 200) {
    return json(400, { error: 'Invalid email' });
  }

  const dbUrl = process.env.TURSO_DB_URL;
  const dbToken = process.env.TURSO_DB_TOKEN;
  if (!dbUrl || !dbToken) {
    return json(500, { error: 'DB not configured' });
  }
  const httpUrl = dbUrl.replace(/^libsql:\/\//, 'https://');
  const slug = process.env.IDEA_SLUG || 'wayseal';

  // Insert subscriber. We use INSERT OR IGNORE on (email, idea_slug) so re-signups are idempotent.
  const requests = [
    {
      type: 'execute',
      stmt: {
        sql: 'INSERT OR IGNORE INTO subscribers (email, idea_slug, source, created_at) VALUES (?, ?, ?, datetime(\'now\'))',
        args: [
          { type: 'text', value: email },
          { type: 'text', value: slug },
          { type: 'text', value: source }
        ]
      }
    }
  ];

  if (entries && entries.length) {
    requests.push({
      type: 'execute',
      stmt: {
        sql: 'INSERT INTO wayseal_imports (email, entries_json, entry_count) VALUES (?, ?, ?)',
        args: [
          { type: 'text', value: email },
          { type: 'text', value: JSON.stringify(entries.slice(0, 50)) },
          { type: 'integer', value: String(entries.length) }
        ]
      }
    });
  }
  requests.push({ type: 'close' });

  let dbBody;
  try {
    const r = await fetch(`${httpUrl}/v2/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${dbToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests })
    });
    dbBody = await r.text();
    if (!r.ok) {
      return json(502, { error: 'DB write failed', detail: dbBody.slice(0, 400) });
    }
  } catch (err) {
    return json(502, { error: 'Network error', detail: String(err) });
  }

  // Fire welcome email (best effort, non-blocking)
  const resendKey = process.env.RESEND_API_KEY;
  const fromDomain = process.env.RESEND_FROM_DOMAIN || 'majorsolutions.studio';
  if (resendKey) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Wayseal <hello@${fromDomain}>`,
        to: [email],
        subject: 'Your free 50-state notary journal template',
        html: welcomeEmail(slug)
      })
    }).catch(() => { /* swallow */ });
  }

  return json(200, { ok: true });
};

function welcomeEmail(slug) {
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#F4EBD5;margin:0;padding:32px;color:#1F1F1F;">
  <table cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px;background:#FFFEFA;border-radius:14px;border:1px solid #E8DEC4;box-shadow:0 8px 24px rgba(15,42,69,.08);overflow:hidden;">
    <tr><td style="height:4px;background:linear-gradient(90deg,#1A3D5C,#D4A056);"></td></tr>
    <tr><td style="padding:32px;">
      <h1 style="font-family:Georgia,serif;color:#0F2A45;margin:0 0 12px;font-size:28px;">Welcome to Wayseal.</h1>
      <p style="font-size:16px;line-height:1.55;color:#1F1F1F;margin:0 0 16px;">Thanks for trying the journal decoder. Your free 50-state notary journal template is on the way (PDF + Google Sheets links below).</p>
      <p style="font-size:16px;line-height:1.55;color:#1F1F1F;margin:0 0 24px;">We're cooking up a phone-first app that auto-imports your SnapDocs jobs, tracks mileage in the background, and emits an IRS-bulletproof report at year end. Want early access? Just reply to this email.</p>
      <p style="margin:0 0 24px;">
        <a href="https://${slug}.majorsolutions.studio" style="background:#1A3D5C;color:#FFFEFA;padding:12px 22px;border-radius:8px;font-weight:600;text-decoration:none;display:inline-block;">See the full Wayseal tour</a>
      </p>
      <p style="font-size:13px;color:#6B6B6B;margin:0;">Built by <a href="https://majorsolutions.studio" style="color:#1A3D5C;">Major Solutions Studio</a> · Reply with feedback any time.</p>
    </td></tr>
  </table>
</body></html>`;
}

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
