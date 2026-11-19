# Triển khai igo-lab.toantranmei.com

Cùng mô hình với ai-factory và bee-we-go: push `main` → GitHub Actions build image → GHCR → Coolify (máy `84.247.146.53`)
kéo image, Traefik của Coolify cấp HTTPS (Let's Encrypt).

```
git push main
   │
   ▼
GitHub Actions (.github/workflows/ci.yml)
   ├─ image    docker build (docker/Dockerfile, target runner) → ghcr.io/toantranmei/igo-lab:<sha> + sha-<7> + main
   └─ deploy   scripts/coolify-deploy.mjs, API Coolify, các app có tag `igo-lab`:
        1. igo-lab-web     (ROLE=web: chạy migration rồi phục vụ :3100) → chờ /api/health báo đúng sha
        2. igo-lab-worker  (ROLE=worker: gọi Claude CLI)                 → chờ deployment xong
```

Một image cho cả hai tiến trình; biến `ROLE` chọn vai (`docker/start.sh`). Web luôn lên trước worker, nên worker
không bao giờ chạy trên schema cũ.

## Cấu hình một lần

### 1. DNS (Cloudflare, zone toantranmei.com)

Bản ghi `A igo-lab → 84.247.146.53`, **DNS only** (như toantranmei.com và beewego.com).

### 2. GitHub (repo `toantranmei/igo-lab`, private)

| Mục | Giá trị |
|---|---|
| Secret `COOLIFY_TOKEN` | Token Coolify quyền `read` + `deploy`, tạo bằng tài khoản admin/owner của team (bước 3.8) |
| Secret `PRODUCTION_BASIC_AUTH` | `user:mật-khẩu` của basic auth (bước 3.6), để job deploy đọc được `/api/health` |
| Variable `COOLIFY_URL` | URL gốc của Coolify (trang đăng nhập), không kèm `/api/v1` |
| Variable `PRODUCTION_URL` | `https://igo-lab.toantranmei.com` |

Thiếu `COOLIFY_TOKEN` hoặc `COOLIFY_URL` thì job `deploy` bỏ qua (xanh), image vẫn được đẩy lên GHCR.

### 3. Coolify: project mới `igo-lab`, environment `production`

1. **Postgres**: + New → Database → PostgreSQL, **image `pgvector/pgvector:pg17`** (cần extension `vector`), database
   `competence_lab`. Bật Backups (lịch hằng ngày). Ghi lại *Postgres URL (internal)* của superuser.
2. **Khởi tạo một lần**: mở Terminal của Postgres, `psql -U <superuser> -d competence_lab`, chạy
   `docker/coolify-db-init.sql` sau khi thay mật khẩu (`openssl rand -hex 32`). Script tạo role `cl_app` (quyền tối
   thiểu cho web và worker) và hai extension. Lần khởi động đầu, web chạy migration bằng superuser và cấp quyền cho
   `cl_app`; bảng `event` chỉ được thêm, không được sửa hay xóa.
3. **Ổ dữ liệu dùng chung**: web lưu tệp JD tải lên, worker tải dataset; cả hai đọc cùng thư mục. Trên máy chủ:
   `mkdir -p /data/coolify/igo-lab && chown 1000:1000 /data/coolify/igo-lab` (container chạy user `node`, uid 1000).
   Ở **cả hai app**: Persistent Storage → Directory Mount, source `/data/coolify/igo-lab`, destination `/data`.
4. **App `igo-lab-web`**: + New → Application → Docker Image `ghcr.io/toantranmei/igo-lab:main`.
   - Ports Exposes `3100`; Domains `https://igo-lab.toantranmei.com`.
   - Health check: bật, path `/api/health`, port `3100`, interval 10 s, start period 60 s (lần đầu còn chạy migration).
   - Connect to predefined network: bật, cùng network với Postgres.
   - Biến môi trường:

     | Biến | Giá trị |
     |---|---|
     | `ROLE` | `web` |
     | `DATABASE_URL` | `postgres://cl_app:<mật khẩu cl_app>@<host nội bộ của Postgres>:5432/competence_lab` |
     | `DATABASE_OWNER_URL` | URL superuser nội bộ, đường dẫn `/competence_lab` (chỉ web có biến này) |
     | `DATA_DIR` | `/data` |
     | `LOCAL_ACTOR_PERMISSIONS` | `VIEW,OPERATE,APPROVE,BACKUP_ADMIN` |
5. **App `igo-lab-worker`**: Docker Image `ghcr.io/toantranmei/igo-lab:main`, **không domain**, health check tắt,
   cùng network, cùng Directory Mount (bước 3). Tên app phải chứa chữ `worker` (script deploy nhận vai theo tên).
   **Chỉ một replica**: hàng đợi job dùng khóa trong DB, nhưng cầu dao hạn mức nằm trong bộ nhớ của tiến trình.

     | Biến | Giá trị |
     |---|---|
     | `ROLE` | `worker` |
     | `DATABASE_URL` | như web |
     | `DATA_DIR` | `/data` |
     | `CLAUDE_CODE_OAUTH_TOKEN` | token từ `claude setup-token` (chạy trên máy của bạn, dùng gói Claude đang đăng nhập; hiệu lực khoảng 1 năm) |
6. **Basic auth** (chưa có đăng nhập trong app; quyết định 19/11/2026): web → Configuration → bật *HTTP Basic
   Authentication*, đặt user và mật khẩu (`openssl rand -base64 18`). Bản Coolify chưa có mục này thì thêm vào
   *Container Labels* của web (tạo chuỗi bằng `htpasswd -nbB <user> <mật khẩu>`, nhân đôi mọi `$` thành `$$`):

   ```
   traefik.http.middlewares.igo-lab-auth.basicauth.users=<user>:$$2y$$05$$...
   traefik.http.routers.<tên router https của app>.middlewares=igo-lab-auth
   ```

   Health check của Coolify chạy trong container nên không bị basic auth chặn. Worker không có domain.
7. **Tag**: gắn tag `igo-lab` cho cả web và worker (chỉ hai app này). Cả hai kéo tag image `main`.
8. **Token cho CI**: Settings → Advanced → bật API Access; Keys & Tokens → API token quyền `read` + `deploy` → secret
   `COOLIFY_TOKEN` của repo.
9. **GHCR**: máy chủ đã `docker login ghcr.io -u toantranmei` cho ai-factory; token `read:packages` đọc được mọi package
   private của tài khoản, kể cả `igo-lab`. Hết hạn thì chạy lại (Coolify → Terminal → máy chủ).

## Hằng ngày

- **Deploy**: push `main`, xem tab Actions; xong thì `/api/health` (qua basic auth) trả sha mới.
- **Chạy tay**: `COOLIFY_URL=… COOLIFY_TOKEN=… PRODUCTION_URL=… PRODUCTION_BASIC_AUTH=user:pass GITHUB_SHA=<sha> node scripts/coolify-deploy.mjs` (thêm `--dry-run` để chỉ in app tìm được).
- **Rollback**: Coolify → app → image tag `sha-<7 ký tự>` của bản trước → Deploy (cả web và worker). Migration chỉ tiến:
  bản cũ chạy được trên schema mới nếu không có migration xóa cột. Rollback xong đặt lại tag `main`, nếu không job
  deploy dừng với `Pinned image tag`.
- **Log**: Coolify → app → Logs. Worker in `[worker] Claude CLI … sẵn sàng` khi đăng nhập được.
- **Chạy image trên máy**: `docker build -f docker/Dockerfile --target runner -t igo-lab:local .`

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân hay gặp |
|---|---|
| Web không khỏe lần đầu | Migration lỗi: thiếu extension `vector` (Postgres không phải image pgvector) hoặc `DATABASE_OWNER_URL` sai |
| `permission denied for table …` | Role `cl_app` tạo sau lần migration đầu: deploy lại web (migration cấp lại quyền mỗi lần khởi động) |
| Worker báo "Claude CLI chưa đăng nhập" | `CLAUDE_CODE_OAUTH_TOKEN` thiếu hoặc hết hạn: chạy lại `claude setup-token` |
| Tải JD hoặc dataset lỗi ghi | Thư mục `/data/coolify/igo-lab` không thuộc uid 1000 |
| Job deploy báo `/api/health answered 401` | Thiếu secret `PRODUCTION_BASIC_AUTH` |
