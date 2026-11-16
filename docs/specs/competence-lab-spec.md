# Competence Lab — Đặc tả kỹ thuật (bản nháp v3, chờ review)

| | |
| --- | --- |
| Trạng thái | **NHÁP v3 — chờ review, chưa lập plan, chưa viết mã** |
| Mã tham chiếu | `docs/reference/site-v8/` — bản tải về ngày 2026-11-16 của website tham chiếu (HTML, CSS, 10 file JS, tham số `?v=8`). Chưa xác nhận được nó trùng commit `3e515bc…` nêu trong YC. |
| Ngày | 2026-11-16 |
| Nguồn yêu cầu | `docs/requirements/competence-lab-requirements.md` (bản sao nguyên văn file yêu cầu; dưới đây gọi là **YC**, trích dẫn dạng `YC §5`) |
| Phạm vi tài liệu | Chuyển YC thành quyết định kỹ thuật cụ thể. Khi hai tài liệu khác nhau thì YC thắng, trừ các điểm lệch có chủ ý liệt kê ở §2.1. |

**Thay đổi so với v1** (theo phản hồi review):

1. **Bỏ đăng nhập.** Hệ thống chạy một người dùng cục bộ, không có tài khoản (§12).
2. **AI Agent chạy qua Claude CLI** (`claude -p`), không gọi Claude API, không có API key trong ứng dụng (§9).
3. **Chuẩn hóa input/output để kết quả lặp lại được** (§9.3): input chính tắc, output theo schema đóng, bộ nhớ kết quả theo hash.
4. **Phân tích từng bước B0–B8: bước nào thật sự cần AI, dùng model nào, effort nào** (§9.4, §9.5). Kết quả (đã cập nhật ở v3): nhập JD, B0, B7 và nhánh nhanh không cần AI; B1 và B8 mỗi block chỉ còn một câu hỏi cho agent. Lượt chỉ có JD dùng 10 loại tác vụ AI (11 khi từ điển đã có năng lực gần giống).

**Thay đổi so với v2** (theo phản hồi review lần hai):

1. **Quay lại PostgreSQL + Docker Compose** để sẵn sàng triển khai và vector hóa sau này (D2, D12). Claude CLI được cài trong image của worker (§9.2).
2. **B4 làm cả hai việc**: kiểm sự kiện thật người dùng nhập **và** đề xuất sự kiện giả thuyết có nhãn (tác vụ T13).
3. **Example không dùng AI** — đã xác nhận. Chỉ phiên Live gọi Claude CLI.
4. **Đã lấy được mã nguồn website tham chiếu**, nên Example sẽ chuyển nguyên logic và câu chữ từ đó thay vì tự viết lại (D13, §7.1).
5. Thêm **bảng công thức do code tính** (§9.4) để tách rõ khỏi phần cần AI.

**Cách review nhanh:** đọc §1 (quyết định), §9 (AI Agent) và §16 (giả định còn lại).

---

## 1. Các quyết định đề xuất cần duyệt

| # | Quyết định | Lý do | Phương án thay thế |
| --- | --- | --- | --- |
| D1 | **Monorepo TypeScript**: một ứng dụng Next.js (UI + API) và một tiến trình worker chạy job AI. | Một ngôn ngữ cho engine demo (chạy trong trình duyệt), server và schema dùng chung. | Tách SPA + API riêng. |
| D2 | **PostgreSQL** (ORM Drizzle) là kho dữ liệu Live, kể cả hàng đợi job (bảng `job` + `FOR UPDATE SKIP LOCKED`). Dùng image có sẵn extension `pgvector`; MVP **chưa** tạo cột vector — tìm C gần giống ở B3 bằng `pg_trgm` trên tên/alias/định nghĩa, sau interface `CandidateRetriever` để thay bằng vector khi cần. | Đã duyệt: cần triển khai và có thể vector hóa sau. Giao dịch nguyên khối cho YC §7. | — |
| D3 | **Kho blob** khóa theo `sha256`, sau interface `BlobStore`: volume Docker (mặc định) hoặc S3-compatible. | YC §4, §9: giữ file gốc và `blobs/<sha256>`. | Lưu `bytea` trong Postgres. |
| D4 | **Hợp đồng JSON bằng Zod**, sinh JSON Schema cho cả gói export và `--json-schema` của Claude CLI. | Một nguồn schema cho dữ liệu lưu, dữ liệu xuất và output của agent. | Viết JSON Schema tay. |
| D5 | **Example chạy hoàn toàn ở trình duyệt** bằng engine xác định, lưu `localStorage` namespace `cl.example.v1.*`, **không gọi Claude CLI**. | Đã duyệt: Claude CLI chỉ dùng cho Live. YC §1.2, A01 ("chạy offline"), A09. | — |
| D6 | **Một định dạng trace** (`TraceEvent`, §6) cho cả Example và Live. | YC §2.1. Một UI, hai nguồn. | Hai trình xem riêng. |
| D7 | **AI Agent = tiến trình con `claude -p`** do worker khởi chạy, mỗi tác vụ một lần gọi, không công cụ, output ép theo JSON Schema. Dùng phiên đăng nhập Claude CLI sẵn có trên máy. | Yêu cầu review. Đã chạy thử trên máy này với CLI 2.1.325 (§9.2). | — |
| D8 | **Model chỉ phán đoán ngữ nghĩa; mọi phép đếm, công thức, cổng, diff do code tính.** Bảng phân công ở §9.4. | Giảm chi phí, giảm sai lệch giữa các lần chạy, đúng YC §6.3 (tách điểm model đề xuất khỏi trị đo được). | — |
| D9 | **Không đăng nhập.** Một tác nhân `local` có đủ quyền; Compose chỉ mở cổng web trên `127.0.0.1`. Lớp kiểm quyền vẫn tồn tại trong mã để mở rộng sau. Đưa lên mạng công khai trước khi có đăng nhập thì phải đặt sau một lớp xác thực bên ngoài (§12). | Yêu cầu review; YC §10 yêu cầu giữ kiểm quyền và namespace cả ở bản một người. | Thêm đăng nhập sau. |
| D10 | **Nhập JD MVP**: dán văn bản, `.txt`, `.md`, `.pdf` có lớp text, `.docx`. Không OCR, không tải nội dung từ URL. | YC §4 đặt hai mục này là tùy chọn. | Thêm sau MVP. |
| D11 | **Đồ thị không dùng thư viện ngoài**, chuyển nguyên cách làm của mã tham chiếu: 2D là SVG xếp cột thủ công; 3D là phép chiếu phối cảnh tự viết trên Canvas 2D (mã tham chiếu không dùng three.js hay WebGL). Cả hai chung một `GraphModel`. | Khớp bản gốc, không thêm phụ thuộc. YC §2.2, A03. | `d3-force` + `three.js` nếu sau này cần mạng lớn hơn nhiều. |
| D12 | **Docker Compose**: `postgres`, `web`, `worker`, volume blob. Image `worker` cài sẵn Claude CLI ở phiên bản ghim. "Môi trường B" của A08 là một bộ Compose thứ hai. Khi phát triển có thể chạy `worker` ngay trên máy (dùng phiên đăng nhập CLI sẵn có), Postgres vẫn trong Docker. | Đã duyệt: cần triển khai được. | — |
| D13 | **Example chuyển nguyên từ mã tham chiếu** trong `docs/reference/site-v8/`: logic engine, câu chữ, token màu, phông chữ. Chỗ nào YC khác mã tham chiếu thì YC thắng. | Đã lấy được mã nguồn công khai của website. `engine.js` chứa đúng seed của Phụ lục A cộng toàn bộ logic B0–B8 mà YC không nêu. | — |

## 2. Mục tiêu và ngoài phạm vi

**Trong phạm vi (MVP):** YC §1.1–1.6 và các ca nghiệm thu A01–A09, với các điểm lệch ở §2.1.

**Ngoài phạm vi MVP:** đăng nhập và nhiều người dùng; OCR; lấy nội dung từ URL; hợp nhất hai workspace khi import; embedding; provider AI khác Claude CLI; ngôn ngữ giao diện khác tiếng Việt (chuỗi vẫn tách vào `vi.ts`); giao diện nhập phiếu cho reviewer người.

### 2.1 Điểm lệch có chủ ý so với YC

| YC | Trong spec này | Vì sao |
| --- | --- | --- |
| §6.1: adapter provider cấu hình bằng biến môi trường/kho bí mật | Claude CLI; bí mật duy nhất là token đăng nhập của CLI cho container worker (§9.2) | Yêu cầu review |
| §6.4, A05: "thử thiếu API key" | Thử **thiếu Claude CLI hoặc CLI chưa đăng nhập** | Không còn API key |
| §10, A09: "người xem không có quyền duyệt" | Kiểm ở tầng server bằng cấu hình `LOCAL_ACTOR_PERMISSIONS` (§12), không có màn hình đăng nhập | Bỏ đăng nhập |

## 3. Kiến trúc

```text
apps/web            Next.js: UI + route handlers (API)
apps/worker         Đọc bảng job, chạy block, khởi chạy claude -p
packages/contract   Zod schema: W/C/R/V/G, TraceEvent, Gate, bundle, input/output từng tác vụ agent
packages/example    Seed PO (Phụ lục A), Catalog (Phụ lục B), engine demo xác định
packages/pipeline   B0–B8: phần code xác định + điều phối tác vụ agent
packages/agents     Định nghĩa tác vụ (prompt, schema, model, effort), ClaudeCliRunner, bộ nhớ kết quả
packages/registry   Từ điển: draft, candidate diff, commit release, conflict
packages/bundle     Export / import preview / commit
packages/ingest     Parser txt/md/pdf/docx, chuẩn hóa, tách đoạn, hash, phát hiện trùng
packages/db         Drizzle schema, migration (PostgreSQL)
```

Quy tắc phụ thuộc: `contract` không phụ thuộc gì; `example` chỉ phụ thuộc `contract`; chỉ `packages/agents` được khởi chạy `claude`; `web` không bao giờ gọi CLI, chỉ tạo job.

**Hai chế độ, một UI.** Mọi màn hình đọc dữ liệu qua interface `SessionSource`: `ExampleSource` (engine trong trình duyệt) hoặc `LiveSource` (API). Phiên Example luôn có trong bộ chọn phiên, gắn nhãn **Example**; mọi bản ghi của nó có `synthetic: true` và nguồn `seed://…`.

## 4. Giao diện

### 4.1 Khung trang
Nền tối; sidebar trái 7 mục đúng YC §2; thanh đầu trang gồm bộ chọn phiên, tên role của phiên, tình trạng lượt, dải tiến độ B0–B8, nút **Bắt đầu lại**. Dưới 900px: sidebar thành menu trượt; bảng rộng nằm trong vùng cuộn ngang riêng, `body` không cuộn ngang (A03).

Token giao diện lấy từ mã tham chiếu: nền `#0c1018`, panel `#131923`, đường kẻ `#263040`, chữ `#e8edf5`, chữ phụ `#9caabd`, nhấn `#9cafff`, xanh `#72d9b1`, cam `#e9b77b`; phông `Be Vietnam Pro`, số liệu và ID dùng phông đơn cách.

**Bắt đầu lại**: Example → đưa riêng phiên mẫu về `initial()`. Live → mở hộp thoại tạo lượt mới (§7.3), không xóa gì.

### 4.2 Bảy màn hình

| Màn hình | Route | Ghi chú triển khai |
| --- | --- | --- |
| Dây chuyền sản xuất | `/s/[session]/line` | Card B0–B8, nhánh nhanh rẽ sau B3. Nút chính **Tiến 1 bước**; khi block hiện tại đang `Chờ xem` thì nút mở lại block đó. Card có huy hiệu **Code** hoặc **AI · model · effort** theo §9.4. Bấm card chưa chạy chỉ mở mô tả, không tạo job. |
| Dữ liệu đầu vào | `/s/[session]/inputs` | Live có trình tạo/sửa bộ JD và xem trước import (§8). |
| Khung năng lực | `/s/[session]/framework` | Đồ thị nhiệm vụ → C → chỉ báo; thanh bậc 1–5 lấy từ R; so sánh hai phiên bản R; Xuất khung JSON. |
| Từ điển và tái sử dụng | `/s/[session]/dictionary` | 7 tab của YC §2. Live đọc release đã khóa của lượt; có công tắc xem catalog mẫu dưới nhãn "seed". |
| Audit và bài học | `/s/[session]/audit` | Event log, finding, lesson, STOP, và nhật ký từng lần gọi agent (model, effort, thời gian, usage, có lấy từ bộ nhớ hay không). |
| Quản lý phiên | `/sessions` | Danh sách, tìm theo role, tạo phiên JD mới (§7.2). |
| Xuất và khôi phục | `/transfer` | Ba loại export, import preview/commit (§13). |

### 4.3 Trình xem từng nhịp (drawer)
Thực hiện đủ YC §2.1:

- Mở từ phải; desktop 3 cột **Seed/bản ghi → Phép tính → Output nháp**; mobile 3 tab với thanh điều khiển dính đáy.
- Mỗi lần mở mặc định **thủ công**. Điều khiển: Trước, **Tiếp theo**, Xem lại, Tự động (bật/tắt + tốc độ 1×/2× như mã tham chiếu, mỗi nhịp 1,9 giây ở 1×), Đóng. Tự động dừng ở nhịp cuối và không tự bấm **Đã hiểu**.
- Nút Tiếp theo có viền + xung sáng khi chờ; với `prefers-reduced-motion: reduce` dùng viền tĩnh.
- Trang nền giữ vị trí cuộn (drawer là lớp phủ; trạng thái mở nằm ở query `?block=B1`).
- **Con trỏ xem** (`view_cursor`: run, block, attempt, `seq`) lưu mỗi lần đổi nhịp — Example vào `localStorage`, Live lên server. Tải lại tiếp tục đúng nhịp (A02).
- **Đã hiểu** chỉ hiện ở nhịp cuối; ghi sự kiện `ACKNOWLEDGED` và mở khóa điều hướng sang block kế. Cổng FAIL vẫn chặn sau khi xác nhận.
- Live: job có thể xong trước khi người dùng xem hết; drawer hiện "Đã tính lúc …". Nhịp nào dùng phán đoán của agent thì ghi rõ tác vụ, model và effort; nhịp do code tính thì ghi công thức.

### 4.4 Đồ thị và catalog
- Hàm thuần `buildGraph(profiles, filters) → GraphModel{nodes, edges}` dùng cho cả 2D và 3D. Node: họ nghề, role, C. Cạnh: `FAMILY_ROLE`, `ROLE_COMPETENCY`. Tọa độ không thuộc `GraphModel`.
- Trọng số cạnh role–C ở chế độ toàn mạng = trung bình `weight` trên các profile đang xét của role, tính 0 cho profile không có C (đúng `summaries()` Phụ lục B).
- Bộ lọc họ nghề, ngành, nhóm C **không** tính lại `weight` trong profile.
- Chọn node → các node khác mờ; toàn mạng / vùng lân cận; phóng to, đổi góc, bật nhãn, toàn màn hình. 3D: xoay/pan/zoom và một danh sách node điều khiển được bằng bàn phím.
- Ma trận heatmap role × C, bấm ô mở chi tiết. So sánh hai profile: năng lực chung/riêng, chênh bậc và trọng số, Jaccard theo trọng số. Mẫu số 0 → "Không tính được".
- Truy vết: khung/chỉ báo → evidence → đúng phiên bản JD/sự kiện (URL chứa `document_id@version`).
- **Số đã kiểm bằng cách chạy Phụ lục B:** view toàn mạng mặc định = 36 node (5 + 10 + 21), 134 cạnh (10 họ→role + 124 role→C); lọc Sản phẩm số + Tài chính = 3 role; tổng `weight` mỗi profile = 1. Các số này thành test.
- Live: chỉ hiện điểm/trọng số khi R có công thức, đầu vào và nguồn truy vết được.

## 5. Mô hình dữ liệu (Live)

Mọi bảng có `workspace_id` (MVP có một workspace mặc định, vẫn giữ cột để tách namespace). Bản ghi có phiên bản là **bất biến**: sửa = thêm hàng mới `(id, version+1)`.

### 5.1 Phiên, tài liệu, lượt

| Bảng | Trường chính |
| --- | --- |
| `workspace` | `id, name, stop_state` |
| `session` | `id, name, role_title, role_id, family?, industry?, purpose, context` |
| `document` / `document_version` | YC §4: `document_id, document_version, source_kind, source_ref, original_name, content_sha256, blob_sha256?, normalized_text, normalizer_version, parser_version, segmenter_version, origin_group?, submitted_by, submitted_at, role_id, language, check_status, usage_note, source_url?` |
| `segment` | `segment_id (= document_id@version#n), start, end, text, text_sha256` — đơn vị trích dẫn của agent (§9.3) |
| `jd_set` / `jd_set_revision` | `jd_set_id, revision, parent_revision?, document_refs[], confirmed_at` |
| `evidence` | `evidence_id, document_ref, segment_ids[], page?, start, end, quote, quote_sha256, support_check` |
| `run` | `id, session_id, run_no, snapshot (json), status` |
| `block_attempt` | `id, run_id, block, attempt_no, prev_attempt_id?, idempotency_key, status, input_hash, output (json), output_hash, computed_at, error?` |
| `agent_call` | một hàng cho mỗi lần cần kết quả agent: `id, attempt_id, task_id, task_key, cache_hit, model, effort, prompt_version, schema_version, cli_version, started_at, duration_ms, usage (json), cost_usd, status, error?` |
| `agent_result` | bộ nhớ kết quả: `task_key (PK), input_canonical, output (json), created_at, first_call_id` |
| `job` | `id, attempt_id, state, locked_at, tries` |
| `event` | append-only, §11 |
| `view_cursor` | `run_id, block, attempt_id, seq, acknowledged_at?` |

**Run snapshot** (khóa khi tạo lượt, YC §3): `jd_set_revision`, danh sách `document@version` + hash, `base_release_id`, `policy@version`, **bảng cấu hình agent** (mỗi tác vụ: model ID đầy đủ, effort, phiên bản prompt và schema), phiên bản Claude CLI, `lessons_loaded[]`.

**Quy ước offset:** `start/end` là chỉ số **code point Unicode**, nửa mở `[start, end)`, trên `normalized_text` của đúng `document_version`. Chuẩn hóa `norm-v1`: NFC, `\r\n`→`\n`, bỏ khoảng trắng cuối dòng, gộp >2 dòng trống. Tách đoạn `seg-v1`: mỗi dòng/gạch đầu dòng là một đoạn; dòng dài hơn 400 ký tự tách tiếp theo dấu kết câu. Đổi parser, chuẩn hóa hay bộ tách đoạn → `document_version` mới; evidence cũ vẫn trỏ bản cũ.

### 5.2 Từ điển W/C/R/V/G
Đúng thuộc tính tối thiểu ở YC §7. Chốt thêm:

- `competency_id`: UUID bền vững cấp workspace + `display_code` (ví dụ `C04`). Bậc yêu cầu chỉ nằm ở `R.requirement.required_level`; `indicator.anchor_level` là neo độ khó của hành vi.
- Sửa định nghĩa C → `competency_version+1`; sửa câu chỉ báo → `indicator_version+1`; đổi bậc/trọng số/chỉ báo của role → `framework_version` mới. R luôn khóa `competency@version` và `indicator@version` (A01: R 1.0 vẫn cho C04 bậc 3 sau khi có R 1.1).
- `status` của C: `ACTIVE | DEPRECATED | MERGED_INTO(ref)`; alias, merge, deprecate là bản ghi G có lịch sử.
- Mỗi record V có `provenance`, `evidence_class: REAL | SEED | HYPOTHESIS`, `usage_scope`.
- **Hai lớp**: `draft_*` gắn `run_id` và các bảng đã công bố gắn `release_id`.
- `release`: `release_id, parent_release_id, version_label, run_id, candidate_id, decided_by, decided_at, diff (json), receipt_hash`.

## 6. Trace và cổng (hợp đồng dùng chung Example/Live)

```ts
TraceEvent = {
  seq: number, block: 'B0'..'B8' | 'FAST', attempt_id: string,
  kind: 'RECEIVE' | 'READ' | 'GATE' | 'HANDOFF',
  title: string, explanation?: string,   // tiêu đề và lời giải thích của nhịp
  record_ref?: string,            // ID bản ghi/phiếu/hạng tử đang đọc
  content?: string,
  fields_used?: string[],
  formula?: string,               // vd "valid += 1[đạt luật]"
  substitution?: string,          // vd "1 + 1 = 2"
  denominator?: { value: number, note: string },
  before?: Json, after?: Json,
  output_delta?: { op: 'ADD'|'CHANGE'|'KEEP', ref: string, reason: string }[],
  source: 'CODE' | { task_id: string, agent_call_id: string },  // ai tạo ra nhịp này
  gate?: GateResult,
  computed_at: string             // UTC
}

GateResult = {
  gate_id: string, status: 'PASS'|'FAIL'|'NOT_EVALUATED'|'NOT_APPLICABLE',
  actual: Json, criterion: string, input_refs: string[],
  rule_version: string, reason?: string, required: boolean
}
```

Thứ tự nhịp trong mọi block: `RECEIVE` → nhiều `READ` → nhiều `GATE` → `HANDOFF`. Trace do **code sinh xác định** từ output có cấu trúc đã lưu của attempt, nên phát lại luôn giống nhau.

Trạng thái block: `Đang chờ` · `Đang tính` · `Chờ xem` · `Cần bổ sung` · `Chặn` · `Đạt`.

`NOT_APPLICABLE` chỉ hợp lệ khi policy của lượt cho phép và có `reason`. Mẫu số 0 → `NOT_EVALUATED`.

## 7. Phiên và lượt

### 7.1 Default Example (engine xác định, không AI)
Dữ liệu: `seed(1)`, `seed(2)`, `initial()` (Phụ lục A) và `Catalog` (Phụ lục B), chép nguyên logic sang TS. Engine demo phải cho đúng các số ở YC §11:

| Block | Lượt 1 | Lượt 2 |
| --- | --- | --- |
| B1 | 8 JD, đếm cộng dồn 1→8, `traceRate` 8/8 | 11 JD |
| B2 | 6 nhiệm vụ, Σw = 15 | 7 nhiệm vụ, Σw = 19 |
| B3 | 7 ứng viên (6 concept + 1 alias của stakeholder), P = 6/7, R = 6/6 | LL-001 SAFE → khử trùng sớm; thêm C07 |
| B5 | Gộp alias muộn; coverage 3/15 → 6/15 → 9/15 → 11/15 → 13/15 → 15/15; bậc = trung vị `[3,3,3]` = 3 | Mẫu số 19; C04: `[4,4,3]` → `[3,4,4]` → bậc 4 |
| B6 | Phiếu fixture `[ID, ID, ID]`, ngưỡng demo 70% | C04 bổ sung chỉ báo nhóm đối chiếu |
| B8 | Lõi 0.9 → **1.0**: 6 C, 4 ADD (C03–C06), 2 UPDATE (C01, C02); finding + lesson LL-001 | Lõi **1.1**: 1 ADD (C07), 1 UPDATE (C04), 5 REUSE; giữ cả R 1.0 và R 1.1 |
| FAST | Bản thử sau B3, pilot seed 9/12 | — |

Đã kiểm bằng cách chạy Phụ lục A: số JD/nhiệm vụ/sự kiện, Σw 15 và 19, rating C04 đúng như trên.

**Lỗi mô phỏng:** hai công tắc — "mất nguồn tại B1" và "ghi trái quyền tại B6" → cổng FAIL → STOP khóa cả hai nhánh → **Mở lại** yêu cầu lý do, ghi vào audit.

**Chuyển từ mã tham chiếu** (`docs/reference/site-v8/engine.js`, tôi đã đọc; chưa chạy thử file tải về): các chi tiết YC không nêu được lấy nguyên văn —

- Policy demo `sim-policy-1.0`: `minJD 6`, `minCoverage 1`, `minAgreement 0,7`.
- Ứng viên thứ 7 ở B3 là alias "Giao tiếp với stakeholder", chỉ xuất hiện khi LL-001 chưa được duyệt an toàn.
- Câu chỉ báo của 7 năng lực, kể cả bản bậc 4 của C04 (`indicator_version 2`).
- Pilot nhánh nhanh: 12 nhiệm vụ, 9 đạt, 3 lỗi, kèm hai ghi chú phản hồi; ghi vào V với ID `PILOT-<lượt>`.
- Finding `F-001` (mức Medium, khử trùng muộn) và lesson `LL-001` cùng phép thử hồi quy và phép thử không gộp nhầm.
- Tên và tiêu chí từng cổng của B0–B8.

Các file còn lại (`production.js`, `calculation-trace.js`, `step-guide.js`, `ecosystem.js`, `network3d.js`, `visuals.js`, `app.js`, `style.css`) là nguồn cho bố cục, câu chữ từng nhịp và đồ thị; sẽ đọc chi tiết ở bước plan. Phần YC yêu cầu mà mã tham chiếu chưa có (bộ chọn phiên, Quản lý phiên, Xuất và khôi phục, phiên Live) là phần xây mới.

### 7.2 Phiên JD mới (wizard)
Tên phiên → vị trí/role (chọn hoặc nhập chức danh tùy chỉnh) → mục đích, bối cảnh → thêm JD → xem trước và xác nhận → chọn release nền (mặc định: mới nhất; workspace mới = rỗng) → **màn chốt trước khi chạy** → B0.

Màn chốt hiện: nội dung JD sẽ được gửi tới Anthropic qua Claude CLI bằng tài khoản đang đăng nhập trên máy này; danh sách tác vụ sẽ chạy kèm model và effort; số lần gọi dự kiến (tính được từ số JD, §9.5). Không có bước này thì không có lời gọi nào.

### 7.3 Tạo lượt mới
Ba lựa chọn: *Dùng lại bộ JD*, *Bổ sung JD* (revision mới có `parent_revision`), *Chạy lại theo phiên bản mới* (release nền/policy/cấu hình agent mới). Lượt cũ và snapshot của nó không bao giờ bị sửa.

### 7.4 Retry
Retry tạo `block_attempt` mới (`attempt_no+1`, `prev_attempt_id`). Retry block *n* đánh dấu attempt hiện hành của các block > *n* là `STALE`; block < *n* được dùng lại nguyên. Retry mặc định **vẫn dùng bộ nhớ kết quả** (chỉ gọi lại những tác vụ đã lỗi); muốn model chạy lại một tác vụ đã có kết quả phải chọn rõ "Chạy lại agent", xem §9.3.

## 8. Nhập JD (Live) — toàn bộ là code, không AI

1. **Tải/dán** → trích text, chuẩn hóa, tách đoạn, tính `content_sha256` (text chuẩn hóa) và `blob_sha256` (byte gốc).
2. **Xem trước**: text trích, số trang/đoạn, cảnh báo (rỗng, ký tự `U+FFFD`, PDF không có lớp text, trùng byte theo hash, **gần trùng** theo Jaccard shingle 5 từ ≥ 0,85 — chỉ là đề xuất kiểm), email/số điện thoại phát hiện bằng biểu thức chính quy để gợi ý loại bỏ, trường metadata còn thiếu.
3. Người dùng sửa metadata, loại thông tin cá nhân (tạo `document_version` mới), bỏ tài liệu.
4. **Xác nhận** → tạo `jd_set_revision`.

Giới hạn cấu hình, hiện ngay trên vùng tải: `MAX_FILES` (20), `MAX_FILE_MB` (10), `MAX_CHARS_PER_DOC` (60 000).

`origin_group` chỉ được gán khi người dùng nhập tổ chức nguồn hoặc xác nhận; tài liệu không có nhóm được đếm ở mục "chưa xác định".

## 9. AI Agent qua Claude CLI

### 9.1 Nguyên tắc

1. **Agent chỉ trả lời câu hỏi ngữ nghĩa** mà code không làm được: đoạn này nói nhiệm vụ gì, hai khái niệm có cùng nội hàm không, câu chỉ báo viết thế nào.
2. **Code làm mọi việc còn lại**: đếm, tỷ lệ, coverage, P/R/F1, trung vị, cổng, diff, gán ID, kiểm trích dẫn, sinh trace.
3. **Một tác vụ = một lần gọi CLI = một câu hỏi hẹp**, có schema input và output riêng. Không có agent tự do nhiều bước, không có công cụ.
4. **Agent không ghi dữ liệu.** Worker nhận JSON, kiểm, rồi mới ghi.

### 9.2 Cách gọi

Worker khởi chạy, prompt người dùng đưa qua stdin:

```sh
claude -p \
  --model <model ID đầy đủ> --effort <low|medium|high> \
  --system-prompt "<nội dung prompt hệ thống của tác vụ>" \
  --json-schema '<JSON Schema output của tác vụ>' \
  --output-format json \
  --tools "" --strict-mcp-config --disable-slash-commands \
  --setting-sources "" --no-session-persistence
```

- `--system-prompt` thay toàn bộ prompt mặc định; `--tools ""` tắt mọi công cụ; `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands` loại cấu hình, MCP, skill của máy; thư mục làm việc là một thư mục tạm rỗng. Mục đích: lời gọi không phụ thuộc vào môi trường Claude Code của người dùng.
- Kết quả đọc từ trường `structured_output` của JSON trả về; `is_error`, `subtype`, `usage`, `modelUsage`, `total_cost_usd`, `duration_ms` ghi vào `agent_call`.
- **Đã kiểm trên máy này** (CLI 2.1.325): các cờ trên tồn tại trong `claude --help`, và một lời gọi thử với `--json-schema` trả `structured_output` đúng schema. Phiên bản CLI tối thiểu ghi trong README; worker kiểm `claude --version` khi khởi động.
- Không dùng `--bare` vì chế độ đó bắt buộc API key.
- Model ghi bằng **ID đầy đủ** (ví dụ `claude-sonnet-5-5`), không dùng bí danh `sonnet`, để bí danh đổi nghĩa không làm đổi kết quả.
- Giới hạn: timeout mỗi lời gọi (mặc định 180 giây, quá thì hủy tiến trình), tối đa 3 tiến trình song song, 2 lần thử lại có lùi dần cho lỗi tạm thời, `MAX_INPUT_CHARS` mỗi lời gọi, ngân sách số lời gọi mỗi lượt.
- Đường dẫn CLI cấu hình bằng `CLAUDE_BIN` (mặc định `claude`). Test dùng một file thực thi giả đặt vào `CLAUDE_BIN`.
- **Đăng nhập CLI trong container worker:** tạo token dài hạn một lần bằng `claude setup-token` trên máy có gói Claude, đặt vào `.env` của Compose và truyền cho worker qua biến môi trường `CLAUDE_CODE_OAUTH_TOKEN` (theo tài liệu xác thực của Claude Code: token có hạn một năm, chỉ dùng được cho yêu cầu model, cần gói Pro/Max/Team/Enterprise, và không được đọc ở chế độ `--bare`). Token chỉ có ở container `worker`; `web` và trình duyệt không bao giờ thấy nó; không ghi vào log, event hay export. Môi trường của worker **không được** đặt `ANTHROPIC_API_KEY` hay `ANTHROPIC_AUTH_TOKEN`, vì CLI ưu tiên hai biến đó hơn token này; worker kiểm điều này khi khởi động.
- Chạy worker ngay trên máy phát triển thì không cần token: CLI dùng phiên đăng nhập sẵn có.

**Khi CLI không dùng được** (không tìm thấy, chưa đăng nhập, sai phiên bản): khóa nút chạy Live, hiện cách cài và đăng nhập; Example vẫn chạy. Không có fallback seed.

### 9.3 Chuẩn hóa để kết quả lặp lại được

Model ngôn ngữ không cho kết quả giống hệt nhau qua hai lần gọi mới, và Claude CLI không có tham số cố định độ ngẫu nhiên. Vì vậy tính lặp lại được bảo đảm bằng thiết kế, theo ba lớp:

**Lớp 1 — Cùng input thì không gọi lại (bảo đảm tuyệt đối).**
`task_key = sha256(task_id, prompt_version, schema_version, model, effort, input_canonical)`. Trước mỗi lần gọi, worker tra `agent_result` theo `task_key`; có thì dùng lại, ghi `cache_hit = true`. Hệ quả:

- Chạy lại một lượt, retry, hay tải lại trang cho đúng kết quả cũ, không tốn lời gọi.
- "Bổ sung JD" chỉ gọi agent cho JD mới, vì các tác vụ theo từng JD có `task_key` không phụ thuộc lượt.
- Đổi prompt, schema, model hay effort làm đổi `task_key`, nên kết quả cũ không bị dùng nhầm.
- "Chạy lại agent" là thao tác có chủ ý: thêm `rerun_no` vào khóa, giữ cả kết quả cũ và mới, ghi event; attempt nêu rõ dùng kết quả nào.

**Lớp 2 — Input chính tắc.**
`input_canonical` là JSON với khóa sắp xếp, mảng sắp theo ID, text đã chuẩn hóa `norm-v1`, không chứa thời gian, ID lượt hay bất kỳ giá trị nào không ảnh hưởng câu trả lời. Prompt hệ thống là file có phiên bản trong repo, không nội suy gì ngoài dữ liệu của tác vụ. Nội dung JD nằm trong khối dữ liệu có phân tách, kèm chỉ dẫn rằng đó là dữ liệu chứ không phải lệnh.

**Lớp 3 — Output đóng, thu hẹp chỗ model có thể khác nhau.**

- **Trích dẫn bằng ID đoạn, không bằng chữ.** Model nhận các đoạn đã đánh số (`segment_id`) và chỉ trả về ID. Code tra lại text và offset. Trích dẫn vì thế luôn tồn tại nguyên văn; ID không có trong input → output bị loại.
- **Chọn trong tập cho sẵn.** Mọi quyết định là `enum`; mọi tham chiếu (nhiệm vụ, năng lực, C nền) phải là ID có trong input. Độ chắc là `HIGH | MEDIUM | LOW`, không phải số thực.
- **Không cho model sinh số.** Không điểm, không tỷ lệ, không trọng số trong bất kỳ schema output nào.
- **Chữ tự do có khuôn.** Chỉ ba chỗ có chữ tự do: câu nhiệm vụ, nhãn + định nghĩa năng lực, câu chỉ báo. Mỗi chỗ có giới hạn độ dài và khuôn câu trong prompt (ví dụ chỉ báo: động từ quan sát được + đối tượng + điều kiện/tiêu chí).
- **Code hậu xử lý xác định.** Sắp xếp output theo khóa ổn định, gán ID bằng hash nội dung, gộp trùng theo text chuẩn hóa.
- `additionalProperties: false` ở mọi schema; sai schema → một lần gọi sửa kèm lỗi validate; vẫn sai → `AGENT_SCHEMA_INVALID`, attempt lỗi, giữ nguyên bản nháp trước.

**Đo độ ổn định thay vì giả định.** Script `pnpm verify:stability` chạy mỗi tác vụ 3 lần (bỏ qua bộ nhớ) trên bộ JD mẫu và báo tỷ lệ trùng khớp của các trường quyết định. Tác vụ nào dưới ngưỡng thì siết prompt/schema hoặc nâng model. Đây là căn cứ để chỉnh bảng §9.4.

### 9.4 Bước nào cần AI, model nào, effort nào

Ba model dùng trong MVP: `claude-haiku-5-5` (phân loại đơn giản), `claude-sonnet-5-5` (trích xuất và liên kết), `claude-opus-5-5` (phán đoán khó, sai thì ảnh hưởng từ điển dùng chung). Bảng này là cấu hình mặc định trong `packages/agents/config.ts`, khóa vào snapshot của lượt, và sẽ được hiệu chỉnh bằng `verify:stability`.

**Phân tích theo block:**

| Block | Cần AI? | Phần do code làm | Phần do agent làm |
| --- | --- | --- | --- |
| Nhập JD | **Không** | Parse, chuẩn hóa, tách đoạn, hash, trùng, gần trùng | — |
| B0 | **Không** | Dựng charter, kiểm từng trường snapshot | — |
| B1 | Ít | Lỗi parse, trùng, có nguồn hay không, `valid`, `traceRate`, origin group, cổng | Chỉ một câu hỏi: JD này có đúng role và phạm vi của phiên không (T1) |
| B2 | Có | Kiểm ID đoạn, trọng số nhiệm vụ = số JD hợp lệ nêu nhiệm vụ / tổng JD hợp lệ, khóa danh sách, mã chuẩn nghề = `UNVERIFIED` nếu người dùng không cung cấp | Trích nhiệm vụ (T2); gộp nhiệm vụ tương đương (T3) |
| B3 | Có | Tìm C nền gần giống bằng so khớp tên/alias/định nghĩa, P/R/F1 nếu có gold, kiểm trùng, cổng | Trích ứng viên (T4); gom ứng viên trùng nghĩa (T5); phán REUSE/UPDATE/ADD (T6) |
| FAST | **Không** | Lấy thẳng kết quả B3, gắn phạm vi "phát triển", ghi V | — |
| B4 | Có | Phân loại nguồn `REAL / HYPOTHESIS`, mẫu số phủ căn cứ, kiểm nguồn tồn tại; sự kiện giả thuyết không bao giờ được tính là bằng chứng | Kiểm sự kiện thật người dùng nhập có hỗ trợ mệnh đề (T7); đề xuất sự kiện giả thuyết cho nhóm ứng viên chưa có sự kiện thật (T13) |
| B5 | Có | Chọn C = mọi C có ít nhất một cạnh hợp lệ; coverage; nhiệm vụ trọng yếu bị hở; phép thử bỏ 1 C; trung vị phiếu | Nối nhiệm vụ với C (T8); phiếu bậc chỉ khi có rubric (T9) |
| B6 | Có | Lập gói ẩn đáp án, đếm đúng C/đúng bậc/đúng cặp, abstain, cổng từng item | Viết chỉ báo (T10); reviewer dịch ngược (T11) |
| B7 | **Không** | AND các cổng bắt buộc, đủ nguồn, nhất quán phiên bản | — |
| B8 | Ít | Dựng diff ADD/UPDATE/REUSE, role bị ảnh hưởng, lý do từng mục (ghép từ dữ liệu có cấu trúc), kiểm toán xác định, commit | Một lần kiểm toán nội dung (T12) |

**Bảng tác vụ:**

| Tác vụ | Agent YC | Block | Đơn vị gọi | Model | Effort | Output (đều là ID/enum trừ chỗ ghi rõ) |
| --- | --- | --- | --- | --- | --- | --- |
| T1 `jd_scope` | A1 | B1 | mỗi JD | haiku | low | `verdict: IN_SCOPE / OUT_OF_SCOPE / UNSURE`, `reason_code`, `segment_ids` |
| T2 `task_extract` | A1 | B2 | mỗi JD | sonnet | medium | danh sách `{câu nhiệm vụ (chữ, theo khuôn), segment_ids}` |
| T3 `task_merge` | A1 | B2 | 1 lần/lượt | sonnet | medium | các nhóm `{member_ids, canonical_member_id}` |
| T4 `competency_extract` | A2 | B3 | mỗi JD | sonnet | medium | danh sách `{nhãn, định nghĩa ngắn (chữ), segment_ids}` |
| T5 `candidate_cluster` | A2 | B3 | 1 lần/lượt | sonnet | medium | các nhóm `{member_ids, canonical_member_id, relation: SAME / RELATED_DISTINCT}` |
| T6 `competency_match` | A2 | B3 | mỗi nhóm ứng viên có C nền gần giống | **opus** | **high** | `decision: REUSE / UPDATE / ADD / NEEDS_REVIEW`, `target_competency_id`, `boundary_code`, `confidence`, `alternative_id?` |
| T7 `claim_support` | A4/A5 | B4 | mỗi sự kiện người dùng nhập | sonnet | medium | `support: SUPPORTED / PARTIAL / NOT_SUPPORTED`, `segment_ids` |
| T8 `task_link` | A6 | B5 | mỗi nhiệm vụ | sonnet | medium | `competency_ids` chọn từ danh sách, `segment_ids` làm căn cứ từng cạnh |
| T9 `level_vote` | A7 | B5 | mỗi C × 3 ghế, chỉ khi có rubric | haiku / sonnet / opus | medium | `level: 1..5 / ABSTAIN`, `rubric_anchor_id` |
| T10 `indicator_write` | A8 | B6 | mỗi C | **opus** | medium | 1–3 câu chỉ báo (chữ, theo khuôn), `segment_ids` |
| T11 `retranslation` | reviewer | B6 | 3 ghế, mỗi ghế 1 lần cho cả bộ chỉ báo | haiku / sonnet / opus | medium | với mỗi chỉ báo: `competency_id / ABSTAIN`, `level?` |
| T12 `audit_review` | AU | B8 | 1 lần/lượt | **opus** | **high** | với mỗi mục của hồ sơ: `support_check`, và danh sách finding theo khuôn (§11) |
| T13 `hypothesis_propose` | A3 | B4 | mỗi nhóm ứng viên chưa có sự kiện thật | sonnet | medium | một sự kiện `{tình huống, hành động, kết quả mong đợi}` (chữ, theo khuôn), `segment_ids` gợi ra nó; code gắn cứng `evidence_class: HYPOTHESIS` |

**Công thức do code tính — không tác vụ nào ở trên được trả về các giá trị này:**

| Block | Công thức | Ghi chú |
| --- | --- | --- |
| B1 | `valid += 1[đạt luật]`; `traceRate = JD hợp lệ có nguồn / JD hợp lệ`; số origin group | Mẫu số 0 → chưa đánh giá |
| B2 | `w_task = số JD hợp lệ nêu nhiệm vụ / số JD hợp lệ`; `Σw` trên danh sách đã khóa | Người dùng có thể ghi đè trọng số; ghi đè được lưu kèm lý do |
| B3 | `P = TP/(TP+FP)`, `R = TP/(TP+FN)`, `F1 = 2TP/(2TP+FP+FN)` | Chỉ khi có gold độc lập |
| B4 | `sourceCoverage = sự kiện có nguồn / tổng sự kiện` | Tính riêng cho `REAL`; `HYPOTHESIS` không vào tử số |
| B5 | `coverage = Σ(w·1[có C chọn và cạnh hợp lệ])/Σw`; phép thử bỏ 1 C; `level = median(phiếu)` | Bậc chỉ khi có rubric và phiếu hợp lệ |
| B6 | `agreement = số ghế đúng / số ghế không abstain` cho đúng C, đúng bậc, đúng cặp | Kappa cấp lô là thống kê riêng |
| B7 | AND các cổng bắt buộc | — |
| B8 | Phân loại `ADD / UPDATE / REUSE` từ so sánh `id@version` với release nền; số đếm; hash receipt | — |
| Catalog | `s = importance × (mentions/totalSources) × criticality`; `weight = s/Σs`; `core`; Jaccard theo trọng số | Phụ lục B |

Giải thích các lựa chọn:

- **T1 dùng haiku/low:** phân loại ba nhãn trên một tài liệu ngắn, sai thì người dùng thấy ngay ở B1.
- **T6 và T12 dùng opus/high:** T6 quyết định có sửa hay dùng lại một khái niệm của từ điển dùng chung — sai ở đây lan sang mọi role về sau (YC §5: "tên giống chưa đủ để gộp"). T12 là lớp kiểm độc lập cuối cùng trước khi ghi lõi.
- **T10 dùng opus/medium:** câu chỉ báo là sản phẩm người dùng đọc trực tiếp; chất lượng viết quan trọng hơn tốc độ.
- **T9 và T11 dùng ba model khác nhau cho ba ghế:** ba phiếu từ cùng một model gần như là một phiếu. Dùng ba model cho mức độc lập cao hơn với chi phí tương đương. Kết quả vẫn mang nhãn "lớp sàng AI", không thay reviewer người khi policy yêu cầu (YC §5 B6).
- **Không dùng `claude-fable-5-2` mặc định:** là model mạnh nhất nhưng đắt nhất; để làm tùy chọn nâng cấp cho T6/T12 nếu `verify:stability` cho thấy opus chưa đủ ổn định.
- **Không tác vụ nào dùng effort `xhigh`/`max`:** mỗi tác vụ đã được thu hẹp thành một câu hỏi; nếu một tác vụ cần mức đó thì nên tách nhỏ tiếp.

**Các chỗ v1 dùng AI, nay chuyển sang code:** lý do từng mục diff ở B8 (ghép từ quyết định T6 + evidence); chọn tập C ở B5 (quy tắc xác định trên kết quả T8); nhánh nhanh.

**Bỏ qua lời gọi khi không cần:**

- Từ điển nền rỗng hoặc không có C nào gần giống → không gọi T6, nhóm ứng viên là `ADD`.
- Chỉ có một nhiệm vụ/ứng viên → không gọi T3/T5.
- Không có rubric bậc → không gọi T9, bậc hiển thị "Chưa xác định".
- Không có sự kiện người dùng nhập → không gọi T7.
- Nhóm ứng viên đã có sự kiện thật → không gọi T13 cho nhóm đó.

### 9.5 Số lời gọi của một lượt

Với *N* JD hợp lệ, *T* nhiệm vụ sau gộp, *G* nhóm ứng viên sau B3, *K* nhóm trong đó có C nền gần giống, *C* năng lực được chọn, lượt chỉ có JD (không rubric, không sự kiện thật):

| Model | Số lời gọi | Tác vụ |
| --- | --- | --- |
| haiku | N + 1 | T1 × N, T11 ghế 1 |
| sonnet | 2N + T + G + 3 | T2 × N, T4 × N, T3, T5, T13 × G, T8 × T, T11 ghế 2 |
| opus | K + C + 2 | T6 × K, T10 × C, T11 ghế 3, T12 |

Ví dụ 8 JD, 6 nhiệm vụ, 6 nhóm ứng viên, 6 năng lực, từ điển rỗng (K = 0): 9 haiku + 31 sonnet + 8 opus = 48 lời gọi. Chạy lại cùng lượt: 0 lời gọi. Bổ sung 3 JD: chỉ T1/T2/T4 của 3 JD mới được gọi lại, cộng các tác vụ cấp lượt có input thay đổi.

### 9.6 Dây chuyền Live: cổng của từng block

| Block | Cổng chính (theo policy) |
| --- | --- |
| B0 | Đủ trường bắt buộc của snapshot |
| B1 | `valid ≥ policy.min_valid_jd` (mặc định nháp: 1); JD `UNSURE` chờ người dùng quyết |
| B2 | Mỗi nhiệm vụ có ≥ 1 đoạn nguồn hợp lệ |
| B3 | Mọi ứng viên có đoạn nguồn; không còn trùng chưa xử lý; P/R/F1 = `NOT_EVALUATED` nếu thiếu gold |
| B4 | Sự kiện thật: tách "nguồn tồn tại" (code) và "nguồn hỗ trợ mệnh đề" (T7). Chỉ có giả thuyết: các cổng về bằng chứng sự kiện là `NOT_APPLICABLE` + lý do (policy cho phép JD-only); giả thuyết hiển thị với nhãn rõ và không nâng lớp bằng chứng |
| B5 | `coverage = Σ(w·1[có C chọn và cạnh hợp lệ])/Σw ≥` ngưỡng policy; liệt kê nhiệm vụ trọng yếu bị hở |
| B6 | Từng chỉ báo: số ghế chọn đúng C / số ghế không abstain ≥ ngưỡng policy; ghi rõ là so với nhãn dự kiến. Dưới ngưỡng → một vòng viết lại (T10 với ghi chú lỗi) → phiên bản chỉ báo mới → kiểm lại |
| B7 | Tất cả cổng bắt buộc `PASS` hoặc `NOT_APPLICABLE` hợp lệ |
| B8 | Kiểm toán xong + quyết định của người dùng |

**Nhánh nhanh (FAST)**, mở sau B3 nếu policy cho phép: ghi ứng viên thử **chỉ vào V**, gắn phạm vi "phát triển", nguồn và phần chưa kiểm; không ghi W/C/R; không qua B8.

**Policy mặc định `jd-only-draft@1`:** `min_valid_jd: 1`, `allow_jd_only: true`, `require_human_review: false`, `retranslation: true`, `verify_real_events: true`, `propose_hypotheses: true`, `fast_branch: true`, `publish_scope: internal_draft`; `min_coverage: 0,8`, `min_item_agreement: 2/3`, STOP khi finding `CRITICAL` — ba ngưỡng này là mặc định kỹ thuật, gắn nhãn "chưa duyệt nghiệp vụ" trên UI, đổi được bằng policy mới (§16 G2). Policy là dữ liệu có phiên bản, khóa theo lượt.

**Hai trường tách biệt trên mọi output:** `ai_executed` (agent đã chạy thật, có `agent_call`) và `evidence_verification: UNVERIFIED | JD_STATED | HUMAN_VERIFIED`.

**Idempotency:** `POST` chạy block yêu cầu `Idempotency-Key`; ràng buộc unique `(run_id, block, attempt_no)` và `(run_id, idempotency_key)`. Bấm hai lần hoặc tải lại trả về cùng attempt.

## 10. Công bố từ điển (B8) và registry

1. B8 tạo `candidate`: danh sách thay đổi, mỗi mục có lý do, evidence và **các khung/role bị ảnh hưởng** (bắt buộc với UPDATE định nghĩa C dùng chung).
2. Người dùng chấp nhận toàn gói hoặc bỏ từng mục, kèm lý do. Sau đó server kiểm lại ràng buộc tham chiếu và tính đầy đủ.
3. **Commit** trong một giao dịch `SERIALIZABLE` có khóa theo workspace:
   - kiểm STOP của workspace;
   - kiểm `expected_base_release_id` = release mới nhất — khác → `BASE_CHANGED`, yêu cầu so lại diff trên nền mới;
   - khóa idempotency `(workspace, run, candidate)` — commit lại trả receipt cũ;
   - kiểm mọi tham chiếu resolve được;
   - ghi bản ghi + diff + lịch sử + sự kiện `RELEASE_COMMITTED`, trả **receipt** (release ID, số ADD/UPDATE/REUSE, hash nội dung).
4. Sau commit: đối chiếu receipt với dữ liệu đã ghi.
5. `NEEDS_REVIEW` không bao giờ vào release; nằm lại trong draft của lượt.
6. **Khôi phục**: tạo release mới có `reverts: <release_id>`; không xóa lịch sử.
7. Lượt đang chạy tiếp tục đọc release đã khóa trong snapshot.

UI phân biệt rõ **Dự kiến** (candidate) và **Đã ghi** (receipt).

## 11. Audit, lesson, STOP

- **Bảng `event` append-only** (role Postgres của ứng dụng không có quyền UPDATE/DELETE trên bảng này): `id, workspace/session/run/attempt/block, server_time, actor, type, phiên bản prompt/model/policy, input_hash, output_hash, rule_results, refs, prev_event_hash`. Chuỗi `prev_event_hash` cho phép kiểm toàn vẹn. Loại: `INPUT_LOCKED, JOB_RESULT, AGENT_CALL, GATE_RESULT, CANDIDATE_READY, AUDIT, APPROVAL, RELEASE_COMMITTED, ACKNOWLEDGED, STOP_RAISED, STOP_CLEARED, LESSON_DECIDED, IMPORT_COMMITTED, EXPORT_CREATED`.
- **AQ** (kiểm khi chạy) là code: kiểm quyền, schema, cổng ở mỗi block. **AU** (kiểm sau) chạy ở B8: phần xác định do code (thứ tự event, đủ nguồn, toàn vẹn hash, lỗi lặp); phần nội dung là tác vụ T12. Mỗi lô có ≥ 1 kết luận kiểm toán có căn cứ; số finding có thể bằng 0.
- **Finding**: `expected, observed, refs, impact, severity, reproduction, owner`.
- **Lesson**: `fingerprint, finding_refs, applies_when, proposed_change, repro_test, side_effect_test, status (PENDING | SAFE | APPLIED | REJECTED), decided_by`. Chỉ lesson người dùng xác nhận `SAFE` mới được nạp vào snapshot lượt sau.
- **STOP**: finding mức nghiêm trọng theo policy → `workspace.stop_state`. Khi STOP: không tạo job mới ở cả hai nhánh; commit bị chặn (kiểm lại trong giao dịch); job đang chạy được kết thúc nhưng output chỉ nằm trong draft. **Mở lại** cần lý do + tham chiếu lesson đã xử lý.
- Xu hướng lỗi: số lỗi mới và lỗi lặp / số cơ hội kiểm cùng loại; dưới số mẫu tối thiểu → "Chưa đủ dữ liệu để đánh giá xu hướng".

## 12. Quyền và an toàn (không đăng nhập)

- Không có tài khoản, mật khẩu, cookie phiên. Mọi request thuộc tác nhân `local`; trường `actor`, `decided_by`, `submitted_by` ghi `local`.
- **Compose chỉ mở cổng web trên `127.0.0.1`.** Vì không có xác thực, mở ra mạng đồng nghĩa ai cũng duyệt, xuất được dữ liệu và tiêu được hạn mức Claude của bạn. Khi triển khai lên máy chủ trước khi có đăng nhập, phải đặt sau một lớp xác thực bên ngoài (VPN hoặc reverse proxy có xác thực); README nêu rõ điều này.
- Bốn quyền `VIEW`, `OPERATE`, `APPROVE`, `BACKUP_ADMIN` vẫn là hằng số trong mã; mọi route gọi `requirePermission(actor, quyền)`. Tác nhân `local` mặc định có đủ bốn. Biến `LOCAL_ACTOR_PERMISSIONS` cho phép thu hẹp (ví dụ chỉ `VIEW`) để kiểm A09 và làm nền cho đăng nhập sau này.
- Các quyết định của "người có quyền" trong YC (duyệt công bố, xác nhận lesson, mở lại sau STOP) là thao tác riêng trên UI, bắt buộc nhập lý do, không bao giờ do agent hay job tự thực hiện.
- Bí mật của hệ thống: mật khẩu Postgres và token Claude CLI của worker, đều chỉ ở `.env` phía server. Export và log được test quét để không chứa hai giá trị này, đường dẫn tuyệt đối hay biến môi trường.
- Server từ chối ghi vào registry Live mọi bản ghi `synthetic: true` hoặc nguồn `seed://` (A09), không có ngoại lệ.
- Lỗi API: `{ code, message, details, attempt_id?, actions[] }`; UI ánh xạ `actions` thành nút.

## 13. Export / Import

Ba loại, đúng YC §9: `framework` (một file JSON), `dictionary` (ZIP), `backup` (ZIP). Bố cục ZIP và manifest theo YC §9.1, `schema_version: "1.0.0"`. Backup thêm `runs/agent_calls.jsonl` và `runs/agent_results.jsonl`, nên lượt khôi phục ở môi trường khác phát lại được mà không gọi lại agent.

- Dựng trong một giao dịch đọc để có snapshot nhất quán.
- Tùy chọn: bỏ nội dung JD (`metadata_only`, manifest liệt kê refs đã lược), bao gồm blob gốc, phạm vi phiên.
- Không xuất đường dẫn tuyệt đối hay thông tin môi trường máy.
- `README.md` trong gói mô tả cách đọc độc lập, quy ước offset và đoạn, quy tắc `id@version`.

**Import** hai pha:

1. **Preview** (không ghi): giải nén vào staging; chặn zip-slip/đường dẫn tuyệt đối/vượt kích thước; kiểm `schema_version` (mới hơn → `UNSUPPORTED_SCHEMA_VERSION` nêu đúng version), checksum, schema, ID trùng, ref thiếu, lineage release. Trả counts, duplicates, conflicts, phần nguồn bị lược, nhánh lịch sử khôi phục được và `preview_digest`.
2. **Commit** (cần `preview_digest` khớp): một giao dịch. Hai chế độ: `RESTORE_EMPTY` (workspace rỗng, giữ nguyên ID/version) và `REAPPLY` (cùng bundle vào workspace đã nhập → 0 thay đổi). Cùng `id@version` khác nội dung → `CONTENT_CONFLICT`, chặn toàn bộ. Hash sai hoặc ref bắt buộc thiếu → chặn.

## 14. API (route handlers, tiền tố `/api`)

| Thao tác YC §10 | Endpoint |
| --- | --- |
| Tạo phiên | `POST /sessions` |
| Preview / xác nhận bộ JD | `POST /sessions/:id/jd-sets/preview`, `POST /sessions/:id/jd-sets` |
| Tạo lượt | `POST /sessions/:id/runs` |
| Chạy block / retry | `POST /runs/:id/blocks/:block/attempts` (header `Idempotency-Key`; tùy chọn `rerun_tasks[]`) |
| State / event | `GET /runs/:id`, `GET /runs/:id/events?cursor=` |
| Con trỏ xem / Đã hiểu | `PUT /runs/:id/blocks/:block/cursor`, `POST /runs/:id/blocks/:block/ack` |
| Review / công bố | `POST /candidates/:id/decision`, `POST /candidates/:id/commit` (`expected_base_release_id`) |
| Export | `POST /exports`, `GET /exports/:id/download` |
| Import | `POST /imports/preview`, `POST /imports/:id/commit` |
| STOP / mở lại / SAFE | `POST /workspace/stop`, `POST /workspace/reopen`, `POST /lessons/:id/decision` |
| Đọc từ điển | `GET /releases`, `GET /releases/:id/{graph,competencies,frameworks}` |
| Tình trạng agent | `GET /agents/status` (CLI có/không, phiên bản, bảng cấu hình tác vụ) |

Tiến độ job: client poll `GET /runs/:id/events?cursor=` mỗi 1,5 giây khi có block `Đang tính`.

## 15. Kiểm thử và nghiệm thu

| Tầng | Công cụ | Nội dung |
| --- | --- | --- |
| Unit | Vitest | Engine demo ra đúng mọi số YC §11; catalog 36/134/3 role; coverage, P/R/F1, trung vị, Jaccard, mẫu số 0; chuẩn hóa, tách đoạn, offset; `input_canonical` và `task_key` ổn định; sinh trace xác định |
| Tích hợp | Vitest + Postgres thật (container) | Commit nguyên khối, conflict base, idempotency, STOP chặn ghi, export→import round-trip, sửa 1 byte bị chặn, `CONTENT_CONFLICT`; bộ nhớ kết quả (chạy lại = 0 lời gọi) |
| E2E | Playwright + **CLI giả** qua `CLAUDE_BIN` | A01–A04, A06–A09. CLI giả trả output theo fixture và tiêm được lỗi (thoát khác 0, sai schema, treo quá timeout). Fixture chỉ nằm trong thư mục test |
| Live thật | `pnpm verify:live` | A05: hai bộ JD khác nội dung cùng role, gọi Claude CLI thật; khẳng định số `agent_call` không lấy từ bộ nhớ > 0, mọi đoạn trích tồn tại nguyên văn trong snapshot, output hai phiên khác nhau |
| Ổn định | `pnpm verify:stability` | §9.3: mỗi tác vụ 3 lần, báo tỷ lệ trùng khớp |

Mỗi mã A01–A09 thành một file test E2E cùng tên. A05 thêm hai kịch bản: `CLAUDE_BIN` trỏ tới file không tồn tại (UI khóa chạy Live, hiện hướng dẫn) và CLI giả trả sai schema (UI giữ bản nháp, hiện mã lỗi + nút Thử lại).

**Bàn giao (YC §1.6):** mã nguồn; `README.md` (cài Claude CLI, chạy local); `.env.example`; `docs/bundle-format.md`; `docs/agent-tasks.md` (prompt, schema, model, effort từng tác vụ); bộ test trên.

## 16. Đã chốt qua review và giả định còn lại

**Đã chốt:**

| Chủ đề | Kết luận |
| --- | --- |
| Example | Không dùng AI; mô phỏng xác định, chuyển từ mã tham chiếu |
| Live | Bước cần agent gọi Claude CLI; công thức và phép đếm do code tính |
| Model và effort | Theo bảng §9.4, do bên triển khai chọn và hiệu chỉnh bằng `verify:stability` |
| B4 | Làm cả hai: kiểm sự kiện thật và đề xuất sự kiện giả thuyết |
| Hạ tầng | PostgreSQL + Docker Compose; sẵn sàng `pgvector` nhưng chưa vector hóa |
| Đăng nhập | Chưa cần |
| Website tham chiếu | Được lấy phần truy cập công khai; đã lưu ở `docs/reference/site-v8/` |

**Giả định tôi tự đặt — sửa nếu sai:**

| # | Giả định | Căn cứ |
| --- | --- | --- |
| G1 | **Nguồn JD của Live là danh sách cố định do người dùng dán hoặc tải lên.** Hệ thống không tự thu thập JD từ web. | Tôi hiểu như vậy từ câu trả lời của bạn cho Q1/Q4; khớp với D10. |
| G2 | **Ngưỡng policy Live** (`min_coverage 0,8`, `min_item_agreement 2/3`, STOP khi finding `CRITICAL`) là mặc định kỹ thuật, chưa có SOP nghiệp vụ; UI gắn nhãn "chưa duyệt nghiệp vụ". | Chưa nhận được SOP. Example giữ ngưỡng của mã tham chiếu (6 JD, coverage 1, đồng thuận 0,7). |
| G3 | Mã ở `docs/reference/site-v8/` là bản cần tái tạo, dù chưa xác nhận được nó trùng commit `3e515bc…`. | Đó là bản đang chạy tại URL nêu trong YC. |
| G4 | File JD gốc được giữ đến khi người dùng xóa; có tùy chọn chỉ lưu text. | Chưa có chính sách lưu trữ. |
| G5 | Token Claude CLI cho container worker tạo bằng `claude setup-token`; cần một gói Claude có hạn mức đủ cho khoảng 48 lời gọi mỗi lượt 8 JD. | §9.2, §9.5. |

## 17. Thứ tự triển khai dự kiến (chi tiết hóa ở bước plan sau khi spec được duyệt)

1. **M1 — Example:** contract, engine demo, 7 màn hình, drawer từng nhịp, đồ thị 2D/3D → A01, A02, A03.
2. **M2 — Phiên và JD:** Compose + Postgres, phiên, ingest, tách đoạn, preview, revision → A04.
3. **M3 — Agent:** image worker có Claude CLI, `ClaudeCliRunner`, bộ nhớ kết quả, 13 tác vụ với prompt/schema, CLI giả, `verify:stability`.
4. **M4 — Live B0–B8:** job, phần code của từng block, trace, cổng, nhánh nhanh → A05.
5. **M5 — Registry:** draft, candidate, duyệt, commit, conflict, audit/lesson/STOP → A06, A07.
6. **M6 — Export/Import** → A08.
7. **M7 — Kiểm quyền cục bộ, quét rò rỉ, tài liệu bàn giao, chạy đủ A01–A09** → A09.

## 18. Sai khác giữa bản triển khai và spec (cập nhật sau khi code xong)

Phần này ghi những chỗ mã nguồn khác với các mục phía trên. Khi hai bên mâu thuẫn, mã nguồn và mục này là hiện trạng.

| # | Mục spec | Hiện trạng trong code | Lý do |
| --- | --- | --- | --- |
| S1 | §5 bảng từ điển tách theo loại | Một bảng `dict_record` (`kind` = W/C/I/R/V/G, khóa `id + version`), cộng `release`, `candidate`, `finding`, `lesson` | Mọi loại cùng vòng đời bất biến theo phiên bản; một bảng làm commit nguyên tử và export/import đơn giản hơn |
| S2 | §5 sự kiện thật | Bảng `user_event` gắn với phiên; khóa vào snapshot khi tạo lượt | Sự kiện thêm sau khi tạo lượt chỉ có hiệu lực từ lượt kế tiếp |
| S3 | §5 | Thêm bảng `worker_status` (một dòng heartbeat) | Web không gọi CLI; nó đọc heartbeat của worker để khóa nút chạy Live kèm hướng dẫn |
| S4 | §6 TraceEvent | Thêm trường `draft` (giá trị đang nháp) và `record_refs` (bản ghi mà beat đang đọc) | Bộ xem từng beat cần chúng để hiện "đang đọc gì" |
| S5 | §9 B4 | Giả thuyết do agent đề xuất (T13) chỉ nằm trong output của lượt, **không** ghi vào từ điển và không tính là bằng chứng | Tránh để nội dung chưa kiểm chứng đi vào lõi |
| S6 | §9 B6 | Năng lực có chỉ báo không đạt đồng thuận bị **loại khỏi lượt** (ghi rõ lý do), các năng lực còn lại đi tiếp; B7 mới là cổng chặn theo coverage | Một chỉ báo kém không nên chặn cả khung |
| S7 | §4, §7 `position` ở Live | Bằng số block đã ĐẠT của lượt hiện tại | Live không có "con trỏ" mô phỏng như Example |
| S8 | §4 catalog ở Live | Lấy từ các khung đã công bố; `score`, `frequency`, `core` để 0/false và UI ghi "chưa có công thức importance/criticality" | Live chưa có dữ liệu importance/criticality; không bịa số |
| S9 | §14 API | Một route catch-all `app/api/[...path]` với bảng định tuyến ở `apps/web/lib/server/router.ts` | Giữ lớp API mỏng, kiểm quyền ở một chỗ |
| S10 | §15 M1.4 (so khớp từng số với engine tham chiếu bằng cách chạy JS gốc) | **Chưa làm.** Engine Example được chuyển tay sang TypeScript và kiểm bằng các số ở YC §11 (unit + E2E A01) | Môi trường không cho thực thi mã JS tải về |
| S11 | §15 | E2E chạy trên bản build production với Claude CLI giả (`tests/fake-claude/claude.mjs`); CLI thật chỉ được gọi bởi `pnpm verify:live` / `verify:stability` | Test phải tái lập được và không tốn token |
| S12 | §12 | Chưa có ESLint/Prettier; `pnpm lint` hiện chỉ chạy typecheck. Chuỗi giao diện tiếng Việt nằm trong component, chưa gom về một file | Ưu tiên chức năng và kiểm thử |
| S13 | §9.5 ước lượng số lời gọi | Lượt thật 2 JD mẫu: 37 lời gọi CLI, khoảng 2 phút (đo ngày 2026-11-16 bằng `pnpm verify:live`) | Số đo thực tế thay cho ước lượng |
| S14 | §9.3 `task_key` | `canonicalJson` chỉ sắp xếp khóa object, **không** sắp xếp mảng; khóa có thêm `system_sha` (hash system prompt) | Thứ tự mảng do code dựng một cách xác định (theo ID) trước khi gọi; thêm `system_sha` để đổi prompt là đổi khóa |
| S15 | §9.2 retry | Lỗi CLI tạm thời được thử lại **một** lần với độ trễ cố định (spec ghi hai lần có back-off) | Đủ cho lỗi thoáng qua; lỗi kéo dài trả về UI để người dùng bấm Thử lại |
| S16 | §9.4 schema tác vụ | T5 không có `relation`, T7 không có `segment_ids`, T11 không có `level`; các giới hạn "tối đa N" được áp bằng cắt bớt trong bước chuẩn hóa. Chi tiết đúng theo code ở `docs/agent-tasks.md` | Rút gọn output để giảm bề mặt sai schema |
| S17 | §13 backup theo phạm vi phiên | Finding và lesson luôn được xuất ở cấp workspace (không lọc theo phiên); nhật ký sự kiện chỉ có trong backup toàn workspace | Lesson/STOP là trạng thái của cả workspace; chuỗi hash sự kiện không cắt theo phiên được |
| S18 | Biến môi trường | Không process nào tự nạp file `.env` ở gốc repo khi chạy trên máy (chỉ Docker Compose đọc); `pnpm dev`/`pnpm worker`/`pnpm db:migrate` dùng mặc định trong code trừ khi export biến trong shell | Xem README |
| S19 | §16 G1 (nguồn JD chỉ là dán/tải file), §9 (13 tác vụ) | Thêm nguồn thứ ba theo yêu cầu người dùng ngày 2026-11-16: **dataset công khai trên Hugging Face**. (1) Worker tải file Parquet của dataset về `<DATA_DIR>/datasets/` một lần (bảng `source_dataset`, ghi commit của dataset, giấy phép, số dòng; có "Cập nhật" và "Xóa"). (2) Người dùng chọn dataset đã tải và nêu vị trí bằng tiếng Việt hoặc tiếng Anh; worker chạy T14 (AI, sonnet/low) sinh từ khóa chức danh song ngữ → code lọc toàn bộ tiêu đề của bản cục bộ (không phân biệt dấu) → T15 (AI, haiku/medium, lô 120 chức danh) giữ chức danh đúng vị trí (bảng `source_search`). (3) Người dùng chọn tin (có "Chọn tất cả" trong giới hạn JD mỗi bộ); nội dung đọc từ bản cục bộ và đi qua đúng bước xem trước/xác nhận như JD dán tay. Mã: `packages/ingest/src/hf.ts`, `packages/pipeline/src/source-search.ts`, API `/api/sources/{datasets,searches,rows}` | AI lọc theo tiêu đề (người dùng chốt). Ở bước quét chỉ tên vị trí và danh sách chức danh được gửi tới AI. Giới hạn: 1.200 chức danh khác nhau được duyệt, 400 tin hiển thị. Dataset đã tải không nằm trong gói export |
| S20 | §4, §7 (mỗi block chờ "Đã hiểu") | Thêm **chạy tự động** cho Live theo yêu cầu người dùng ngày 2026-11-16: bật khi tạo lượt (mặc định) hoặc bằng nút "Chạy tự động tới B8". Worker tự xác nhận block đạt (actor `auto`) và xếp block kế tiếp; tự dừng khi cổng chặn, lỗi, STOP, hoặc sau B8. Bảng `run_auto`, API `POST /api/sessions/:id/auto`, sự kiện `AUTO_STARTED`/`AUTO_STOPPED` | Tự động **không** quyết định hồ sơ và **không** ghi từ điển: dừng ở hồ sơ DỰ KIẾN (khung mới + thay đổi từ điển), người có quyền vẫn phải duyệt. Chế độ từng bước giữ nguyên |
