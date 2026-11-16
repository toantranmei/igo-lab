/**
 * Knowledge graphs over the shared dictionary view (W/C/R/V/G).
 * Pure functions: the same code draws the Example and the Live dictionary.
 * Ported from the reference KnowledgeModel and generalised to any role.
 */
import type { DictFrame, DictFrameCompetency, DictView } from '@cl/contract';

export type KKind = 'W' | 'R' | 'C' | 'I' | 'V' | 'B';
export interface KNode {
  id: string;
  label: string;
  kind: KKind;
  col: number;
  row: number;
  detail: Record<string, unknown>;
  sub: string;
}
export interface KEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  detail: Record<string, unknown>;
}
export interface KGraph {
  nodes: KNode[];
  edges: KEdge[];
  columns: string[];
  rows: number;
}

const EMPTY: KGraph = { nodes: [], edges: [], columns: [], rows: 1 };

const node = (id: string, label: string, kind: KKind, col: number, row: number, detail: object = {}, sub = ''): KNode => ({
  id,
  label,
  kind,
  col,
  row,
  detail: detail as Record<string, unknown>,
  sub,
});
const edge = (id: string, from: string, to: string, label: string, detail: object = {}): KEdge => ({
  id,
  from,
  to,
  label,
  detail: detail as Record<string, unknown>,
});

/** Required level as text. `null` is never shown as 0. */
export function levelText(level: number | null | undefined): string {
  return level == null ? 'chưa xác định' : `${level}/5`;
}

/** Stable key of one frame version, e.g. `R-PO@1.1`. */
export function frameKey(r: Pick<DictFrame, 'id' | 'version'>): string {
  return `${r.id || 'R'}@${r.version}`;
}

/** The W entry a frame belongs to: same role, else the only/first W. */
function positionOf(d: DictView, r: Pick<DictFrame, 'role'>): DictView['W'][number] | undefined {
  const ws = d.W || [];
  return ws.find((w) => w.role === r.role) ?? ws[0];
}

/** Frame version used by the screens: the requested one, else the latest. */
export function frameAt(d: DictView, version?: string): DictFrame | null {
  const rs = d.R || [];
  return rs.find((r) => r.version === version) ?? rs[rs.length - 1] ?? null;
}

/** Session-level network: W position → R frame versions → shared C. Required levels sit on the R→C edge. */
export function dictionaryGraph(d: DictView): KGraph {
  const ns: KNode[] = [];
  const es: KEdge[] = [];
  const cs = d.C || [];
  const rs = d.R || [];
  const ws = d.W || [];
  const mid = Math.max(0, (cs.length - 1) / 2);

  ws.forEach((w, i) => ns.push(node('W:' + w.id, w.role, 'W', 0, mid + i * 2, w, w.id)));

  rs.forEach((r, i) => {
    const key = frameKey(r);
    const rid = 'R:' + key;
    const row = rs.length === 1 ? mid : i * (Math.max(cs.length - 1, 2) / (rs.length - 1));
    ns.push(node(rid, 'Khung ' + r.role, 'R', 1, row, r, `v${r.version} · ${r.competencies.length} năng lực${r.trial ? ' · bản thử' : ''}`));
    const w = positionOf(d, r);
    if (w) es.push(edge('WR:' + key, 'W:' + w.id, rid, 'có khung', { version: r.version, frame: r.id, position: w.id }));
    r.competencies.forEach((c) => {
      if (!cs.some((x) => x.id === c.id)) return;
      es.push(
        edge('RC:' + key + ':' + c.id, rid, 'C:' + c.id, 'yêu cầu', {
          competency: c.id,
          level: c.level,
          frameVersion: r.version,
          indicator: c.indicator,
          evidence: c.evidence,
          note: 'Bậc yêu cầu thuộc liên kết R. Khung giữ nội dung chỉ báo của phiên bản đã dùng.',
        }),
      );
    });
  });

  cs.forEach((c, i) => {
    const users = rs.filter((r) => r.competencies.some((x) => x.id === c.id)).map(frameKey);
    ns.push(
      node(
        'C:' + c.id,
        c.name,
        'C',
        2,
        i,
        {
          id: c.id,
          name: c.name,
          concept: c.concept,
          definition: c.definition,
          version: c.version,
          indicators: c.indicators,
          usedBy: users,
          note: 'Định nghĩa và chỉ báo là nội dung chung C; bậc yêu cầu được đọc từ từng liên kết R, không lấy từ C.',
        },
        `${c.id} · ${users.length} khung/phiên bản dùng chung`,
      ),
    );
  });

  const maxRow = ns.reduce((m, n) => Math.max(m, n.row), 0);
  return {
    nodes: ns,
    edges: es,
    columns: ['W · Vị trí dùng chung', 'R · Khung theo phiên bản', 'C · Từ điển chung'],
    rows: Math.max(cs.length, 3, Math.ceil(maxRow) + 1),
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Run number of the release that published this frame version, when G records it. */
function runOfFrame(d: DictView, r: DictFrame): number | null {
  const g = (d.G || []).find((x) => x.version === r.version);
  return g ? g.run : null;
}

/** V records that support one frame competency. */
export function traceSources(d: DictView, r: DictFrame, c: DictFrameCompetency): Record<string, unknown>[] {
  const vs = d.V || [];
  const cited = new Set(c.evidence || []);
  const core = (d.C || []).find((x) => x.id === c.id);
  const run = runOfFrame(d, r);
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const take = (v: Record<string, unknown>) => {
    const id = str(v.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(v);
  };
  vs.filter((v) => cited.has(String(v.id))).forEach(take);
  if (core?.concept) {
    vs.filter((v) => {
      const id = str(v.id);
      if (!id || !id.startsWith('EV-') || v.concept !== core.concept) return false;
      // Seed events are named EV-<run>-<n>: keep only those of the run that released this frame.
      const m = /^EV-(\d+)-/.exec(id);
      return !m || run == null || Number(m[1]) === run;
    }).forEach(take);
  }
  return out;
}

/** Source → processing → requirement → indicator for one competency in one frame version. */
export function traceGraph(d: DictView, cid: string, version?: string): KGraph {
  const r = frameAt(d, version);
  const c = r?.competencies.find((x) => x.id === cid);
  if (!r || !c) return { ...EMPTY };
  const w = positionOf(d, r);
  const sources = traceSources(d, r, c);
  const ns: KNode[] = [];
  const es: KEdge[] = [];
  const seedOnly = r.evidence === 'synthetic_only';

  sources.forEach((v, i) => {
    const id = String(v.id);
    const isEvent = str(v.type) !== undefined;
    ns.push(node('V:' + id, id, 'V', 0, i, v, str(v.type) || str(v.industry) || str(v.title) || (seedOnly ? 'nguồn seed' : 'nguồn')));
    es.push(
      edge('VB:' + id, 'V:' + id, 'B:aggregate', isEvent ? (seedOnly ? 'rating seed' : 'rating sự kiện') : 'mã hóa từ nguồn', {
        source: v.source,
        synthetic: typeof v.synthetic === 'boolean' ? v.synthetic : seedOnly,
        evidenceClass: v.evidenceClass,
      }),
    );
  });

  const mid = Math.max(0, (sources.length - 1) / 2);
  ns.push(
    node(
      'B:aggregate',
      'B3 → B4 → B5',
      'B',
      1,
      mid,
      {
        steps: ['B3 trích mã năng lực từ JD', seedOnly ? 'B4 sự kiện seed và rating' : 'B4 sự kiện và rating', 'B5 trung vị rating, bao phủ nhiệm vụ'],
        formula: 'level = median(ratings); Coverage = Σw·covered/Σw',
      },
      'Trích xuất · đối chiếu · lựa chọn',
    ),
  );
  ns.push(
    node(
      'R:requirement',
      c.name,
      'R',
      2,
      mid,
      { ...c, frameVersion: r.version, formula: `Yêu cầu R = (${w?.id ?? r.role}, ${cid}, bậc ${c.level ?? 'chưa xác định'}, căn cứ, phiên bản)` },
      `${cid} · R yêu cầu bậc ${levelText(c.level)}`,
    ),
  );
  ns.push(node('I:' + cid, 'Chỉ báo hành vi', 'I', 3, mid, { text: c.indicator, frameVersion: r.version, creator: 'A8 · B6' }, c.indicator ?? 'Chưa có chỉ báo đã kiểm'));
  es.push(edge('BR', 'B:aggregate', 'R:requirement', 'hỗ trợ yêu cầu', { evidenceClass: r.evidence }));
  es.push(edge('RI', 'R:requirement', 'I:' + cid, 'B6 soạn chỉ báo', { frameVersion: r.version }));

  return {
    nodes: ns,
    edges: es,
    columns: [seedOnly ? 'V · Nguồn seed' : 'V · Nguồn bằng chứng', 'B · Hoạt động tạo ra kết quả', 'R · Yêu cầu của vị trí', 'C · Nội dung chỉ báo được dùng'],
    rows: Math.max(sources.length, 3),
  };
}

/** Tasks → competencies → indicators for one frame version (published or trial). */
export function frameGraph(d: DictView, frame: DictFrame | null): KGraph {
  if (!frame) return { ...EMPTY };
  const w = positionOf(d, frame);
  const tasks = w?.tasks ?? [];
  const ns: KNode[] = [];
  const es: KEdge[] = [];
  const taskRow = new Map<string, number>();

  frame.competencies.forEach((c, i) => {
    const def = (d.C || []).find((x) => x.id === c.id);
    const linked = tasks.filter((t) => (t.competencies ? t.competencies.includes(c.id) : !!def?.concept && t.concept === def.concept));
    linked.forEach((t) => {
      if (!taskRow.has(t.id)) {
        // Keep a task on its competency's row when that row is still free.
        const used = new Set(taskRow.values());
        let row = i;
        while (used.has(row)) row += 1;
        taskRow.set(t.id, row);
        ns.push(node('T:' + t.id, t.name, 'W', 0, row, t, `${t.id} · trọng số ${t.weight ?? 'chưa xác định'}`));
      }
      es.push(edge(`TC:${t.id}:${c.id}`, 'T:' + t.id, 'C:' + c.id, 'cần năng lực', { task: t.id, competency: c.id, weight: t.weight, frameVersion: frame.version }));
    });
    ns.push(
      node(
        'C:' + c.id,
        c.name,
        'C',
        1,
        i,
        { ...c, frameVersion: frame.version, sharedDefinition: def?.definition },
        `${c.id} · ${c.level != null ? `R yêu cầu bậc ${c.level}/5` : 'R yêu cầu bậc chưa xác định'}`,
      ),
    );
    if (c.indicator) {
      ns.push(node('I:' + c.id, c.indicator, 'I', 2, i, { text: c.indicator, competency: c.id, frameVersion: frame.version, creator: 'A8 · B6' }, 'Chỉ báo dùng trong R@' + frame.version));
      es.push(edge('CI:' + c.id, 'C:' + c.id, 'I:' + c.id, 'biểu hiện qua', { level: c.level, indicator: c.indicator, frameVersion: frame.version }));
    }
  });

  const maxRow = ns.reduce((m, n) => Math.max(m, n.row), 0);
  return {
    nodes: ns,
    edges: es,
    columns: [`W · Nhiệm vụ của ${frame.role || w?.role || 'vị trí'}`, 'C dùng chung · R gắn bậc yêu cầu', 'Chỉ báo trong phiên bản khung'],
    rows: Math.max(frame.competencies.length, 2, maxRow + 1),
  };
}

export const KnowledgeModel = { dictionaryGraph, traceGraph, frameGraph };
