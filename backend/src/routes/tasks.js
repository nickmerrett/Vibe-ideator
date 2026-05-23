import express from 'express';
import { db, generateUUID } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { createBeadsTask } from '../services/beadsService.js';

const router = express.Router();
router.use(authenticateToken);

async function ownedProject(projectId, userId) {
  return db('projects').where({ id: projectId, user_id: userId }).first();
}

async function ownedTask(taskId, userId) {
  return db('tasks as t')
    .join('projects as p', 't.project_id', 'p.id')
    .where('t.id', taskId)
    .where('p.user_id', userId)
    .select('t.*')
    .first();
}

router.get('/project/:projectId', async (req, res) => {
  try {
    if (!await ownedProject(req.params.projectId, req.user.userId)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { status, priority } = req.query;
    const q = db('tasks').where({ project_id: req.params.projectId }).orderBy([{ column: 'sort_order' }, { column: 'created_at' }]);
    if (status)   q.where({ status });
    if (priority) q.where({ priority });

    res.json({ tasks: await q });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

router.post('/project/:projectId', async (req, res) => {
  try {
    const project = await ownedProject(req.params.projectId, req.user.userId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { title, description, priority, estimatedMinutes, sortOrder } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const [task] = await db('tasks').insert({
      id: generateUUID(),
      project_id: req.params.projectId,
      title,
      description: description || null,
      priority: priority || 'medium',
      estimated_minutes: estimatedMinutes || null,
      sort_order: sortOrder || 0,
    }).returning('*');

    if (project.beads_epic_id) {
      createBeadsTask(task, project.beads_epic_id).catch(err =>
        console.warn('beads task creation failed:', err.message)
      );
    }

    res.status(201).json({ task });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!await ownedTask(req.params.id, req.user.userId)) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { title, description, status, priority, sortOrder, estimatedMinutes, actualMinutes } = req.body;
    const updates = {};
    if (title            !== undefined) updates.title             = title;
    if (description      !== undefined) updates.description       = description;
    if (status           !== undefined) updates.status            = status;
    if (priority         !== undefined) updates.priority          = priority;
    if (sortOrder        !== undefined) updates.sort_order        = sortOrder;
    if (estimatedMinutes !== undefined) updates.estimated_minutes = estimatedMinutes;
    if (actualMinutes    !== undefined) updates.actual_minutes    = actualMinutes;

    const [task] = await db('tasks').where({ id: req.params.id }).update(updates).returning('*');
    res.json({ task });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!await ownedTask(req.params.id, req.user.userId)) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await db('tasks').where({ id: req.params.id }).del();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    if (!await ownedTask(req.params.id, req.user.userId)) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const [task] = await db('tasks').where({ id: req.params.id })
      .update({ status: 'completed', completed_at: new Date() }).returning('*');
    res.json({ task });
  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    if (!await ownedTask(req.params.id, req.user.userId)) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const [task] = await db('tasks').where({ id: req.params.id })
      .update({ status: 'in-progress' }).returning('*');
    res.json({ task });
  } catch (error) {
    console.error('Start task error:', error);
    res.status(500).json({ error: 'Failed to start task' });
  }
});

export default router;
