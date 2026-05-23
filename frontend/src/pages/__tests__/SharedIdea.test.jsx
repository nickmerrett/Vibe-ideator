import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SharedIdea from '../SharedIdea.jsx';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'test-token' }),
}));

vi.mock('../../services/api.js', () => ({
  api: {
    getSharedIdea: vi.fn(),
    reactToSharedIdea: vi.fn(),
    commentOnSharedIdea: vi.fn(),
  },
}));

vi.mock('../../utils/markdown.jsx', () => ({
  MarkdownText: ({ text }) => <span>{text}</span>,
}));

const { api } = await import('../../services/api.js');

const IDEA = {
  id: '1',
  title: 'Test Idea',
  created_at: '2026-01-01T00:00:00Z',
  summary: 'A summary',
  tags: [],
  vibe: [],
  links: [],
  riff_conversation: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getSharedIdea.mockResolvedValue({ idea: IDEA, reactions: [], comments: [] });
});

describe('SharedIdea page', () => {
  it('renders the idea title after load', async () => {
    render(<SharedIdea />);
    await waitFor(() => expect(screen.getByText('Test Idea')).toBeInTheDocument());
  });

  it('renders all three reaction buttons', async () => {
    render(<SharedIdea />);
    await waitFor(() => {
      expect(screen.getByText('👍')).toBeInTheDocument();
      expect(screen.getByText('💡')).toBeInTheDocument();
      expect(screen.getByText('🔥')).toBeInTheDocument();
    });
  });

  it('shows not found when API returns an error', async () => {
    api.getSharedIdea.mockResolvedValue({ error: 'not found' });
    render(<SharedIdea />);
    await waitFor(() => expect(screen.getByText('Idea not found')).toBeInTheDocument());
  });

  it('clicking a reaction calls the API with the right emoji', async () => {
    api.reactToSharedIdea.mockResolvedValue({ reactions: [{ reaction: '👍', count: 1 }] });
    render(<SharedIdea />);
    await waitFor(() => screen.getByText('👍'));

    fireEvent.click(screen.getByText('👍').closest('button'));

    await waitFor(() => {
      expect(api.reactToSharedIdea).toHaveBeenCalledWith('test-token', '👍');
    });
  });

  it('shows reaction counts returned from the API after clicking', async () => {
    api.reactToSharedIdea.mockResolvedValue({ reactions: [{ reaction: '🔥', count: 3 }] });
    render(<SharedIdea />);
    await waitFor(() => screen.getByText('🔥'));

    fireEvent.click(screen.getByText('🔥').closest('button'));

    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('displays existing reaction counts on load', async () => {
    api.getSharedIdea.mockResolvedValue({
      idea: IDEA,
      reactions: [{ reaction: '💡', count: 5 }],
      comments: [],
    });
    render(<SharedIdea />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
  });

  it('submits a comment and shows it in the list', async () => {
    const comment = { id: '99', author_name: 'Alice', content: 'Great idea!', created_at: '2026-01-02T00:00:00Z', is_author_reply: false };
    api.commentOnSharedIdea.mockResolvedValue({ comment });
    render(<SharedIdea />);
    await waitFor(() => screen.getByPlaceholderText('Your name'));

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText('Leave a comment…'), { target: { value: 'Great idea!' } });
    fireEvent.click(screen.getByText('Post comment'));

    await waitFor(() => expect(screen.getByText('Great idea!')).toBeInTheDocument());
  });
});
