import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORAGE_DIR = process.env.SQLITE_DIR || join(__dirname, '../../../storage');
const BD_BIN = process.env.BD_BINARY || 'bd';
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
export async function ensureBeadsInit() {
  if (beadsReady) return;
  await bd(['init', '--prefix', 'vbr', '--skip-hooks', '--non-interactive', '--quiet']);
  beadsReady = true;
}

const priorityMap = { high: '1', medium: '2', low: '3' };

export async function createBeadsEpic(project) {
  await ensureBeadsInit();
  return bd([
    'create', '--title', project.title,
    '--type', 'epic',
    '--priority', '2',
    '--description', project.description || '',
    '--silent',
  ]);
}

export async function createBeadsTask(task, epicId) {
  await ensureBeadsInit();
  const args = [
    'create', '--title', task.title,
    '--type', 'task',
    '--priority', priorityMap[task.priority] || '2',
    '--parent', epicId,
    '--silent',
  ];
  if (task.description) args.push('--description', task.description);
  if (task.estimatedMinutes || task.estimated_minutes) {
    args.push('--estimate', String(task.estimatedMinutes || task.estimated_minutes));
  }
  return bd(args);
}

export async function createBeadsIssues(project, initialTasks) {
  const epicId = await createBeadsEpic(project);
  if (!epicId) return null;

  for (const task of initialTasks) {
    await createBeadsTask(task, epicId);
  }

  console.log(`beads: created epic ${epicId} with ${initialTasks.length} tasks for "${project.title}"`);
  return epicId;
}

export function bdExport() {
  return new Promise((resolve, reject) => {
    execFile(BD_BIN, ['-C', STORAGE_DIR, 'export'], { timeout: 15000, maxBuffer: 10 * 1024 * 1024, env: BD_ENV }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
