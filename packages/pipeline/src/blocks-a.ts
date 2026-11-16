import type { TraceSource } from '@cl/contract';
import { BLOCK_TASKS, TASKS, runTask, shortModel, type TaskInput, type TaskModel, type TaskName, type TaskOutput } from '@cl/agents';
import { sha256 } from '@cl/db';
import type { CData, Rec } from '@cl/registry';
import { BLOCK_META } from './meta';
import { TraceBuilder, gate, pct, policyRef, ratio, round4, type BlockCtx, type BlockResult, type LoadedDoc, type SnapSegment } from './types';

export const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
export const short = (s: string, n = 90) => (Array.from(s).length > n ? Array.from(s).slice(0, n - 1).join('') + '…' : s);

/** Wraps runTask and remembers which tasks/models an attempt really used. */
export function agentTracker(ctx: BlockCtx) {
  const used = new Map<string, { task_id: string; model: string; effort: string; calls: number; cached: number }>();
  return {
    async run<K extends TaskName>(name: K, input: TaskInput<K>, override?: TaskModel): Promise<{ output: TaskOutput<K>; source: TraceSource }> {
      const r = await runTask(ctx.agent, name, input, override);
      const key = `${name}|${r.model}|${r.effort}`;
      const u = used.get(key) ?? { task_id: TASKS[name].id, model: r.model, effort: r.effort, calls: 0, cached: 0 };
      u.calls++;
      if (r.cacheHit) u.cached++;
      used.set(key, u);
      return { output: r.output, source: { task_id: TASKS[name].id, agent_call_ids: [r.callId], model: shortModel(r.model), effort: r.effort } };
    },
    list: () => [...used.values()],
  };
}
export const mergeSources = (task_id: string, sources: TraceSource[]): TraceSource => {
  const objs = sources.filter((s): s is Exclude<TraceSource, 'CODE'> => s !== 'CODE');
  return { task_id, agent_call_ids: objs.flatMap((s) => s.agent_call_ids ?? []), model: [...new Set(objs.map((s) => s.model))].join(' / '), effort: [...new Set(objs.map((s) => s.effort))].join(' / ') };
};

export function segIndex(docs: LoadedDoc[]) {
  const m = new Map<string, { seg: SnapSegment; doc: LoadedDoc }>();
  for (const d of docs) for (const s of d.segments) m.set(s.id, { seg: s, doc: d });
  return m;
}
const docRecord = (d: LoadedDoc) => ({ tên: d.original_name, nguồn: d.source_ref, 'nhóm nguồn': d.origin_group ?? 'chưa xác định', 'số đoạn': d.segments.length, hash: d.content_sha256.slice(0, 12), 'trích đầu': short(d.text, 220) });
const taskDoc = (d: LoadedDoc) => ({ id: d.ref, segments: d.segments.map((s) => ({ id: s.id, text: s.text })) });

/** Every task the B0–B8 line can call must have a model assigned in the locked snapshot. */
const LINE_TASKS = [...new Set(Object.values(BLOCK_TASKS).flat())];

export async function runB0(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const tb = new TraceBuilder('B0', ctx.attemptId, ctx.now);
  const fields: [string, string, boolean][] = [
    ['Vị trí', s.session.role_title, !!s.session.role_title.trim()],
    ['Mục đích', s.session.purpose, !!s.session.purpose.trim()],
    ['Bộ JD', `${s.documents.length} tài liệu · revision ${s.jd_set.revision}`, s.documents.length > 0],
    ['Release nền', s.base_release_id ? `${s.base_version_label} (${s.base_release_id})` : 'Từ điển rỗng (v0.0)', true],
    ['Policy', `${policyRef(s.policy)} · ngưỡng ${s.policy.thresholds_status}`, !!s.policy?.id],
    ['Cấu hình agent', `${s.agent_config.version} · ${LINE_TASKS.filter((k) => k in s.agent_config.tasks).length}/${LINE_TASKS.length} tác vụ của dây chuyền`, LINE_TASKS.every((k) => k in s.agent_config.tasks)],
  ];
  tb.record('snapshot', 'Snapshot của lượt', { session: s.session, jd_set: s.jd_set, base_release_id: s.base_release_id, policy: policyRef(s.policy), cli_version: s.cli_version, lessons_loaded: s.lessons_loaded.map((l) => l.id) });
  for (const d of ctx.docs) tb.record(d.ref, d.original_name, docRecord(d));
  tb.beat('RECEIVE', 'Nhận snapshot đã khóa của lượt', { explanation: 'Mọi block sau chỉ đọc đúng dữ liệu này; lượt cũ không bao giờ bị sửa.', refs: ['snapshot'], set: { 'trường đã kiểm': 0, 'trường đạt': 0 } });
  let ok = 0;
  fields.forEach(([k, v, pass], i) => {
    if (pass) ok++;
    tb.beat('READ', `Kiểm trường · ${k}`, { refs: ['snapshot'], formula: 'đạt += 1[trường có giá trị hợp lệ]', substitution: `${k} = "${short(v, 70)}" → ${pass ? 1 : 0}; đạt = ${ok}/${i + 1}`, set: { 'trường đã kiểm': i + 1, 'trường đạt': ok }, draft: [{ id: k, value: v || '(thiếu)' }], delta: pass ? `+ ${k}` : `⊘ thiếu ${k}` });
  });
  const mismatched = s.documents.filter((d) => ctx.docs.find((x) => x.ref === d.ref)?.content_sha256 !== d.content_sha256);
  tb.beat('READ', 'Đối chiếu hash tài liệu với snapshot', { refs: ctx.docs.map((d) => d.ref), formula: 'khớp = số tài liệu có sha256 trùng snapshot', substitution: `${s.documents.length - mismatched.length}/${s.documents.length}`, set: { 'hash khớp': `${s.documents.length - mismatched.length}/${s.documents.length}` } });
  const gates = [
    gate('B0', 1, 'Đủ trường bắt buộc', ok === fields.length ? 'PASS' : 'FAIL', `${ok}/${fields.length}`, `= ${fields.length}/${fields.length}`, { refs: ['snapshot'] }),
    gate('B0', 2, 'Tài liệu khớp snapshot', mismatched.length ? 'FAIL' : 'PASS', `${s.documents.length - mismatched.length}/${s.documents.length}`, 'mọi hash khớp'),
  ];
  tb.gates(gates);
  const pass = gates.every((g) => g.status === 'PASS');
  const handoff = pass ? `Charter đã khóa: ${s.session.role_title} · ${s.documents.length} JD · nền ${s.base_version_label}.` : 'Thiếu trường bắt buộc: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao charter cho B1' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { charter: Object.fromEntries(fields.map(([k, v]) => [k, v])), jd_count: s.documents.length, base_release_id: s.base_release_id, policy: policyRef(s.policy) };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, output),
    ai: [],
    view: {
      input: [['Phiên', s.session.name], ['Bộ JD', `${s.documents.length} tài liệu`], ['Release nền', s.base_version_label]],
      output: fields.map(([k, v]) => [k, v]),
      rows: fields.map(([k, v, p]) => ({ id: k, name: k, value: p ? 'đạt' : 'thiếu', detail: v, bad: !p, data: { trường: k, 'giá trị': v } })),
      calc: [{ label: 'Trường bắt buộc', formula: 'đạt = Σ 1[trường có giá trị hợp lệ]', substitution: `${ok}/${fields.length}`, meaning: 'Thiếu một trường thì không có căn cứ để chạy tiếp.' }],
      notes: [`Ngưỡng của policy ${policyRef(s.policy)} là mặc định kỹ thuật, ${s.policy.thresholds_status}.`, ...(s.lessons_loaded.length ? [`Đã nạp ${s.lessons_loaded.length} lesson An toàn từ các lượt trước.`] : [])],
      handoff,
    },
  };
}

export async function runB1(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const tb = new TraceBuilder('B1', ctx.attemptId, ctx.now);
  for (const d of ctx.docs) tb.record(d.ref, d.original_name, docRecord(d));
  const N = ctx.docs.length;
  tb.beat('RECEIVE', `Nhận ${N} JD từ snapshot`, { explanation: 'Code kiểm lỗi parse, trùng và nguồn. Agent chỉ trả lời một câu: JD có đúng role của phiên không.', refs: ctx.docs.map((d) => d.ref), set: { 'đã đọc': 0, 'hợp lệ (V)': 0, 'có nguồn': 0 } });
  const verdicts = await Promise.all(
    ctx.docs.map((d) => (d.segments.length ? ag.run('T1', { role_title: s.session.role_title, purpose: s.session.purpose, context: s.session.context, document: taskDoc(d) }) : Promise.resolve(null))),
  );
  const seen = new Map<string, string>();
  let valid = 0, traced = 0;
  const jds = ctx.docs.map((d, i) => {
    const v = verdicts[i];
    const parse_ok = d.check_status !== 'ERROR' && d.segments.length > 0;
    const duplicate_of = seen.get(d.content_sha256) ?? null;
    if (!duplicate_of) seen.set(d.content_sha256, d.ref);
    const has_source = !!d.source_ref.trim();
    const verdict = v?.output.verdict ?? 'UNSURE';
    const ok = parse_ok && !duplicate_of && verdict === 'IN_SCOPE';
    const why = !parse_ok ? 'lỗi trích văn bản' : duplicate_of ? `trùng nội dung với ${duplicate_of}` : verdict === 'OUT_OF_SCOPE' ? `ngoài phạm vi role (${v?.output.reason_code})` : verdict === 'UNSURE' ? 'chưa chắc đúng role · chờ người dùng quyết' : 'đạt';
    const before = valid;
    if (ok) {
      valid++;
      if (has_source) traced++;
    }
    tb.beat('READ', `Đọc JD ${i + 1}/${N} · ${short(d.original_name, 40)}`, {
      refs: [d.ref],
      explanation: `Phạm vi role do ${v ? 'T1' : 'code'} trả lời: ${verdict}. Kết luận: ${why}.`,
      formula: 'v = 1[parse đạt ∧ không trùng ∧ đúng role]; V = V + v; Trace = JD hợp lệ có nguồn / JD hợp lệ',
      substitution: `v = ${ok ? 1 : 0}; V = ${before} + ${ok ? 1 : 0} = ${valid}; Trace = ${traced}/${valid} = ${pct(ratio(traced, valid))}; lô N = ${N} JD`,
      denominator: { value: valid, note: 'Số JD hợp lệ đã đọc tới nhịp này' },
      set: { 'đã đọc': i + 1, 'hợp lệ (V)': valid, 'có nguồn': traced },
      draft: [{ id: d.ref, value: `${ok ? '✓' : '⊘'} ${short(d.original_name, 40)} · ${why}` }],
      delta: ok ? `+ ${d.ref} hợp lệ` : `⊘ ${d.ref}: ${why}`,
      source: v?.source ?? 'CODE',
    });
    return { ref: d.ref, name: d.original_name, parse_ok, duplicate_of, has_source, verdict, reason_code: v?.output.reason_code ?? null, scope_segments: v?.output.segment_ids ?? [], valid: ok, why, origin_group: d.origin_group };
  });
  const traceRate = ratio(traced, valid);
  const groups = new Set(jds.filter((j) => j.valid && j.origin_group).map((j) => j.origin_group));
  const noGroup = jds.filter((j) => j.valid && !j.origin_group).length;
  tb.beat('READ', 'Chốt số JD hợp lệ và tỷ lệ truy nguồn', { formula: 'Trace = JD hợp lệ có nguồn / JD hợp lệ', substitution: `${traced}/${valid} = ${pct(traceRate)}; nhóm nguồn = ${groups.size}, chưa xác định = ${noGroup}`, denominator: { value: valid, note: 'JD hợp lệ của cả lô' }, set: { 'tỷ lệ truy nguồn': pct(traceRate), 'nhóm nguồn': groups.size } });
  const unsure = jds.filter((j) => j.verdict === 'UNSURE' && j.parse_ok && !j.duplicate_of);
  const gates = [
    gate('B1', 1, 'Số JD hợp lệ', valid >= s.policy.min_valid_jd ? 'PASS' : 'FAIL', valid, `≥ ${s.policy.min_valid_jd} (policy ${policyRef(s.policy)})`, { refs: jds.filter((j) => j.valid).map((j) => j.ref) }),
    valid === 0 ? gate('B1', 2, 'Nguồn truy được', 'NOT_EVALUATED', 'Không tính được', '= 100%', { reason: 'Mẫu số bằng 0: chưa có JD hợp lệ.' }) : gate('B1', 2, 'Nguồn truy được', traceRate === 1 ? 'PASS' : 'FAIL', pct(traceRate), '= 100%'),
    gate('B1', 3, 'JD chưa chắc đúng role', unsure.length ? 'FAIL' : 'PASS', unsure.length, '= 0 (đang bị loại khỏi lượt; bổ sung hoặc bỏ ở lượt mới)', { required: false }),
  ];
  tb.gates(gates);
  const pass = gates.filter((g) => g.required).every((g) => g.status === 'PASS');
  const handoff = pass ? `${valid}/${N} JD hợp lệ, truy nguồn ${pct(traceRate)}.` : 'Chưa đủ JD hợp lệ hoặc thiếu nguồn: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao JD hợp lệ cho B2' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { jds, valid, total: N, traced, trace_rate: traceRate, origin_groups: groups.size, origin_unknown: noGroup, ai_executed: ag.list().length > 0 };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, { valid, traceRate }),
    ai: ag.list(),
    view: {
      input: [['JD trong snapshot', String(N)], ['Role', s.session.role_title]],
      output: [['JD hợp lệ', `${valid}/${N}`], ['Truy nguồn', pct(traceRate)], ['Nhóm nguồn', `${groups.size} (+${noGroup} chưa xác định)`]],
      rows: jds.map((j) => ({ id: j.ref, name: j.name, value: j.valid ? 'hợp lệ' : 'loại', detail: j.why, bad: !j.valid, data: { ref: j.ref, 'parse đạt': j.parse_ok, 'trùng với': j.duplicate_of ?? '—', 'có nguồn': j.has_source, 'phạm vi (T1)': j.verdict, 'mã lý do': j.reason_code ?? '—', 'đoạn căn cứ': j.scope_segments } })),
      calc: [
        { label: 'JD hợp lệ', formula: 'V = Σ 1[parse đạt ∧ không trùng ∧ đúng role]', substitution: `V = ${valid} trên N = ${N}`, meaning: 'Chỉ JD hợp lệ mới được dùng để trích nhiệm vụ và năng lực.' },
        { label: 'Truy nguồn', formula: 'Trace = JD hợp lệ có nguồn / JD hợp lệ', substitution: valid ? `${traced}/${valid} = ${pct(traceRate)}` : 'Mẫu số 0 → Không tính được', meaning: 'Mọi kết luận phía sau phải lần ngược được về tài liệu gốc.' },
      ],
      notes: unsure.length ? [`${unsure.length} JD chưa chắc đúng role đã bị loại khỏi lượt này: ${unsure.map((j) => j.name).join(', ')}.`] : [],
      handoff,
    },
  };
}

export interface LiveTask {
  id: string;
  statement: string;
  segment_ids: string[];
  jd_refs: string[];
  weight: number;
}

export async function runB2(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const tb = new TraceBuilder('B2', ctx.attemptId, ctx.now);
  const validRefs = new Set((ctx.prev.B1!.jds as any[]).filter((j) => j.valid).map((j) => j.ref));
  const docs = ctx.docs.filter((d) => validRefs.has(d.ref));
  const segs = segIndex(docs);
  for (const d of docs) tb.record(d.ref, d.original_name, docRecord(d));
  tb.beat('RECEIVE', `Nhận ${docs.length} JD hợp lệ từ B1`, { refs: docs.map((d) => d.ref), set: { 'nhiệm vụ thô': 0, 'nhiệm vụ sau gộp': 0, 'Σw': 0 } });
  const extracted = await Promise.all(docs.map((d) => ag.run('T2', { role_title: s.session.role_title, document: taskDoc(d) })));
  const raw: { id: string; statement: string; segment_ids: string[]; doc: string }[] = [];
  docs.forEach((d, i) => {
    const before = raw.length;
    extracted[i].output.tasks.forEach((t, k) => raw.push({ id: `${d.ref}:t${k + 1}`, statement: t.statement, segment_ids: t.segment_ids.filter((x) => segs.has(x)), doc: d.ref }));
    tb.beat('READ', `Trích nhiệm vụ · ${short(d.original_name, 40)}`, { refs: [d.ref], formula: 'thô = thô + số nhiệm vụ trích được', substitution: `${before} + ${raw.length - before} = ${raw.length}`, set: { 'nhiệm vụ thô': raw.length }, delta: `+ ${raw.length - before} nhiệm vụ thô`, source: extracted[i].source });
  });
  let groups = raw.map((r) => ({ member_ids: [r.id], canonical_member_id: r.id }));
  let mergeSource: TraceSource = 'CODE';
  if (raw.length > 1) {
    const m = await ag.run('T3', { role_title: s.session.role_title, tasks: raw.map((r) => ({ id: r.id, statement: r.statement })) });
    groups = m.output.groups;
    mergeSource = m.source;
  }
  const byId = new Map(raw.map((r) => [r.id, r]));
  const used = new Set<string>();
  const tasks: LiveTask[] = groups
    .map((g) => {
      const members = g.member_ids.map((id) => byId.get(id)!).filter(Boolean);
      const canon = byId.get(g.canonical_member_id) ?? members[0];
      let id = 'T-' + sha256(norm(canon.statement)).slice(0, 8);
      while (used.has(id)) id += 'x';
      used.add(id);
      const jd_refs = [...new Set(members.map((m) => m.doc))].sort();
      return { id, statement: canon.statement, segment_ids: [...new Set(members.flatMap((m) => m.segment_ids))].sort(), jd_refs, weight: round4(jd_refs.length / docs.length) };
    })
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  tb.beat('READ', 'Gộp nhiệm vụ tương đương giữa các JD', { formula: 'sau gộp = số nhóm tương đương', substitution: `${raw.length} nhiệm vụ thô → ${tasks.length} nhóm`, set: { 'nhiệm vụ sau gộp': tasks.length }, source: mergeSource, explanation: raw.length > 1 ? 'T3 chia nhóm; code kiểm mỗi ID thuộc đúng một nhóm.' : 'Chỉ có một nhiệm vụ: không cần gọi T3.' });
  let sum = 0;
  for (const t of tasks) {
    const before = sum;
    sum = round4(sum + t.weight);
    tb.record(t.id, short(t.statement, 60), { 'nhiệm vụ': t.statement, 'JD nêu': t.jd_refs, 'đoạn nguồn': t.segment_ids.map((x) => `${x}: ${short(segs.get(x)?.seg.text ?? '', 100)}`) });
    tb.beat('READ', `Trọng số · ${short(t.statement, 44)}`, { refs: [t.id, ...t.jd_refs], formula: 'w = số JD hợp lệ nêu nhiệm vụ / số JD hợp lệ; Σw = Σw + w', substitution: `w = ${t.jd_refs.length}/${docs.length} = ${t.weight}; Σw = ${before} + ${t.weight} = ${sum}`, denominator: { value: docs.length, note: 'Số JD hợp lệ từ B1' }, set: { 'Σw': sum }, draft: [{ id: t.id, value: `${short(t.statement, 70)} · w ${t.weight}` }], delta: `+ ${t.id}` });
  }
  const noSeg = tasks.filter((t) => !t.segment_ids.length);
  const gates = [
    gate('B2', 1, 'Có nhiệm vụ', tasks.length > 0 ? 'PASS' : 'FAIL', tasks.length, '≥ 1'),
    tasks.length ? gate('B2', 2, 'Mỗi nhiệm vụ có đoạn nguồn', noSeg.length ? 'FAIL' : 'PASS', `${tasks.length - noSeg.length}/${tasks.length}`, 'mọi nhiệm vụ ≥ 1 đoạn hợp lệ', { refs: noSeg.map((t) => t.id) }) : gate('B2', 2, 'Mỗi nhiệm vụ có đoạn nguồn', 'NOT_EVALUATED', 'Không tính được', 'mọi nhiệm vụ ≥ 1 đoạn hợp lệ', { reason: 'Không có nhiệm vụ nào.' }),
  ];
  tb.gates(gates);
  const pass = gates.every((g) => g.status === 'PASS');
  const handoff = pass ? `Khóa ${tasks.length} nhiệm vụ, Σw = ${sum}. Mã chuẩn nghề: UNVERIFIED (người dùng chưa cung cấp).` : 'Không có nhiệm vụ có nguồn: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao danh sách nhiệm vụ đã khóa cho B3' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { tasks, raw_count: raw.length, sum_w: sum, valid_jd: docs.length, occupation_code: 'UNVERIFIED', ai_executed: true };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, { tasks: tasks.length, sum_w: sum }),
    ai: ag.list(),
    view: {
      input: [['JD hợp lệ', String(docs.length)]],
      output: [['Nhiệm vụ', `${tasks.length} (từ ${raw.length} câu thô)`], ['Σw', String(sum)]],
      rows: tasks.map((t) => ({ id: t.id, name: t.statement, value: `w ${t.weight}`, detail: `${t.jd_refs.length}/${docs.length} JD nêu`, bad: !t.segment_ids.length, data: { 'nhiệm vụ': t.statement, 'trọng số': t.weight, 'JD nêu': t.jd_refs, 'đoạn nguồn': t.segment_ids.map((x) => `${x}: ${segs.get(x)?.seg.text ?? ''}`) } })),
      calc: [{ label: 'Trọng số nhiệm vụ', formula: 'w = số JD hợp lệ nêu nhiệm vụ / số JD hợp lệ', substitution: tasks.slice(0, 3).map((t) => `${t.jd_refs.length}/${docs.length} = ${t.weight}`).join(' · ') || '—', meaning: 'Nhiệm vụ nhiều JD cùng nêu thì nặng hơn khi tính độ phủ ở B5.' }],
      notes: ['Câu nhiệm vụ do agent T2 viết theo khuôn; trọng số do code tính.'],
      handoff,
    },
  };
}

export interface LiveGroup {
  id: string;
  competency_id: string;
  label: string;
  definition: string;
  aliases: string[];
  segment_ids: string[];
  jd_refs: string[];
  decision: 'REUSE' | 'UPDATE' | 'ADD' | 'NEEDS_REVIEW';
  boundary: string;
  confidence: string;
  base_version: number | null;
  base_label: string | null;
  base_definition: string | null;
  shortlist: string[];
}

const trigrams = (s: string) => {
  const p = `  ${norm(s)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
};
const jaccard = <T,>(a: Set<T>, b: Set<T>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};
export interface CandidateRetriever {
  shortlist(candidate: { label: string; definition: string }, base: Rec<CData>[], k?: number): { rec: Rec<CData>; score: number }[];
}
/** Lexical retrieval (trigram on names/aliases, token overlap on definitions). A vector retriever can replace it later. */
export const lexicalRetriever: CandidateRetriever = {
  shortlist(c, base, k = 3) {
    const lt = trigrams(c.label);
    const dt = new Set(norm(c.definition).split(' ').filter((w) => w.length > 2));
    return base
      .filter((b) => b.data.status === 'ACTIVE')
      .map((rec) => {
        const name = Math.max(jaccard(lt, trigrams(rec.data.label)), ...rec.data.aliases.map((a) => jaccard(lt, trigrams(a))), 0);
        const def = jaccard(dt, new Set(norm(rec.data.definition).split(' ').filter((w) => w.length > 2)));
        return { rec, score: round4(Math.max(name, 0.7 * def)) };
      })
      .filter((x) => x.score >= 0.3)
      .sort((a, b) => b.score - a.score || a.rec.id.localeCompare(b.rec.id))
      .slice(0, k);
  },
};

export async function runB3(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const tb = new TraceBuilder('B3', ctx.attemptId, ctx.now);
  const validRefs = new Set((ctx.prev.B1!.jds as any[]).filter((j) => j.valid).map((j) => j.ref));
  const docs = ctx.docs.filter((d) => validRefs.has(d.ref));
  const segs = segIndex(docs);
  for (const d of docs) tb.record(d.ref, d.original_name, docRecord(d));
  for (const c of ctx.base.C) tb.record(c.id, `Từ điển nền · ${c.data.label}`, { id: c.id, mã: c.data.display_code, tên: c.data.label, 'định nghĩa': c.data.definition, alias: c.data.aliases, 'phiên bản': c.version });
  tb.beat('RECEIVE', `Nhận ${docs.length} JD hợp lệ và từ điển nền ${ctx.base.versionLabel} (${ctx.base.C.length} năng lực)`, { refs: docs.map((d) => d.ref), set: { 'ứng viên thô': 0, 'nhóm ứng viên': 0, REUSE: 0, UPDATE: 0, ADD: 0, NEEDS_REVIEW: 0 } });
  const extracted = await Promise.all(docs.map((d) => ag.run('T4', { role_title: s.session.role_title, document: taskDoc(d) })));
  const raw: { id: string; label: string; definition: string; segment_ids: string[]; doc: string }[] = [];
  docs.forEach((d, i) => {
    const before = raw.length;
    extracted[i].output.competencies.forEach((c, k) => raw.push({ id: `${d.ref}:c${k + 1}`, label: c.label, definition: c.definition, segment_ids: c.segment_ids.filter((x) => segs.has(x)), doc: d.ref }));
    tb.beat('READ', `Trích ứng viên · ${short(d.original_name, 40)}`, { refs: [d.ref], formula: 'thô = thô + số ứng viên trích được', substitution: `${before} + ${raw.length - before} = ${raw.length}`, set: { 'ứng viên thô': raw.length }, delta: `+ ${raw.length - before} ứng viên thô`, source: extracted[i].source });
  });
  let clusters = raw.map((r) => ({ member_ids: [r.id], canonical_member_id: r.id }));
  let clusterSource: TraceSource = 'CODE';
  if (raw.length > 1) {
    const m = await ag.run('T5', { candidates: raw.map((r) => ({ id: r.id, label: r.label, definition: r.definition })) });
    clusters = m.output.groups;
    clusterSource = m.source;
  }
  const byId = new Map(raw.map((r) => [r.id, r]));
  const pre = clusters.map((g) => {
    const members = g.member_ids.map((id) => byId.get(id)!).filter(Boolean);
    const canon = byId.get(g.canonical_member_id) ?? members[0];
    return { canon, members, segment_ids: [...new Set(members.flatMap((m) => m.segment_ids))].sort(), jd_refs: [...new Set(members.map((m) => m.doc))].sort(), aliases: [...new Set(members.map((m) => m.label).filter((l) => norm(l) !== norm(canon.label)))].sort() };
  });
  tb.beat('READ', 'Gom ứng viên cùng nội hàm', { formula: 'nhóm = số cụm cùng nội hàm', substitution: `${raw.length} ứng viên thô → ${pre.length} nhóm`, set: { 'nhóm ứng viên': pre.length }, source: clusterSource, explanation: raw.length > 1 ? 'T5 gom theo định nghĩa, không theo tên. Code kiểm mỗi ID thuộc đúng một nhóm.' : 'Chỉ có một ứng viên: không cần gọi T5.' });

  const matched = await Promise.all(
    pre.map(async (g) => {
      const sl = lexicalRetriever.shortlist(g.canon, ctx.base.C);
      if (!sl.length) return { g, sl, m: null as null | Awaited<ReturnType<typeof ag.run<'T6'>>> };
      const m = await ag.run('T6', {
        candidate: { id: g.canon.id, label: g.canon.label, definition: g.canon.definition, segments: g.segment_ids.slice(0, 8).map((id) => ({ id, text: segs.get(id)!.seg.text })) },
        shortlist: sl.map((x) => ({ competency_id: x.rec.id, label: x.rec.data.label, definition: x.rec.data.definition, aliases: x.rec.data.aliases })),
      });
      return { g, sl, m };
    }),
  );
  const counts = { REUSE: 0, UPDATE: 0, ADD: 0, NEEDS_REVIEW: 0 };
  const groups: LiveGroup[] = [];
  let mergedDup = 0;
  for (const { g, sl, m } of matched) {
    const decision = m?.output.decision ?? 'ADD';
    const target = m?.output.target_competency_id ? ctx.base.C.find((c) => c.id === m.output.target_competency_id) ?? null : null;
    const competency_id = decision === 'ADD' || !target ? 'C-' + sha256(`${ctx.workspaceId}|${norm(g.canon.label)}`).slice(0, 10) : target.id;
    const existing = groups.find((x) => x.competency_id === competency_id);
    if (existing) {
      // Two groups resolved to the same competency: code merges them so no duplicate concept is handed on.
      mergedDup++;
      existing.segment_ids = [...new Set([...existing.segment_ids, ...g.segment_ids])].sort();
      existing.jd_refs = [...new Set([...existing.jd_refs, ...g.jd_refs])].sort();
      existing.aliases = [...new Set([...existing.aliases, g.canon.label, ...g.aliases])].filter((a) => norm(a) !== norm(existing.label)).sort();
      tb.beat('READ', `Gộp trùng · ${short(g.canon.label, 40)} → ${existing.label}`, { refs: target ? [target.id] : [], explanation: 'Hai nhóm cùng trỏ về một năng lực: code gộp, giữ đủ đoạn nguồn.', draft: [{ id: existing.id, value: `${existing.decision} · ${existing.label} · ${existing.jd_refs.length} JD` }], delta: `↻ gộp vào ${existing.id}` });
      continue;
    }
    counts[decision]++;
    const grp: LiveGroup = {
      id: 'G-' + sha256(norm(g.canon.label)).slice(0, 8),
      competency_id,
      label: decision === 'REUSE' && target ? target.data.label : g.canon.label,
      definition: decision === 'REUSE' && target ? target.data.definition : g.canon.definition,
      aliases: decision === 'REUSE' && target ? [...new Set([...g.aliases, ...(norm(g.canon.label) !== norm(target.data.label) ? [g.canon.label] : [])])] : g.aliases,
      segment_ids: g.segment_ids,
      jd_refs: g.jd_refs,
      decision,
      boundary: m?.output.boundary_code ?? 'DIFFERENT',
      confidence: m?.output.confidence ?? 'HIGH',
      base_version: target?.version ?? null,
      base_label: target?.data.label ?? null,
      base_definition: target?.data.definition ?? null,
      shortlist: sl.map((x) => `${x.rec.id} (${x.score})`),
    };
    groups.push(grp);
    tb.record(grp.id, grp.label, { nhãn: grp.label, 'định nghĩa': grp.definition, 'JD nêu': grp.jd_refs, 'đoạn nguồn': grp.segment_ids.map((x) => `${x}: ${short(segs.get(x)?.seg.text ?? '', 100)}`), 'C nền gần giống': grp.shortlist });
    tb.beat('READ', `Đối chiếu · ${short(grp.label, 44)}`, {
      refs: [grp.id, ...sl.map((x) => x.rec.id)],
      explanation: sl.length ? `Code tìm được ${sl.length} năng lực nền gần giống; T6 so nội hàm: ${decision} (${grp.boundary}, tin cậy ${grp.confidence}).` : 'Không có năng lực nền nào gần giống: không gọi T6, nhóm là ADD.',
      formula: `${decision} = ${decision} + 1`,
      substitution: `${counts[decision] - 1} + 1 = ${counts[decision]}`,
      set: { ...counts },
      draft: [{ id: grp.id, value: `${decision} · ${grp.label} · ${grp.jd_refs.length} JD` }],
      delta: `+ ${grp.id} ${decision}`,
      source: m?.source ?? 'CODE',
    });
  }
  const noSeg = groups.filter((g) => !g.segment_ids.length);
  const ids = groups.map((g) => g.competency_id);
  const dupLeft = ids.length - new Set(ids).size;
  const gates = [
    gate('B3', 1, 'Có ứng viên năng lực', groups.length ? 'PASS' : 'FAIL', groups.length, '≥ 1'),
    groups.length ? gate('B3', 2, 'Mọi ứng viên có đoạn nguồn', noSeg.length ? 'FAIL' : 'PASS', `${groups.length - noSeg.length}/${groups.length}`, 'mọi nhóm ≥ 1 đoạn hợp lệ', { refs: noSeg.map((g) => g.id) }) : gate('B3', 2, 'Mọi ứng viên có đoạn nguồn', 'NOT_EVALUATED', 'Không tính được', 'mọi nhóm ≥ 1 đoạn hợp lệ', { reason: 'Không có ứng viên nào.' }),
    gate('B3', 3, 'Không còn trùng chưa xử lý', dupLeft ? 'FAIL' : 'PASS', dupLeft, '= 0'),
    gate('B3', 4, 'Precision / Recall / F1', 'NOT_EVALUATED', 'Không tính được', 'cần bộ gold độc lập', { required: false, reason: 'Phiên này không có bộ gold độc lập để so.' }),
  ];
  tb.gates(gates);
  const pass = gates.filter((g) => g.required).every((g) => g.status === 'PASS');
  const handoff = pass ? `${groups.length} nhóm ứng viên: ${counts.ADD} ADD · ${counts.UPDATE} UPDATE · ${counts.REUSE} REUSE · ${counts.NEEDS_REVIEW} cần xem lại.` : 'Ứng viên thiếu nguồn hoặc còn trùng: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao nhóm ứng viên cho B4 (và mở nhánh giao thử)' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { groups, raw_count: raw.length, counts, merged_duplicates: mergedDup, base_version: ctx.base.versionLabel, ai_executed: true };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, counts),
    ai: ag.list(),
    view: {
      input: [['JD hợp lệ', String(docs.length)], ['Từ điển nền', `${ctx.base.versionLabel} · ${ctx.base.C.length} năng lực`]],
      output: [['Nhóm ứng viên', `${groups.length} (từ ${raw.length} thô)`], ['ADD / UPDATE / REUSE', `${counts.ADD} / ${counts.UPDATE} / ${counts.REUSE}`], ['Cần xem lại', String(counts.NEEDS_REVIEW)]],
      rows: groups.map((g) => ({ id: g.id, name: g.label, value: g.decision, detail: `${g.jd_refs.length} JD · ${g.segment_ids.length} đoạn`, bad: g.decision === 'NEEDS_REVIEW' || !g.segment_ids.length, data: { nhãn: g.label, 'định nghĩa': g.definition, 'quyết định': g.decision, 'ranh giới nghĩa': g.boundary, 'độ tin cậy': g.confidence, 'năng lực nền': g.base_label ? `${g.competency_id} · ${g.base_label} (v${g.base_version})` : '—', alias: g.aliases, 'JD nêu': g.jd_refs, 'đoạn nguồn': g.segment_ids.map((x) => `${x}: ${segs.get(x)?.seg.text ?? ''}`) } })),
      calc: [{ label: 'Precision / Recall / F1', formula: 'P = TP/(TP+FP) · R = TP/(TP+FN) · F1 = 2TP/(2TP+FP+FN)', substitution: 'Chưa đánh giá: không có bộ gold độc lập', meaning: 'Chỉ tính khi có danh sách chuẩn do người độc lập lập.' }],
      notes: ['Tên giống nhau chưa đủ để gộp: T6 so định nghĩa và đoạn căn cứ.', ...(counts.NEEDS_REVIEW ? [`${counts.NEEDS_REVIEW} nhóm cần người xem lại; chúng không vào bản công bố.`] : []), ...(mergedDup ? [`Code đã gộp ${mergedDup} nhóm trùng về cùng một năng lực.`] : [])],
      handoff,
      visual: { kind: 'b3', jdCount: docs.length, candidates: groups.map((g) => ({ id: g.id, name: g.label, alias: g.aliases.length > 0, evidence: g.segment_ids })), unique: groups.length },
    },
  };
}

export async function runFAST(ctx: BlockCtx): Promise<BlockResult> {
  const tb = new TraceBuilder('FAST', ctx.attemptId, ctx.now);
  const groups = (ctx.prev.B3!.groups as LiveGroup[]).filter((g) => g.decision !== 'NEEDS_REVIEW');
  for (const g of groups) tb.record(g.id, g.label, { nhãn: g.label, 'định nghĩa': g.definition, 'đoạn nguồn': g.segment_ids });
  tb.beat('RECEIVE', `Nhận ${groups.length} nhóm ứng viên từ B3`, { explanation: 'Nhánh nhanh không gọi agent, không ghi W/C/R và không qua B8.', refs: groups.map((g) => g.id), set: { 'mục bản thử': 0 } });
  groups.forEach((g, i) => tb.beat('READ', `Đưa vào bản thử · ${short(g.label, 44)}`, { refs: [g.id], formula: 'mục = mục + 1', substitution: `${i} + 1 = ${i + 1}`, set: { 'mục bản thử': i + 1 }, draft: [{ id: g.competency_id, value: `${g.label} · bậc chưa xác định · chỉ báo chưa có` }], delta: `+ ${g.competency_id}` }));
  const unchecked = ['Chưa kiểm sự kiện (B4)', 'Chưa tính độ phủ nhiệm vụ (B5)', 'Chưa có chỉ báo và dịch ngược (B6)', 'Chưa tổng nghiệm thu (B7)', 'Chưa kiểm toán và duyệt (B8)'];
  tb.beat('READ', 'Gắn phạm vi dùng và phần chưa kiểm', { explanation: unchecked.join(' · '), set: { 'phạm vi': 'phát triển' } });
  const noSeg = groups.filter((g) => !g.segment_ids.length);
  const gates = [gate('FAST', 1, 'Truy nguồn bản thử', groups.length && !noSeg.length ? 'PASS' : 'FAIL', `${groups.length - noSeg.length}/${groups.length}`, 'mọi mục có đoạn nguồn'), gate('FAST', 2, 'Phạm vi dùng thử', 'PASS', 'phát triển', '= phát triển (không dùng để đánh giá, tuyển chọn)')];
  tb.gates(gates);
  const pass = gates.every((g) => g.status === 'PASS');
  const handoff = pass ? `Bản thử ${groups.length} năng lực, chỉ dùng cho phát triển. Chưa qua B4–B8.` : 'Bản thử thiếu nguồn: không giao.';
  tb.beat('HANDOFF', pass ? 'Ghi bản thử vào kho V của lượt' : 'Chặn · không giao', { explanation: handoff });
  const output = { version: `thử-${ctx.snapshot.base_version_label}`, scope: 'phát triển', unchecked, competencies: groups.map((g) => ({ id: g.competency_id, name: g.label, definition: g.definition, evidence: g.segment_ids })), evidence_class: 'JD', ai_executed: false };
  return { status: pass ? 'DONE' : 'BLOCKED', output, gates, trace: tb.build(gates, { n: groups.length }), ai: [], view: { input: [['Nhóm ứng viên từ B3', String(groups.length)]], output: [['Bản thử', `${groups.length} năng lực`], ['Phạm vi', 'phát triển']], rows: groups.map((g) => ({ id: g.competency_id, name: g.label, value: 'bản thử', detail: `${g.segment_ids.length} đoạn nguồn`, data: { nhãn: g.label, 'định nghĩa': g.definition, 'đoạn nguồn': g.segment_ids } })), calc: [], notes: unchecked, handoff } };
}
export { BLOCK_META };
