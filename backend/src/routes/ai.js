import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { aiService } from '../services/aiService.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Chat endpoint for idea refinement
router.post('/chat', async (req, res) => {
  try {
    const { messages, provider, model, systemPrompt } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Validate message format
    for (const msg of messages) {
      if (!msg.role || !msg.content) {
        return res.status(400).json({ error: 'Each message must have role and content' });
      }
      if (!['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({ error: 'Message role must be user or assistant' });
      }
    }

    const response = await aiService.chat(messages, {
      provider,
      model,
      systemPrompt
    });

    // Try to parse JSON response (strip markdown code fences if present)
    let parsedContent;
    try {
      let jsonText = response.content.trim();

      console.log('[AI Chat] Raw response:', jsonText.substring(0, 200));

      // Try multiple strategies to extract JSON
      // 1. Remove markdown code fences (json, JSON, or no language specified)
      jsonText = jsonText.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();

      // 2. Try to extract JSON object if it's wrapped in text
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }

      console.log('[AI Chat] After extraction, first 200 chars:', jsonText.substring(0, 200));

      // 3. CRITICAL FIX: The AI returns JSON with literal newlines in strings
      // We need to escape them properly before parsing
      // This regex finds string values and escapes newlines within them
      jsonText = jsonText.replace(/"message"\s*:\s*"([\s\S]*?)"/g, (match, content) => {
        // Escape newlines, tabs, and other control characters in the message content
        const escaped = content
          .replace(/\\/g, '\\\\')  // Escape backslashes first
          .replace(/\n/g, '\\n')   // Escape newlines
          .replace(/\r/g, '\\r')   // Escape carriage returns
          .replace(/\t/g, '\\t');  // Escape tabs
        return `"message":"${escaped}"`;
      });

      console.log('[AI Chat] After newline fix, first 200 chars:', jsonText.substring(0, 200));

      parsedContent = JSON.parse(jsonText);

      // Validate that we have required fields
      if (!parsedContent.message) {
        console.warn('[AI Chat] No message field in parsed JSON');
        throw new Error('Invalid JSON structure - missing message field');
      }

      console.log('[AI Chat] Successfully parsed with message:', parsedContent.message.substring(0, 100));
    } catch (e) {
      console.error('[AI Chat] JSON parse error:', e.message);
      console.error('[AI Chat] Failed content:', response.content.substring(0, 500));

      // AI responded with plain text or invalid JSON - use raw content as message
      parsedContent = {
        message: response.content,
        questions: []
      };
    }

    res.json({
      message: parsedContent.message || response.content,
      questions: parsedContent.questions || [],
      phase: parsedContent.phase || 'purpose',
      progress: parsedContent.progress || {},
      isComplete: parsedContent.isComplete || false,
      provider: response.provider,
      model: response.model,
      usage: response.usage
    });
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ error: error.message || 'AI chat failed' });
  }
});

// Plan generation — returns raw AI text without structured-JSON parsing
router.post('/generate-plan', async (req, res) => {
  try {
    const { messages, provider, model } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages required' });
    }
    const response = await aiService.chat(messages, {
      provider,
      model,
      systemPrompt: 'You are a project planning assistant. Respond ONLY with a raw JSON object. No markdown, no code fences, no explanation. Just the JSON.'
    });
    res.json({ content: response.content, provider: response.provider, model: response.model });
  } catch (error) {
    console.error('Generate plan error:', error);
    res.status(500).json({ error: error.message || 'Plan generation failed' });
  }
});

// Scaffold endpoint (stub for Phase 2)
router.post('/scaffold', async (req, res) => {
  try {
    res.status(501).json({
      error: 'AI scaffolding not implemented yet',
      message: 'This feature will be available in Phase 2'
    });
  } catch (error) {
    console.error('AI scaffold error:', error);
    res.status(500).json({ error: 'AI scaffolding failed' });
  }
});

// Suggest tasks endpoint (stub for Phase 2)
router.post('/suggest-tasks', async (req, res) => {
  try {
    res.status(501).json({
      error: 'AI task suggestions not implemented yet',
      message: 'This feature will be available in Phase 2'
    });
  } catch (error) {
    console.error('AI suggest tasks error:', error);
    res.status(500).json({ error: 'AI task suggestion failed' });
  }
});

// Debug endpoint (stub for Phase 2)
router.post('/debug', async (req, res) => {
  try {
    res.status(501).json({
      error: 'AI debugging not implemented yet',
      message: 'This feature will be available in Phase 2'
    });
  } catch (error) {
    console.error('AI debug error:', error);
    res.status(500).json({ error: 'AI debugging failed' });
  }
});

// Transcribe audio and extract idea details
router.post('/transcribe', async (req, res) => {
  try {
    const { audio, mimeType } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    console.log('[Transcribe] Received audio, size:', audio.length);

    // Call Claude with audio
    const response = await aiService.transcribeAudio(audio, mimeType);

    console.log('[Transcribe] Response:', response);

    res.json(response);
  } catch (error) {
    console.error('Transcribe error:', error);
    res.status(500).json({ error: error.message || 'Failed to transcribe audio' });
  }
});

// Get available providers
router.get('/providers', async (req, res) => {
  try {
    const providers = aiService.getAvailableProviders();
    res.json({ providers });
  } catch (error) {
    console.error('Get providers error:', error);
    res.status(500).json({ error: 'Failed to get providers' });
  }
});

// Start idea refinement conversation
router.post('/refine-idea', async (req, res) => {
  try {
    const { idea, provider, model } = req.body;

    if (!idea) {
      return res.status(400).json({ error: 'Idea is required' });
    }

    const initialPrompt = aiService.getIdeaRefinementPrompt(idea);
    const messages = [{ role: 'user', content: initialPrompt }];

    const response = await aiService.chat(messages, { provider, model });

    // Try to parse JSON response (strip markdown code fences if present)
    let parsedContent;
    try {
      let jsonText = response.content.trim();

      // Try multiple strategies to extract JSON
      // 1. Remove markdown code fences (json, JSON, or no language specified)
      jsonText = jsonText.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?\s*```$/, '');

      // 2. If still not valid, try to find JSON object in the text
      if (!jsonText.startsWith('{')) {
        const match = jsonText.match(/\{[\s\S]*\}/);
        if (match) {
          jsonText = match[0];
        }
      }

      parsedContent = JSON.parse(jsonText);
    } catch (e) {
      // AI responded with plain text (expected for conversational mode)
      parsedContent = {
        message: response.content,
        questions: []
      };
    }

    res.json({
      message: parsedContent.message,
      questions: parsedContent.questions || [],
      phase: parsedContent.phase || 'purpose',
      progress: parsedContent.progress || {},
      isComplete: parsedContent.isComplete || false,
      provider: response.provider,
      model: response.model,
      conversation: [
        { role: 'user', content: initialPrompt },
        { role: 'assistant', content: parsedContent.message }
      ]
    });
  } catch (error) {
    console.error('Refine idea error:', error);
    res.status(500).json({ error: error.message || 'Failed to refine idea' });
  }
});

export default router;
