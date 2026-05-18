import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';

// Import routes (will create these next)
import authRoutes from './routes/auth.js';
import ideasRoutes from './routes/ideas.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import aiRoutes from './routes/ai.js';
import gitRoutes from './routes/git.js';
import syncRoutes from './routes/sync.js';
import remindersRoutes from './routes/reminders.js';
import captureRoutes from './routes/capture.js';
import areasRoutes, { bootstrapAreas } from './routes/areas.js';
import attachmentsRoutes from './routes/attachments.js';
import shareRoutes from './routes/share.js';
import researchRoutes from './routes/research.js';
import mcpRoutes from './routes/mcp.js';
import { db } from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - we're behind nginx
app.set('trust proxy', 1);

// Disable ETags — prevents browser returning stale 304 responses for API data
app.disable('etag');
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// CORS - supports comma-separated list of allowed origins in CORS_ORIGIN
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : null;
app.use(cors({
  origin: corsOrigins
    ? (corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins)
    : (process.env.NODE_ENV !== 'production' ? true : false),
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const rateLimitHandler = (req, res) => {
  res.status(429).json({ error: 'Too many requests, please try again later.' });
};

// General API rate limit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => process.env.NODE_ENV !== 'production',
});

// Strict limit for auth endpoints — brute force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => process.env.NODE_ENV !== 'production',
});

app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/ideas', ideasRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/capture', captureRoutes);
app.use('/api/areas', areasRoutes);
app.use('/api/attachments', attachmentsRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/research', researchRoutes);
app.use('/mcp', mcpRoutes);

// Server-rendered share page with OG meta tags
// Crawlers (Slack, WhatsApp, etc.) hit this instead of the React SPA
app.get('/share/:token', async (req, res) => {
  try {
    const idea = await db('ideas')
      .where({ share_token: req.params.token, sharing_enabled: 1 })
      .select('id', 'title', 'summary', 'tags', 'notes', 'design_document', 'research', 'links', 'excitement', 'complexity', 'created_at')
      .first();

    const appUrl = process.env.APP_URL || '';
    const shareUrl = `${appUrl}/share/${req.params.token}`;

    if (!idea) {
      return res.status(404).send(`<!DOCTYPE html>
<html><head><title>Idea not found</title></head>
<body><p>This shared idea is no longer available.</p></body></html>`);
    }

    const [reactions, comments] = await Promise.all([
      db('idea_reactions').where({ idea_id: idea.id }).select('reaction').count('* as count').groupBy('reaction'),
      db('idea_comments').where({ idea_id: idea.id }).select('id', 'author_name', 'content', 'is_author_reply', 'created_at').orderBy('created_at'),
    ]);

    const tags = (() => { try { return JSON.parse(idea.tags || '[]'); } catch { return []; } })();
    const links = (() => { try { return JSON.parse(idea.links || '[]'); } catch { return []; } })().filter(Boolean);
    const ogDescription = [
      idea.summary?.slice(0, 200),
      idea.complexity ? `Complexity: ${idea.complexity}` : null,
      idea.excitement ? `Excitement: ${idea.excitement}/10` : null,
      tags.length ? tags.map(t => `#${t}`).join(' ') : null,
    ].filter(Boolean).join(' · ');

    const tagsHtml = tags.map(t =>
      `<span style="display:inline-block;padding:2px 10px;border-radius:99px;background:rgba(255,255,255,0.08);font-size:12px;color:#9ca3af;margin:2px">#${escapeHtml(t)}</span>`
    ).join('');

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(idea.title)} — Hatch</title>

  <meta name="description" content="${escapeHtml(ogDescription)}" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="${escapeHtml(shareUrl)}" />
  <meta property="og:title" content="${escapeHtml(idea.title)}" />
  <meta property="og:description" content="${escapeHtml(ogDescription)}" />
  <meta property="og:site_name" content="Hatch" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(idea.title)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />

  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#030712;color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px}
    .card{max-width:640px;width:100%}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:12px}
    h1{font-size:28px;font-weight:700;line-height:1.25;margin-bottom:16px}
    .meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
    .pill{display:inline-block;padding:4px 12px;border-radius:99px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);font-size:12px;color:#d1d5db}
    .block{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px}
    .block p,.block pre{font-size:14px;line-height:1.7;color:#e5e7eb;white-space:pre-wrap}
    .block-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:10px}
    .tags{margin-bottom:24px}
    .reactions{display:flex;gap:10px;margin-bottom:28px}
    .react-btn{display:flex;align-items:center;gap:6px;padding:8px 16px;border-radius:99px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#d1d5db;font-size:14px;cursor:pointer;transition:border-color .15s}
    .react-btn:hover{border-color:rgba(129,140,248,.4);background:rgba(129,140,248,.06)}
    .comment{margin-bottom:20px}
    .comment.reply{padding-left:14px;border-left:2px solid rgba(129,140,248,.3)}
    .comment-author{font-size:13px;font-weight:600;color:#f9fafb;margin-bottom:4px}
    .comment-author.reply-author{color:#818cf8}
    .comment-date{font-size:11px;color:#6b7280;margin-left:8px;font-weight:400}
    .comment-text{font-size:14px;color:#d1d5db;line-height:1.6;white-space:pre-wrap}
    .divider{border:none;border-top:1px solid rgba(255,255,255,0.08);margin:28px 0}
    .section-title{font-size:15px;font-weight:600;margin-bottom:20px}
    input,textarea{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 14px;font-size:14px;color:#f9fafb;outline:none;font-family:inherit}
    input:focus,textarea:focus{border-color:rgba(129,140,248,.4)}
    textarea{resize:none}
    .submit-btn{margin-top:10px;padding:8px 20px;border-radius:12px;background:rgba(129,140,248,.15);border:1px solid rgba(129,140,248,.3);color:#818cf8;font-size:14px;font-weight:500;cursor:pointer}
    .submit-btn:hover{background:rgba(129,140,248,.25)}
    .submit-btn:disabled{opacity:.4;cursor:default}
    .form-row{display:flex;justify-content:space-between;align-items:center;margin-top:10px}
    .char-count{font-size:12px;color:#6b7280}
    .footer{font-size:12px;color:#4b5563;margin-top:32px}
    a{color:#818cf8;text-decoration:none}
    .links a{display:block;font-size:14px;margin-bottom:6px;word-break:break-all}
    .error{color:#f87171;font-size:13px;margin-top:6px}
  </style>
</head>
<body>
  <div class="card">
    <div class="label">Shared idea</div>
    <h1>${escapeHtml(idea.title)}</h1>

    <div class="meta">
      ${idea.complexity ? `<span class="pill">⏱ ${escapeHtml(idea.complexity)}</span>` : ''}
      ${idea.excitement ? `<span class="pill">⚡ ${escapeHtml(String(idea.excitement))}/10</span>` : ''}
    </div>

    ${idea.summary ? `<div class="block"><p>${escapeHtml(idea.summary)}</p></div>` : ''}
    ${idea.notes ? `<div class="block"><div class="block-label">Notes</div><p>${escapeHtml(idea.notes)}</p></div>` : ''}
    ${idea.design_document ? `<div class="block"><div class="block-label">Design</div><p>${escapeHtml(idea.design_document)}</p></div>` : ''}
    ${idea.research ? `<div class="block"><div class="block-label">Validation</div><p>${escapeHtml(idea.research)}</p></div>` : ''}
    ${links.length ? `<div class="block links"><div class="block-label">Links</div>${links.map(l => `<a href="${escapeHtml(l)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l)}</a>`).join('')}</div>` : ''}
    ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}

    <div class="reactions" id="reactions">
      ${['👍','💡','🔥'].map(emoji => {
        const count = reactions.find(r => r.reaction === emoji)?.count || 0;
        return `<button class="react-btn" onclick="react('${emoji}')" data-emoji="${emoji}">
          <span>${emoji}</span>${count > 0 ? `<span class="count" id="count-${emoji}">${count}</span>` : `<span class="count" id="count-${emoji}" style="display:none">${count}</span>`}
        </button>`;
      }).join('')}
    </div>

    <hr class="divider" />

    <div id="comments-section">
      <div class="section-title" id="comments-title">${comments.length > 0 ? `${comments.length} comment${comments.length !== 1 ? 's' : ''}` : 'No comments yet'}</div>
      <div id="comments-list">
        ${comments.map(c => `
          <div class="comment${c.is_author_reply ? ' reply' : ''}">
            <div class="comment-author${c.is_author_reply ? ' reply-author' : ''}">${c.is_author_reply ? '✏️ Author' : escapeHtml(c.author_name)}<span class="comment-date">${new Date(c.created_at).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'})}</span></div>
            <div class="comment-text">${escapeHtml(c.content)}</div>
          </div>`).join('')}
      </div>

      <form id="comment-form" style="margin-top:24px" onsubmit="submitComment(event)">
        <input id="comment-name" placeholder="Your name" maxlength="100" value="" style="margin-bottom:10px" />
        <textarea id="comment-text" placeholder="Leave a comment…" rows="3" maxlength="2000"></textarea>
        <div class="form-row">
          <span class="char-count" id="char-count">0/2000</span>
          <button type="submit" class="submit-btn" id="submit-btn">Post comment</button>
        </div>
        <div class="error" id="comment-error" style="display:none"></div>
      </form>
    </div>

    <div class="footer">Shared via <a href="${escapeHtml(appUrl || '/')}">Hatch</a></div>
  </div>

  <script>
    const TOKEN = ${JSON.stringify(req.params.token)};
    const API = '/api/share/' + TOKEN;

    document.getElementById('comment-name').value = localStorage.getItem('share_name') || '';
    document.getElementById('comment-text').addEventListener('input', function() {
      document.getElementById('char-count').textContent = this.value.length + '/2000';
    });

    async function react(emoji) {
      const r = await fetch(API + '/react', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reaction:emoji})});
      const d = await r.json();
      if (d.reactions) {
        d.reactions.forEach(({reaction, count}) => {
          const el = document.getElementById('count-' + reaction);
          if (el) { el.textContent = count; el.style.display = count > 0 ? '' : 'none'; }
        });
      }
    }

    async function submitComment(e) {
      e.preventDefault();
      const name = document.getElementById('comment-name').value.trim();
      const text = document.getElementById('comment-text').value.trim();
      const errEl = document.getElementById('comment-error');
      const btn = document.getElementById('submit-btn');
      if (!name || !text) return;
      btn.disabled = true; btn.textContent = 'Posting…'; errEl.style.display = 'none';
      const r = await fetch(API + '/comment', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({author_name:name,content:text})});
      const d = await r.json();
      if (d.error) { errEl.textContent = d.error; errEl.style.display = ''; btn.disabled = false; btn.textContent = 'Post comment'; return; }
      localStorage.setItem('share_name', name);
      document.getElementById('comment-text').value = '';
      document.getElementById('char-count').textContent = '0/2000';
      btn.disabled = false; btn.textContent = '✓ Posted';
      setTimeout(() => btn.textContent = 'Post comment', 3000);
      const list = document.getElementById('comments-list');
      const div = document.createElement('div');
      div.className = 'comment';
      div.innerHTML = '<div class="comment-author">' + name + '</div><div class="comment-text">' + d.comment.content.replace(/</g,'&lt;') + '</div>';
      list.appendChild(div);
      const title = document.getElementById('comments-title');
      const cur = list.querySelectorAll('.comment').length;
      title.textContent = cur + ' comment' + (cur !== 1 ? 's' : '');
    }
  </script>
</body>
</html>`);
  } catch (err) {
    console.error('OG share render error:', err);
    res.status(500).send('<html><body>Error loading idea.</body></html>');
  }
});

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Ensure storage directory exists
const storageRoot = process.env.STORAGE_ROOT || './storage/projects';
await fs.ensureDir(storageRoot);
await fs.ensureDir('./logs');

// Purge expired refresh tokens daily
async function purgeExpiredTokens() {
  try {
    const count = await db('refresh_tokens').where('expires_at', '<', new Date()).del();
    if (count > 0) console.log(`[auth] Purged ${count} expired refresh tokens`);
  } catch (e) {
    if (!e.message?.includes('no such table')) {
      console.error('[auth] Token purge failed:', e.message);
    }
  }
}
purgeExpiredTokens();
setInterval(purgeExpiredTokens, 24 * 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('🎤 viberater Backend API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ API endpoint: http://localhost:${PORT}/api`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

export default app;
