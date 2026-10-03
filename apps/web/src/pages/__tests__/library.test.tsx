import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/utils';
import { LibraryPage } from '../LibraryPage';
import { LIBRARY_STORAGE_KEY, saveToLibrary, type LibraryItem } from '../../lib/library';

/**
 * The library page.
 *
 * The store is seeded straight into `localStorage` before the first render, so
 * these tests are about the page's filters and its two different empty states -
 * "you have nothing yet" and "nothing matches", which are not the same sentence.
 */

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    jobId: 'job_1',
    projectId: 'proj_1',
    title: 'POV: binary search finally clicks',
    caption: 'Three days, one bug, zero progress.',
    hashtags: ['#dsa', '#careerswitch'],
    state: 'completed',
    stage: 'completed',
    progress: 100,
    updatedAt: '2026-10-01T10:00:00.000Z',
    source: 'render',
    ...overrides,
  };
}

function seed(items: LibraryItem[]): void {
  localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(items));
}

function renderPage() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/library']}>
      <Routes>
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/render/:jobId" element={<p>progress screen</p>} />
        <Route path="/render/:jobId/result" element={<p>result screen</p>} />
      </Routes>
    </MemoryRouter>,
    { withRouter: false },
  );
}

describe('LibraryPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lists every render, newest first', () => {
    seed([
      item({ jobId: 'job_old', title: 'Older one', updatedAt: '2026-09-01T10:00:00.000Z' }),
      item({ jobId: 'job_new', title: 'Newer one', updatedAt: '2026-10-02T10:00:00.000Z' }),
    ]);

    renderPage();

    const titles = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);
    expect(titles).toEqual(['Newer one', 'Older one']);
  });

  it('counts each state on its filter chip', () => {
    seed([
      item({ jobId: 'job_1', state: 'completed' }),
      item({ jobId: 'job_2', state: 'failed', title: 'Failed one' }),
      item({ jobId: 'job_3', state: 'running', title: 'Running one' }),
    ]);

    renderPage();

    // "All" counts every render; the rest only their own.
    expect(screen.getByRole('button', { name: /^All/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /^Ready/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /^Needs a retry/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /^In progress/ })).toHaveTextContent('1');
  });

  it('filters to one state when a chip is pressed', () => {
    seed([
      item({ jobId: 'job_1', state: 'completed' }),
      item({ jobId: 'job_2', state: 'failed', title: 'Failed one' }),
    ]);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^Needs a retry/ }));

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByText('Failed one')).toBeInTheDocument();
    expect(screen.queryByText('POV: binary search finally clicks')).toBeNull();
  });

  it('searches titles, captions and hashtags', () => {
    seed([
      item({ jobId: 'job_1' }),
      item({ jobId: 'job_2', title: 'Recursion drill', caption: 'Stack frames', hashtags: ['#recursion'] }),
    ]);

    renderPage();

    const search = screen.getByLabelText<HTMLInputElement>('Search your library');

    // Caption text on the first item.
    fireEvent.change(search, { target: { value: 'one bug' } });
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);

    // Hashtag on the second item.
    fireEvent.change(search, { target: { value: '#recursion' } });
    expect(screen.getByText('Recursion drill')).toBeInTheDocument();
    expect(screen.queryByText('POV: binary search finally clicks')).toBeNull();
  });

  it('says the library is empty when there is nothing in it', () => {
    renderPage();

    expect(screen.getByText('Your library is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Audience Mirror' })).toBeInTheDocument();
  });

  it('says nothing matches when a search comes back empty', () => {
    seed([item()]);

    renderPage();

    fireEvent.change(screen.getByLabelText('Search your library'), {
      target: { value: 'kubernetes' },
    });

    expect(screen.getByText('Nothing matches those filters')).toBeInTheDocument();
    // The fix is offered, not just the bad news.
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('clears the search and the state filter together', () => {
    seed([item({ jobId: 'job_1' }), item({ jobId: 'job_2', title: 'Other one', state: 'failed' })]);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /^Needs a retry/ }));
    const search = screen.getByLabelText<HTMLInputElement>('Search your library');
    fireEvent.change(search, { target: { value: 'nothing here' } });

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    expect(screen.getByLabelText('Search your library')).toHaveValue('');
  });

  it('links a finished render to its result and a running one to its progress', () => {
    seed([item({ jobId: 'job_done' }), item({ jobId: 'job_live', title: 'Still going', state: 'running' })]);

    renderPage();

    expect(screen.getByRole('link', { name: 'POV: binary search finally clicks' })).toHaveAttribute(
      'href',
      '/render/job_done/result',
    );
    expect(screen.getByRole('link', { name: 'Still going' })).toHaveAttribute(
      'href',
      '/render/job_live',
    );
  });

  it('removes a render from the list', () => {
    seed([item({ jobId: 'job_1' }), item({ jobId: 'job_2', title: 'Second one' })]);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove POV: binary search finally clicks' }));

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(LIBRARY_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  it('is honest that the store lives in this browser', () => {
    renderPage();
    expect(screen.getByText(/stored in this browser until the API exposes/)).toBeInTheDocument();
  });
});

describe('the library store, through the hook', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is readable from the page after a direct write', () => {
    saveToLibrary(item({ jobId: 'job_1', title: 'Written straight to storage' }), localStorage);
    renderPage();
    expect(screen.getByText('Written straight to storage')).toBeInTheDocument();
  });
});
