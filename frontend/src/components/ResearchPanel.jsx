import { useState } from 'react';
import { api } from '../services/api';

function formatMarkdown(text) {
  return text
    .replace(/#{3} (.*?)$/gm, '<h3 class="text-base font-bold mt-4 mb-2">$1</h3>')
    .replace(/#{2} (.*?)$/gm, '<h2 class="text-lg font-bold mt-5 mb-3">$1</h2>')
    .replace(/#{1} (.*?)$/gm, '<h1 class="text-xl font-bold mt-6 mb-4">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code class="bg-white/10 px-1.5 py-0.5 rounded text-xs text-primary">$1</code>')
    .replace(/^- (.*?)$/gm, '<li class="ml-4 text-gray-200">$1</li>')
    .replace(/^(\d+)\. (.*?)$/gm, '<li class="ml-4 text-gray-200">$2</li>')
    .replace(/\n\n/g, '</p><p class="mb-3 text-gray-200 leading-relaxed">')
    .replace(/^(?!<[h|l])/gm, '<p class="mb-3 text-gray-200 leading-relaxed">');
}

export default function ResearchPanel({ idea, onResearchSaved }) {
  const [state, setState] = useState(idea.research ? 'done' : 'idle');
  const [events, setEvents] = useState([]);
  const [answer, setAnswer] = useState(idea.research || '');

  function reset() {
    setState('idle');
    setEvents([]);
    setAnswer('');
  }

  async function run() {
    setState('running');
    setEvents([]);
    setAnswer('');

    let accumulated = '';

    await api.streamResearch(
      idea.id,
      idea.title,
      idea.summary,
      (event) => {
        if (event.type === 'tool_call') {
          setEvents(prev => [...prev, { type: 'call', name: event.name, args: event.args }]);
        } else if (event.type === 'tool_result') {
          setEvents(prev => prev.map((e, i) =>
            i === prev.length - 1 ? { ...e, result: event.result } : e
          ));
        } else if (event.type === 'token') {
          accumulated += event.text;
          setAnswer(accumulated);
        }
      },
      async () => {
        setState('done');
        if (accumulated) {
          try {
            await api.updateIdea(idea.id, { research: accumulated });
            onResearchSaved?.(accumulated);
          } catch {
            // save failed silently — result still visible in UI
          }
        }
      },
      (err) => { setEvents(prev => [...prev, { type: 'error', message: err }]); setState('error'); }
    );
  }

  return (
    <div className="space-y-4">
      {state === 'idle' && (
        <button
          onClick={run}
          className="flex items-center gap-2 px-4 py-2 rounded-xl glass border border-white/10 text-sm hover:border-primary/30 hover:text-primary transition-all"
        >
          🔍 Research this idea
        </button>
      )}

      {state !== 'idle' && (
        <div className="space-y-3">
          {/* Tool call log */}
          {events.map((e, i) => (
            <div key={i} className="text-xs font-mono">
              {e.type === 'call' && (
                <div className="flex items-center gap-2 text-gray-400">
                  <span className={state === 'running' && !e.result ? 'animate-pulse text-primary' : ''}>
                    {e.name === 'web_search' ? '🔍' : '🌐'}
                  </span>
                  <span>
                    {e.name === 'web_search'
                      ? `Searching: "${e.args.query}"`
                      : `Fetching: ${e.args.url}`}
                  </span>
                  {!e.result && state === 'running' && <span className="animate-pulse">…</span>}
                  {e.result && <span className="text-green-500/60">✓</span>}
                </div>
              )}
              {e.type === 'error' && (
                <div className="text-red-400">Error: {e.message}</div>
              )}
            </div>
          ))}

          {/* Answer */}
          {answer && (
            <div className="glass rounded-xl p-4 border border-white/10 text-sm">
              <div
                dangerouslySetInnerHTML={{ __html: formatMarkdown(answer) }}
              />
              {state === 'running' && <span className="animate-pulse text-gray-400">▋</span>}
            </div>
          )}

          {/* Actions */}
          {(state === 'done' || state === 'error') && (
            <button
              onClick={reset}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              ↺ Run again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
