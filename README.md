# Competence Lab

Competence Lab là ứng dụng web biến một bộ mô tả công việc (JD) thành **bản nháp khung năng lực** qua dây chuyền 9 block (B0–B8) cùng một nhánh giao thử nhanh (FAST).

- Phiên **Default Example** chạy hoàn toàn trong trình duyệt với dữ liệu seed tổng hợp, không gọi AI.
- Phiên **Live** chạy phía server và chỉ gọi AI **qua Claude CLI (`claude -p`), không bao giờ gọi Anthropic API trực tiếp**.
- Mọi phép đếm, công thức, tỷ lệ và cổng (gate) đều là code thường; agent chỉ trả lời các câu hỏi ngữ nghĩa hẹp với output JSON đóng.

> ## CẢNH BÁO AN TOÀN — đọc trước khi chạy
>
> - **Chưa có đăng nhập.** Mọi request đều là tác nhân duy nhất `local`. Ai truy cập được cổng web đều duyệt công bố, xuất dữ liệu và tiêu được hạn mức Claude của bạn.
> - Web dev (`pnpm dev`) và cổng web trong Docker Compose chỉ mở trên `127.0.0.1`. **Không mở ra mạng** khi chưa đặt sau một proxy/VPN có xác thực. `pnpm start` cũng bind `127.0.0.1` theo mặc định; chỉ container đặt `HOST=0.0.0.0` (cổng vẫn được publish trên loopback).
> - Biến `LOCAL_ACTOR_PERMISSIONS` thu hẹp quyền của `local` (danh sách phân tách bằng dấu phẩy trong `VIEW`, `OPERATE`, `APPROVE`, `BACKUP_ADMIN`; không đặt = đủ cả bốn). Xem `packages/pipeline/src/auth.ts`.
> - Khi các block có AI chạy, **nội dung JD và các sự kiện bạn nhập được gửi tới Anthropic qua Claude CLI** bằng tài khoản đang đăng nhập trên máy chạy worker. UI yêu cầu xác nhận rõ ràng trước khi tạo lượt; API từ chối tạo lượt nếu thiếu `acknowledge_send` (lỗi `CONFIRM_REQUIRED`).

## Yêu cầu

| Thành phần | Phiên bản / ghi chú |
| --- | --- |
| Node.js | >= 22 (`engines` trong `package.json`) |
| pnpm | 10 (`packageManager: pnpm@10.13.1`) |
| Docker | để chạy Postgres (`pgvector/pgvector:pg17`) |
| Claude Code CLI | cài và **đã đăng nhập** trên máy chạy worker; phiên bản tối thiểu là `MIN_CLI_VERSION` trong `packages/agents/src/runner.ts` (hiện `2.1.0`) |

## Chạy trên máy

```sh
pnpm install
cp .env.example .env          # Docker Compose đọc file này
pnpm db:up                    # Postgres tại 127.0.0.1:5570
pnpm db:migrate               # chạy migration bằng role cl_owner, cấp quyền cho cl_app
pnpm dev                      # web: http://127.0.0.1:3100
pnpm worker                   # ở terminal thứ hai
```

- **Worker là tiến trình duy nhất gọi Claude CLI.** Nó lấy job từ Postgres, chạy từng lần chạy block và ghi heartbeat (kèm kết quả `claude --version`).
- Khi worker chưa chạy, heartbeat quá 90 giây, không tìm thấy CLI hoặc CLI cũ hơn mức tối thiểu, UI **khóa nút chạy Live** và hiện hướng dẫn; API trả `AGENT_CLI_UNAVAILABLE`. Default Example vẫn chạy bình thường. Không có fallback sang dữ liệu seed.
- Code không tự nạp file `.env` cho các tiến trình chạy trên host (`pnpm dev`, `pnpm worker`, `pnpm db:migrate`): chúng dùng giá trị mặc định trong code (trùng với `.env.example`). Muốn đổi thì export biến trong shell trước khi chạy.

## Đăng nhập Claude CLI

- **Trên host:** chạy `claude` một lần và đăng nhập. Worker dùng luôn phiên đăng nhập đó.
- **Trong Docker:** chạy `claude setup-token` trên máy có tài khoản, dán token vào `CLAUDE_CODE_OAUTH_TOKEN` trong `.env`. Chỉ container `worker` nhận biến này (xem `docker-compose.yml`).
- **Không đặt `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` cho worker**: CLI sẽ ưu tiên chúng hơn phiên đăng nhập. Để chắc chắn, runner xóa hai biến này khỏi môi trường của tiến trình con (`ClaudeCliRunner.env()` trong `packages/agents/src/runner.ts`); worker in cảnh báo khi khởi động nếu thấy chúng được đặt.

## Docker

```sh
docker compose --profile app up --build
```

`docker-compose.yml` có bốn service: `postgres` (luôn có), và `migrate`, `web`, `worker` thuộc profile `app`. Ba service sau build từ `docker/Dockerfile` với target `runner`. `web` publish `127.0.0.1:${WEB_PORT:-3100}:3100`; `web` và `worker` dùng chung volume `appdata` gắn tại `/data`.

## Biến môi trường

Biến trong `.env.example`:

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `POSTGRES_PORT` | `5570` | Cổng host của Postgres (Compose, chỉ trên 127.0.0.1) |
| `POSTGRES_OWNER_PASSWORD` | `cl_owner_dev` | Mật khẩu role `cl_owner` (Compose) |
| `POSTGRES_APP_PASSWORD` | `cl_app_dev` | Mật khẩu role `cl_app` (Compose): service `migrate` đặt lại mật khẩu này cho role, `web`/`worker` dùng nó trong `DATABASE_URL` |
| `DATABASE_URL` | `postgres://cl_app:cl_app_dev@127.0.0.1:5570/competence_lab` | Kết nối của web + worker (role ít quyền) |
| `DATABASE_OWNER_URL` | `postgres://cl_owner:cl_owner_dev@127.0.0.1:5570/competence_lab` | Chỉ dùng cho `pnpm db:migrate` |
| `DATA_DIR` | `./data` | Thư mục lưu blob (file gốc tải lên, gói export/import), tính theo thư mục làm việc của tiến trình web |
| `WEB_PORT` | `3100` | Cổng host của `web` trong Compose |
| `LOCAL_ACTOR_PERMISSIONS` | đủ bốn quyền | Quyền của tác nhân `local` |
| `CLAUDE_BIN` | `claude` | Đường dẫn CLI; test trỏ vào file thực thi giả |
| `CLAUDE_CODE_OAUTH_TOKEN` | rỗng | Token từ `claude setup-token`, chỉ cần khi worker chạy trong Docker |
| `AGENT_TIMEOUT_MS` | `180000` | Timeout một lời gọi CLI; quá hạn thì kill tiến trình |
| `AGENT_MAX_PARALLEL` | `3` | Số tiến trình CLI chạy song song tối đa |
| `AGENT_MAX_CALLS_PER_RUN` | `400` | Ngân sách lời gọi thật (không tính cache) của một lượt |
| `AGENT_MAX_INPUT_CHARS` | `120000` | Độ dài tối đa input chính tắc của một tác vụ |
| `MAX_FILES` | `20` | Số tài liệu tối đa mỗi lần tải |
| `MAX_FILE_MB` | `10` | Dung lượng tối đa mỗi file |
| `MAX_CHARS_PER_DOC` | `60000` | Số ký tự tối đa mỗi tài liệu |

Biến khác được đọc trong code (không có trong `.env.example`):

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `WORKER_POLL_MS` | `700` | Thời gian nghỉ của worker khi không có job |
| `WORKER_HEARTBEAT_MS` | `20000` | Chu kỳ ghi heartbeat của worker |
| `AGENT_RETRY_DELAY_MS` | `1500` | Thời gian chờ trước lần thử lại lỗi CLI tạm thời |
| `CL_MIGRATIONS_DIR` | tự tìm `packages/db/migrations` | Thư mục migration khi không dò được từ thư mục làm việc |
| `CL_APP_ROLE` | `cl_app` | Role được cấp quyền sau migration |
| `TEST_DATABASE_URL`, `TEST_DATABASE_OWNER_URL` | DB `competence_lab_test` trên cổng 5570 | Chỉ dùng cho test tích hợp |
| `E2E_PORT` | `3111` | Cổng web của Playwright |
| `FAKE_CLAUDE_*` | — | Chỉ có nghĩa với CLI giả trong `tests/fake-claude/claude.mjs` |

## Kiểm thử

| Lệnh | Nội dung |
| --- | --- |
| `pnpm typecheck` | `tsc` cho toàn repo và cho `apps/web` |
| `pnpm test:unit` | Vitest project `unit` (`packages/*/src/**/*.test.ts`, `tests/unit/`) |
| `pnpm test:int` | Vitest project `integration`. **Cần Postgres đang chạy**; dùng DB `competence_lab_test` và CLI giả `tests/fake-claude/claude.mjs` |
| `pnpm e2e` | Playwright. Build web, chạy nó ở cổng 3111, thêm một bản chỉ có quyền `VIEW` ở cổng 3112 và một worker; tất cả dùng CLI giả và DB test (xem `playwright.config.ts`). Lần đầu cần `pnpm exec playwright install chromium` |

Không lệnh nào ở trên gọi model thật.

Hai script **gọi Claude CLI thật (tốn token, gửi 2 JD mẫu tự soạn tới Anthropic)**, chạy trên DB `competence_lab_test` (xóa sạch DB này trước khi chạy):

- `pnpm verify:live [--upto=B8]`: chạy một phiên Live qua CLI thật và in kết quả từng block, số lời gọi, thời gian. `--upto=B1` là phép thử rẻ (2 lời gọi nhỏ).
- `pnpm verify:stability [--runs=3] [--upto=B3]`: lặp lại cùng một lượt N lần từ cache rỗng và báo mức trùng nhãn năng lực ứng viên ở B3 giữa các lần.

## Cấu trúc repo

| Thư mục | Nội dung |
| --- | --- |
| `apps/web` | Ứng dụng Next.js: giao diện và toàn bộ API dưới `/api` (`lib/server/router.ts`) |
| `apps/worker` | Tiến trình worker: poll job, chạy block, ghi heartbeat; nơi duy nhất gọi CLI |
| `packages/contract` | Kiểu dùng chung, hợp đồng view/trace, `AppError`, `canonicalJson`, hằng số quyền |
| `packages/example` | Engine xác định của Default Example: dữ liệu seed, catalog, trace, giải thích, mô hình tri thức |
| `packages/db` | Client Postgres (Drizzle), schema, migration, nhật ký sự kiện append-only có chuỗi hash |
| `packages/ingest` | Nhập JD bằng code: parse `.txt/.md/.pdf/.docx`, chuẩn hóa, tách đoạn, kho blob theo sha256 |
| `packages/agents` | 13 tác vụ agent (T1–T13), cấu hình model/effort, runner Claude CLI, `runTask` có bộ nhớ kết quả |
| `packages/pipeline` | Dây chuyền Live B0–B8 + FAST, phiên/lượt, runtime job, policy, quyền |
| `packages/registry` | Từ điển W/C/I/R/V/G: release, commit hồ sơ ứng viên, khôi phục, STOP và lesson |
| `packages/bundle` | Export (framework JSON, dictionary, backup) và import hai pha |
| `tests/` | `integration/` (Vitest + Postgres), `e2e/` (Playwright), `fake-claude/` (CLI giả), `unit/` |
| `docs/` | `specs/` (đặc tả), `requirements/`, `plans/`, `reference/`, cùng hai tài liệu bên dưới |
| `docker/` | `initdb.sql` (tạo role `cl_app`, extension, DB test) và `Dockerfile` của ứng dụng |

## Giới hạn đã biết

- Chưa có đăng nhập; một tác nhân `local` duy nhất.
- PDF phải có lớp văn bản: không OCR. PDF scan bị từ chối với cảnh báo `PDF_NO_TEXT`.
- Các ngưỡng của Live (`min_coverage` 0,8; `min_item_agreement` 2/3; STOP khi finding `CRITICAL`) là mặc định kỹ thuật, mang nhãn "chưa duyệt nghiệp vụ".
- Kết quả Live là **bản nháp nội bộ** (`publish_scope: internal_draft`), không phải bằng chứng nghề nghiệp đã được kiểm chứng; lớp dịch ngược là sàng lọc bằng AI, không thay reviewer người.
- Output của LLM không lặp lại từng bit; xem phần giới hạn trong `docs/agent-tasks.md`.

Tài liệu liên quan:

- [`docs/specs/competence-lab-spec.md`](docs/specs/competence-lab-spec.md) — đặc tả kỹ thuật
- [`docs/agent-tasks.md`](docs/agent-tasks.md) — danh mục tác vụ agent
- [`docs/bundle-format.md`](docs/bundle-format.md) — định dạng gói export/import
