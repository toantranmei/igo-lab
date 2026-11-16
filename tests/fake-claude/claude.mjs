#!/usr/bin/env node
/**
 * Test double for the Claude CLI. Deterministic, offline. Selected with CLAUDE_BIN.
 * Fixture conventions (only meaningful inside tests):
 *   "NV: <câu nhiệm vụ> [tag]"                      → a task
 *   "NL: <Nhãn> — <định nghĩa> [tag]"               → a competency
 * Fault injection: FAKE_CLAUDE_MODE = ok | exit1 | bad_schema | bad_once | hang | not_logged_in
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
const mode = control || (process.env.FAKE_CLAUDE_MODE ?? 'ok');
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
};
const h = handlers[taskId];
if (!h) {
  console.log(JSON.stringify({ type: 'result', is_error: true, result: 'fake-claude: không biết tác vụ ' + taskId }));
  process.exit(1);
}
out(h(input));
