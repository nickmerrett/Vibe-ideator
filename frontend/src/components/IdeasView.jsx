import { useState, useEffect, useRef } from 'react';
import { useDataStore } from '../store/useDataStore';
import { api } from '../services/api';
import { fmtDate } from '../utils/dates';
import AIChat from './AIChat';
import BrainstormChat from './BrainstormChat';
import PromoteChat from './PromoteChat';
import AreaBadge from './AreaBadge';
import AreaSelect from './AreaSelect';
import SplitIdeaModal from './SplitIdeaModal';
import IdeaDetail from './IdeaDetail';

function TagFilter({ allTags, selectedTags, onToggle }) {
  return (
    <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
      {allTags.map(tag => (
        <button
          key={tag}
          onClick={() => onToggle(tag)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            selectedTags.includes(tag)
              ? 'bg-accent text-white'
              : 'glass hover:bg-white/5'
          }`}
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}

export default function IdeasView({ activeArea = null }) {
  const { ideas, fetchIdeas, createIdea, promoteIdea, deleteIdea, updateIdea, loading } = useDataStore();
  const [filter, setFilter] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [sortBy, setSortBy] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [showNewIdea, setShowNewIdea] = useState(false);
  const [refiningIdea, setRefiningIdea] = useState(null);
  const [viewingIdea, setViewingIdea] = useState(null);
  const [ideatingFromIdea, setIdeatingFromIdea] = useState(null);
  const [showIdeation, setShowIdeation] = useState(false);
  const [promotingIdea, setPromotingIdea] = useState(null);
  const [splittingIdea, setSplittingIdea] = useState(null);
  const [deletingIdea, setDeletingIdea] = useState(null);
  const [attachments, setAttachments] = useState({});
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const [tagsInput, setTagsInput] = useState('');
  const [newIdea, setNewIdea] = useState({
    title: '',
    summary: '',
    vibe: [],
    tags: [],
    excitement: 5,
    complexity: 'weekend',
    techStack: [],
    area_id: null,
  });

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  const startRecording = async () => {
    console.log('[Voice] Starting audio recording...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      audioChunksRef.current = [];
      mediaRecorderRef.current = new MediaRecorder(stream);

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.start();
      setIsListening(true);
      console.log('[Voice] Recording started');
    } catch (error) {
      console.error('[Voice] Failed to start recording:', error);
      alert('Failed to access microphone: ' + error.message);
    }
  };

  const stopRecording = async () => {
    console.log('[Voice] Stopping recording...');

    if (!mediaRecorderRef.current || !isListening) {
      console.log('[Voice] Not recording');
      return;
    }

    return new Promise((resolve) => {
      mediaRecorderRef.current.onstop = async () => {
        console.log('[Voice] Recording stopped');
        setIsListening(false);
        setIsProcessingVoice(true);

        // Stop the media stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }

        try {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          console.log('[Voice] Audio blob size:', audioBlob.size);

          // Convert to base64
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64Audio = reader.result.split(',')[1];

            console.log('[Voice] Sending to Claude for transcription...');

            // Send to backend which will call Claude
            const response = await fetch('/api/ai/transcribe', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('viberater_access_token')}`
              },
              body: JSON.stringify({
                audio: base64Audio,
                mimeType: 'audio/webm'
              })
            });

            const data = await response.json();
            console.log('[Voice] Transcription response:', data);

            if (data.title && data.summary) {
              setNewIdea(prev => ({
                ...prev,
                title: data.title,
                summary: data.summary,
                tags: data.tags || []
              }));
              setTagsInput((data.tags || []).join(', '));
            } else {
              alert('Failed to process audio. Please try again.');
            }

            setIsProcessingVoice(false);
            resolve();
          };
        } catch (error) {
          console.error('[Voice] Failed to process audio:', error);
          alert('Failed to process audio: ' + error.message);
          setIsProcessingVoice(false);
          resolve();
        }
      };

      mediaRecorderRef.current.stop();
    });
  };

  // Get all unique tags from all ideas
  const allTags = Object.entries(
    ideas.flatMap(i => i.tags || []).reduce((acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag]) => tag);

  const filteredIdeas = ideas.filter(idea => {
    // Filter by archive status
    if (filter === 'active' && idea.archived) return false;
    if (filter === 'archived' && !idea.archived) return false;
    if (filter === 'refined' && idea.status !== 'refined') return false;
    if (filter === 'promoted' && idea.status !== 'promoted-to-project') return false;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = idea.title?.toLowerCase().includes(query);
      const matchesSummary = idea.summary?.toLowerCase().includes(query);
      const matchesTags = idea.tags?.some(tag => tag.toLowerCase().includes(query));
      if (!matchesTitle && !matchesSummary && !matchesTags) return false;
    }

    // Tag filter
    if (selectedTags.length > 0) {
      const hasAllTags = selectedTags.every(tag => idea.tags?.includes(tag));
      if (!hasAllTags) return false;
    }

    // Area filter
    if (activeArea && idea.area_id !== activeArea) return false;

    return true;
  });

  // Sort ideas
  const sortedIdeas = [...filteredIdeas].sort((a, b) => {
    switch (sortBy) {
      case 'newest':
        return new Date(b.created_at) - new Date(a.created_at);
      case 'oldest':
        return new Date(a.created_at) - new Date(b.created_at);
      case 'excitement':
        return (b.excitement || 0) - (a.excitement || 0);
      case 'updated':
        return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
      default:
        return 0;
    }
  });

  const handleCreateIdea = async (e) => {
    e.preventDefault();
    try {
      // Parse tags from input string before submitting
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
      await createIdea({ ...newIdea, tags });
      setShowNewIdea(false);
      setNewIdea({
        title: '',
        summary: '',
        vibe: [],
        tags: [],
        excitement: 5,
        complexity: 'weekend',
        techStack: []
      });
      setTagsInput('');
    } catch (error) {
      console.error('Failed to create idea:', error);
    }
  };

  const handlePromote = async (id) => {
    const idea = ideas.find(i => i.id === id);
    setPromotingIdea(idea);
  };

  const handlePromoteWithPlan = async (id, projectPlan) => {
    try {
      await promoteIdea(id, projectPlan);
      alert('Idea promoted to project with AI-generated plan!');
    } catch (error) {
      alert('Failed to promote idea');
      throw error;
    }
  };

  const handleArchive = async (id, archived) => {
    try {
      await updateIdea(id, { archived });
    } catch (error) {
      alert('Failed to archive idea');
    }
  };

  const handleDelete = async () => {
    if (!deletingIdea) return;
    try {
      await deleteIdea(deletingIdea.id);
      if (viewingIdea?.id === deletingIdea.id) setViewingIdea(null);
      setDeletingIdea(null);
    } catch (error) {
      alert('Failed to delete idea');
    }
  };

  const openIdea = async (idea) => {
    setViewingIdea(idea);
    if (!attachments[idea.id]) {
      try {
        const data = await api.getAttachments(idea.id);
        setAttachments(prev => ({ ...prev, [idea.id]: data.attachments }));
      } catch {}
    }
  };

  const handleSplit = async (original, partA, partB) => {
    const shared = {
      tags: original.tags || [],
      area_id: original.area_id || null,
      excitement: original.excitement,
      complexity: original.complexity,
      vibe: original.vibe || [],
    };
    await createIdea({ title: partA.title, summary: partA.summary, ...shared });
    await createIdea({ title: partB.title, summary: partB.summary, ...shared });
    await updateIdea(original.id, { archived: true });
  };

  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  // Full-screen riff — replaces the list entirely
  if (ideatingFromIdea || showIdeation) {
    return (
      <BrainstormChat
        seedIdea={ideatingFromIdea}
        onClose={() => { setIdeatingFromIdea(null); setShowIdeation(false); fetchIdeas(); }}
      />
    );
  }

  // Full-screen idea detail — replaces the list entirely
  if (viewingIdea) {
    return (
      <>
        <IdeaDetail
          idea={viewingIdea}
          ideas={ideas}
          attachments={attachments[viewingIdea.id]}
          onBack={() => setViewingIdea(null)}
          onRefine={() => { setViewingIdea(null); setRefiningIdea(viewingIdea); }}
          onRiff={() => setIdeatingFromIdea(viewingIdea)}
          onPromote={() => { setViewingIdea(null); setPromotingIdea(viewingIdea); }}
          onSplit={() => { setViewingIdea(null); setSplittingIdea(viewingIdea); }}
          onArchive={handleArchive}
          onDelete={() => setDeletingIdea(viewingIdea)}
          onUpdate={updateIdea}
          onAttachmentUploaded={(att) => setAttachments(prev => ({
            ...prev,
            [viewingIdea.id]: [...(prev[viewingIdea.id] || []), att],
          }))}
          onAttachmentDeleted={async (id) => {
            await api.deleteAttachment(id);
            setAttachments(prev => ({
              ...prev,
              [viewingIdea.id]: prev[viewingIdea.id].filter(a => a.id !== id),
            }));
          }}
        />

        {/* Delete confirmation — rendered on top of detail */}
        {deletingIdea && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 z-[60]">
            <div className="glass rounded-2xl p-6 max-w-sm w-full border border-red-500/20">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-white">Delete idea?</h3>
                  <p className="text-xs text-gray-400 mt-0.5">This cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-gray-300 mb-6">
                "<span className="text-white font-medium">{deletingIdea.title}</span>" will be permanently removed.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeletingIdea(null)} className="flex-1 glass px-4 py-2 rounded-xl text-sm hover:bg-white/5 transition-all" autoFocus>Cancel</button>
                <button onClick={handleDelete} className="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 hover:text-red-200 px-4 py-2 rounded-xl text-sm font-medium transition-all">Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Modals triggered from detail actions */}
        {refiningIdea && (
          <AIChat idea={refiningIdea} onClose={() => { setRefiningIdea(null); fetchIdeas(); }} />
        )}
        {splittingIdea && (
          <SplitIdeaModal idea={splittingIdea} onSplit={handleSplit} onClose={() => setSplittingIdea(null)} />
        )}
        {promotingIdea && (
          <PromoteChat idea={promotingIdea} onClose={() => { setPromotingIdea(null); fetchIdeas(); }} onPromote={handlePromoteWithPlan} />
        )}
      </>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Filter Bar */}
      <div className="glass border-b border-white/10 px-3 py-2 sm:px-6 sm:py-3 flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          {/* Search */}
          <div className="flex-1 max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Search ideas, tags..."
              className="input w-full text-sm py-1.5"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`relative glass px-2.5 py-1.5 rounded-lg transition-all text-xs font-medium ${showFilters ? 'bg-white/10' : 'hover:bg-white/5'}`}
            >
              ⚙️
              {(filter !== 'active' || sortBy !== 'newest' || selectedTags.length > 0) && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
              )}
            </button>
            <button
              onClick={() => setShowIdeation(true)}
              className="glass px-2.5 py-1.5 rounded-lg hover:bg-accent/20 hover:text-accent transition-all text-xs font-medium"
            >
              💭
            </button>
            <button
              onClick={() => setShowNewIdea(true)}
              className="btn-primary btn-sm text-xs px-2.5 py-1.5"
            >
              + New
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="flex items-center gap-3 flex-wrap">
            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="glass px-2.5 py-1.5 rounded-lg text-xs"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="updated">Updated</option>
              <option value="excitement">Excitement</option>
            </select>

            {/* Status Filters */}
            <div className="flex gap-1.5">
              {[
                { value: 'active', label: 'Active' },
                { value: 'refined', label: '✨' },
                { value: 'promoted', label: '🚀' },
                { value: 'archived', label: '📦' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    filter === value
                      ? 'bg-gradient-primary text-white shadow-lg shadow-primary/40'
                      : 'glass hover:bg-white/5'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Tag Filters */}
            {allTags.length > 0 && (
              <TagFilter
                allTags={allTags}
                selectedTags={selectedTags}
                onToggle={toggleTag}
              />
            )}
          </div>
        )}

        {/* Active Filters Display */}
        {(searchQuery || selectedTags.length > 0) && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>Filtering:</span>
            {searchQuery && <span className="glass px-2 py-1 rounded">"{searchQuery}"</span>}
            {selectedTags.map(tag => (
              <span key={tag} className="glass px-2 py-1 rounded flex items-center gap-1">
                #{tag}
                <button onClick={() => toggleTag(tag)} className="hover:text-red-400">✕</button>
              </span>
            ))}
            <button
              onClick={() => { setSearchQuery(''); setSelectedTags([]); }}
              className="ml-auto text-accent hover:text-accent/80"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Ideas List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading ideas...</div>
        ) : sortedIdeas.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            No ideas yet. Create your first one!
          </div>
        ) : (
          <div className="grid gap-2 sm:gap-3 max-w-4xl mx-auto">
            {sortedIdeas.map((idea) => (
              <div
                key={idea.id}
                className="card cursor-pointer hover:border-white/20 transition-all active:scale-[0.99]"
                onClick={() => openIdea(idea)}
              >
                <div className="flex items-start justify-between mb-1.5 gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold leading-snug truncate">{idea.title}</h3>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {idea.status === 'refined' && (
                        <span className="px-1.5 py-0.5 bg-accent/20 text-accent text-xs rounded-full">✨ Refined</span>
                      )}
                      {idea.area_id && <AreaBadge areaId={idea.area_id} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {idea.thumbnail_url && (
                      <img
                        src={idea.thumbnail_url}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover border border-white/10"
                      />
                    )}
                    <span className="text-base">
                      {idea.status === 'promoted-to-project' ? '🚀' : '💡'}
                    </span>
                  </div>
                </div>

                {idea.summary && (
                  <p className="text-gray-400 text-sm leading-relaxed line-clamp-2 mb-2">{idea.summary}</p>
                )}

                {/* Tags */}
                {idea.tags?.length > 0 && (
                  <div className="flex gap-1.5 mb-2 flex-wrap">
                    {idea.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-full text-xs bg-accent/20 text-accent"
                        onClick={e => { e.stopPropagation(); toggleTag(tag); }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Vibe */}
                {idea.vibe?.length > 0 && (
                  <div className="flex gap-1.5 mb-2 flex-wrap">
                    {idea.vibe.map((v, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full text-xs glass">{v}</span>
                    ))}
                  </div>
                )}

                {/* Metadata row */}
                <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                  <span>⚡ {idea.excitement}/10</span>
                  <span>⏱️ {idea.complexity}</span>
                  {idea.created_at && (
                    <span>📅 {fmtDate(idea.created_at)}</span>
                  )}
                  {((idea.related_ideas?.length > 0) || idea.parent_idea_id) && (
                    <span className="text-primary">🔗 {(idea.parent_idea_id ? 1 : 0) + (idea.related_ideas?.length || 0)}</span>
                  )}
                  {idea.sharing_enabled && (
                    <span className="text-blue-400" title="Sharing enabled">🔗 shared</span>
                  )}
                  {idea.unread_comment_count > 0 && (
                    <span className="text-green-400">💬 {idea.unread_comment_count}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Idea Modal */}
      {showNewIdea && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="glass rounded-3xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6">New Idea</h2>

            {/* Voice Input Button - Push to Talk */}
            <div className="mb-6">
              <button
                type="button"
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={isProcessingVoice}
                className={`w-full py-4 rounded-xl flex items-center justify-center gap-3 text-lg font-medium transition-all ${
                  isListening
                    ? 'bg-red-500 text-white animate-pulse'
                    : isProcessingVoice
                    ? 'bg-gradient-primary text-white cursor-wait'
                    : 'glass hover:bg-primary/20 hover:text-primary'
                }`}
              >
                {isListening ? (
                  <>🎙️ Recording... (Release to Stop)</>
                ) : isProcessingVoice ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Processing with AI...
                  </>
                ) : (
                  <>🎤 Hold to Speak</>
                )}
              </button>
              <p className="text-xs text-gray-400 text-center mt-2">
                {isListening ? 'Keep holding while speaking...' : isProcessingVoice ? 'AI is extracting title and tags...' : 'Hold button down and speak your idea - AI will generate title & tags'}
              </p>
            </div>

            <div className="border-t border-white/10 pt-6 mb-4">
              <p className="text-sm text-gray-400 text-center">Or fill in manually:</p>
            </div>

            <form onSubmit={handleCreateIdea} className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <input
                  type="text"
                  value={newIdea.title}
                  onChange={(e) => setNewIdea({ ...newIdea, title: e.target.value })}
                  className="input"
                  placeholder="What's your idea?"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Summary</label>
                <textarea
                  value={newIdea.summary}
                  onChange={(e) => setNewIdea({ ...newIdea, summary: e.target.value })}
                  className="input min-h-[100px]"
                  placeholder="Describe your idea..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Excitement (1-10)</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={newIdea.excitement}
                  onChange={(e) => setNewIdea({ ...newIdea, excitement: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="text-center text-2xl mt-2">{newIdea.excitement}/10</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Complexity</label>
                <select
                  value={newIdea.complexity}
                  onChange={(e) => setNewIdea({ ...newIdea, complexity: e.target.value })}
                  className="input"
                >
                  <option value="afternoon">Afternoon</option>
                  <option value="weekend">Weekend</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="months">Months</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Area</label>
                <AreaSelect
                  value={newIdea.area_id}
                  onChange={v => setNewIdea({ ...newIdea, area_id: v })}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Tags (optional)</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="input"
                  placeholder="web, mobile, ai, prototype"
                />
                <p className="text-xs text-gray-400 mt-1">Separate tags with commas</p>
                {tagsInput && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {tagsInput.split(',').map(t => t.trim()).filter(Boolean).map((tag, i) => (
                      <span key={i} className="px-2 py-1 bg-primary/20 text-primary rounded text-sm">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button type="submit" className="btn-primary flex-1">
                  Create Idea
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewIdea(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modals only used from the list (not from detail view) */}
      {refiningIdea && (
        <AIChat idea={refiningIdea} onClose={() => { setRefiningIdea(null); fetchIdeas(); }} />
      )}
      {splittingIdea && (
        <SplitIdeaModal idea={splittingIdea} onSplit={handleSplit} onClose={() => setSplittingIdea(null)} />
      )}
      {promotingIdea && (
        <PromoteChat idea={promotingIdea} onClose={() => { setPromotingIdea(null); fetchIdeas(); }} onPromote={handlePromoteWithPlan} />
      )}

      {/* Delete confirmation */}
      {deletingIdea && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 z-[60]">
          <div className="glass rounded-2xl p-6 max-w-sm w-full border border-red-500/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-white">Delete idea?</h3>
                <p className="text-xs text-gray-400 mt-0.5">This cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-300 mb-6">
              "<span className="text-white font-medium">{deletingIdea.title}</span>" will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingIdea(null)} className="flex-1 glass px-4 py-2 rounded-xl text-sm hover:bg-white/5 transition-all" autoFocus>Cancel</button>
              <button onClick={handleDelete} className="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 hover:text-red-200 px-4 py-2 rounded-xl text-sm font-medium transition-all">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
