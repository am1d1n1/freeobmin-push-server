const express = require('express');

const app = express();
app.use(express.json({ limit: '1mb' }));

const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '';
const ONE_SIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/notify', async (req, res) => {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_API_KEY) {
    return res.status(500).json({ error: 'Missing OneSignal config' });
  }

  const { to, title, body, url } = req.body || {};
  if (!to || !title || !body) {
    return res.status(400).json({ error: 'to, title, body required' });
  }

  const payload = {
    app_id: ONE_SIGNAL_APP_ID,
    include_player_ids: [to],
    headings: { en: title },
    contents: { en: body },
  };

  if (url) {
    payload.url = url;
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${ONE_SIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: text });
    }

    return res.json({ ok: true, response: text });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`OneSignal push server running on ${port}`);
});
