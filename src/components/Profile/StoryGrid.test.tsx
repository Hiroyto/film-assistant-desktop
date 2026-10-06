// StoryGrid é a grade compartilhada pela Home e pelo Profile: os cards saem
// sempre do último update para o mais antigo, seja qual for a ordem do mapa.
import React from 'react';
import { render, screen } from '@testing-library/react';
import StoryGrid from './StoryGrid';

// StoryCard puxa @radix-ui/themes, que o Jest do CRA não resolve (exports
// `radix-ui/internal`). O card não participa da ordenação — basta expor o título.
jest.mock('./StoryCard', () => ({
  __esModule: true,
  default: (props: { title: string }) => {
    const ReactLib = require('react');
    return ReactLib.createElement('h4', null, props.title);
  },
}));

const story = (storyId: string, title: string, lastModified?: string, createdAt?: string) =>
  ({ storyId, title, G: 'Drama', SUM: 'sum', lastModified, createdAt } as any);

describe('StoryGrid (Home + Profile)', () => {
  it('renderiza os cards do último update para o mais antigo, independente da ordem do mapa', () => {
    const works = {
      s_old: story('s_old', 'Old', '2026-01-01T00:00:00.000Z'),
      s_new: story('s_new', 'New', '2026-03-01T00:00:00.000Z'),
      s_created: story('s_created', 'CreatedOnly', undefined, '2026-02-15T00:00:00.000Z'),
      s_mid: story('s_mid', 'Mid', '2026-02-01T00:00:00.000Z'),
      s_nodate: story('s_nodate', 'NoDate'),
    };

    render(<StoryGrid works={works} onNavigateStory={() => {}} onDeleteStory={() => {}} />);

    const titles = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(titles).toEqual(['New', 'CreatedOnly', 'Mid', 'Old', 'NoDate']);
  });

  it('mantém o estado vazio quando não há stories', () => {
    render(<StoryGrid works={{}} onNavigateStory={() => {}} onDeleteStory={() => {}} />);
    expect(screen.getByText('No stories available.')).toBeInTheDocument();
  });
});
