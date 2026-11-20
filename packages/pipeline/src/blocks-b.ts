import { and, eq } from 'drizzle-orm';
import { gateBlocks, type AuditView, type BlockId, type ChangeItem, type Finding, type GateResult, type TraceSource } from '@cl/contract';
import { appendEvent, hashJson, newId, sha256, t, verifyEventChain } from '@cl/db';
import { raiseStop, type CandidateItem, type CData, type IData, type RData, type VData, type WData, classify, semverOf, parseSemver, fmt as fmtSemver, bump as bumpSemver } from '@cl/registry';
import { agentTracker, mergeSources, norm, segIndex, short, type LiveGroup, type LiveTask } from './blocks-a';
import { BATCH_CHARS, ShortIds, maskedText, pack } from './prep';
import { AUDIT_VARIABLES as AUDIT_VARIABLE_LIST, outcomeConstraint, sampleA, sampleB, themeClass, coreSet, fleissKappa, keepRule, medianLevel, retranslationRate, seedOf, seededShuffle, INDICATOR_LEVELS, indicatorCountOk, auditIndependent, auditSample, g7, releaseTier, reviewDate, TECH_FAMILY } from './formulas';
import { TraceBuilder, deviationGate, gate, pct, policyRef, ratio, round4, sopGate, type BlockCtx, type BlockResult } from './types';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const labelOf = (g: LiveGroup) => ({ id: g.competency_id, label: g.label, definition: g.definition });
/**
 * Every B3 group goes on to B4–B7 (decision of 20/11/2026). A NEEDS_REVIEW group carries the id of the nearest base
 * competency, so it competes as that competency; B8 flags it for the reviewer, and the commit keeps the base version
 * unless the reviewer decides otherwise (registry effectiveItems). Before, such groups were left out of the core:
 * Project Manager lost its two strongest competencies (14 and 7 JDs) to an unsure dictionary match.
 */
const usable = (ctx: BlockCtx) => ctx.prev.B3!.groups as LiveGroup[];

export async function runB4(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const tb = new TraceBuilder('B4', ctx.attemptId, ctx.now);
  const groups = usable(ctx);
  const segs = segIndex(ctx.docs);
  for (const g of groups) tb.record(g.competency_id, g.label, { nhãn: g.label, 'định nghĩa': g.definition, 'đoạn nguồn': g.segment_ids });
  for (const e of s.events) tb.record(e.id, `Sự kiện thật · ${e.label}`, { 'tình huống': e.situation, 'hành động': e.action, 'kết quả': e.outcome, nguồn: e.source_ref || '(thiếu)' });
  tb.beat('RECEIVE', `Nhận ${groups.length} nhóm ứng viên và ${s.events.length} sự kiện thật`, { explanation: 'Sự kiện thật do người dùng nhập được kiểm. Giả thuyết chỉ là đề xuất và không bao giờ được tính là bằng chứng.', set: { 'sự kiện thật': s.events.length, 'có nguồn': 0, 'nhóm có sự kiện thật': 0, 'giả thuyết': 0 } });
  const doVerify = s.policy.verify_real_events && s.events.length > 0 && groups.length > 0;
  const checks = doVerify ? await Promise.all(s.events.map((e) => ag.run('T7', { event: { id: e.id, label: maskedText(e.label), situation: maskedText(e.situation), action: maskedText(e.action), outcome: maskedText(e.outcome) }, competencies: groups.map(labelOf) }))) : [];
  let sourced = 0;
  const supported = new Set<string>();
  const real = s.events.map((e, i) => {
    const has_source = !!e.source_ref.trim();
    if (has_source) sourced++;
    const links = checks[i]?.output.links ?? [];
    const sup = links.filter((l) => l.support === 'SUPPORTED').map((l) => l.competency_id);
    if (has_source) sup.forEach((c) => supported.add(c));
    tb.beat('READ', `Kiểm sự kiện thật · ${short(e.label, 40)}`, { refs: [e.id, ...sup], formula: 'sourceCoverage = sự kiện thật có nguồn / tổng sự kiện thật', substitution: `${sourced}/${i + 1} = ${pct(ratio(sourced, i + 1))}; hỗ trợ ${sup.length} năng lực`, denominator: { value: i + 1, note: 'Sự kiện thật đã đọc; giả thuyết không vào mẫu số hay tử số' }, set: { 'có nguồn': sourced, 'nhóm có sự kiện thật': supported.size }, draft: [{ id: e.id, value: `THỰC · ${short(e.label, 50)} · ${has_source ? 'có nguồn' : 'thiếu nguồn'} · hỗ trợ ${sup.length}` }], delta: `+ ${e.id}`, source: checks[i]?.source ?? 'CODE' });
    return { ...e, evidence_class: 'REAL' as const, has_source, links, supported: sup };
  });
  // P1 drops T13 (one hypothesis call per group: 566 calls on the 16/11 run). Code lists the groups that still need
  // real evidence instead; hypotheses come back with human data in P4.
  const need = groups.filter((g) => !supported.has(g.competency_id));
  const hypotheses: { id: string; competency_id: string; label: string; situation: string; action: string; outcome: string; segment_ids: string[]; evidence_class: 'HYPOTHESIS'; evidence_verification: 'UNVERIFIED' }[] = [];
  if (need.length) tb.beat('READ', `${need.length} nhóm chưa có sự kiện thật`, { refs: need.map((g) => g.competency_id), explanation: 'Các nhóm này chỉ có căn cứ từ JD. Không gọi AI để đề xuất giả thuyết; danh sách dùng để đi thu sự kiện thật ở lượt sau.', set: { 'cần bằng chứng thật': need.length } });
  const cov = ratio(sourced, real.length);
  // P4 · (17)–(19): people, groups, events per person; theme class of each supported group
  const rigor = s.policy.rigor ?? 'C';
  const withPerson = real.filter((e) => e.has_source && e.person_code);
  const people = [...new Set(withPerson.map((e) => e.person_code!))];
  const groupOf = (p: string) => withPerson.find((e) => e.person_code === p)?.person_group ?? null;
  const excellent = people.filter((p) => groupOf(p) === 'EXCELLENT');
  const average = people.filter((p) => groupOf(p) === 'AVERAGE');
  const perPerson = people.map((p) => withPerson.filter((e) => e.person_code === p).length);
  const minEvents = perPerson.length ? Math.min(...perPerson) : 0;
  // κ of double coding of events (17) needs a second coder; until P4 adds it the level-A rule cannot pass on data
  const sampleOk = rigor === 'A' ? sampleA(excellent.length, average.length, minEvents, null) : sampleB(people.length, withPerson.length);
  const sampleText = `${people.length} người (${excellent.length} xuất sắc, ${average.length} trung bình), ${withPerson.length} sự kiện, tối thiểu ${minEvents} mỗi người`;
  tb.calc({ substep: 'B4.sample', formula: rigor === 'A' ? 'xuất sắc ≥ 6 ∧ trung bình ≥ 3 ∧ mỗi người ≥ 4 ∧ κ ≥ 0,61 — (17)' : 'người ≥ 3 ∧ sự kiện ≥ 6 — (18)', inputs: { people: people.length, excellent: excellent.length, average: average.length, events: withPerson.length, min_per_person: minEvents }, output: { ok: sampleOk } });
  const themes = groups.map((g) => {
    const share = (ps: string[]) => (ps.length ? ps.filter((p) => withPerson.some((e) => e.person_code === p && e.supported.includes(g.competency_id))).length / ps.length : 0);
    const fe = share(excellent), fa = share(average);
    const cls = excellent.length && average.length ? themeClass(fe, fa) : null;
    if (cls) tb.calc({ substep: 'B4.theme', item_ref: g.competency_id, formula: 'Δ = f_xuất sắc − f_trung bình; tạo khác biệt / ngưỡng / cần tránh — (19)', inputs: { f_excellent: round4(fe), f_average: round4(fa) }, output: { class: cls } });
    return { competency_id: g.competency_id, f_excellent: round4(fe), f_average: round4(fa), class: cls };
  });
  const na = { reason: `Lượt chỉ có JD: policy ${policyRef(s.policy)} cho phép (allow_jd_only).` };
  const unsupported = real.filter((e) => e.has_source && !e.supported.length);
  const gates: GateResult[] = [
    real.length ? gate('B4', 1, 'Nguồn sự kiện thật tồn tại', cov === 1 ? 'PASS' : 'FAIL', `${sourced}/${real.length}`, '= 100% sự kiện thật có nguồn') : gate('B4', 1, 'Nguồn sự kiện thật tồn tại', s.policy.allow_jd_only ? 'NOT_APPLICABLE' : 'FAIL', 'Không có sự kiện thật', '= 100% sự kiện thật có nguồn', s.policy.allow_jd_only ? na : {}),
    real.length ? gate('B4', 2, 'Sự kiện thật hỗ trợ mệnh đề', unsupported.length ? 'FAIL' : 'PASS', `${real.length - unsupported.length}/${real.length}`, 'mỗi sự kiện hỗ trợ ≥ 1 năng lực (T7)', { required: false }) : gate('B4', 2, 'Sự kiện thật hỗ trợ mệnh đề', 'NOT_APPLICABLE', 'Không có sự kiện thật', 'mỗi sự kiện hỗ trợ ≥ 1 năng lực (T7)', { ...na, required: false }),
    gate('B4', 3, 'Giả thuyết không tính là bằng chứng', 'PASS', 0, 'số giả thuyết trong tử số bằng chứng = 0'),
    // (17)–(18): samples by level from the people behind the sourced real events
    rigor === 'C'
      ? gate('B4', 4, 'Đủ mẫu theo mức', 'NOT_APPLICABLE', 'Mức C', 'Mức A: ≥ 6 xuất sắc, ≥ 3 trung bình, ≥ 4 sự kiện mỗi người, κ ≥ 0,61 (17); Mức B: ≥ 3 người, ≥ 6 sự kiện (18)', { reason: 'Mức C: bước này đối chiếu với từ điển; cổng không áp dụng.' })
      : sampleOk
        ? gate('B4', 4, 'Đủ mẫu theo mức', 'PASS', sampleText, rigor === 'A' ? '≥ 6 xuất sắc, ≥ 3 trung bình, ≥ 4 sự kiện mỗi người, κ ≥ 0,61 — (17)' : '≥ 3 người, ≥ 6 sự kiện — (18)')
        : gate('B4', 4, 'Đủ mẫu theo mức', 'FAIL', sampleText, rigor === 'A' ? '≥ 6 xuất sắc, ≥ 3 trung bình, ≥ 4 sự kiện mỗi người, κ ≥ 0,61 — (17)' : '≥ 3 người, ≥ 6 sự kiện — (18)'),
  ];
  tb.gates(gates);
  const pass = !gates.some(gateBlocks);
  const handoff = pass ? `${real.length} sự kiện thật (${supported.size} nhóm được hỗ trợ), ${hypotheses.length} giả thuyết gắn nhãn rõ.` : 'Sự kiện thật thiếu nguồn: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao căn cứ cho B5' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { real, hypotheses, sample: { people: people.length, excellent: excellent.length, average: average.length, events: withPerson.length, min_per_person: minEvents, ok: sampleOk }, themes, evidence_needed: need.map((g) => g.competency_id), source_coverage: cov, supported: [...supported], evidence_verification: real.length ? 'UNVERIFIED' : 'JD_STATED', ai_executed: ag.list().length > 0 };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, { real: real.length, hypotheses: hypotheses.length }),
    ai: ag.list(),
    view: {
      input: [['Nhóm ứng viên', String(groups.length)], ['Sự kiện thật', String(real.length)]],
      output: [['Sự kiện thật có nguồn', real.length ? `${sourced}/${real.length}` : 'Không có'], ['Giả thuyết', String(hypotheses.length)]],
      rows: [
        ...real.map((e) => ({ id: e.id, name: e.label, value: 'THỰC', detail: e.has_source ? `hỗ trợ ${e.supported.length} năng lực` : 'thiếu nguồn', bad: !e.has_source, data: { lớp: 'REAL', 'tình huống': e.situation, 'hành động': e.action, 'kết quả': e.outcome, nguồn: e.source_ref, 'hỗ trợ': e.supported } })),
        ...hypotheses.map((h) => ({ id: h.id, name: h.label, value: 'GIẢ THUYẾT', detail: short(h.situation, 80), data: { lớp: 'HYPOTHESIS', 'tình huống': h.situation, 'hành động kỳ vọng': h.action, 'kết quả mong đợi': h.outcome, 'đoạn gợi ra': h.segment_ids } })),
      ],
      calc: [{ label: 'Độ phủ nguồn của sự kiện thật', formula: 'sourceCoverage = sự kiện thật có nguồn / tổng sự kiện thật', substitution: real.length ? `${sourced}/${real.length} = ${pct(cov)}` : 'Mẫu số 0 → Không áp dụng', meaning: 'Giả thuyết không bao giờ vào tử số.' }],
      notes: [`${need.length} nhóm chưa có sự kiện thật: cần thu bằng chứng ở lượt sau. Giả thuyết không bao giờ được tính là bằng chứng.`, ...(real.length ? [] : ['Khung của lượt này chỉ dựa trên JD (mức căn cứ: JD nêu).'])],
      handoff,
    },
  };
}

export async function runB5(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const tb = new TraceBuilder('B5', ctx.attemptId, ctx.now);
  const all = usable(ctx);
  const tasks = ctx.prev.B2!.tasks as LiveTask[];
  const segs = segIndex(ctx.docs);
  const sumW = round4(tasks.reduce((a, t) => a + t.weight, 0));
  // K6 long tail (spec §5.1, Q5): in a large set, a group named by fewer JDs than the threshold is kept aside as
  // "chưa đủ căn cứ" and not sent to the matrix. A small set is not cut: its tail cannot be told from signal.
  const validJd = Number(ctx.prev.B2!.valid_jd ?? 0);
  const tailOn = validJd >= s.policy.long_tail_min_set;
  const minJds = Math.max(s.policy.long_tail_min_jds ?? 2, Math.ceil(validJd * (s.policy.long_tail_min_share ?? 0)));
  const tail = tailOn ? all.filter((g) => g.jd_refs.length < minJds) : [];
  const groups = all.filter((g) => !tail.includes(g));
  for (const g of all) tb.calc({ substep: 'B5.long_tail', item_ref: g.competency_id, formula: `giữ khi số JD nêu ≥ max(${s.policy.long_tail_min_jds}, ⌈${s.policy.long_tail_min_share ?? 0} × JD hợp lệ⌉) = ${minJds} (chỉ áp khi ≥ ${s.policy.long_tail_min_set} JD hợp lệ)`, inputs: { jd: g.jd_refs.length, valid_jd: validJd }, output: { kept: !tail.includes(g) }, decision: tail.includes(g) ? 'chưa đủ căn cứ' : 'đi tiếp' });
  for (const t of tasks) tb.record(t.id, short(t.statement, 60), { 'nhiệm vụ': t.statement, 'trọng số': t.weight });
  for (const g of groups) tb.record(g.competency_id, g.label, { nhãn: g.label, 'định nghĩa': g.definition });
  tb.beat('RECEIVE', `Nhận ${tasks.length} nhiệm vụ (Σw = ${sumW}) và ${groups.length} năng lực ứng viên`, { explanation: tail.length ? `${tail.length} nhóm chỉ có ở dưới ${minJds} JD được để riêng với nhãn "chưa đủ căn cứ".` : undefined, set: { 'Σw (mẫu số)': sumW, 'tử số': 0, coverage: pct(sumW ? 0 : null), 'năng lực được chọn': 0 } });
  // E10 (KS3): three seats score every candidate — importance, discrimination, level (spec §6.1a). One call per
  // seat and batch; each seat sees its own shuffled order and short codes. (Control items exist for E7 only.)
  const S0 = new Map(((ctx.prev.B3!.groups ?? []) as any[]).map((g) => [g.competency_id, Number(g.S ?? 0)]));
  type Score = { importance: number | null; discrimination: number | null; level: number | null };
  const seatScores: Map<string, Score>[] = s.agent_config.seats.map(() => new Map());
  let seatSource: TraceSource = 'CODE';
  if (groups.length) {
    const sources: TraceSource[] = [];
    await Promise.all(
      s.agent_config.seats.map(async (seat, si) => {
        const seed = seedOf(`${s.session.role_title}|E10|${seat.seat}|${groups.map((g) => g.competency_id).sort().join(',')}`);
        const order = seededShuffle(groups, seed);
        for (const batch of pack(order, (g) => g.label.length + g.definition.length + g.segment_ids.slice(0, 2).reduce((a, x) => a + Math.min(160, segs.get(x)?.seg.text.length ?? 0) + 8, 40), BATCH_CHARS())) {
          const ids = new ShortIds();
          const cands = batch.map((g) => ({ id: ids.short('c', g.competency_id), label: g.label, definition: g.definition, segments: g.segment_ids.slice(0, 2).map((x) => ({ id: ids.short('s', x), text: short(maskedText(segs.get(x)?.seg.text ?? ''), 160) })) }));
          const r = await ag.run('E10', { seat: seat.seat, seat_role: seat.role, scale_note: `${seat.scale}${s.rubric.length ? ` Bậc theo rubric: ${s.rubric.map((x) => `${x.level} = ${x.description}`).join('; ')}` : ''}`, role_title: s.session.role_title, candidates: cands }, { model: seat.model, effort: seat.effort });
          sources.push(r.source);
          const num = (v: string) => (v ? Number(v) : null);
          for (const x of r.output.scores) seatScores[si].set(ids.long(x.candidate_id)!, { importance: num(x.importance), discrimination: num(x.discrimination), level: num(x.level) });
          tb.calc({ substep: 'B5.seat_order', item_ref: seat.seat, formula: 'thứ tự xáo theo seed riêng của ghế (S4)', inputs: { seed, items: batch.length }, output: null, seat: seat.model });
        }
      }),
    );
    seatSource = mergeSources('E10.seat_score', sources);
  }
  // (20)–(22) per candidate, (23) core set
  // P4.3: survey responses of people win over the AI seats for a competency once enough people answered
  const minResp = (s.policy.rigor ?? 'C') === 'A' ? 10 : 5;
  const surveyOf = (g: LiveGroup) => (s.survey ?? []).filter((r) => norm(r.label) === norm(g.label) || g.aliases.some((a) => norm(a) === norm(r.label)));
  const scored = groups.map((g) => {
    const sv = surveyOf(g);
    const fromSurvey = new Set(sv.map((r) => r.respondent)).size >= minResp;
    const votes = fromSurvey ? sv.map((r) => ({ importance: r.importance, discrimination: r.discrimination, level: r.level })) : seatScores.map((m) => m.get(g.competency_id) ?? { importance: null, discrimination: null, level: null });
    const imp = votes.map((v) => v.importance).filter((x): x is number => x != null);
    const dis = votes.map((v) => v.discrimination).filter((x): x is number => x != null);
    const k = keepRule({ importance: imp, discrimination: dis }, s.policy.keep ?? { importance: 3.5, discrimination: 3.0, rwg: 0.7 });
    const keep = k.keep && imp.length >= 2;
    const level = medianLevel(votes.map((v) => v.level).filter((x): x is number => x != null));
    const S = S0.get(g.competency_id) ?? 0;
    votes.forEach((v, i) => tb.calc({ substep: 'B5.seat_vote', item_ref: g.competency_id, formula: 'phiếu một ghế: quan trọng, phân biệt, bậc (E10)', inputs: { ...v }, output: null, seat: s.agent_config.seats[i]?.seat ?? null }));
    tb.calc({ substep: 'B5.keep', item_ref: g.competency_id, formula: 'r_wg = max(0, 1 − s²/2); giữ khi x̄_qt ≥ 3,5 ∧ x̄_pb ≥ 3,0 ∧ r_wg ≥ 0,70 — (20), (21)', inputs: { importance: imp, discrimination: dis }, output: { mean: k.mean_importance, s2: k.variance, rwg: k.rwg, mean_discrimination: k.mean_discrimination }, decision: keep ? 'giữ' : `loại: ${imp.length < 2 ? 'dưới 2 phiếu' : k.reasons.join('; ')}` });
    tb.calc({ substep: 'B5.level', item_ref: g.competency_id, formula: 'bậc = trung vị phiếu hợp lệ, cần ≥ 2 phiếu — (26)', inputs: { votes: votes.map((v) => v.level) }, output: { level } });
    return { g, votes, ...k, keep, level, S, id: g.competency_id, from_survey: fromSurvey, respondents: new Set(sv.map((r) => r.respondent)).size };
  });
  const kept = scored.filter((x) => x.keep);
  const core = coreSet(kept, s.policy.core_max ?? 14, s.policy.max_meta ?? 1);
  const coreIds = new Set(core.map((x) => x.id));
  for (const x of scored) tb.beat('READ', `Ba ghế chấm · ${short(x.g.label, 40)}`, { refs: [x.id], formula: 'r_wg = max(0, 1 − s²/2) — (20); giữ theo (21); tập lõi theo (23)', substitution: `quan trọng ${x.votes.map((v) => v.importance ?? '—').join(', ')} → x̄ ${x.mean_importance}, s² ${x.variance}, r_wg ${x.rwg}; phân biệt x̄ ${x.mean_discrimination} → ${coreIds.has(x.id) ? 'vào lõi' : x.keep ? 'giữ, ngoài lõi (quá giới hạn)' : 'loại'}`, set: { 'giữ': kept.length, 'lõi': coreIds.size }, draft: [{ id: x.id, value: `${coreIds.has(x.id) ? '●' : x.keep ? '○' : '⊘'} ${short(x.g.label, 50)} · r_wg ${x.rwg}` }], source: seatSource });
  const matrixGroups = groups.filter((g) => coreIds.has(g.competency_id));
  // E5 runs AFTER the seats chose the core (cost: the matrix only has the ≤ 14 core columns, not every candidate).
  // The core list is the same for every call, so it goes in the system prompt (cacheable). A list too long
  // for one call is cut into parts; every task batch is matched against every part and the rows are merged.
  const compParts = pack(matrixGroups, (g) => g.label.length + g.definition.length + 30, Number(process.env.AGENT_MATRIX_LIST_CHARS || 4500));
  const taskBatches = matrixGroups.length ? pack(tasks, (t) => t.statement.length + Math.min(160, segs.get(t.segment_ids[0] ?? '')?.seg.text.length ?? 0) + 40, BATCH_CHARS() - 4500, 25) : [];
  const linkOf = new Map<string, { output: { links: { competency_id: string; segment_ids: string[] }[] }; sources: TraceSource[] }>();
  await Promise.all(
    compParts.flatMap((part) => {
      const cIds = new ShortIds();
      const competencies = part.map((g) => ({ id: cIds.short('c', g.competency_id), label: g.label, definition: g.definition }));
      return taskBatches.map(async (batch) => {
        const ids = new ShortIds();
        const input = batch.map((t) => ({ id: ids.short('t', t.id), statement: t.statement, segments: t.segment_ids.slice(0, 2).map((x) => ({ id: ids.short('s', x), text: short(maskedText(segs.get(x)?.seg.text ?? ''), 160) })) }));
        const r = await ag.run('E5', { competencies, tasks: input });
        for (const row of r.output.rows) {
          const tid = ids.long(row.task_id)!;
          const cur = linkOf.get(tid) ?? { output: { links: [] }, sources: [] };
          const segIdsLong = ids.longs(row.segment_ids);
          for (const competency_id of cIds.longs(row.competency_ids)) cur.output.links.push({ competency_id, segment_ids: segIdsLong });
          cur.sources.push(r.source);
          linkOf.set(tid, cur);
        }
      });
    }),
  );
  if (compParts.length > 1) tb.beat('READ', `Danh sách năng lực chia ${compParts.length} phần`, { explanation: 'Một danh sách quá dài cho một lời gọi; mỗi lô nhiệm vụ được nối với từng phần rồi gộp lại.', formula: 'lời gọi = lô nhiệm vụ × phần danh sách', substitution: `${taskBatches.length} × ${compParts.length} = ${taskBatches.length * compParts.length}` });
  const linked = tasks.map((t) => { const l = linkOf.get(t.id); return l ? { output: { links: [...l.output.links].sort((a, b) => a.competency_id.localeCompare(b.competency_id)) }, source: mergeSources('E5.task_matrix', l.sources) } : { output: { links: [] }, source: 'CODE' as TraceSource }; });
  const links: Record<string, { competency_id: string; segment_ids: string[] }[]> = {};
  const selected = new Set<string>();
  let num = 0;
  tasks.forEach((t, i) => {
    const l = linked[i].output.links.filter((x) => x.segment_ids.length && matrixGroups.some((g) => g.competency_id === x.competency_id));
    links[t.id] = l;
    l.forEach((x) => selected.add(x.competency_id));
    const before = num;
    if (l.length) num = round4(num + t.weight);
    tb.beat('READ', `Nối nhiệm vụ · ${short(t.statement, 44)}`, { refs: [t.id, ...l.map((x) => x.competency_id)], formula: 'tử số += w · 1[nhiệm vụ có ≥ 1 năng lực với cạnh hợp lệ]; coverage = tử số / Σw', substitution: `${before} + ${t.weight} × ${l.length ? 1 : 0} = ${num}; coverage = ${num}/${sumW} = ${pct(ratio(num, sumW))}`, denominator: { value: sumW, note: 'Σw cố định từ B2' }, set: { 'tử số': num, coverage: pct(ratio(num, sumW)), 'năng lực được chọn': selected.size }, draft: [{ id: t.id, value: `${short(t.statement, 50)} → ${l.length ? l.map((x) => groups.find((g) => g.competency_id === x.competency_id)!.label).join(', ') : '⊘ chưa có năng lực'}` }], delta: l.length ? `+ ${l.length} cạnh` : `⊘ ${t.id} hở`, source: linked[i].source, calc: { substep: 'B5.coverage', item_ref: t.id, formula: 'tử số += w · 1[có ≥ 1 năng lực với cạnh hợp lệ]; coverage = tử số / Σw', inputs: { w: t.weight, links: l.length, sum_w: sumW }, output: { numerator: num, coverage: ratio(num, sumW) }, decision: l.length ? 'phủ' : 'hở' } });
  });
  const unanimous = scored.filter((x) => x.votes.every((v) => v.importance != null && v.importance === x.votes[0].importance)).length;
  const unusualAgreement = scored.length >= 5 && unanimous / scored.length > 0.9;
  const sel = groups.filter((g) => coreIds.has(g.competency_id));
  const covOf = (set: Set<string>) => ratio(round4(tasks.reduce((a, t) => a + (links[t.id].some((x) => set.has(x.competency_id)) ? t.weight : 0), 0)), sumW);
  const coverage = covOf(coreIds);
  const covWithout = (drop: Set<string>) => covOf(new Set([...coreIds].filter((c) => !drop.has(c))));
  tb.beat('READ', 'Độ phủ nhiệm vụ của tập lõi', { formula: 'coverage = Σ(w · 1[có năng lực lõi]) / Σw — (24)', substitution: `${pct(coverage)} với ${sel.length} năng lực lõi`, denominator: { value: sumW, note: 'Σw cố định từ B2' }, set: { coverage: pct(coverage) } });
  const dropOne = sel.map((g) => ({ competency_id: g.competency_id, label: g.label, coverage_without: covWithout(new Set([g.competency_id])), lost_tasks: tasks.filter((t) => links[t.id].length && links[t.id].filter((x) => coreIds.has(x.competency_id)).every((x) => x.competency_id === g.competency_id) && links[t.id].some((x) => x.competency_id === g.competency_id)).map((t) => t.id) }));
  for (const d of dropOne) tb.calc({ substep: 'B5.drop_one', item_ref: d.competency_id, formula: 'coverage₋c = Σ(w · 1[còn năng lực lõi khác c]) / Σw — (25)', inputs: { sum_w: sumW, coverage }, output: { coverage_without: d.coverage_without, lost_tasks: d.lost_tasks.length }, decision: d.lost_tasks.length ? 'trọng yếu' : d.coverage_without === coverage ? 'xét gộp' : null });
  tb.beat('READ', 'Phép thử bỏ một năng lực', { explanation: dropOne.map((d) => `Bỏ ${d.label}: ${pct(d.coverage_without)}`).join(' · ') || 'Không có năng lực lõi.', formula: 'coverage₋c = Σ(w · 1[còn năng lực khác c])/Σw — (25)', substitution: dropOne.slice(0, 4).map((d) => `${short(d.label, 20)}: ${pct(d.coverage_without)}`).join(' · ') || '—' });
  const levels: Record<string, number | null> = Object.fromEntries(core.map((x) => [x.id, x.level]));
  const uncovered = tasks.filter((t) => !links[t.id].some((x) => coreIds.has(x.competency_id)));
  const noLevel = core.filter((x) => x.level == null);
  const cmin = s.policy.core_min ?? 8, cmax = s.policy.core_max ?? 14;
  const rigor = s.policy.rigor ?? 'C';
  const gates = [
    gate('B5', 1, 'Tập lõi trong giới hạn', core.length >= cmin && core.length <= cmax ? 'PASS' : 'FAIL', core.length, `${cmin}–${cmax} năng lực, ≤ ${s.policy.max_meta ?? 1} meta — (23)`, { refs: core.map((x) => x.id) }),
    gate('B5', 5, 'Số ứng viên giữ trong giới hạn lõi', kept.length <= cmax ? 'PASS' : 'FAIL', `${kept.length} giữ, ${core.length} vào lõi`, `≤ ${cmax}; nhiều hơn thì xếp theo x̄ quan trọng rồi S(c) và cắt (6.1a)`, { required: false, refs: kept.filter((x) => !coreIds.has(x.id)).map((x) => x.id) }),
    gate('B5', 2, 'Mọi năng lực lõi có bậc yêu cầu', noLevel.length ? 'FAIL' : 'PASS', `${core.length - noLevel.length}/${core.length}`, 'bậc = trung vị ≥ 2 phiếu — (26)', { refs: noLevel.map((x) => x.id) }),
    rigor === 'C'
      ? gate('B5', 3, 'Cỡ mẫu khảo sát', 'NOT_APPLICABLE', 'Mức C', 'Mức A ≥ 10 người, Mức B ≥ 5 người', { reason: 'Mức C: ba ghế AI thay khảo sát; không có phiếu của người.' })
      : core.length && core.every((x) => x.from_survey)
        ? gate('B5', 3, 'Cỡ mẫu khảo sát', 'PASS', `${Math.min(...core.map((x) => x.respondents))} người trả lời (ít nhất)`, `≥ ${minResp} người cho mỗi năng lực lõi`)
        : deviationGate('B5', 3, 'Cỡ mẫu khảo sát', `${core.filter((x) => x.from_survey).length}/${core.length} năng lực lõi có đủ phiếu`, `≥ ${minResp} người cho mỗi năng lực lõi`, 'Chưa đủ phiếu khảo sát của người cho mọi năng lực lõi.', 'Ưu tiên và bậc của các năng lực thiếu phiếu chỉ dựa trên ba ghế AI.'),
    sumW === 0 ? gate('B5', 4, 'Độ phủ nhiệm vụ', 'NOT_EVALUATED', 'Không tính được', `≥ ${pct(s.policy.min_coverage)}`, { reason: 'Σw = 0.', required: false }) : gate('B5', 4, 'Độ phủ nhiệm vụ', coverage! >= s.policy.min_coverage ? 'PASS' : 'FAIL', pct(coverage), `≥ ${pct(s.policy.min_coverage)} (ngưỡng cảnh báo) — (24)`, { refs: uncovered.map((t) => t.id), required: false }),
  ];
  tb.gates(gates);
  const pass = !gates.some(gateBlocks);
  const handoff = pass ? `Tập lõi ${sel.length} năng lực (giữ ${kept.length}/${scored.length}), coverage ${pct(coverage)}${uncovered.length ? `, còn hở ${uncovered.length} nhiệm vụ` : ''}.` : `Tập lõi ${core.length} năng lực ngoài giới hạn ${cmin}–${cmax} hoặc thiếu bậc: không bàn giao.`;
  tb.beat('HANDOFF', pass ? 'Bàn giao tập lõi cho B6' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { links, long_tail: tail.map((g) => g.competency_id), selected: sel.map((g) => g.competency_id), scores: scored.map((x) => ({ competency_id: x.id, from_survey: x.from_survey, respondents: x.respondents, votes: x.votes, mean_importance: x.mean_importance, variance: x.variance, rwg: x.rwg, mean_discrimination: x.mean_discrimination, keep: x.keep, core: coreIds.has(x.id), level: x.level, S: x.S, reasons: x.reasons })), min_rwg: core.length ? Math.min(...core.map((x) => x.rwg ?? 0)) : null, unusual_agreement: unusualAgreement, coverage, numerator: num, sum_w: sumW, uncovered: uncovered.map((t) => t.id), drop_one: dropOne, levels, level_status: s.rubric.length ? 'RUBRIC' : 'UNDEFINED', ai_executed: true };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, { coverage }),
    ai: ag.list(),
    view: {
      input: [['Nhiệm vụ', `${tasks.length} · Σw ${sumW}`], ['Năng lực ứng viên', String(groups.length)]],
      output: [['Năng lực được chọn', String(sel.length)], ['Coverage', pct(coverage)], ['Nhiệm vụ hở', String(uncovered.length)], ['Bậc yêu cầu', s.rubric.length ? 'theo rubric' : 'Chưa xác định']],
      rows: tasks.map((t) => ({ id: t.id, name: t.statement, value: `w ${t.weight}`, detail: links[t.id].length ? links[t.id].map((x) => groups.find((g) => g.competency_id === x.competency_id)!.label).join(', ') : 'chưa có năng lực', bad: !links[t.id].length, data: { 'nhiệm vụ': t.statement, 'trọng số': t.weight, 'năng lực': links[t.id].map((x) => `${groups.find((g) => g.competency_id === x.competency_id)!.label} ← ${x.segment_ids.join(', ')}`) } })),
      calc: [
        { label: 'Độ phủ', formula: 'coverage = Σ(w · 1[có năng lực được chọn và cạnh hợp lệ]) / Σw', substitution: sumW ? `${num}/${sumW} = ${pct(coverage)}` : 'Mẫu số 0 → Không tính được', meaning: 'Phần khối lượng công việc đã có năng lực làm căn cứ.' },
        { label: 'Bỏ một năng lực', formula: 'coverage₋c = Σ(w · 1[còn năng lực khác c]) / Σw', substitution: dropOne.map((d) => `${short(d.label, 18)}: ${pct(d.coverage_without)}`).join(' · ') || '—', meaning: 'Năng lực nào bỏ đi làm coverage tụt mạnh là năng lực trọng yếu.' },
      ],
      notes: [...(uncovered.length ? [`Nhiệm vụ chưa có năng lực: ${uncovered.map((t) => short(t.statement, 50)).join('; ')}.`] : []), ...(s.rubric.length ? [] : ['Bậc yêu cầu: Chưa xác định (phiên không có rubric bậc).'])],
      handoff,
      visual: { kind: 'b5', tasks: tasks.map((t) => ({ id: t.id, name: t.statement, weight: t.weight })), competencies: sel.map((g) => ({ id: g.competency_id, name: g.label })), links: Object.fromEntries(tasks.map((t) => [t.id, links[t.id].map((x) => x.competency_id)])) },
    },
  };
}

interface LiveIndicator {
  key: string;
  competency_id: string;
  n: number;
  level: '1' | '3' | '5';
  statement: string;
  segment_ids: string[];
  round: number;
  votes: { seat: string; model: string; choice: string; level: string }[];
  /** seats right on both competency and level */
  correct: number;
  /** all seats (blank votes stay in the denominator, formula 27) */
  non_abstain: number;
  agreement: number | null;
  pass: boolean;
}
const PERSONALITY = /\b(nhiệt tình|chăm chỉ|trung thực|cẩn thận|năng động|có trách nhiệm|tính cách|thái độ tốt|hòa đồng|tận tâm)\b/iu;
const SEAT_CONTROLS = 2;

export async function runB6(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const tb = new TraceBuilder('B6', ctx.attemptId, ctx.now);
  const b5 = ctx.prev.B5!;
  const tasks = ctx.prev.B2!.tasks as LiveTask[];
  const groups = usable(ctx).filter((g) => (b5.selected as string[]).includes(g.competency_id));
  const segs = segIndex(ctx.docs);
  const labels = groups.map(labelOf);
  const tasksOf = (cid: string) => tasks.filter((t) => (b5.links[t.id] as any[]).some((x) => x.competency_id === cid)).map((t) => t.statement);
  const minP = s.policy.min_item_agreement;
  for (const g of groups) tb.record(g.competency_id, g.label, { nhãn: g.label, 'định nghĩa': g.definition, 'nhiệm vụ': tasksOf(g.competency_id) });
  tb.beat('RECEIVE', `Nhận ${groups.length} năng lực lõi từ B5`, { explanation: 'E6 viết chỉ báo ở bậc 1, 3, 5. Ba ghế E7 (mỗi ghế một vai, thứ tự và mã xáo riêng, bậc bị che) xếp từng chỉ báo vào năng lực và bậc, rồi xếp lớp năng lực.', set: { 'chỉ báo': 0, 'đạt': 0, 'viết lại': 0 } });

  // E6: many competencies per call; one row per competency with levels 1, 3, 5
  type Written = { output: { outcomes: string[]; levels: { level: '1' | '3' | '5'; indicators: { statement: string; segment_ids: string[] }[] }[] }; source: TraceSource };
  const outcomeList = (s.session.charter?.outcomes ?? []).map((text, i) => ({ id: `o${i + 1}`, text }));
  const outcomeLinks: Record<string, string[]> = {};
  const writeMany = async (list: { g: LiveGroup; note: string }[]): Promise<Written[]> => {
    const out = new Map<string, Written>();
    const size = (x: { g: LiveGroup }) => x.g.label.length + x.g.definition.length + tasksOf(x.g.competency_id).slice(0, 6).join(' ').length + x.g.segment_ids.slice(0, 4).reduce((a, id) => a + Math.min(200, segs.get(id)?.seg.text.length ?? 0) + 8, 60);
    await Promise.all(
      pack(list, size, BATCH_CHARS() - 1500).map(async (batch) => {
        const ids = new ShortIds();
        const competencies = batch.map(({ g, note }) => ({ id: ids.short('c', g.competency_id), label: g.label, definition: g.definition, tasks: tasksOf(g.competency_id).slice(0, 6), segments: g.segment_ids.slice(0, 4).map((x) => ({ id: ids.short('s', x), text: short(maskedText(segs.get(x)?.seg.text ?? ''), 200) })), required_level: b5.levels[g.competency_id] == null ? 'chưa xác định' : String(b5.levels[g.competency_id]), revision_note: note }));
        const r = await ag.run('E6', { role_title: s.session.role_title, outcomes: outcomeList, competencies });
        for (const it of r.output.items) out.set(ids.long(it.competency_id)!, { output: { outcomes: it.outcome_ids, levels: it.levels.map((l) => ({ level: l.level, indicators: l.indicators.map((x) => ({ statement: x.statement, segment_ids: ids.longs(x.segment_ids) })) })) }, source: r.source });
      }),
    );
    for (const [cid, w] of out) if (w.output.outcomes.length) outcomeLinks[cid] = w.output.outcomes;
    return list.map(({ g }) => out.get(g.competency_id) ?? { output: { outcomes: [], levels: [] }, source: 'CODE' as TraceSource });
  };
  const toInds = (g: LiveGroup, w: Written, round: number): LiveIndicator[] => w.output.levels.flatMap((l) => l.indicators.map((x, i) => ({ key: `${g.competency_id}#${l.level}.${i + 1}${round > 1 ? 'r' : ''}`, competency_id: g.competency_id, n: Number(l.level) * 10 + i + 1, level: l.level, statement: x.statement, segment_ids: x.segment_ids, round, votes: [], correct: 0, non_abstain: 0, agreement: null, pass: false })));

  // E7: each seat gets the indicators in its own shuffled order with its own short codes, plus control items
  const classVotes = new Map<string, string[]>();
  let seatsDiscarded = 0;
  const vote = async (inds: LiveIndicator[], round: number) => {
    const sources: TraceSource[] = [];
    const perSeat = await Promise.all(
      s.agent_config.seats.map(async (seat, si) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const seed = seedOf(`${s.session.role_title}|E7|${seat.seat}|${round}|${attempt}|${inds.map((x) => x.key + x.statement).sort().join(',')}`);
          const lIds = new ShortIds();
          const shortLabels = seededShuffle(labels, seed + 1).map((l) => ({ ...l, id: lIds.short('c', l.id) }));
          const controls = seededShuffle(groups, seed + 2).slice(0, Math.min(SEAT_CONTROLS, groups.length)).map((g, i) => ({ key: `control-${i}`, competency_id: g.competency_id, statement: g.definition }));
          const items = seededShuffle([...inds.map((x) => ({ key: x.key, statement: x.statement })), ...controls.map((c) => ({ key: c.key, statement: c.statement }))], seed);
          const iIds = new ShortIds();
          const r = await ag.run('E7', { seat: seat.seat, seat_role: seat.role, indicators: items.map((x) => ({ id: iIds.short('i', x.key), statement: x.statement })), labels: shortLabels }, { model: seat.model, effort: seat.effort });
          sources.push(r.source);
          const byKey = new Map(r.output.votes.map((v) => [iIds.long(v.indicator_id)!, { choice: v.competency_id ? lIds.long(v.competency_id) ?? '' : '', level: v.level }]));
          const wrongControls = controls.filter((c) => byKey.get(c.key)?.choice !== c.competency_id).length;
          tb.calc({ substep: 'B6.seat_controls', item_ref: seat.seat, formula: 'ghế sai > 1 mục kiểm tra thì loại phiếu và chạy lại một lần (S5)', inputs: { controls: controls.length, seed, round }, output: { wrong: wrongControls }, decision: wrongControls > 1 ? (attempt ? 'loại phiếu ghế' : 'chạy lại ghế') : 'nhận phiếu', seat: seat.model });
          if (wrongControls > 1 && attempt === 0) continue;
          if (wrongControls > 1) {
            seatsDiscarded++;
            return { si, discarded: true, byKey: new Map<string, { choice: string; level: string }>(), classes: new Map<string, string>() };
          }
          return { si, discarded: false, byKey, classes: new Map(r.output.classes.map((c) => [lIds.long(c.competency_id)!, c.class])) };
        }
        return { si, discarded: true, byKey: new Map(), classes: new Map() };
      }),
    );
    for (const ind of inds) {
      ind.votes = perSeat.map((p) => ({ seat: s.agent_config.seats[p.si].seat, model: s.agent_config.seats[p.si].model, choice: p.byKey.get(ind.key)?.choice ?? '', level: p.byKey.get(ind.key)?.level ?? '' }));
      // a seat whose votes were discarded (S5) leaves the denominator; blank votes of valid seats stay in it (27)
      const valid = perSeat.filter((p) => !p.discarded);
      ind.votes = ind.votes.filter((_, k) => !perSeat[k].discarded);
      const rr = retranslationRate(ind.votes.map((v) => ({ competency: v.choice, level: v.level })), { competency: ind.competency_id, level: ind.level }, valid.length);
      ind.correct = rr.right;
      ind.non_abstain = rr.seats;
      ind.agreement = rr.p;
      ind.pass = rr.p >= minP - 1e-9;
      tb.calc({ substep: 'B6.retranslation', item_ref: ind.key, formula: 'p_i = số ghế đúng cả năng lực và bậc / số ghế (phiếu trắng tính vào mẫu số) — (27)', inputs: { votes: ind.votes.map((v) => ({ seat: v.seat, competency: v.choice === ind.competency_id, level: v.level })), expected_level: ind.level, threshold: minP }, output: { right: rr.right, p: rr.p }, decision: ind.pass ? 'đạt' : round > 1 ? 'bỏ' : 'viết lại' });
    }
    for (const p of perSeat) for (const [cid, cl] of p.classes) classVotes.set(`${round}|${cid}`, [...(classVotes.get(`${round}|${cid}`) ?? []), cl]);
    return mergeSources('E7.retranslation', sources);
  };

  // P5.2: a competency reused from the dictionary that already has 2–4 indicators at each of levels 1, 3, 5 keeps them:
  // no E6 and no E7 for the inherited part (they passed retranslation when they were published)
  const inheritedOf = (g: LiveGroup) => {
    if (g.decision !== 'REUSE') return null;
    const base = ctx.base.I.filter((i) => i.data.competency_id === g.competency_id && i.data.level);
    return INDICATOR_LEVELS.every((L) => indicatorCountOk(base.filter((i) => i.data.level === L).length)) ? base : null;
  };
  const inherited: LiveIndicator[] = groups.flatMap((g) =>
    (inheritedOf(g) ?? []).map((i) => ({ key: `${g.competency_id}#inh-${i.id}`, competency_id: g.competency_id, n: Number(i.id.split('-').pop()) || 0, level: i.data.level as '1' | '3' | '5', statement: i.data.statement, segment_ids: i.data.segment_ids, round: 0, votes: [], correct: 3, non_abstain: 3, agreement: 1, pass: true })),
  );
  const toWrite = groups.filter((g) => !inheritedOf(g));
  if (inherited.length) tb.beat('READ', `Kế thừa chỉ báo của ${groups.length - toWrite.length} năng lực dùng lại`, { explanation: 'Năng lực dùng lại nguyên từ từ điển đã có đủ chỉ báo theo bậc: không gọi AI cho phần kế thừa (P5.2).', set: { 'kế thừa': inherited.length } });
  const firstW = await writeMany(toWrite.map((g) => ({ g, note: '' })));
  const first = groups.map((g) => { const k = toWrite.indexOf(g); return k >= 0 ? firstW[k] : ({ output: { outcomes: [], levels: [] }, source: 'CODE' } as Written); });
  let inds: LiveIndicator[] = groups.flatMap((g, i) => (inheritedOf(g) ? [] : toInds(g, first[i], 1)));
  groups.forEach((g, i) => tb.beat('READ', `Viết chỉ báo · ${short(g.label, 40)}`, { refs: [g.competency_id], formula: 'chỉ báo ở bậc 1, 3, 5; 2–4 mỗi bậc — (29)', substitution: first[i].output.levels.map((l) => `bậc ${l.level}: ${l.indicators.length}`).join(' · ') || 'không có', draft: toInds(g, first[i], 1).map((x) => ({ id: x.key, value: `B${x.level} · ${short(x.statement, 80)} · chờ dịch ngược` })), source: first[i].source }));
  let rewritten = 0;
  let src: TraceSource = 'CODE';
  if (s.policy.retranslation && inds.length) {
    src = await vote(inds, 1);
    // the inherited competencies still get a class vote: they are listed with the others
    const nameOf = (id: string) => (!id ? 'bỏ trống' : groups.find((g) => g.competency_id === id)?.label ?? id);
    const failing = groups.filter((g) => inds.some((x) => x.competency_id === g.competency_id && !x.pass));
    tb.beat('READ', 'Dịch ngược vòng 1', { formula: 'p_i ≥ 0,70 — (27)', substitution: `${inds.filter((x) => x.pass).length}/${inds.length} chỉ báo đạt`, set: { 'đạt': inds.filter((x) => x.pass).length }, source: src });
    if (failing.length) {
      const re = await writeMany(
        failing.map((g) => {
          const bad = inds.filter((x) => x.competency_id === g.competency_id && !x.pass);
          const wrong = [...new Set(bad.flatMap((x) => x.votes.filter((v) => v.choice !== g.competency_id || v.level !== x.level).map((v) => `${nameOf(v.choice)}${v.level ? ` bậc ${v.level}` : ''}`)))].sort();
          return { g, note: `Các chỉ báo ${bad.map((x) => `bậc ${x.level}`).join(', ')} bị đọc thành: ${wrong.join('; ') || 'không rõ'}. Nêu rõ đối tượng, sản phẩm đặc trưng của "${g.label}" và độ khó đúng bậc.` };
        }),
      );
      const fresh: LiveIndicator[] = [];
      failing.forEach((g, i) => {
        // only the failing indicators are replaced, by the rewritten ones of the same level
        const failedLevels = new Set(inds.filter((x) => x.competency_id === g.competency_id && !x.pass).map((x) => x.level));
        // per level, as many rewritten indicators as failed ones were removed, so (29) stays within 2–4
        const failedPer = new Map<string, number>();
        for (const x of inds.filter((y) => y.competency_id === g.competency_id && !y.pass)) failedPer.set(x.level, (failedPer.get(x.level) ?? 0) + 1);
        const repl = toInds(g, re[i], 2).filter((x) => failedLevels.has(x.level)).filter((x) => { const n = failedPer.get(x.level) ?? 0; if (n <= 0) return false; failedPer.set(x.level, n - 1); return true; });
        rewritten += repl.length;
        const removed = inds.filter((x) => x.competency_id === g.competency_id && !x.pass).map((x) => x.key);
        const keptInds = inds.filter((x) => !removed.includes(x.key));
        // a rewritten indicator takes the next free number of its level, never the number of one that passed
        // (else two indicators share an id, e.g. I-…-11, and one overwrites the other in the release)
        const takenBy = new Map<string, Set<number>>();
        for (const y of keptInds.filter((y) => y.competency_id === g.competency_id)) takenBy.set(y.level, (takenBy.get(y.level) ?? new Set()).add(y.n));
        for (const x of repl) {
          const taken = takenBy.get(x.level) ?? new Set<number>();
          let n = Number(x.level) * 10 + 1;
          while (taken.has(n)) n++;
          taken.add(n);
          takenBy.set(x.level, taken);
          x.n = n;
          x.key = `${g.competency_id}#${x.level}.${n - Number(x.level) * 10}r`;
        }
        inds = [...keptInds, ...repl];
        fresh.push(...repl);
        tb.beat('READ', `Viết lại chỉ báo · ${short(g.label, 40)}`, { refs: [g.competency_id], explanation: 'Dưới ngưỡng: một vòng viết lại kèm ghi chú lỗi, rồi xếp lại; vẫn trượt thì bỏ.', set: { 'viết lại': rewritten }, remove: removed, draft: repl.map((x) => ({ id: x.key, value: `B${x.level} · ${short(x.statement, 80)} · chờ dịch ngược lại` })), source: re[i].source });
      });
      if (fresh.length) src = mergeSources('E7.retranslation', [src, await vote(fresh, 2)]);
      const dropped = inds.filter((x) => !x.pass);
      inds = inds.filter((x) => x.pass);
      tb.beat('READ', 'Dịch ngược vòng 2 · bỏ chỉ báo vẫn trượt', { formula: 'p_i ≥ 0,70 — (27)', substitution: `bỏ ${dropped.length} chỉ báo`, remove: dropped.map((x) => x.key), source: src });
    }
  } else for (const ind of inds) ind.pass = true;
  inds = [...inherited, ...inds];
  // (29) per competency and level; (28) Fleiss' kappa of the classes; majority class; KS1 automatic checks
  const countOk = (cid: string) => INDICATOR_LEVELS.every((L) => indicatorCountOk(inds.filter((x) => x.competency_id === cid && x.level === L && x.pass).length));
  const classOf = new Map<string, string>();
  const ratings = groups.map((g) => {
    const v = classVotes.get(`1|${g.competency_id}`) ?? [];
    const c = new Map<string, number>();
    for (const x of v) if (x) c.set(x, (c.get(x) ?? 0) + 1);
    const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
    classOf.set(g.competency_id, top && top[1] >= 2 ? top[0] : '');
    return v;
  });
  const fk = fleissKappa(ratings);
  tb.calc({ substep: 'B6.fleiss', formula: 'κ = (P̄ − P̄_e) / (1 − P̄_e) — (28)', inputs: { competencies: ratings.length, seats: s.agent_config.seats.length }, output: fk });
  const weakClass = groups.filter((g) => (classVotes.get(`1|${g.competency_id}`) ?? []).filter((x) => x && x === classOf.get(g.competency_id)).length < 2);
  const metas = groups.filter((g) => classOf.get(g.competency_id) === 'META');
  const seen = new Map<string, string>();
  const ks1: { key: string; kind: 'ERROR' | 'WARN'; text: string }[] = [];
  for (const x of inds) {
    const k = norm(x.statement);
    const other = seen.get(k);
    if (other && other.split('#')[0] !== x.competency_id) ks1.push({ key: x.key, kind: 'ERROR', text: `trùng nguyên văn với ${other}` });
    seen.set(k, x.key);
    if (PERSONALITY.test(x.statement)) ks1.push({ key: x.key, kind: 'WARN', text: 'mô tả tính cách thay vì hành vi' });
    if (x.statement.split(/\s+/).length > 40) ks1.push({ key: x.key, kind: 'WARN', text: 'dài quá 40 từ' });
  }
  const passedC = groups.filter((g) => countOk(g.competency_id));
  const excluded = groups.filter((g) => !passedC.includes(g));
  for (const g of groups) tb.calc({ substep: 'B6.count', item_ref: g.competency_id, formula: '2 ≤ số chỉ báo đạt mỗi bậc 1, 3, 5 ≤ 4 — (29)', inputs: Object.fromEntries(INDICATOR_LEVELS.map((L) => [`b${L}`, inds.filter((x) => x.competency_id === g.competency_id && x.level === L && x.pass).length])), output: { ok: countOk(g.competency_id), class: classOf.get(g.competency_id) ?? '' }, decision: countOk(g.competency_id) ? 'đi tiếp' : 'cần người xem lại' });
  const okInds = inds.filter((x) => x.pass);
  const oc = outcomeConstraint(outcomeLinks, passedC.map((g) => g.competency_id), outcomeList.map((o) => o.id));
  if (outcomeList.length) tb.calc({ substep: 'B6.outcomes', formula: 'mỗi năng lực lõi gắn ≥ 1 kết quả ∧ mỗi kết quả có ≥ 2 năng lực — (30)', inputs: { outcomes: outcomeList.length, links: outcomeLinks }, output: oc });
  const kErrors = ks1.filter((x) => x.kind === 'ERROR');
  const minK = s.policy.min_kappa ?? 0.61;
  // Kappa paradox (decision of 19/11/2026): when one class holds most competencies (P̄_e ≥ 0.6, usual for one
  // occupation), κ collapses even when the seats agree; the gate then reads the observed agreement P̄ ≥ 0.70 instead.
  // κ is still computed and recorded.
  const SKEW_PE = 0.6, SKEW_MIN_P = 0.7;
  const skewed = fk.kappa !== null && fk.Pe >= SKEW_PE;
  if (skewed) tb.calc({ substep: 'B6.class_agreement', item_ref: null, formula: `P̄_e ≥ ${SKEW_PE} → cổng xét P̄ ≥ ${SKEW_MIN_P} thay cho κ — (28)`, inputs: { P: fk.P, Pe: fk.Pe, kappa: fk.kappa, items: fk.items }, output: { pass: fk.P >= SKEW_MIN_P }, decision: 'lớp lệch: dùng đồng ý quan sát' });
  const gates = [
    gate('B6', 1, 'Có năng lực đủ chỉ báo đạt', passedC.length ? 'PASS' : 'FAIL', `${passedC.length}/${groups.length}`, '≥ 1 năng lực, mỗi bậc 1, 3, 5 có 2–4 chỉ báo đạt — (27), (29)', { refs: excluded.map((g) => g.competency_id) }),
    groups.length < 2 || fk.kappa === null
      ? deviationGate('B6', 2, 'Đồng thuận xếp lớp (Fleiss κ)', fk.kappa === null ? 'không tính được' : `κ = ${fk.kappa}`, `κ ≥ ${minK} — (28)`, 'Dưới 2 năng lực hoặc thiếu phiếu: không tính được κ.', 'Lớp của năng lực chưa được kiểm đồng thuận.')
      : skewed
        ? gate('B6', 2, 'Đồng thuận xếp lớp (Fleiss κ)', fk.P >= SKEW_MIN_P ? 'PASS' : 'FAIL', `P̄ = ${fk.P} (κ = ${fk.kappa}, P̄_e = ${fk.Pe})`, `lớp lệch (P̄_e ≥ ${SKEW_PE}): P̄ ≥ ${SKEW_MIN_P} thay cho κ ≥ ${minK} — (28), quyết định 19/11/2026`)
        : gate('B6', 2, 'Đồng thuận xếp lớp (Fleiss κ)', fk.kappa >= minK ? 'PASS' : 'FAIL', `κ = ${fk.kappa}`, `κ ≥ ${minK} — (28)`),
    gate('B6', 3, 'Kiểm tra tự động (KS1)', kErrors.length ? 'FAIL' : 'PASS', `${kErrors.length} lỗi, ${ks1.length - kErrors.length} cảnh báo`, '0 lỗi', { refs: kErrors.map((x) => x.key) }),
    !outcomeList.length
      ? deviationGate('B6', 4, 'Ràng buộc năng lực – kết quả chính', 'chưa có kết quả chính', 'mỗi năng lực lõi gắn ≥ 1 kết quả ∧ mỗi kết quả có ≥ 2 năng lực — (30)', 'Charter chưa khai 3–5 kết quả chính của vị trí.', 'Chưa kiểm được khung có gánh đủ kết quả công việc không.')
      : gate('B6', 4, 'Ràng buộc năng lực – kết quả chính', oc.ok ? 'PASS' : 'FAIL', `${oc.unlinked.length} năng lực chưa gắn kết quả, ${oc.thin.length} kết quả có < 2 năng lực`, 'mỗi năng lực lõi gắn ≥ 1 kết quả ∧ mỗi kết quả có ≥ 2 năng lực — (30)', { refs: [...oc.unlinked, ...oc.thin] }),
    gate('B6', 5, 'Tối đa một năng lực meta', metas.length <= (s.policy.max_meta ?? 1) ? 'PASS' : 'FAIL', metas.length, `≤ ${s.policy.max_meta ?? 1} — (22)–(23)`, { refs: metas.map((g) => g.competency_id) }),
  ];
  tb.gates(gates);
  const pass = !gates.some(gateBlocks);
  const handoff = pass ? `${okInds.length} chỉ báo đạt; ${passedC.length} năng lực đi tiếp${excluded.length ? `, ${excluded.length} cần người xem lại` : ''}; κ lớp ${fk.kappa ?? '—'}.` : 'Chưa đủ điều kiện G6: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao chỉ báo đã kiểm cho B7' : 'Chặn · không bàn giao', { explanation: handoff });
  const unanimous = okInds.filter((x) => x.votes.length && x.votes.every((v) => v.choice === x.votes[0].choice && v.level === x.votes[0].level)).length;
  const output = { indicators: inds, inherited: inherited.length, outcomes: outcomeList, outcome_links: outcomeLinks, passed: passedC.map((g) => g.competency_id), excluded: excluded.map((g) => g.competency_id), rewritten, classes: Object.fromEntries(classOf), weak_class: weakClass.map((g) => g.competency_id), fleiss: fk, ks1, seats_discarded: seatsDiscarded, unusual_agreement: okInds.length >= 5 && unanimous / okInds.length > 0.9, screening: 'AI_SEATS', ai_executed: true };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, { passed: okInds.length, total: inds.length }),
    ai: ag.list(),
    view: {
      input: [['Năng lực lõi', String(groups.length)]],
      output: [['Chỉ báo đạt', `${okInds.length}`], ['Năng lực đi tiếp', String(passedC.length)], ['Viết lại', String(rewritten)], ['Fleiss κ (lớp)', String(fk.kappa ?? '—')]],
      rows: inds.map((x) => ({ id: x.key, name: x.statement, value: `B${x.level} · ${x.correct}/${x.non_abstain}`, detail: groups.find((g) => g.competency_id === x.competency_id)!.label + (x.round > 1 ? ' · bản viết lại' : ''), bad: !x.pass, data: { 'chỉ báo': x.statement, bậc: x.level, 'năng lực dự kiến': groups.find((g) => g.competency_id === x.competency_id)!.label, 'phiếu ba ghế': x.votes.map((v) => `${v.seat} (${v.model}): ${v.choice ? groups.find((g) => g.competency_id === v.choice)?.label ?? v.choice : 'bỏ trống'}${v.level ? ` · bậc ${v.level}` : ''}`), 'p_i': x.agreement, vòng: x.round, 'đoạn nguồn': x.segment_ids } })),
      calc: [
        { label: 'Tỷ lệ dịch ngược', formula: 'p_i = số ghế đúng cả năng lực và bậc / số ghế — (27)', substitution: okInds.slice(0, 4).map((x) => `${x.correct}/${x.non_abstain}`).join(' · ') || '—', meaning: 'Phiếu trắng vẫn nằm trong mẫu số; cần ≥ 0,70.' },
        { label: 'Fleiss κ xếp lớp', formula: 'κ = (P̄ − P̄_e) / (1 − P̄_e) — (28)', substitution: `P̄ = ${fk.P}; P̄_e = ${fk.Pe}; κ = ${fk.kappa ?? '—'}`, meaning: 'Ba ghế có xếp năng lực vào cùng lớp không.' },
      ],
      notes: [
        'Kết quả là vòng kiểm của ba ghế AI (mỗi ghế một vai), không thay người.',
        ...(excluded.length ? [`Cần người xem lại: ${excluded.map((g) => g.label).join(', ')}. Các năng lực này không vào bản công bố.`] : []),
        ...(output.unusual_agreement ? ['Đồng thuận bất thường: ba ghế cho cùng đáp án ở hơn 90% chỉ báo (S7).'] : []),
        ...(ks1.length ? [`KS1: ${ks1.slice(0, 5).map((x) => `${x.key} ${x.text}`).join('; ')}`] : []),
      ],
      handoff,
    },
  };
}

export async function runB7(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const tb = new TraceBuilder('B7', ctx.attemptId, ctx.now);
  const blocks: BlockId[] = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
  const segs = segIndex(ctx.docs);
  tb.beat('RECEIVE', 'Nhận kết quả cổng của B0–B6', { set: { 'block đạt': 0 } });
  let okBlocks = 0;
  const chain = blocks.map((b) => {
    const gs = ctx.prevGates[b] ?? [];
    const blocking = gs.filter(gateBlocks);
    const ok = gs.length > 0 && !blocking.length;
    if (ok) okBlocks++;
    tb.record(b, `Cổng ${b}`, gs.map((g) => ({ cổng: g.name, 'thực tế': g.actual, 'tiêu chí': g.criterion, 'kết quả': g.status, 'lý do': g.reason ?? '—', 'bắt buộc': g.required })));
    tb.beat('READ', `Gom cổng ${b}`, { refs: [b], formula: 'PASS_b = AND(cổng bắt buộc PASS hoặc Không áp dụng có lý do)', substitution: `${gs.filter((g) => g.required).length} cổng bắt buộc → ${ok ? 'PASS' : 'CHẶN'}; block đạt = ${okBlocks}`, set: { 'block đạt': okBlocks }, draft: [{ id: b, value: `${b} · ${ok ? 'PASS' : 'CHẶN'}${blocking.length ? ' · ' + blocking.map((g) => g.name).join(', ') : ''}` }], delta: ok ? `✓ ${b}` : `⊘ ${b}` });
    return { id: b, pass: ok };
  });
  const passed = new Set(ctx.prev.B6!.passed as string[]);
  const tasks = ctx.prev.B2!.tasks as LiveTask[];
  const links = ctx.prev.B5!.links as Record<string, { competency_id: string }[]>;
  const sumW = ctx.prev.B5!.sum_w as number;
  const num = round4(tasks.reduce((a, t) => a + (links[t.id].some((x) => passed.has(x.competency_id)) ? t.weight : 0), 0));
  const finalCov = ratio(num, sumW);
  const groups = usable(ctx).filter((g) => passed.has(g.competency_id));
  const allSegs = [...groups.flatMap((g) => g.segment_ids), ...tasks.flatMap((t) => t.segment_ids), ...(ctx.prev.B6!.indicators as any[]).filter((x) => x.pass && x.round > 0).flatMap((x) => x.segment_ids)]; // inherited indicators (round 0) keep the root's evidence, stored in the dictionary
  const missing = [...new Set(allSegs.filter((id) => !segs.has(id)))];
  tb.beat('READ', 'Coverage sau khi loại năng lực chưa qua dịch ngược', { formula: 'coverage_cuối = Σ(w · 1[có năng lực đã qua B6])/Σw', substitution: `${num}/${sumW} = ${pct(finalCov)}`, denominator: { value: sumW, note: 'Σw cố định từ B2' }, set: { 'coverage cuối': pct(finalCov) } });
  tb.beat('READ', 'Kiểm đủ nguồn và nhất quán phiên bản', { formula: 'thiếu = số đoạn được trích không có trong snapshot', substitution: `${new Set(allSegs).size} đoạn được trích, thiếu ${missing.length}`, set: { 'đoạn thiếu': missing.length } });
  const docsOk = s.documents.every((d) => ctx.docs.find((x) => x.ref === d.ref)?.content_sha256 === d.content_sha256);

  // E8 (KS4): independent audit of the finished dossier — 10 variables (33), item support, a ⌈0.1·N⌉ re-check sample (32)
  const inds6 = ((ctx.prev.B6!.indicators ?? []) as any[]).filter((x) => x.pass && passed.has(x.competency_id));
  const coded = new Map<string, string>();
  for (const g of groups) for (const x of g.segment_ids) if (!coded.has(x)) coded.set(x, g.competency_id);
  const N = coded.size;
  const nSample = Math.min(N, auditSample(N));
  const seed = seedOf(`${s.session.role_title}|E8|${[...coded.keys()].sort().join(',')}`);
  const sampleIds = seededShuffle([...coded.keys()].sort(), seed).slice(0, nSample);
  const auIds = new ShortIds();
  const sample = sampleIds.map((x) => ({ id: auIds.short('q', x), text: maskedText(segs.get(x)?.seg.text ?? ''), code: groups.find((g) => g.competency_id === coded.get(x))?.label ?? '' }));
  const items = groups.map((g) => ({ item_id: `C:${g.competency_id}`, action: g.decision, label: g.label, definition: g.definition, indicators: inds6.filter((x) => x.competency_id === g.competency_id).map((x) => `B${x.level}: ${x.statement}`), segments: g.segment_ids.filter((r) => segs.has(r)).slice(0, 4).map((r) => ({ id: auIds.short('s', r), text: short(maskedText(segs.get(r)!.seg.text), 200) })) }));
  const allGates = Object.entries(ctx.prevGates).flatMap(([b, gs]) => (gs ?? []).map((g) => ({ block: b, name: g.name, status: g.deviation ? 'PASS (phiếu sai lệch)' : g.status })));
  const b3 = ctx.prev.B3 as any, b5 = ctx.prev.B5 as any, b6 = ctx.prev.B6 as any;
  const stats = [
    { name: 'mức chặt chẽ', value: s.policy.rigor ?? 'C' },
    { name: 'JD hợp lệ / P1', value: `${ctx.prev.B1?.valid ?? 0} / ${ctx.prev.B1?.ranks?.P1 ?? 0}` },
    { name: 'κ mã hóa kép (E9)', value: String(b3?.recode?.kappa ?? '—') },
    { name: 'r_wg nhỏ nhất của tập lõi', value: String(b5?.min_rwg ?? '—') },
    { name: 'Fleiss κ xếp lớp', value: String(b6?.fleiss?.kappa ?? '—') },
    { name: 'coverage cuối', value: pct(finalCov) },
    { name: 'sự kiện thật', value: String(s.events.length) },
  ];
  // every E8 call also carries the gate results, the stats and (first call) the re-check sample: leave room for them
  // The main call carries the gate results, the stats and the re-check sample and scores the ten variables; side
  // batches (large frameworks) only review items, so the fixed part is not repeated in every call.
  const fixedChars = JSON.stringify({ gates: allGates, stats }).length + JSON.stringify(sample).length;
  const itemSize = (x: (typeof items)[number]) => x.label.length + x.definition.length + x.indicators.join(' ').length + x.segments.reduce((a, y) => a + y.text.length + 8, 0) + 80;
  const firstRoom = BATCH_CHARS() - 1500 - fixedChars;
  let used = 0;
  const first = items.filter((x) => (used + itemSize(x) <= firstRoom ? ((used += itemSize(x)), true) : false));
  const rest = items.filter((x) => !first.includes(x));
  const auBatches = [first, ...pack(rest, itemSize, BATCH_CHARS() - 1500)];
  // P5.4: a derived framework left out of the batch audit sample is not audited by E8 (its G7 passes on a ticket)
  const sampled = s.session.charter?.audit_sampled !== false;
  const auRes = !sampled ? [] : await Promise.all(auBatches.map((batch, bi) => ag.run('E8', { role_title: s.session.role_title, purpose: s.session.purpose, items: batch, sample: bi === 0 ? sample : [], gates: bi === 0 ? allGates : [], stats: bi === 0 ? stats : [] })));
  const RANK = { CLEAR: 0, CLEAR_WITH_NOTES: 1, NOT_CLEAR: 2 } as const;
  const VRANK = { PASS: 0, PASS_COND: 1, FAIL: 2 } as const;
  const variables = AUDIT_VARIABLE_LIST.map((v) => {
    const all = (auRes[0] ? [auRes[0]] : []).flatMap((r) => r.output.variables.filter((x) => x.variable === v));
    const worst = [...all].sort((a, b) => VRANK[b.result] - VRANK[a.result])[0];
    return { variable: v, result: worst?.result ?? 'FAIL', plan: worst?.plan ?? '' };
  });
  const sampleOk = auRes[0]?.output.sample.filter((x) => x.code_ok === 'YES').length ?? 0;
  const audit = {
    items: auRes.flatMap((r) => r.output.items),
    findings: auRes.flatMap((r) => r.output.findings).map((f) => ({ ...f, item_id: f.item_id })),
    conclusion_code: auRes.map((r) => r.output.conclusion_code).sort((a, b) => RANK[b] - RANK[a])[0] ?? 'CLEAR',
    unchecked_scope: auRes[0]?.output.unchecked_scope ?? '',
    variables,
    sample: { n: sample.length, of: N, ok: sampleOk, seed },
    source: mergeSources('E8.audit_review', auRes.map((r) => r.source)),
  };
  for (const v of variables) tb.calc({ substep: 'B7.variable', item_ref: v.variable, formula: 'biến ∈ {đạt, đạt có điều kiện kèm kế hoạch} — (33)', inputs: { result: v.result }, output: { plan: v.plan }, decision: v.result });
  for (const q of auRes[0]?.output.sample ?? []) tb.calc({ substep: 'B7.sample', item_ref: auIds.long(q.id) ?? q.id, formula: 'mẫu ⌈0,1 · N⌉ câu đã mã hóa, rút ngẫu nhiên — (32)', inputs: { seed }, output: { code_ok: q.code_ok } });
  // (31): the auditor must use a model that extracted, wrote and scored nothing (every E agent that made content, and the seats)
  const tk = s.agent_config.tasks;
  const makers = [tk.E1, tk.E23, tk.E4, tk.E5, tk.E6, tk.E9, tk.E10, tk.E7].map((x) => x?.model).concat(s.agent_config.seats.map((x) => x.model)).filter(Boolean) as string[];
  const auditor = s.agent_config.tasks.E8?.model ?? '';
  const independent = auditIndependent(auditor, makers);
  tb.beat('READ', 'Thẩm định độc lập (E8)', { explanation: `Kết luận ${audit.conclusion_code}; ${variables.filter((v) => v.result === 'PASS').length}/10 biến đạt; mẫu ${sampleOk}/${sample.length} câu mã đúng.`, formula: 'G7 ⇔ cả 10 biến ∈ {đạt, đạt có điều kiện kèm kế hoạch} — (33); n = ⌈0,1 · N⌉ — (32)', substitution: `n = ⌈0,1 · ${N}⌉ = ${nSample}`, set: { 'biến đạt': variables.filter((v) => v.result === 'PASS').length }, source: audit.source });
  const gates = [
    gate('B7', 1, 'Mọi cổng bắt buộc B0–B6', okBlocks === blocks.length ? 'PASS' : 'FAIL', `${okBlocks}/${blocks.length}`, `= ${blocks.length}/${blocks.length}`),
    gate('B7', 2, 'Đủ nguồn', missing.length ? 'FAIL' : 'PASS', missing.length, '0 đoạn thiếu', { refs: missing }),
    finalCov === null ? gate('B7', 3, 'Coverage cuối', 'NOT_EVALUATED', 'Không tính được', `≥ ${pct(s.policy.min_coverage)}`, { reason: 'Σw = 0.' }) : gate('B7', 3, 'Coverage cuối', finalCov >= s.policy.min_coverage ? 'PASS' : 'FAIL', pct(finalCov), `≥ ${pct(s.policy.min_coverage)} (${s.policy.thresholds_status})`),
    gate('B7', 4, 'Nhất quán phiên bản', docsOk ? 'PASS' : 'FAIL', docsOk ? 'khớp' : 'lệch', 'tài liệu và release nền đúng snapshot'),
    !sampled
      ? deviationGate('B7', 5, 'Thẩm định 10 biến', 'ngoài mẫu thẩm định của lô', 'cả 10 biến đạt hoặc đạt có điều kiện — (33)', 'Khung phái sinh không nằm trong mẫu 1/5 của lô (P5.4).', 'Khung chỉ được kiểm tự động; nếu một khung của lô trượt thẩm định thì cả lô được thẩm định.')
      : gate('B7', 5, 'Thẩm định 10 biến', g7(variables) ? 'PASS' : 'FAIL', `${variables.filter((v) => v.result === 'PASS').length} đạt, ${variables.filter((v) => v.result === 'PASS_COND').length} có điều kiện, ${variables.filter((v) => v.result === 'FAIL').length} chưa đạt`, 'cả 10 biến đạt hoặc đạt có điều kiện kèm kế hoạch — (33)', { refs: variables.filter((v) => !(v.result === 'PASS' || (v.result === 'PASS_COND' && v.plan))).map((v) => v.variable) }),
    !sampled
      ? gate('B7', 6, 'Thẩm định độc lập', 'NOT_APPLICABLE', 'không thẩm định', 'model thẩm định ∉ {trích, soạn, chấm} — (31)', { reason: 'Khung ngoài mẫu thẩm định của lô.' })
      : independent
      ? gate('B7', 6, 'Thẩm định độc lập', 'PASS', auditor, 'model thẩm định ∉ {trích, soạn, chấm} — (31)')
      : deviationGate('B7', 6, 'Thẩm định độc lập', `${auditor} trùng model với một bước làm`, 'model thẩm định ∉ {trích, soạn, chấm} — (31)', 'Cấu hình agent của lượt đặt E8 cùng model với một bước làm (mặc định E8 dùng Opus). E8 chạy ngữ cảnh mới, không thấy câu lệnh và lập luận của bước làm.', 'Thẩm định cùng model có thể bỏ sót lỗi chung của model; người duyệt ở đầu ra là lớp kiểm cuối.'),
    !sampled
      ? gate('B7', 7, 'Mẫu kiểm lại câu đã mã hóa', 'NOT_APPLICABLE', 'không thẩm định', 'E8 xác nhận ≥ 80% câu trong mẫu ⌈0,1 · N⌉ — (32)', { required: false, reason: 'Khung ngoài mẫu thẩm định của lô.' })
      : gate('B7', 7, 'Mẫu kiểm lại câu đã mã hóa', !sample.length || sampleOk / sample.length >= 0.8 ? 'PASS' : 'FAIL', `${sampleOk}/${sample.length}`, 'E8 xác nhận ≥ 80% câu trong mẫu ⌈0,1 · N⌉ — (32)', { required: false }),
  ];
  tb.gates(gates);
  const pass = !gates.some(gateBlocks);
  const handoff = pass ? `Đủ điều kiện lập hồ sơ: ${groups.length} năng lực, coverage cuối ${pct(finalCov)}.` : 'Có cổng bắt buộc chưa đạt: không lập hồ sơ công bố.';
  tb.beat('HANDOFF', pass ? 'Bàn giao cho B8 lập hồ sơ' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { chain, final_coverage: finalCov, final_competencies: groups.map((g) => g.competency_id), missing_segments: missing, audit, audit_sampled: sampled, independent_audit: independent, ai_executed: sampled };
  return { status: pass ? 'DONE' : 'BLOCKED', output, gates, trace: tb.build(gates, { pass }), ai: ag.list(), view: { input: [['Cổng của', 'B0–B6']], output: [['Block đạt', `${okBlocks}/${blocks.length}`], ['Coverage cuối', pct(finalCov)], ['Đoạn thiếu', String(missing.length)]], rows: chain.map((c) => ({ id: c.id, name: `Cổng ${c.id}`, value: c.pass ? 'PASS' : 'CHẶN', detail: (ctx.prevGates[c.id] ?? []).map((g) => `${g.name}: ${g.status}`).join(' · '), bad: !c.pass, data: ctx.prevGates[c.id] })), calc: [{ label: 'Tổng nghiệm thu', formula: 'PASS = AND(mọi cổng bắt buộc)', substitution: chain.map((c) => `${c.id}:${c.pass ? '1' : '0'}`).join(' ∧ '), meaning: 'Một cổng bắt buộc chưa đạt là đủ để chặn công bố.' }], notes: [], handoff, visual: { kind: 'b7', gates: chain, coverageOk: finalCov !== null && finalCov >= s.policy.min_coverage } } };
}

const fid = (...parts: string[]) => 'F-' + sha256(parts.join('|')).slice(0, 10);

export async function runB8(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const db = ctx.agent.db;
  const tb = new TraceBuilder('B8', ctx.attemptId, ctx.now);
  const segs = segIndex(ctx.docs);
  const final = new Set(ctx.prev.B7!.final_competencies as string[]);
  const allGroups = ctx.prev.B3!.groups as LiveGroup[];
  const groups = allGroups.filter((g) => final.has(g.competency_id));
  const review = allGroups.filter((g) => !final.has(g.competency_id));
  // accepted groups whose dictionary match E4 was unsure of: in the framework as the nearest base competency, flagged
  const unsureMatch = groups.filter((g) => g.decision === 'NEEDS_REVIEW' && g.base_version != null);
  const tasks = ctx.prev.B2!.tasks as LiveTask[];
  const b5 = ctx.prev.B5!;
  const inds = (ctx.prev.B6!.indicators as any[]).filter((x) => x.pass && final.has(x.competency_id));
  const base = ctx.base;
  const baseHas = (kind: string, id: string) => base.members.find((m) => m.kind === kind && m.id === id) ?? null;
  const items: CandidateItem[] = [];
  const vId = (segId: string) => 'V-' + sha256(segId).slice(0, 12);
  const framesUsing = (cid: string) => base.R.filter((f) => f.data.requirements.some((q) => q.competency_id === cid)).map((f) => `${f.data.role_title} (${f.id} v${f.data.version_label})`);

  tb.beat('RECEIVE', `Nhận ${groups.length} năng lực đã nghiệm thu và release nền ${base.versionLabel}`, { explanation: 'Code so từng bản ghi với release nền để phân loại ADD / UPDATE / REUSE. Chưa có gì được ghi vào từ điển ở block này.', set: { ADD: 0, UPDATE: 0, REUSE: 0 } });
  const counts = { ADD: 0, UPDATE: 0, REUSE: 0 };
  for (const g of groups) {
    const cur = base.C.find((c) => c.id === g.competency_id) ?? null;
    let action: 'ADD' | 'UPDATE' | 'REUSE' = !cur ? 'ADD' : g.decision === 'UPDATE' ? 'UPDATE' : 'REUSE';
    const aliases = [...new Set([...(cur?.data.aliases ?? []), ...g.aliases])].filter((a) => norm(a) !== norm(cur?.data.label ?? g.label)).sort();
    if (action === 'REUSE' && cur && aliases.length !== cur.data.aliases.length) action = 'UPDATE';
    const data: CData | null = action === 'ADD' ? { competency_id: g.competency_id, display_code: '', label: g.label, definition: g.definition, aliases, status: 'ACTIVE' } : action === 'UPDATE' ? { ...cur!.data, definition: g.decision === 'UPDATE' ? g.definition : cur!.data.definition, aliases } : null;
    const reason = action === 'ADD' ? `Không năng lực nào trong từ điển nền ${base.versionLabel} cùng nội hàm; ${g.jd_refs.length} JD nêu (${g.segment_ids.length} đoạn).` : action === 'UPDATE' ? (g.decision === 'UPDATE' ? `Cùng nội hàm với ${cur!.data.label} (${g.boundary}); căn cứ mới từ ${g.jd_refs.length} JD cho thấy cần sửa định nghĩa.` : `Dùng lại ${cur!.data.label}; thêm alias ${g.aliases.join(', ')}.`) : `Cùng nội hàm với ${cur!.data.label} (${g.boundary}, tin cậy ${g.confidence}); dùng lại nguyên định nghĩa.`;
    // P3 preview: the same classification the registry applies at commit (38), so the reviewer sees the bump
    const cl = action === 'UPDATE' && cur ? classify('C', cur.data, data) : null;
    const fromV = cur ? semverOf(cur) : null;
    items.push({ item_id: `C:${g.competency_id}`, entity: 'C', id: g.competency_id, action, name: g.label, before: cur?.data.definition ?? null, after: action === 'REUSE' ? cur!.data.definition : data!.definition, reason, affected: action === 'UPDATE' ? framesUsing(g.competency_id) : [], base_version: cur?.version ?? null, data, depends_on: null, evidence_refs: g.segment_ids, ...(cl ? { change_types: cl.types, bump: cl.bump, from_version: fromV, to_version: fmtSemver(bumpSemver(parseSemver(fromV), cl.bump)) } : action === 'ADD' ? { to_version: '1.0.0' } : {}) } as any);
    counts[action]++;
    tb.record(`C:${g.competency_id}`, g.label, { 'hành động': action, trước: cur?.data.definition ?? '—', sau: data?.definition ?? cur?.data.definition, 'lý do': reason, 'khung bị ảnh hưởng': action === 'UPDATE' ? framesUsing(g.competency_id) : [] });
    tb.beat('READ', `So với nền · ${short(g.label, 44)}`, { refs: [`C:${g.competency_id}`], formula: `${action} = ${action} + 1`, substitution: `${counts[action] - 1} + 1 = ${counts[action]}`, set: { ...counts }, draft: [{ id: g.competency_id, value: `${action} · ${g.label}` }], delta: `+ ${action} ${g.competency_id}`, explanation: reason });
  }
  for (const x of inds) {
    const id = `I-${x.competency_id.replace(/^C-/, '')}-${x.n}`;
    const cur = base.I.find((i) => i.id === id) ?? null;
    const action = !cur ? 'ADD' : cur.data.statement === x.statement ? 'REUSE' : 'UPDATE';
    const data: IData | null = action === 'REUSE' ? null : { indicator_id: id, competency_id: x.competency_id, level: x.level, statement: x.statement, segment_ids: x.segment_ids, screening: `AI_SCREEN ${x.correct}/${x.non_abstain}` };
    items.push({ item_id: `I:${id}`, entity: 'I', id, action, name: short(x.statement, 60), before: cur?.data.statement ?? null, after: x.statement, reason: action === 'ADD' ? 'Chỉ báo mới, đã qua dịch ngược.' : action === 'UPDATE' ? 'Câu chỉ báo thay đổi so với nền.' : 'Giữ nguyên chỉ báo của nền.', affected: [], base_version: cur?.version ?? null, data, depends_on: x.competency_id, evidence_refs: x.segment_ids });
  }
  const cited = new Map<string, Set<string>>();
  for (const g of groups) for (const id of g.segment_ids) cited.set(id, (cited.get(id) ?? new Set()).add(g.competency_id));
  for (const x of inds) for (const id of x.segment_ids) cited.set(id, (cited.get(id) ?? new Set()).add(x.competency_id));
  for (const [segId, cids] of [...cited.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hit = segs.get(segId);
    if (!hit) continue;
    const id = vId(segId);
    const cur = baseHas('V', id);
    const data: VData = { evidence_id: id, evidence_class: 'JD', document_ref: hit.doc.ref, segment_id: segId, start: hit.seg.start, end: hit.seg.end, quote: hit.seg.text, quote_sha256: sha256(hit.seg.text), usage_scope: s.policy.publish_scope, provenance: `${hit.doc.source_ref} · ${hit.doc.original_name}`, evidence_verification: 'JD_STATED', competency_ids: [...cids].sort() };
    items.push({ item_id: `V:${id}`, entity: 'V', id, action: cur ? 'REUSE' : 'ADD', name: short(hit.seg.text, 60), before: null, after: hit.seg.text, reason: 'Đoạn JD được trích làm căn cứ.', affected: [], base_version: cur?.version ?? null, data: cur ? null : data, depends_on: null, evidence_refs: [segId] });
  }
  for (const e of (ctx.prev.B4!.real as any[]).filter((e) => e.has_source && e.supported.some((c: string) => final.has(c)))) {
    const id = 'V-' + sha256('event|' + e.id).slice(0, 12);
    const cur = baseHas('V', id);
    const quote = [e.situation, e.action, e.outcome].filter(Boolean).join(' | ');
    items.push({ item_id: `V:${id}`, entity: 'V', id, action: cur ? 'REUSE' : 'ADD', name: short(e.label, 60), before: null, after: quote, reason: 'Sự kiện thật do người dùng nhập, T7 xác nhận hỗ trợ.', affected: [], base_version: cur?.version ?? null, data: cur ? null : ({ evidence_id: id, evidence_class: 'REAL', document_ref: null, segment_id: null, start: null, end: null, quote, quote_sha256: sha256(quote), usage_scope: s.policy.publish_scope, provenance: e.source_ref, evidence_verification: 'UNVERIFIED', competency_ids: e.supported.filter((c: string) => final.has(c)).sort() } satisfies VData), depends_on: null, evidence_refs: [e.id] });
  }
  const wId = `W-${s.session.role_id}`;
  const wData: WData = { role_id: s.session.role_id, role_title: s.session.role_title, tasks: tasks.map((t) => ({ task_id: t.id, statement: t.statement, weight: t.weight, competency_ids: (b5.links[t.id] as any[]).map((x) => x.competency_id).filter((c) => final.has(c)).sort(), segment_ids: t.segment_ids })) };
  const wCur = base.W.find((w) => w.id === wId) ?? null;
  const wAction = !wCur ? 'ADD' : hashJson(wCur.data) === hashJson(wData) ? 'REUSE' : 'UPDATE';
  items.push({ item_id: `W:${wId}`, entity: 'W', id: wId, action: wAction, name: `Nhiệm vụ của ${s.session.role_title}`, before: wCur ? `${wCur.data.tasks.length} nhiệm vụ` : null, after: `${wData.tasks.length} nhiệm vụ`, reason: wAction === 'ADD' ? 'Role chưa có danh sách nhiệm vụ trong từ điển.' : wAction === 'UPDATE' ? 'Danh sách nhiệm vụ hoặc liên kết thay đổi so với nền.' : 'Danh sách nhiệm vụ không đổi.', affected: [], base_version: wCur?.version ?? null, data: wAction === 'REUSE' ? null : wData, depends_on: null, evidence_refs: tasks.flatMap((t) => t.segment_ids) });
  const share = (cid: string) => tasks.reduce((a, t) => a + ((b5.links[t.id] as any[]).some((x) => x.competency_id === cid) ? t.weight : 0), 0);
  const totalShare = groups.reduce((a, g) => a + share(g.competency_id), 0);
  const rId = `R-${s.session.role_id}`;
  const rCur = base.R.find((r) => r.id === rId) ?? null;
  // (34)–(36): tier from the gates and how they passed; review date from the family
  const prevAll = Object.entries(ctx.prevGates) as [BlockId, GateResult[]][];
  const deviationIn = [...new Set(prevAll.flatMap(([b, gs]) => ((gs ?? []).some((g) => g.deviation) ? [sopGate(b)!] : [])))];
  const byData = (b: BlockId) => (ctx.prevGates[b] ?? []).filter((g) => g.required).every((g) => g.status === 'PASS' && !g.deviation);
  const tierRes = releaseTier({ rigor: s.policy.rigor ?? 'C', g6Data: byData('B6'), g7Data: byData('B7'), deviationIn, g11: !!s.session.charter?.g11_ref, g12: !!s.session.charter?.g12_ref });
  const tech = TECH_FAMILY.test(`${s.session.family ?? ''} ${s.session.industry ?? ''} ${s.session.role_title}`);
  const reviewBy = reviewDate(ctx.now, tech);
  const owner = s.session.charter?.owner ?? null;
  tb.calc({ substep: 'B8.tier', formula: 'Sản phẩm thị trường ⇔ mức ≥ B ∧ G6, G7 đạt bằng dữ liệu ∧ không cổng G1, G3–G7 qua bằng phiếu sai lệch — (34)', inputs: { rigor: s.policy.rigor, deviation_in: deviationIn, g6_data: byData('B6'), g7_data: byData('B7') }, output: { tier: tierRes.tier }, decision: tierRes.reasons.join(' ') || null });
  tb.calc({ substep: 'B8.review', formula: 'ngày rà soát = ngày phát hành + 12 tháng (công nghệ, dữ liệu, AI) hoặc + 24 tháng — (36)', inputs: { tech_family: tech, from: ctx.now.slice(0, 10) }, output: { review_date: reviewBy } });
  tb.beat('READ', 'Tầng phát hành và hạn rà soát', { formula: '(34)–(36)', substitution: `tầng ${tierRes.tier}; rà soát trước ${reviewBy}`, explanation: tierRes.reasons.join(' '), set: { tầng: tierRes.tier, 'hạn rà soát': reviewBy } });
  // P5.3 (43): share of this framework's competencies that are also in its root framework; below 0.60 → a new root
  const rootSid = s.session.charter?.root_session_id ?? null;
  const rootFrame = rootSid ? [...base.R].reverse().find((f) => f.data.session_id === rootSid) ?? null : null;
  const finalIds = (ctx.prev.B7!.final_competencies as string[]) ?? [];
  const overlap = rootFrame && finalIds.length ? round4(finalIds.filter((c) => rootFrame.data.requirements.some((q) => q.competency_id === c)).length / finalIds.length) : null;
  if (rootSid) tb.calc({ substep: 'B8.overlap', formula: 'tỷ lệ trùng = |C khung ∩ C khung gốc| / |C khung| — (43)', inputs: { root: rootFrame ? `${rootFrame.data.role_title} ${rootFrame.data.version_label}` : null, competencies: finalIds.length }, output: { overlap }, decision: overlap == null ? 'chưa có khung gốc đã công bố' : overlap < 0.6 ? 'dưới 0,60: nên làm khung gốc mới' : 'đủ trùng để là phái sinh' });
  const rData: RData = {
    framework_id: rId,
    role_id: s.session.role_id,
    role_title: s.session.role_title,
    version_label: '',
    tier: tierRes.tier,
    review_date: reviewBy,
    owner,
    purpose: s.session.purpose,
    evidence_scope: (ctx.prev.B4!.real as any[]).length ? 'jd_and_events' : 'jd_only',
    run_id: ctx.runId,
    session_id: s.session.id,
    family: s.session.family,
    industry: s.session.industry,
    requirements: groups.map((g) => ({
      competency_id: g.competency_id,
      competency_version: 0,
      required_level: (b5.levels[g.competency_id] as number | null) ?? null,
      weight: totalShare ? round4(share(g.competency_id) / totalShare) : null,
      indicators: inds.filter((x) => x.competency_id === g.competency_id).map((x) => ({ indicator_id: `I-${x.competency_id.replace(/^C-/, '')}-${x.n}`, version: 0 })),
      evidence_ids: g.segment_ids.filter((id) => segs.has(id)).map(vId),
      task_ids: tasks.filter((t) => (b5.links[t.id] as any[]).some((x) => x.competency_id === g.competency_id)).map((t) => t.id),
    })),
  };
  items.push({ item_id: `R:${rId}`, entity: 'R', id: rId, action: rCur ? 'UPDATE' : 'ADD', name: `Khung ${s.session.role_title}`, before: rCur ? `v${rCur.data.version_label} · ${rCur.data.requirements.length} năng lực` : null, after: `${rData.requirements.length} năng lực`, reason: rCur ? 'Lượt mới tạo phiên bản khung mới; phiên bản cũ giữ nguyên.' : 'Khung đầu tiên của role này.', affected: [], base_version: rCur?.version ?? null, data: rData, depends_on: null, evidence_refs: [] });
  for (const g of unsureMatch) items.push({ item_id: `C:${g.competency_id}:review`, entity: 'C', id: g.competency_id, action: 'NEEDS_REVIEW', name: g.label, before: g.base_definition, after: g.definition, reason: `Đã qua B5–B7 như năng lực ${g.base_label ?? g.competency_id} của từ điển nền; E4 chưa chắc cùng nội hàm. Mặc định giữ bản nền; người duyệt xác nhận dùng lại hoặc tách thành năng lực mới.`, affected: [], base_version: g.base_version, data: null, depends_on: null, evidence_refs: g.segment_ids });
  for (const g of review) items.push({ item_id: `C:${g.competency_id}:review`, entity: 'C', id: g.competency_id, action: 'NEEDS_REVIEW', name: g.label, before: g.base_definition, after: g.definition, reason: g.decision === 'NEEDS_REVIEW' ? 'E4 không đủ chắc để chọn REUSE/UPDATE/ADD.' : 'Chưa qua độ phủ hoặc dịch ngược.', affected: [], base_version: g.base_version, data: null, depends_on: null, evidence_refs: g.segment_ids });
  tb.beat('READ', 'Dựng bản ghi I, V, W, R đi kèm', { formula: 'hồ sơ = C + I + V + W + R', substitution: ['C', 'I', 'V', 'W', 'R'].map((k) => `${k}: ${items.filter((i) => i.entity === k && i.action !== 'NEEDS_REVIEW').length}`).join(' · '), set: { 'mục hồ sơ': items.filter((i) => i.action !== 'NEEDS_REVIEW').length, 'cần xem lại': review.length } });

  // --- audit: deterministic part ---
  const findings: (Finding & { fingerprint: string })[] = [];
  const add = (severity: string, type: string, item: string, expected: string, observed: string, evidence: string[]) => findings.push({ id: fid(ctx.runId, type, item), severity, type, text: observed, expected, observed, evidence, fingerprint: sha256(`${type}|${norm(item)}`).slice(0, 16) });
  const chainOk = await verifyEventChain(db, ctx.workspaceId);
  if (!chainOk.ok) add('CRITICAL', 'PROCESS_ORDER', 'event-chain', 'Chuỗi hash của nhật ký sự kiện liền mạch.', `Chuỗi gãy tại ${chainOk.brokenAt}.`, [chainOk.brokenAt ?? '']);
  // REUSE items keep the evidence already in the dictionary (e.g. indicators a derived framework inherits)
  const unresolved = items.filter((i) => i.action !== 'NEEDS_REVIEW' && i.action !== 'REUSE' && i.entity !== 'V' && i.entity !== 'R' && i.evidence_refs.some((r) => !segs.has(r)));
  for (const u of unresolved) add('HIGH', 'EVIDENCE_GAP', u.name, 'Mọi đoạn căn cứ tồn tại trong snapshot.', `Mục ${u.item_id} trỏ tới đoạn không có trong snapshot.`, u.evidence_refs.filter((r) => !segs.has(r)));
  const failedAttempts = await db.select({ id: t.blockAttempt.id }).from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, ctx.runId), eq(t.blockAttempt.status, 'FAILED')));
  const checks = [`Chuỗi hash sự kiện: ${chainOk.ok ? 'liền mạch' : 'gãy'} (${chainOk.count} sự kiện)`, `Đoạn căn cứ resolve được: ${unresolved.length ? 'thiếu' : 'đủ'}`, `Thứ tự block B0→B7: đủ ${Object.keys(ctx.prev).filter((k) => k !== 'FAST').length}/8 đầu ra hợp lệ`, `Lần chạy lỗi trong lượt: ${failedAttempts.length}`];
  tb.beat('READ', 'Kiểm toán xác định (code)', { explanation: checks.join(' · '), set: { 'finding': findings.length } });
  // --- audit: content part (E8) ---
  const cItems = items.filter((i) => i.entity === 'C' && i.action !== 'NEEDS_REVIEW');
  const allGates = Object.entries(ctx.prevGates).flatMap(([b, gs]) => (gs ?? []).map((g) => ({ block: b, name: g.name, status: g.status })));
  // the content audit ran in B7 (E8, independent of every making step); B8 turns its findings into lessons and stops
  const b7audit = ctx.prev.B7!.audit as any;
  const au = { output: { items: (b7audit?.items ?? []) as { item_id: string; support_check: string }[], findings: (b7audit?.findings ?? []) as { severity: string; type: string; item_id: string; expected: string; observed: string }[], conclusion_code: (b7audit?.conclusion_code ?? 'CLEAR') as 'CLEAR' | 'CLEAR_WITH_NOTES' | 'NOT_CLEAR', unchecked_scope: (b7audit?.unchecked_scope ?? '') as string }, source: (b7audit?.source ?? 'CODE') as TraceSource };
  const support = new Map(au.output.items.map((x) => [x.item_id, x.support_check]));
  for (const f of au.output.findings) add(f.severity, f.type, cItems.find((i) => i.item_id === f.item_id)?.name ?? f.type, f.expected, f.observed, f.item_id ? [f.item_id] : []);
  for (const i of cItems) if (support.get(i.item_id) === 'NOT_SUPPORTED' && i.action !== 'REUSE' && !findings.some((f) => f.evidence.includes(i.item_id))) add('HIGH', 'UNSUPPORTED_CONTENT', i.name, 'Đoạn căn cứ hỗ trợ nội dung sẽ ghi.', `E8 đánh giá ${i.name} là NOT_SUPPORTED.`, [i.item_id]);
  tb.beat('READ', 'Kiểm toán nội dung (E8)', { explanation: `Kết luận: ${au.output.conclusion_code}. Không kiểm được: ${au.output.unchecked_scope}`, formula: 'finding = finding(code) + finding(E8)', substitution: `${findings.length - au.output.findings.length} + ${au.output.findings.length} = ${findings.length}`, set: { finding: findings.length, 'kết luận AU': au.output.conclusion_code }, draft: findings.map((f) => ({ id: f.id, value: `${f.severity} · ${f.type} · ${short(f.observed ?? '', 70)}` })), source: au.source });

  // persist findings + lessons (repeat fingerprints attach to the existing lesson)
  const lessonsNow = await db.select().from(t.lesson).where(eq(t.lesson.workspaceId, ctx.workspaceId));
  let repeats = 0;
  for (const f of findings) {
    await db.insert(t.finding).values({ id: f.id, workspaceId: ctx.workspaceId, runId: ctx.runId, severity: f.severity, fingerprint: f.fingerprint, data: f }).onConflictDoNothing();
    const existing = lessonsNow.find((l) => l.fingerprint === f.fingerprint);
    if (existing) {
      repeats++;
      const data = existing.data as any;
      if (!data.finding_refs.includes(f.id)) await db.update(t.lesson).set({ data: { ...data, finding_refs: [...data.finding_refs, f.id], repeats: (data.repeats ?? 0) + 1 } }).where(eq(t.lesson.id, existing.id));
      f.lesson = existing.id;
    } else {
      const id = 'LL-' + f.fingerprint.slice(0, 8);
      const data = { text: `${f.type}: ${f.observed}`, finding_refs: [f.id], applies_when: `Block liên quan gặp lại tình huống "${f.type}".`, proposed_change: f.expected, control: `Kiểm "${f.expected}" trước khi bàn giao.`, test: `Chạy lại lượt có cùng dữ liệu và xác nhận không còn finding ${f.type}.`, owner: 'local', repeats: 0 };
      await db.insert(t.lesson).values({ id, workspaceId: ctx.workspaceId, fingerprint: f.fingerprint, status: 'PENDING', data }).onConflictDoNothing();
      lessonsNow.push({ id, workspaceId: ctx.workspaceId, fingerprint: f.fingerprint, status: 'PENDING', data, decidedBy: null, decidedAt: null, decisionReason: null, createdAt: ctx.now });
      f.lesson = id;
    }
  }
  const stopping = findings.filter((f) => s.policy.stop_on.includes(f.severity));
  if (stopping.length) await raiseStop(db, ctx.workspaceId, { reason: `Finding mức ${stopping[0].severity}: ${stopping[0].observed}`, finding_refs: stopping.map((f) => f.id), actor: 'system:B8', runId: ctx.runId });

  await db.update(t.candidate).set({ status: 'SUPERSEDED' }).where(and(eq(t.candidate.runId, ctx.runId), eq(t.candidate.status, 'READY')));
  await db.update(t.candidate).set({ status: 'SUPERSEDED' }).where(and(eq(t.candidate.runId, ctx.runId), eq(t.candidate.status, 'DECIDED')));
  const candidateId = newId('cand');
  await db.insert(t.candidate).values({ id: candidateId, workspaceId: ctx.workspaceId, runId: ctx.runId, attemptId: ctx.attemptId, baseReleaseId: s.base_release_id, items, status: 'READY' });
  await appendEvent(db, { workspaceId: ctx.workspaceId, type: 'CANDIDATE_READY', actor: 'system:B8', sessionId: s.session.id, runId: ctx.runId, attemptId: ctx.attemptId, block: 'B8', outputHash: hashJson(items), payload: { candidate_id: candidateId, counts, needs_review: review.length } });
  await appendEvent(db, { workspaceId: ctx.workspaceId, type: 'AUDIT', actor: 'agent:AU', sessionId: s.session.id, runId: ctx.runId, attemptId: ctx.attemptId, block: 'B8', payload: { conclusion: au.output.conclusion_code, findings: findings.length, repeats, stop: stopping.length > 0 } });

  const audit: AuditView = {
    scope: `Hồ sơ ${cItems.length} năng lực của lượt, cổng B0–B7, nhật ký sự kiện của workspace.`,
    findings: findings.map(({ fingerprint: _f, ...f }) => f),
    limitations: [au.output.unchecked_scope, 'Kiểm toán nội dung do agent E8 thực hiện, không thay kiểm toán của người.', ...(findings.length < 3 ? ['Chưa đủ dữ liệu để đánh giá xu hướng lỗi (cần nhiều lượt hơn).'] : [])],
    checks,
    conclusions: [`Kết luận AU: ${au.output.conclusion_code === 'CLEAR' ? 'không có vấn đề cản trở công bố' : au.output.conclusion_code === 'CLEAR_WITH_NOTES' ? 'có điểm cần cải tiến, không cản trở' : 'không nên công bố khi chưa xử lý'}.`, `Finding: ${findings.length} (lặp lại: ${repeats}).`],
  };
  const changes: ChangeItem[] = items.filter((i) => i.entity === 'C').map((i) => ({ entity: 'C', id: i.id, name: i.name, action: i.action, before: i.before, after: i.after, reason: i.reason, affected: i.affected }));
  const gates = [
    gate('B8', 1, 'Kiểm toán có kết luận', 'PASS', au.output.conclusion_code, 'có ≥ 1 kết luận có căn cứ'),
    gate('B8', 2, 'Không có finding mức STOP', stopping.length ? 'FAIL' : 'PASS', stopping.length, `0 finding mức ${s.policy.stop_on.join('/')}`, { refs: stopping.map((f) => f.id) }),
    gate('B8', 3, 'Tham chiếu hồ sơ resolve được', unresolved.length ? 'FAIL' : 'PASS', unresolved.length, '0 mục thiếu căn cứ'),
    owner
      ? gate('B8', 4, 'Mã phiên bản, hạn rà soát, người phụ trách', 'PASS', `${rData.version_label ? 'v' + rData.version_label : 'phiên bản cấp khi ghi'} · ${reviewBy} · ${owner}`, 'đủ ba trường (G8)')
      : s.policy.id === 'dev-small'
        ? deviationGate('B8', 4, 'Mã phiên bản, hạn rà soát, người phụ trách', `${rData.version_label ? 'v' + rData.version_label : 'phiên bản cấp khi ghi'} · ${reviewBy} · chưa có người phụ trách`, 'đủ ba trường (G8)', 'Charter chưa khai người phụ trách.', 'Không ai được giao rà soát khung đúng hạn.')
        : gate('B8', 4, 'Mã phiên bản, hạn rà soát, người phụ trách', 'FAIL', `${rData.version_label ? 'v' + rData.version_label : 'phiên bản cấp khi ghi'} · ${reviewBy} · chưa có người phụ trách`, 'đủ ba trường (G8)'),
  ];
  tb.gates(gates);
  const pass = !gates.some(gateBlocks);
  const handoff = pass ? `Hồ sơ DỰ KIẾN (tầng ${tierRes.tier}): ${counts.ADD} ADD · ${counts.UPDATE} UPDATE · ${counts.REUSE} REUSE${review.length ? ` · ${review.length} cần xem lại (không vào release)` : ''}. Chờ quyết định của người có quyền.` : 'STOP: không ghi được vào từ điển cho tới khi finding được xử lý và workspace được mở lại.';
  tb.beat('HANDOFF', pass ? 'Chờ quyết định công bố' : 'STOP · không công bố', { explanation: handoff });
  const output = { candidate_id: candidateId, overlap_with_root: overlap, root_framework: rootFrame ? { id: rootFrame.id, version_label: rootFrame.data.version_label } : null, tier: tierRes.tier, tier_reasons: tierRes.reasons, deviations: deviationIn, review_date: reviewBy, owner, counts, needs_review: review.map((g) => g.competency_id), changes, audit, findings: findings.map((f) => f.id), stop: stopping.length > 0, support: Object.fromEntries(support), ai_executed: true };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, counts),
    ai: ag.list(),
    view: {
      input: [['Năng lực đã nghiệm thu', String(groups.length)], ['Release nền', base.versionLabel]],
      output: [['ADD / UPDATE / REUSE', `${counts.ADD} / ${counts.UPDATE} / ${counts.REUSE}`], ['Cần xem lại', String(review.length)], ['Finding', String(findings.length)], ['Trạng thái', 'DỰ KIẾN · chưa ghi']],
      rows: items.filter((i) => i.entity !== 'V').map((i) => ({ id: i.item_id, name: `${i.entity} · ${i.name}`, value: i.action, detail: i.reason, bad: i.action === 'NEEDS_REVIEW', data: { loại: i.entity, id: i.id, 'hành động': i.action, trước: i.before ?? '—', sau: i.after ?? '—', 'lý do': i.reason, 'khung bị ảnh hưởng': i.affected, 'kiểm toán nội dung': support.get(i.item_id) ?? '—', 'căn cứ': i.evidence_refs.slice(0, 8) } })),
      calc: [{ label: 'Phân loại thay đổi', formula: 'ADD: id chưa có ở nền · UPDATE: id có, nội dung đổi · REUSE: id@version giữ nguyên', substitution: `${counts.ADD} / ${counts.UPDATE} / ${counts.REUSE}`, meaning: 'UPDATE một định nghĩa dùng chung ảnh hưởng mọi khung đang dùng nó.' }],
      notes: ['Đây là hồ sơ DỰ KIẾN. Chỉ khi người có quyền chấp nhận và commit thành công mới có bản ĐÃ GHI kèm receipt.', ...audit.conclusions!],
      handoff,
      visual: { kind: 'b8', changes },
    },
  };
}
