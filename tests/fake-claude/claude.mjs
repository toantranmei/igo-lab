#!/usr/bin/env node
/**
 * Test double for the Claude CLI. Deterministic, offline. Selected with CLAUDE_BIN.
 * Fixture conventions (only meaningful inside tests):
 *   "NV: <câu nhiệm vụ> [tag]"                      → a task
 *   "NL: <Nhãn> — <định nghĩa> [tag]"               → a competency
 * Fault injection: FAKE_CLAUDE_MODE = ok | exit1 | bad_schema | bad_once | hang | not_logged_in | quota | quota_after
 *   quota_after: the first FAKE_CLAUDE_QUOTA_AFTER calls (counted in FAKE_CLAUDE_LOG) answer normally, later ones hit the limit.
 * FAKE_CLAUDE_DELAY_MS: wait this long before answering (to watch progress while a block runs).
 * Every invocation appends one line to FAKE_CLAUDE_LOG when set.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  const ctl = process.env.FAKE_CLAUDE_CONTROL;
  if (process.env.FAKE_CLAUDE_VERSION === 'missing' || (ctl && existsSync(ctl) && readFileSync(ctl, 'utf8').trim() === 'cli_missing')) process.exit(127);
  console.log(`${process.env.FAKE_CLAUDE_VERSION ?? '2.1.325'} (Claude Code)`);
  process.exit(0);
}
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const required = ['-p', '--model', '--effort', '--system-prompt', '--json-schema', '--output-format', '--tools', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '--no-session-persistence'];
const missing = required.filter((f) => !argv.includes(f));
let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdin += chunk;

const system = arg('--system-prompt') ?? '';
const model = arg('--model');
const taskId = (system.match(/\[task:([^\]]+)\]/) ?? [])[1] ?? 'unknown';
// E2E switches fault modes at run time through a control file, since the worker's env is fixed.
const control = process.env.FAKE_CLAUDE_CONTROL && existsSync(process.env.FAKE_CLAUDE_CONTROL) ? readFileSync(process.env.FAKE_CLAUDE_CONTROL, 'utf8').trim() : '';
// control file may also say "slow:<ms>" (answer normally after a delay) or "quota" (usage limit)
const slow = /^slow:(\d+)$/.exec(control);
const mode = slow ? 'ok' : control || (process.env.FAKE_CLAUDE_MODE ?? 'ok');
if (slow) process.env.FAKE_CLAUDE_DELAY_MS = slow[1];
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ taskId, model, effort: arg('--effort'), hasApiKey: !!process.env.ANTHROPIC_API_KEY, cwd: process.cwd(), tools: arg('--tools'), repair: stdin.includes('KHÔNG hợp lệ') }) + '\n');

const out = (structured, extra = {}) => {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 12, result: '', structured_output: structured, total_cost_usd: 0.001, usage: { input_tokens: stdin.length, output_tokens: 10 }, modelUsage: { [model]: {} }, ...extra }));
  process.exit(0);
};
if (missing.length) {
  console.log(JSON.stringify({ type: 'result', is_error: true, result: 'fake-claude: thiếu cờ ' + missing.join(' ') }));
  process.exit(1);
}
if (mode === 'exit1') {
  console.error('fake-claude: lỗi giả lập');
  process.exit(1);
}
// FAKE_CLAUDE_QUOTA_RESET_MIN: say the limit resets that many minutes from now (UTC), so a test leaves no long-lived breaker
const resetMin = Number(process.env.FAKE_CLAUDE_QUOTA_RESET_MIN ?? 0);
// one extra minute: the message is rounded down to the minute, so the limit lasts at least resetMin minutes
const resetAt = new Date(Date.now() + (resetMin + 1) * 60000);
const QUOTA_TEXT = resetMin ? `You've hit your limit · resets ${resetAt.getUTCHours() % 12 || 12}:${String(resetAt.getUTCMinutes()).padStart(2, '0')}${resetAt.getUTCHours() < 12 ? 'am' : 'pm'} (UTC)` : "You've hit your limit · resets 2:30am (Asia/Saigon)";
const callNo = process.env.FAKE_CLAUDE_LOG && existsSync(process.env.FAKE_CLAUDE_LOG) ? readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 1;
if (mode === 'quota' || (mode === 'quota_after' && callNo > Number(process.env.FAKE_CLAUDE_QUOTA_AFTER ?? 0))) {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: QUOTA_TEXT, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));
  process.exit(1);
}
if (Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 0) > 0) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CLAUDE_DELAY_MS)));
if (mode === 'not_logged_in') {
  console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }));
  process.exit(1);
}
if (mode === 'hang') await new Promise((r) => setTimeout(r, 600000));
if (mode === 'bad_schema') out({ unexpected: true });
if (mode === 'bad_once' && process.env.FAKE_CLAUDE_FLAG && !existsSync(process.env.FAKE_CLAUDE_FLAG)) {
  writeFileSync(process.env.FAKE_CLAUDE_FLAG, '1');
  out({ unexpected: true });
}

const input = JSON.parse((stdin.match(/<task_input>\n([\s\S]*?)\n<\/task_input>/) ?? [])[1] ?? '{}');
// P1 agents put the part shared by every call of a block at the end of the system prompt
const sharedInput = JSON.parse((system.match(/<shared_input>\n([\s\S]*?)\n<\/shared_input>/) ?? [])[1] ?? '{}');
Object.assign(input, sharedInput);
const low = (s) => s.toLowerCase();
const strip = (s) => s.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
const tagsOf = (s) => [...s.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
const norm = (s) => low(strip(s)).replace(/[^\p{L}\p{N} ]/gu, '').trim();
const groupBy = (items, keyOf) => {
  const m = new Map();
  for (const it of items) m.set(keyOf(it), [...(m.get(keyOf(it)) ?? []), it.id]);
  return [...m.values()].map((member_ids) => ({ member_ids, canonical_member_id: member_ids[0] }));
};

const handlers = {
  'T1.jd_scope'(i) {
    const text = low(i.document.segments.map((s) => s.text).join('\n'));
    const first = i.document.segments.slice(0, 1).map((s) => s.id);
    if (text.includes('unsure_test')) return { verdict: 'UNSURE', reason_code: 'MIXED_ROLES', segment_ids: first };
    if (text.includes(low(i.role_title))) return { verdict: 'IN_SCOPE', reason_code: 'ROLE_MATCH', segment_ids: first };
    return { verdict: 'OUT_OF_SCOPE', reason_code: 'DIFFERENT_ROLE', segment_ids: first };
  },
  'T2.task_extract'(i) {
    return { tasks: i.document.segments.filter((s) => /^[-•*\s]*NV:/i.test(s.text)).map((s) => ({ statement: strip(s.text.replace(/^[-•*\s]*NV:\s*/i, '')), segment_ids: [s.id] })) };
  },
  'T3.task_merge'(i) {
    return { groups: groupBy(i.tasks, (t) => norm(t.statement)) };
  },
  'T4.competency_extract'(i) {
    return {
      competencies: i.document.segments
        .filter((s) => /^[-•*\s]*NL:/i.test(s.text))
        .map((s) => {
          const body = s.text.replace(/^[-•*\s]*NL:\s*/i, '');
          const [label, ...rest] = body.split('—');
          return { label: strip(label), definition: (rest.join('—') || label).trim(), segment_ids: [s.id] };
        }),
    };
  },
  'T5.candidate_cluster'(i) {
    return { groups: groupBy(i.candidates, (c) => norm(c.label)) };
  },
  'T6.competency_match'(i) {
    const same = i.shortlist.find((s) => norm(s.label) === norm(i.candidate.label) || s.aliases.some((a) => norm(a) === norm(i.candidate.label)));
    if (!same) return { decision: 'ADD', target_competency_id: '', boundary_code: 'DIFFERENT', confidence: 'HIGH', alternative_id: '' };
    if (low(i.candidate.definition).includes('review_test')) return { decision: 'NEEDS_REVIEW', target_competency_id: same.competency_id, boundary_code: 'OVERLAP_PARTIAL', confidence: 'LOW', alternative_id: '' };
    const equal = norm(same.definition) === norm(i.candidate.definition);
    return { decision: equal ? 'REUSE' : 'UPDATE', target_competency_id: same.competency_id, boundary_code: equal ? 'SAME_MEANING' : 'BROADER', confidence: 'HIGH', alternative_id: '' };
  },
  'T7.claim_support'(i) {
    const text = low([i.event.label, i.event.situation, i.event.action, i.event.outcome].join(' '));
    return { links: i.competencies.map((c) => ({ competency_id: c.id, support: text.includes(low(c.label)) ? 'SUPPORTED' : 'NOT_SUPPORTED' })) };
  },
  'T8.task_link'(i) {
    const tags = new Set(i.task.segments.flatMap((s) => tagsOf(s.text)));
    const seg = i.task.segments.slice(0, 1).map((s) => s.id);
    return { links: i.competencies.filter((c) => tagsOf(c.definition).some((t) => tags.has(t))).map((c) => ({ competency_id: c.id, segment_ids: seg })) };
  },
  'T9.level_vote'(i) {
    const a = i.rubric[Math.min(2, i.rubric.length - 1)];
    return a ? { level: a.level, rubric_anchor_id: a.anchor_id } : { level: 'ABSTAIN', rubric_anchor_id: '' };
  },
  'T10.indicator_write'(i) {
    const vague = low(i.competency.definition).includes('vague_test') && !i.revision_note;
    return { indicators: [{ statement: vague ? 'Thực hiện công việc đúng yêu cầu được giao.' : `Trình bày kết quả ${i.competency.label} kèm tiêu chí kiểm được cho ${i.role_title}.`, segment_ids: i.segments.slice(0, 1).map((s) => s.id) }] };
  },
  'T11.retranslation'(i) {
    return { votes: i.indicators.map((x) => ({ indicator_id: x.id, competency_id: (i.labels.find((l) => low(x.statement).includes(low(l.label))) ?? { id: 'ABSTAIN' }).id })) };
  },
  'T12.audit_review'(i) {
    const critical = i.items.find((x) => low(x.definition).includes('critical_test'));
    return {
      items: i.items.map((x) => ({ item_id: x.item_id, support_check: x === critical ? 'NOT_SUPPORTED' : 'SUPPORTED' })),
      findings: critical ? [{ severity: 'CRITICAL', type: 'UNSUPPORTED_CONTENT', item_id: critical.item_id, expected: 'Định nghĩa có đoạn JD hỗ trợ.', observed: 'Không đoạn nào nêu nội dung này.' }] : [],
      conclusion_code: critical ? 'NOT_CLEAR' : 'CLEAR',
      unchecked_scope: 'Không kiểm được tính đúng của JD so với thực tế công việc.',
    };
  },
  'T13.hypothesis_propose'(i) {
    return { situation: `Giả sử nhóm cần ${low(i.competency.label)} trong một quý.`, action: `Trình bày phương án ${low(i.competency.label)} kèm căn cứ.`, expected_outcome: 'Một tài liệu ghi quyết định và tiêu chí kiểm.', segment_ids: i.competency.segments.slice(0, 1).map((s) => s.id) };
  },
  'T14.title_keywords'(i) {
    return { keywords: [low(i.role_title)] };
  },
  'T15.title_match'(i) {
    return { match_ids: i.titles.filter((x) => low(x.title).includes(low(i.role_title))).map((x) => x.id) };
  },
};
// numbered lines "s12 text" (P1 inputs)
const linesOf = (text) => text.split('\n').map((l) => /^(s\d+) (.*)$/.exec(l)).filter(Boolean).map((m) => ({ id: m[1], text: m[2] }));
const t6like = (label, definition, near) => {
  const same = near.find((s) => norm(s.label) === norm(label));
  if (!same) return { decision: 'ADD', target_id: '', boundary_code: 'DIFFERENT', confidence: 'HIGH' };
  if (low(definition).includes('review_test')) return { decision: 'NEEDS_REVIEW', target_id: same.id, boundary_code: 'OVERLAP_PARTIAL', confidence: 'LOW' };
  const equal = norm(same.definition) === norm(definition);
  return { decision: equal ? 'REUSE' : 'UPDATE', target_id: same.id, boundary_code: equal ? 'SAME_MEANING' : 'BROADER', confidence: 'HIGH' };
};
Object.assign(handlers, {
  'E1.jd_read'(i) {
    return {
      jds: i.jds.map((d) => {
        const segs = linesOf(d.text);
        const text = low(segs.map((s) => s.text).join('\n'));
        const first = segs.slice(0, 1).map((s) => s.id);
        const verdict = text.includes('unsure_test') ? 'UNSURE' : text.includes(low(i.role_title)) ? 'IN_SCOPE' : 'OUT_OF_SCOPE';
        const reason_code = verdict === 'UNSURE' ? 'MIXED_ROLES' : verdict === 'IN_SCOPE' ? 'ROLE_MATCH' : 'DIFFERENT_ROLE';
        const tasks = verdict !== 'IN_SCOPE' ? [] : segs.filter((s) => /^[-•*\s]*NV:/i.test(s.text)).map((s) => ({ statement: strip(s.text.replace(/^[-•*\s]*NV:\s*/i, '')), segment_ids: [s.id] }));
        const competencies = verdict !== 'IN_SCOPE' ? [] : segs.filter((s) => /^[-•*\s]*NL:/i.test(s.text)).map((s) => {
          const body = s.text.replace(/^[-•*\s]*NL:\s*/i, '');
          const [label, ...rest] = body.split('—');
          return { label: strip(label), definition: (rest.join('—') || label).trim(), segment_ids: [s.id] };
        });
        return { id: d.id, verdict, reason_code, scope_segment_ids: first, criteria: { A: '3', B: '3', C: '3' }, tasks, competencies };
      }),
    };
  },
  'E23.task_review'(i) {
    const byText = new Map();
    for (const c of i.clusters) {
      const k = norm(c.tasks[0].statement);
      byText.set(k, [...(byText.get(k) ?? []), c]);
    }
    const merges = [...byText.values()].filter((cs) => cs.length > 1).map((cs) => ({ cluster_ids: cs.map((c) => c.id), canonical_id: cs[0].tasks[0].id }));
    // the fake picks "2421 Nhà phân tích tổ chức và quản lý" when the catalog has it (a real reader would judge the role)
    const line = (i.catalog ?? '').split('\n').find((l) => l.startsWith('2421 ')) ?? '';
    return { occupation: { vn_code: line ? '2421' : '', title: line.slice(5), reason: 'CLI giả.' }, merges, splits: [] };
  },
  'E4.candidate_review'(i) {
    const byLabel = new Map();
    for (const c of i.clusters) byLabel.set(norm(c.label), [...(byLabel.get(norm(c.label)) ?? []), c]);
    const merges = [...byLabel.values()].filter((cs) => cs.length > 1).map((cs) => ({ cluster_ids: cs.map((c) => c.id), canonical_id: cs[0].id }));
    const matches = i.clusters.filter((c) => c.near.length).map((c) => ({ cluster_id: c.id, ...t6like(c.label, c.definition, c.near) }));
    // external (O*NET) tasks: the first two support the first cluster, so the ω = 3 path is exercised
    const support = (i.external_tasks ?? []).length && i.clusters.length ? [{ cluster_id: i.clusters[0].id, task_ids: i.external_tasks.slice(0, 2).map((x) => x.id) }] : [];
    return { support, merges, matches };
  },
  'E4S.dictionary_near'(i) {
    // same name as a dictionary entry → suggested (the lexical shortlist already finds these; keeps the fake simple)
    const near = i.clusters.map((c) => ({ cluster_id: c.id, dictionary_ids: i.dictionary.filter((d) => norm(d.label) === norm(c.label)).map((d) => d.id).slice(0, 2) })).filter((x) => x.dictionary_ids.length);
    return { near };
  },
  'E4M.granularity_merge'(i) {
    // same rule as the fake E4: clusters with the same name are one competency
    const byLabel = new Map();
    for (const c of i.clusters) byLabel.set(norm(c.label), [...(byLabel.get(norm(c.label)) ?? []), c]);
    return { merges: [...byLabel.values()].filter((cs) => cs.length > 1).map((cs) => ({ cluster_ids: cs.map((c) => c.id), canonical_id: cs[0].id })) };
  },
  'E6L.outcome_link'(i) {
    // every competency serves the first outcome
    return { links: i.competencies.map((c) => ({ competency_id: c.id, outcome_ids: i.outcomes.length ? [i.outcomes[0].id] : [] })) };
  },
  'E5.task_matrix'(i) {
    return {
      rows: i.tasks.map((t) => {
        const tags = new Set(t.segments.flatMap((s) => tagsOf(s.text)));
        const ids = i.competencies.filter((c) => tagsOf(c.definition).some((x) => tags.has(x))).map((c) => c.id);
        return { task_id: t.id, competency_ids: ids, segment_ids: ids.length ? t.segments.slice(0, 1).map((s) => s.id) : [] };
      }),
    };
  },
  'E6.indicator_write'(i) {
    // the level is written into the sentence so the seats can recover it, as a real reader would from its difficulty
    return {
      items: i.competencies.map((c) => {
        const vague = low(c.definition).includes('vague_test') && !c.revision_note;
        // vague_half: only the second indicator of each level is vague (a level keeps one that passes)
        const half = low(c.definition).includes('vague_half') && !c.revision_note;
        return { competency_id: c.id, outcome_ids: (i.outcomes ?? []).map((o) => o.id), levels: ['1', '3', '5'].map((L) => ({ level: L, indicators: [1, 2].map((k) => ({ statement: vague || (half && k === 2) ? `Thực hiện công việc đúng yêu cầu được giao (${L}.${k}).` : `Bậc ${L}: trình bày kết quả ${c.label} lần ${k} kèm tiêu chí kiểm được cho ${i.role_title}.`, segment_ids: c.segments.slice(0, 1).map((s) => s.id) })) })) };
      }),
    };
  },
  'E7.retranslation'(i) {
    return {
      votes: i.indicators.map((x) => ({ indicator_id: x.id, competency_id: (i.labels.find((l) => low(x.statement).includes(low(l.label)) || norm(x.statement) === norm(l.definition)) ?? { id: '' }).id, level: (/Bậc (\d)/.exec(x.statement) ?? [])[1] ?? '' })),
      classes: i.labels.map((l) => ({ competency_id: l.id, class: 'II' })),
    };
  },
  'E8.audit_review'(i) {
    const vars = ['collection_method', 'content_type', 'content_build', 'granularity', 'goal_link', 'independent_review', 'prioritisation', 'reliability', 'keep_drop_criteria', 'documentation'];
    return { ...handlers['T12.audit_review'](i), sample: i.sample.map((q) => ({ id: q.id, code_ok: 'YES' })), variables: (i.gates ?? []).length ? vars.map((v) => ({ variable: v, result: 'PASS', plan: '' })) : [] };
  },
  'E9.recode'(i) {
    return { codes: i.sentences.map((s) => ({ sentence_id: s.id, code_ids: [(i.codes.find((c) => tagsOf(c.definition).some((t) => tagsOf(s.text).includes(t))) ?? { id: 'NONE' }).id] })) };
  },
  'E10.seat_score'(i) {
    return { scores: i.candidates.map((c) => ({ candidate_id: c.id, importance: '4', discrimination: '4', level: '3' })) };
  },
});
const h = handlers[taskId];
if (!h) {
  console.log(JSON.stringify({ type: 'result', is_error: true, result: 'fake-claude: không biết tác vụ ' + taskId }));
  process.exit(1);
}
out(h(input));
