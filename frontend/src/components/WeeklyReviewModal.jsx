import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function WeeklyReviewModal({ onClose, onComplete }) {
  const [ideas, setIdeas] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { ideas } = await api.getReviewQueue();
      setIdeas(ideas);
    } catch {
      setError('Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }

  async function triage(action) {
    const idea = ideas[index];
    setActioning(true);
    setError(null);
    try {
      await api.triageIdea(idea.id, action);
      if (index + 1 >= ideas.length) {
        setDone(true);
        onComplete?.();
      } else {
        setIndex(i => i + 1);
      }
    } catch {
      setError('Failed to save — try again');
    } finally {
      setActioning(false);
    }
  }

  const idea = ideas[index];
  const staleDays = idea
    ? Math.floor((Date.now() - new Date(idea.updated_at)) / (1000 * 60 * 60 * 24))
    : 0;
  const progress = ideas.length > 0 ? (index / ideas.length) * 100 : 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="glass rounded-2xl w-full max-w-lg border border-white/10 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="font-semibold">Weekly Review</h2>
            {!loading && !done && ideas.length > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">{ideas.length} idea{ideas.length !== 1 ? 's' : ''} to review</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center gap-3 text-gray-400 py-8 justify-center">
              <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
              <span className="text-sm">Loading review queue…</span>
            </div>
          )}

          {!loading && error && (
            <p className="text-sm text-orange-400 text-center py-4">{error}</p>
          )}

          {!loading && !error && ideas.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <div className="text-3xl">🎉</div>
              <p className="text-sm text-gray-300">Nothing to review — you're all caught up!</p>
            </div>
          )}

          {!loading && !error && done && (
            <div className="text-center py-8 space-y-2">
              <div className="text-3xl">✅</div>
              <p className="text-sm text-gray-300">Review complete! {ideas.length} idea{ideas.length !== 1 ? 's' : ''} triaged.</p>
            </div>
          )}

          {!loading && !error && !done && idea && (
            <div className="space-y-5">
              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{index + 1} of {ideas.length}</span>
                  <span>{staleDays} days untouched</span>
                </div>
                <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/60 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Idea card */}
              <div className="bg-white/5 rounded-xl p-4 space-y-2 border border-white/10">
                <h3 className="font-medium text-white">{idea.title}</h3>
                {idea.summary && (
                  <p className="text-sm text-gray-400 leading-relaxed">{idea.summary}</p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {idea.status && (
                    <span className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded-full">{idea.status}</span>
                  )}
                  {idea.excitement && (
                    <span className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded-full">⚡ {idea.excitement}/10</span>
                  )}
                  {idea.complexity && (
                    <span className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded-full">{idea.complexity}</span>
                  )}
                </div>
              </div>

              {/* Triage actions */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => triage('keep')}
                  disabled={actioning}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-500/20 hover:bg-green-500/30 text-green-400 font-medium text-sm transition-colors disabled:opacity-50"
                >
                  ✓ Keep
                </button>
                <button
                  onClick={() => triage('snooze')}
                  disabled={actioning}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 font-medium text-sm transition-colors disabled:opacity-50"
                >
                  💤 Snooze 2w
                </button>
                <button
                  onClick={() => triage('promote')}
                  disabled={actioning}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium text-sm transition-colors disabled:opacity-50"
                >
                  🚀 Promote
                </button>
                <button
                  onClick={() => triage('archive')}
                  disabled={actioning}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 font-medium text-sm transition-colors disabled:opacity-50"
                >
                  🗄 Archive
                </button>
              </div>

              {error && <p className="text-xs text-orange-400 text-center">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer close button when done or empty */}
        {!loading && (done || ideas.length === 0) && (
          <div className="p-5 border-t border-white/10 flex-shrink-0">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary font-medium text-sm transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
