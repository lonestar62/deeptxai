'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3016;
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

// ── Secret resolution ─────────────────────────────────────────────────────────
function getSecret(name) {
  try {
    return execSync(
      `gcloud secrets versions access latest --secret=${name} --project=boxwood-yen-465815-h0`,
      { env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: '/home/rod/.openclaw/workspace/.gcp-sa.json' } }
    ).toString().trim();
  } catch {
    return process.env.ANTHROPIC_API_KEY || '';
  }
}

// Resolve at startup (sync, one-time)
const ANTHROPIC_KEY = getSecret('fleet-anthropic-api-key');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Contact form ──────────────────────────────────────────────────────────────
app.post('/api/contact', (req, res) => {
  const { name, email, company, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  const entry = {
    timestamp: new Date().toISOString(),
    name, email, company: company || '', message,
  };

  let contacts = [];
  if (fs.existsSync(CONTACTS_FILE)) {
    try { contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8')); } catch { contacts = []; }
  }

  contacts.push(entry);
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));

  res.json({ success: true, message: "Message received. We'll be in touch within 24 hours." });
});

// ── Chat endpoint (Claude claude-haiku-4-5, SSE streaming) ───────────────────────────────
const CHAT_SYSTEM = `You are a helpful AI assistant for DeepTxAI — an AI-native development agency based in Deep East Texas. You help visitors learn about DeepTxAI's services, portfolio, and technology.

DeepTxAI builds production AI systems: multi-agent platforms (NCL — Neural Context Listener), neurological AI (Brain3 with Dr. Bauer), business automation (BDE), and more. Founded by Rod Whiddon — 35+ years from telecom to autonomous AI.

Be concise, direct, and technically credible. If someone wants to work with DeepTxAI or has a project, ask them for their name, email, and a brief description of what they're building. Services: custom AI agents, LLM integrations, full-stack development, $150–200/hr.

Keep responses to 2–3 short paragraphs max. No fluff.`;

app.post('/api/chat', async (req, res) => {
  const { messages, sessionId } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: CHAT_SYSTEM,
      messages: userMessages,
    });

    const message = response.content[0]?.text || 'Something went wrong — please try again.';
    res.json({ message });
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ message: 'Something went wrong — please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`DeepTxAI server running on http://localhost:${PORT}`);
});
