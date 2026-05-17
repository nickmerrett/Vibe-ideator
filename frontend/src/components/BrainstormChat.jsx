import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useDataStore } from '../store/useDataStore';

export default function BrainstormChat({ onClose, seedIdea = null }) {
  const [messages, setMessages] = useState([]);
  const [capturedSnippets, setCapturedSnippets] = useState([]);
  const [showCaptures, setShowCaptures] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState('claude');
  const [providers, setProviders] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const { updateIdea } = useDataStore();
  const [savedSnippetIds, setSavedSnippetIds] = useState(new Set());

  useEffect(() => {
    loadProviders();
    if (seedIdea) {
      loadRiffHistory();
    } else {
      startConversation();
    }
    initVoiceRecognition();

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const initVoiceRecognition = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const captureCommands = ['note that', 'capture that', 'save that', 'remember that', "that's an idea", 'capture this', 'note this'];
        const hasCaptureCommand = captureCommands.some(cmd => transcript.toLowerCase().includes(cmd));

        if (hasCaptureCommand) {
          setMessages(currentMessages => {
            const lastAiMessage = [...currentMessages].reverse().find(m => m.role === 'assistant');
            if (lastAiMessage) {
              setCapturedSnippets(prev => [...prev, {
                id: Date.now(),
                text: lastAiMessage.content,
                role: 'assistant',
                timestamp: new Date(),
                isVoiceCommand: true
              }]);
              setShowCaptures(true);
            }
            return currentMessages;
          });
        } else {
          setInput(transcript);
        }
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  };

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadRiffHistory = () => {
    const history = seedIdea.riff_conversation;
    if (Array.isArray(history) && history.length > 0) {
      setMessages(history);
    } else {
      startConversation();
    }
  };

  const loadProviders = async () => {
    try {
      const data = await api.getAIProviders();
      setProviders(data.providers);
      const available = Object.entries(data.providers).find(([_, p]) => p.available);
      if (available) setProvider(available[0]);
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  };

  const startConversation = async () => {
    setLoading(true);
    setError(null);

    const systemPrompt = `You are a supportive thinking partner helping someone develop their idea. Each reply does one thing: ask a curious question, build on something they said, or gently surface a tension worth exploring.

- Mostly draw them out — what excites them, what they haven't figured out yet, what the idea could become
- Occasionally challenge an assumption, but from a place of genuine curiosity not scepticism
- Match their energy; if they're excited, be warm; if they're uncertain, be steady

One or two sentences max. Conversational tone, no lists, no emojis.`;

    let userPrompt;
    if (seedIdea) {
      userPrompt = `I have this idea: "${seedIdea.title}" - ${seedIdea.summary}\n\nLet's riff on this. What comes to mind?`;
    } else {
      userPrompt = 'Hey! Want to brainstorm some project ideas?';
    }

    try {
      const response = await api.chatWithAI(
        [{ role: 'user', content: userPrompt }],
        { provider, systemPrompt }
      );

      const initial = [
        { role: 'user', content: userPrompt, hidden: !!seedIdea },
        { role: 'assistant', content: response.message }
      ];
      setMessages(initial);
      if (seedIdea) {
        updateIdea(seedIdea.id, { riff_conversation: initial }).catch(() => {});
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const trimmedInput = input.trim();

    if (trimmedInput.startsWith('/note ') || trimmedInput.startsWith('/idea ')) {
      const commandText = trimmedInput.substring(6).trim();
      if (commandText.length > 0) {
        setCapturedSnippets(prev => [...prev, {
          id: Date.now(),
          text: commandText,
          role: 'user',
          timestamp: new Date(),
          isCommand: true
        }]);
        setShowCaptures(true);
      }
      setInput('');
      return;
    }

    if (trimmedInput === '/capture' && messages.length > 0) {
      const lastAiMessage = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAiMessage) handleCaptureMessage(lastAiMessage.content, 'assistant');
      setInput('');
      return;
    }

    const userMessage = { role: 'user', content: trimmedInput };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    const systemPrompt = `You are a supportive thinking partner helping someone develop their idea. Each reply does one thing: ask a curious question, build on something they said, or gently surface a tension worth exploring.

- Mostly draw them out — what excites them, what they haven't figured out yet, what the idea could become
- Occasionally challenge an assumption, but from a place of genuine curiosity not scepticism
- Match their energy; if they're excited, be warm; if they're uncertain, be steady

One or two sentences max. Conversational tone, no lists, no emojis.`;

    try {
      const response = await api.chatWithAI(newMessages, { provider, systemPrompt, temperature: 0.7, maxTokens: 300 });
      const assistantMsg = { role: 'assistant', content: response.message };
      const updated = [...newMessages, assistantMsg];
      setMessages(updated);
      if (seedIdea) {
        updateIdea(seedIdea.id, { riff_conversation: updated }).catch(() => {});
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCaptureMessage = (text, role) => {
    setCapturedSnippets(prev => [...prev, {
      id: Date.now(),
      text: text.trim(),
      role,
      timestamp: new Date()
    }]);
    setShowCaptures(true);
  };

  const handleAddToNotes = async (snippet) => {
    if (!seedIdea) return;
    try {
      const existing = seedIdea.notes?.trim() || '';
      const appended = existing
        ? `${existing}\n\n• ${snippet.text.trim()}`
        : `• ${snippet.text.trim()}`;
      await updateIdea(seedIdea.id, { notes: appended });
      seedIdea.notes = appended;
      setSavedSnippetIds(prev => new Set([...prev, snippet.id]));
    } catch (error) {
      console.error('Failed to add to notes:', error);
    }
  };

  const visibleMessages = messages.filter(m => !m.hidden);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="glass border-b border-white/10 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl glass hover:bg-white/5 flex items-center justify-center flex-shrink-0 transition-all"
          title="Back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-tight">
            {seedIdea ? '💭 Riff' : '💭 Brainstorm'}
          </div>
          {seedIdea && (
            <div className="text-xs text-gray-400 truncate">{seedIdea.title}</div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {providers && (
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="glass px-2 py-1.5 rounded-lg text-xs"
              disabled={loading}
            >
              {Object.entries(providers).map(([key, p]) => (
                <option key={key} value={key} disabled={!p.available}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          {capturedSnippets.length > 0 && (
            <button
              onClick={() => setShowCaptures(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                showCaptures ? 'bg-accent/30 text-accent border border-accent/40' : 'glass hover:bg-white/5'
              }`}
            >
              ✂️ {capturedSnippets.length}
            </button>
          )}
        </div>
      </div>

      {/* Captured snippets panel — collapsible */}
      {showCaptures && capturedSnippets.length > 0 && (
        <div className="border-b border-white/10 bg-black/20 max-h-56 overflow-y-auto">
          <div className="p-3 space-y-2">
            {capturedSnippets.map(snippet => (
              <div key={snippet.id} className="glass rounded-xl p-3 text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                    {snippet.role === 'user' ? '👤 You' : '🤖 AI'}
                  </span>
                  {snippet.isCommand && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent">/cmd</span>
                  )}
                  {snippet.isVoiceCommand && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">🎤</span>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">
                    {new Date(snippet.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-gray-200 mb-3 text-xs leading-relaxed">{snippet.text}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAddToNotes(snippet)}
                    disabled={!seedIdea || savedSnippetIds.has(snippet.id)}
                    className="flex-1 px-2 py-1 rounded-lg bg-accent hover:bg-accent/80 text-white text-xs transition-all disabled:opacity-50"
                  >
                    {savedSnippetIds.has(snippet.id) ? '✓ Added to notes' : '📝 Add to notes'}
                  </button>
                  <button
                    onClick={() => setCapturedSnippets(prev => prev.filter(s => s.id !== snippet.id))}
                    className="px-2 py-1 rounded-lg glass hover:bg-red-500/20 text-xs transition-all"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {visibleMessages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="relative max-w-[85%]">
              {msg.role === 'user' ? (
                <div className="group">
                  <div
                    className="px-4 py-3 rounded-2xl cursor-pointer transition-all bg-gradient-primary text-white hover:shadow-lg hover:shadow-primary/40"
                    onClick={() => handleCaptureMessage(msg.content, msg.role)}
                    title="Tap to capture"
                  >
                    <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                  </div>
                  <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <span className="text-xs bg-accent text-white px-2 py-0.5 rounded-full shadow-lg">✂️</span>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3 rounded-2xl glass">
                  {msg.content.split(/(?<=[.!?])\s+/).map((sentence, si, arr) => (
                    <span
                      key={si}
                      className="cursor-pointer hover:bg-accent/20 hover:text-accent rounded px-0.5 transition-all inline"
                      onClick={() => handleCaptureMessage(sentence.trim(), msg.role)}
                      title="Tap to capture"
                    >
                      {sentence}
                      {si < arr.length - 1 && ' '}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="glass px-4 py-3 rounded-2xl">
              <div className="flex gap-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-white/10 flex-shrink-0">
        {input.startsWith('/') && !input.includes(' ') && (
          <div className="mb-2 glass rounded-lg p-3 text-xs">
            <div className="font-semibold mb-1.5 text-gray-300">Commands:</div>
            <div className="space-y-1 text-gray-400">
              <div><code className="text-accent">/note your text</code> — capture a note</div>
              <div><code className="text-accent">/idea your text</code> — capture an idea</div>
              <div><code className="text-accent">/capture</code> — capture last AI message</div>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleVoiceInput}
            disabled={loading}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
              isListening ? 'bg-red-500 text-white animate-pulse' : 'glass hover:bg-white/5'
            } disabled:opacity-50`}
          >
            {isListening ? '🎙️' : '🎤'}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isListening ? 'Listening...' : 'Type / for commands'}
            className="input flex-1 text-sm"
            disabled={loading || isListening}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="btn-primary disabled:opacity-50 px-4"
          >
            {loading ? '...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
