import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useDataStore } from '../store/useDataStore';
import { MarkdownText } from '../utils/markdown';

export default function PromoteChat({ idea, onClose, onPromote }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState('claude');
  const [providers, setProviders] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [projectPlan, setProjectPlan] = useState({
    title: '',
    description: '',
    goals: [],
    phases: [],
    initialTasks: [],
    techStack: idea.tech_stack || [],
    estimatedDuration: ''
  });
  const [planComplete, setPlanComplete] = useState(false);
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    loadProviders();
    startConversation();
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
        setInput(transcript);
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

    const systemPrompt = `You are a project planning assistant helping users promote their idea into an actionable project plan.

Your role is to:
- Help define clear project goals and scope
- Break down the project into manageable phases
- Suggest initial tasks to get started
- Identify technical requirements and dependencies
- Help estimate effort and timeline
- Keep the scope realistic for an MVP

Be concise (2-4 sentences per response). Focus on actionable planning, not philosophical discussion.`;

    const userPrompt = `I want to turn this idea into a project:

**Title:** ${idea.title}
**Summary:** ${idea.summary}
${idea.design_document ? `\n**Design Document:**\n${idea.design_document}` : ''}
${idea.excitement ? `\n**Excitement Level:** ${idea.excitement}/10` : ''}
${idea.complexity ? `\n**Estimated Complexity:** ${idea.complexity}` : ''}
${idea.tech_stack?.length > 0 ? `\n**Tech Stack:** ${idea.tech_stack.join(', ')}` : ''}

Help me create a concrete project plan to make this real. What should we define first?`;

    try {
      const response = await api.chatWithAI([
        { role: 'user', content: userPrompt }
      ], { provider, systemPrompt });

      setMessages([
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: response.message }
      ]);

      // Initialize project plan with idea details
      setProjectPlan(prev => ({
        ...prev,
        title: idea.title,
        description: idea.summary,
        techStack: idea.tech_stack || []
      }));
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    const systemPrompt = `You are a project planning assistant. Help the user create an actionable project plan.

Continue the conversation naturally while gathering information about:
- Project goals and success criteria
- Key phases or milestones
- Initial tasks to get started
- Technical decisions
- Realistic timeline estimates

Keep responses concise (2-4 sentences). Be practical and action-oriented.`;

    try {
      const response = await api.chatWithAI(newMessages, { provider, systemPrompt });
      setMessages([...newMessages, { role: 'assistant', content: response.message }]);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePlan = async () => {
    setLoading(true);
    setError(null);

    try {
      // Build a fresh single-message context so prior markdown responses don't bleed into the JSON output
      const conversationSummary = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      const planMessages = [{
        role: 'user',
        content: `Here is a project planning conversation:\n\n${conversationSummary}\n\nBased on the above, output a JSON object with exactly these fields:
{
  "title": "project title",
  "description": "2-3 sentence description",
  "goals": ["goal 1", "goal 2"],
  "phases": [{"name": "Phase name", "description": "what happens", "estimatedDays": 7}],
  "initialTasks": [{"title": "task", "description": "details", "priority": "high|medium|low", "estimatedMinutes": 60}],
  "techStack": ["tech1", "tech2"],
  "estimatedDuration": "X weeks/months"
}

Return only the raw JSON object. No markdown, no code fences, no explanation.`
      }];
      const response = await api.chatWithAI(planMessages, {
        provider,
        systemPrompt: 'You are a project planning assistant. Respond ONLY with valid JSON. No markdown, no explanations, just the JSON object.'
      });

      // Parse the AI response as JSON
      let planData;
      try {
        const msg = response.message;
        // 1. Try fenced code block
        const fenceMatch = msg.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        // 2. Fall back to first { ... last }
        const braceMatch = msg.match(/(\{[\s\S]*\})/);
        const jsonStr = fenceMatch ? fenceMatch[1] : braceMatch ? braceMatch[1] : msg;
        planData = JSON.parse(jsonStr.trim());
      } catch (parseError) {
        console.error('Failed to parse plan JSON:', parseError, response.message);
        throw new Error('AI returned invalid plan format. Please try again.');
      }

      // Update project plan with AI-generated data
      setProjectPlan(prev => ({
        ...prev,
        title: planData.title || prev.title,
        description: planData.description || prev.description,
        goals: planData.goals || [],
        phases: planData.phases || [],
        initialTasks: planData.initialTasks || [],
        techStack: planData.techStack || prev.techStack,
        estimatedDuration: planData.estimatedDuration || ''
      }));

      setPlanComplete(true);

      // Add the plan to the conversation
      setMessages([
        ...planMessages,
        { role: 'assistant', content: 'Project plan generated! Review it on the right and make any adjustments before promoting.' }
      ]);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePromoteToProject = async () => {
    setLoading(true);
    setError(null);

    try {
      // Promote the idea with the generated plan
      await onPromote(idea.id, {
        projectTitle: projectPlan.title,
        projectDescription: projectPlan.description,
        goals: projectPlan.goals,
        phases: projectPlan.phases,
        initialTasks: projectPlan.initialTasks,
        techStack: projectPlan.techStack,
        estimatedDuration: projectPlan.estimatedDuration
      });

      onClose();
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="glass rounded-3xl w-full max-w-7xl h-[85vh] flex overflow-hidden">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col border-r border-white/10">
          {/* Header */}
          <div className="p-6 border-b border-white/10 flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="text-2xl font-bold">Plan Your Project</h2>
              <p className="text-gray-400 text-sm mt-1">"{idea.title}"</p>
            </div>
            <div className="flex items-center gap-3">
              {providers && (
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="glass px-3 py-2 rounded-lg text-sm"
                  disabled={loading}
                >
                  {Object.entries(providers).map(([key, p]) => (
                    <option key={key} value={key} disabled={!p.available}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={onClose} className="w-10 h-10 rounded-xl glass hover:bg-white/5 flex items-center justify-center">
                ✕
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-gradient-primary text-white'
                      : 'glass'
                  }`}
                >
                  {msg.role === 'user'
                    ? <div className="text-sm">{msg.content}</div>
                    : <MarkdownText text={msg.content} className="text-sm" />
                  }
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
          <form onSubmit={handleSend} className="p-6 border-t border-white/10 flex-shrink-0">
            <div className="flex gap-3 mb-3">
              <button
                type="button"
                onClick={toggleVoiceInput}
                disabled={loading}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                  isListening ? 'bg-red-500 text-white animate-pulse' : 'glass hover:bg-white/5'
                } disabled:opacity-50`}
              >
                {isListening ? '🎙️' : '🎤'}
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? 'Listening...' : 'Discuss your project plan...'}
                className="input flex-1"
                disabled={loading || isListening}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="btn-primary disabled:opacity-50 min-w-[80px]"
              >
                {loading ? '...' : 'Send'}
              </button>
            </div>
            {!planComplete && (
              <button
                type="button"
                onClick={handleGeneratePlan}
                disabled={loading || messages.length < 4}
                className="btn-primary w-full disabled:opacity-50"
                title={messages.length < 4 ? 'Have a conversation first to gather project details' : 'Generate structured plan from conversation'}
              >
                ✨ Generate Project Plan
              </button>
            )}
          </form>
        </div>

        {/* Project Plan Preview */}
        <div className="w-96 bg-black/20 flex flex-col">
          <div className="p-6 border-b border-white/10">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              📋 Project Plan
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              {planComplete ? 'Review and edit before promoting' : 'Chat to define your project'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {!planComplete ? (
              <div className="text-center text-gray-500 text-sm py-8">
                <p>Discuss your project with AI</p>
                <p className="text-xs mt-2">Then generate a structured plan</p>
              </div>
            ) : (
              <>
                {/* Title */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">Project Title</label>
                  <input
                    type="text"
                    value={projectPlan.title}
                    onChange={(e) => setProjectPlan({ ...projectPlan, title: e.target.value })}
                    className="input text-sm w-full"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">Description</label>
                  <textarea
                    value={projectPlan.description}
                    onChange={(e) => setProjectPlan({ ...projectPlan, description: e.target.value })}
                    className="input text-sm w-full min-h-[80px]"
                  />
                </div>

                {/* Goals */}
                {projectPlan.goals.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">Goals</label>
                    <div className="space-y-2">
                      {projectPlan.goals.map((goal, i) => (
                        <div key={i} className="glass rounded-lg p-2 text-sm">
                          {goal}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Phases */}
                {projectPlan.phases.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">Phases</label>
                    <div className="space-y-2">
                      {projectPlan.phases.map((phase, i) => (
                        <div key={i} className="glass rounded-lg p-3">
                          <div className="font-medium text-sm mb-1">{phase.name}</div>
                          <div className="text-xs text-gray-400">{phase.description}</div>
                          {phase.estimatedDays && (
                            <div className="text-xs text-accent mt-1">~{phase.estimatedDays} days</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Initial Tasks */}
                {projectPlan.initialTasks.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
                      Initial Tasks ({projectPlan.initialTasks.length})
                    </label>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {projectPlan.initialTasks.map((task, i) => (
                        <div key={i} className="glass rounded-lg p-2">
                          <div className="text-sm font-medium">{task.title}</div>
                          {task.description && (
                            <div className="text-xs text-gray-400 mt-1">{task.description}</div>
                          )}
                          <div className="flex gap-2 mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              task.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                              task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-blue-500/20 text-blue-400'
                            }`}>
                              {task.priority}
                            </span>
                            {task.estimatedMinutes && (
                              <span className="text-xs text-gray-400">~{task.estimatedMinutes}min</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tech Stack */}
                {projectPlan.techStack.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">Tech Stack</label>
                    <div className="flex flex-wrap gap-2">
                      {projectPlan.techStack.map((tech, i) => (
                        <span key={i} className="px-2 py-1 rounded-full text-xs glass">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Estimated Duration */}
                {projectPlan.estimatedDuration && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">Estimated Duration</label>
                    <div className="glass rounded-lg p-2 text-sm">
                      {projectPlan.estimatedDuration}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {planComplete && (
            <div className="p-6 border-t border-white/10 space-y-3">
              <button
                onClick={handlePromoteToProject}
                disabled={loading || !projectPlan.title}
                className="btn-primary w-full disabled:opacity-50"
              >
                🚀 Promote to Project
              </button>
              <button
                onClick={() => setPlanComplete(false)}
                className="glass w-full px-4 py-2 rounded-lg hover:bg-white/5 transition-all text-sm"
              >
                ← Revise Plan
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
