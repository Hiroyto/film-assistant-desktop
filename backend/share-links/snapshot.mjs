// GERADO por scripts/build-share-lambda.js (npm run share:lambda). NÃO EDITE.
//
// O construtor do retrato de um link compartilhado, para a Lambda de share
// (links ao vivo). É o código do app sem os tipos:
//   src/components/Freeform/corkboard/constants.tsx   (medidas do board)
//   src/components/Freeform/corkboard/connectors.tsx  (ordem contada e auto-layout)
//   src/lib/shareSnapshot.ts                            (o retrato)
// Mudou um deles? Gere de novo e publique a Lambda outra vez.
export const COLLAPSED_W = 240;
export const COLLAPSED_H = 110;
export const REL_COLLAPSED_W = 124;
export const REL_COLLAPSED_H = 26;
export const CHAR_PILL_W = 168;
export const CHAR_PILL_H = 44;
export const EVENT_CARD_W = 300;
export const COL_GAP = 120;
export const ROW_GAP = 48;
export const CANVAS_PAD = 24;
// =====================================================================
// Auto-layout — columns by type. Cards without a stored layout land here.
// =====================================================================
// Order events into story order via a stable PRECEDES topological sort, so the
// events column reads chronologically top→bottom instead of in extraction /
// arrival order (the order a streamed-in screenplay happens to land in). Ties
// and disconnected events keep their input order (Kahn, stable).
export function topoSortEventsByPrecedes(events, precedesEdges) {
    if (events.length < 2)
        return events;
    const ids = new Set(events.map((e) => e.id));
    const edges = precedesEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
    if (edges.length === 0)
        return events;
    const indeg = new Map();
    const adj = new Map();
    const orderIdx = new Map();
    events.forEach((e, i) => { indeg.set(e.id, 0); adj.set(e.id, []); orderIdx.set(e.id, i); });
    for (const edge of edges) {
        adj.get(edge.from).push(edge.to);
        indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
    }
    const byId = new Map(events.map((e) => [e.id, e]));
    const ready = events.filter((e) => (indeg.get(e.id) ?? 0) === 0).map((e) => e.id);
    ready.sort((a, b) => orderIdx.get(a) - orderIdx.get(b));
    const out = [];
    while (ready.length > 0) {
        const id = ready.shift();
        const e = byId.get(id);
        if (e)
            out.push(e);
        for (const next of adj.get(id) ?? []) {
            const remaining = (indeg.get(next) ?? 0) - 1;
            indeg.set(next, remaining);
            if (remaining === 0) {
                const target = orderIdx.get(next);
                let i = 0;
                while (i < ready.length && orderIdx.get(ready[i]) < target)
                    i++;
                ready.splice(i, 0, next);
            }
        }
    }
    // Defensive: append any cycle leftovers in input order.
    if (out.length < events.length) {
        const seen = new Set(out.map((e) => e.id));
        for (const e of events)
            if (!seen.has(e.id))
                out.push(e);
    }
    return out;
}
/**
 * TOLD ORDER over top-level story units (loose events + sequences). The board
 * spine, the SC numbers and the script navigator all read this one order, so
 * the three surfaces can never disagree.
 *
 * Two passes:
 *  1. SEAT each unit from the relation that knows where it sits — a container
 *     from its earliest member's PRECEDES rank, an empty sequence from a
 *     cross-altitude link, else from the sequence chain, else seq_order.
 *  2. TOPO SORT those seats against the union of ALL THREE precedes lists,
 *     projected onto units (a member scene's unit is its container).
 *
 * Pass 2 is why this exists (Ben 2026-08-24: the opening sequence kept getting
 * bumped to the bottom). A seat only ever consults ONE relation, so a unit
 * whose ordering lives in a relation the seat never looked at lands
 * arbitrarily: a loose scene ordered ONLY by cross links takes an
 * insertion-order event rank — dead last when it is the last event the server
 * happened to return — and every empty sequence seated against that scene
 * inherits the wrong seat. The topo pass is authoritative wherever the chain
 * has an opinion; the seats are the tie-break where it has none.
 */
export function orderSpineUnits(entities, precedesEdges, containsEdges = [], sequencePrecedesEdges = [], crossPrecedesEdges = []) {
    const byId = new Map(entities.map((e) => [e.id, e]));
    const events = entities.filter((e) => e.type === 'event');
    const seqs = entities.filter((e) => e.type === 'sequence');
    // CONTAINS both ways: a sequence's member ids, and a member's container.
    const membersBySeq = new Map();
    const containerOf = new Map();
    for (const c of containsEdges) {
        if (!byId.has(c.from) || !byId.has(c.to))
            continue;
        const arr = membersBySeq.get(c.from);
        if (arr)
            arr.push(c.to);
        else
            membersBySeq.set(c.from, [c.to]);
        containerOf.set(c.to, c.from);
    }
    // --- Pass 1: seats -------------------------------------------------------
    const globalOrder = topoSortEventsByPrecedes(events, precedesEdges);
    const rankOf = new Map();
    globalOrder.forEach((e, i) => rankOf.set(e.id, i));
    const BIG = Number.MAX_SAFE_INTEGER;
    const spineItems = [];
    for (const e of events) {
        if (containerOf.has(e.id))
            continue; // members ride inside their container
        spineItems.push({ id: e.id, rank: rankOf.get(e.id) ?? BIG, created: String(e.created_at ?? '') });
    }
    const seqChain = (() => {
        const chained = topoSortEventsByPrecedes(seqs, sequencePrecedesEdges);
        // No chain edges at all: fall back to seq_order (extraction's plot index),
        // then created_at.
        const hasChain = sequencePrecedesEdges.some((e) => byId.has(e.from) && byId.has(e.to));
        if (hasChain)
            return chained;
        return [...seqs].sort((a, b) => {
            const ao = Number(a.seq_order ?? NaN), bo = Number(b.seq_order ?? NaN);
            if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo)
                return ao - bo;
            return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
        });
    })();
    const membersOrdered = new Map();
    const memberRankBySeq = new Map();
    for (const sq of seqs) {
        const memberIds = (membersBySeq.get(sq.id) ?? []).filter((id) => byId.has(id));
        if (memberIds.length === 0)
            continue;
        const members = topoSortEventsByPrecedes(memberIds.map((id) => byId.get(id)).filter(Boolean), precedesEdges);
        membersOrdered.set(sq.id, members);
        memberRankBySeq.set(sq.id, Math.min(...members.map((m) => rankOf.get(m.id) ?? BIG)));
    }
    const seatOf = new Map();
    for (const sq of seqs) {
        const m = memberRankBySeq.get(sq.id);
        if (m != null)
            seatOf.set(sq.id, m);
    }
    for (const sq of seqs) {
        if (seatOf.has(sq.id))
            continue;
        const after = crossPrecedesEdges.filter((e) => e.to === sq.id && rankOf.has(e.from)).map((e) => rankOf.get(e.from) + 0.5);
        const before = crossPrecedesEdges.filter((e) => e.from === sq.id && rankOf.has(e.to)).map((e) => rankOf.get(e.to) - 0.5);
        if (after.length)
            seatOf.set(sq.id, Math.max(...after));
        else if (before.length)
            seatOf.set(sq.id, Math.min(...before));
    }
    // Propagate seats along the SEQUENCE CHAIN to a fixpoint: an unseated
    // sequence sits just after its nearest seated chain predecessor, else just
    // before its nearest seated chain successor.
    const chainPred = new Map();
    const chainSucc = new Map();
    for (const e of sequencePrecedesEdges) {
        if (!byId.has(e.from) || !byId.has(e.to))
            continue;
        (chainSucc.get(e.from) ?? chainSucc.set(e.from, []).get(e.from)).push(e.to);
        (chainPred.get(e.to) ?? chainPred.set(e.to, []).get(e.to)).push(e.from);
    }
    const CHAIN_STEP = 0.001;
    for (let changed = true, guard = 0; changed && guard < seqs.length + 1; guard++) {
        changed = false;
        for (const sq of seqs) {
            if (seatOf.has(sq.id))
                continue;
            const p = (chainPred.get(sq.id) ?? []).filter((id) => seatOf.has(id)).map((id) => seatOf.get(id));
            const su = (chainSucc.get(sq.id) ?? []).filter((id) => seatOf.has(id)).map((id) => seatOf.get(id));
            if (p.length) {
                seatOf.set(sq.id, Math.max(...p) + CHAIN_STEP);
                changed = true;
            }
            else if (su.length) {
                seatOf.set(sq.id, Math.min(...su) - CHAIN_STEP);
                changed = true;
            }
        }
    }
    let carry = -1;
    let step = 0;
    seqChain.forEach((sq) => {
        const seat = seatOf.get(sq.id);
        if (seat != null) {
            carry = seat;
            step = 0;
            spineItems.push({ id: sq.id, rank: seat, created: String(sq.created_at ?? '') });
            return;
        }
        step += 1;
        spineItems.push({ id: sq.id, rank: carry + step / 1000, created: String(sq.created_at ?? '') });
    });
    spineItems.sort((a, b) => (a.rank - b.rank) || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
    // --- Pass 2: told-order topo sort over the seated order ------------------
    const unitOf = (id) => containerOf.get(id) ?? id;
    const toldEdges = [];
    for (const e of [...precedesEdges, ...crossPrecedesEdges, ...sequencePrecedesEdges]) {
        const a = unitOf(e.from), b = unitOf(e.to);
        if (a !== b && byId.has(a) && byId.has(b))
            toldEdges.push({ from: a, to: b });
    }
    const seated = spineItems.map((it) => byId.get(it.id)).filter(Boolean);
    const units = topoSortEventsByPrecedes(seated, toldEdges);
    return { units, membersOrdered };
}
/** Every scene in told order, members expanded inside their container — the
 *  one order the SC numbers and the script navigator read. */
export function toldOrderEvents(entities, precedesEdges, containsEdges = [], sequencePrecedesEdges = [], crossPrecedesEdges = []) {
    const { units, membersOrdered } = orderSpineUnits(entities, precedesEdges, containsEdges, sequencePrecedesEdges, crossPrecedesEdges);
    const out = [];
    for (const u of units) {
        const members = membersOrdered.get(u.id);
        if (members && members.length)
            out.push(...members);
        else if (u.type === 'event')
            out.push(u);
    }
    return out;
}
export function computeAutoLayout(entities, precedesEdges = [], boardWidth = 1400, containsEdges = [], 
/** Sequence-level PRECEDES (the sequence chain). Ranks member-less
 *  sequences, which have no event rank of their own. */
sequencePrecedesEdges = [], 
/** Cross-altitude PRECEDES (Sequence↔Event): with these, the spine is ONE
 *  told-order chain and every unit ranks from a single topo sort. */
crossPrecedesEdges = []) {
    var _a;
    // Composition: the CAST spawns as a GRID/web cluster on the left; the story
    // STRUCTURE (events throughline + sequence containers) runs as a spine to the
    // RIGHT of it; the whole [cast | spine] core is centered horizontally on the
    // board, and the cast block is centered vertically against the spine's height
    // so the two read as a balanced pair instead of a single left-margin stack.
    const stride = COLLAPSED_W + COL_GAP;
    const rowStride = COLLAPSED_H + ROW_GAP;
    // CONTAINS — a sequence that owns scenes renders as a CONTAINER box (the bbox
    // of its anchor label + member scenes). Members are laid out INSIDE its block
    // (same column as the anchor), not in the spine, and excluded from it below.
    const membersBySeq = new Map();
    for (const c of containsEdges) {
        const arr = membersBySeq.get(c.from);
        if (arr)
            arr.push(c.to);
        else
            membersBySeq.set(c.from, [c.to]);
    }
    const byId = new Map(entities.map((e) => [e.id, e]));
    const memberEventIds = new Set();
    for (const ids of membersBySeq.values())
        for (const id of ids)
            if (byId.has(id))
                memberEventIds.add(id);
    const byType = {};
    for (const e of entities)
        (byType[_a = e.type] ?? (byType[_a] = [])).push(e);
    const out = {};
    // --- Geometry: cast grid LEFT of center, structure spine AT center ----------
    // The throughline (events + sequence containers) owns the CENTER column; the
    // cast spawns as a 2-column grid to its LEFT. The char-grid gaps are widened
    // past the board default so a reified-relationship pill (REL_COLLAPSED_W×H)
    // lands in a clean gap between two character cards instead of behind one.
    // Characters render as NAME PILLS (CHAR_PILL_W × CHAR_PILL_H), so the cast
    // grid packs much tighter than the old card grid while still leaving room for
    // a reified-relationship pill (REL_COLLAPSED_W×H) in the gaps.
    const chars = byType.character ?? [];
    const charCols = chars.length <= 1 ? 1 : 2;
    const firstThird = boardWidth / 3;
    const CHAR_COL_GAP = Math.round(Math.max(REL_COLLAPSED_W + 12, Math.min(REL_COLLAPSED_W + 56, firstThird - CANVAS_PAD - 2 * CHAR_PILL_W)));
    const CHAR_ROW_GAP = REL_COLLAPSED_H + 22; // room for a pill in the row gap
    const charStrideX = CHAR_PILL_W + CHAR_COL_GAP;
    const charStrideY = CHAR_PILL_H + CHAR_ROW_GAP;
    const charGridW = charCols * CHAR_PILL_W + (charCols - 1) * CHAR_COL_GAP;
    // Cast anchored top-LEFT (first third); throughline pulled toward board center
    // (as close as the cast width allows) with a clear lane between them.
    const gridLeft = CANVAS_PAD;
    const LANE = COL_GAP;
    const centerX = Math.round(boardWidth / 2 - EVENT_CARD_W / 2); // spine = event notecards
    const spineX = Math.max(gridLeft + (chars.length ? charGridW + LANE : 0), centerX);
    // The SPINE is ONE flow in true story order: loose events AND sequence
    // containers interleaved by PRECEDES position, top to bottom. Previously
    // loose events stacked first and every sequence stacked below them (by
    // created_at) — so a scene that comes late in the story could sort above an
    // early sequence. Now a global PRECEDES order ranks every event, a container
    // takes its EARLIEST member's rank, and the two kinds interleave by rank.
    const eventRowStride = COLLAPSED_H + ROW_GAP;
    const LABEL_H = 24; // the container header band — keep equal to ballEffects'
    // SEQ_HEADER_H so the first scene sits flush below the header
    // and the box doesn't jump between collapse and expand.
    const BOX_PAD = 14; // must match ballEffects' container box PAD: the rendered box
    // extends this far above the anchor and below the last scene.
    const MEMBER_GAP = 24; // gap between member scenes inside a container — compact
    // block, but with enough air that the cards breathe.
    const MEMBER_STRIDE = COLLAPSED_H + MEMBER_GAP;
    // Spine order + member ordering come from the SHARED told-order pass
    // (orderSpineUnits above), so the board, the SC numbers and the script
    // navigator are guaranteed to agree. Geometry only, below.
    const { units: spineUnits, membersOrdered: membersOrderedBySeq } = orderSpineUnits(entities, precedesEdges, containsEdges, sequencePrecedesEdges, crossPrecedesEdges);
    let seqY = CANVAS_PAD; // visible top of the next spine element
    for (const unit of spineUnits) {
        // A loose scene and an EMPTY sequence are both one card-height row; a
        // sequence WITH members renders as the container box around them.
        const members = membersOrderedBySeq.get(unit.id) ?? [];
        if (members.length === 0) {
            out[unit.id] = { x: spineX, y: seqY };
            seqY += eventRowStride; // one card + a normal gap
            continue;
        }
        // Container: the box adds BOX_PAD above the anchor and below the last scene.
        // Push the anchor down by BOX_PAD so the BOX TOP (anchor - PAD) lands at seqY,
        // giving the box the same ROW_GAP gap to its neighbors a normal card has.
        const anchorY = seqY + BOX_PAD;
        out[unit.id] = { x: spineX, y: anchorY };
        members.forEach((m, i) => { out[m.id] = { x: spineX, y: anchorY + LABEL_H + i * MEMBER_STRIDE }; });
        const lastMemberBottom = anchorY + LABEL_H + (members.length - 1) * MEMBER_STRIDE + COLLAPSED_H;
        seqY = lastMemberBottom + BOX_PAD + ROW_GAP; // box bottom + a normal gap to next
    }
    // --- Cast GRID (2 columns), centered vertically against the spine ----------
    // Order the cast so reified-relationship partners sit ADJACENT in the fill
    // order — adjacent cards put their relationship pill in a clean gap (the
    // widened CHAR_COL_GAP/CHAR_ROW_GAP gives it room) instead of behind a third
    // card. The relationship pills + structural lines then read as a web.
    const norm = (s) => String(s ?? '').trim().toLowerCase();
    const nameToId = new Map(chars.map((c) => [norm(c.working_name), c.id]));
    const partners = new Map();
    const link = (a, b) => {
        if (!partners.has(a))
            partners.set(a, new Set());
        partners.get(a).add(b);
    };
    for (const r of byType.relationship ?? []) {
        const a = nameToId.get(norm(r.character_a));
        const b = nameToId.get(norm(r.character_b));
        if (a && b && a !== b) {
            link(a, b);
            link(b, a);
        }
    }
    const orderedChars = [];
    const placedChar = new Set();
    for (const c of chars) {
        if (placedChar.has(c.id))
            continue;
        orderedChars.push(c);
        placedChar.add(c.id);
        for (const pid of partners.get(c.id) ?? []) {
            if (placedChar.has(pid))
                continue;
            const pc = byId.get(pid);
            if (pc) {
                orderedChars.push(pc);
                placedChar.add(pid);
            }
        }
    }
    // Top row close to the top of the board (no vertical centering against the spine).
    const gridTop = CANVAS_PAD;
    orderedChars.forEach((e, i) => {
        const col = i % charCols;
        const row = Math.floor(i / charCols);
        out[e.id] = { x: gridLeft + col * charStrideX, y: gridTop + row * charStrideY };
    });
    // Arcs that render as free cards (0-1 touched events) sit just RIGHT of the
    // throughline. Reified relationships (pills on cast edges) + locations (mostly
    // sidebar) get a fallback lane further right.
    const arcLane = spineX + EVENT_CARD_W + COL_GAP; // clear the wider event notecards
    const sideX = arcLane + stride;
    const colStack = (list, x) => list.forEach((e, i) => { out[e.id] = { x, y: CANVAS_PAD + i * rowStride }; });
    colStack(byType.arc ?? [], arcLane);
    colStack(byType.relationship ?? [], sideX);
    colStack(byType.location ?? [], sideX);
    return out;
}
const SCRATCH = '__scratch__';
const nameOf = (e) => String(e.working_title || e.working_name || '').trim();
const textOf = (e) => String(e.summary || e.description || '').trim();
/** Os sub-eventos de uma cena, uma linha cada (no máximo 12). */
const beatsOf = (e) => (Array.isArray(e.sub_events) ? e.sub_events : [])
    .map((b) => [b?.slugline, b?.description].map((x) => String(x ?? '').trim()).filter(Boolean).join(': '))
    .filter(Boolean)
    .slice(0, 12);
/** No board do roteirista: viva, aceita na história (não `staged`) e fora da
 *  sandbox (cartas estacionadas não estão na história). A régua do `aliveEntities`
 *  do corkboard. */
const onBoard = (e) => !e.deleted_at && e.staged !== '1' && e.state !== 'parked';
/** Cena contada: no board e não é backstory (a mesma régua da página de roteiro). */
const isTold = (e) => e.type === 'event' && onBoard(e) && e.narrative_status !== 'backstory';
// As entidades que um texto de roteiro pode trazer: as do HTML básico, o Latin-1
// inteiro (acentos) e a pontuação tipográfica. O editor grava só &amp; &lt; &gt;
// e &nbsp;; as outras aparecem em texto importado. Uma entidade fora desta lista
// fica como veio.
const LATIN1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
    + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
    + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';
const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
    bull: '\u2022', hellip: '\u2026', euro: '\u20ac', trade: '\u2122',
};
LATIN1.split(' ').forEach((name, i) => { ENTITIES[name] = String.fromCharCode(160 + i); });
/** O texto de um trecho de HTML: sem as tags, com as entidades resolvidas. */
function htmlText(inner) {
    return inner
        .replace(/<[^>]*>/g, '')
        .replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, name) => {
        if (name[0] !== '#')
            return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole;
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
}
/** O HTML do editor de roteiro (`<p data-line-type="scene">…</p>`) em blocos,
 *  sem DOM: é o que o servidor usa. Mesmo resultado do `blocksFromScreenplayHtml`
 *  do app (que lê pelo DOM) para o que o editor grava. */
export function blocksFromHtmlText(html) {
    const out = [];
    if (!html)
        return out;
    const paragraph = /<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi;
    for (let m = paragraph.exec(html); m; m = paragraph.exec(html)) {
        const kind = /\bdata-line-type\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[1]);
        const text = htmlText(m[2]).trim();
        if (text)
            out.push({ type: (kind?.[1] ?? kind?.[2]) || 'description', text });
    }
    return out;
}
function spineInputs(graph) {
    const entities = (graph.entities ?? []).filter((e) => onBoard(e) && !(e.type === 'event' && e.narrative_status === 'backstory'));
    const edges = graph.edges ?? {};
    return {
        entities,
        precedes: edges.precedes ?? [],
        contains: edges.contains ?? [],
        sequencePrecedes: edges.sequence_precedes ?? [],
        crossPrecedes: edges.cross_precedes ?? [],
    };
}
/** O palco: onde cada card está e o que os liga. As posições são as que o dono
 *  vê: a salva, ou a do auto-layout do board (`computeAutoLayout`, o mesmo do
 *  corkboard, com o mesmo conjunto de cartas vivas). Pura. */
function buildCanvas(graph, sections, layout) {
    const edges = graph.edges ?? {};
    const seen = new Set();
    const alive = (graph.entities ?? []).filter((e) => {
        if (!onBoard(e) || (e.type === 'arc' && String(e.character_id ?? '') !== '') || seen.has(e.id))
            return false;
        seen.add(e.id);
        return true;
    });
    const live = (list) => (list ?? []).filter((x) => seen.has(x.from) && seen.has(x.to));
    const auto = computeAutoLayout(alive, live(edges.precedes), layout.boardWidth || 1400, live(edges.contains), live(edges.sequence_precedes), live(edges.cross_precedes));
    const at = (id) => {
        const saved = layout.stored?.[id];
        const p = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : auto[id] ?? { x: 0, y: 0 };
        return { x: Math.round(p.x), y: Math.round(p.y) };
    };
    const sceneIds = new Set(sections.flatMap((s) => s.scenes.map((x) => x.id)));
    const byId = new Map(alive.map((e) => [e.id, e]));
    const cards = [];
    const boxes = [];
    const onStage = new Set();
    for (const s of sections) {
        for (const scene of s.scenes) {
            cards.push({ id: scene.id, kind: 'scene', ...at(scene.id) });
            onStage.add(scene.id);
        }
        const seq = byId.get(s.id);
        if (!seq || seq.type !== 'sequence')
            continue;
        onStage.add(s.id);
        const color = String(seq.color ?? '').trim();
        if (s.scenes.length)
            boxes.push({ id: s.id, ...(color ? { color } : {}), members: s.scenes.map((x) => x.id) });
        else
            cards.push({ id: s.id, kind: 'sequence', ...at(s.id) });
    }
    const idByName = new Map();
    for (const e of alive) {
        if (e.type !== 'character' || !nameOf(e))
            continue;
        cards.push({ id: e.id, kind: 'character', ...at(e.id) });
        onStage.add(e.id);
        idByName.set(nameOf(e).toLowerCase(), e.id);
    }
    const pair = (x) => [x.from, x.to];
    const thread = [...live(edges.precedes), ...live(edges.sequence_precedes), ...live(edges.cross_precedes)]
        .filter((x) => onStage.has(x.from) && onStage.has(x.to) && byId.get(x.from)?.type !== 'character' && byId.get(x.to)?.type !== 'character')
        .map(pair);
    const involves = live(edges.involves)
        .filter((x) => sceneIds.has(x.from) && byId.get(x.to)?.type === 'character' && onStage.has(x.to))
        .map(pair);
    const bonds = [];
    for (const e of alive) {
        if (e.type !== 'relationship')
            continue;
        const a = idByName.get(String(e.character_a ?? '').trim().toLowerCase());
        const b = idByName.get(String(e.character_b ?? '').trim().toLowerCase());
        if (a && b && a !== b)
            bonds.push({ a, b, kind: String(e.kind ?? '').replace(/_/g, ' ').trim() });
    }
    return { cards, thread, boxes, involves, bonds };
}
/** O board como preview: seções em ordem de história, elenco e locais; com
 *  `layout`, também o palco (`canvas`). Pura. */
export function buildSharedBoard(graph, layout) {
    const { entities, precedes, contains, sequencePrecedes, crossPrecedes } = spineInputs(graph);
    const byId = new Map(entities.map((e) => [e.id, e]));
    const edges = graph.edges ?? {};
    const castOf = new Map();
    const sceneCount = new Map();
    for (const inv of edges.involves ?? []) {
        const scene = byId.get(inv.from);
        const who = byId.get(inv.to);
        if (!scene || !isTold(scene) || !who || who.type !== 'character')
            continue;
        const name = nameOf(who);
        if (!name)
            continue;
        const list = castOf.get(scene.id) ?? [];
        if (!list.includes(name)) {
            list.push(name);
            sceneCount.set(who.id, (sceneCount.get(who.id) ?? 0) + 1);
        }
        castOf.set(scene.id, list);
    }
    const placeOf = new Map();
    for (const occ of edges.occurs_in ?? []) {
        const where = byId.get(occ.to);
        if (where && where.type === 'location' && nameOf(where) && !placeOf.has(occ.from))
            placeOf.set(occ.from, nameOf(where));
    }
    const { units, membersOrdered } = orderSpineUnits(entities, precedes, contains, sequencePrecedes, crossPrecedes);
    const sections = [];
    let n = 0;
    let loose = null;
    const toScene = (e) => ({
        id: e.id,
        number: ++n,
        title: nameOf(e) || 'Untitled scene',
        summary: textOf(e),
        characters: castOf.get(e.id) ?? [],
        ...(placeOf.get(e.id) ? { location: placeOf.get(e.id) } : {}),
        ...(typeof e.card_color === 'string' && e.card_color ? { color: e.card_color } : {}),
        ...(typeof e.int_ext === 'string' && e.int_ext.trim() ? { intExt: e.int_ext.trim() } : {}),
        ...(beatsOf(e).length ? { beats: beatsOf(e) } : {}),
    });
    for (const u of units) {
        if (u.type === 'sequence') {
            const members = (membersOrdered.get(u.id) ?? []).filter(isTold);
            loose = null;
            sections.push({ id: u.id, title: nameOf(u) || 'Untitled sequence', ...(textOf(u) ? { summary: textOf(u) } : {}), scenes: members.map(toScene) });
        }
        else if (isTold(u)) {
            if (!loose) {
                loose = { id: `loose_${sections.length}`, title: '', scenes: [] };
                sections.push(loose);
            }
            loose.scenes.push(toScene(u));
        }
    }
    const characters = entities
        .filter((e) => e.type === 'character' && nameOf(e))
        .map((e) => ({ id: e.id, name: nameOf(e), description: textOf(e), scenes: sceneCount.get(e.id) ?? 0 }))
        .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name));
    const locations = entities
        .filter((e) => e.type === 'location' && nameOf(e))
        .map((e) => ({ name: nameOf(e), description: textOf(e) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const shown = sections.filter((s) => s.title || s.scenes.length);
    return { sections: shown, characters, locations, ...(layout ? { canvas: buildCanvas(graph, shown, layout) } : {}) };
}
/** O roteiro como preview: as páginas de cada cena em ordem de história, e por
 *  último o texto ainda não ligado a nenhuma cena (o scratch). Pura. */
export function buildSharedScript(graph, sceneTexts, toBlocks = blocksFromHtmlText) {
    const { entities, precedes, contains, sequencePrecedes, crossPrecedes } = spineInputs(graph);
    const htmlBy = new Map(sceneTexts.map((s) => [s.eventId, s.html]));
    const byId = new Map(entities.map((e) => [e.id, e]));
    const sequenceOf = new Map();
    for (const c of contains) {
        const seq = byId.get(c.from);
        if (seq && seq.type === 'sequence' && nameOf(seq) && !sequenceOf.has(c.to))
            sequenceOf.set(c.to, nameOf(seq));
    }
    const scenes = [];
    let n = 0;
    for (const e of toldOrderEvents(entities, precedes, contains, sequencePrecedes, crossPrecedes)) {
        if (!isTold(e))
            continue;
        n += 1; // a cena conta mesmo sem páginas: o número é o do board
        const blocks = toBlocks(htmlBy.get(e.id) ?? '');
        const sequence = sequenceOf.get(e.id);
        if (blocks.length)
            scenes.push({ id: e.id, title: nameOf(e) || 'Untitled scene', blocks, number: n, ...(sequence ? { sequence } : {}) });
    }
    const tail = toBlocks(htmlBy.get(SCRATCH) ?? '');
    if (tail.length)
        scenes.push({ id: SCRATCH, title: '', blocks: tail });
    return { scenes };
}
/** O retrato de um link: só o que o escopo pede. Pura. */
export function buildShareSnapshot(scope, graph, sceneTexts = [], layout, toBlocks = blocksFromHtmlText) {
    return {
        v: 1,
        ...(scope !== 'script' ? { board: buildSharedBoard(graph, layout) } : {}),
        ...(scope !== 'board' ? { script: buildSharedScript(graph, sceneTexts, toBlocks) } : {}),
    };
}
/** Um retrato sem nada para mostrar (board sem cenas, roteiro sem páginas). */
export function isEmptySnapshot(snapshot) {
    const boardEmpty = !snapshot.board || snapshot.board.sections.every((s) => s.scenes.length === 0);
    const scriptEmpty = !snapshot.script || snapshot.script.scenes.length === 0;
    return boardEmpty && scriptEmpty;
}
