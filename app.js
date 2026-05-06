// Wayseal — Tool client logic
// Paper journal photo → AI parsed entries

(() => {
  const fileInput = document.getElementById('file-input');
  const dropzone = document.getElementById('dropzone');
  const chooseBtn = document.getElementById('choose-btn');
  const previewWrap = document.getElementById('preview');
  const previewImg = document.getElementById('preview-img');
  const resetBtn = document.getElementById('reset-btn');
  const parseBtn = document.getElementById('parse-btn');
  const statusText = document.getElementById('status-text');
  const resultsCard = document.getElementById('results');
  const resultsBody = document.getElementById('results-tbody');
  const countBadge = document.getElementById('count-badge');
  const copyBtn = document.getElementById('copy-btn');
  const csvBtn = document.getElementById('csv-btn');
  const captureCard = document.getElementById('capture-card');
  const captureForm = document.getElementById('capture-form');
  const captureStatus = document.getElementById('capture-status');

  let currentFileBase64 = null;
  let currentMimeType = null;
  let lastEntries = [];
  let lastRawText = '';

  // ===== File picking =====
  chooseBtn?.addEventListener('click', () => fileInput.click());
  dropzone?.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    fileInput.click();
  });
  fileInput?.addEventListener('change', (e) => handleFile(e.target.files?.[0]));

  // Drag & drop
  ['dragenter', 'dragover'].forEach(ev =>
    dropzone?.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    dropzone?.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone?.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));

  resetBtn?.addEventListener('click', () => resetUI());

  function resetUI() {
    currentFileBase64 = null;
    currentMimeType = null;
    fileInput.value = '';
    previewWrap.hidden = true;
    dropzone.style.display = '';
    parseBtn.disabled = true;
    statusText.textContent = '';
    statusText.className = 'micro';
  }

  function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      statusText.textContent = 'Please choose an image file (JPG or PNG).';
      statusText.className = 'micro error';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      statusText.textContent = 'File too large (max 8MB). Try a smaller photo.';
      statusText.className = 'micro error';
      return;
    }
    currentMimeType = file.type;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      currentFileBase64 = dataUrl.split(',')[1]; // strip "data:image/jpeg;base64,"
      previewImg.src = dataUrl;
      previewWrap.hidden = false;
      dropzone.style.display = 'none';
      parseBtn.disabled = false;
      statusText.textContent = `Ready: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      statusText.className = 'micro success';
      try { posthog.capture('tool_file_chosen', { size_kb: Math.round(file.size / 1024) }); } catch (e) {}
    };
    reader.readAsDataURL(file);
  }

  // ===== Parse =====
  parseBtn?.addEventListener('click', async () => {
    if (!currentFileBase64) return;
    parseBtn.classList.add('is-loading');
    parseBtn.disabled = true;
    statusText.textContent = 'Parsing your journal page (5–15 seconds)…';
    statusText.className = 'micro';

    try {
      try { posthog.capture('tool_parse_started'); } catch (e) {}
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: currentFileBase64, mime_type: currentMimeType })
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Parse failed (${res.status}): ${errBody.slice(0, 140)}`);
      }
      const data = await res.json();
      lastEntries = Array.isArray(data.entries) ? data.entries : [];
      lastRawText = data.raw_text || '';
      renderResults(lastEntries);
      statusText.textContent = `Done — ${lastEntries.length} ${lastEntries.length === 1 ? 'entry' : 'entries'} extracted.`;
      statusText.className = 'micro success';
      try { posthog.capture('tool_parse_succeeded', { entry_count: lastEntries.length }); } catch (e) {}
    } catch (err) {
      console.error(err);
      statusText.textContent = err.message || 'Something went wrong. Try a clearer photo.';
      statusText.className = 'micro error';
      try { posthog.capture('tool_parse_failed', { error: String(err) }); } catch (e) {}
    } finally {
      parseBtn.classList.remove('is-loading');
      parseBtn.disabled = false;
    }
  });

  function renderResults(entries) {
    resultsBody.innerHTML = '';
    if (!entries.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.textAlign = 'center';
      td.style.color = 'var(--ink-mute)';
      td.style.padding = '24px';
      td.textContent = 'No entries extracted. Try a clearer photo or ensure the page has visible rows.';
      tr.appendChild(td);
      resultsBody.appendChild(tr);
    } else {
      entries.forEach(e => {
        const tr = document.createElement('tr');
        ['date', 'signer', 'document', 'id_type', 'fee'].forEach(k => {
          const td = document.createElement('td');
          td.textContent = e[k] || '—';
          tr.appendChild(td);
        });
        resultsBody.appendChild(tr);
      });
    }
    countBadge.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    resultsCard.hidden = false;
    captureCard.hidden = false;
    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ===== Copy / CSV =====
  copyBtn?.addEventListener('click', async () => {
    if (!lastEntries.length) return;
    const lines = [
      ['Date', 'Signer Name', 'Document Type', 'ID Type', 'Fee'].join('\t'),
      ...lastEntries.map(e => [e.date || '', e.signer || '', e.document || '', e.id_type || '', e.fee || ''].join('\t'))
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => (copyBtn.textContent = 'Copy table'), 1800);
      try { posthog.capture('tool_copy_clicked', { entry_count: lastEntries.length }); } catch (e) {}
    } catch (err) {
      copyBtn.textContent = 'Copy failed';
      setTimeout(() => (copyBtn.textContent = 'Copy table'), 1800);
    }
  });

  csvBtn?.addEventListener('click', () => {
    if (!lastEntries.length) return;
    const escape = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const rows = [
      ['Date', 'Signer Name', 'Document Type', 'ID Type', 'Fee'].map(escape).join(','),
      ...lastEntries.map(e => [e.date, e.signer, e.document, e.id_type, e.fee].map(escape).join(','))
    ];
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wayseal-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    try { posthog.capture('tool_csv_downloaded', { entry_count: lastEntries.length }); } catch (e) {}
  });

  // ===== Email capture =====
  captureForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email-input').value.trim();
    if (!email || !email.includes('@')) {
      captureStatus.textContent = 'Please enter a valid email.';
      captureStatus.className = 'micro error';
      return;
    }
    const submitBtn = captureForm.querySelector('button');
    submitBtn.classList.add('is-loading');
    submitBtn.disabled = true;
    captureStatus.textContent = 'Sending…';
    captureStatus.className = 'micro';
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          entries: lastEntries,
          source: 'tool',
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Signup failed: ${txt.slice(0, 120)}`);
      }
      captureStatus.textContent = 'Got it ✓ Check your inbox for the template.';
      captureStatus.className = 'micro success';
      submitBtn.textContent = 'Sent ✓';
      try { posthog.capture('tool_email_captured', { email_domain: email.split('@')[1] }); } catch (e) {}
    } catch (err) {
      captureStatus.textContent = err.message || 'Something went wrong.';
      captureStatus.className = 'micro error';
    } finally {
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;
    }
  });

  try { posthog.capture('tool_loaded'); } catch (e) {}
})();
