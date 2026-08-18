// fdxImport — importa as cenas de um .fdx como CARDS REAIS da história (opção C).
// Eventos (encadeados por PRECEDES = ordem do roteiro) + Locais (dedup por
// slugline, ligados por OCCURS_IN). Usa a MESMA API do corkboard (createCard),
// que deduplica server-side por nome (409 -> { exists }). Idempotente: re-rodar
// só cria as cenas novas. Escreve no backend da história.
import { createCard, tagEventOccursIn, tagEventInvolvesCharacter, type ProjectEntity } from './freeformApi';
import { fdxToEntities } from './fdxToEntities';
import { computeAutoLayout } from '../components/Freeform/corkboard/connectors';

export interface FdxImportCtx {
  projectId: string;
  userId: string;
  token: string;
  onProgress?: (msg: string) => void;
}

/** Card recém-criado + a posição usada — para insert otimista no board. */
export interface FdxCreated {
  entity: ProjectEntity;
  pos: { x: number; y: number };
}

export interface FdxImportResult {
  eventsCreated: number;
  eventsExisting: number;
  locationsCreated: number;
  locationsExisting: number;
  charactersCreated: number;
  charactersExisting: number;
  linked: number;
  errors: string[];
  /** Entidades efetivamente criadas (para o board mostrar antes do refresh). */
  created: FdxCreated[];
}

export async function importFdxIntoStory(payload: FdxPayload, ctx: FdxImportCtx): Promise<FdxImportResult> {
  const res: FdxImportResult = {
    eventsCreated: 0, eventsExisting: 0, locationsCreated: 0, locationsExisting: 0,
    charactersCreated: 0, charactersExisting: 0, linked: 0, errors: [], created: [],
  };
  if (!payload.ok) {
    res.errors.push(payload.error || 'arquivo .fdx inválido');
    return res;
  }

  const model = fdxToEntities(payload);
  // Posições via o layout REAL do corkboard (spine de eventos por ordem de cena).
  const precedes = model.events.slice(1).map((e, i) => ({ from: model.events[i].entity.id, to: e.entity.id }));
  let auto: Record<string, { x: number; y: number }> = {};
  try {
    auto = computeAutoLayout(
      [...model.events.map((v) => v.entity), ...model.locations.map((v) => v.entity), ...model.characters.map((v) => v.entity)],
      precedes,
    ) || {};
  } catch {
    auto = {};
  }
  const posOf = (id: string, i: number): { x: number; y: number } =>
    auto[id] ?? { x: 60 + (i % 6) * 240, y: 60 + Math.floor(i / 6) * 170 };

  // 0) Personagens primeiro (para os eventos poderem linkar INVOLVES).
  const charRealByName = new Map<string, string>(); // nome -> cardId real
  let ci = 0;
  for (const vm of model.characters) {
    const name = vm.entity.working_name || '';
    if (!name) continue;
    const pos = posOf(vm.entity.id, ci);
    try {
      const r = await createCard(
        { kind: 'character', projectId: ctx.projectId, userId: ctx.userId, workingName: name, position: pos },
        ctx.token,
      );
      if ('exists' in r) { res.charactersExisting++; charRealByName.set(name, r.cardId); }
      else { res.charactersCreated++; charRealByName.set(name, r.entity.id); res.created.push({ entity: r.entity, pos }); }
    } catch (e) {
      res.errors.push(`personagem "${name}": ${(e as Error).message}`);
    }
    ci++;
    ctx.onProgress?.(`personagens ${ci}/${model.characters.length}`);
  }

  // 1) Locais (para os eventos poderem linkar OCCURS_IN).
  const locRealId = new Map<string, string>(); // fdx-loc-id -> cardId real
  let li = 0;
  for (const vm of model.locations) {
    const name = vm.entity.working_name || '';
    if (!name) continue;
    const intExt = vm.entity.int_ext === 'INT' ? 'INT' : vm.entity.int_ext === 'EXT' ? 'EXT' : undefined;
    const pos = posOf(vm.entity.id, model.characters.length + li);
    try {
      const r = await createCard(
        { kind: 'location', projectId: ctx.projectId, userId: ctx.userId, workingName: name, intExt, position: pos },
        ctx.token,
      );
      if ('exists' in r) { res.locationsExisting++; locRealId.set(vm.entity.id, r.cardId); }
      else { res.locationsCreated++; locRealId.set(vm.entity.id, r.entity.id); res.created.push({ entity: r.entity, pos }); }
    } catch (e) {
      res.errors.push(`local "${name}": ${(e as Error).message}`);
    }
    li++;
    ctx.onProgress?.(`locais ${li}/${model.locations.length}`);
  }

  // 2) Eventos, encadeados por PRECEDES; liga OCCURS_IN para o local da cena.
  let prevEventId: string | undefined;
  let ei = 0;
  for (const vm of model.events) {
    const heading = vm.entity.working_title || '';
    if (!heading) { ei++; continue; }
    let eventRealId: string | undefined;
    const pos = posOf(vm.entity.id, model.characters.length + model.locations.length + ei);
    try {
      const r = await createCard(
        {
          kind: 'event',
          projectId: ctx.projectId,
          userId: ctx.userId,
          workingName: heading,
          description: vm.entity.summary || undefined,
          position: pos,
          precededByEventId: prevEventId,
        },
        ctx.token,
      );
      if ('exists' in r) { res.eventsExisting++; eventRealId = r.cardId; }
      else { res.eventsCreated++; eventRealId = r.entity.id; res.created.push({ entity: r.entity, pos }); }
    } catch (e) {
      res.errors.push(`cena "${heading}": ${(e as Error).message}`);
    }
    ei++;
    prevEventId = eventRealId ?? prevEventId;

    // OCCURS_IN (best-effort)
    const occId = (vm.entity as { occurs_in?: string[] }).occurs_in?.[0];
    if (eventRealId && occId && locRealId.has(occId)) {
      try {
        await tagEventOccursIn({ projectId: ctx.projectId, eventId: eventRealId, locationId: locRealId.get(occId)! }, ctx.token);
        res.linked++;
      } catch {
        /* best-effort: a ligação não é crítica para o import */
      }
    }

    // INVOLVES: liga a cena aos personagens que falam nela (best-effort).
    if (eventRealId) {
      for (const name of vm.signal.involvesCharNames || []) {
        const charId = charRealByName.get(name);
        if (!charId) continue;
        try {
          await tagEventInvolvesCharacter({ projectId: ctx.projectId, eventId: eventRealId, characterId: charId }, ctx.token);
          res.linked++;
        } catch {
          /* best-effort */
        }
      }
    }
    ctx.onProgress?.(`cenas ${ei}/${model.events.length}`);
  }

  return res;
}
