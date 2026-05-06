// Wayseal — landing page form handling

(() => {
  ['hero-form', 'cta-form'].forEach((formId) => {
    const form = document.getElementById(formId);
    if (!form) return;
    const statusId = formId === 'hero-form' ? 'hero-status' : 'cta-status';
    const statusEl = document.getElementById(statusId);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.querySelector('input[name="email"]').value.trim();
      if (!email || !email.includes('@')) {
        statusEl.textContent = 'Please enter a valid email.';
        statusEl.className = 'form-status error';
        return;
      }
      const submitBtn = form.querySelector('button');
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = 'Sending…';
      statusEl.textContent = '';
      statusEl.className = 'form-status';
      try {
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source: `landing_${formId}` })
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`Signup failed: ${txt.slice(0, 120)}`);
        }
        statusEl.textContent = "Got it ✓ Check your inbox for the template + early-access link.";
        statusEl.className = 'form-status success';
        submitBtn.textContent = 'Sent ✓';
        form.querySelector('input[name="email"]').value = '';
        try { posthog.capture('signup', { source: formId, email_domain: email.split('@')[1] }); } catch (e) {}
      } catch (err) {
        statusEl.textContent = err.message || 'Something went wrong.';
        statusEl.className = 'form-status error';
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });
  });

  try { posthog.capture('landing_loaded'); } catch (e) {}
})();
