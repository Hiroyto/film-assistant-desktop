// Routing de workflow (outline vs corkboard), regras compartilhadas com a web
// desde 2026-10-18 (Ben: "nothing defaults to outline"): o campo do work record
// manda; a tag em localStorage cobre um backend que perdeu o campo; sem nada,
// corkboard. O desktop protege o SQLite desse default por fora — storySave só
// empurra `workflow` por evidência (coluna ou tag, taggedStoryWorkflow) e
// worksFromLocal sempre devolve o campo explícito — porque a coluna local guarda
// só o positivo e uma story de outline sem o campo viraria corkboard.
import { markStoryWorkflow, resolveStoryWorkflow, taggedStoryWorkflow } from './storyWorkflows';

beforeEach(() => localStorage.clear());

describe('resolveStoryWorkflow', () => {
  it('sem tag e sem campo no record → corkboard (o default da web)', () => {
    expect(resolveStoryWorkflow(undefined, 's1')).toBe('freeform');
    expect(resolveStoryWorkflow({}, 's1')).toBe('freeform');
  });

  it('o campo do record manda, nos dois sentidos', () => {
    expect(resolveStoryWorkflow({ workflow: 'freeform' }, 's1')).toBe('freeform');
    expect(resolveStoryWorkflow({ workflow: 'outline' }, 's1')).toBe('outline');
    markStoryWorkflow('s1', 'freeform');
    expect(resolveStoryWorkflow({ workflow: 'outline' }, 's1')).toBe('outline');
  });

  it('a tag local só fala quando o record não tem o campo', () => {
    markStoryWorkflow('s1', 'outline');
    expect(resolveStoryWorkflow({}, 's1')).toBe('outline');
    expect(resolveStoryWorkflow(undefined, 's1')).toBe('outline');
    markStoryWorkflow('s2', 'freeform');
    expect(resolveStoryWorkflow({}, 's2')).toBe('freeform');
  });

  it('a tag é por story', () => {
    markStoryWorkflow('s1', 'outline');
    expect(resolveStoryWorkflow({}, 's2')).toBe('freeform');
  });
});

describe('taggedStoryWorkflow (desktop)', () => {
  it('devolve só o que este device gravou — sem default', () => {
    expect(taggedStoryWorkflow('s1')).toBeUndefined();
    markStoryWorkflow('s1', 'freeform');
    expect(taggedStoryWorkflow('s1')).toBe('freeform');
    expect(taggedStoryWorkflow('s2')).toBeUndefined();
  });
});
