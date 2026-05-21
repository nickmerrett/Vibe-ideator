import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { db, generateUUID } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { aiService } from '../services/aiService.js';
import { buildSystemPrompt, saveCapturedIdea } from './capture.js';

const router = express.Router();

function buildServer(userId) {
  const server = new McpServer({ name: 'viberater', version: '1.0.0' });

  // ── Areas ────────────────────────────────────────────────────────────────

  server.tool(
    'list_areas',
    'List all areas (project categories)',
    {},
    async () => {
      const areas = await db('areas')
        .where({ user_id: userId })
        .select('id', 'name', 'color')
        .orderBy('sort_order');
      return { content: [{ type: 'text', text: JSON.stringify(areas, null, 2) }] };
    }
  );

  // ── Ideas ────────────────────────────────────────────────────────────────

  server.tool(
    'list_ideas',
    'List ideas with optional filters',
    {
      status: z.string().optional().describe('Filter by status (e.g. new, refining, refined)'),
      area_id: z.string().optional().describe('Filter by area UUID'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
    },
    async ({ status, area_id, limit = 20 }) => {
      const q = db('ideas')
        .where({ user_id: userId })
        .select('id', 'title', 'summary', 'status', 'area_id', 'tags', 'excitement', 'complexity', 'created_at')
        .orderBy('created_at', 'desc')
        .limit(limit);
      if (status) q.where({ status });
      if (area_id) q.where({ area_id });
      const ideas = await q;
      return { content: [{ type: 'text', text: JSON.stringify(ideas, null, 2) }] };
    }
  );

  server.tool(
    'get_idea',
    'Get a single idea by ID',
    {
      id: z.string().describe('Idea UUID'),
    },
    async ({ id }) => {
      const idea = await db('ideas').where({ id, user_id: userId }).first();
      if (!idea) return { content: [{ type: 'text', text: 'Idea not found' }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(idea, null, 2) }] };
    }
  );

  server.tool(
    'create_idea',
    'Save a new idea',
    {
      title: z.string().describe('Idea title'),
      summary: z.string().optional().describe('Brief description'),
      tags: z.array(z.string()).optional().describe('Tags'),
      area_id: z.string().optional().describe('Area UUID from list_areas'),
      excitement: z.number().int().min(1).max(10).optional().describe('Excitement 1–10'),
      complexity: z.enum(['Low', 'Medium', 'High']).optional().describe('Complexity estimate'),
      notes: z.string().optional().describe('Additional notes'),
    },
    async ({ title, summary, tags, area_id, excitement, complexity, notes }) => {
      const [idea] = await db('ideas').insert({
        id: generateUUID(),
        user_id: userId,
        title,
        summary: summary || null,
        tags: JSON.stringify(tags || []),
        area_id: area_id || null,
        excitement: excitement || null,
        complexity: complexity || null,
        notes: notes || null,
        vibe: JSON.stringify([]),
        links: JSON.stringify([]),
        related_ideas: JSON.stringify([]),
      }).returning('*');
      return { content: [{ type: 'text', text: `Idea created:\n${JSON.stringify(idea, null, 2)}` }] };
    }
  );

  server.tool(
    'update_idea',
    'Update fields on an existing idea',
    {
      id: z.string().describe('Idea UUID'),
      title: z.string().optional(),
      summary: z.string().optional(),
      tags: z.array(z.string()).optional(),
      area_id: z.string().nullable().optional().describe('Set null to remove area'),
      excitement: z.number().int().min(1).max(10).optional(),
      complexity: z.enum(['Low', 'Medium', 'High']).optional(),
      status: z.string().optional(),
      notes: z.string().optional(),
    },
    async ({ id, ...fields }) => {
      const updates = {};
      if (fields.title      !== undefined) updates.title      = fields.title;
      if (fields.summary    !== undefined) updates.summary    = fields.summary;
      if (fields.tags       !== undefined) updates.tags       = JSON.stringify(fields.tags);
      if ('area_id' in fields)             updates.area_id    = fields.area_id;
      if (fields.excitement !== undefined) updates.excitement = fields.excitement;
      if (fields.complexity !== undefined) updates.complexity = fields.complexity;
      if (fields.status     !== undefined) updates.status     = fields.status;
      if (fields.notes      !== undefined) updates.notes      = fields.notes;

      if (!Object.keys(updates).length) {
        return { content: [{ type: 'text', text: 'No fields provided to update' }] };
      }

      const [idea] = await db('ideas')
        .where({ id, user_id: userId })
        .update(updates)
        .returning('*');

      if (!idea) return { content: [{ type: 'text', text: 'Idea not found' }], isError: true };
      return { content: [{ type: 'text', text: `Updated:\n${JSON.stringify(idea, null, 2)}` }] };
    }
  );

  server.tool(
    'delete_idea',
    'Delete an idea permanently',
    {
      id: z.string().describe('Idea UUID'),
    },
    async ({ id }) => {
      const count = await db('ideas').where({ id, user_id: userId }).del();
      if (!count) return { content: [{ type: 'text', text: 'Idea not found' }], isError: true };
      return { content: [{ type: 'text', text: 'Idea deleted.' }] };
    }
  );

  // ── Review ───────────────────────────────────────────────────────────────

  server.tool(
    'get_review_queue',
    'Get ideas due for weekly review (untouched for 14+ days, not archived, snooze expired)',
    {},
    async () => {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      const ideas = await db('ideas')
        .where({ user_id: userId, archived: 0 })
        .whereNot({ status: 'promoted-to-project' })
        .where('updated_at', '<', cutoff)
        .where(function () {
          this.whereNull('snoozed_until').orWhere('snoozed_until', '<', now);
        })
        .select('id', 'title', 'summary', 'status', 'excitement', 'complexity', 'updated_at')
        .orderBy('updated_at', 'asc');
      return { content: [{ type: 'text', text: JSON.stringify(ideas, null, 2) }] };
    }
  );

  server.tool(
    'triage_idea',
    'Triage an idea during weekly review: keep active, snooze 2 weeks, archive, or promote to project',
    {
      id: z.string().describe('Idea UUID'),
      action: z.enum(['keep', 'snooze', 'archive', 'promote']).describe('Triage action'),
    },
    async ({ id, action }) => {
      const idea = await db('ideas').where({ id, user_id: userId }).first();
      if (!idea) return { content: [{ type: 'text', text: 'Idea not found' }], isError: true };

      const now = new Date().toISOString();
      const updates = { last_reviewed_at: now };

      if (action === 'archive') {
        updates.archived = 1;
      } else if (action === 'snooze') {
        updates.snoozed_until = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      } else if (action === 'promote') {
        const [project] = await db('projects').insert({
          id: generateUUID(),
          user_id: userId,
          origin_idea_id: idea.id,
          title: idea.title,
          description: idea.summary,
          tech_stack: idea.tech_stack || JSON.stringify([]),
          vibe: idea.vibe || JSON.stringify([]),
          excitement: idea.excitement,
          status: 'planning',
          project_plan: JSON.stringify({ goals: [], phases: [], estimatedDuration: null }),
        }).returning('*');
        updates.status = 'promoted-to-project';
        updates.project_id = project.id;
        await db('ideas').where({ id }).update(updates);
        return { content: [{ type: 'text', text: `Promoted to project: ${JSON.stringify(project, null, 2)}` }] };
      }

      await db('ideas').where({ id }).update(updates);
      return { content: [{ type: 'text', text: `Idea ${action}d successfully` }] };
    }
  );

  // ── Capture ───────────────────────────────────────────────────────────────

  server.tool(
    'capture',
    'Send a rough thought to the AI capture assistant — it will shape and save it as an idea',
    {
      message: z.string().describe('The rough thought, idea fragment, or observation to capture'),
    },
    async ({ message }) => {
      const [areas, recentIdeas] = await Promise.all([
        db('areas').where({ user_id: userId }).select('name').orderBy('sort_order'),
        db('ideas').where({ user_id: userId }).select('title', 'created_at').orderBy('created_at', 'desc').limit(20),
      ]);

      const systemPrompt = buildSystemPrompt(areas, recentIdeas);

      const response = await aiService.chatRaw(
        [{ role: 'user', content: message }],
        { systemPrompt }
      );

      const fullContent = response.content;
      const captures = [];
      const displayContent = fullContent.replace(/CAPTURE:(\{[\s\S]*?\})(?=\n|$)/gm, (_, json) => {
        try { captures.push(JSON.parse(json)); } catch {}
        return '';
      }).trim();

      const savedIdeas = [];
      for (const capture of captures) {
        try {
          const idea = await saveCapturedIdea(userId, capture, null);
          if (idea) savedIdeas.push(idea);
        } catch (e) { console.error('[mcp capture] Failed to save idea:', e); }
      }

      const savedNote = savedIdeas.length
        ? `\n\n[Saved ${savedIdeas.length} idea${savedIdeas.length !== 1 ? 's' : ''}: ${savedIdeas.map(i => `"${i.title}"`).join(', ')}]`
        : '';

      return { content: [{ type: 'text', text: displayContent + savedNote }] };
    }
  );

  return server;
}

// Stateless: fresh server + transport per request.
// Auth on every request via Bearer token (JWT or vbr_ API key).
router.post('/', authenticateToken, async (req, res) => {
  try {
    const mcpServer = buildServer(req.user.userId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('finish', () => mcpServer.close().catch(() => {}));
  } catch (err) {
    console.error('[mcp] error:', err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

export default router;
