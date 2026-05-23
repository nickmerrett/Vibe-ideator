import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShareToggle from '../ShareToggle.jsx';

vi.mock('../../services/api.js', () => ({
  api: {
    toggleSharing: vi.fn(),
    getIdeaComments: vi.fn(),
    replyToComment: vi.fn(),
    deleteComment: vi.fn(),
  },
}));

const { api } = await import('../../services/api.js');

const IDEA_OFF = {
  id: 'idea-1',
  sharing_enabled: 0,
  share_token: null,
  unread_comment_count: 0,
};

const IDEA_ON = {
  id: 'idea-1',
  sharing_enabled: 1,
  share_token: 'abc123',
  unread_comment_count: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Stub clipboard and location
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  Object.defineProperty(window, 'location', {
    value: { origin: 'https://viberater.nmerrett.net' },
    writable: true,
  });
});

describe('ShareToggle — sharing off', () => {
  it('renders the Share this idea button', () => {
    render(<ShareToggle idea={IDEA_OFF} onUpdate={vi.fn()} />);
    expect(screen.getByText(/share this idea/i)).toBeInTheDocument();
  });

  it('does not show a copy link button when sharing is off', () => {
    render(<ShareToggle idea={IDEA_OFF} onUpdate={vi.fn()} />);
    expect(screen.queryByText(/copy link/i)).not.toBeInTheDocument();
  });

  it('does not show the Comments button when sharing is off', () => {
    render(<ShareToggle idea={IDEA_OFF} onUpdate={vi.fn()} />);
    expect(screen.queryByText(/comments/i)).not.toBeInTheDocument();
  });

  it('calls toggleSharing with enabled=true when clicked', async () => {
    api.toggleSharing.mockResolvedValue({ sharing_enabled: true, share_token: 'newtoken' });
    const onUpdate = vi.fn();
    render(<ShareToggle idea={IDEA_OFF} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText(/share this idea/i));

    await waitFor(() => {
      expect(api.toggleSharing).toHaveBeenCalledWith('idea-1', true);
      expect(onUpdate).toHaveBeenCalled();
    });
  });
});

describe('ShareToggle — sharing on', () => {
  it('shows "Sharing on" label', () => {
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);
    expect(screen.getByText(/sharing on/i)).toBeInTheDocument();
  });

  it('shows the share URL', () => {
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('shows the Copy link button', () => {
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);
    expect(screen.getByText(/copy link/i)).toBeInTheDocument();
  });

  it('writes the share URL to clipboard when Copy link is clicked', async () => {
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByText(/copy link/i));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://viberater.nmerrett.net/share/abc123'
    );
  });

  it('shows "Copied" feedback after clicking Copy link', async () => {
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByText(/copy link/i));
    expect(screen.getByText(/copied/i)).toBeInTheDocument();
  });

  it('shows the Comments button', () => {
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);
    expect(screen.getByText(/comments/i)).toBeInTheDocument();
  });

  it('calls toggleSharing with enabled=false when Sharing on is clicked', async () => {
    api.toggleSharing.mockResolvedValue({ sharing_enabled: false, share_token: null });
    const onUpdate = vi.fn();
    render(<ShareToggle idea={IDEA_ON} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText(/sharing on/i));

    await waitFor(() => {
      expect(api.toggleSharing).toHaveBeenCalledWith('idea-1', false);
    });
  });

  it('shows unread badge when unread_comment_count > 0', () => {
    render(<ShareToggle idea={{ ...IDEA_ON, unread_comment_count: 3 }} onUpdate={vi.fn()} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('ShareToggle — comments panel', () => {
  it('loads and displays comments when Comments is clicked', async () => {
    api.getIdeaComments.mockResolvedValue({
      comments: [{ id: 'c1', author_name: 'Alice', content: 'Great!', is_author_reply: false }],
    });
    const onUpdate = vi.fn();
    render(<ShareToggle idea={IDEA_ON} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText(/💬 Comments/));

    await waitFor(() => {
      expect(screen.getByText('Great!')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('shows "No comments yet" when there are no comments', async () => {
    api.getIdeaComments.mockResolvedValue({ comments: [] });
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);

    fireEvent.click(screen.getByText(/💬 Comments/));

    await waitFor(() => {
      expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
    });
  });

  it('submits a reply and appends it to the list', async () => {
    api.getIdeaComments.mockResolvedValue({ comments: [] });
    api.replyToComment.mockResolvedValue({
      comment: { id: 'c2', author_name: 'Author', content: 'Thanks!', is_author_reply: true },
    });
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);

    fireEvent.click(screen.getByText(/💬 Comments/));
    await waitFor(() => screen.getByPlaceholderText('Reply…'));

    fireEvent.change(screen.getByPlaceholderText('Reply…'), { target: { value: 'Thanks!' } });
    fireEvent.click(screen.getByText('Reply'));

    await waitFor(() => {
      expect(api.replyToComment).toHaveBeenCalledWith('idea-1', 'Thanks!');
      expect(screen.getByText('Thanks!')).toBeInTheDocument();
    });
  });

  it('deletes a comment when ✕ is clicked', async () => {
    api.getIdeaComments.mockResolvedValue({
      comments: [{ id: 'c1', author_name: 'Alice', content: 'Delete me', is_author_reply: false }],
    });
    api.deleteComment.mockResolvedValue({});
    render(<ShareToggle idea={IDEA_ON} onUpdate={vi.fn()} />);

    fireEvent.click(screen.getByText(/💬 Comments/));
    await waitFor(() => screen.getByText('Delete me'));

    fireEvent.click(screen.getByText('✕'));

    await waitFor(() => {
      expect(api.deleteComment).toHaveBeenCalledWith('idea-1', 'c1');
      expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
    });
  });
});
