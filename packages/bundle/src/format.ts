import { t } from '@cl/db';

export const BUNDLE_FORMAT = 'competence-lab-bundle';
export const SCHEMA_VERSION = '1.0.0';
export type ExportKind = 'dictionary' | 'backup';

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  records?: number;
}
export interface Manifest {
  format: typeof BUNDLE_FORMAT;
  schema_version: string;
  export_kind: ExportKind;
  exported_at: string;
  workspace_id: string;
  release_id: string | null;
  release_version: string;
  scope: { sessions: string[] | 'all' | 'none'; includes_blobs: boolean; completeness: string };
  counts: Record<string, number>;
  files: ManifestFile[];
  redaction: { metadata_only: boolean; redacted_refs: string[] };
}

const KIND_FILE: Record<string, string> = { W: 'data/W.jsonl', C: 'data/C.jsonl', I: 'data/indicators.jsonl', R: 'data/R.jsonl', V: 'data/V.jsonl', G: 'data/G.jsonl' };
export const kindFile = (k: string) => KIND_FILE[k];
export const DICT_FILES = Object.values(KIND_FILE);
export const RELEASES_FILE = 'data/releases.jsonl';

/** Run-side tables of a backup, in insert order. `key` identifies a row for duplicate/conflict detection. */
export const RUN_TABLES = [
  { file: 'runs/sessions.jsonl', table: t.session, key: (r: any) => r.id, session: (r: any) => r.id },
  { file: 'runs/documents.jsonl', table: t.documentVersion, key: (r: any) => `${r.documentId}@${r.version}` },
  { file: 'runs/jd_revisions.jsonl', table: t.jdSetRevision, key: (r: any) => `${r.jdSetId}#${r.revision}`, session: (r: any) => r.sessionId },
  { file: 'runs/user_events.jsonl', table: t.userEvent, key: (r: any) => r.id, session: (r: any) => r.sessionId },
  { file: 'runs/runs.jsonl', table: t.run, key: (r: any) => r.id, session: (r: any) => r.sessionId },
  { file: 'runs/attempts.jsonl', table: t.blockAttempt, key: (r: any) => r.id },
  { file: 'runs/view_cursors.jsonl', table: t.viewCursor, key: (r: any) => `${r.runId}|${r.block}` },
  { file: 'runs/candidates.jsonl', table: t.candidate, key: (r: any) => r.id },
  { file: 'runs/findings.jsonl', table: t.finding, key: (r: any) => r.id },
  { file: 'runs/lessons.jsonl', table: t.lesson, key: (r: any) => r.id },
  { file: 'runs/agent_calls.jsonl', table: t.agentCall, key: (r: any) => r.id },
  { file: 'runs/agent_results.jsonl', table: t.agentResult, key: (r: any) => r.taskKey },
] as const;
export const EVENTS_FILE = 'runs/events.jsonl';

export const BUNDLE_README = `# Competence Lab bundle

Gói này đọc được độc lập, không cần phần mềm Competence Lab.

- \`manifest.json\`: loại gói (\`export_kind\`), phiên bản schema, thời điểm xuất (UTC), số đếm và danh sách file kèm \`bytes\` + \`sha256\`. Kiểm sha256 của từng file trước khi dùng.
- \`data/*.jsonl\`: mỗi dòng là một bản ghi JSON UTF-8 của từ điển: W (nhiệm vụ theo role), C (năng lực), indicators (chỉ báo), R (khung năng lực), V (bằng chứng), G (quyết định quản trị), và \`releases.jsonl\` (lịch sử công bố).
- \`runs/*.jsonl\` (chỉ có trong backup): phiên, tài liệu JD, revision bộ JD, lượt, lần chạy block, nhật ký sự kiện, lời gọi agent và bộ nhớ kết quả agent.
- \`blobs/<sha256>\` (khi được chọn): file gốc người dùng tải lên, tên file là sha256 của nội dung.

## Quy ước

- **Khóa đối chiếu là \`id@version\`.** Bản ghi có phiên bản là bất biến; sửa nghĩa là thêm \`version+1\`. Thứ tự dòng chỉ để tiện so sánh.
- **Khung (R) khóa tham chiếu**: mỗi requirement ghi \`competency_id\` + \`competency_version\` và \`indicators[].{indicator_id, version}\`. Bậc yêu cầu (\`required_level\`) nằm ở R, không nằm ở C; \`null\` nghĩa là chưa xác định.
- **Release**: \`members\` liệt kê mọi \`{kind,id,version}\` tạo nên từ điển tại release đó; \`parent_release_id\` cho lineage; \`reverts\` đánh dấu release khôi phục.
- **Đoạn trích**: \`segment_id = document_id@version#n\`. \`start\`/\`end\` là chỉ số **code point Unicode**, nửa mở \`[start, end)\`, trên văn bản đã chuẩn hóa \`norm-v1\` (NFC, \`\\r\\n\`→\`\\n\`, bỏ khoảng trắng cuối dòng, gộp hơn hai dòng trống) của đúng phiên bản tài liệu; tách đoạn theo \`seg-v1\`.
- **Lớp bằng chứng** (\`evidence_class\`): \`JD\` (đoạn JD), \`REAL\` (sự kiện thật người dùng nhập), \`HYPOTHESIS\` (giả thuyết, không bao giờ là bằng chứng).
- **Lược nội dung**: khi \`redaction.metadata_only = true\`, nội dung JD và câu trích bị bỏ; bản ghi bị lược có \`redacted: true\` và được liệt kê ở \`redaction.redacted_refs\`. \`content_sha256\` vẫn là hash của nội dung gốc.
- Gói không chứa mật khẩu, token, biến môi trường hay đường dẫn tuyệt đối của máy chủ.
`;

export const BUNDLE_SCHEMAS: Record<string, unknown> = {
  'schemas/manifest.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['format', 'schema_version', 'export_kind', 'exported_at', 'workspace_id', 'release_id', 'scope', 'counts', 'files', 'redaction'],
    properties: { format: { const: BUNDLE_FORMAT }, schema_version: { type: 'string' }, export_kind: { enum: ['dictionary', 'backup'] }, exported_at: { type: 'string' }, workspace_id: { type: 'string' }, release_id: { type: ['string', 'null'] }, files: { type: 'array', items: { type: 'object', required: ['path', 'bytes', 'sha256'], properties: { path: { type: 'string' }, bytes: { type: 'integer' }, sha256: { type: 'string' } } } } },
  },
  'schemas/record.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['kind', 'id', 'version', 'data', 'content_sha256', 'release_id', 'created_at'],
    properties: { kind: { enum: ['W', 'C', 'I', 'R', 'V', 'G'] }, id: { type: 'string' }, version: { type: 'integer', minimum: 1 }, data: { type: 'object' }, content_sha256: { type: 'string' }, release_id: { type: 'string' }, created_at: { type: 'string' }, redacted: { type: 'boolean' } },
  },
  'schemas/release.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['release_id', 'seq', 'parent_release_id', 'version_label', 'members', 'receipt_hash', 'decided_by', 'decided_at'],
    properties: { release_id: { type: 'string' }, seq: { type: 'integer' }, parent_release_id: { type: ['string', 'null'] }, members: { type: 'array', items: { type: 'object', required: ['kind', 'id', 'version'] } } },
  },
};
