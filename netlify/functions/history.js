// Wayseal /api/history
// Returns recent entry counts and timestamps (no PII) for social proof.

exports.handler = async () => {
  const dbUrl = process.env.TURSO_DB_URL;
  const dbToken = process.env.TURSO_DB_TOKEN;
  if (!dbUrl || !dbToken) {
    return json(500, { error: 'DB not configured' });
  }
  const httpUrl = dbUrl.replace(/^libsql:\/\//, 'https://');

  try {
    const r = await fetch(`${httpUrl}/v2/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${dbToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [
          {
            type: 'execute',
            stmt: { sql: 'SELECT created_at, entry_count FROM wayseal_imports ORDER BY id DESC LIMIT 20' }
          },
          { type: 'close' }
        ]
      })
    });
    const data = await r.json();
    const rows = data?.results?.[0]?.response?.result?.rows || [];
    const items = rows.map((row) => ({
      created_at: row[0]?.value,
      entry_count: parseInt(row[1]?.value || '0', 10)
    }));
    const total = items.reduce((sum, i) => sum + (i.entry_count || 0), 0);
    return json(200, { items, total_entries: total, recent_imports: items.length });
  } catch (err) {
    return json(502, { error: 'DB read failed', detail: String(err) });
  }
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
