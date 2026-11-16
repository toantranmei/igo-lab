import { and, eq } from 'drizzle-orm';
import { gateBlocks, type AuditView, type BlockId, type ChangeItem, type Finding, type GateResult, type TraceSource } from '@cl/contract';
import { appendEvent, hashJson, newId, sha256, t, verifyEventChain } from '@cl/db';
import { raiseStop, type CandidateItem, type CData, type IData, type RData, type VData, type WData } from '@cl/registry';
import { agentTracker, mergeSources, norm, segIndex, short, type LiveGroup, type LiveTask } from './blocks-a';
import { TraceBuilder, gate, pct, policyRef, ratio, round4, type BlockCtx, type BlockResult } from './types';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const labelOf = (g: LiveGroup) => ({ id: g.competency_id, label: g.label, definition: g.definition });
const usable = (ctx: BlockCtx) => (ctx.prev.B3!.groups as LiveGroup[]).filter((g) => g.decision !== 'NEEDS_REVIEW');

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
  const checks = doVerify ? await Promise.all(s.events.map((e) => ag.run('T7', { event: { id: e.id, label: e.label, situation: e.situation, action: e.action, outcome: e.outcome }, competencies: groups.map(labelOf) }))) : [];
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
  const need = s.policy.propose_hypotheses ? groups.filter((g) => !supported.has(g.competency_id)) : [];
  const props = await Promise.all(need.map((g) => ag.run('T13', { role_title: s.session.role_title, competency: { id: g.competency_id, label: g.label, definition: g.definition, segments: g.segment_ids.slice(0, 8).map((id) => ({ id, text: segs.get(id)?.seg.text ?? '' })) } })));
  const hypotheses = need.map((g, i) => {
    const o = props[i].output;
    const h = { id: 'HYP-' + sha256(g.competency_id).slice(0, 8), competency_id: g.competency_id, label: g.label, situation: o.situation, action: o.action, outcome: o.expected_outcome, segment_ids: o.segment_ids, evidence_class: 'HYPOTHESIS' as const, evidence_verification: 'UNVERIFIED' as const };
    tb.beat('READ', `Đề xuất giả thuyết · ${short(g.label, 40)}`, { refs: [g.competency_id], explanation: 'Code gắn cứng lớp GIẢ THUYẾT. Mục này dùng để đi thu bằng chứng thật, không nâng lớp căn cứ.', formula: 'giả thuyết = giả thuyết + 1 (không cộng vào bằng chứng)', substitution: `${i} + 1 = ${i + 1}; bằng chứng thật vẫn = ${sourced}`, set: { 'giả thuyết': i + 1 }, draft: [{ id: h.id, value: `GIẢ THUYẾT · ${short(g.label, 40)} · ${short(o.situation, 60)}` }], delta: `+ ${h.id}`, source: props[i].source });
    return h;
  });
  const cov = ratio(sourced, real.length);
  const na = { reason: `Lượt chỉ có JD: policy ${policyRef(s.policy)} cho phép (allow_jd_only).` };
  const unsupported = real.filter((e) => e.has_source && !e.supported.length);
  const gates: GateResult[] = [
    real.length ? gate('B4', 1, 'Nguồn sự kiện thật tồn tại', cov === 1 ? 'PASS' : 'FAIL', `${sourced}/${real.length}`, '= 100% sự kiện thật có nguồn') : gate('B4', 1, 'Nguồn sự kiện thật tồn tại', s.policy.allow_jd_only ? 'NOT_APPLICABLE' : 'FAIL', 'Không có sự kiện thật', '= 100% sự kiện thật có nguồn', s.policy.allow_jd_only ? na : {}),
    real.length ? gate('B4', 2, 'Sự kiện thật hỗ trợ mệnh đề', unsupported.length ? 'FAIL' : 'PASS', `${real.length - unsupported.length}/${real.length}`, 'mỗi sự kiện hỗ trợ ≥ 1 năng lực (T7)', { required: false }) : gate('B4', 2, 'Sự kiện thật hỗ trợ mệnh đề', 'NOT_APPLICABLE', 'Không có sự kiện thật', 'mỗi sự kiện hỗ trợ ≥ 1 năng lực (T7)', { ...na, required: false }),
    gate('B4', 3, 'Giả thuyết không tính là bằng chứng', 'PASS', 0, 'số giả thuyết trong tử số bằng chứng = 0'),
  ];
  tb.gates(gates);
  const pass = !gates.some(gateBlocks);
  const handoff = pass ? `${real.length} sự kiện thật (${supported.size} nhóm được hỗ trợ), ${hypotheses.length} giả thuyết gắn nhãn rõ.` : 'Sự kiện thật thiếu nguồn: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao căn cứ cho B5' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { real, hypotheses, source_coverage: cov, supported: [...supported], evidence_verification: real.length ? 'UNVERIFIED' : 'JD_STATED', ai_executed: ag.list().length > 0 };
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
      notes: ['Giả thuyết do agent T13 đề xuất để đi thu bằng chứng thật; chúng không được ghi vào từ điển.', ...(real.length ? [] : ['Khung của lượt này chỉ dựa trên JD (mức căn cứ: JD nêu).'])],
      handoff,
    },
  };
}

export async function runB5(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
  const ag = agentTracker(ctx);
  const tb = new TraceBuilder('B5', ctx.attemptId, ctx.now);
  const groups = usable(ctx);
  const tasks = ctx.prev.B2!.tasks as LiveTask[];
  const segs = segIndex(ctx.docs);
  const sumW = round4(tasks.reduce((a, t) => a + t.weight, 0));
  for (const t of tasks) tb.record(t.id, short(t.statement, 60), { 'nhiệm vụ': t.statement, 'trọng số': t.weight });
  for (const g of groups) tb.record(g.competency_id, g.label, { nhãn: g.label, 'định nghĩa': g.definition });
  tb.beat('RECEIVE', `Nhận ${tasks.length} nhiệm vụ (Σw = ${sumW}) và ${groups.length} năng lực ứng viên`, { set: { 'Σw (mẫu số)': sumW, 'tử số': 0, coverage: pct(sumW ? 0 : null), 'năng lực được chọn': 0 } });
  const linked = await Promise.all(tasks.map((t) => ag.run('T8', { task: { id: t.id, statement: t.statement, segments: t.segment_ids.map((id) => ({ id, text: segs.get(id)?.seg.text ?? '' })) }, competencies: groups.map(labelOf) })));
  const links: Record<string, { competency_id: string; segment_ids: string[] }[]> = {};
  const selected = new Set<string>();
  let num = 0;
  tasks.forEach((t, i) => {
    const l = linked[i].output.links.filter((x) => x.segment_ids.length && groups.some((g) => g.competency_id === x.competency_id));
    links[t.id] = l;
    l.forEach((x) => selected.add(x.competency_id));
    const before = num;
    if (l.length) num = round4(num + t.weight);
    tb.beat('READ', `Nối nhiệm vụ · ${short(t.statement, 44)}`, { refs: [t.id, ...l.map((x) => x.competency_id)], formula: 'tử số += w · 1[nhiệm vụ có ≥ 1 năng lực với cạnh hợp lệ]; coverage = tử số / Σw', substitution: `${before} + ${t.weight} × ${l.length ? 1 : 0} = ${num}; coverage = ${num}/${sumW} = ${pct(ratio(num, sumW))}`, denominator: { value: sumW, note: 'Σw cố định từ B2' }, set: { 'tử số': num, coverage: pct(ratio(num, sumW)), 'năng lực được chọn': selected.size }, draft: [{ id: t.id, value: `${short(t.statement, 50)} → ${l.length ? l.map((x) => groups.find((g) => g.competency_id === x.competency_id)!.label).join(', ') : '⊘ chưa có năng lực'}` }], delta: l.length ? `+ ${l.length} cạnh` : `⊘ ${t.id} hở`, source: linked[i].source });
  });
  const coverage = ratio(num, sumW);
  const sel = groups.filter((g) => selected.has(g.competency_id));
  const covWithout = (drop: Set<string>) => ratio(round4(tasks.reduce((a, t) => a + (links[t.id].some((x) => !drop.has(x.competency_id)) ? t.weight : 0), 0)), sumW);
  const dropOne = sel.map((g) => ({ competency_id: g.competency_id, label: g.label, coverage_without: covWithout(new Set([g.competency_id])), lost_tasks: tasks.filter((t) => links[t.id].length && links[t.id].every((x) => x.competency_id === g.competency_id)).map((t) => t.id) }));
  tb.beat('READ', 'Phép thử bỏ một năng lực', { explanation: dropOne.map((d) => `Bỏ ${d.label}: ${pct(d.coverage_without)}`).join(' · ') || 'Không có năng lực nào được chọn.', formula: 'coverage₋c = Σ(w · 1[còn năng lực khác c])/Σw', substitution: dropOne.slice(0, 4).map((d) => `${short(d.label, 20)}: ${pct(d.coverage_without)}`).join(' · ') || '—' });
  const levels: Record<string, number | null> = {};
  const voteSources: TraceSource[] = [];
  for (const g of sel) {
    if (!s.rubric.length) {
      levels[g.competency_id] = null;
      continue;
    }
    const votes = await Promise.all(s.agent_config.seats.map((seat) => ag.run('T9', { seat: seat.seat, role_title: s.session.role_title, competency: labelOf(g), rubric: s.rubric, segments: g.segment_ids.slice(0, 8).map((id) => ({ id, text: segs.get(id)?.seg.text ?? '' })) }, { model: seat.model, effort: seat.effort })));
    votes.forEach((v) => voteSources.push(v.source));
    const nums = votes.map((v) => v.output.level).filter((l) => l !== 'ABSTAIN').map(Number);
    levels[g.competency_id] = nums.length >= 2 ? median(nums) : null;
    tb.beat('READ', `Bậc yêu cầu · ${short(g.label, 40)}`, { refs: [g.competency_id], formula: 'Level = median(phiếu hợp lệ)', substitution: nums.length >= 2 ? `median(${[...nums].sort().join(', ')}) = ${levels[g.competency_id]}` : `Chỉ ${nums.length} phiếu hợp lệ → chưa xác định`, source: mergeSources('T9.level_vote', votes.map((v) => v.source)) });
  }
  if (!s.rubric.length) tb.beat('READ', 'Bậc yêu cầu: chưa xác định', { explanation: 'Phiên không có rubric bậc nên không gọi T9. Bậc hiển thị "Chưa xác định" thay vì đoán.' });
  const uncovered = tasks.filter((t) => !links[t.id].length);
  const gates = [
    sumW === 0 ? gate('B5', 1, 'Độ phủ nhiệm vụ', 'NOT_EVALUATED', 'Không tính được', `≥ ${pct(s.policy.min_coverage)}`, { reason: 'Σw = 0.' }) : gate('B5', 1, 'Độ phủ nhiệm vụ', coverage! >= s.policy.min_coverage ? 'PASS' : 'FAIL', pct(coverage), `≥ ${pct(s.policy.min_coverage)} (policy, ${s.policy.thresholds_status})`, { refs: uncovered.map((t) => t.id) }),
    gate('B5', 2, 'Có năng lực được chọn', sel.length ? 'PASS' : 'FAIL', sel.length, '≥ 1'),
  ];
  tb.gates(gates);
  const pass = gates.every((g) => g.status === 'PASS');
  const handoff = pass ? `Chọn ${sel.length} năng lực, coverage ${pct(coverage)}${uncovered.length ? `, còn hở ${uncovered.length} nhiệm vụ` : ''}.` : `Coverage ${pct(coverage)} dưới ngưỡng: không bàn giao.`;
  tb.beat('HANDOFF', pass ? 'Bàn giao ma trận nhiệm vụ × năng lực cho B6' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { links, selected: sel.map((g) => g.competency_id), coverage, numerator: num, sum_w: sumW, uncovered: uncovered.map((t) => t.id), drop_one: dropOne, levels, level_status: s.rubric.length ? 'RUBRIC' : 'UNDEFINED', ai_executed: true };
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
  statement: string;
  segment_ids: string[];
  round: number;
  votes: { seat: string; model: string; choice: string }[];
  correct: number;
  non_abstain: number;
  agreement: number | null;
  pass: boolean;
}

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
  for (const g of groups) tb.record(g.competency_id, g.label, { nhãn: g.label, 'định nghĩa': g.definition, 'nhiệm vụ': tasksOf(g.competency_id) });
  tb.beat('RECEIVE', `Nhận ${groups.length} năng lực đã chọn từ B5`, { explanation: 'T10 viết chỉ báo. Ba ghế T11 (ba model khác nhau) đoán lại năng lực mà không biết đáp án. Đây là lớp sàng AI, không thay reviewer người.', set: { 'chỉ báo': 0, 'đạt': 0, 'viết lại': 0 } });
  const write = (g: LiveGroup, note: string) => ag.run('T10', { role_title: s.session.role_title, competency: labelOf(g), tasks: tasksOf(g.competency_id).slice(0, 8), segments: g.segment_ids.slice(0, 8).map((id) => ({ id, text: segs.get(id)?.seg.text ?? '' })), required_level: b5.levels[g.competency_id] == null ? 'chưa xác định' : String(b5.levels[g.competency_id]), revision_note: note });
  const vote = async (inds: LiveIndicator[]) => {
    // Opaque ids in hash order so neither the id nor the position leaks the intended competency.
    const order = [...inds].sort((a, b) => sha256(a.statement).localeCompare(sha256(b.statement)));
    const opaque = new Map(order.map((x, i) => [x.key, 'IND-' + String(i + 1).padStart(2, '0')]));
    const res = await Promise.all(s.agent_config.seats.map((seat) => ag.run('T11', { seat: seat.seat, indicators: order.map((x) => ({ id: opaque.get(x.key)!, statement: x.statement })), labels }, { model: seat.model, effort: seat.effort })));
    for (const ind of inds) {
      ind.votes = res.map((r, i) => ({ seat: s.agent_config.seats[i].seat, model: s.agent_config.seats[i].model, choice: r.output.votes.find((v) => v.indicator_id === opaque.get(ind.key))?.competency_id ?? 'ABSTAIN' }));
      ind.non_abstain = ind.votes.filter((v) => v.choice !== 'ABSTAIN').length;
      ind.correct = ind.votes.filter((v) => v.choice === ind.competency_id).length;
      ind.agreement = ratio(ind.correct, ind.non_abstain);
      ind.pass = ind.agreement !== null && ind.agreement >= s.policy.min_item_agreement - 1e-9;
    }
    return mergeSources('T11.retranslation', res.map((r) => r.source));
  };
  const toInds = (g: LiveGroup, out: { statement: string; segment_ids: string[] }[], round: number): LiveIndicator[] => out.map((x, i) => ({ key: `${g.competency_id}#${i + 1}`, competency_id: g.competency_id, n: i + 1, statement: x.statement, segment_ids: x.segment_ids, round, votes: [], correct: 0, non_abstain: 0, agreement: null, pass: false }));

  const first = await Promise.all(groups.map((g) => write(g, '')));
  let inds: LiveIndicator[] = groups.flatMap((g, i) => toInds(g, first[i].output.indicators, 1));
  groups.forEach((g, i) => tb.beat('READ', `Viết chỉ báo · ${short(g.label, 40)}`, { refs: [g.competency_id], formula: 'chỉ báo = chỉ báo + số câu', substitution: `+ ${first[i].output.indicators.length}`, set: { 'chỉ báo': inds.filter((x) => groups.findIndex((y) => y.competency_id === x.competency_id) <= i).length }, draft: toInds(g, first[i].output.indicators, 1).map((x) => ({ id: x.key, value: `${short(x.statement, 90)} · chờ dịch ngược` })), delta: `+ ${first[i].output.indicators.length} chỉ báo`, source: first[i].source }));
  let rewritten = 0;
  if (s.policy.retranslation && inds.length) {
    let src = await vote(inds);
    const nameOf = (id: string) => (id === 'ABSTAIN' ? 'abstain' : groups.find((g) => g.competency_id === id)?.label ?? id);
    const beatVotes = (round: number) => {
      let ok = 0;
      for (const ind of inds) {
        if (ind.pass) ok++;
        tb.beat('READ', `Dịch ngược${round > 1 ? ' (sau viết lại)' : ''} · ${short(ind.statement, 40)}`, { refs: [ind.competency_id], explanation: `Phiếu: ${ind.votes.map((v) => nameOf(v.choice)).join(' · ')}. So với nhãn dự kiến: ${nameOf(ind.competency_id)}.`, formula: 'agreement = số ghế chọn đúng / số ghế không abstain', substitution: ind.non_abstain ? `${ind.correct}/${ind.non_abstain} = ${pct(ind.agreement)} ${ind.pass ? '≥' : '<'} ${pct(s.policy.min_item_agreement)}` : 'Mọi ghế abstain → Không tính được', denominator: { value: ind.non_abstain, note: 'Số ghế không abstain' }, set: { 'đạt': ok }, draft: [{ id: ind.key, value: `${short(ind.statement, 90)} · ${ind.non_abstain ? `${ind.correct}/${ind.non_abstain}` : 'abstain'} ${ind.pass ? '✓' : '⊘'}` }], delta: ind.pass ? `✓ ${ind.key}` : `⊘ ${ind.key}`, source: src });
      }
    };
    beatVotes(1);
    const failing = groups.filter((g) => inds.some((x) => x.competency_id === g.competency_id && !x.pass));
    if (failing.length) {
      const re = await Promise.all(
        failing.map((g) => {
          const bad = inds.filter((x) => x.competency_id === g.competency_id && !x.pass);
          const wrong = [...new Set(bad.flatMap((x) => x.votes.filter((v) => v.choice !== g.competency_id).map((v) => nameOf(v.choice))))].sort();
          return write(g, `Bản trước bị đánh giá là: ${wrong.join(', ') || 'không rõ'}. Nêu rõ đối tượng và sản phẩm đặc trưng của "${g.label}".`);
        }),
      );
      failing.forEach((g, i) => {
        const fresh = toInds(g, re[i].output.indicators, 2);
        rewritten += fresh.length;
        const removed = inds.filter((x) => x.competency_id === g.competency_id).map((x) => x.key);
        inds = [...inds.filter((x) => x.competency_id !== g.competency_id), ...fresh];
        tb.beat('READ', `Viết lại chỉ báo · ${short(g.label, 40)}`, { refs: [g.competency_id], explanation: 'Dưới ngưỡng đồng thuận: một vòng viết lại kèm ghi chú lỗi, tạo phiên bản chỉ báo mới.', set: { 'viết lại': rewritten }, remove: removed.filter((k) => !fresh.some((f) => f.key === k)), draft: fresh.map((x) => ({ id: x.key, value: `${short(x.statement, 90)} · chờ dịch ngược lại` })), delta: `↻ ${fresh.length} chỉ báo`, source: re[i].source });
      });
      src = await vote(inds);
      beatVotes(2);
    }
  } else for (const ind of inds) ind.pass = true;
  const order = new Map(groups.map((g, i) => [g.competency_id, i]));
  inds.sort((a, b) => order.get(a.competency_id)! - order.get(b.competency_id)! || a.n - b.n);
  const passedC = groups.filter((g) => inds.some((x) => x.competency_id === g.competency_id && x.pass));
  const excluded = groups.filter((g) => !passedC.includes(g));
  const okInds = inds.filter((x) => x.pass);
  const gates = [
    gate('B6', 1, 'Có năng lực qua dịch ngược', passedC.length ? 'PASS' : 'FAIL', `${passedC.length}/${groups.length}`, '≥ 1 năng lực có chỉ báo đạt'),
    gate('B6', 2, 'Mọi chỉ báo đạt ngưỡng đồng thuận', okInds.length === inds.length && inds.length ? 'PASS' : 'FAIL', `${okInds.length}/${inds.length}`, `agreement ≥ ${pct(s.policy.min_item_agreement)} so với nhãn dự kiến (${s.policy.thresholds_status})`, { required: false, refs: inds.filter((x) => !x.pass).map((x) => x.key) }),
  ];
  tb.gates(gates);
  const pass = !gates.some(gateBlocks);
  const handoff = pass ? `${okInds.length}/${inds.length} chỉ báo đạt; ${passedC.length} năng lực đi tiếp${excluded.length ? `, ${excluded.length} cần người xem lại` : ''}.` : 'Không năng lực nào có chỉ báo đạt: không bàn giao.';
  tb.beat('HANDOFF', pass ? 'Bàn giao chỉ báo đã sàng cho B7' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { indicators: inds, passed: passedC.map((g) => g.competency_id), excluded: excluded.map((g) => g.competency_id), rewritten, screening: 'AI_SCREEN', ai_executed: true };
  return {
    status: pass ? 'DONE' : 'BLOCKED',
    output,
    gates,
    trace: tb.build(gates, { passed: okInds.length, total: inds.length }),
    ai: ag.list(),
    view: {
      input: [['Năng lực đã chọn', String(groups.length)]],
      output: [['Chỉ báo đạt', `${okInds.length}/${inds.length}`], ['Năng lực đi tiếp', String(passedC.length)], ['Viết lại', String(rewritten)]],
      rows: inds.map((x) => ({ id: x.key, name: x.statement, value: x.non_abstain ? `${x.correct}/${x.non_abstain}` : 'abstain', detail: groups.find((g) => g.competency_id === x.competency_id)!.label + (x.round > 1 ? ' · bản viết lại' : ''), bad: !x.pass, data: { 'chỉ báo': x.statement, 'nhãn dự kiến': groups.find((g) => g.competency_id === x.competency_id)!.label, 'phiếu ba ghế': x.votes.map((v) => `${v.seat} (${v.model}): ${v.choice === 'ABSTAIN' ? 'abstain' : groups.find((g) => g.competency_id === v.choice)?.label ?? v.choice}`), agreement: pct(x.agreement), vòng: x.round, 'đoạn nguồn': x.segment_ids } })),
      calc: [{ label: 'Đồng thuận từng chỉ báo', formula: 'agreement = số ghế chọn đúng / số ghế không abstain', substitution: inds.slice(0, 4).map((x) => (x.non_abstain ? `${x.correct}/${x.non_abstain}` : 'abstain')).join(' · ') || '—', meaning: 'Chỉ báo mà người đọc không đoán lại được đúng năng lực thì chưa đủ phân biệt.' }],
      notes: ['Kết quả là lớp sàng AI (ba model khác nhau), so với nhãn dự kiến; không thay reviewer người.', ...(excluded.length ? [`Cần người xem lại: ${excluded.map((g) => g.label).join(', ')}. Các năng lực này không vào bản công bố.`] : [])],
      handoff,
    },
  };
}

export async function runB7(ctx: BlockCtx): Promise<BlockResult> {
  const s = ctx.snapshot;
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
  const allSegs = [...groups.flatMap((g) => g.segment_ids), ...tasks.flatMap((t) => t.segment_ids), ...(ctx.prev.B6!.indicators as any[]).filter((x) => x.pass).flatMap((x) => x.segment_ids)];
  const missing = [...new Set(allSegs.filter((id) => !segs.has(id)))];
  tb.beat('READ', 'Coverage sau khi loại năng lực chưa qua dịch ngược', { formula: 'coverage_cuối = Σ(w · 1[có năng lực đã qua B6])/Σw', substitution: `${num}/${sumW} = ${pct(finalCov)}`, denominator: { value: sumW, note: 'Σw cố định từ B2' }, set: { 'coverage cuối': pct(finalCov) } });
  tb.beat('READ', 'Kiểm đủ nguồn và nhất quán phiên bản', { formula: 'thiếu = số đoạn được trích không có trong snapshot', substitution: `${new Set(allSegs).size} đoạn được trích, thiếu ${missing.length}`, set: { 'đoạn thiếu': missing.length } });
  const docsOk = s.documents.every((d) => ctx.docs.find((x) => x.ref === d.ref)?.content_sha256 === d.content_sha256);
  const gates = [
    gate('B7', 1, 'Mọi cổng bắt buộc B0–B6', okBlocks === blocks.length ? 'PASS' : 'FAIL', `${okBlocks}/${blocks.length}`, `= ${blocks.length}/${blocks.length}`),
    gate('B7', 2, 'Đủ nguồn', missing.length ? 'FAIL' : 'PASS', missing.length, '0 đoạn thiếu', { refs: missing }),
    finalCov === null ? gate('B7', 3, 'Coverage cuối', 'NOT_EVALUATED', 'Không tính được', `≥ ${pct(s.policy.min_coverage)}`, { reason: 'Σw = 0.' }) : gate('B7', 3, 'Coverage cuối', finalCov >= s.policy.min_coverage ? 'PASS' : 'FAIL', pct(finalCov), `≥ ${pct(s.policy.min_coverage)} (${s.policy.thresholds_status})`),
    gate('B7', 4, 'Nhất quán phiên bản', docsOk ? 'PASS' : 'FAIL', docsOk ? 'khớp' : 'lệch', 'tài liệu và release nền đúng snapshot'),
  ];
  tb.gates(gates);
  const pass = gates.every((g) => g.status === 'PASS');
  const handoff = pass ? `Đủ điều kiện lập hồ sơ: ${groups.length} năng lực, coverage cuối ${pct(finalCov)}.` : 'Có cổng bắt buộc chưa đạt: không lập hồ sơ công bố.';
  tb.beat('HANDOFF', pass ? 'Bàn giao cho B8 lập hồ sơ' : 'Chặn · không bàn giao', { explanation: handoff });
  const output = { chain, final_coverage: finalCov, final_competencies: groups.map((g) => g.competency_id), missing_segments: missing, ai_executed: false };
  return { status: pass ? 'DONE' : 'BLOCKED', output, gates, trace: tb.build(gates, { pass }), ai: [], view: { input: [['Cổng của', 'B0–B6']], output: [['Block đạt', `${okBlocks}/${blocks.length}`], ['Coverage cuối', pct(finalCov)], ['Đoạn thiếu', String(missing.length)]], rows: chain.map((c) => ({ id: c.id, name: `Cổng ${c.id}`, value: c.pass ? 'PASS' : 'CHẶN', detail: (ctx.prevGates[c.id] ?? []).map((g) => `${g.name}: ${g.status}`).join(' · '), bad: !c.pass, data: ctx.prevGates[c.id] })), calc: [{ label: 'Tổng nghiệm thu', formula: 'PASS = AND(mọi cổng bắt buộc)', substitution: chain.map((c) => `${c.id}:${c.pass ? '1' : '0'}`).join(' ∧ '), meaning: 'Một cổng bắt buộc chưa đạt là đủ để chặn công bố.' }], notes: [], handoff, visual: { kind: 'b7', gates: chain, coverageOk: finalCov !== null && finalCov >= s.policy.min_coverage } } };
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
    items.push({ item_id: `C:${g.competency_id}`, entity: 'C', id: g.competency_id, action, name: g.label, before: cur?.data.definition ?? null, after: action === 'REUSE' ? cur!.data.definition : data!.definition, reason, affected: action === 'UPDATE' ? framesUsing(g.competency_id) : [], base_version: cur?.version ?? null, data, depends_on: null, evidence_refs: g.segment_ids });
    counts[action]++;
    tb.record(`C:${g.competency_id}`, g.label, { 'hành động': action, trước: cur?.data.definition ?? '—', sau: data?.definition ?? cur?.data.definition, 'lý do': reason, 'khung bị ảnh hưởng': action === 'UPDATE' ? framesUsing(g.competency_id) : [] });
    tb.beat('READ', `So với nền · ${short(g.label, 44)}`, { refs: [`C:${g.competency_id}`], formula: `${action} = ${action} + 1`, substitution: `${counts[action] - 1} + 1 = ${counts[action]}`, set: { ...counts }, draft: [{ id: g.competency_id, value: `${action} · ${g.label}` }], delta: `+ ${action} ${g.competency_id}`, explanation: reason });
  }
  for (const x of inds) {
    const id = `I-${x.competency_id.replace(/^C-/, '')}-${x.n}`;
    const cur = base.I.find((i) => i.id === id) ?? null;
    const action = !cur ? 'ADD' : cur.data.statement === x.statement ? 'REUSE' : 'UPDATE';
    const data: IData | null = action === 'REUSE' ? null : { indicator_id: id, competency_id: x.competency_id, statement: x.statement, segment_ids: x.segment_ids, screening: `AI_SCREEN ${x.correct}/${x.non_abstain}` };
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
  const rData: RData = {
    framework_id: rId,
    role_id: s.session.role_id,
    role_title: s.session.role_title,
    version_label: '',
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
  for (const g of review) items.push({ item_id: `C:${g.competency_id}:review`, entity: 'C', id: g.competency_id, action: 'NEEDS_REVIEW', name: g.label, before: g.base_definition, after: g.definition, reason: g.decision === 'NEEDS_REVIEW' ? 'T6 không đủ chắc để chọn REUSE/UPDATE/ADD.' : 'Chưa qua độ phủ hoặc dịch ngược.', affected: [], base_version: g.base_version, data: null, depends_on: null, evidence_refs: g.segment_ids });
  tb.beat('READ', 'Dựng bản ghi I, V, W, R đi kèm', { formula: 'hồ sơ = C + I + V + W + R', substitution: ['C', 'I', 'V', 'W', 'R'].map((k) => `${k}: ${items.filter((i) => i.entity === k && i.action !== 'NEEDS_REVIEW').length}`).join(' · '), set: { 'mục hồ sơ': items.filter((i) => i.action !== 'NEEDS_REVIEW').length, 'cần xem lại': review.length } });

  // --- audit: deterministic part ---
  const findings: (Finding & { fingerprint: string })[] = [];
  const add = (severity: string, type: string, item: string, expected: string, observed: string, evidence: string[]) => findings.push({ id: fid(ctx.runId, type, item), severity, type, text: observed, expected, observed, evidence, fingerprint: sha256(`${type}|${norm(item)}`).slice(0, 16) });
  const chainOk = await verifyEventChain(db, ctx.workspaceId);
  if (!chainOk.ok) add('CRITICAL', 'PROCESS_ORDER', 'event-chain', 'Chuỗi hash của nhật ký sự kiện liền mạch.', `Chuỗi gãy tại ${chainOk.brokenAt}.`, [chainOk.brokenAt ?? '']);
  const unresolved = items.filter((i) => i.action !== 'NEEDS_REVIEW' && i.entity !== 'V' && i.entity !== 'R' && i.evidence_refs.some((r) => !segs.has(r)));
  for (const u of unresolved) add('HIGH', 'EVIDENCE_GAP', u.name, 'Mọi đoạn căn cứ tồn tại trong snapshot.', `Mục ${u.item_id} trỏ tới đoạn không có trong snapshot.`, u.evidence_refs.filter((r) => !segs.has(r)));
  const failedAttempts = await db.select({ id: t.blockAttempt.id }).from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, ctx.runId), eq(t.blockAttempt.status, 'FAILED')));
  const checks = [`Chuỗi hash sự kiện: ${chainOk.ok ? 'liền mạch' : 'gãy'} (${chainOk.count} sự kiện)`, `Đoạn căn cứ resolve được: ${unresolved.length ? 'thiếu' : 'đủ'}`, `Thứ tự block B0→B7: đủ ${Object.keys(ctx.prev).filter((k) => k !== 'FAST').length}/8 đầu ra hợp lệ`, `Lần chạy lỗi trong lượt: ${failedAttempts.length}`];
  tb.beat('READ', 'Kiểm toán xác định (code)', { explanation: checks.join(' · '), set: { 'finding': findings.length } });
  // --- audit: content part (T12) ---
  const cItems = items.filter((i) => i.entity === 'C' && i.action !== 'NEEDS_REVIEW');
  const allGates = Object.entries(ctx.prevGates).flatMap(([b, gs]) => (gs ?? []).map((g) => ({ block: b, name: g.name, status: g.status })));
  const au = await ag.run('T12', { role_title: s.session.role_title, purpose: s.session.purpose, items: cItems.map((i) => ({ item_id: i.item_id, action: i.action, label: i.name, definition: i.after ?? '', indicators: inds.filter((x) => x.competency_id === i.id).map((x) => x.statement), segments: i.evidence_refs.filter((r) => segs.has(r)).slice(0, 6).map((r) => ({ id: r, text: segs.get(r)!.seg.text })) })), gates: allGates });
  const support = new Map(au.output.items.map((x) => [x.item_id, x.support_check]));
  for (const f of au.output.findings) add(f.severity, f.type, cItems.find((i) => i.item_id === f.item_id)?.name ?? f.type, f.expected, f.observed, f.item_id ? [f.item_id] : []);
  for (const i of cItems) if (support.get(i.item_id) === 'NOT_SUPPORTED' && i.action !== 'REUSE' && !findings.some((f) => f.evidence.includes(i.item_id))) add('HIGH', 'UNSUPPORTED_CONTENT', i.name, 'Đoạn căn cứ hỗ trợ nội dung sẽ ghi.', `T12 đánh giá ${i.name} là NOT_SUPPORTED.`, [i.item_id]);
  tb.beat('READ', 'Kiểm toán nội dung (AU · T12)', { explanation: `Kết luận: ${au.output.conclusion_code}. Không kiểm được: ${au.output.unchecked_scope}`, formula: 'finding = finding(code) + finding(T12)', substitution: `${findings.length - au.output.findings.length} + ${au.output.findings.length} = ${findings.length}`, set: { finding: findings.length, 'kết luận AU': au.output.conclusion_code }, draft: findings.map((f) => ({ id: f.id, value: `${f.severity} · ${f.type} · ${short(f.observed ?? '', 70)}` })), source: au.source });

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
    limitations: [au.output.unchecked_scope, 'Kiểm toán nội dung do agent AU (T12) thực hiện, không thay kiểm toán của người.', ...(findings.length < 3 ? ['Chưa đủ dữ liệu để đánh giá xu hướng lỗi (cần nhiều lượt hơn).'] : [])],
    checks,
    conclusions: [`Kết luận AU: ${au.output.conclusion_code === 'CLEAR' ? 'không có vấn đề cản trở công bố' : au.output.conclusion_code === 'CLEAR_WITH_NOTES' ? 'có điểm cần cải tiến, không cản trở' : 'không nên công bố khi chưa xử lý'}.`, `Finding: ${findings.length} (lặp lại: ${repeats}).`],
  };
  const changes: ChangeItem[] = items.filter((i) => i.entity === 'C').map((i) => ({ entity: 'C', id: i.id, name: i.name, action: i.action, before: i.before, after: i.after, reason: i.reason, affected: i.affected }));
  const gates = [
    gate('B8', 1, 'Kiểm toán có kết luận', 'PASS', au.output.conclusion_code, 'có ≥ 1 kết luận có căn cứ'),
    gate('B8', 2, 'Không có finding mức STOP', stopping.length ? 'FAIL' : 'PASS', stopping.length, `0 finding mức ${s.policy.stop_on.join('/')}`, { refs: stopping.map((f) => f.id) }),
    gate('B8', 3, 'Tham chiếu hồ sơ resolve được', unresolved.length ? 'FAIL' : 'PASS', unresolved.length, '0 mục thiếu căn cứ'),
  ];
  tb.gates(gates);
  const pass = gates.every((g) => g.status === 'PASS');
  const handoff = pass ? `Hồ sơ DỰ KIẾN: ${counts.ADD} ADD · ${counts.UPDATE} UPDATE · ${counts.REUSE} REUSE${review.length ? ` · ${review.length} cần xem lại (không vào release)` : ''}. Chờ quyết định của người có quyền.` : 'STOP: không ghi được vào từ điển cho tới khi finding được xử lý và workspace được mở lại.';
  tb.beat('HANDOFF', pass ? 'Chờ quyết định công bố' : 'STOP · không công bố', { explanation: handoff });
  const output = { candidate_id: candidateId, counts, needs_review: review.map((g) => g.competency_id), changes, audit, findings: findings.map((f) => f.id), stop: stopping.length > 0, support: Object.fromEntries(support), ai_executed: true };
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
