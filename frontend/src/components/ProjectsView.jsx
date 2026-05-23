import { useState, useEffect } from 'react';
import { useDataStore } from '../store/useDataStore';
import { api } from '../services/api';
import ProjectChat from './ProjectChat';
import AreaBadge from './AreaBadge';

export default function ProjectsView({ activeArea = null }) {
  const { projects, tasks, fetchProjects, fetchProjectTasks, createTask, completeTask, updateTask, deleteTask, deleteProject, demoteProject, updateProject, loading } = useDataStore();
  const [filter, setFilter] = useState('all');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showProjectAI, setShowProjectAI] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [showEditTask, setShowEditTask] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium',
    estimatedMinutes: 60
  });

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (selectedProject) {
      fetchProjectTasks(selectedProject.id);
    }
  }, [selectedProject, fetchProjectTasks]);

  const filteredProjects = projects.filter(project => {
    if (filter === 'all') return project.status !== 'archived';
    if (filter === 'active') return project.status === 'in-progress';
    if (filter === 'done') return project.status === 'completed';
    if (filter === 'archived') return project.status === 'archived';
    if (activeArea && project.area_id !== activeArea) return false;
    return true;
  });

  const projectTasks = selectedProject ? (tasks[selectedProject.id] || []) : [];

  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      await createTask(selectedProject.id, newTask);
      setShowNewTask(false);
      setNewTask({
        title: '',
        description: '',
        priority: 'medium',
        estimatedMinutes: 60
      });
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  const handleEditProject = () => {
    setEditingProject({ ...selectedProject });
    setShowEditProject(true);
  };

  const handleSaveProject = async (e) => {
    e.preventDefault();
    try {
      await updateProject(selectedProject.id, {
        title: editingProject.title,
        description: editingProject.description,
        status: editingProject.status,
        techStack: editingProject.tech_stack,
        githubUrl: editingProject.github_url || editingProject.githubUrl
      });
      setSelectedProject(editingProject);
      setShowEditProject(false);
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };

  const handleArchiveProject = async () => {
    if (!confirm(`Archive "${selectedProject.title}"? You can restore it later.`)) return;

    try {
      await updateProject(selectedProject.id, { status: 'archived' });
      setSelectedProject(null);
      await fetchProjects();
    } catch (error) {
      console.error('Failed to archive project:', error);
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm(`Delete "${selectedProject.title}"? This cannot be undone!`)) return;

    try {
      await deleteProject(selectedProject.id);
      setSelectedProject(null);
      await fetchProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handleDemoteProject = async () => {
    if (!confirm(`Demote "${selectedProject.title}" back to an idea? This will delete the project and restore the original idea so you can continue ideating.`)) return;

    try {
      await demoteProject(selectedProject.id);
      setSelectedProject(null);
      await fetchProjects();
    } catch (error) {
      console.error('Failed to demote project:', error);
      alert(error.message || 'Failed to demote project');
    }
  };

  const handleEditTask = (task) => {
    setEditingTask({ ...task });
    setShowEditTask(true);
  };

  const handleSaveTask = async (e) => {
    e.preventDefault();
    try {
      await updateTask(selectedProject.id, editingTask.id, {
        title: editingTask.title,
        description: editingTask.description,
        priority: editingTask.priority,
        estimatedMinutes: editingTask.estimated_minutes || editingTask.estimatedMinutes
      });
      setShowEditTask(false);
      setEditingTask(null);
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!confirm('Delete this task?')) return;
    try {
      await deleteTask(selectedProject.id, taskId);
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  if (selectedProject) {
    return (
      <div className="h-full flex flex-col">
        {/* Project Header */}
        <div className="glass border-b border-white/10 px-6 py-4 flex-shrink-0">
          <div className="flex items-start justify-between mb-2">
            <button
              onClick={() => setSelectedProject(null)}
              className="text-primary hover:text-primary-light flex items-center gap-2"
            >
              ← Back to Projects
            </button>
            <div className="flex gap-2">
              <button
                onClick={handleEditProject}
                className="glass px-3 py-1 rounded-lg hover:bg-white/5 text-sm"
              >
                ✏️ Edit
              </button>
              <button
                onClick={handleDemoteProject}
                className="glass px-3 py-1 rounded-lg hover:bg-blue-500/10 hover:text-blue-400 text-sm"
              >
                ⬇️ Demote to Idea
              </button>
              <button
                onClick={handleArchiveProject}
                className="glass px-3 py-1 rounded-lg hover:bg-yellow-500/10 hover:text-yellow-400 text-sm"
              >
                📦 Archive
              </button>
              <button
                onClick={handleDeleteProject}
                className="glass px-3 py-1 rounded-lg hover:bg-red-500/10 hover:text-red-400 text-sm"
              >
                🗑️ Delete
              </button>
            </div>
          </div>
          <h2 className="text-2xl font-bold">{selectedProject.title}</h2>
          <p className="text-gray-400 mt-1">{selectedProject.description}</p>
          <div className="mt-3 flex gap-3 items-center text-sm flex-wrap">
            <span className={`px-3 py-1 rounded-full ${
              selectedProject.status === 'archived' ? 'bg-yellow-500/20 text-yellow-400' : 'glass'
            }`}>
              {selectedProject.status}
            </span>
            {selectedProject.created_at && (
              <span className="text-gray-500">
                Promoted {new Date(selectedProject.created_at).toLocaleDateString()}
              </span>
            )}
            {selectedProject.tech_stack && selectedProject.tech_stack.length > 0 && (
              <span className="text-gray-500">
                {selectedProject.tech_stack.join(', ')}
              </span>
            )}
            {(selectedProject.githubUrl || selectedProject.github_url || selectedProject.repository_url) && (
              <a
                href={selectedProject.githubUrl || selectedProject.github_url || selectedProject.repository_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary-light flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Repository
              </a>
            )}
          </div>
        </div>

        {/* Tasks Header */}
        <div className="glass border-b border-white/10 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h3 className="font-semibold">Tasks ({projectTasks.length})</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowProjectAI(true)}
              className="glass px-4 py-2 rounded-lg hover:bg-accent/20 hover:text-accent transition-all text-sm font-medium"
            >
              🤖 AI Assistant
            </button>
            <button
              onClick={() => setShowNewTask(true)}
              className="btn-primary btn-sm"
            >
              + New Task
            </button>
          </div>
        </div>

        {/* Tasks List */}
        <div className="flex-1 overflow-y-auto p-6">
          {projectTasks.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              No tasks yet. Add your first task!
            </div>
          ) : (
            <div className="space-y-3 max-w-4xl mx-auto">
              {projectTasks.map((task) => (
                <div
                  key={task.id}
                  className={`card flex items-start gap-4 ${
                    task.status === 'completed' ? 'opacity-60' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={task.status === 'completed'}
                    onChange={() => completeTask(selectedProject.id, task.id)}
                    className="mt-1 w-5 h-5 rounded accent-primary cursor-pointer"
                  />
                  <div className="flex-1">
                    <h4 className={`font-semibold ${task.status === 'completed' ? 'line-through' : ''}`}>
                      {task.title}
                    </h4>
                    {task.description && (
                      <p className="text-gray-400 text-sm mt-1">{task.description}</p>
                    )}
                    <div className="flex gap-3 mt-2 text-sm text-gray-400">
                      <span className={`
                        px-2 py-0.5 rounded ${
                          task.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                          task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-blue-500/20 text-blue-400'
                        }
                      `}>
                        {task.priority}
                      </span>
                      {(task.estimated_minutes || task.estimatedMinutes) && (
                        <span>⏱️ {task.estimated_minutes || task.estimatedMinutes}min</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditTask(task)}
                      className="glass px-2 py-1 rounded text-xs hover:bg-white/5"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="glass px-2 py-1 rounded text-xs hover:bg-red-500/10 hover:text-red-400"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Assistant Modal */}
        {showProjectAI && (
          <ProjectChat
            project={selectedProject}
            onClose={() => setShowProjectAI(false)}
          />
        )}

        {/* Edit Project Modal */}
        {showEditProject && editingProject && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="glass rounded-3xl p-8 max-w-2xl w-full">
              <h2 className="text-2xl font-bold mb-6">Edit Project</h2>

              <form onSubmit={handleSaveProject} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2">Title</label>
                  <input
                    type="text"
                    value={editingProject.title}
                    onChange={(e) => setEditingProject({ ...editingProject, title: e.target.value })}
                    className="input"
                    placeholder="Project title"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Description</label>
                  <textarea
                    value={editingProject.description || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, description: e.target.value })}
                    className="input min-h-[100px]"
                    placeholder="Project description"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Status</label>
                  <select
                    value={editingProject.status}
                    onChange={(e) => setEditingProject({ ...editingProject, status: e.target.value })}
                    className="input"
                  >
                    <option value="planning">Planning</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="on-hold">On Hold</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">GitHub URL</label>
                  <input
                    type="url"
                    value={editingProject.github_url || editingProject.githubUrl || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, github_url: e.target.value })}
                    className="input"
                    placeholder="https://github.com/username/repo"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Tech Stack (comma separated)</label>
                  <input
                    type="text"
                    value={Array.isArray(editingProject.tech_stack) ? editingProject.tech_stack.join(', ') : ''}
                    onChange={(e) => setEditingProject({
                      ...editingProject,
                      tech_stack: e.target.value.split(',').map(t => t.trim()).filter(Boolean)
                    })}
                    className="input"
                    placeholder="React, Node.js, PostgreSQL"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button type="submit" className="btn-primary flex-1">
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEditProject(false)}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* New Task Modal */}
        {showNewTask && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="glass rounded-3xl p-8 max-w-2xl w-full">
              <h2 className="text-2xl font-bold mb-6">New Task</h2>

              <form onSubmit={handleCreateTask} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2">Title</label>
                  <input
                    type="text"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    className="input"
                    placeholder="What needs to be done?"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Description</label>
                  <textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    className="input min-h-[100px]"
                    placeholder="Additional details..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Priority</label>
                    <select
                      value={newTask.priority}
                      onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                      className="input"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Estimated Time (minutes)</label>
                    <input
                      type="number"
                      value={newTask.estimatedMinutes}
                      onChange={(e) => setNewTask({ ...newTask, estimatedMinutes: parseInt(e.target.value) })}
                      className="input"
                      min="1"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button type="submit" className="btn-primary flex-1">
                    Create Task
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewTask(false)}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Task Modal */}
        {showEditTask && editingTask && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="glass rounded-3xl p-8 max-w-2xl w-full">
              <h2 className="text-2xl font-bold mb-6">Edit Task</h2>

              <form onSubmit={handleSaveTask} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2">Title</label>
                  <input
                    type="text"
                    value={editingTask.title}
                    onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                    className="input"
                    placeholder="What needs to be done?"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Description</label>
                  <textarea
                    value={editingTask.description || ''}
                    onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                    className="input min-h-[100px]"
                    placeholder="Additional details..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Priority</label>
                    <select
                      value={editingTask.priority}
                      onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value })}
                      className="input"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Estimated Time (minutes)</label>
                    <input
                      type="number"
                      value={editingTask.estimated_minutes || editingTask.estimatedMinutes || ''}
                      onChange={(e) => setEditingTask({ ...editingTask, estimated_minutes: parseInt(e.target.value) })}
                      className="input"
                      min="1"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button type="submit" className="btn-primary flex-1">
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEditTask(false)}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Filter Bar */}
      <div className="glass border-b border-white/10 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              filter === 'all'
                ? 'bg-gradient-primary text-white shadow-lg shadow-primary/40'
                : 'glass hover:bg-white/5'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              filter === 'active'
                ? 'bg-gradient-primary text-white shadow-lg shadow-primary/40'
                : 'glass hover:bg-white/5'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('done')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              filter === 'done'
                ? 'bg-gradient-primary text-white shadow-lg shadow-primary/40'
                : 'glass hover:bg-white/5'
            }`}
          >
            Done
          </button>
          <button
            onClick={() => setFilter('archived')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              filter === 'archived'
                ? 'bg-gradient-primary text-white shadow-lg shadow-primary/40'
                : 'glass hover:bg-white/5'
            }`}
          >
            Archived
          </button>
        </div>
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading projects...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            No projects yet. Promote an idea to get started!
          </div>
        ) : (
          <div className="grid gap-4 max-w-4xl mx-auto">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => setSelectedProject(project)}
                className="card cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-base sm:text-xl font-semibold">{project.title}</h3>
                    {project.area_id && <AreaBadge areaId={project.area_id} className="mt-1" />}
                  </div>
                  <span className="text-lg">🚀</span>
                </div>

                <p className="text-gray-400 mb-4">{project.description}</p>

                <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                  <div className="flex gap-2 items-center">
                    <span className={`
                      px-3 py-1 rounded-full ${
                        project.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        project.status === 'in-progress' ? 'bg-blue-500/20 text-blue-400' :
                        project.status === 'archived' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-gray-500/20 text-gray-400'
                      }
                    `}>
                      {project.status}
                    </span>
                    {(project.githubUrl || project.github_url || project.repository_url) && (
                      <a
                        href={project.githubUrl || project.github_url || project.repository_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-primary transition-colors flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                        Repo
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {project.beads_epic_id && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const filename = `${project.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-beads.jsonl`;
                          await api.downloadBeadsExport(project.id, filename);
                        }}
                        className="text-xs text-primary/70 hover:text-primary transition-colors flex items-center gap-1"
                        title="Download beads issues (bd import -i file.jsonl)"
                      >
                        ⬇ beads
                      </button>
                    )}
                    {project.created_at && (
                      <span className="text-xs text-gray-500">
                        Promoted {new Date(project.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
