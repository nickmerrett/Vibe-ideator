import express from 'express';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db, generateUUID } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORAGE_DIR = process.env.SQLITE_DIR || join(__dirname, '../../../storage');
const BD_BIN = process.env.BD_BINARY || 'bd';
// HOME must be writable for Dolt's embedded engine config
const BD_ENV = { ...process.env, HOME: STORAGE_DIR };

function bd(args, opts = {}) {
  return new Promise((resolve) => {
    execFile(BD_BIN, ['-C', STORAGE_DIR, ...args], { timeout: 30000, env: BD_ENV, ...opts }, (err, stdout, stderr) => {
      if (err) { console.warn('beads failed:', err.message, stderr); resolve(null); }
      else resolve(stdout.trim());
    });
  });
}

let beadsReady = false;
async function ensureBeadsInit() {
  if (beadsReady) return;
  await bd(['init', '--prefix', 'vbr', '--skip-hooks', '--non-interactive', '--quiet']);
  beadsReady = true;
}

async function createBeadsIssues(project, initialTasks) {
  await ensureBeadsInit();

  const epicId = await bd([
    'create', '--title', project.title,
    '--type', 'epic',
    '--priority', '2',
    '--description', project.description || '',
    '--silent',
  ]);
  if (!epicId) return;

  const priorityMap = { high: '1', medium: '2', low: '3' };

  for (const task of initialTasks) {
    const args = [
      'create', '--title', task.title,
      '--type', 'task',
      '--priority', priorityMap[task.priority] || '2',
      '--parent', epicId,
      '--silent',
    ];
    if (task.description) args.push('--description', task.description);
    if (task.estimatedMinutes) args.push('--estimate', String(task.estimatedMinutes));
    await bd(args);
  }

  console.log(`beads: created epic ${epicId} with ${initialTasks.length} tasks for "${project.title}"`);
  return epicId;
}

const router = express.Router();
router.use(authenticateToken);

const userId = req => req.user.userId;

function serialize(val) {
  return val != null ? JSON.stringify(val) : undefined;
}

// Get all ideas
router.get('/', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    const q = db('ideas as i')
      .select('i.*', db.raw(
        '(SELECT url FROM attachments WHERE idea_id = i.id AND type = ? ORDER BY created_at ASC LIMIT 1) AS thumbnail_url',
        ['image']
      ))
      .where('i.user_id', userId(req))
      .orderBy('i.created_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    if (status) q.where('i.status', status);

    const [ideas, [{ count }]] = await Promise.all([
      q,
      db('ideas').where({ user_id: userId(req) }).count('* as count'),
    ]);

    res.json({ ideas, total: parseInt(count), page: Math.floor(offset / limit) + 1 });
  } catch (error) {
    console.error('Get ideas error:', error);
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// Get single idea
router.get('/:id', async (req, res) => {
  try {
    const idea = await db('ideas').where({ id: req.params.id, user_id: userId(req) }).first();
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    await db('ideas').where({ id: req.params.id }).update({ last_viewed_at: new Date() });
    res.json({ idea });
  } catch (error) {
    console.error('Get idea error:', error);
    res.status(500).json({ error: 'Failed to fetch idea' });
  }
});

// Create idea
router.post('/', async (req, res) => {
  try {
    const { title, summary, transcript, conversation, vibe, excitement, complexity,
            techStack, notes, links, tags, parent_idea_id, related_ideas, area_id } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    const [idea] = await db('ideas').insert({
      id: generateUUID(),
      user_id: userId(req),
      title,
      summary: summary || null,
      transcript: transcript || null,
      conversation: serialize(conversation) ?? null,
      vibe: JSON.stringify(vibe || []),
      excitement: excitement || null,
      complexity: complexity || null,
      tech_stack: JSON.stringify(techStack || []),
      notes: notes || null,
      links: JSON.stringify(links || []),
      tags: JSON.stringify(tags || []),
      parent_idea_id: parent_idea_id || null,
      related_ideas: JSON.stringify(related_ideas || []),
      area_id: area_id || null,
    }).returning('*');

    res.status(201).json({ idea });
  } catch (error) {
    console.error('Create idea error:', error);
    res.status(500).json({ error: 'Failed to create idea' });
  }
});

// Update idea — only fields present in body are updated
router.put('/:id', async (req, res) => {
  try {
    const exists = await db('ideas').where({ id: req.params.id, user_id: userId(req) }).first();
    if (!exists) return res.status(404).json({ error: 'Idea not found' });

    const body = req.body;
    const updates = {};

    if (body.title        !== undefined) updates.title         = body.title;
    if (body.summary      !== undefined) updates.summary       = body.summary;
    if (body.transcript   !== undefined) updates.transcript    = body.transcript;
    if (body.conversation !== undefined) updates.conversation  = JSON.stringify(body.conversation);
    if (body.vibe         !== undefined) updates.vibe          = JSON.stringify(body.vibe);
    if (body.excitement   !== undefined) updates.excitement    = body.excitement;
    if (body.complexity   !== undefined) updates.complexity    = body.complexity;
    if (body.techStack    !== undefined) updates.tech_stack    = JSON.stringify(body.techStack);
    if (body.status       !== undefined) updates.status        = body.status;
    if (body.notes        !== undefined) updates.notes         = body.notes;
    if (body.links        !== undefined) updates.links         = JSON.stringify(body.links);
    if (body.tags         !== undefined) updates.tags          = JSON.stringify(body.tags);
    if (body.archived     !== undefined) updates.archived      = body.archived ? 1 : 0;
    if (body.related_ideas   !== undefined) updates.related_ideas  = JSON.stringify(body.related_ideas);
    if (body.parent_idea_id  !== undefined) updates.parent_idea_id = body.parent_idea_id;
    if (body.research          !== undefined) updates.research           = body.research;
    if (body.riff_conversation !== undefined) updates.riff_conversation  = JSON.stringify(body.riff_conversation);
    if ('area_id'         in  body)      updates.area_id       = body.area_id || null;

    if (!Object.keys(updates).length) {
      return res.json({ idea: exists });
    }

    const [idea] = await db('ideas')
      .where({ id: req.params.id, user_id: userId(req) })
      .update(updates)
      .returning('*');

    res.json({ idea });
  } catch (error) {
    console.error('Update idea error:', error);
    res.status(500).json({ error: 'Failed to update idea' });
  }
});

// Delete idea
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await db('ideas').where({ id: req.params.id, user_id: userId(req) }).del();
    if (!deleted) return res.status(404).json({ error: 'Idea not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete idea error:', error);
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

// Save refined idea
router.patch('/:id/refine', async (req, res) => {
  try {
    const exists = await db('ideas').where({ id: req.params.id, user_id: userId(req) }).first();
    if (!exists) return res.status(404).json({ error: 'Idea not found' });

    const { conversation, refinedData } = req.body;
    const updates = { conversation: JSON.stringify(conversation), status: refinedData?.status || 'refined' };
    if (refinedData?.summary)        updates.summary        = refinedData.summary;
    if (refinedData?.designDocument) updates.design_document = refinedData.designDocument;
    if (refinedData?.techStack)      updates.tech_stack      = refinedData.techStack;
    if (refinedData?.notes)          updates.notes           = refinedData.notes;

    const [idea] = await db('ideas')
      .where({ id: req.params.id, user_id: userId(req) })
      .update(updates)
      .returning('*');

    res.json({ idea });
  } catch (error) {
    console.error('Refine idea error:', error);
    res.status(500).json({ error: 'Failed to save refined idea' });
  }
});

// Promote idea to project
router.post('/:id/promote', async (req, res) => {
  try {
    const idea = await db('ideas').where({ id: req.params.id, user_id: userId(req) }).first();
    if (!idea) return res.status(404).json({ error: 'Idea not found' });

    const { projectTitle, projectDescription, goals, phases, initialTasks, techStack, estimatedDuration } = req.body;

    const projectPlan = { goals: goals || [], phases: phases || [], estimatedDuration: estimatedDuration || null };

    const [project] = await db('projects').insert({
      id: generateUUID(),
      user_id: userId(req),
      origin_idea_id: idea.id,
      title: projectTitle || idea.title,
      description: projectDescription || idea.summary,
      tech_stack: JSON.stringify(techStack || idea.tech_stack || []),
      vibe: JSON.stringify(idea.vibe || []),
      excitement: idea.excitement,
      status: 'planning',
      project_plan: JSON.stringify(projectPlan),
    }).returning('*');

    if (initialTasks?.length) {
      await db('tasks').insert(
        initialTasks.map((t, i) => ({
          id: generateUUID(),
          project_id: project.id,
          title: t.title,
          description: t.description || null,
          priority: t.priority || 'medium',
          estimated_minutes: t.estimatedMinutes || null,
          ai_generated: 1,
          sort_order: i + 1,
        }))
      );
    }

    await db('ideas').where({ id: idea.id }).update({ status: 'promoted-to-project', project_id: project.id });

    const tasks = await db('tasks').where({ project_id: project.id }).orderBy('sort_order');

    // Create beads issues — await so the returned project already has the epic ID
    const epicId = await createBeadsIssues(project, initialTasks || []).catch(() => null);
    if (epicId) {
      await db('projects').where({ id: project.id }).update({ beads_epic_id: epicId });
      project.beads_epic_id = epicId;
    }

    res.status(201).json({ project, tasks });
  } catch (error) {
    console.error('Promote idea error:', error);
    res.status(500).json({ error: 'Failed to promote idea' });
  }
});

// Get ideas due for weekly review (stale for 14+ days, not archived, snooze expired)
router.get('/review', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const ideas = await db('ideas')
      .where({ user_id: userId(req), archived: 0 })
      .whereNot({ status: 'promoted-to-project' })
      .where('updated_at', '<', cutoff)
      .where(function () {
        this.whereNull('snoozed_until').orWhere('snoozed_until', '<', now);
      })
      .select('id', 'title', 'summary', 'tags', 'status', 'excitement', 'complexity', 'area_id', 'updated_at', 'last_reviewed_at', 'research')
      .orderBy('updated_at', 'asc');

    res.json({ ideas, count: ideas.length });
  } catch (error) {
    console.error('Review fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch review queue' });
  }
});

// Triage a single idea during weekly review
router.post('/:id/review', async (req, res) => {
  try {
    const { action } = req.body;
    if (!['keep', 'archive', 'snooze', 'promote'].includes(action)) {
      return res.status(400).json({ error: 'action must be keep, archive, snooze, or promote' });
    }

    const idea = await db('ideas').where({ id: req.params.id, user_id: userId(req) }).first();
    if (!idea) return res.status(404).json({ error: 'Idea not found' });

    const now = new Date().toISOString();
    const updates = { last_reviewed_at: now };

    if (action === 'archive') {
      updates.archived = 1;
    } else if (action === 'snooze') {
      updates.snoozed_until = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    } else if (action === 'promote') {
      const [project] = await db('projects').insert({
        id: generateUUID(),
        user_id: userId(req),
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
      await db('ideas').where({ id: idea.id }).update(updates);
      return res.json({ action, project });
    }

    await db('ideas').where({ id: idea.id }).update(updates);
    res.json({ action, id: idea.id });
  } catch (error) {
    console.error('Review triage error:', error);
    res.status(500).json({ error: 'Failed to triage idea' });
  }
});

export default router;
