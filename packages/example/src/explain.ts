/**
 * Production model of the Default Example: names, snapshot (preview on a clone), block explanation.
 * Ported from docs/reference/site-v8/production.js (model part only, no DOM).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BLOCK_IDS, MAIN_BLOCK_IDS } from '@cl/contract';
import type { BlockCard, BlockDetail, BlockId, BlockVisual, CalcEntry, ChangeItem, DetailState, GateResult, RecordRow } from '@cl/contract';
import { Lab, clone, defs } from './engine';
import type { Rule } from './engine';

export const pct = (x: number): string => Number((100 * x).toFixed(1)) + '%';
/** Timestamp used for previews so traces/details are deterministic. */
export const PREVIEW_TIME = '1970-01-01T00:00:00.000Z';

const names = ['Chốt phạm vi', 'Thu & kiểm JD', 'Neo nghề / ngành', 'Mã hóa khái niệm', 'Thu sự kiện', 'Chọn năng lực', 'Viết & kiểm chỉ báo', 'Thẩm định AI', 'Phát hành & audit'];
const agents = ['A9 · Charter', 'A1 · Research', 'A1 · Mapper', 'A2 · Coder', 'A3 / A4 / A5', 'A6 / A7', 'A8 · Indicators', 'A9 + 3 AI reviewer', 'A9 · Registry → AU'];
const artifacts = ['Charter + policy', 'JD có nguồn', 'W + nhiệm vụ', 'Ứng viên C + nguồn', 'Sự kiện + nhãn', 'C đã chọn + bậc R', 'Chỉ báo bản nháp', 'Quyết định kiểm', 'W / C / R / V / G'];

const keyed = (list: string[], fast: string): Record<BlockId, string> =>
  ({ ...Object.fromEntries(MAIN_BLOCK_IDS.map((id, i) => [id, list[i]])), FAST: fast }) as Record<BlockId, string>;

export const blockNames: Record<BlockId, string> = keyed(names, 'Giao bản thử & học từ pilot');
export const blockAgents: Record<BlockId, string> = keyed(agents, 'A6 / A8 / A9 + AU');
export const blockArtifacts: Record<BlockId, string> = keyed(artifacts, 'Bản thử + pilot V');

/** Glossary of the variables used in each block's formulas. */
export const blockVariables: Record<BlockId, string> = {
  B0: '∧ = tất cả điều kiện đều đúng. policy.version = phiên bản luật. AIOnly = mọi B do AI thực hiện.',
  B1: 'N_valid = số bản ghi có địa chỉ nguồn; N_total = tổng JD; 1[điều kiện] = 1 nếu đúng, 0 nếu sai.',
  B2: 'T = tập nhiệm vụ của vai trò W. Kiểm mã nghề bên ngoài được giữ riêng với ID nội bộ.',
  B3: 'TP = khái niệm đúng seed; FP = ứng viên dư/trùng; FN = khái niệm seed bị bỏ sót.',
  B4: 'EV = sự kiện; N_source = số sự kiện có nguồn; N_synthetic_case = số giữ đúng nhãn.',
  B5: 'T = nhiệm vụ; S = C được chọn; wₜ = trọng số nhiệm vụ; aₜc = liên kết concept; median = phần tử giữa sau khi sắp xếp.',
  B6: 'Aᵢ = tỷ lệ phiếu khớp ID của chỉ báo i; N_vote = 3; min = giá trị thấp nhất trên mọi chỉ báo.',
  B7: 'Gᵢ = kết quả cổng i. ∧ yêu cầu mọi cổng đúng; coverage phải bằng 1.',
  B8: 'ADD/UPDATE/REUSE là các loại diff. Issue_late chỉ đo lỗi trùng được seed cài sẵn; không đại diện toàn bộ chất lượng audit.',
  FAST: 'N_task = số bài dùng thử; N_success = số bài đạt; STOP = đang bị khóa.',
};

/** Method reference shown under some blocks (reference: `source` = 'prov' | 'skill'). */
export const blockMethodSource: Partial<Record<BlockId, { label: string; url: string }>> = (() => {
  const prov = { label: 'W3C PROV · nguồn → hoạt động → đầu ra', url: 'https://www.w3.org/TR/prov-o/' };
  const skill = { label: 'SkillSpan · trích xuất kỹ năng có dữ liệu đối chiếu', url: 'https://aclanthology.org/2022.naacl-main.366/' };
  return { B1: prov, B3: skill, B4: prov, B8: prov };
})();

export interface Snapshot {
  lab: Lab;
  out: any;
  actual: boolean;
  blockedAt?: BlockId;
}

/** Real output when the block has run; otherwise computes it on a clone, never touching `lab`. */
export function snapshot(lab: Lab, id: BlockId): Snapshot {
  const actual = id === 'FAST' ? lab.fast : lab.outputs[id];
  if (actual) return { lab, out: actual, actual: true };
  const sim = Lab.restore(clone(lab));
  const n = id === 'FAST' ? 3 : Number(id.slice(1));
  while (sim.position <= n && !sim.halted && !sim.completed) sim.step();
  if (id === 'FAST' && !sim.halted) sim.quick();
  const out = (id === 'FAST' ? sim.fast : sim.outputs[id]) ?? null;
  return { lab: sim, out, actual: false, ...(sim.halted ? { blockedAt: ('B' + sim.position) as BlockId } : {}) };
}

/** Engine rules of an output; FAST has no `_rules`, so the two trial checks are synthesised. */
export function rulesOf(out: any): Rule[] {
  if (out?._rules) return out._rules as Rule[];
  if (!out?.audit) return [];
  return [
    { name: 'Truy nguồn bản thử', actual: out.audit.traceability, expect: 1, pass: out.audit.traceability === 1 },
    { name: 'Phạm vi dùng thử', actual: out.audit.scopeAllowed, expect: true, pass: !!out.audit.scopeAllowed },
  ];
}

export function toGates(lab: Lab, id: BlockId, rules: Rule[]): GateResult[] {
  return rules.map((r, i) => ({
    gate_id: `${id}.G${i + 1}`,
    name: r.name,
    status: r.pass ? 'PASS' : 'FAIL',
    actual: r.actual,
    criterion: String(r.expect),
    input_refs: [],
    rule_version: lab.config.version,
    required: true,
  }));
}

/** Time of the block's own PASS/BLOCK (or FAST DELIVER) log entry; fixed epoch for previews. */
export function computedAt(lab: Lab, id: BlockId, actual: boolean): string {
  if (!actual) return PREVIEW_TIME;
  const types = id === 'FAST' ? ['DELIVER'] : ['PASS', 'BLOCK'];
  for (let i = lab.logs.length - 1; i >= 0; i--) {
    const l = lab.logs[i];
    if (l.step === id && types.includes(l.type)) return l.time;
  }
  return PREVIEW_TIME;
}

export function toChangeItem(c: any, nameOf?: (id: string) => string | undefined): ChangeItem {
  const name = c.name ?? nameOf?.(c.id) ?? defs.find((d) => d[0] === c.id)?.[1];
  return {
    entity: c.entity,
    id: c.id,
    ...(name ? { name } : {}),
    action: c.action,
    before: c.before ?? null,
    after: c.after ?? null,
    ...(c.reason ? { reason: c.reason } : {}),
    ...(c.affected ? { affected: c.affected } : {}),
  };
}

const handoffTargetOf = (id: BlockId) => (id === 'FAST' ? 'KHO V' : id === 'B8' ? 'LÕI & VÒNG SAU' : 'BƯỚC TIẾP');

export function explain(realLab: Lab, id: BlockId): BlockDetail {
  const snap = snapshot(realLab, id);
  const lab = snap.lab;
  const o = snap.out;
  const base = { id, name: blockNames[id], agent: blockAgents[id], handoffTarget: handoffTargetOf(id) };
  if (!o) {
    const at = snap.blockedAt;
    return {
      ...base,
      method: 'Block chưa được phép xử lý do cổng trước bị chặn.',
      state: 'not_run',
      ...(at ? { blockedAt: at } : {}),
      input: [],
      flow: [],
      output: [],
      rows: [],
      calc: [],
      gates: [],
      notes: [`${at || 'Cổng trước'} đang chặn. ${id} không có đầu ra hợp lệ để tính. Chọn block bị chặn để xem điều kiện lỗi.`],
      handoff: '',
      raw: null,
    };
  }

  const p = lab.outputs;
  const n = lab.data.jds.length;
  const rows: RecordRow[] = [];
  const calc: CalcEntry[] = [];
  const notes: string[] = [];
  const add = (label: string, formula: string, substitution: string, meaning: string) => calc.push({ label, formula, substitution, meaning });
  let input: [string, any][] = [];
  let output: [string, any][] = [];
  let flow: string[] = [];
  let handoff = '';
  let method = '';
  let visual: BlockVisual | undefined;

  if (id === 'B0') {
    input = [['Vai trò', 'Product Owner'], ['Lõi đầu lượt', 'v' + lab.startDictionary.version], ['Lesson an toàn', lab.config.approvedLessons.join(', ') || '0 lesson']];
    add('Cổng cấu hình', 'G₀ = has(policy.version) ∧ AIOnly', `${o.policy.version} có phiên bản ∧ ${o.policy.AIOnly} = ${o._gate ? 'ĐẠT' : 'CHẶN'}`, 'Hai kiểm tra đang có trong engine; mục đích và giới hạn được ghi trong charter, chưa có bộ đo chất lượng charter.');
    output = [['Nhánh', o.branches.join(' / ')], ['Giới hạn', o.permittedUse], ['Snapshot', o.policy.version]];
    flow = ['Đọc lõi đầu lượt', 'Nạp lesson đã an toàn', 'Khóa policy cho lượt'];
    handoff = 'B1 nhận charter; B2 đọc nhiệm vụ seed. Policy và lesson đã khóa dùng chung cho toàn lượt.';
    method = 'Hợp đồng đầu vào có phiên bản';
  } else if (id === 'B1') {
    const valid = o.jds.filter((j: any) => j.source).length;
    input = [['JD đầu vào', n + ' bản ghi'], ['Nguồn gốc riêng', o.uniqueOrigins + ' seed-company'], ['Điều kiện tối thiểu', 'N ≥ ' + lab.config.minJD]];
    add('Số lượng hợp lệ', 'N_valid = Σⱼ 1[sourceⱼ ≠ ∅]', o.jds.map((j: any) => (j.source ? 1 : 0)).join(' + ') + ' = ' + valid, `Yêu cầu ≥ ${lab.config.minJD}. Đây là ngưỡng giả định thiết kế, chưa phải cỡ mẫu thống kê.`);
    add('Tỷ lệ có địa chỉ nguồn', 'Trace = N_valid / N_total', `${valid} / ${o.jds.length} = ${pct(valid / o.jds.length)}`, 'Yêu cầu 100%. Có địa chỉ seed chưa đồng nghĩa nguồn thực hoặc nội dung đúng.');
    rows.push(...o.jds.map((j: any) => ({ id: j.id, name: j.industry, value: j.source ? 'Có nguồn' : 'THIẾU NGUỒN', detail: j.source || 'Không được bàn giao', bad: !j.source, data: j })));
    output = [['JD có địa chỉ', valid + '/' + o.jds.length], ['Cổng', o._gate ? 'Đạt → bàn giao' : 'Chặn cả hai nhánh'], ['Dữ liệu', 'Synthetic / seed']];
    flow = ['Đọc bản ghi', 'Đếm địa chỉ nguồn', 'So với 2 điều kiện'];
    handoff = 'B3 sử dụng trực tiếp danh sách JD đã kiểm ở B1; B2 chạy trước để cung cấp W và nhiệm vụ.';
    method = 'Kiểm cấu trúc và truy nguồn';
  } else if (id === 'B2') {
    input = [['Charter', p.B0.role], ['Bối cảnh', o.industry.join(' / ')], ['Nhiệm vụ seed', o.tasks.length + ' nhiệm vụ']];
    add('Có nhiệm vụ', 'G₂a = [|T| > 0]', `${o.tasks.length} > 0 = ${o.tasks.length > 0}`, 'Bộ kiểm hiện tại xác nhận số nhiệm vụ > 0; chưa kiểm định nội dung hay đối chiếu mã nghề ngoài.');
    add('Không gán chuẩn chưa kiểm', 'G₂b = [externalStatus = chưa xác minh]', o.mapping.externalStatus, 'Dùng ID W-PO nội bộ. Không suy diễn đây là ánh xạ đã xác nhận với chuẩn nghề / ngành.');
    rows.push(...o.tasks.map((t: any) => ({ id: t.id, name: t.name, value: 'w = ' + t.weight, detail: 'concept: ' + t.concept, data: t })));
    output = [['Vai trò nội bộ', o.mapping.internal], ['Nhiệm vụ W', o.tasks.length], ['Mã bên ngoài', 'Chưa xác minh']];
    flow = ['Đọc nhiệm vụ seed', 'Gắn W-PO', 'Giữ trạng thái mã ngoài'];
    handoff = 'B5 lấy nhiệm vụ và trọng số từ seed W; B8 ghi W khi phát hành.';
    method = 'Neo nhiệm vụ vào vai trò';
  } else if (id === 'B3') {
    const m = o._metrics;
    input = [['JD đã kiểm', p.B1.jds.length], ['C dùng lại', lab.startDictionary.C.length + ' định nghĩa'], ['Khử trùng sớm', o.earlyDedup ? 'Có LL-001' : 'Chưa nạp LL-001']];
    add('Precision trên đáp án seed', 'P = TP / (TP + FP)', `${m.TP} / (${m.TP} + ${m.FP}) = ${pct(m.precision)}`, 'TP = khái niệm seed; FP = ứng viên dư / trùng. Chỉ số chẩn đoán, hiện không phải điều kiện chặn B3.');
    add('Recall trên đáp án seed', 'R = TP / (TP + FN)', `${m.TP} / (${m.TP} + ${m.FN}) = ${pct(m.recall)}`, 'Yêu cầu R = 100% và mọi ứng viên có ít nhất một ID nguồn. Đáp án biết trước vì đây là seed.');
    rows.push(...o.candidates.map((c: any) => ({ id: c.id + (c.alias ? ' · alias' : ''), name: c.name, value: c.evidence.length + ' JD', detail: c.concept + ' ← ' + c.evidence.join(', '), bad: !!c.alias, data: c })));
    output = [['Ứng viên', o.candidates.length], ['Khái niệm duy nhất', m.TP], ['Ứng viên dư', m.FP]];
    flow = ['JD.skills → concept', 'Gắn C ID và nguồn', o.earlyDedup ? 'Gộp sớm theo lesson' : 'Giữ alias để AU phát hiện'];
    handoff = 'B4 thu sự kiện cho concept; B5 đọc lại ứng viên B3 và gộp trùng trước chọn. Nhánh nhanh cũng đọc B3.';
    method = 'Mã hóa có đáp án đối chiếu';
    notes.push('Lượt 1 cố ý để lọt alias stakeholder: cổng vẫn đạt vì precision chưa là điều kiện chặn. Đây là lỗ hổng được AU ghi lại, không che bằng trạng thái PASS.');
    visual = {
      kind: 'b3',
      jdCount: p.B1.jds.length,
      candidates: o.candidates.map((c: any) => ({ id: c.id, name: c.name, ...(c.alias ? { alias: true } : {}), evidence: [...c.evidence] })),
      unique: new Set(o.candidates.map((c: any) => c.concept)).size,
    };
  } else if (id === 'B4') {
    const traced = o.events.filter((e: any) => e.source).length;
    const labeled = o.events.filter((e: any) => e.type === 'synthetic_case').length;
    input = [['Concept cần căn cứ', new Set(p.B3.candidates.map((c: any) => c.concept)).size], ['Sự kiện seed', o.events.length], ['Câu hỏi từ pilot V', o.pilotQuestions.length]];
    add('Truy nguồn sự kiện', 'Trace_EV = N_source / N_EV', `${traced} / ${o.events.length} = ${pct(traced / o.events.length)}`, 'Yêu cầu 100% sự kiện có địa chỉ seed.');
    add('Giữ loại bằng chứng', 'Label = N_synthetic_case / N_EV', `${labeled} / ${o.events.length} = ${pct(labeled / o.events.length)}`, 'Yêu cầu mọi sự kiện giữ nhãn synthetic_case. Không phải phỏng vấn BEI người thật.');
    rows.push(...o.events.map((e: any) => ({ id: e.id, name: e.concept, value: e.ratings.join(' / '), detail: e.source + ' · ' + e.action, data: e })));
    output = [['Sự kiện truy nguồn', traced], ['Loại bằng chứng', o.evidenceClass], ['Giá trị ngoài thực tế', 'Chưa kiểm chứng']];
    flow = ['A3: giả thuyết', 'A4: căn cứ seed', 'A5: sự kiện giả lập'];
    handoff = 'B5 ghép sự kiện theo concept và dùng ba rating seed để đề xuất bậc yêu cầu.';
    method = 'Tách giả thuyết và bằng chứng';
  } else if (id === 'B5') {
    const ts = lab.data.tasks;
    const ss: any[] = o.selected;
    const den = ts.reduce((a, t) => a + t.weight, 0);
    const num = ts.filter((t) => ss.some((c) => c.concept === t.concept)).reduce((a, t) => a + t.weight, 0);
    input = [['Ứng viên B3', p.B3.candidates.length], ['Sự kiện B4', p.B4.events.length], ['Trọng số nhiệm vụ', ts.map((t) => t.weight).join(' + ')]];
    add('Bao phủ có trọng số', 'Coverage(S) = Σₜ wₜ·1[∃c∈S: aₜc = 1] / Σₜ wₜ', `(${ts.map((t) => t.weight + '×' + Number(ss.some((c) => c.concept === t.concept))).join(' + ')}) / ${den} = ${num}/${den} = ${pct(o.coverage)}`, 'w là trọng số thiết kế seed; a = 1 khi trùng concept. Yêu cầu 100%. Đây là kiểm bao phủ, chưa giải bài toán tối ưu chi phí chọn tập.');
    add('Bậc yêu cầu', 'Level(c) = median(r₁, r₂, r₃)', ss.map((c) => `${c.id}: median(${c.ratings.join(',')}) = ${c.level}`).join(' · '), 'Ba rating là seed thứ bậc 1–5. Bậc nằm trên liên kết yêu cầu R của vai trò, không phải bậc cá nhân hay thuộc tính C chung.');
    rows.push(...ss.map((c) => ({ id: c.id, name: c.name, value: 'Bậc R ' + c.level, detail: 'ratings [' + c.ratings.join(', ') + '] · concept ' + c.concept, data: c })));
    output = [['C duy nhất', ss.length], ['Trùng bị gộp ở B5', o.removedLate], ['Bao phủ', pct(o.coverage)]];
    flow = ['Gộp theo concept', 'Ghép T ↔ C', 'Tính coverage + median'];
    handoff = 'B6 nhận danh sách C, bậc yêu cầu R, các ID JD và rating sự kiện để soạn chỉ báo.';
    method = 'Bao phủ nhiệm vụ + trung vị';
    visual = {
      kind: 'b5',
      tasks: ts.map((t) => ({ id: t.id, name: t.name, weight: t.weight })),
      competencies: ss.map((c) => ({ id: c.id, name: c.name })),
      links: Object.fromEntries(ts.map((t) => [t.id, ss.filter((c) => c.concept === t.concept).map((c) => c.id)])),
    };
  } else if (id === 'B6') {
    const tally: { id: string; hit: number; total: number }[] = o.cards.map((c: any) => ({ id: c.id, hit: c.votes.filter((v: string) => v === c.id).length, total: c.votes.length }));
    const min = Math.min(...tally.map((t) => t.hit / t.total));
    const bad = lab.fault === 'forbidden_write';
    input = [['C đã chọn', p.B5.selected.length], ['Phiếu / chỉ báo', '3 phiếu seed cố định'], ['Quyền ghi', 'Chỉ vùng draft']];
    add('Gán nhãn đúng ID seed', 'Aᵢ = Σᵥ 1[voteᵥ = IDᵢ] / N_vote', `${tally.map((t) => `${t.id}: ${t.hit}/${t.total} = ${pct(t.hit / t.total)}`).join(' · ')}; min(Aᵢ) = ${pct(min)} ≥ ${pct(lab.config.minAgreement)}`, 'Đếm phiếu khớp ID đã biết. Đồng thuận này không đo độ đúng của câu chỉ báo, không phải ba model độc lập.');
    add('Ranh giới ghi', 'WriteAllowed = [writeScope = draft]', `${bad ? 'core' : 'draft'} = draft → ${bad ? 'SAI · CHẶN' : 'ĐÚNG'}`, 'B6 không được ghi W/C/R lõi. Sự cố ghi trái quyền phải khóa quy trình dù agreement = 100%.');
    rows.push(...o.cards.map((c: any) => ({ id: c.id, name: c.name, value: pct(c.agreement) + ' · v' + c.version, detail: c.indicator + ' | votes: ' + c.votes.join(', '), data: c })));
    output = [['Chỉ báo nháp', o.cards.length], ['Min agreement', pct(min)], ['Phạm vi ghi', bad ? 'core · vi phạm' : 'draft']];
    flow = ['Soạn hành vi quan sát', 'Gán nhãn bằng phiếu seed', 'Kiểm quyền ghi'];
    handoff = 'B7 đọc thẻ chỉ báo và toàn bộ kết quả cổng B0–B6; chưa có quyền phát hành ở B6.';
    method = 'Kiểm gán nhãn + phân quyền';
    notes.push('Ngưỡng 70% là giả định. Với 3 phiếu, 2/3 = 66,7% không đạt; thực tế cần 3/3. Cần hiệu chỉnh ngưỡng trên bộ đối chiếu thực trước khi vận hành.');
  } else if (id === 'B7') {
    const seven = Array.from({ length: 7 }, (_, i) => 'B' + i);
    input = [['Cổng trước', 7], ['Reviewer', o.reviewers.length + ' vai AI seed'], ['Chỉ báo nháp', p.B6.cards.length]];
    add('Hội các cổng', 'G₇ = (G₀ ∧ G₁ ∧ … ∧ G₆) ∧ [Coverage = 1]', seven.map((b) => `${b}: ${p[b]._gate ? '1' : '0'}`).join(' ∧ ') + ` ∧ ${o.coverage} = 1 → ${o._gate ? 'ĐẠT' : 'CHẶN'}`, 'Không dùng điểm tổng hợp để bù trừ một cổng sai. Ba tên reviewer đang mô phỏng vai trò, chưa kiểm độc lập giữa model.');
    rows.push(...seven.map((b, i) => ({ id: b, name: names[i], value: p[b]._gate ? 'Đạt' : 'Chặn', detail: p[b]._rules.map((r: Rule) => r.name).join(' · '), bad: !p[b]._gate, data: { gate: p[b]._gate, rules: p[b]._rules } })));
    output = [['Quyết định', o.decision], ['Bao phủ', pct(o.coverage)], ['Kiểm chứng ngoài', o.externalValidation]];
    flow = ['Đọc các cổng', 'Kiểm coverage', 'Chốt ứng viên phát hành'];
    handoff = 'B8 đóng phiên bản. AU hậu kiểm log sau khi khung ứng viên đã được tạo; lesson áp dụng ở vòng kế tiếp.';
    method = 'Cổng bắt buộc, không bù trừ';
    visual = { kind: 'b7', gates: seven.map((b) => ({ id: b, pass: !!p[b]._gate })), coverageOk: o.coverage === 1 };
  } else if (id === 'B8') {
    const ch: any[] = o.changes;
    const find: any[] = o.audit.findings;
    const nameOf = (cid: string) => o.frame.competencies.find((x: any) => x.id === cid)?.name;
    input = [['Ứng viên B7', p.B7._gate ? 'Đã đạt' : 'Chưa đạt'], ['Chỉ báo B6', p.B6.cards.length], ['Lõi trước', 'v' + lab.startDictionary.version]];
    add('Phân loại thay đổi', 'ADD = chưa có ID; UPDATE = mới phiên bản / thiếu chỉ báo; REUSE = giữ bản cũ', ['ADD', 'UPDATE', 'REUSE'].map((k) => k + ' = ' + ch.filter((c) => c.action === k).length).join(' · '), 'G lưu diff; R lưu khung theo phiên bản. Lõi C dùng chung; màn hình từ điển tách yêu cầu bậc ra R.');
    add('Kết quả hậu kiểm AU', 'Issue_late = |Candidates_B3| − |Selected_B5|', `${p.B3.candidates.length} − ${p.B5.selected.length} = ${p.B5.removedLate} → ${find.length} finding`, 'Kiểm vấn đề có căn cứ trong seed. Không bịa issue khi lượt 2 đã khử trùng; lượt 1 tạo LL-001 và buộc xác nhận an toàn trước lượt 2.');
    rows.push(...ch.map((c) => ({ id: c.id, name: nameOf(c.id) || c.id, value: c.action, detail: c.action === 'UPDATE' ? 'Trước: ' + (c.before || 'chưa có chỉ báo') + ' | Sau: ' + c.after : 'Ghi nhận trong G v' + o.version, data: c })));
    output = [['Phiên bản', 'v' + o.version], ['Khung R', o.frame.competencies.length + ' năng lực'], ['AU / lesson', find.length + ' finding · ' + lab.dictionary.lessons.length + ' lesson']];
    flow = ['Đóng khung R', 'AU đọc chuỗi / ghi lesson', 'G ghi diff và phiên bản'];
    handoff = 'R → xem Khung PO; C/V/G → từ điển. LL-001 an toàn → A0/AQ nạp snapshot mới → B3 gộp sớm ở lượt 2.';
    method = 'Phiên bản + audit có dấu vết';
    notes.push('Bản hiện tại là mô phỏng cục bộ, chưa có giao dịch cơ sở dữ liệu hoặc kiểm toán độc lập. Hai luật B8 đang chạy: AU hoàn tất và nhãn synthetic_only.');
    visual = { kind: 'b8', changes: ch.map((c) => toChangeItem(c, nameOf)) };
  } else if (id === 'FAST') {
    const f = o.feedback;
    input = [['Ứng viên B3', p.B3.candidates.length], ['Phạm vi', 'Hỗ trợ / phát triển'], ['Quyền lõi W/C/R', 'Không ghi']];
    add('Giá trị dùng thử seed', 'SuccessRate = N_success / N_task', `${f.success} / ${f.tasks} = ${pct(f.successRate)}`, `${f.success} thành công, ${f.errors} lỗi là seed cố định, không phải kết quả pilot ngoài đời; chưa có ngưỡng giữ / sửa / dừng được hiệu chỉnh.`);
    add('Điều kiện giao thử', 'Trial = has(B3) ∧ ¬STOP', `${!!p.B3} ∧ ${!lab.halted} = ${!!p.B3 && !lab.halted}`, 'Đầu ra trial, không có bậc; pilot chỉ ghi V, không tự chuyển thành bản kiểm chứng đầy đủ.');
    rows.push(...o.competencies.map((c: any) => ({ id: c.id, name: c.name, value: 'Nháp', detail: 'Không kết luận bậc yêu cầu hoặc cá nhân', data: c })));
    output = [['Bản thử', o.version], ['Khung nháp', o.competencies.length + ' C'], ['Pilot V', f.errors + ' lỗi / ' + f.tasks + ' bài']];
    flow = ['Chọn tạm / soạn nháp', 'AU kiểm phạm vi seed', 'Giao thử → phản hồi V'];
    handoff = 'Pilot V → B4 lượt sau → bổ sung câu hỏi kiểm. Muốn phát hành đầy đủ vẫn cần B4–B8.';
    method = 'Vòng học nhanh có giới hạn';
  }

  const state: DetailState = snap.actual ? (id === 'FAST' ? 'trial' : o._gate === false ? 'actual_blocked' : 'actual_pass') : 'preview';
  const pairs = (rs: [string, any][]): [string, string][] => rs.map(([a, b]) => [a, String(b)]);
  return {
    ...base,
    method,
    state,
    input: pairs(input),
    flow,
    output: pairs(output),
    rows,
    calc,
    gates: toGates(lab, id, rulesOf(o)),
    notes,
    handoff,
    ...(visual ? { visual } : {}),
    raw: o,
    computed_at: computedAt(lab, id, snap.actual),
  };
}

export function fastSummary(lab: Lab): string {
  const f = lab.fast;
  return f ? `${f.version} · ${f.feedback.success}/${f.feedback.tasks} bài seed đạt` : 'Có thể xem trước / giao thử sau B3';
}

export function receiptFor(lab: Lab, id: BlockId): string {
  if (id === 'FAST') return lab.fast ? fastSummary(lab) : 'Chờ đầu vào';
  const o = lab.outputs[id];
  if (!o) return 'Chờ đầu vào';
  if (!o._gate) return '⊘ Không bàn giao';
  const map: Record<string, () => string> = {
    B0: () => o.policy?.version,
    B1: () => o.jds?.length + ' JD',
    B2: () => o.tasks?.length + ' nhiệm vụ',
    B3: () => o.candidates?.length + ' ứng viên C',
    B4: () => o.events?.length + ' sự kiện',
    B5: () => o.selected?.length + ' C · ' + pct(o.coverage),
    B6: () => o.cards?.length + ' chỉ báo',
    B7: () => 'Ứng viên đã kiểm',
    B8: () => 'Lõi v' + o.version,
  };
  return String(map[id]());
}

export function cardsFor(lab: Lab): BlockCard[] {
  const waiting = lab.guide?.pending?.id;
  return BLOCK_IDS.map((id) => {
    const o = id === 'FAST' ? lab.fast : lab.outputs[id];
    const done = id === 'FAST' ? !!o : !!o && o._gate !== false;
    return {
      id,
      name: blockNames[id],
      agent: blockAgents[id],
      artifact: blockArtifacts[id],
      state: waiting === id ? 'awaiting_view' : o ? (done ? 'pass' : 'blocked') : 'idle',
      receipt: receiptFor(lab, id),
      badge: { kind: 'CODE' },
    };
  });
}
