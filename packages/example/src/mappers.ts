/**
 * Pure mappers from the Example engine shapes to the shared contract view shapes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AuditView,
  BlockId,
  ChangeItem,
  DictFrame,
  DictView,
  InputDoc,
  InputEvent,
  InputTask,
  Lesson,
  LogEntry,
  ReleaseHistoryEntry,
  SessionState,
} from '@cl/contract';
import { Lab, defs } from './engine';
import type { ExampleDictionary, LogRecord } from './engine';
import { cardsFor, fastSummary, toChangeItem } from './explain';

const conceptName = (concept: string): string => defs.find((d) => d[2] === concept)?.[1] ?? concept;

export const FAULT_OPTIONS: [string, string][] = [
  ['none', 'Không gây lỗi'],
  ['missing_source', 'B1 · mất nguồn JD'],
  ['forbidden_write', 'B6 · ghi lõi trái quyền'],
];

function mapChanges(changes: any[], d: { C: any[] }): ChangeItem[] {
  return (changes || []).map((c) => toChangeItem(c, (id) => d.C.find((x) => x.id === id)?.name));
}

export function toDictView(d: ExampleDictionary): DictView {
  return {
    version: d.version,
    W: d.W.map((w) => ({
      id: w.id,
      role: w.role,
      tasks: (w.tasks || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        concept: t.concept,
        weight: t.weight ?? null,
        competencies: d.C.filter((c) => c.concept === t.concept).map((c) => c.id),
      })),
    })),
    C: d.C.map((c) => ({
      id: c.id,
      name: c.name,
      concept: c.concept,
      ...(c.definition ? { definition: c.definition } : {}),
      version: c.version,
      indicators: [...(c.indicators || [])],
    })),
    R: d.R.map((r) => ({
      id: r.id,
      version: r.version,
      role: r.role,
      purpose: r.purpose,
      evidence: r.evidence,
      competencies: (r.competencies || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        level: c.level ?? null,
        indicator: c.indicator ?? null,
        evidence: [...(c.evidence || [])],
      })),
    })),
    V: d.V.map((v) => ({ ...v })),
    G: d.G.map((g) => ({ version: g.version, run: g.run, changes: mapChanges(g.changes, d), policy: g.policy })),
  };
}

export function toHistory(lab: Lab): ReleaseHistoryEntry[] {
  return lab.history.map((h) => ({
    run: h.run,
    fromVersion: h.before.version,
    toVersion: h.after.version,
    changes: mapChanges(h.output.changes, h.after),
    after: toDictView(h.after),
  }));
}

function logSummary(l: LogRecord): string {
  const p = l.payload || {};
  switch (l.type) {
    case 'INPUT':
      return 'Khóa snapshot và phiên bản';
    case 'PASS':
      return 'Đã tính đầu ra và kiểm cổng';
    case 'BLOCK':
      return 'Cổng không đạt: ' + (p.rules || []).filter((r: any) => !r.pass).map((r: any) => r.name).join(', ');
    case 'HALT':
      return 'Khóa cả hai nhánh';
    case 'DELIVER':
      return 'Bản thử đã tạo';
    case 'HUMAN_SAFE':
      return 'Xác nhận An toàn (giả lập) cho lesson: ' + ((p.lessons || []).join(', ') || 'không có');
    case 'RESUME':
      return 'Mở lại sau sự cố (giả lập)' + (p.reason ? ' · lý do: ' + p.reason : '');
    default:
      return JSON.stringify(l.payload ?? null).slice(0, 120);
  }
}

function toLogs(lab: Lab): LogEntry[] {
  return lab.logs.map((l) => ({ seq: l.seq, run: l.run, step: l.step, type: l.type, time: l.time, summary: logSummary(l), payload: l.payload }));
}

function toInputs(lab: Lab): SessionState['inputs'] {
  // After B1 ran, show its version of the JDs so an injected missing source is visible.
  const jdList: any[] = lab.outputs.B1?.jds || lab.data.jds;
  const jds: InputDoc[] = jdList.map((j) => ({
    id: j.id,
    title: j.id,
    origin: j.origin,
    industry: j.industry,
    role: j.role,
    source: j.source,
    sourceOk: !!j.source,
    synthetic: true,
    text: j.text,
    usedPassages: (j.skillStatements || []).map((s: any) => ({ label: conceptName(s.concept), text: s.text })),
    meta: [
      ['Nguồn gốc seed', j.origin],
      ['Bối cảnh ngành', j.industry],
      ['Vai trò', j.role],
      ['Địa chỉ nguồn', j.source || '∅ · thiếu nguồn'],
      ['Nhãn concept trong seed', (j.skills || []).join(', ')],
    ],
    evidenceClass: 'seed · tổng hợp',
  }));
  const tasks: InputTask[] = lab.data.tasks.map((t) => ({ id: t.id, name: t.name, weight: t.weight, refs: [] }));
  const events: InputEvent[] = lab.data.events.map((e) => ({
    id: e.id,
    label: conceptName(e.concept),
    type: e.type,
    evidenceClass: 'SEED',
    source: e.source,
    situation: e.situation,
    action: e.action,
    outcome: e.outcome,
    ratings: [...e.ratings],
    ratingBasis: e.ratingBasis,
  }));
  return { label: lab.data.label, jds, tasks, events };
}

function toAudit(a: any): AuditView | null {
  if (!a) return null;
  return {
    scope: a.scope,
    findings: (a.findings || []).map((f: any) => ({
      id: f.id,
      severity: f.severity,
      type: f.type,
      text: f.text,
      evidence: [...(f.evidence || [])],
      ...(f.lesson ? { lesson: f.lesson } : {}),
    })),
    limitations: [...(a.limitations || [])],
    checks: [...(a.checks || [])],
  };
}

function toLessons(lab: Lab): Lesson[] {
  return lab.dictionary.lessons.map((l) => ({
    id: l.id,
    text: l.text,
    status: l.safe ? 'SAFE' : 'PENDING',
    owner: l.owner,
    ...(l.control ? { control: l.control } : {}),
    ...(l.test ? { test: l.test } : {}),
    ...(l.testResult ? { testResult: { ...l.testResult } } : {}),
  }));
}

export function toTrialFrame(lab: Lab): DictFrame | null {
  const f = lab.fast;
  if (!f) return null;
  return {
    id: 'R-PO-trial',
    version: f.version,
    role: 'Product Owner',
    purpose: 'Bản thử phát triển',
    evidence: 'synthetic_only',
    trial: true,
    competencies: f.competencies.map((c: any) => ({ id: c.id, name: c.name, level: null, indicator: null, evidence: [] })),
  };
}

function nextRunHint(lab: Lab, unsafe: string[]): string {
  if (lab.round !== 1) return 'Đang ở lượt 02. Ví dụ mẫu chỉ có hai lượt.';
  if (!lab.completed) return 'Cần hoàn tất B0–B8 của lượt 01 trước khi mở lượt 02.';
  if (unsafe.length) return `Cần xác nhận An toàn cho ${unsafe.join(', ')} (quyết định ngoài B0–B8) trước khi mở lượt 02.`;
  return 'Lượt 2: giữ lõi v1.0, nạp LL-001; thêm 3 JD và nhiệm vụ quản trị AI.';
}

export function toSessionState(lab: Lab): SessionState {
  const p = lab.guide?.pending || null;
  const blocking = lab.halted ? lab.outputs['B' + lab.position] : null;
  const unsafe: string[] = lab.dictionary.lessons.filter((l) => !l.safe).map((l) => l.id);
  return {
    mode: 'example',
    sessionId: 'example',
    sessionName: 'Default Example',
    roleTitle: 'Product Owner',
    runNo: lab.round,
    runLabel: 'Lượt 0' + lab.round,
    inputSummary: `${lab.data.jds.length} JD · ${lab.data.tasks.length} nhiệm vụ · ${lab.data.events.length} sự kiện`,
    dictionaryVersionLabel: 'Lõi v' + lab.dictionary.version,
    position: Math.min(lab.position, 9),
    completed: lab.completed,
    halted: lab.halted,
    haltReasons: blocking ? (blocking._rules || []).filter((r: any) => !r.pass).map((r: any) => r.name) : [],
    statusText: p ? 'Đang xem · ' + p.id : lab.halted ? 'Đang dừng' : lab.completed ? 'Hoàn tất lượt ' + lab.round : 'Sẵn sàng',
    cards: cardsFor(lab),
    fast: { available: !!lab.outputs.B3 && !lab.halted && !lab.fast, done: !!lab.fast, summary: fastSummary(lab) },
    pending: p ? { id: p.id as BlockId, cursor: p.cursor || 0, committed: !!p.committed } : null,
    logs: toLogs(lab),
    inputs: toInputs(lab),
    dictionary: toDictView(lab.dictionary),
    startDictionaryVersion: lab.startDictionary.version,
    history: toHistory(lab),
    audit: toAudit(lab.audit),
    lessons: toLessons(lab),
    fault: { value: lab.fault, options: FAULT_OPTIONS.map((o) => [o[0], o[1]]), locked: lab.position > 0 || !!p },
    canStartNextRun: lab.completed && lab.round === 1 && unsafe.length === 0,
    nextRunHint: nextRunHint(lab, unsafe),
    trial: toTrialFrame(lab),
  };
}

let sample: SessionState | null = null;
/** State of the Example after both runs (core 1.1), for screens that show the finished result. */
export function sampleTwoRunState(): SessionState {
  if (sample) return sample;
  const lab = new Lab();
  while (lab.step());
  lab.approve();
  lab.nextRound();
  while (lab.step());
  sample = toSessionState(lab);
  return sample;
}
