import type { ProgressStep, TraceSource } from '@cl/contract';
import { inArray } from 'drizzle-orm';
import { BLOCK_TASKS, DEFAULT_AGENT_CONFIG, TASKS, runTask, shortModel, type TaskInput, type TaskModel, type TaskName, type TaskOutput } from '@cl/agents';
import { sha256, t } from '@cl/db';
import type { CData, Rec } from '@cl/registry';
import { BLOCK_META } from './meta';
import { BATCH_CHARS, ShortIds, linesOf, maskedText, nearDuplicates, pack, precluster, prepareDoc, textSimilarity } from './prep';
import { anchorOccupation, catalogLines, externalTasks, loadReference } from './occupation';
import { ageMonths, DATASET_UNDATED_D, isDatasetSource, MAX_JD_AGE_MONTHS, tooOld, cohenKappa, evidenceWeight, g1, lensL, lensM, libraryCoverage, marketScore, recencyD, reliabilityE, seedOf, seededShuffle, sourceRank, type Rank } from './formulas';
import { TraceBuilder, deviationGate, gate, pct, policyRef, ratio, round4, type BlockCtx, type BlockResult, type LoadedDoc, type SnapSegment } from './types';

/** E4M passes in B3: the second one runs on the result of the first and is skipped when the first merged nothing. */
const E4M_ROUNDS = 2;

export const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
export const short = (s: string, n = 90) => (Array.from(s).length > n ? Array.from(s).slice(0, n - 1).join('') + '…' : s);

/**
 * Wraps runTask, remembers which tasks/models an attempt really used, and publishes live progress:
 * per agent step, how many calls were issued and how many are finished. A step issues all its calls at once
 * (they wait in the CLI semaphore), so "issued" is that step's total.
 */
export function agentTracker(ctx: BlockCtx) {
  const used = new Map<string, { task_id: string; model: string; effort: string; calls: number; cached: number }>();
  const steps = new Map<string, ProgressStep>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite = 0;
  const write = () => {
    timer = null;
    lastWrite = Date.now();
    const updatedAt = new Date().toISOString();
    const value = [...steps.values()];
    void ctx.agent.db.insert(t.attemptProgress).values({ attemptId: ctx.attemptId, steps: value, updatedAt }).onConflictDoUpdate({ target: t.attemptProgress.attemptId, set: { steps: value, updatedAt } }).catch(() => {});
  };
  const publish = () => {
    if (timer) return;
    timer = setTimeout(write, Math.max(0, 700 - (Date.now() - lastWrite)));
  };
  return {
    async run<K extends TaskName>(name: K, input: TaskInput<K>, override?: TaskModel): Promise<{ output: TaskOutput<K>; source: TraceSource }> {
      // a run snapshot taken before a task existed has no entry for it: the default config answers
      const tm = override ?? ctx.agent.config.tasks[name] ?? DEFAULT_AGENT_CONFIG.tasks[name];
      const step = steps.get(name) ?? { task_id: TASKS[name].id, title: TASKS[name].title, model: shortModel(tm.model), total: 0, done: 0, cached: 0, failed: 0 };
      if (!step.model.split('/').includes(shortModel(tm.model))) step.model += '/' + shortModel(tm.model);
      step.total++;
      steps.set(name, step);
      publish();
      let r;
      try {
        r = await runTask(ctx.agent, name, input, override);
      } catch (e) {
        step.failed++;
        publish();
        throw e;
      }
      step.done++;
      if (r.cacheHit) step.cached++;
      publish();
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

/**
 * Partition tasks (T3/T5) for sets too large for one call. Up to PART_ONE items go in a single call, as before.
 * Beyond that: sort by text so near-identical items sit together, partition each chunk, then partition the
 * chunk representatives once more to merge groups that were split across chunks.
 */
const PART_ONE = 100;
const PART_REDUCE = 250;
type Part = { member_ids: string[]; canonical_member_id: string };
export async function partitionBatched<T extends { id: string }>(items: T[], text: (t: T) => string, call: (part: T[]) => Promise<{ output: { groups: Part[] }; source: TraceSource }>): Promise<{ groups: Part[]; source: TraceSource; calls: number }> {
  if (items.length <= PART_ONE) {
    const m = await call(items);
    return { groups: m.output.groups, source: m.source, calls: 1 };
  }
  const chunk = (xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const sorted = [...items].sort((a, b) => norm(text(a)).localeCompare(norm(text(b))) || a.id.localeCompare(b.id));
  const first = await Promise.all(chunk(sorted, PART_ONE).map(call));
  const level1 = first.flatMap((m) => m.output.groups);
  const byId = new Map(items.map((x) => [x.id, x]));
  const reps = level1.map((g) => byId.get(g.canonical_member_id)!).sort((a, b) => norm(text(a)).localeCompare(norm(text(b))) || a.id.localeCompare(b.id));
  const second = await Promise.all(chunk(reps, PART_REDUCE).map((part) => (part.length > 1 ? call(part) : Promise.resolve({ output: { groups: part.map((x) => ({ member_ids: [x.id], canonical_member_id: x.id })) }, source: first[0].source }))));
  const membersOf = new Map(level1.map((g) => [g.canonical_member_id, g.member_ids]));
  const groups = second.flatMap((m) => m.output.groups).map((g) => ({ canonical_member_id: g.canonical_member_id, member_ids: g.member_ids.flatMap((id) => membersOf.get(id) ?? [id]).sort() }));
  return { groups: groups.sort((a, b) => a.member_ids[0].localeCompare(b.member_ids[0])), source: first[0].source, calls: first.length + second.length };
}

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
  // charter (white paper 4.1) and the maker/checker model pairs of formula (2)
  const ch = s.session.charter ?? {};
  const charterVals: Record<string, string> = { role_title: s.session.role_title, purpose: s.session.purpose, industry: s.session.industry ?? '', level: ch.level ?? '', framework_type: ch.framework_type ?? '', rigor: s.policy.rigor ?? '', decision: ch.decision ?? '', owner: ch.owner ?? '' };
  const required = s.policy.charter_required ?? ['role_title', 'purpose'];
  const charterMissing = required.filter((k) => !charterVals[k]?.trim());
  tb.calc({ substep: 'B0.charter', formula: 'đủ trường = mọi trường bắt buộc của bộ ngưỡng có giá trị', inputs: { required }, output: { missing: charterMissing } });
  const cfg = s.agent_config;
  const pairs = [
    { step: 'B3', maker: 'E1', checker: 'E9', makerModel: cfg.tasks.E1?.model, checkerModels: [cfg.tasks.E9?.model] },
    { step: 'B6', maker: 'E6', checker: 'E7 (3 ghế)', makerModel: cfg.tasks.E6?.model, checkerModels: cfg.seats.map((x) => x.model) },
  ];
  const samePairs = pairs.filter((x) => x.checkerModels.some((m) => m && m === x.makerModel));
  for (const x of pairs) tb.calc({ substep: 'B0.independence', item_ref: x.step, formula: 'agent làm ≠ agent kiểm (model khác nhau) — (2)', inputs: { maker: `${x.maker} ${x.makerModel}`, checker: `${x.checker} ${x.checkerModels.join('/')}` }, output: { ok: !samePairs.includes(x) } });
  tb.beat('READ', 'Kiểm charter và cặp agent làm / kiểm', { formula: 'G0 = (đủ trường) ∧ (H khớp) ∧ (agent làm ≠ agent kiểm ở mọi bước) — (2)', substitution: `thiếu ${charterMissing.length} trường; ${pairs.length - samePairs.length}/${pairs.length} cặp khác model`, set: { 'cặp khác model': `${pairs.length - samePairs.length}/${pairs.length}` } });
  const mismatched = s.documents.filter((d) => ctx.docs.find((x) => x.ref === d.ref)?.content_sha256 !== d.content_sha256);
  tb.beat('READ', 'Đối chiếu hash tài liệu với snapshot', { refs: ctx.docs.map((d) => d.ref), formula: 'khớp = số tài liệu có sha256 trùng snapshot', substitution: `${s.documents.length - mismatched.length}/${s.documents.length}`, set: { 'hash khớp': `${s.documents.length - mismatched.length}/${s.documents.length}` } });
  const gates = [
    gate('B0', 1, 'Đủ trường bắt buộc', ok === fields.length ? 'PASS' : 'FAIL', `${ok}/${fields.length}`, `= ${fields.length}/${fields.length}`, { refs: ['snapshot'] }),
    gate('B0', 2, 'Tài liệu khớp snapshot', mismatched.length ? 'FAIL' : 'PASS', `${s.documents.length - mismatched.length}/${s.documents.length}`, 'mọi hash khớp'),
    !charterMissing.length
      ? gate('B0', 3, 'Charter đủ trường', 'PASS', `${required.length}/${required.length}`, `đủ ${required.join(', ')}`)
      : s.policy.id === 'dev-small'
        ? deviationGate('B0', 3, 'Charter đủ trường', `thiếu ${charterMissing.join(', ')}`, `đủ ${required.join(', ')}`, `Bộ ngưỡng phát triển cho phép thiếu ${charterMissing.join(', ')}.`, 'Khung không gắn được cấp bậc, ngành hoặc loại khung; chỉ dùng nội bộ.')
        : gate('B0', 3, 'Charter đủ trường', 'FAIL', `thiếu ${charterMissing.join(', ')}`, `đủ ${required.join(', ')}`),
    gate('B0', 4, 'Agent làm khác model agent kiểm', samePairs.length ? 'FAIL' : 'PASS', samePairs.length ? samePairs.map((x) => `${x.maker} = ${x.checker} (${x.makerModel})`).join('; ') : `${pairs.length}/${pairs.length} cặp`, 'mọi cặp làm / kiểm dùng model khác nhau — (2)'),
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
  // --- code before AI (P1): K8 cut off-job sections, K7 generic sentences, K2 masking, K1 near-duplicates ---
  const prepared = new Map(ctx.docs.map((d) => [d.ref, prepareDoc(d)]));
  const dups = nearDuplicates(ctx.docs.map((d) => ({ ref: d.ref, text: d.text, content_sha256: d.content_sha256 })));
  const cutOff = [...prepared.values()].reduce((a, p) => a + p.cut_off_job.length, 0);
  const cutGeneric = [...prepared.values()].reduce((a, p) => a + p.cut_generic.length, 0);
  const maskedHits = [...prepared.values()].reduce((a, p) => a + p.masked, 0);
  for (const d of ctx.docs) {
    const p = prepared.get(d.ref)!;
    if (p.cut_off_job.length || p.cut_generic.length) tb.calc({ substep: 'B1.cut', item_ref: d.ref, formula: 'đoạn gửi AI = đoạn − mục không mô tả công việc (K8) − câu chung chung (K7)', inputs: { segments: d.segments.length, off_job: p.cut_off_job.length, generic: p.cut_generic.length }, output: { sent: p.segments.length } });
    const dup = dups.get(d.ref);
    if (dup) tb.calc({ substep: 'B1.near_duplicate', item_ref: d.ref, formula: 'J(a, b) = |S(a) ∩ S(b)| / |S(a) ∪ S(b)| trên 3-gram từ; trùng khi J ≥ 0,85', inputs: { of: dup.of }, output: { j: dup.j }, decision: 'kế thừa kết quả của bản gốc, không gửi AI' });
  }
  tb.beat('READ', 'Chuẩn bị trước khi gửi AI (code)', { explanation: 'Cắt mục giới thiệu công ty, phúc lợi, cách ứng tuyển, địa chỉ; bỏ câu chung chung; che email, số điện thoại, tên người liên hệ; JD trùng gần đúng kế thừa kết quả của bản gốc.', formula: 'gửi AI = JD không trùng; đoạn gửi = đoạn − cắt', substitution: `${ctx.docs.length - dups.size}/${N} JD gửi AI · cắt ${cutOff} đoạn ngoài công việc, ${cutGeneric} câu chung chung · che ${maskedHits} chỗ`, set: { 'JD trùng gần đúng': dups.size, 'đoạn đã cắt': cutOff + cutGeneric } });

  // --- E1: one call reads a batch of JDs (scope + tasks + competency candidates) ---
  type Read = { verdict: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'UNSURE'; reason_code: string; criteria: { A: number; B: number; C: number }; scope_segments: string[]; tasks: { statement: string; segment_ids: string[] }[]; competencies: { label: string; definition: string; segment_ids: string[] }[]; source: TraceSource };
  const reads = new Map<string, Read>();
  // Per-JD memo: a JD already read (same text, role and prompt) is not sent again just because the batch around it changed
  const tm = ctx.agent.config.tasks.E1;
  const itemKey = (d: LoadedDoc) => sha256(JSON.stringify({ item: TASKS.E1.id, p: TASKS.E1.promptVersion, s: TASKS.E1.schemaVersion, model: tm.model, effort: tm.effort, rerun: ctx.agent.rerun?.E1 ?? 0, role: s.session.role_title, level: s.session.charter?.level ?? '', industry: s.session.industry ?? '', purpose: s.session.purpose, context: s.session.context, ref: d.ref, segs: prepared.get(d.ref)!.segments }));
  // SOP: postings older than 24 months are dropped before any AI call
  const stale = new Set(ctx.docs.filter((d) => tooOld(d.posted_at, ctx.now)).map((d) => d.ref));
  for (const d of ctx.docs) if (stale.has(d.ref)) tb.calc({ substep: 'B1.age', item_ref: d.ref, formula: `tuổi tin = hôm nay − ngày đăng; loại khi > ${MAX_JD_AGE_MONTHS} tháng (SOP)`, inputs: { posted_at: d.posted_at, now: ctx.now.slice(0, 10) }, output: { months: Math.round(ageMonths(d.posted_at, ctx.now)! * 10) / 10 }, decision: 'loại: quá hạn, không gửi AI' });
  const candidates = ctx.docs.filter((d) => !dups.has(d.ref) && !stale.has(d.ref) && prepared.get(d.ref)!.segments.length);
  if (!ctx.agent.bypassCache && candidates.length) {
    const rows = await ctx.agent.db.select({ taskKey: t.agentResult.taskKey, output: t.agentResult.output }).from(t.agentResult).where(inArray(t.agentResult.taskKey, candidates.map(itemKey)));
    const hit = new Map(rows.map((r) => [r.taskKey, r.output as Read]));
    for (const d of candidates) {
      const r = hit.get(itemKey(d));
      if (r) reads.set(d.ref, { ...r, source: { task_id: TASKS.E1.id, agent_call_ids: [], model: shortModel(tm.model), effort: tm.effort } });
    }
  }
  const toRead = candidates.filter((d) => !reads.has(d.ref));
  const batches = pack(toRead, (d) => prepared.get(d.ref)!.segments.reduce((a, x) => a + x.text.length + 6, 40), BATCH_CHARS(), 20);
  await Promise.all(
    batches.map(async (batch) => {
      const ids = new ShortIds();
      const jds = batch.map((d) => ({ id: ids.short('j', d.ref), text: linesOf(prepared.get(d.ref)!.segments, ids) }));
      const r = await ag.run('E1', { role_title: s.session.role_title, level: s.session.charter?.level ?? '', industry: s.session.industry ?? '', purpose: s.session.purpose, context: s.session.context, jds });
      for (const x of r.output.jds) {
        const ref = ids.long(x.id)!;
        const read: Read = { verdict: x.verdict, reason_code: x.reason_code, criteria: { A: Number(x.criteria.A), B: Number(x.criteria.B), C: Number(x.criteria.C) }, scope_segments: ids.longs(x.scope_segment_ids), tasks: x.tasks.map((t) => ({ statement: t.statement, segment_ids: ids.longs(t.segment_ids).sort() })), competencies: x.competencies.map((c) => ({ label: c.label, definition: c.definition, segment_ids: ids.longs(c.segment_ids).sort() })), source: r.source };
        reads.set(ref, read);
        const d = batch.find((y) => y.ref === ref)!;
        const { source: _s, ...item } = read;
        await ctx.agent.db.insert(t.agentResult).values({ taskKey: itemKey(d), taskId: `${TASKS.E1.id}#item`, inputCanonical: JSON.stringify({ ref, segments: prepared.get(ref)!.segments.length }), output: item, firstCallId: (r.source as any).agent_call_ids?.[0] ?? 'item' }).onConflictDoNothing();
      }
    }),
  );
  const seen = new Map<string, string>();
  let valid = 0, traced = 0;
  const jds = ctx.docs.map((d, i) => {
    const near = dups.get(d.ref) ?? null;
    const v = reads.get(near?.of ?? d.ref) ?? null;
    const parse_ok = d.check_status !== 'ERROR' && d.segments.length > 0;
    const exact = seen.get(d.content_sha256) ?? null;
    if (!exact) seen.set(d.content_sha256, d.ref);
    const duplicate_of = exact ?? near?.of ?? null;
    const has_source = !!d.source_ref.trim();
    const verdict = v?.verdict ?? 'UNSURE';
    const old = stale.has(d.ref);
    const ok = parse_ok && !duplicate_of && !old && verdict === 'IN_SCOPE';
    const why = !parse_ok ? 'lỗi trích văn bản' : old ? `tin đăng ${d.posted_at}, quá ${MAX_JD_AGE_MONTHS} tháng (SOP)` : duplicate_of ? `trùng nội dung với ${duplicate_of}${near && near.j < 1 ? ` (J = ${near.j})` : ''}` : verdict === 'OUT_OF_SCOPE' ? `ngoài phạm vi role (${v?.reason_code})` : verdict === 'UNSURE' ? (v ? 'chưa chắc đúng role · chờ người dùng quyết' : 'không còn đoạn mô tả công việc sau khi cắt') : 'đạt';
    const before = valid;
    if (ok) {
      valid++;
      if (has_source) traced++;
    }
    tb.beat('READ', `Đọc JD ${i + 1}/${N} · ${short(d.original_name, 40)}`, {
      refs: [d.ref],
      explanation: `Phạm vi role do ${v ? 'E1' : 'code'} trả lời: ${verdict}. Kết luận: ${why}.`,
      formula: 'v = 1[parse đạt ∧ không trùng ∧ đúng role]; V = V + v; Trace = JD hợp lệ có nguồn / JD hợp lệ',
      substitution: `v = ${ok ? 1 : 0}; V = ${before} + ${ok ? 1 : 0} = ${valid}; Trace = ${traced}/${valid} = ${pct(ratio(traced, valid))}; lô N = ${N} JD`,
      denominator: { value: valid, note: 'Số JD hợp lệ đã đọc tới nhịp này' },
      set: { 'đã đọc': i + 1, 'hợp lệ (V)': valid, 'có nguồn': traced },
      draft: [{ id: d.ref, value: `${ok ? '✓' : '⊘'} ${short(d.original_name, 40)} · ${why}` }],
      delta: ok ? `+ ${d.ref} hợp lệ` : `⊘ ${d.ref}: ${why}`,
      source: v && !duplicate_of ? v.source : 'CODE',
      calc: [
        { substep: 'B1.duplicate', item_ref: d.ref, formula: 'trùng = 1[sha256 trùng ∨ J ≥ 0,85]', inputs: { sha256: d.content_sha256.slice(0, 16) }, output: { duplicate_of, j: near?.j ?? (exact ? 1 : null) }, decision: duplicate_of ? 'loại: trùng' : 'giữ' },
        { substep: 'B1.valid', item_ref: d.ref, formula: 'v = 1[parse đạt ∧ không trùng ∧ đúng role]', inputs: { parse_ok, duplicate: !!duplicate_of, verdict, has_source }, output: { v: ok ? 1 : 0, V: valid, traced }, decision: ok ? 'giữ' : `loại: ${why}` },
      ],
    });
    const p = prepared.get(d.ref)!;
    // (5)–(7): A, B, C suggested by E1 (inherited by a near-duplicate); D from the posting date, E from the source kind
    const cr = v?.criteria ?? { A: 0, B: 0, C: 0 };
    const undatedDataset = !d.posted_at && isDatasetSource(d.source_kind, d.source_ref);
    const D = undatedDataset ? DATASET_UNDATED_D : recencyD(d.posted_at ?? null, ctx.now);
    const E = reliabilityE(d.source_kind, d.source_ref, d.source_url);
    const L = lensL(cr.A, cr.C, D, E);
    const M = lensM(cr.A, cr.B, cr.C, D, E);
    const rank = sourceRank(L, M);
    if (ok) tb.calc({ substep: 'B1.rank', item_ref: d.ref, formula: 'L = 3A + 2C + D + E; M = 3B + 2C + D + E (A ≥ 2); hạng theo max(L, M) — (5)–(7); không rõ ngày đăng thì D = 0, riêng tin từ dataset Hugging Face coi như trong 24 tháng (D = 1)', inputs: { A: cr.A, B: cr.B, C: cr.C, D, E, posted_at: d.posted_at ?? null, ...(undatedDataset ? { posted_at_assumed: '≤ 24 tháng (dataset)' } : {}) }, output: { L, M, rank } });
    return { ref: d.ref, name: d.original_name, parse_ok, criteria: { ...cr, D, E }, L, M, rank: ok ? rank : null, duplicate_of, near_duplicate_j: near?.j ?? null, has_source, verdict, reason_code: v?.reason_code ?? null, scope_segments: v?.scope_segments ?? [], valid: ok, why, posted_at: d.posted_at ?? null, too_old: old, origin_group: d.origin_group, cut_off_job: p.cut_off_job, cut_generic: p.cut_generic, masked: p.masked };
  });
  // what E1 extracted, handed to B2 (tasks) and B3 (candidates); only valid JDs count
  const extracted = Object.fromEntries(jds.filter((j) => j.valid).map((j) => [j.ref, { tasks: reads.get(j.ref)?.tasks ?? [], competencies: reads.get(j.ref)?.competencies ?? [], source: reads.get(j.ref)?.source ?? 'CODE' }]));
  const traceRate = ratio(traced, valid);
  const groups = new Set(jds.filter((j) => j.valid && j.origin_group).map((j) => j.origin_group));
  const noGroup = jds.filter((j) => j.valid && !j.origin_group).length;
  tb.beat('READ', 'Chốt số JD hợp lệ và tỷ lệ truy nguồn', { formula: 'Trace = JD hợp lệ có nguồn / JD hợp lệ', substitution: `${traced}/${valid} = ${pct(traceRate)}; nhóm nguồn = ${groups.size}, chưa xác định = ${noGroup}`, denominator: { value: valid, note: 'JD hợp lệ của cả lô' }, set: { 'tỷ lệ truy nguồn': pct(traceRate), 'nhóm nguồn': groups.size } });
  const unsure = jds.filter((j) => j.verdict === 'UNSURE' && j.parse_ok && !j.duplicate_of);
  const nP1 = jds.filter((j) => j.valid && j.rank === 'P1').length;
  const ranks = { P1: nP1, P2: jds.filter((j) => j.valid && j.rank === 'P2').length, P3: jds.filter((j) => j.valid && j.rank === 'P3').length };
  const minP1 = s.policy.min_p1 ?? 0;
  tb.beat('READ', 'Xếp hạng nguồn P1 / P2 / P3', { formula: 'hạng = P1 nếu max(L, M) ≥ 18; P2 nếu 13–17; P3 nếu ≤ 12 — (7)', substitution: `P1 ${ranks.P1} · P2 ${ranks.P2} · P3 ${ranks.P3}`, set: { 'JD hạng P1': ranks.P1 } });
  const gates = [
    gate('B1', 1, 'Số JD hợp lệ và số JD hạng P1', g1(valid, nP1, s.policy.min_valid_jd, minP1) ? 'PASS' : 'FAIL', `N = ${valid}, N_P1 = ${nP1}`, `N ≥ ${s.policy.min_valid_jd} ∧ N_P1 ≥ ${minP1} — (8), bộ ngưỡng ${policyRef(s.policy)}`, { refs: jds.filter((j) => j.valid).map((j) => j.ref) }),
    valid === 0 ? gate('B1', 2, 'Nguồn truy được', 'NOT_EVALUATED', 'Không tính được', '= 100%', { reason: 'Mẫu số bằng 0: chưa có JD hợp lệ.' }) : gate('B1', 2, 'Nguồn truy được', traceRate === 1 ? 'PASS' : 'FAIL', pct(traceRate), '= 100%'),
    gate('B1', 3, 'JD chưa chắc đúng role', unsure.length ? 'FAIL' : 'PASS', unsure.length, '= 0 (đang bị loại khỏi lượt; bổ sung hoặc bỏ ở lượt mới)', { required: false }),
  ];
  tb.gates(gates);
  const pass = gates.filter((g) => g.required).every((g) => g.status === 'PASS');
  const handoff = pass ? `${valid}/${N} JD hợp lệ, truy nguồn ${pct(traceRate)}.` : 'Chưa đủ JD hợp lệ hoặc thiếu nguồn: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao JD hợp lệ cho B2' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { jds, valid, ranks, total: N, traced, trace_rate: traceRate, origin_groups: groups.size, origin_unknown: noGroup, extracted, prep: { too_old: stale.size, undated: ctx.docs.filter((d) => !d.posted_at).length, near_duplicates: dups.size, cut_off_job: cutOff, cut_generic: cutGeneric, masked: maskedHits, e1_calls: batches.length }, ai_executed: ag.list().length > 0 };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, { valid, traceRate }),
    ai: ag.list(),
    view: {
      input: [['JD trong snapshot', String(N)], ['Role', s.session.role_title]],
      output: [['JD hợp lệ', `${valid}/${N}`], ['Truy nguồn', pct(traceRate)], ['Nhóm nguồn', `${groups.size} (+${noGroup} chưa xác định)`]],
      rows: jds.map((j) => ({ id: j.ref, name: j.name, value: j.valid ? 'hợp lệ' : 'loại', detail: j.why, bad: !j.valid, data: { ref: j.ref, 'parse đạt': j.parse_ok, 'trùng với': j.duplicate_of ?? '—', 'có nguồn': j.has_source, 'phạm vi (E1)': j.verdict, 'mã lý do': j.reason_code ?? '—', 'đoạn căn cứ': j.scope_segments } })),
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
  for (const d of docs) tb.record(d.ref, d.original_name, { tên: d.original_name, nguồn: d.source_ref }); // the full record is in B1's trace
  tb.beat('RECEIVE', `Nhận ${docs.length} JD hợp lệ từ B1`, { refs: docs.map((d) => d.ref), set: { 'nhiệm vụ thô': 0, 'nhiệm vụ sau gộp': 0, 'Σw': 0 } });
  // tasks were extracted by E1 in B1 (one read per JD); B2 only reviews the clusters
  const fromB1 = (ctx.prev.B1!.extracted ?? {}) as Record<string, { tasks: { statement: string; segment_ids: string[] }[]; source: TraceSource }>;
  const raw: { id: string; statement: string; segment_ids: string[]; doc: string }[] = [];
  docs.forEach((d) => {
    const before = raw.length;
    const ex = fromB1[d.ref];
    (ex?.tasks ?? []).forEach((t, k) => raw.push({ id: `${d.ref}:t${k + 1}`, statement: t.statement, segment_ids: t.segment_ids.filter((x) => segs.has(x)), doc: d.ref }));
    tb.beat('READ', `Nhiệm vụ của · ${short(d.original_name, 40)}`, { refs: [d.ref], formula: 'thô = thô + số nhiệm vụ E1 trích được', substitution: `${before} + ${raw.length - before} = ${raw.length}`, set: { 'nhiệm vụ thô': raw.length }, delta: `+ ${raw.length - before} nhiệm vụ thô`, source: ex?.source ?? 'CODE' });
  });
  // K5: code groups near-identical statements first; E2+E3 only returns the edits
  const sorted = [...raw].sort((a, b) => norm(a.statement).localeCompare(norm(b.statement)) || a.id.localeCompare(b.id));
  const pre = precluster(sorted, (r) => r.statement).map((members, i) => ({ id: `K${i + 1}`, members: members.map((m) => m.id) }));
  tb.beat('READ', 'Gom sơ bộ bằng code (K5)', { formula: 'cụm = nhóm câu giống ≥ 0,8 (trigram ký tự)', substitution: `${raw.length} nhiệm vụ thô → ${pre.length} cụm sơ bộ`, set: { 'cụm sơ bộ': pre.length } });
  const byRaw = new Map(raw.map((r) => [r.id, r]));
  let groups: { member_ids: string[]; canonical_member_id: string }[] = [];
  let mergeSource: TraceSource = 'CODE';
  let pick: { vn_code: string; title: string; reason: string } | null = null;
  const ref = loadReference();
  if (raw.length > 1) {
    const chunks = pack(pre, (c) => c.members.reduce((a, id) => a + byRaw.get(id)!.statement.length + 16, 20), BATCH_CHARS());
    const results = await Promise.all(
      chunks.map(async (chunk, ci) => {
        const ids = new ShortIds();
        const clusters = chunk.map((c) => ({ id: ids.short('k', c.id), tasks: c.members.map((m) => ({ id: ids.short('t', m), statement: byRaw.get(m)!.statement })) }));
        // the occupation list goes with the first call only; the others just review clusters
        const r = await ag.run('E23', { role_title: s.session.role_title, catalog: ci === 0 && ref ? catalogLines(ref) : '', clusters });
        return { chunk, ids, r };
      }),
    );
    mergeSource = mergeSources('E23.task_review', results.map((x) => x.r.source));
    pick = results[0]?.r.output.occupation ?? null;
    // apply the edits: splits first (move tasks into a new cluster), then merges
    const cl = new Map(pre.map((c) => [c.id, { members: [...c.members], canonical: null as string | null }]));
    let extra = 0;
    for (const { ids, r } of results) {
      for (const sp of r.output.splits) {
        const cid = ids.long(sp.cluster_id)!;
        const c = cl.get(cid)!;
        // a task moves once: one already moved by an earlier split of the same cluster stays where it went
        const move = new Set(ids.longs(sp.task_ids).filter((m) => c.members.includes(m)));
        if (!move.size || move.size >= c.members.length) continue;
        c.members = c.members.filter((m) => !move.has(m));
        cl.set(`${cid}.s${++extra}`, { members: [...move], canonical: null });
      }
      for (const m of r.output.merges) {
        const cids = ids.longs(m.cluster_ids).filter((c) => cl.has(c));
        if (cids.length < 2) continue;
        const [head, ...rest] = cids;
        for (const c of rest) (cl.get(head)!.members.push(...cl.get(c)!.members), cl.delete(c));
        cl.get(head)!.canonical = ids.long(m.canonical_id) ?? null;
      }
      tb.beat('READ', 'Duyệt cụm nhiệm vụ (E2+E3)', { formula: 'cụm = cụm sơ bộ − gộp + tách', substitution: `${r.output.merges.length} lần gộp, ${r.output.splits.length} lần tách`, source: r.source, calc: { substep: 'B2.review', formula: 'chỉ áp phần sửa AI trả về', inputs: { clusters: r.output.merges.length + r.output.splits.length }, output: { merges: r.output.merges.length, splits: r.output.splits.length } } });
    }
    // canonical: AI's choice for merged clusters, else the statement most JDs share, then the longest
    groups = [...cl.values()].filter((c) => c.members.length).map((c) => {
      const freq = new Map<string, number>();
      for (const m of c.members) freq.set(norm(byRaw.get(m)!.statement), (freq.get(norm(byRaw.get(m)!.statement)) ?? 0) + 1);
      const best = [...c.members].sort((a, b) => (freq.get(norm(byRaw.get(b)!.statement))! - freq.get(norm(byRaw.get(a)!.statement))!) || byRaw.get(b)!.statement.length - byRaw.get(a)!.statement.length || a.localeCompare(b))[0];
      return { member_ids: [...c.members].sort(), canonical_member_id: c.canonical && c.members.includes(c.canonical) ? c.canonical : best };
    });
  } else groups = raw.map((r) => ({ member_ids: [r.id], canonical_member_id: r.id }));
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
  tb.beat('READ', 'Gộp nhiệm vụ tương đương giữa các JD', { formula: 'sau gộp = số nhóm tương đương', substitution: `${raw.length} nhiệm vụ thô → ${tasks.length} nhóm`, set: { 'nhiệm vụ sau gộp': tasks.length }, source: mergeSource, explanation: raw.length > 1 ? 'Code gom sơ bộ, E2+E3 chỉ trả phần sửa (gộp, tách); code kiểm mã và áp phần sửa.' : 'Chỉ có một nhiệm vụ: không cần gọi AI.' });
  let sum = 0;
  for (const t of tasks) {
    const before = sum;
    sum = round4(sum + t.weight);
    // the full segment list is in the block output; the trace keeps the first few so it stays small (spec §3.2)
    tb.record(t.id, short(t.statement, 60), { 'nhiệm vụ': t.statement, 'JD nêu': t.jd_refs, 'số đoạn nguồn': t.segment_ids.length, 'đoạn nguồn': t.segment_ids.slice(0, 3).map((x) => `${x}: ${short(segs.get(x)?.seg.text ?? '', 80)}`) });
    tb.beat('READ', `Trọng số · ${short(t.statement, 44)}`, { refs: [t.id, ...t.jd_refs], formula: 'w = số JD hợp lệ nêu nhiệm vụ / số JD hợp lệ; Σw = Σw + w', substitution: `w = ${t.jd_refs.length}/${docs.length} = ${t.weight}; Σw = ${before} + ${t.weight} = ${sum}`, denominator: { value: docs.length, note: 'Số JD hợp lệ từ B1' }, set: { 'Σw': sum }, draft: [{ id: t.id, value: `${short(t.statement, 70)} · w ${t.weight}` }], delta: `+ ${t.id}`, calc: { substep: 'B2.weight', item_ref: t.id, formula: 'w = số JD hợp lệ nêu nhiệm vụ / số JD hợp lệ', inputs: { jd_mentions: t.jd_refs.length, valid_jds: docs.length }, output: { w: t.weight, sum_w: sum } } });
  }
  // G2: E23 picked a VN code from the catalog; code checks it and follows ISCO-08 to the external standard (O*NET)
  const anchor = ref && pick?.vn_code ? anchorOccupation(ref, pick.vn_code, s.session.role_title, tasks.map((t) => t.statement)) : null;
  const external = ref && anchor ? externalTasks(ref, anchor.external.map((x) => x.onet_soc)) : [];
  const occupation = anchor ? { ...anchor, reason: pick!.reason, versions: ref!.versions, attribution: ref!.attribution } : null;
  if (anchor) {
    tb.record(`VN-${anchor.vn_code}`, `Nghề ${anchor.vn_code} · ${anchor.title_vi}`, { 'mã nghề VN': anchor.vn_code, 'tên nghề': anchor.title_vi, 'ISCO-08': anchor.isco08 ?? '—', 'ghi chú ISCO': anchor.isco08_note ?? '—', 'nghề chuẩn ngoài': anchor.external.map((x) => `${x.onet_soc} ${x.title} (${x.reason})`), 'lý do (E23)': pick!.reason, nguồn: `${ref!.versions.vsco}; ${ref!.versions.onet}` });
    tb.beat('READ', `Neo nghề · ${anchor.vn_code} ${short(anchor.title_vi, 40)}`, { refs: [`VN-${anchor.vn_code}`], explanation: `E23 chọn mã trong Danh mục nghề nghiệp Việt Nam; code nối ISCO-08 ${anchor.isco08 ?? '—'} sang ${anchor.external.length} nghề O*NET và lấy ${external.length} nhiệm vụ có điểm Importance (ω = 3 ở B3).`, source: mergeSource, calc: { substep: 'B2.occupation', item_ref: anchor.vn_code, formula: 'mã VN ∈ danh mục; ISCO-08 theo danh mục; nghề chuẩn ngoài theo bảng nối ISCO-08 → O*NET', inputs: { vn_code: anchor.vn_code, isco08: anchor.isco08 }, output: { onet: anchor.external.map((x) => x.onet_soc), tasks: external.length }, decision: anchor.external.length ? 'đạt' : 'không có nghề chuẩn ngoài' } });
  }
  const g2ok = !!anchor && anchor.external.length > 0;
  const noSeg = tasks.filter((t) => !t.segment_ids.length);
  const gates = [
    gate('B2', 1, 'Có nhiệm vụ', tasks.length > 0 ? 'PASS' : 'FAIL', tasks.length, '≥ 1'),
    tasks.length ? gate('B2', 2, 'Mỗi nhiệm vụ có đoạn nguồn', noSeg.length ? 'FAIL' : 'PASS', `${tasks.length - noSeg.length}/${tasks.length}`, 'mọi nhiệm vụ ≥ 1 đoạn hợp lệ', { refs: noSeg.map((t) => t.id) }) : gate('B2', 2, 'Mỗi nhiệm vụ có đoạn nguồn', 'NOT_EVALUATED', 'Không tính được', 'mọi nhiệm vụ ≥ 1 đoạn hợp lệ', { reason: 'Không có nhiệm vụ nào.' }),
    g2ok
      ? gate('B2', 3, 'Neo nghề (mã nghề Việt Nam, nghề chuẩn ngoài)', 'PASS', `${anchor!.vn_code} ${anchor!.title_vi} · ISCO-08 ${anchor!.isco08} · ${anchor!.external.map((x) => x.onet_soc).join(', ')}`, 'có mã nghề Việt Nam ∧ ≥ 1 nghề chuẩn ngoài kèm lý do')
      : deviationGate('B2', 3, 'Neo nghề (mã nghề Việt Nam, nghề chuẩn ngoài)', !ref ? 'chưa nạp danh mục' : anchor ? `${anchor.vn_code} ${anchor.title_vi}, không có nghề O*NET nối được` : 'chưa chọn được mã', 'có mã nghề Việt Nam ∧ ≥ 1 nghề chuẩn ngoài kèm lý do', !ref ? 'Thiếu data/reference (Danh mục nghề nghiệp Việt Nam, O*NET).' : anchor ? `Nhóm ISCO-08 ${anchor.isco08 ?? '—'} không có nghề O*NET trong bảng nối.` : raw.length > 1 ? 'E23 không tìm được nghề khớp trong danh mục.' : 'Chỉ có một nhiệm vụ: không gọi AI để neo nghề.', 'Không so được nhiệm vụ của khung với nghề chuẩn; không có câu yêu cầu từ nguồn chuẩn ngoài (ω = 3).'),
  ];
  tb.gates(gates);
  const pass = gates.every((g) => g.status === 'PASS');
  const handoff = pass ? `Khóa ${tasks.length} nhiệm vụ, Σw = ${sum}. Nghề: ${anchor ? `${anchor.vn_code} ${anchor.title_vi}${external.length ? `, ${external.length} nhiệm vụ O*NET cho B3` : ''}` : 'chưa neo được'}.` : 'Không có nhiệm vụ có nguồn: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao danh sách nhiệm vụ đã khóa cho B3' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { tasks, raw_count: raw.length, sum_w: sum, valid_jd: docs.length, occupation_code: anchor?.vn_code || 'UNVERIFIED', occupation, external_tasks: external, ai_executed: raw.length > 1 };
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
  // candidates were extracted by E1 in B1
  const fromB1 = (ctx.prev.B1!.extracted ?? {}) as Record<string, { competencies: { label: string; definition: string; segment_ids: string[] }[]; source: TraceSource }>;
  const raw: { id: string; label: string; definition: string; segment_ids: string[]; doc: string }[] = [];
  docs.forEach((d) => {
    const before = raw.length;
    const ex = fromB1[d.ref];
    (ex?.competencies ?? []).forEach((c, k) => raw.push({ id: `${d.ref}:c${k + 1}`, label: c.label, definition: c.definition, segment_ids: c.segment_ids.filter((x) => segs.has(x)), doc: d.ref }));
    tb.beat('READ', `Ứng viên của · ${short(d.original_name, 40)}`, { refs: [d.ref], formula: 'thô = thô + số ứng viên E1 trích được', substitution: `${before} + ${raw.length - before} = ${raw.length}`, set: { 'ứng viên thô': raw.length }, delta: `+ ${raw.length - before} ứng viên thô`, source: ex?.source ?? 'CODE' });
  });
  // K5: near-identical name AND definition join by code (a shared name alone is not enough)
  const textOf = (r: { label: string; definition: string }) => `${r.label} — ${r.definition}`;
  const sortedRaw = [...raw].sort((a, b) => norm(a.label).localeCompare(norm(b.label)) || a.id.localeCompare(b.id));
  type Cl = { id: string; members: string[] };
  let cls: Cl[] = precluster(sortedRaw, textOf).map((ms, i) => ({ id: `K${i + 1}`, members: ms.map((m) => m.id) }));
  const byId = new Map(raw.map((r) => [r.id, r]));
  const canonOf = (c: Cl) => byId.get(c.members[0])!;
  tb.beat('READ', 'Gom sơ bộ bằng code (K5)', { formula: 'cụm = nhóm ứng viên giống ≥ 0,8 (tên + định nghĩa)', substitution: `${raw.length} ứng viên thô → ${cls.length} cụm sơ bộ`, set: { 'nhóm ứng viên': cls.length } });
  // K4: look up the dictionary first; a sure match (same name, near-identical definition) is decided by code
  const shortlists = new Map(cls.map((c) => [c.id, lexicalRetriever.shortlist(canonOf(c), ctx.base.C)]));
  const sure = new Map<string, string>();
  for (const c of cls) {
    const sl = shortlists.get(c.id)!;
    const top = sl[0];
    const cn = canonOf(c);
    if (ctx.base.C.length) tb.calc({ substep: 'B3.similarity', item_ref: cn.id, formula: 'score = max(Jaccard(trigram tên), 0,7 × Jaccard(từ định nghĩa)); giữ score ≥ 0,3, lấy 3 cao nhất', inputs: { base_size: ctx.base.C.length }, output: { shortlist: sl.map((x) => ({ id: x.rec.id, score: x.score })) }, decision: sl.length ? 'có năng lực gần giống' : 'không có năng lực gần giống → ADD' });
    if (top && (norm(top.rec.data.label) === norm(cn.label) || top.rec.data.aliases.some((x) => norm(x) === norm(cn.label))) && textSimilarity(top.rec.data.definition, cn.definition) >= 0.95) {
      sure.set(c.id, top.rec.id);
      tb.calc({ substep: 'B3.dictionary_lookup', item_ref: cn.id, formula: 'dùng lại khi trùng tên ∧ giống định nghĩa ≥ 0,95 (K4)', inputs: { target: top.rec.id }, output: { similarity: Math.round(textSimilarity(top.rec.data.definition, cn.definition) * 1000) / 1000 }, decision: 'REUSE (code, không gửi AI)' });
    }
  }
  // E4: one call per batch reviews the clusters (merges only) and decides the dictionary match of those with a near competency
  type Match = { decision: 'REUSE' | 'UPDATE' | 'ADD' | 'NEEDS_REVIEW'; target_competency_id: string; boundary_code: 'SAME_MEANING' | 'NARROWER' | 'BROADER' | 'OVERLAP_PARTIAL' | 'DIFFERENT'; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; alternative_id: string };
  const matchOf = new Map<string, { m: Match; source: TraceSource }>();
  let clusterSource: TraceSource = 'CODE';
  const toReview = cls.filter((c) => !sure.has(c.id));
  // O*NET tasks of the anchored occupation (B2): E4 says which clusters they support; each counts ω = 3 in (12)
  const external = ((ctx.prev.B2?.external_tasks ?? []) as { ref: string; statement: string; importance: number; onet_soc: string }[]);
  const extOf = new Map<string, Set<string>>();
  if (toReview.length > 1 || toReview.some((c) => shortlists.get(c.id)!.length) || (external.length && toReview.length)) {
    // every call carries the whole O*NET task list, so the clusters get what is left of the batch
    const extChars = external.reduce((a, x) => a + x.statement.length + 20, 0);
    const chunks = pack(toReview, (c) => textOf(canonOf(c)).length + shortlists.get(c.id)!.slice(0, 2).reduce((a, x) => a + x.rec.data.label.length + x.rec.data.definition.length + 20, 30), Math.max(2000, BATCH_CHARS() - extChars));
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const ids = new ShortIds();
        const clusters = chunk.map((c) => {
          const cn = canonOf(c);
          return { id: ids.short('k', c.id), label: cn.label, definition: cn.definition, aliases: [...new Set(c.members.map((m) => byId.get(m)!.label).filter((l) => norm(l) !== norm(cn.label)))].sort(), near: shortlists.get(c.id)!.slice(0, 2).map((x) => ({ id: ids.short('d', x.rec.id), label: x.rec.data.label, definition: x.rec.data.definition })) };
        });
        const r = await ag.run('E4', { clusters, external_tasks: external.map((x) => ({ id: ids.short('x', x.ref), statement: x.statement })) });
        return { ids, r };
      }),
    );
    clusterSource = mergeSources('E4.candidate_review', results.map((x) => x.r.source));
    const index = new Map(cls.map((c) => [c.id, c]));
    for (const { ids, r } of results) {
      for (const sp of r.output.support) {
        const cid = ids.long(sp.cluster_id)!;
        extOf.set(cid, new Set([...(extOf.get(cid) ?? []), ...ids.longs(sp.task_ids)]));
      }
      for (const m of r.output.matches) {
        const cid = ids.long(m.cluster_id)!;
        const alt = shortlists.get(cid)!.map((x) => x.rec.id).find((x) => x !== ids.long(m.target_id)) ?? '';
        matchOf.set(cid, { m: { decision: m.decision, target_competency_id: m.target_id ? ids.long(m.target_id) ?? '' : '', boundary_code: m.boundary_code, confidence: m.confidence, alternative_id: alt }, source: r.source });
      }
      for (const m of r.output.merges) {
        const cids = ids.longs(m.cluster_ids).filter((c) => index.has(c));
        const head = ids.long(m.canonical_id) && index.has(ids.long(m.canonical_id)!) ? ids.long(m.canonical_id)! : cids[0];
        if (cids.length < 2) continue;
        for (const c of cids) if (c !== head) (index.get(head)!.members.push(...index.get(c)!.members), index.delete(c), extOf.set(head, new Set([...(extOf.get(head) ?? []), ...(extOf.get(c) ?? [])])));
      }
      tb.beat('READ', 'Duyệt cụm ứng viên và so từ điển (E4)', { formula: 'cụm = cụm sơ bộ − gộp; quyết định cho cụm có năng lực gần giống', substitution: `${r.output.merges.length} lần gộp · ${r.output.matches.length} quyết định`, source: r.source });
    }
    // E4 merges only clusters of the same meaning, inside one batch. E4M (Sonnet) then sees every cluster at once and
    // merges to the grain of a framework competency: skill-level variants of one competency, wherever they fell.
    // A second pass runs on the result of the first: merging A into B can make B and C visibly the same competency
    // (Project Manager, 20/11/2026: three "rủi ro" clusters left after one pass). It stops when a pass merges nothing.
    const jdCount = (c: { members: string[] }) => new Set(c.members.map((id) => byId.get(id)?.doc)).size;
    const mergeSourcesE4M: TraceSource[] = [];
    for (let round = 1; round <= E4M_ROUNDS && index.size > 1; round++) {
      const heads = [...index.values()].sort((a, b) => norm(canonOf(a).label).localeCompare(norm(canonOf(b).label)));
      // compact (name + 80 characters of definition + JD count) in ONE call (≈ 260 clusters) so every pair can meet: split into
      // several calls, variants of one competency on both sides of a split stayed apart (Project Manager, 20/11/2026)
      const passes = pack(heads, (c) => canonOf(c).label.length + Math.min(80, canonOf(c).definition.length) + 40, Number(process.env.AGENT_MERGE_CHARS || 34000));
      const merged = await Promise.all(
        passes.map(async (part) => {
          const ids = new ShortIds();
          const clusters = part.map((c) => ({ id: ids.short('k', c.id), label: canonOf(c).label, definition: short(canonOf(c).definition, 80), jds: jdCount(c) }));
          return { ids, r: await ag.run('E4M', { role_title: s.session.role_title, clusters }) };
        }),
      );
      let n = 0;
      for (const { ids, r } of merged)
        for (const m of r.output.merges) {
          const cids = ids.longs(m.cluster_ids).filter((c) => index.has(c));
          const head = ids.long(m.canonical_id) && index.has(ids.long(m.canonical_id)!) ? ids.long(m.canonical_id)! : cids[0];
          if (cids.length < 2) continue;
          n++;
          // the head keeps its own dictionary decision; O*NET support is pooled
          for (const c of cids) if (c !== head) (index.get(head)!.members.push(...index.get(c)!.members), index.delete(c), extOf.set(head, new Set([...(extOf.get(head) ?? []), ...(extOf.get(c) ?? [])])), matchOf.has(head) || !matchOf.has(c) ? null : matchOf.set(head, matchOf.get(c)!));
        }
      const roundSource = mergeSources('E4M.granularity_merge', merged.map((x) => x.r.source));
      mergeSourcesE4M.push(roundSource);
      tb.beat('READ', `Gộp về mức năng lực của khung (E4M, lượt ${round})`, { formula: 'cụm = cụm − gộp; một lượt nhìn toàn bộ danh sách cụm', substitution: `${heads.length} cụm → ${index.size} cụm (${n} lần gộp)`, source: roundSource, explanation: 'E4 chỉ gộp cụm cùng nội hàm trong một lô; lượt này gộp các biến thể chi tiết (kỹ năng con, công cụ, ngành) của cùng một năng lực, ở mọi lô.' });
      if (!n) break;
    }
    if (mergeSourcesE4M.length) clusterSource = mergeSources('E4.candidate_review', [...results.map((x) => x.r.source), ...mergeSourcesE4M]);
    cls = [...index.values()];
  }
  const pre = cls.map((c) => {
    const canon = canonOf(c);
    const members = c.members.map((id) => byId.get(id)!);
    return { cid: c.id, canon, members, segment_ids: [...new Set(members.flatMap((m) => m.segment_ids))].sort(), jd_refs: [...new Set(members.map((m) => m.doc))].sort(), aliases: [...new Set(members.map((m) => m.label).filter((l) => norm(l) !== norm(canon.label)))].sort() };
  });
  tb.beat('READ', 'Gom ứng viên cùng nội hàm', { formula: 'nhóm = số cụm cùng nội hàm', substitution: `${raw.length} ứng viên thô → ${pre.length} nhóm`, set: { 'nhóm ứng viên': pre.length }, source: clusterSource, explanation: raw.length > 1 ? 'Code gom sơ bộ và tra từ điển; E4 gộp theo định nghĩa và quyết định quan hệ với từ điển.' : 'Chỉ có một ứng viên.' });
  const matched = pre.map((g) => {
    const sl = shortlists.get(g.cid) ?? lexicalRetriever.shortlist(g.canon, ctx.base.C);
    const sureId = sure.get(g.cid);
    if (sureId) return { g, sl, m: { output: { decision: 'REUSE', target_competency_id: sureId, boundary_code: 'SAME_MEANING', confidence: 'HIGH', alternative_id: '' } as Match, source: 'CODE' as TraceSource } };
    const mm = matchOf.get(g.cid);
    if (!sl.length || !mm) return { g, sl, m: null };
    return { g, sl, m: { output: mm.m, source: mm.source } };
  });
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
      (existing as any).external_refs = [...new Set([...((existing as any).external_refs ?? []), ...(extOf.get(g.cid) ?? [])])].sort();
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
    (grp as any).external_refs = [...(extOf.get(g.cid) ?? [])].sort();
    groups.push(grp);
    tb.record(grp.id, grp.label, { nhãn: grp.label, 'định nghĩa': grp.definition, 'JD nêu': grp.jd_refs, 'đoạn nguồn': grp.segment_ids.map((x) => `${x}: ${short(segs.get(x)?.seg.text ?? '', 100)}`), 'C nền gần giống': grp.shortlist });
    tb.beat('READ', `Đối chiếu · ${short(grp.label, 44)}`, {
      refs: [grp.id, ...sl.map((x) => x.rec.id)],
      explanation: sl.length ? `Code tìm được ${sl.length} năng lực nền gần giống; E4 so nội hàm: ${decision} (${grp.boundary}, tin cậy ${grp.confidence}).` : 'Không có năng lực nền nào gần giống: nhóm là ADD.',
      formula: `${decision} = ${decision} + 1`,
      substitution: `${counts[decision] - 1} + 1 = ${counts[decision]}`,
      set: { ...counts },
      draft: [{ id: grp.id, value: `${decision} · ${grp.label} · ${grp.jd_refs.length} JD` }],
      delta: `+ ${grp.id} ${decision}`,
      source: m?.source ?? 'CODE',
    });
  }
  // (12)–(13): evidence weight from the rank of the JD each supporting sentence comes from; S(c) = w / max w
  const rankOf = new Map(((ctx.prev.B1!.jds ?? []) as any[]).map((j) => [j.ref, (j.rank ?? 'P3') as Rank]));
  const docOfSeg = (id: string) => segs.get(id)?.doc.ref ?? '';
  const ranksOf = (g: LiveGroup): (Rank | 'EXTERNAL')[] => [...g.segment_ids.map((x) => rankOf.get(docOfSeg(x)) ?? 'P3'), ...((g as any).external_refs ?? []).map(() => 'EXTERNAL' as const)];
  for (const g of groups) (g as any).evidence_weight = evidenceWeight(ranksOf(g));
  const maxW = Math.max(0, ...groups.map((g) => (g as any).evidence_weight as number));
  for (const g of groups) {
    (g as any).S = marketScore((g as any).evidence_weight, maxW);
    tb.calc({ substep: 'B3.evidence_weight', item_ref: g.competency_id, formula: 'w(c) = Σ ω(hạng nguồn) trên các câu ủng hộ; S(c) = w(c) / max w — (12), (13)', inputs: { sentences: g.segment_ids.length, external: (g as any).external_refs ?? [], ranks: ranksOf(g) }, output: { w: (g as any).evidence_weight, S: (g as any).S } });
  }
  const libCov = libraryCoverage(counts.REUSE + counts.UPDATE, groups.length);
  tb.beat('READ', 'Trọng số bằng chứng và độ bao phủ thư viện', { formula: 'S(c) = w(c) / max w; bao phủ = ứng viên khớp từ điển / tổng — (13), (14)', substitution: `max w = ${maxW}; bao phủ = ${counts.REUSE + counts.UPDATE}/${groups.length} = ${pct(libCov)}`, set: { 'bao phủ thư viện': pct(libCov) } });

  // E9 (KS2): another model re-codes ≥ 20% of the coded sentences without seeing E1's coding; Cohen's κ (15) → G3
  const coded = new Map<string, string>();
  const codesOf = new Map<string, Set<string>>();
  for (const g of groups)
    for (const x of g.segment_ids) {
      if (!coded.has(x)) coded.set(x, g.competency_id);
      codesOf.set(x, (codesOf.get(x) ?? new Set()).add(g.competency_id));
    }
  const allSentences = [...coded.keys()].sort();
  const nSample = Math.min(allSentences.length, Math.max(1, Math.ceil(allSentences.length * (s.policy.recode_share ?? 0.2)), s.policy.kappa_min_items ?? 10, s.policy.recode_min_sample ?? 60));
  // seeds come from the content (not the attempt), so the same data gives the same order and stored answers are reused
  const seed = seedOf(`${s.session.role_title}|E9|${allSentences.join(',')}`);
  const sample = seededShuffle(allSentences, seed).slice(0, nSample);
  let kappa: ReturnType<typeof cohenKappa> | null = null;
  let recodeSource: TraceSource = 'CODE';
  if (sample.length && groups.length) {
    const ids9 = new ShortIds();
    const codes = seededShuffle(groups, seed + 1).map((g) => ({ id: ids9.short('c', g.competency_id), label: g.label, definition: g.definition }));
    const sentences = sample.map((x) => ({ id: ids9.short('s', x), text: maskedText(segs.get(x)?.seg.text ?? '') }));
    const r = await ag.run('E9', { codes, sentences });
    recodeSource = r.source;
    // multi-label (E9 p2): E9 gives 1–2 codes per sentence, the main one first
    const second = new Map(r.output.codes.map((c) => [ids9.long(c.sentence_id)!, c.code_ids.map((k) => (k === 'NONE' ? 'NONE' : ids9.long(k) ?? 'NONE'))]));
    // agreement when the two codings share a code (E1 may also have several per sentence); otherwise E9's main code
    // is compared with E1's: κ (15) stays a two-rater statistic over one label per sentence (recorded in calc_record)
    const shared = (x: string) => (second.get(x) ?? ['NONE']).find((c) => codesOf.get(x)?.has(c)) ?? null;
    const secondAligned = (x: string) => (shared(x) ? coded.get(x)! : (second.get(x) ?? ['NONE'])[0]);
    kappa = cohenKappa(sample.map((x) => coded.get(x)!), sample.map(secondAligned));
    for (const x of sample) tb.calc({ substep: 'B3.recode', item_ref: x, formula: 'mã lần 1 (E1) so với 1–2 mã lần 2 (E9): khớp khi có mã chung', inputs: { first: [...(codesOf.get(x) ?? [])], seed }, output: { second: second.get(x) ?? ['NONE'] }, decision: shared(x) ? 'khớp' : 'lệch', seat: s.agent_config.tasks.E9?.model ?? null });
    tb.beat('READ', `Mã hóa kiểm chéo ${sample.length}/${allSentences.length} câu (E9)`, { formula: 'κ = (p_o − p_e) / (1 − p_e) — (15); khớp khi hai lần mã hóa có mã chung (câu nêu nhiều năng lực)', substitution: `p_o = ${kappa.po}; p_e = ${kappa.pe}; κ = ${kappa.kappa}`, set: { 'κ (E9)': kappa.kappa }, source: r.source });
  }
  const noSeg = groups.filter((g) => !g.segment_ids.length);
  const ids = groups.map((g) => g.competency_id);
  const dupLeft = ids.length - new Set(ids).size;
  const gates = [
    gate('B3', 1, 'Có ứng viên năng lực', groups.length ? 'PASS' : 'FAIL', groups.length, '≥ 1'),
    groups.length ? gate('B3', 2, 'Mọi ứng viên có đoạn nguồn', noSeg.length ? 'FAIL' : 'PASS', `${groups.length - noSeg.length}/${groups.length}`, 'mọi nhóm ≥ 1 đoạn hợp lệ', { refs: noSeg.map((g) => g.id) }) : gate('B3', 2, 'Mọi ứng viên có đoạn nguồn', 'NOT_EVALUATED', 'Không tính được', 'mọi nhóm ≥ 1 đoạn hợp lệ', { reason: 'Không có ứng viên nào.' }),
    gate('B3', 3, 'Không còn trùng chưa xử lý', dupLeft ? 'FAIL' : 'PASS', dupLeft, '= 0'),
    gate('B3', 4, 'Precision / Recall / F1', 'NOT_EVALUATED', 'Không tính được', 'cần bộ gold độc lập', { required: false, reason: 'Phiên này không có bộ gold độc lập để so.' }),
    !kappa || kappa.n < (s.policy.kappa_min_items ?? 10)
      ? deviationGate('B3', 5, 'Đồng thuận mã hóa kép (κ)', kappa ? `κ = ${kappa.kappa} trên ${kappa.n} câu` : 'không có câu để mã hóa lại', `κ ≥ ${s.policy.min_kappa} trên ≥ ${s.policy.kappa_min_items ?? 10} câu — (15)`, `Mẫu mã hóa lại quá nhỏ (${kappa?.n ?? 0} câu) để tính κ có ý nghĩa.`, 'Độ tin cậy của việc mã hóa chưa được đo.')
      : gate('B3', 5, 'Đồng thuận mã hóa kép (κ)', (kappa.kappa ?? 0) >= s.policy.min_kappa ? 'PASS' : 'FAIL', `κ = ${kappa.kappa} trên ${kappa.n} câu`, `κ ≥ ${s.policy.min_kappa} — (15)`),
  ];
  tb.gates(gates);
  const pass = gates.filter((g) => g.required).every((g) => g.status === 'PASS');
  const handoff = pass ? `${groups.length} nhóm ứng viên: ${counts.ADD} ADD · ${counts.UPDATE} UPDATE · ${counts.REUSE} REUSE · ${counts.NEEDS_REVIEW} cần xem lại.` : 'Ứng viên thiếu nguồn hoặc còn trùng: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao nhóm ứng viên cho B4 (và mở nhánh giao thử)' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { groups, raw_count: raw.length, counts, merged_duplicates: mergedDup, base_version: ctx.base.versionLabel, library_coverage: libCov, max_evidence_weight: maxW, recode: kappa ? { sample: sample.length, of: allSentences.length, ...kappa, seed } : null, ai_executed: true };
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
      notes: ['Tên giống nhau chưa đủ để gộp: E4 so định nghĩa; code chỉ dùng lại khi trùng tên và định nghĩa gần như y hệt (K4).', ...(counts.NEEDS_REVIEW ? [`${counts.NEEDS_REVIEW} nhóm cần người xem lại; chúng không vào bản công bố.`] : []), ...(mergedDup ? [`Code đã gộp ${mergedDup} nhóm trùng về cùng một năng lực.`] : [])],
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
