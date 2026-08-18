// fdxToEntities — mapeia as cenas de um .fdx para o MODELO REAL do corkboard
// (ProjectEntity de lib/freeformApi), reusável pelos renderers de card do
// Freeform. Cada cena -> um Event (beat); cada slugline distinto -> um Location.
// Read-only: não persiste nem toca na máquina de estado do corkboard.
import type { ProjectEntity } from './freeformApi';
import type { CardSignal } from '../components/Freeform/corkboard/signals';

export interface FdxCardVM {
  entity: ProjectEntity;
  signal: CardSignal;
}
export interface FdxModel {
  events: FdxCardVM[];
  locations: FdxCardVM[];
  characters: FdxCardVM[];
}

const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Quebra "INT. COFFEE SHOP - DAY" em { intExt, location, time }. */
export function parseSlugline(heading: string): { intExt: string; location: string; time?: string } {
  const h = heading.trim();
  const m = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E|INT\.?|EXT\.?)\s+(.*)$/i.exec(h);
  let intExt = 'UNKNOWN';
  let rest = h;
  if (m) {
    const p = m[1].toUpperCase().replace(/\./g, '');
    intExt = /INT\/EXT|EXT\/INT|I\/E/.test(p) ? 'INT/EXT' : p === 'INT' ? 'INT' : p === 'EXT' ? 'EXT' : 'UNKNOWN';
    rest = m[2];
  }
  let location = rest;
  let time: string | undefined;
  const parts = rest.split(/\s+[-–—]\s+/);
  if (parts.length > 1) {
    time = parts[parts.length - 1].trim();
    location = parts.slice(0, -1).join(' - ').trim();
  }
  return { intExt, location: location || rest, time };
}

/** FdxPayload -> entidades do corkboard (events + locations + characters, com
 *  sinais). Characters vêm dos cues de Character do roteiro; INVOLVES por cena. */
export function fdxToEntities(payload: FdxPayload): FdxModel {
  const events: FdxCardVM[] = [];
  const locMap = new Map<string, { entity: ProjectEntity; titles: string[] }>();
  const charMap = new Map<string, { entity: ProjectEntity; appearsIn: Array<{ id: string; title: string }> }>();

  for (const s of payload.scenes) {
    const { intExt, location, time } = parseSlugline(s.heading);
    const eventId = `fdx-ev-${s.number}-${slugify(s.heading)}`;
    const locId = location ? `fdx-loc-${slugify(location)}` : '';
    const chars = s.characters || [];

    const eventEntity: ProjectEntity = {
      id: eventId,
      // Prefixa o nº da cena: duas cenas com o MESMO slugline (ex.: a cena volta
      // ao mesmo lugar) são beats distintos, mas o backend deduplica createCard
      // por nome — sem o nº elas colidiriam num único card.
      type: 'event',
      working_title: `${s.number}. ${s.heading}`,
      summary: s.snippet || '',
      narrative_status: 'on_screen',
      sub_events: [{ slugline: s.heading, description: s.snippet || '' }],
      occurs_in: locId ? [locId] : [],
    } as ProjectEntity;

    events.push({
      entity: eventEntity,
      signal: {
        subEventCount: 1,
        occursInLocNames: location ? [location] : [],
        involvesCharNames: chars,
      },
    });

    if (locId) {
      if (!locMap.has(locId)) {
        locMap.set(locId, {
          entity: {
            id: locId,
            type: 'location',
            working_name: location,
            int_ext: intExt,
            description: time ? `Aparece em cena — ${time}` : undefined,
          } as ProjectEntity,
          titles: [],
        });
      }
      locMap.get(locId)!.titles.push(s.heading);
    }

    for (const name of chars) {
      const charId = `fdx-char-${slugify(name)}`;
      if (!charMap.has(charId)) {
        charMap.set(charId, {
          entity: { id: charId, type: 'character', working_name: name } as ProjectEntity,
          appearsIn: [],
        });
      }
      charMap.get(charId)!.appearsIn.push({ id: eventId, title: s.heading });
    }
  }

  const locations: FdxCardVM[] = [...locMap.values()].map((l) => ({
    entity: l.entity,
    signal: { appearsInEventTitles: l.titles },
  }));

  const characters: FdxCardVM[] = [...charMap.values()].map((c) => ({
    entity: c.entity,
    signal: { eventCount: c.appearsIn.length, appearsInEvents: c.appearsIn },
  }));

  return { events, locations, characters };
}
