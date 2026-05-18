import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { db, generateUUID } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const REACTIONS = ['👍', '💡', '🔥'];

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip + (process.env.JWT_SECRET || 'salt')).digest('hex').slice(0, 32);
}

const commentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 3,
  keyGenerator: (req) => `${hashIp(req.ip)}-${req.params.token}`,
  handler: (req, res) => res.status(429).json({ error: 'Too many comments — try again later.' }),
  skip: () => process.env.NODE_ENV !== 'production',
});

const reactionLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 10,
  keyGenerator: (req) => `${hashIp(req.ip)}-${req.params.token}-react`,
  handler: (req, res) => res.status(429).json({ error: 'Too many reactions.' }),
  skip: () => process.env.NODE_ENV !== 'production',
});

// GET /api/share/:token
router.get('/:token', async (req, res) => {
  try {
    const idea = await db('ideas')
      .where({ share_token: req.params.token, sharing_enabled: 1 })
      .select('id', 'title', 'summary', 'tags', 'vibe', 'excitement', 'complexity', 'notes', 'design_document', 'links', 'research', 'riff_conversation', 'created_at')
      .first();

    if (!idea) return res.status(404).json({ error: 'Shared idea not found' });

    const [reactions, comments] = await Promise.all([
      db('idea_reactions').where({ idea_id: idea.id }).select('reaction').count('* as count').groupBy('reaction'),
      db('idea_comments').where({ idea_id: idea.id })
        .select('id', 'author_name', 'content', 'is_author_reply', 'created_at')
        .orderBy('created_at'),
    ]);

    res.json({ idea, reactions, comments });
  } catch (error) {
    console.error('Get shared idea error:', error);
    res.status(500).json({ error: 'Failed to load shared idea' });
  }
});

// POST /api/share/:token/react
router.post('/:token/react', reactionLimiter, async (req, res) => {
  try {
    const { reaction } = req.body;
    if (!REACTIONS.includes(reaction)) return res.status(400).json({ error: 'Invalid reaction' });

    const idea = await db('ideas').where({ share_token: req.params.token, sharing_enabled: 1 }).select('id').first();
    if (!idea) return res.status(404).json({ error: 'Not found' });

    const ipHash = hashIp(req.ip);
    const existing = await db('idea_reactions').where({ idea_id: idea.id, reaction, ip_hash: ipHash }).first();

    if (existing) {
      await db('idea_reactions').where({ id: existing.id }).del();
    } else {
      await db('idea_reactions').insert({ id: generateUUID(), idea_id: idea.id, reaction, ip_hash: ipHash });
    }

    const reactions = await db('idea_reactions').where({ idea_id: idea.id }).select('reaction').count('* as count').groupBy('reaction');
    res.json({ reactions });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ error: 'Failed to save reaction' });
  }
});

// POST /api/share/:token/comment
router.post('/:token/comment', commentLimiter, async (req, res) => {
  try {
    const { author_name, content } = req.body;
    if (!author_name?.trim()) return res.status(400).json({ error: 'Name required' });
    if (!content?.trim()) return res.status(400).json({ error: 'Comment required' });
    if (content.length > 2000) return res.status(400).json({ error: 'Comment too long' });
    if (author_name.length > 100) return res.status(400).json({ error: 'Name too long' });

    const idea = await db('ideas').where({ share_token: req.params.token, sharing_enabled: 1 }).select('id').first();
    if (!idea) return res.status(404).json({ error: 'Not found' });

    const [comment] = await db('idea_comments').insert({
      id: generateUUID(),
      idea_id: idea.id,
      author_name: author_name.trim(),
      content: content.trim(),
      ip_hash: hashIp(req.ip),
    }).returning(['id', 'author_name', 'content', 'is_author_reply', 'created_at']);

    await db('ideas').where({ id: idea.id }).increment('unread_comment_count', 1);

    res.status(201).json({ comment });
  } catch (error) {
    console.error('Comment error:', error);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// PATCH /api/share/manage/:ideaId — toggle sharing
router.patch('/manage/:ideaId', authenticateToken, async (req, res) => {
  try {
    const { enabled } = req.body;
    const idea = await db('ideas').where({ id: req.params.ideaId, user_id: req.user.userId }).first();
    if (!idea) return res.status(404).json({ error: 'Idea not found' });

    let shareToken = null;
    if (enabled) {
      shareToken = crypto.randomUUID();
      await db('ideas').where({ id: req.params.ideaId }).update({ sharing_enabled: 1, share_token: shareToken });
    } else {
      await db('ideas').where({ id: req.params.ideaId }).update({ sharing_enabled: 0 });
    }

    res.json({ sharing_enabled: enabled, share_token: shareToken });
  } catch (error) {
    console.error('Toggle sharing error:', error);
    res.status(500).json({ error: 'Failed to update sharing' });
  }
});

// GET /api/share/manage/:ideaId/comments
router.get('/manage/:ideaId/comments', authenticateToken, async (req, res) => {
  try {
    const idea = await db('ideas').where({ id: req.params.ideaId, user_id: req.user.userId }).first();
    if (!idea) return res.status(404).json({ error: 'Idea not found' });

    const comments = await db('idea_comments').where({ idea_id: req.params.ideaId })
      .select('id', 'author_name', 'content', 'is_author_reply', 'created_at')
      .orderBy('created_at');

    await db('ideas').where({ id: req.params.ideaId }).update({ unread_comment_count: 0 });

    res.json({ comments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/share/manage/:ideaId/comments — author reply
router.post('/manage/:ideaId/comments', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
    if (content.length > 2000) return res.status(400).json({ error: 'Too long' });

    const idea = await db('ideas').where({ id: req.params.ideaId, user_id: req.user.userId }).first();
    if (!idea) return res.status(404).json({ error: 'Idea not found' });

    const [comment] = await db('idea_comments').insert({
      id: generateUUID(),
      idea_id: req.params.ideaId,
      author_name: 'Author',
      content: content.trim(),
      is_author_reply: 1,
    }).returning(['id', 'author_name', 'content', 'is_author_reply', 'created_at']);

    res.status(201).json({ comment });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post reply' });
  }
});

// DELETE /api/share/manage/:ideaId/comments/:commentId
router.delete('/manage/:ideaId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const idea = await db('ideas').where({ id: req.params.ideaId, user_id: req.user.userId }).first();
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    await db('idea_comments').where({ id: req.params.commentId, idea_id: req.params.ideaId }).del();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

export default router;
