import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { MarkdownText } from '../utils/markdown';

function formatDate(str) {
  return new Date(str).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SharedIdea() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [reactions, setReactions] = useState([]);
  const [comments, setComments] = useState([]);

  const [commentName, setCommentName] = useState(() => localStorage.getItem('share_commenter_name') || '');
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [commentDone, setCommentDone] = useState(false);

  useEffect(() => {
    load();
  }, [token]);

  async function load() {
    setLoading(true);
    const result = await api.getSharedIdea(token);
    if (result.error) { setNotFound(true); setLoading(false); return; }
    setData(result.idea);
    setReactions(result.reactions || []);
    setComments(result.comments || []);
    setLoading(false);
  }

  async function handleReact(emoji) {
    const result = await api.reactToSharedIdea(token, emoji);
    if (result.reactions) setReactions(result.reactions);
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!commentName.trim() || !commentText.trim()) return;
    setSubmitting(true);
    setCommentError(null);
    const result = await api.commentOnSharedIdea(token, commentName.trim(), commentText.trim());
    setSubmitting(false);
    if (result.error) { setCommentError(result.error); return; }
    localStorage.setItem('share_commenter_name', commentName.trim());
    setComments(prev => [...prev, result.comment]);
    setCommentText('');
    setCommentDone(true);
    setTimeout(() => setCommentDone(false), 3000);
  }

  function reactionCount(emoji) {
    return reactions.find(r => r.reaction === emoji)?.count || 0;
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-center px-4">
      <div className="text-4xl mb-4">🔒</div>
      <h1 className="text-xl font-semibold text-white mb-2">Idea not found</h1>
      <p className="text-gray-400 text-sm">This link may have expired or sharing has been disabled.</p>
    </div>
  );

  const tags = Array.isArray(data.tags) ? data.tags : [];
  const vibe = Array.isArray(data.vibe) ? data.vibe : [];
  const links = Array.isArray(data.links) ? data.links.filter(Boolean) : [];
  const riffMessages = Array.isArray(data.riff_conversation)
    ? data.riff_conversation.filter(m => !m.hidden)
    : [];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="text-xs text-gray-500 mb-3 font-medium tracking-wide uppercase">Shared idea</div>
          <h1 className="text-3xl font-bold leading-tight mb-4">{data.title}</h1>

          {/* Meta pills */}
          <div className="flex flex-wrap gap-2 mb-4">
            {data.complexity && (
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-300">
                ⏱ {data.complexity}
              </span>
            )}
            {data.excitement && (
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-300">
                ⚡ {data.excitement}/10
              </span>
            )}
            {vibe.map(v => (
              <span key={v} className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary">{v}</span>
            ))}
          </div>

          <div className="text-xs text-gray-600">{formatDate(data.created_at)}</div>
        </div>

        {/* Summary */}
        {data.summary && (
          <div className="glass rounded-2xl p-6 mb-6 border border-white/10">
            <MarkdownText text={data.summary} className="text-gray-200" />
          </div>
        )}

        {/* Notes */}
        {data.notes && (
          <div className="glass rounded-2xl p-6 mb-6 border border-white/10">
            <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">Notes</h2>
            <MarkdownText text={data.notes} className="text-gray-300 text-sm" />
          </div>
        )}

        {/* Design document */}
        {data.design_document && (
          <div className="glass rounded-2xl p-6 mb-6 border border-white/10">
            <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">Design</h2>
            <MarkdownText text={data.design_document} className="text-gray-300 text-sm" />
          </div>
        )}

        {/* Validation / research */}
        {data.research && (
          <div className="glass rounded-2xl p-6 mb-6 border border-white/10">
            <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">Validation</h2>
            <MarkdownText text={data.research} className="text-gray-300 text-sm" />
          </div>
        )}

        {/* Links */}
        {links.length > 0 && (
          <div className="glass rounded-2xl p-6 mb-6 border border-white/10">
            <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">Links</h2>
            <ul className="space-y-2">
              {links.map((link, i) => (
                <li key={i}>
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary text-sm hover:underline break-all"
                  >
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Riff conversation */}
        {riffMessages.length > 0 && (
          <div className="glass rounded-2xl p-6 mb-6 border border-white/10">
            <h2 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wide">💭 Thinking out loud</h2>
            <div className="space-y-3">
              {riffMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary/20 text-white border border-primary/20'
                      : 'bg-white/5 text-gray-300 border border-white/10'
                  }`}>
                    {msg.role === 'user'
                      ? msg.content
                      : <MarkdownText text={msg.content} className="text-sm" />
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {tags.map(t => (
              <span key={t} className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-400">#{t}</span>
            ))}
          </div>
        )}

        {/* Reactions */}
        <div className="flex items-center gap-3 mb-10">
          {REACTIONS.map(emoji => (
            <button
              key={emoji}
              onClick={() => handleReact(emoji)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full glass border border-white/10 hover:border-primary/30 hover:bg-primary/5 transition-all text-sm"
            >
              <span>{emoji}</span>
              {reactionCount(emoji) > 0 && (
                <span className="text-gray-400 text-xs">{reactionCount(emoji)}</span>
              )}
            </button>
          ))}
        </div>

        {/* Comments */}
        <div className="border-t border-white/10 pt-8">
          <h2 className="font-semibold mb-6">
            {comments.length > 0 ? `${comments.length} comment${comments.length > 1 ? 's' : ''}` : 'No comments yet'}
          </h2>

          {comments.map(c => (
            <div key={c.id} className={`mb-5 ${c.is_author_reply ? 'pl-4 border-l-2 border-primary/30' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-sm font-medium ${c.is_author_reply ? 'text-primary' : 'text-white'}`}>
                  {c.is_author_reply ? '✏️ Author' : c.author_name}
                </span>
                <span className="text-xs text-gray-600">{formatDate(c.created_at)}</span>
              </div>
              <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{c.content}</p>
            </div>
          ))}

          {/* Comment form */}
          <form onSubmit={submitComment} className="mt-8 space-y-3">
            <input
              value={commentName}
              onChange={e => setCommentName(e.target.value)}
              placeholder="Your name"
              maxLength={100}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/40 transition-colors"
            />
            <textarea
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="Leave a comment…"
              rows={3}
              maxLength={2000}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/40 transition-colors resize-none"
            />
            {commentError && <p className="text-xs text-red-400">{commentError}</p>}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">{commentText.length}/2000</span>
              <button
                type="submit"
                disabled={!commentName.trim() || !commentText.trim() || submitting}
                className="px-5 py-2 rounded-xl bg-primary/20 text-primary border border-primary/30 text-sm font-medium hover:bg-primary/30 transition-all disabled:opacity-40"
              >
                {submitting ? 'Posting…' : commentDone ? '✓ Posted' : 'Post comment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
