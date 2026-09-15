// Routing de workflow (outline vs corkboard). O caso que importa: um work record
// que diz `outline` para uma story que ESTE device marcou como freeform. Isso é
// campo perdido, não conversão — o desktop nunca mandou `workflow` no save
// local-first, então o record da nuvem responde por um campo que nunca recebeu.
// Obedecer o record abre o editor de outline (template vazio) por cima de um
// corkboard cheio, e o board fica inalcançável pela grade.
import { markStoryWorkflow, resolveStoryWorkflow } from './storyWorkflows';

beforeEach(() => localStorage.clear());

describe('resolveStoryWorkflow', () => {
  it('sem tag e sem campo no record → outline (default)', () => {
    expect(resolveStoryWorkflow(undefined, 's1')).toBe('outline');
    expect(resolveStoryWorkflow({}, 's1')).toBe('outline');
  });

  it('campo do record manda quando não há tag local', () => {
    expect(resolveStoryWorkflow({ workflow: 'freeform' }, 's1')).toBe('freeform');
    expect(resolveStoryWorkflow({ workflow: 'outline' }, 's1')).toBe('outline');
  });

  it('tag local freeform cobre um record sem o campo', () => {
    markStoryWorkflow('s1', 'freeform');
    expect(resolveStoryWorkflow({}, 's1')).toBe('freeform');
  });

  it('tag local freeform VENCE um record que diz outline (campo perdido)', () => {
    markStoryWorkflow('s1', 'freeform');
    expect(resolveStoryWorkflow({ workflow: 'outline' }, 's1')).toBe('freeform');
  });

  it('a tag é por story: outra story não é arrastada para freeform', () => {
    markStoryWorkflow('s1', 'freeform');
    expect(resolveStoryWorkflow({ workflow: 'outline' }, 's2')).toBe('outline');
    expect(resolveStoryWorkflow(undefined, 's2')).toBe('outline');
  });

  it('marcar outline não vira freeform em lugar nenhum', () => {
    markStoryWorkflow('s1', 'outline');
    expect(resolveStoryWorkflow({}, 's1')).toBe('outline');
  });
});
