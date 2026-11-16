# Competence Lab — Kế hoạch triển khai

| | |
| --- | --- |
| Trạng thái | **Chờ duyệt — chưa viết mã** |
| Ngày | 2026-11-16 |
| Spec | `docs/specs/competence-lab-spec.md` (v3). Ký hiệu `§` trỏ tới spec, `YC` trỏ tới `docs/requirements/competence-lab-requirements.md`. |
| Mã tham chiếu | `docs/reference/site-v8/` — đã có bản kê chi tiết toàn bộ 12 file; plan này dựa trên bản kê đó. |
| Nhánh | `toantran.mei/feat-built-in` |

## 0. Cách làm việc

- **Thứ tự:** 8 mốc M0–M7. Mỗi mốc kết thúc bằng một trạng thái chạy được và các ca nghiệm thu nêu tên.
- **Commit:** mỗi việc (`M1.3`…) một commit, thông điệp bắt đầu bằng mã việc. Không push, không mở PR khi chưa được yêu cầu.
- **Test trước:** mỗi việc có cột "Xong khi" là test tự động; viết test cùng lúc với mã. `pnpm test` phải xanh trước khi sang việc sau.
- **Điểm dừng để bạn xem:** sau **M1** (bản Example chạy được trong trình duyệt), sau **M4** (một lượt Live thật qua Claude CLI), và sau **M7** (đủ A01–A09). Giữa các điểm đó tôi làm liên tục.
- **Phiên bản:** Node ≥ 22 (máy đang có 26), pnpm 10, Next.js 16, Drizzle ORM, Zod 4, Vitest, Playwright, PostgreSQL 17 (image có `pgvector`). Ghim phiên bản chính xác trong `package.json` ở M0.

## 1. Những điều bản kê mã tham chiếu làm thay đổi cách làm

| Phát hiện | Quyết định trong plan |
| --- | --- |
| Mã tham chiếu không dùng thư viện nào: 2D là SVG xếp cột tay, 3D là phép chiếu tự viết trên Canvas 2D | Chuyển nguyên, không thêm `d3`/`three.js` (spec D11 đã sửa) |
| Tên block, tên agent và công thức lệch nhau giữa `app.js` (`info`) và `production.js` | Lấy **`production.js`** làm chuẩn; `info` của `app.js` chỉ phục vụ phần giao diện đã ẩn |
| `app.js` còn vẽ một luồng cũ đã bị ẩn (`.legacy-flow`), và phần từ điển/khung bị `visuals.js` ghi đè | Không chuyển phần chết này |
| Từ điển ở bản gốc có 5 chế độ, trong đó "Thư viện liên ngành" chứa 4 tab con | Trải phẳng thành 7 tab đúng YC §2: Mạng 2D, Mạng node 3D, Ma trận liên ngành, So sánh vai trò, Truy vết nguồn, Phiên bản/diff, Dữ liệu chi tiết. Chế độ "Mạng quan hệ" W–R–C của phiên nằm trong màn Khung năng lực |
| Bản gốc ghi kết quả block khi tới nhịp cuối, không phải khi bấm **Đã hiểu** | Giữ đúng như vậy; khớp YC §2.1 ("Đã hiểu chỉ là xác nhận xem") |
| Trace của bản gốc: `{phase, title, formula, substitution, before, after, draft, refs, explanation, delta}` | Ánh xạ sang `TraceEvent` của spec §6; thêm `title` và `explanation` vào `TraceEvent` |
| Bấm bất kỳ card nào cũng mở ngăn xem trước dạng modal | Giữ (YC §2: "Chọn card để xem giải thích…"), xem trước không ghi gì |
| Lỗi nhỏ của bản gốc: nút chạy trong panel luôn chạy block hiện tại dù đang chọn block khác; "3/3 = 100%" và "9/12" viết cứng; công thức B5 ghi `sorted[2]` trong khi mã lấy phần tử giữa; tab mobile không có trạng thái đang chọn; xoay tự động và chế độ Tự động bỏ qua cài đặt giảm chuyển động | **Sửa** khi chuyển: nút chạy ghi rõ block sẽ chạy; số lấy từ dữ liệu; công thức ghi `median`; tab có `aria-selected`; tôn trọng giảm chuyển động |
| Phông tải từ Google Fonts; cuối `index.html` có script Cloudflare do quá trình tải về chèn vào | Tự lưu phông trong ứng dụng; bỏ script đó |
| Khóa lưu `competence-lab-v1` không có phiên bản lược đồ | Dùng `cl.example.v1.*` kèm số phiên bản; không đọc dữ liệu của khóa cũ |

## 2. Các mốc

### M0 — Khung dự án

| Việc | Nội dung | Xong khi |
| --- | --- | --- |
| M0.1 | Monorepo pnpm: `apps/web`, `apps/worker`, `packages/{contract,example,pipeline,agents,registry,bundle,ingest,db}`; TypeScript strict; ESLint + Prettier; Vitest; Playwright | `pnpm lint`, `pnpm test`, `pnpm build` chạy xanh trên khung rỗng |
| M0.2 | `apps/web` Next.js App Router, layout nền tối, token màu và phông `Be Vietnam Pro` tự lưu; file chuỗi `vi.ts` | Trang trống hiển thị đúng token ở §4.1 |
| M0.3 | `docker-compose.yml`: `postgres` (image có `pgvector`), `web`, `worker`, volume blob; `.env.example`; cổng web chỉ mở `127.0.0.1` | `docker compose up` lên được cả ba dịch vụ; `web` trả trang |
| M0.4 | `README.md` khung: chạy local, biến môi trường | — |

### M1 — Default Example → A01, A02, A03

Mọi thứ ở mốc này chạy trong trình duyệt, không cần Postgres hay Claude CLI.

| Việc | Nội dung | Nguồn chuyển | Xong khi |
| --- | --- | --- | --- |
| M1.1 | `packages/contract`: Zod cho `TraceEvent`, `GateResult`, trạng thái block, kiểu W/C/R/V/G của Example | §6 | Test kiểu + validate mẫu |
| M1.2 | `packages/example/engine.ts`: `seed()`, `initial()`, lớp `Lab` (`step`, `quick`, `approve`, `recover`, `nextRound`), nguyên logic | `engine.js` | Test số liệu YC §11 cho cả hai lượt: 8/11 JD; Σw 15/19; B3 7 ứng viên, P = 6/7; coverage 3→15/15; C04 bậc 3 rồi 4; lõi 1.0 (4 ADD, 2 UPDATE) và 1.1 (1 ADD, 1 UPDATE, 5 REUSE); pilot 9/12; hai lỗi mô phỏng chặn đúng B1 và B6 |
| M1.3 | `packages/example/catalog.ts`: bộ sinh, `filtered`, `summaries`, `compare` | `catalog.js` | Test: 5 họ, 10 role, 4 ngành, 21 C, 40 profile; 36 node / 134 cạnh; lọc Sản phẩm số + Tài chính = 3 role; tổng trọng số mỗi profile = 1; Jaccard |
| M1.4 | **Test đối chiếu** bản TS với `engine.js` và `catalog.js` gốc: nạp file gốc trong Vitest, chạy cùng kịch bản, so `deepEqual` | `docs/reference/site-v8/` | Kết quả hai bản trùng khớp. *Việc này chạy mã tải về từ website của bạn bên trong test; một lệnh tương tự của tôi đã bị chặn quyền hôm nay, nên có thể bạn sẽ được hỏi cấp phép.* |
| M1.5 | `packages/example/trace.ts`: dựng nhịp từng block và FAST, xuất `TraceEvent[]` | `calculation-trace.js` | Test: số nhịp và công thức từng block theo bản kê (B1: mỗi JD một nhịp + nhịp tổng; B5: gộp → khởi tạo mẫu số → từng nhiệm vụ → trung vị từng C; B6: mỗi C 1 nhịp soạn + 3 nhịp phiếu; …); B1 nhịp JD thứ hai hiện `1 + 1 = 2` |
| M1.6 | `packages/example/explain.ts`: đầu vào/đầu ra/phép tính/bàn giao từng block; `snapshot` tính thử trên bản sao | `production.js` (`explain`, `snapshot`, `names`, `agents`, `artifacts`) | Test `explain` cho B0–B8 và FAST |
| M1.7 | `packages/example/ledger.ts`: `begin`, `commit`, `acknowledge`, con trỏ nhịp | `step-guide.js` (`GuideLedger`) | Test: không mở hai block cùng lúc; commit đúng một lần; cổng FAIL vẫn chặn sau khi xác nhận |
| M1.8 | `ExampleSource` + lưu `localStorage` `cl.example.v1.*` có phiên bản lược đồ; interface `SessionSource` | `app.js` (persist/restore) | Test: tải lại khôi phục đúng trạng thái và con trỏ |
| M1.9 | Khung trang: sidebar 7 mục, thanh đầu (bộ chọn phiên, tình trạng, tiến độ, **Bắt đầu lại**), mobile ≤ 740px | `index.html`, `style.css` | E2E: điều hướng 7 mục; 375px không cuộn ngang toàn trang |
| M1.10 | Màn **Dây chuyền sản xuất**: card B0–B8, nhánh nhanh, panel chi tiết 4 phần, ba tab làm việc, bảng thử bỏ một C ở B5, nhật ký bàn giao, banner STOP, bộ chọn "Thử sự cố" | `production.js` (`renderProduction`) | E2E: chạy hết lượt 1; card đổi trạng thái; panel hiện đúng số |
| M1.11 | **Ngăn xem từng nhịp**: 3 cột / 3 tab mobile, Trước, Tiếp theo có xung sáng, Xem lại, Tự động 1×/2×, Đóng giữ tiến độ, Đã hiểu, giữ vị trí cuộn và tiêu điểm, giảm chuyển động | `step-guide.js` (`StepGuide`) | E2E **A02** đủ các ý |
| M1.12 | Màn **Dữ liệu đầu vào** (JD, nhiệm vụ, sự kiện, mở bản ghi) và **Audit và bài học** (finding, lesson, xác nhận An toàn, mở lượt 2, mở lại sau STOP) | `app.js` (`render`) | E2E: LL-001 xuất hiện sau lượt 1; lượt 2 chỉ mở khi đã An toàn |
| M1.13 | Màn **Khung năng lực**: bản đồ nhiệm vụ → C → chỉ báo, thanh bậc 1–5, so hai phiên bản, Xuất khung JSON | `visuals.js`, `knowledge-model.js` | E2E **A01**: xuất khung 1.0 sau khi chạy 1.1 vẫn cho C04 bậc 3 |
| M1.14 | Màn **Từ điển**: Mạng 2D, Ma trận, So sánh vai trò, bộ lọc, inspector | `ecosystem.js` | E2E: bộ lọc, mở ô ma trận, so sánh hai profile |
| M1.15 | **Mạng node 3D**: dựng tọa độ, chiếu phối cảnh, xoay/dịch/zoom, bàn phím, danh sách node, toàn màn hình | `network3d.js` | Test: 2D và 3D cùng tập node/cạnh/trọng số; E2E **A03** |
| M1.16 | Tab Truy vết nguồn, Phiên bản/diff, Dữ liệu chi tiết | `visuals.js` | E2E: từ chỉ báo đi tới JD nguồn; diff lượt 1 và 2 |
| M1.17 | Chạy đủ **A01, A02, A03**; đối chiếu bằng mắt với website tham chiếu ở 1440px và 375px | — | Ba file E2E xanh. **Điểm dừng 1.** |

### M2 — Phiên và JD (Live, chưa có AI) → A04

| Việc | Nội dung | Xong khi |
| --- | --- | --- |
| M2.1 | `packages/db`: bảng `workspace, session, document, document_version, segment, jd_set, jd_set_revision, evidence, run, block_attempt, job, event, view_cursor, agent_call, agent_result`; migration; role DB không có UPDATE/DELETE trên `event` | Migration chạy trên Postgres của Compose; test ràng buộc |
| M2.2 | `packages/ingest`: parser `.txt`, `.md`, `.pdf` có lớp text, `.docx`; chuẩn hóa `norm-v1`; tách đoạn `seg-v1`; hash; trùng byte; gần trùng; gợi ý email/số điện thoại | Test với bộ file mẫu, kể cả PDF không có text, file rỗng, lỗi mã hóa; offset theo code point đúng với tiếng Việt có dấu |
| M2.3 | `BlobStore` (volume) | Test ghi/đọc theo `sha256` |
| M2.4 | Tác nhân `local`, `requirePermission`, `LOCAL_ACTOR_PERMISSIONS`; khuôn lỗi API | Test: thu quyền còn `VIEW` thì route ghi trả `FORBIDDEN` |
| M2.5 | API phiên và bộ JD: tạo phiên, preview, xác nhận revision, sửa tạo revision mới | Test tích hợp |
| M2.6 | `LiveSource`; màn **Quản lý phiên**; wizard tạo phiên JD mới; bộ chọn phiên chuyển Example ↔ Live | E2E tạo phiên |
| M2.7 | Màn Dữ liệu đầu vào cho Live: dán, tải nhiều file, xem trước, cảnh báo, sửa metadata, loại thông tin cá nhân | E2E **A04** |
| M2.8 | Tạo lượt: khóa snapshot; ba lựa chọn tạo lượt mới; **Bắt đầu lại** = tạo lượt mới | Test: sửa JD sau khi khóa không đổi nội dung lượt cũ |

### M3 — Agent qua Claude CLI

| Việc | Nội dung | Xong khi |
| --- | --- | --- |
| M3.1 | `ClaudeCliRunner`: khởi chạy `claude -p` với bộ cờ ở §9.2, stdin, thư mục tạm rỗng, timeout, giới hạn 3 tiến trình, thử lại; đọc `structured_output`, usage, chi phí | Test với **CLI giả** (`CLAUDE_BIN`): thành công, thoát khác 0, sai schema, treo quá timeout |
| M3.2 | `input_canonical`, `task_key`, bộ nhớ kết quả `agent_result`, `rerun_no` | Test: cùng input → 0 lời gọi; đổi prompt/model/effort → gọi lại |
| M3.3 | Khuôn định nghĩa tác vụ: prompt hệ thống có phiên bản, schema input/output bằng Zod, model ID đầy đủ, effort; `config.ts` theo bảng §9.4 | Test: mọi schema có `additionalProperties: false`, không có trường số ngoài `level` |
| M3.4 | Viết 13 tác vụ T1–T13: prompt + schema + kiểm ID đoạn/ID tham chiếu sau khi nhận | Mỗi tác vụ có test với CLI giả: output hợp lệ được nhận; ID không có trong input bị loại |
| M3.5 | Image `worker` cài Claude CLI ở phiên bản ghim; `CLAUDE_CODE_OAUTH_TOKEN`; kiểm khi khởi động (có CLI, đúng phiên bản, không có `ANTHROPIC_API_KEY`); `GET /agents/status` | Trong container: `claude --version` chạy; thiếu token → trạng thái "chưa cấu hình" |
| M3.6 | `pnpm verify:stability`: mỗi tác vụ 3 lần trên bộ JD mẫu, báo tỷ lệ trùng khớp các trường quyết định | Có báo cáo; chỉnh prompt/schema/model cho tác vụ dưới ngưỡng. **Cần Claude CLI thật đã đăng nhập.** |

### M4 — Dây chuyền Live B0–B8 → A05

| Việc | Nội dung | Xong khi |
| --- | --- | --- |
| M4.1 | Worker + hàng đợi `job` (`SKIP LOCKED`); `block_attempt`; idempotency; retry và đánh dấu `STALE`; `event` có chuỗi hash | Test: bấm hai lần → một attempt; retry block *n* làm cũ block sau |
| M4.2 | Policy `jd-only-draft@1` là dữ liệu có phiên bản; bộ đánh giá cổng dùng chung | Test bốn trạng thái cổng, mẫu số 0 |
| M4.3 | B0, B1 (code + T1) | Test công thức `valid`, `traceRate`, origin group |
| M4.4 | B2 (T2, T3 + trọng số, khóa danh sách) | Test với CLI giả |
| M4.5 | B3 (T4, T5, `CandidateRetriever` bằng `pg_trgm`, T6, P/R/F1 khi có gold) và nhánh nhanh | Test: từ điển rỗng không gọi T6; nhánh nhanh chỉ ghi V |
| M4.6 | B4 (T7 cho sự kiện thật, T13 cho giả thuyết), nhập sự kiện thật trên UI | Test: giả thuyết không vào tử số phủ căn cứ |
| M4.7 | B5 (T8, coverage, nhiệm vụ hở, thử bỏ một C, T9 khi có rubric) | Test công thức |
| M4.8 | B6 (T10, gói ẩn đáp án, T11 ba ghế, vòng viết lại một lần) và B7 | Test: 2/3 = 66,7% không đạt ngưỡng 70% khi policy dùng ngưỡng đó |
| M4.9 | Sinh `TraceEvent` cho Live từ output đã lưu; API state/event/con trỏ/Đã hiểu; nối vào ngăn xem từng nhịp và màn Dây chuyền; huy hiệu Code / AI · model · effort | E2E một lượt Live với CLI giả; tải lại giữa block giữ con trỏ |
| M4.10 | Màn chốt trước khi chạy (dữ liệu gửi đi, tác vụ, số lời gọi dự kiến); trạng thái lỗi và nút Thử lại; khóa Live khi CLI không dùng được | E2E: `CLAUDE_BIN` sai → khóa + hướng dẫn; sai schema → giữ bản nháp |
| M4.11 | `pnpm verify:live`: hai bộ JD khác nội dung cùng role, CLI thật | **A05** đạt. **Điểm dừng 2.** |

### M5 — Từ điển, công bố, audit → A06, A07

| Việc | Nội dung | Xong khi |
| --- | --- | --- |
| M5.1 | Bảng W/C/R/V/G hai lớp (draft theo lượt, đã công bố theo release); quy tắc tăng phiên bản | Test: sửa chỉ báo không tăng phiên bản C; khung cũ vẫn đọc được |
| M5.2 | B8: dựng candidate diff, role bị ảnh hưởng, lý do ghép từ dữ liệu; kiểm toán xác định + T12 | Test ADD/UPDATE/REUSE |
| M5.3 | Duyệt (toàn gói hoặc bỏ mục) và commit nguyên khối: kiểm STOP, `expected_base_release_id`, idempotency, tham chiếu; receipt; khôi phục bằng release mới | Test: commit lại không nhân đôi; hai lượt cùng nền → `BASE_CHANGED` |
| M5.4 | Finding, lesson (chờ / An toàn / áp dụng), nạp lesson vào snapshot lượt sau; STOP và mở lại có lý do | Test: STOP chặn cả hai nhánh và chặn commit |
| M5.5 | Màn Từ điển, Khung năng lực, Audit đọc dữ liệu Live; cột Dự kiến / Đã ghi; catalog mẫu dưới nhãn "seed" | E2E **A06**: lượt hai dùng lại đúng một C chung, R riêng; diff và phiên bản cũ xem được |
| M5.6 | Chặn bản ghi `synthetic` / `seed://` vào registry Live | E2E **A07** và test chặn |

### M6 — Xuất và khôi phục → A08

| Việc | Nội dung | Xong khi |
| --- | --- | --- |
| M6.1 | `packages/bundle`: xuất khung JSON, gói từ điển, backup; manifest, checksum, schema, README trong gói; tùy chọn `metadata_only` và kèm blob | Test: manifest khớp file; gói không chứa bí mật hay đường dẫn tuyệt đối |
| M6.2 | Nhập thử: chống zip-slip, kiểm phiên bản lược đồ, checksum, ID trùng, ref thiếu, lineage; báo cáo + `preview_digest` | Test: sửa một byte → chặn; phiên bản lạ → báo đúng số |
| M6.3 | Áp dụng: `RESTORE_EMPTY`, `REAPPLY`; `CONTENT_CONFLICT` chặn toàn bộ | Test khứ hồi và idempotency |
| M6.4 | Màn **Xuất và khôi phục** | E2E **A08** với bộ Compose thứ hai: so số đếm, ID/phiên bản, hash, đồ thị; chạy lượt mới kế thừa C đã khôi phục |

### M7 — Hoàn thiện và bàn giao → A09

| Việc | Nội dung | Xong khi |
| --- | --- | --- |
| M7.1 | E2E **A09**: phiên mẫu không vào từ điển Live; quyền `VIEW` không duyệt, không tải backup; quét log và export | Xanh |
| M7.2 | Rà giao diện: mobile, bàn phím, tiêu điểm, giảm chuyển động, thông báo lỗi | Danh sách rà không còn mục mở |
| M7.3 | Tài liệu: `README.md` đầy đủ, `.env.example`, `docs/bundle-format.md`, `docs/agent-tasks.md` | — |
| M7.4 | Chạy đủ A01–A09 trên bản Compose sạch | Bảng kết quả nghiệm thu. **Điểm dừng 3.** |

## 3. Phụ thuộc

```text
M0 → M1 ───────────────────────────────┐
M0 → M2 → M3 → M4 → M5 → M6 ───────────┴→ M7
```

M1 không phụ thuộc M2–M6. M3 chỉ cần M2.1 (bảng `agent_call`, `agent_result`). Giao diện Live ở M4.9 và M5.5 dùng lại các thành phần của M1.

## 4. Ánh xạ nghiệm thu

| Mã | Mốc | Việc chốt |
| --- | --- | --- |
| A01 | M1 | M1.2, M1.13, M1.17 |
| A02 | M1 | M1.11 |
| A03 | M1 | M1.14, M1.15 |
| A04 | M2 | M2.7, M2.8 |
| A05 | M4 | M4.10, M4.11 |
| A06 | M5 | M5.5 |
| A07 | M5 | M5.3, M5.4, M5.6 |
| A08 | M6 | M6.4 |
| A09 | M7 | M7.1 |

## 5. Những thứ cần từ bạn

| Khi nào | Cần gì |
| --- | --- |
| M1.4 | Cho phép test nạp và chạy `engine.js`, `catalog.js` tải về từ website của bạn. Nếu không, tôi thay bằng số liệu kỳ vọng viết tay theo YC §11. |
| M3.6, M4.11 | Claude CLI đã đăng nhập trên máy này (đang có sẵn) và chấp nhận tiêu hạn mức: khoảng 48 lời gọi cho mỗi lượt 8 JD, và 3 lần mỗi tác vụ cho phép đo độ ổn định. |
| M3.5 | Một token từ `claude setup-token` đặt vào `.env` để chạy worker trong Docker. Trước đó tôi chạy worker thẳng trên máy. |
| M4.11 | Hai bộ JD thật khác nội dung cho cùng một role. Nếu chưa có, tôi tự soạn hai bộ JD mẫu và ghi rõ là mẫu. |

## 6. Rủi ro

| Rủi ro | Cách xử lý |
| --- | --- |
| Kết quả agent khác nhau giữa các lần gọi mới | Bộ nhớ kết quả bảo đảm chạy lại cho kết quả cũ; `verify:stability` đo và chỉnh trước M4; schema đóng thu hẹp chỗ có thể lệch |
| Cờ hoặc định dạng output của Claude CLI đổi theo phiên bản | Ghim phiên bản CLI trong image; worker kiểm phiên bản khi khởi động; toàn bộ lời gọi đi qua một lớp `ClaudeCliRunner` |
| Hạn mức gói Claude không đủ cho nhiều lượt | Màn chốt hiện số lời gọi dự kiến; ngân sách lời gọi mỗi lượt; hạ T10 xuống sonnet là phương án dự phòng |
| M1 lớn (17 việc, phần lớn là giao diện) | Chuyển theo từng file gốc, có test đối chiếu; điểm dừng 1 để bạn xem sớm |
| Không có đăng nhập mà vẫn triển khai lên máy chủ | Compose chỉ mở `127.0.0.1`; README yêu cầu đặt sau lớp xác thực bên ngoài |
| Mã tải về có thể không trùng commit `3e515bc…` | Test số liệu theo YC §11 là chuẩn cuối cùng; lệch thì YC thắng |
