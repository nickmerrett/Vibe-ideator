import { useState, useEffect } from 'react';
import { api } from '../services/api';

function formatDate(str) {
  if (!str) return 'Never';
  return new Date(str).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ApiKeySettings({ onClose }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState(null);
  const [newKeyId, setNewKeyId] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const data = await api.listApiKeys();
    setLoading(false);
    if (data.error) { setError(data.error); return; }
    setKeys(data.keys || []);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    const data = await api.createApiKey(newName.trim());
    setCreating(false);
    if (data.error) { setError(data.error); return; }
    setKeys(prev => [data.key, ...prev]);
    setNewKeyValue(data.apiKey);
    setNewKeyId(data.key.id);
    setNewName('');
  }

  async function handleRevoke(id) {
    if (!confirm('Revoke this API key? Any integrations using it will stop working.')) return;
    const data = await api.revokeApiKey(id);
    if (data.error) { setError(data.error); return; }
    setKeys(prev => prev.filter(k => k.id !== id));
    if (newKeyId === id) { setNewKeyValue(null); setNewKeyId(null); }
  }

  function handleCopy() {
    navigator.clipboard.writeText(newKeyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="glass rounded-2xl p-6 max-w-lg w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-5 flex-shrink-0">
          <h2 className="text-lg font-semibold">API Keys</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>

        <p className="text-sm text-gray-400 mb-5 leading-relaxed flex-shrink-0">
          Use API keys to access Viberater from external tools, scripts, or MCP-compatible agents.
          Keys are shown only once — store them somewhere safe.
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-lg mb-4 flex-shrink-0">
            {error}
          </div>
        )}

        {/* New key reveal */}
        {newKeyValue && (
          <div className="mb-5 flex-shrink-0">
            <div className="text-xs text-yellow-400 font-medium mb-2">⚠ Copy this key now — it won't be shown again</div>
            <div className="flex gap-2">
              <code className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-green-400 font-mono break-all">
                {newKeyValue}
              </code>
              <button
                onClick={handleCopy}
                className="px-3 py-2 glass rounded-lg text-xs hover:bg-white/10 transition-colors flex-shrink-0"
              >
                {copied ? '✓' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Create form */}
        <form onSubmit={handleCreate} className="flex gap-2 mb-5 flex-shrink-0">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Key name (e.g. Claude MCP, Home server)"
            maxLength={100}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/40 transition-colors"
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {creating ? '…' : 'Create'}
          </button>
        </form>

        {/* Key list */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">No API keys yet</div>
          ) : (
            <div className="space-y-2">
              {keys.map(k => (
                <div key={k.id} className="flex items-center gap-3 px-3 py-3 bg-white/5 rounded-xl border border-white/10">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{k.name}</div>
                    <div className="flex gap-3 mt-0.5">
                      <code className="text-xs text-gray-500 font-mono">{k.key_prefix}…</code>
                      <span className="text-xs text-gray-600">Created {formatDate(k.created_at)}</span>
                      <span className="text-xs text-gray-600">Used {formatDate(k.last_used)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(k.id)}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg text-xs transition-colors flex-shrink-0"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-white/10 flex-shrink-0">
          <p className="text-xs text-gray-500">
            Use as <code className="text-gray-400">Authorization: Bearer vbr_...</code> on API and MCP requests.
          </p>
        </div>
      </div>
    </div>
  );
}
