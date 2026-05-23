import express from 'express';
import { execFile } from 'child_process';
import { join } from 'path';
import { db, generateUUID } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const STORAGE_DIR = process.env.SQLITE_DIR || join(new URL('../..', import.meta.url).pathname, '../storage');
const BD_BIN = process.env.BD_BINARY || 'bd';
const BD_ENV = { ...process.env, HOME: STORAGE_DIR };

function bdExport() {
  return new Promise((resolve, reject) => {
    execFile(BD_BIN, ['-C', STORAGE_DIR, 'export', '--force'], { timeout: 15000, maxBuffer: 10 * 1024 * 1024, env: BD_ENV }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    const q = db('projects as p')
      .leftJoin('ideas as i', 'p.origin_idea_id', 'i.id')
      .select('p.*', 'i.title as origin_idea_title')
      .where('p.user_id', req.user.userId)
      .orderBy('p.created_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    if (status) q.where('p.status', status);

    const [projects, [{ count }]] = await Promise.all([
      q,
      db('projects').where({ user_id: req.user.userId }).count('* as count'),
    ]);

    res.json({ projects, total: parseInt(count), page: Math.floor(offset / limit) + 1 });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const project = await db('projects').where({ id: req.params.id, user_id: req.user.userId }).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const [tasks, recentAIChats] = await Promise.all([
      db('tasks').where({ project_id: req.params.id }).orderBy([{ column: 'sort_order' }, { column: 'created_at' }]),
      db('ai_conversations').where({ project_id: req.params.id })
        .select('id', 'context_type', 'ai_provider', 'created_at', 'updated_at')
        .orderBy('updated_at', 'desc').limit(5),
    ]);

    await db('projects').where({ id: req.params.id }).update({ last_worked_on: new Date() });

    res.json({ project, tasks, recentAIChats });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, description, originIdeaId, techStack, vibe, excitement, targetCompletionDate } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const [project] = await db('projects').insert({
      id: generateUUID(),
      user_id: req.user.userId,
      title,
      description: description || null,
      origin_idea_id: originIdeaId || null,
      tech_stack: JSON.stringify(techStack || []),
      vibe: JSON.stringify(vibe || []),
      excitement: excitement || null,
      target_completion_date: targetCompletionDate || null,
    }).returning('*');

    res.status(201).json({ project });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const exists = await db('projects').where({ id: req.params.id, user_id: req.user.userId }).first();
    if (!exists) return res.status(404).json({ error: 'Project not found' });

    const { title, description, status, completionPercent, techStack, vibe, excitement,
            targetCompletionDate, repositoryUrl, repositoryBranch, repositoryLocalPath } = req.body;

    const updates = { last_worked_on: new Date() };
    if (title              !== undefined) updates.title                  = title;
    if (description        !== undefined) updates.description            = description;
    if (status             !== undefined) updates.status                 = status;
    if (completionPercent  !== undefined) updates.completion_percent     = completionPercent;
    if (techStack          !== undefined) updates.tech_stack             = JSON.stringify(techStack);
    if (vibe               !== undefined) updates.vibe                   = JSON.stringify(vibe);
    if (excitement         !== undefined) updates.excitement             = excitement;
    if (targetCompletionDate !== undefined) updates.target_completion_date = targetCompletionDate;
    if (repositoryUrl      !== undefined) updates.repository_url         = repositoryUrl;
    if (repositoryBranch   !== undefined) updates.repository_branch      = repositoryBranch;
    if (repositoryLocalPath !== undefined) updates.repository_local_path = repositoryLocalPath;

    const [project] = await db('projects')
      .where({ id: req.params.id, user_id: req.user.userId })
      .update(updates).returning('*');

    res.json({ project });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await db('projects').where({ id: req.params.id, user_id: req.user.userId }).del();
    if (!deleted) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    const [project] = await db('projects')
      .where({ id: req.params.id, user_id: req.user.userId })
      .update({ status: 'in-progress', last_worked_on: new Date() })
      .returning('*');
    if (!project) return res.status(404).json({ error: 'Project not found' });
    // Only set started_at if not already set
    if (!project.started_at) {
      await db('projects').where({ id: req.params.id }).update({ started_at: new Date() });
      project.started_at = new Date();
    }
    res.json({ project });
  } catch (error) {
    console.error('Start project error:', error);
    res.status(500).json({ error: 'Failed to start project' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const [project] = await db('projects')
      .where({ id: req.params.id, user_id: req.user.userId })
      .update({ status: 'completed', completion_percent: 100, completed_at: new Date(), last_worked_on: new Date() })
      .returning('*');
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
  } catch (error) {
    console.error('Complete project error:', error);
    res.status(500).json({ error: 'Failed to complete project' });
  }
});

router.post('/:id/demote', async (req, res) => {
  try {
    const project = await db('projects').where({ id: req.params.id, user_id: req.user.userId }).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.origin_idea_id) return res.status(400).json({ error: 'Project has no origin idea' });

    const idea = await db('ideas').where({ id: project.origin_idea_id, user_id: req.user.userId }).first();
    if (!idea) return res.status(404).json({ error: 'Original idea not found' });

    await db('ideas').where({ id: project.origin_idea_id }).update({ status: 'refined', project_id: null });
    await db('projects').where({ id: req.params.id }).del();

    const updatedIdea = await db('ideas').where({ id: project.origin_idea_id }).first();
    res.json({ idea: updatedIdea });
  } catch (error) {
    console.error('Demote project error:', error);
    res.status(500).json({ error: 'Failed to demote project' });
  }
});

// Download beads issues for a project as JSONL
router.get('/:id/beads-export', async (req, res) => {
  try {
    const project = await db('projects').where({ id: req.params.id, user_id: req.user.userId }).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.beads_epic_id) return res.status(404).json({ error: 'No beads issues for this project' });

    const jsonl = await bdExport();

    // Filter to just this project's epic and its children
    const epicId = project.beads_epic_id;
    const lines = jsonl.split('\n').filter(Boolean);
    const filtered = lines.filter(line => {
      try {
        const issue = JSON.parse(line);
        return issue.id === epicId || issue.parent === epicId;
      } catch { return false; }
    });

    if (filtered.length === 0) return res.status(404).json({ error: 'No beads issues found for this project' });

    const filename = `${project.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-beads.jsonl`;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(filtered.join('\n') + '\n');
  } catch (error) {
    console.error('Beads export error:', error);
    res.status(500).json({ error: 'Failed to export beads issues' });
  }
});

export default router;
