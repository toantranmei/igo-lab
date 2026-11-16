# Định dạng gói export / import

Nguồn: `packages/bundle/src/{format,export,import}.ts`, các route `exports`/`imports` trong `apps/web/lib/server/router.ts`, đặc tả §13. Khi tài liệu này và code khác nhau, code là chuẩn.

## 1. Ba mức export

| Mức | Dạng | Chứa gì | Khôi phục được gì |
| --- | --- | --- | --- |
| **Framework** | một file JSON (`format: "competence-lab-framework"`) | Một phiên bản khung (bản ghi R) cùng đúng các phiên bản C và I mà nó khóa, các nhiệm vụ liên quan, danh sách ID bằng chứng | Không import được. Dùng để đọc hoặc chuyển cho hệ thống khác |
| **Dictionary** | ZIP (`export_kind: "dictionary"`) | Toàn bộ bản ghi từ điển W/C/I/R/V/G và lịch sử release | Từ điển và lineage release vào workspace rỗng. Không có phiên, JD gốc, lượt chạy |
| **Backup** | ZIP (`export_kind: "backup"`) | Như dictionary, thêm phiên, tài liệu JD, revision bộ JD, sự kiện người dùng nhập, lượt, lần chạy block, hồ sơ ứng viên, finding, lesson, lời gọi agent, bộ nhớ kết quả agent, nhật ký sự kiện; tùy chọn kèm blob gốc | Toàn bộ workspace vào workspace rỗng, giữ nguyên ID và version; chuỗi hash của nhật ký kiểm lại được như bản gốc |

### File framework JSON

Các trường: `format`, `schema_version`, `exported_at`, `framework` (`id`, `record_version`, `release_id`, `content_sha256` và toàn bộ dữ liệu của bản ghi R), `competencies[]`, `indicators[]` (mỗi mục có `id`, `version` và dữ liệu bản ghi), `tasks[]` (các nhiệm vụ của W được requirement tham chiếu), `evidence_refs[]` (ID bằng chứng, đã sắp xếp, không kèm nội dung), `notes[]`.

Bậc yêu cầu nằm ở `framework.requirements[].required_level`; `null` nghĩa là chưa xác định. Mỗi requirement khóa `competency_id@competency_version` và `indicator_id@version`.

## 2. Bố cục ZIP

| Đường dẫn | Có trong | Nội dung |
| --- | --- | --- |
| `manifest.json` | cả hai | Xem mục 3 |
| `README.md` | cả hai | Hướng dẫn đọc gói độc lập và các quy ước |
| `schemas/manifest.schema.json`, `schemas/record.schema.json`, `schemas/release.schema.json` | cả hai | JSON Schema (draft 2020-12) |
| `data/W.jsonl`, `data/C.jsonl`, `data/indicators.jsonl`, `data/R.jsonl`, `data/V.jsonl`, `data/G.jsonl` | cả hai | Bản ghi từ điển, mỗi dòng một JSON |
| `data/releases.jsonl` | cả hai | Lịch sử release theo `seq` |
| `runs/sessions.jsonl`, `runs/documents.jsonl`, `runs/jd_revisions.jsonl`, `runs/user_events.jsonl`, `runs/runs.jsonl`, `runs/attempts.jsonl`, `runs/view_cursors.jsonl`, `runs/candidates.jsonl`, `runs/findings.jsonl`, `runs/lessons.jsonl`, `runs/agent_calls.jsonl`, `runs/agent_results.jsonl` | backup | Dữ liệu phía lượt chạy, theo thứ tự chèn |
| `runs/events.jsonl` | backup | Nhật ký sự kiện append-only theo `seq` |
| `blobs/<sha256>` | backup, khi chọn `include_blobs` | File gốc người dùng tải lên; tên file là sha256 của nội dung |

**Bản ghi từ điển** (một dòng trong `data/*.jsonl`): `kind` (`W|C|I|R|V|G`), `id`, `version` (số nguyên ≥ 1), `data`, `content_sha256`, `release_id`, `created_at`, và `redacted: true` nếu bị lược.

**Dòng release**: `release_id`, `seq`, `parent_release_id`, `version_label`, `run_id`, `candidate_id`, `decided_by`, `decided_at`, `diff`, `members` (danh sách `{kind, id, version}` tạo nên từ điển tại release đó), `receipt_hash`, `reverts`, `origin`.

Gói được dựng trong **một giao dịch chỉ đọc `REPEATABLE READ`** nên mọi file thấy cùng một snapshot. Các mục trong ZIP được sắp theo tên và dùng mtime cố định. Tên file tải về: `competence-lab-<kind>-<release_version>-<YYYY-MM-DD>.zip`.

## 3. Manifest

| Trường | Ý nghĩa |
| --- | --- |
| `format` | luôn là `"competence-lab-bundle"` |
| `schema_version` | hiện `"1.0.0"` |
| `export_kind` | `"dictionary"` hoặc `"backup"` |
| `exported_at` | thời điểm xuất, ISO 8601 UTC |
| `workspace_id` | workspace nguồn |
| `release_id`, `release_version` | release mới nhất tại lúc xuất (`null` và `"0.0"` nếu chưa có) |
| `scope.sessions` | `"none"` (dictionary), `"all"` (backup đầy đủ) hoặc mảng ID phiên |
| `scope.includes_blobs` | `true` khi thực sự có ít nhất một blob trong gói |
| `scope.completeness` | Câu mô tả mức đầy đủ của gói |
| `counts` | Số bản ghi theo đường dẫn file `.jsonl`, cùng `blobs` |
| `files[]` | Mọi file trừ `manifest.json`: `path`, `bytes`, `sha256`, và `records` với file `.jsonl` |
| `redaction` | `metadata_only` và `redacted_refs[]` (đã sắp xếp) |

**Checksum** có ba lớp: `files[].sha256` + `bytes` cho từng file; `content_sha256` cho từng bản ghi từ điển (hash JSON chính tắc của `data`); tên file blob bằng sha256 nội dung của nó.

## 4. Tùy chọn lược nội dung và phạm vi

| Tùy chọn | Áp dụng | Tác dụng |
| --- | --- | --- |
| `metadata_only` | cả hai | Bản ghi V: `data.quote` thành chuỗi rỗng, thêm `redacted: true`, ghi `V:<id>@<version>` vào `redacted_refs`. Backup còn: tài liệu mất `normalizedText` và text của từng đoạn (`document:<id>@<version>`); lần chạy block mất `output` và `trace` (`attempt:<id>`); `runs/agent_results.jsonl` rỗng. `content_sha256` vẫn là hash của nội dung gốc |
| `include_blobs` | backup | Thêm `blobs/<sha256>` cho các tài liệu có blob gốc còn trong kho |
| `session_ids` | backup | Chỉ lấy dữ liệu lượt chạy của các phiên đã chọn (phiên, revision bộ JD, tài liệu được các revision đó tham chiếu, sự kiện người dùng, lượt, lần chạy, lời gọi agent...). Từ điển vẫn đầy đủ. **`runs/events.jsonl` rỗng** vì một phần chuỗi hash không kiểm được, nên gói theo phạm vi không khôi phục được chuỗi kiểm toán đầy đủ |

## 5. Quy tắc phiên bản schema

Import chấp nhận gói khi **major bằng nhau và minor của gói ≤ minor của bản đang chạy** (so với `SCHEMA_VERSION`). Ngược lại trả `UNSUPPORTED_SCHEMA_VERSION`, nêu version của gói và version cao nhất được hỗ trợ.

## 6. Import hai pha

### Pha 1 — Preview (không ghi vào dữ liệu nghiệp vụ)

`POST /api/imports/preview`, multipart với `file` (ZIP) và `mode`. Server:

1. Giải nén trong bộ nhớ, chặn gói quá 5000 file hoặc quá 300 MB sau giải nén.
2. Chặn đường dẫn không an toàn: tuyệt đối, có `\`, có ký tự ổ đĩa, có thành phần `..`, `.` hoặc rỗng, có ký tự NUL.
3. Đọc manifest, kiểm `format` và `schema_version`.
4. Kiểm mọi file trong ZIP đều có trong manifest và ngược lại; kiểm `bytes` + `sha256` từng file; kiểm tên blob.
5. Kiểm trong gói: schema bản ghi, trùng `kind|id|version`, `content_sha256` (bỏ qua bản ghi `redacted`), tham chiếu của khung và release, lineage release.
6. So với workspace hiện tại: đếm bản ghi sẽ chèn, bản ghi trùng, xung đột.
7. Lưu ZIP vào kho blob và ghi một dòng `import_preview`; trả `{ id, report }`.

`report` gồm: `ok`, `mode`, `export_kind`, `schema_version`, `exported_at`, `source_workspace_id`, `counts`, `duplicates`, `to_insert`, `conflicts[]` (tối đa 50), `errors[]`, `redaction`, `lineage[]` (mỗi release kèm `restorable`), `completeness`, `preview_digest` (sha256 của file ZIP).

### Pha 2 — Commit

`POST /api/imports/:id/commit` với body `{ "preview_digest": "<digest>" }`. Server đọc lại ZIP đã lưu, kiểm digest, **phân tích lại trên trạng thái hiện tại của workspace**, rồi mới ghi. Kết quả: `{ mode, inserted, duplicates, changes, latest_release }`.

### Hai chế độ

| Chế độ | Điều kiện | Hành vi |
| --- | --- | --- |
| `RESTORE_EMPTY` (mặc định) | Workspace chưa có bản ghi từ điển, release hay phiên; và nếu gói có sự kiện thì nhật ký cũng phải rỗng | Ghi blob, rồi trong **một giao dịch**: chèn bản ghi từ điển, release, các bảng `runs/*` theo thứ tự, nhật ký sự kiện theo đúng thứ tự và hash gốc, cuối cùng thêm sự kiện `IMPORT_COMMITTED`. ID và version giữ nguyên |
| `REAPPLY` | Mọi bản ghi của gói đã có trong workspace với cùng nội dung | Không chèn gì (`inserted: 0`); chỉ ghi sự kiện `IMPORT_COMMITTED` kèm số `duplicates` |

Giá trị `mode` khác `REAPPLY` đều được hiểu là `RESTORE_EMPTY`. Hợp nhất hai workspace độc lập chưa được hỗ trợ.

Khi nhập gói **dictionary**, release mất `run_id` và `candidate_id` (để không trỏ tới lượt không tồn tại) và có `origin: "IMPORT"`. Bản ghi bị lược được chèn với `data.redacted = true`.

## 7. Mã lỗi

Lỗi ném trực tiếp (dừng ngay):

| Mã | HTTP | Ý nghĩa |
| --- | --- | --- |
| `BUNDLE_TOO_LARGE` | 413 | Vượt 5000 file hoặc 300 MB sau giải nén |
| `BUNDLE_INVALID` | 422 | Không phải ZIP hợp lệ; thiếu hoặc hỏng `manifest.json`; sai `format`; file không có trong manifest; thiếu file đã khai; dòng `.jsonl` không phải JSON; thiếu một file `data/*.jsonl` bắt buộc |
| `UNSAFE_PATH` | 422 | Đường dẫn không an toàn trong ZIP hoặc trong manifest |
| `UNSUPPORTED_SCHEMA_VERSION` | 422 | Xem mục 5 |
| `CHECKSUM_MISMATCH` | 422 / 409 | File không khớp `bytes`/`sha256` của manifest; blob không khớp tên (422). Khi commit: gói đã lưu không còn khớp digest của preview (409) |
| `PREVIEW_DIGEST_MISMATCH` | 409 | `preview_digest` gửi lên khác digest của bản nhập thử |
| `NOT_FOUND` | 404 | Không có bản nhập thử; không có gói export; không tìm thấy phiên bản khung |
| `VALIDATION` | 422 | `kind` export không phải `dictionary`/`backup`; thiếu `file` khi preview |
| `FORBIDDEN` | 403 | Tác nhân thiếu quyền của route |

Lỗi nằm trong `report.errors[]` của preview (khi đó `ok: false`). Lúc commit, lỗi đầu tiên được ném với HTTP 409, kèm toàn bộ `errors` và `conflicts` trong `details`:

| Mã | Ý nghĩa |
| --- | --- |
| `SCHEMA_INVALID` | Bản ghi từ điển thiếu hoặc sai kiểu `kind`, `id`, `version`, `data`, `content_sha256` |
| `DUPLICATE_ID` | Cùng `kind id@version` xuất hiện hai lần trong gói |
| `CHECKSUM_MISMATCH` | `data` của bản ghi không khớp `content_sha256` |
| `REFERENCE_MISSING` | Khung thiếu năng lực, chỉ báo hoặc bằng chứng mà nó tham chiếu; release thiếu một thành viên; bản ghi thuộc release không có trong gói |
| `LINEAGE_BROKEN` | Release trỏ tới release cha không có trong gói |
| `WORKSPACE_NOT_EMPTY` | Chế độ `RESTORE_EMPTY` nhưng workspace đã có dữ liệu |
| `REAPPLY_MISMATCH` | Chế độ `REAPPLY` nhưng gói có bản ghi chưa có trong workspace |
| `CONTENT_CONFLICT` | Có xung đột; không ghi gì |

Danh sách `errors` về cấu trúc gói bị cắt ở 50 mục.

## 8. Idempotency và xung đột

- **Khóa đối chiếu là `id@version`.** Bản ghi có phiên bản là bất biến; sửa nghĩa là thêm `version + 1`.
- Bản ghi từ điển: chưa có → sẽ chèn; có với cùng `content_sha256` → trùng (`duplicates`); có với nội dung khác → xung đột.
- Release: cùng `release_id` và cùng `receipt_hash` → trùng; cùng `release_id` khác `receipt_hash` → xung đột; `release_id` mới nhưng workspace đã có release khác ở cùng `seq` → xung đột.
- Dòng `runs/*` và sự kiện được so theo khóa của từng bảng (ví dụ `documentId@version`, `jdSetId#revision`, `runId|block`, `taskKey`, `id`).
- Bất kỳ xung đột nào → `CONTENT_CONFLICT`, **chặn toàn bộ**, không ghi một phần.
- Nhập lại đúng gói đã nhập bằng `REAPPLY` cho 0 thay đổi.
- Commit luôn kiểm lại trên trạng thái mới nhất, nên preview cũ không thể ghi đè dữ liệu đã thay đổi sau đó.

## 9. Những thứ không bao giờ có trong gói

- Mật khẩu Postgres, token Claude CLI (`CLAUDE_CODE_OAUTH_TOKEN`), API key, biến môi trường.
- Đường dẫn tuyệt đối của máy chủ: trường `error` của lời gọi agent (`runs/agent_calls.jsonl`) và của lần chạy block (`runs/attempts.jsonl`, khi không dùng `metadata_only`) được thay đường dẫn bằng `<path>` trước khi ghi.
- Bảng trạng thái worker, các bản nhập thử và danh sách gói export đã tạo.
- Blob gốc, trừ khi chọn `include_blobs`.

## 10. API

Tất cả dưới tiền tố `/api`. Chưa có đăng nhập: quyền là của tác nhân `local` (xem `LOCAL_ACTOR_PERMISSIONS`).

| Phương thức và đường dẫn | Quyền | Mô tả |
| --- | --- | --- |
| `GET /exports` | `VIEW` | Danh sách gói đã tạo (mới nhất trước): `id`, `kind`, `file_name`, `created_at`, `manifest` |
| `POST /exports` | `BACKUP_ADMIN` | Body `{ kind, metadata_only?, include_blobs?, session_ids? }`. Trả `{ id, file_name, bytes, sha256, manifest }`; ghi sự kiện `EXPORT_CREATED` |
| `GET /exports/:id/download` | `BACKUP_ADMIN` | Tải file ZIP |
| `GET /exports/framework` | `VIEW` | Tải framework JSON. Query: `session` (lấy role của phiên), `framework` (ID khung), `version` (nhãn phiên bản; bỏ trống = bản mới nhất) |
| `POST /imports/preview` | `BACKUP_ADMIN` | Multipart `file` + `mode`. Trả `{ id, report }` |
| `POST /imports/:id/commit` | `BACKUP_ADMIN` | Body `{ preview_digest }`. Ghi sự kiện `IMPORT_COMMITTED` |

Lỗi API có dạng `{ code, message, details, actions[] }`.
