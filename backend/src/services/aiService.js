import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

class AIService {
  constructor() {
    this.defaultProvider = process.env.DEFAULT_AI_PROVIDER || 'claude';

    // Initialize Claude
    if (process.env.CLAUDE_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.CLAUDE_API_KEY,
      });
    }

    // Initialize OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }

    // Ollama base URL
    this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  /**
   * Chat with AI for idea refinement
   * @param {Array} messages - Chat history [{ role: 'user'|'assistant', content: string }]
   * @param {Object} options - { provider, model, systemPrompt }
   */
  async chat(messages, options = {}) {
    const provider = options.provider || this.defaultProvider;

    switch (provider) {
      case 'claude':
        return this.chatClaude(messages, options);
      case 'openai':
        return this.chatOpenAI(messages, options);
      case 'ollama':
        return this.chatOllama(messages, options);
      default:
        throw new Error(`Unknown AI provider: ${provider}`);
    }
  }

  // Plain text chat — no JSON parsing, used for conversational capture
  async chatRaw(messages, options = {}) {
    const provider = options.provider || this.defaultProvider;
    const opts = { ...options, maxTokens: 512 };

    switch (provider) {
      case 'claude':
        return this.chatClaude(messages, opts);
      case 'openai':
        return this.chatOpenAI(messages, opts);
      default:
        return this.chatClaude(messages, opts);
    }
  }

  // Streaming chat — calls onToken(text) for each chunk, returns full content
  async streamRaw(messages, options = {}, onToken) {
    const provider = options.provider || this.defaultProvider;

    switch (provider) {
      case 'claude':
        return this.streamClaude(messages, options, onToken);
      case 'openai':
        return this.streamOpenAI(messages, options, onToken);
      default:
        return this.streamClaude(messages, options, onToken);
    }
  }

  async streamClaude(messages, options = {}, onToken) {
    if (!this.anthropic) throw new Error('Claude API key not configured');

    const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
    const model = options.model || process.env.MODEL_PRIMARY || 'claude-sonnet-4-5';
    let fullContent = '';

    const stream = this.anthropic.messages.stream({
      model,
      max_tokens: options.maxTokens || 512,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text;
        fullContent += text;
        onToken(text);
      }
    }

    return { content: fullContent };
  }

  async streamOpenAI(messages, options = {}, onToken) {
    if (!this.openai) throw new Error('OpenAI API key not configured');

    const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
    const model = options.model || 'gpt-4o';
    let fullContent = '';

    const stream = await this.openai.chat.completions.create({
      model,
      max_tokens: options.maxTokens || 512,
      stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        fullContent += text;
        onToken(text);
      }
    }

    return { content: fullContent };
  }

  async chatClaude(messages, options = {}) {
    if (!this.anthropic) {
      throw new Error('Claude API key not configured');
    }

    const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
    const model = options.model || process.env.MODEL_PRIMARY || 'claude-3-5-sonnet-20240620';

    try {
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: options.maxTokens || 1024,
        temperature: 0.7,
        system: systemPrompt,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      });

      return {
        content: response.content[0].text,
        provider: 'claude',
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        }
      };
    } catch (error) {
      console.error('Claude API error:', error);
      throw new Error(`Claude API error: ${error.message}`);
    }
  }

  async chatOpenAI(messages, options = {}) {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
    const model = options.model || 'gpt-4';

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: options.maxTokens || 1024,
        temperature: 0.7,
      });

      return {
        content: response.choices[0].message.content,
        provider: 'openai',
        model: response.model,
        usage: {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens
        }
      };
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }

  async chatOllama(messages, options = {}) {
    const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
    const model = options.model || 'llama2';

    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages
          ],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        content: data.message.content,
        provider: 'ollama',
        model: data.model,
        usage: {
          inputTokens: data.prompt_eval_count || 0,
          outputTokens: data.eval_count || 0
        }
      };
    } catch (error) {
      console.error('Ollama API error:', error);
      throw new Error(`Ollama API error: ${error.message}`);
    }
  }

  /**
   * Get idea refinement system prompt
   */
  getDefaultSystemPrompt() {
    return `You are an AI assistant helping developers refine their project ideas through interactive conversation.

CRITICAL GUIDELINES:
- Keep responses SHORT (2-4 sentences max)
- Ask 1-2 specific questions per response
- Be conversational and friendly, not formal
- Wait for answers before asking more questions
- Focus on one aspect at a time
- Use the Socratic method - guide them with questions rather than lecturing
- Be encouraging and enthusiastic about their ideas

RESPONSE FORMAT - CRITICAL:
You MUST respond with ONLY valid JSON and NOTHING ELSE.
Do NOT add any conversational text before or after the JSON.
Do NOT wrap the JSON in markdown code fences.
ONLY return the raw JSON object in this exact format:
{
  "message": "Your conversational response here (2-3 sentences)",
  "questions": [
    {
      "question": "What's your main use case?",
      "options": ["Option 1", "Option 2", "Option 3", "Other"]
    }
  ],
  "phase": "purpose",
  "progress": {
    "purpose": false,
    "users": false,
    "features": false,
    "implementation": false
  },
  "isComplete": false
}

IDEATION PHASES (in order):
1. **purpose** - Understand the problem and goals
2. **users** - Identify target users and use cases
3. **features** - Define key features and functionality
4. **implementation** - Discuss tech stack and approach

Rules:
- Ask 1-2 questions max per response
- Each question MUST have 3-5 clickable options
- Options should cover the likely answers
- Always include "Other" or "Something else" as last option
- Set progress[phase] = true when that phase is sufficiently covered
- Move to next phase only when current is complete
- Set isComplete = true when ALL phases are done (all true)
- Keep questions short and focused

Example response:
{
  "message": "Let's understand the core purpose first.",
  "questions": [
    {
      "question": "What problem are you solving?",
      "options": ["Save time", "Reduce costs", "Improve quality", "Other"]
    }
  ],
  "phase": "purpose",
  "progress": {
    "purpose": false,
    "users": false,
    "features": false,
    "implementation": false
  },
  "isComplete": false
}`;
  }

  /**
   * Generate idea refinement prompt
   */
  getIdeaRefinementPrompt(idea) {
    return `I want to refine this idea: "${idea.title}"

${idea.summary}

Excitement: ${idea.excitement}/10 | Complexity: ${idea.complexity}${idea.vibe && idea.vibe.length > 0 ? ` | Vibe: ${idea.vibe.join(', ')}` : ''}

Help me think this through!`;
  }

  /**
   * Transcribe audio using OpenAI Whisper and extract idea details using Claude
   */
  async transcribeAudio(base64Audio, mimeType = 'audio/webm') {
    try {
      console.log('[AI Service] Transcribing audio with Whisper...');

      // Step 1: Convert base64 to buffer
      const audioBuffer = Buffer.from(base64Audio, 'base64');

      // Step 2: Transcribe with Whisper (OpenAI)
      let transcript;
      if (this.openai) {
        // Create a File-like object for OpenAI SDK
        const audioFile = await toFile(audioBuffer, 'audio.webm', { type: mimeType });

        const response = await this.openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1'
        });

        transcript = response.text;
        console.log('[AI Service] Whisper transcript:', transcript);
      } else {
        throw new Error('OpenAI API key not configured for transcription');
      }

      // Step 3: Use Claude to extract title, summary, and tags
      if (!this.anthropic) {
        // Fallback: just return the transcript
        return {
          transcript,
          title: transcript.substring(0, 50),
          summary: transcript,
          tags: []
        };
      }

      console.log('[AI Service] Extracting idea details with Claude...');

      const response = await this.anthropic.messages.create({
        model: process.env.MODEL_PRIMARY || 'claude-3-5-sonnet-20240620',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Extract from this spoken idea: "${transcript}"

1. A short, catchy title (3-8 words)
2. A clean, grammatically correct summary
3. 3-5 relevant tags (lowercase, single words like: web, mobile, ai, backend, frontend, etc.)

Respond ONLY with valid JSON in this exact format:
{
  "title": "The extracted title",
  "summary": "The cleaned up summary",
  "tags": ["tag1", "tag2", "tag3"]
}`
        }]
      });

      const content = response.content[0].text;
      console.log('[AI Service] Claude response:', content);

      // Parse the JSON response
      let jsonText = content.trim();
      jsonText = jsonText.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonText);

      return {
        transcript,
        title: parsed.title || transcript.substring(0, 50),
        summary: parsed.summary || transcript,
        tags: parsed.tags || []
      };
    } catch (error) {
      console.error('[AI Service] Transcription error:', error);
      throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
  }

  /**
   * Get available providers
   */
  getAvailableProviders() {
    return {
      claude: {
        name: 'Claude',
        available: !!this.anthropic,
        configured: !!process.env.CLAUDE_API_KEY,
        models: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307']
      },
      openai: {
        name: 'OpenAI',
        available: !!this.openai,
        configured: !!process.env.OPENAI_API_KEY,
        models: ['gpt-4', 'gpt-4-turbo-preview', 'gpt-3.5-turbo']
      },
      ollama: {
        name: 'Ollama',
        available: true,
        configured: true,
        models: ['llama2', 'mistral', 'codellama']
      }
    };
  }

  // ── Agentic tool loop ──────────────────────────────────────────────────
  // Runs until the AI produces a final text response with no tool calls.
  // onEvent(event) is called for streaming updates:
  //   { type: 'tool_call', name, args }
  //   { type: 'tool_result', name, result }
  //   { type: 'token', text }
  //   { type: 'done', content }

  async runWithTools(messages, tools, onEvent, options = {}) {
    const provider = options.provider || this.defaultProvider;
    const { callTool } = await import('./toolService.js');

    switch (provider) {
      case 'claude':  return this._runWithToolsClaude(messages, tools, callTool, onEvent, options);
      case 'openai':  return this._runWithToolsOpenAI(messages, tools, callTool, onEvent, options);
      default:        return this._runWithToolsClaude(messages, tools, callTool, onEvent, options);
    }
  }

  async _runWithToolsClaude(messages, tools, callTool, onEvent, options) {
    if (!this.anthropic) throw new Error('Claude API key not configured');

    const model = options.model || process.env.MODEL_PRIMARY || 'claude-sonnet-4-5';
    const systemPrompt = options.systemPrompt || '';

    // Translate neutral tool format → Claude format
    const claudeTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const history = [...messages];

    while (true) {
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: options.maxTokens || 2048,
        system: systemPrompt,
        tools: claudeTools,
        messages: history,
      });

      // Collect text and tool_use blocks
      let textContent = '';
      const toolUses = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          textContent += block.text;
          // Stream tokens word-by-word (non-streaming path, best effort)
          for (const word of block.text.split(/(?<=\s)/)) {
            onEvent({ type: 'token', text: word });
          }
        } else if (block.type === 'tool_use') {
          toolUses.push(block);
        }
      }

      // No tool calls — we're done
      if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
        onEvent({ type: 'done', content: textContent });
        return textContent;
      }

      // Execute each tool call
      history.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const tu of toolUses) {
        onEvent({ type: 'tool_call', name: tu.name, args: tu.input });
        const result = await callTool(tu.name, tu.input);
        onEvent({ type: 'tool_result', name: tu.name, result });
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
      }

      history.push({ role: 'user', content: toolResults });
    }
  }

  async _runWithToolsOpenAI(messages, tools, callTool, onEvent, options) {
    if (!this.openai) throw new Error('OpenAI API key not configured');

    const model = options.model || 'gpt-4o';
    const systemPrompt = options.systemPrompt || '';

    // Translate neutral tool format → OpenAI format
    const openaiTools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const history = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages,
    ];

    while (true) {
      const response = await this.openai.chat.completions.create({
        model,
        max_tokens: options.maxTokens || 2048,
        tools: openaiTools,
        messages: history,
      });

      const msg = response.choices[0].message;
      history.push(msg);

      if (!msg.tool_calls?.length) {
        const text = msg.content || '';
        for (const word of text.split(/(?<=\s)/)) onEvent({ type: 'token', text: word });
        onEvent({ type: 'done', content: text });
        return text;
      }

      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        onEvent({ type: 'tool_call', name: tc.function.name, args });
        const result = await callTool(tc.function.name, args);
        onEvent({ type: 'tool_result', name: tc.function.name, result });
        history.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
  }
}

export const aiService = new AIService();
