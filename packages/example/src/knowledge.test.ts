import { describe, expect, it } from 'vitest';
import type { DictFrame, DictView } from '@cl/contract';
import { dictionaryGraph, frameGraph, levelText, traceGraph } from './knowledge';

const frame10: DictFrame = {
  id: 'R-PO',
  version: '1.0',
  role: 'Product Owner',
  purpose: 'Tuyển dụng',
  evidence: 'synthetic_only',
  competencies: [
    { id: 'C01', name: 'Hiểu khách hàng', level: 3, indicator: 'Tổng hợp nhu cầu từ phỏng vấn', evidence: ['JD-1', 'JD-2'] },
    { id: 'C04', name: 'Ra quyết định bằng dữ liệu', level: 3, indicator: 'Dùng dữ liệu để chọn ưu tiên', evidence: ['JD-1'] },
  ],
};
const frame11: DictFrame = {
  id: 'R-PO',
  version: '1.1',
  role: 'Product Owner',
  purpose: 'Tuyển dụng',
  evidence: 'synthetic_only',
  competencies: [
    { id: 'C01', name: 'Hiểu khách hàng', level: 3, indicator: 'Tổng hợp nhu cầu từ phỏng vấn', evidence: ['JD-1', 'JD-2'] },
    { id: 'C04', name: 'Ra quyết định bằng dữ liệu', level: 4, indicator: 'Đặt chỉ số đo và quyết định theo ngưỡng', evidence: ['JD-1', 'JD-7'] },
    { id: 'C09', name: 'Quản trị AI', level: null, indicator: null, evidence: [] },
  ],
};

const dict: DictView = {
  version: '1.1',
  W: [
    {
      id: 'W-PO',
      role: 'Product Owner',
      tasks: [
        { id: 'T1', name: 'Khám phá nhu cầu', concept: 'customer', weight: 4 },
        { id: 'T2', name: 'Ưu tiên backlog', concept: 'data', weight: 3 },
        { id: 'T3', name: 'Giám sát mô hình AI', weight: 2, competencies: ['C09', 'C04'] },
      ],
    },
  ],
  C: [
    { id: 'C01', name: 'Hiểu khách hàng', concept: 'customer', definition: 'Nắm nhu cầu người dùng', version: 1, indicators: ['Tổng hợp nhu cầu từ phỏng vấn'] },
    { id: 'C04', name: 'Ra quyết định bằng dữ liệu', concept: 'data', definition: 'Quyết định dựa trên số liệu', version: 2, indicators: ['Đặt chỉ số đo và quyết định theo ngưỡng'] },
    { id: 'C09', name: 'Quản trị AI', concept: 'ai', definition: 'Kiểm soát rủi ro AI', version: 1, indicators: [] },
  ],
  R: [frame10, frame11],
  V: [
    { id: 'JD-1', industry: 'Fintech', source: 'seed://jd/1', synthetic: true },
    { id: 'JD-2', industry: 'Bán lẻ', source: 'seed://jd/2', synthetic: true },
    { id: 'JD-7', industry: 'Y tế', source: 'seed://jd/7', synthetic: true },
    { id: 'EV-1-1', concept: 'data', type: 'synthetic_case', ratings: [3, 3, 4], source: 'seed://ev/1-1' },
    { id: 'EV-1-2', concept: 'customer', type: 'synthetic_case', ratings: [3, 3, 3], source: 'seed://ev/1-2' },
    { id: 'EV-2-1', concept: 'data', type: 'synthetic_case', ratings: [4, 4, 5], source: 'seed://ev/2-1' },
    { id: 'PILOT-1', kind: 'pilot', source: 'seed://pilot/1' },
  ],
  G: [
    { version: '1.0', run: 1, changes: [], policy: 'P1' },
    { version: '1.1', run: 2, changes: [], policy: 'P1' },
  ],
};

describe('dictionaryGraph', () => {
  const g = dictionaryGraph(dict);

  it('has one node per W, per R version and per C', () => {
    expect(g.nodes.filter((n) => n.kind === 'W')).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === 'R')).toHaveLength(2);
    expect(g.nodes.filter((n) => n.kind === 'C')).toHaveLength(3);
    expect(g.nodes).toHaveLength(6);
    expect(g.columns).toHaveLength(3);
  });

  it('links W→R once per frame and R→C once per requirement', () => {
    expect(g.edges.filter((e) => e.id.startsWith('WR:'))).toHaveLength(2);
    expect(g.edges.filter((e) => e.id.startsWith('RC:'))).toHaveLength(5);
    expect(g.edges).toHaveLength(7);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('reads the required level from the R link of the right frame version', () => {
    const e10 = g.edges.find((e) => e.id === 'RC:R-PO@1.0:C04')!;
    const e11 = g.edges.find((e) => e.id === 'RC:R-PO@1.1:C04')!;
    expect(e10.detail.level).toBe(3);
    expect(e10.detail.frameVersion).toBe('1.0');
    expect(e10.detail.indicator).toBe('Dùng dữ liệu để chọn ưu tiên');
    expect(e11.detail.level).toBe(4);
    expect(e11.detail.frameVersion).toBe('1.1');
    expect(e11.to).toBe('C:C04');
  });

  it('keeps the level off the shared C node and lists reuse', () => {
    const c04 = g.nodes.find((n) => n.id === 'C:C04')!;
    expect('level' in c04.detail).toBe(false);
    expect(c04.detail.usedBy).toEqual(['R-PO@1.0', 'R-PO@1.1']);
    expect(g.nodes.find((n) => n.id === 'C:C09')!.detail.usedBy).toEqual(['R-PO@1.1']);
  });

  it('works for a role that is not Product Owner and for an empty dictionary', () => {
    const other: DictView = {
      ...dict,
      W: [{ id: 'W-DA', role: 'Data Analyst', tasks: [] }],
      R: [{ ...frame10, id: 'R-DA', role: 'Data Analyst' }],
    };
    const og = dictionaryGraph(other);
    expect(og.edges.find((e) => e.id === 'WR:R-DA@1.0')!.from).toBe('W:W-DA');
    const empty = dictionaryGraph({ version: '0.0', W: [], C: [], R: [], V: [], G: [] });
    expect(empty.nodes).toHaveLength(0);
    expect(empty.edges).toHaveLength(0);
  });
});

describe('frameGraph', () => {
  it('still yields level 3 for version 1.0 after 1.1 exists', () => {
    const g = frameGraph(dict, frame10);
    const c04 = g.nodes.find((n) => n.id === 'C:C04')!;
    expect(c04.detail.level).toBe(3);
    expect(c04.sub).toContain('3/5');
    expect(g.edges.find((e) => e.id === 'CI:C04')!.detail.level).toBe(3);
    expect(g.nodes.find((n) => n.id === 'I:C04')!.label).toBe('Dùng dữ liệu để chọn ưu tiên');
  });

  it('yields level 4 for version 1.1 and marks a null level as undetermined', () => {
    const g = frameGraph(dict, frame11);
    expect(g.nodes.find((n) => n.id === 'C:C04')!.detail.level).toBe(4);
    const c09 = g.nodes.find((n) => n.id === 'C:C09')!;
    expect(c09.detail.level).toBeNull();
    expect(c09.sub).toContain('chưa xác định');
    expect(g.nodes.some((n) => n.id === 'I:C09')).toBe(false);
  });

  it('links tasks by explicit competencies, else by concept', () => {
    const g = frameGraph(dict, frame11);
    const tc = g.edges.filter((e) => e.id.startsWith('TC:')).map((e) => e.id).sort();
    expect(tc).toEqual(['TC:T1:C01', 'TC:T2:C04', 'TC:T3:C04', 'TC:T3:C09']);
    // 3 tasks + 3 competencies + 2 indicators
    expect(g.nodes).toHaveLength(8);
    expect(g.edges).toHaveLength(6);
    const rows = g.nodes.filter((n) => n.col === 0).map((n) => n.row);
    expect(new Set(rows).size).toBe(rows.length);
    expect(g.columns[0]).toContain('Product Owner');
  });

  it('returns an empty graph without a frame', () => {
    expect(frameGraph(dict, null)).toEqual({ nodes: [], edges: [], columns: [], rows: 1 });
  });
});

describe('traceGraph', () => {
  it('uses cited V records plus the seed events of the frame run', () => {
    const g10 = traceGraph(dict, 'C04', '1.0');
    expect(g10.nodes.filter((n) => n.kind === 'V').map((n) => n.id)).toEqual(['V:JD-1', 'V:EV-1-1']);
    const g11 = traceGraph(dict, 'C04', '1.1');
    expect(g11.nodes.filter((n) => n.kind === 'V').map((n) => n.id)).toEqual(['V:JD-1', 'V:JD-7', 'V:EV-2-1']);
    // sources + B + R + I
    expect(g11.nodes).toHaveLength(6);
    expect(g11.edges).toHaveLength(5);
    expect(g11.columns).toHaveLength(4);
  });

  it('carries the requirement level of the chosen version', () => {
    expect(traceGraph(dict, 'C04', '1.0').nodes.find((n) => n.id === 'R:requirement')!.detail.level).toBe(3);
    const r11 = traceGraph(dict, 'C04', '1.1').nodes.find((n) => n.id === 'R:requirement')!;
    expect(r11.detail.level).toBe(4);
    expect(r11.sub).toBe('C04 · R yêu cầu bậc 4/5');
    expect(String(r11.detail.formula)).toContain('W-PO');
  });

  it('defaults to the latest frame and is empty for an unknown competency', () => {
    expect(traceGraph(dict, 'C09').nodes.find((n) => n.id === 'R:requirement')!.sub).toContain('chưa xác định');
    expect(traceGraph(dict, 'C09', '1.0').nodes).toHaveLength(0);
    expect(traceGraph(dict, 'C99', '1.1').nodes).toHaveLength(0);
  });
});

describe('levelText', () => {
  it('never renders null as a number', () => {
    expect(levelText(null)).toBe('chưa xác định');
    expect(levelText(4)).toBe('4/5');
  });
});
