import express from 'express';
import { db, generateUUID } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { aiService } from '../services/aiService.js';

const router = express.Router();
router.use(authenticateToken);

const RETENTION_DAYS = 60;
const CONTEXT_MESSAGES = 40;

function retentionCutoff() {
  const d = new Date();
  d.setDate(d.getDate() - RETENTION_DAYS);
  return d;
}

export async function saveCapturedIdea(userId, capture, messageId) {
  if (!capture.title?.trim()) return null;

  const existing = await db('ideas')
    .whereRaw('user_id = ? AND LOWER(title) = LOWER(?)', [userId, capture.title.trim()])
    .first();
  if (existing) {
    console.log(`[capture] Skipping duplicate idea: "${capture.title}"`);
    return null;
  }

  const nextSteps = capture.next_steps?.length
    ? `Next steps:\n${capture.next_steps.map(s => `- ${s}`).join('\n')}`
    : null;

  const areaId = await resolveAreaId(userId, capture.area);

  const [idea] = await db('ideas').insert({
    id: generateUUID(),
    user_id: userId,
    title: capture.title.trim(),
    summary: capture.summary || null,
    tags: JSON.stringify(capture.tags || []),
    notes: nextSteps,
    vibe: JSON.stringify(capture.vibe || []),
    excitement: capture.excitement || null,
    complexity: capture.complexity || null,
    area_id: areaId,
    capture_message_id: messageId,
  }).returning('*');

  return idea;
}

export async function resolveAreaId(userId, areaName) {
  if (!areaName) return null;
  try {
    const area = await db('areas')
      .whereRaw('user_id = ? AND LOWER(name) = LOWER(?)', [userId, areaName])
      .first();
    return area?.id || null;
  } catch { return null; }
}

export function buildSystemPrompt(areas, recentIdeas) {
  const areaList = areas.length
    ? areas.map(a => a.name).join(', ')
    : 'work, personal, home (default - user has not set up areas yet)';

  const ideaList = recentIdeas.length
    ? recentIdeas.map(i => `- ${i.title} (${i.created_at?.split('T')[0]})`).join('\n')
    : 'none yet';

  return `You are a friendly capture assistant inside viberater, a personal idea management app. Help the user capture and develop ideas through natural conversation - like texting a smart friend who genuinely finds their ideas interesting.

Ideas can be ANYTHING - tech projects, garden designs, home renovations, recipes, travel plans, blog posts, business ideas, creative projects, things to research, purchases to consider. Don't assume tech context.

STYLE:
- Short responses (1-3 sentences max). This is messaging, not essays.
- Ask ONE follow-up question at a time to flesh out the idea
- Warm and curious - genuinely interested, not formal
- Use casual language, contractions, be natural
- Match the energy of the idea - excited about a garden plan? Be enthusiastic.

FLOW:
1. User shares a rough thought → ask one good question to develop it
2. After 1-2 exchanges you have enough → tell them what you're capturing
3. Infer the area from context clues, confirm casually: "sounds like a home project — saving it there, yeah?"
4. Before saving, ask "any obvious next steps?" — one question, not a form
5. Once you have next steps (or they say none), output the CAPTURE block

MULTIPLE IDEAS IN ONE MESSAGE:
Users often string ideas together in a single message. Watch for transition signals:
- Additive: "also", "oh and", "another thing", "one more", "and another idea", "plus"
- Collective: "we should", "we could also", "and we need to"
- New thought: "actually", "while I'm at it", "on a different note", "separately"
- Lists: numbered or bulleted items, or sentences separated by "—" or "..."

When you spot multiple distinct ideas, treat each separately:
- Acknowledge all of them briefly in your reply
- Emit one CAPTURE block per idea (multiple blocks in the same response is fine)
- Only ask a follow-up for the most interesting/underdeveloped one, not all of them
- Cross-reference ideas against each other and against ALREADY SAVED IDEAS — note if something connects

NO DUPLICATE CAPTURES — CRITICAL RULE:
The "ALREADY SAVED IDEAS" list below contains ideas that are ALREADY in the user's library. NEVER emit a CAPTURE block for any idea that appears in that list, or for any idea you already captured earlier in this same conversation. Each idea should be captured exactly once. If the user mentions a saved idea again (to refine, discuss, or act on it), acknowledge it and engage — but do NOT re-capture it.

AREAS AVAILABLE: ${areaList}

ALREADY SAVED IDEAS (do NOT re-capture these):
${ideaList}

CAPTURE FORMAT:
When ready to save a NEW idea, emit this on its own line (one per idea):
CAPTURE:{"title":"...","summary":"...","area":"...","tags":["..."],"next_steps":["step 1","step 2"],"excitement":7,"complexity":"weekend","vibe":["creative","practical"]}

FIELD GUIDANCE (infer from context, don't ask):
- excitement: 1-10 based on how animated/enthusiastic the user seems. Casual mention = 5, clearly excited = 8-9, life-changing = 10
- complexity: one of "afternoon", "weekend", "week", "month", "months" — based on scope described
- vibe: 1-3 mood/feel words that capture the nature of the idea (e.g. "creative", "practical", "ambitious", "relaxing", "technical", "personal", "fun")
- next_steps: short actionable strings, empty array [] if none mentioned

Everything before CAPTURE lines is shown to the user. CAPTURE lines are stripped silently.

If the user is just chatting or asking something (not capturing an idea), respond naturally with no CAPTURE block.
After captures: acknowledge briefly ("got both of those") and stay in the conversation naturally.`;
}

// GET /capture/messages
router.get('/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    const q = db('capture_messages')
      .where({ user_id: req.user.userId })
      .where('created_at', '>', retentionCutoff())
      .select('id', 'role', 'content', 'created_at')
      .orderBy('created_at');

    if (session_id) q.where({ session_id });

    res.json({ messages: await q });
  } catch (error) {
    console.error('Get capture messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /capture/sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await db('capture_messages as m1')
      .where({ 'm1.user_id': req.user.userId })
      .whereNotNull('m1.session_id')
      .where('m1.created_at', '>', retentionCutoff())
      .select('m1.session_id')
      .min('m1.created_at as started_at')
      .max('m1.created_at as last_message_at')
      .count('* as message_count')
      .select(
        db.raw(`(SELECT content FROM capture_messages m2
                 WHERE m2.session_id = m1.session_id AND m2.user_id = ?
                   AND m2.role = 'user'
                 ORDER BY m2.created_at ASC LIMIT 1) AS preview`, [req.user.userId])
      )
      .groupBy('m1.session_id')
      .orderBy('last_message_at', 'desc');

    res.json({ sessions });
  } catch (error) {
    console.error('Get capture sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

async function getContext(userId, sessionId) {
  const [areas, recentIdeas, history] = await Promise.all([
    db('areas').where({ user_id: userId }).select('name').orderBy('sort_order'),
    db('ideas').where({ user_id: userId }).select('title', 'created_at').orderBy('created_at', 'desc').limit(20),
    db('capture_messages')
      .where({ user_id: userId })
      .where('created_at', '>', retentionCutoff())
      .modify(q => { if (sessionId) q.where({ session_id: sessionId }); })
      .select('role', 'content')
      .orderBy('created_at')
      .limit(CONTEXT_MESSAGES),
  ]);
  return { areas, recentIdeas, history };
}

// POST /capture/chat
router.post('/chat', async (req, res) => {
  try {
    const { content, session_id } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Message content required' });

    const userId = req.user.userId;

    const [userMsg] = await db('capture_messages').insert({
      id: generateUUID(),
      user_id: userId,
      role: 'user',
      content: content.trim(),
      session_id: session_id || null,
    }).returning('*');

    const { areas, recentIdeas, history } = await getContext(userId, session_id);
    const systemPrompt = buildSystemPrompt(areas, recentIdeas);
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }));

    const aiResponse = await aiService.chatRaw(aiMessages, { systemPrompt });
    const fullContent = aiResponse.content;

    const captures = [];
    const displayContent = fullContent.replace(/CAPTURE:(\{[\s\S]*?\})(?=\n|$)/gm, (_, json) => {
      try { captures.push(JSON.parse(json)); } catch {}
      return '';
    }).trim();

    const [assistantMsg] = await db('capture_messages').insert({
      id: generateUUID(),
      user_id: userId,
      role: 'assistant',
      content: displayContent,
      session_id: session_id || null,
    }).returning('*');

    const savedIdeas = [];
    for (const capture of captures) {
      try {
        const idea = await saveCapturedIdea(userId, capture, assistantMsg.id);
        if (idea) savedIdeas.push(idea);
      } catch (e) { console.error('Failed to save captured idea:', e); }
    }

    res.json({
      message: { id: assistantMsg.id, role: 'assistant', content: displayContent, created_at: assistantMsg.created_at },
      captured: savedIdeas,
    });
  } catch (error) {
    console.error('Capture chat error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// POST /capture/stream — SSE
router.post('/stream', async (req, res) => {
  const { content, session_id } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Message content required' });

  const userId = req.user.userId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    await db('capture_messages').insert({
      id: generateUUID(),
      user_id: userId,
      role: 'user',
      content: content.trim(),
      session_id: session_id || null,
    });

    const { areas, recentIdeas, history } = await getContext(userId, session_id);
    const systemPrompt = buildSystemPrompt(areas, recentIdeas);
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }));

    let fullContent = '';
    await aiService.streamRaw(aiMessages, { systemPrompt }, (token) => {
      fullContent += token;
      send({ type: 'token', text: token });
    });

    const captures = [];
    const displayContent = fullContent.replace(/CAPTURE:(\{[\s\S]*?\})(?=\n|$)/gm, (_, json) => {
      try { captures.push(JSON.parse(json)); } catch {}
      return '';
    }).trim();

    const [assistantMsg] = await db('capture_messages').insert({
      id: generateUUID(),
      user_id: userId,
      role: 'assistant',
      content: displayContent,
      session_id: session_id || null,
    }).returning('*');

    const savedIdeas = [];
    for (const capture of captures) {
      try {
        const idea = await saveCapturedIdea(userId, capture, assistantMsg.id);
        if (idea) savedIdeas.push(idea);
      } catch (e) { console.error('Failed to save captured idea:', e); }
    }

    send({
      type: 'done',
      messageId: assistantMsg.id,
      created_at: assistantMsg.created_at,
      content: displayContent,
      captured: savedIdeas,
    });

    res.end();
  } catch (error) {
    console.error('Capture stream error:', error);
    send({ type: 'error', message: error.message });
    res.end();
  }
});

export default router;
