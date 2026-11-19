# Plan P0 · Theo dõi lượt và chặn thất thoát token

| | |
| --- | --- |
| Đặc tả gốc | `docs/specs/competence-lab-upgrade-spec.md`, mục 4 (P0) và mục 12 |
| Wireframe | `docs/wireframe/competence-lab-wireframe.html`, nhóm "Gói 0" |
| Nền code | commit `cc94b45` |
| Trạng thái | Chờ duyệt. Chưa sửa code |

## 1. Phạm vi

**Làm:** cầu dao hạn mức; trần token và ước tính trước khi chạy; dừng khi bất thường; sự kiện và giờ của từng bước; lý do dừng có cấu trúc; vết và bản ghi phép tính ghi dần; tách token; thử nghiệm bộ đệm cho T8; màn Lượt chạy, Chi tiết một bước, Khi lượt dừng, Lịch sử lượt; tách trang demo.

**Không làm ở P0:** đổi agent (P1); công thức mới của SOP (P2); đổi màn Đầu vào, Kết quả, Từ điển (P3). Các màn này giữ nguyên, chỉ đổi điều hướng.

## 2. Đính chính chẩn đoán T8

Spec viết: "nhiệm vụ đứng trước danh sách năng lực nên phần chung không phải tiền tố". **Điều này sai.** `canonicalJson` (`packages/contract/src/core.ts:130`) sắp khóa theo thứ tự chữ cái, nên `competencies` đã đứng trước `task` trong input.

Số đo của một lời gọi T8: `cache_creation_input_tokens` 50 412, `cache_read_input_tokens` 1 169. Nguyên nhân có khả năng nhất: Claude CLI đặt điểm đánh dấu bộ đệm ở **cuối** user message. Phần đuôi mỗi lời gọi khác nhau, nên cả user message (≈ 50 nghìn token) được ghi mới mỗi lần. Chỉ phần khung của CLI (≈ 1 169 token) được đọc lại. Qua CLI không đặt được điểm đánh dấu ở giữa user message.

**Cách sửa đề xuất:** đưa phần dùng chung (danh sách năng lực) vào `--system-prompt`; user message chỉ còn nhiệm vụ. Việc này phải được kiểm bằng một thử nghiệm nhỏ (bước E). Nếu không đọc lại được bộ đệm thì bỏ P0.6 và chờ P1 thay T8 bằng E5.

Bài học này cũng áp vào thiết kế P1: qua CLI, phần dùng chung giữa các lời gọi phải nằm trong system prompt.

## 3. Nguyên nhân 747 lời gọi lỗi

Đây là phát hiện mới khi đọc code. Bước B5 gọi `Promise.all(tasks.map(... ag.run('T8' ...)))` (`packages/pipeline/src/blocks-b.ts:89`). Mọi lời gọi được tạo cùng lúc và xếp hàng trong semaphore 3 luồng của runner (`packages/agents/src/runner.ts:32`). Khi một lời gọi ném lỗi, `Promise.all` từ chối nhưng các lời gọi còn trong hàng **vẫn chạy tiếp**. Mỗi lời gọi lỗi còn được thử lại một lần sau 1,5 giây (`run-task.ts:82`). Không có gì báo cho hàng đợi dừng lại.

## 4. Các phần việc

Thứ tự từ A đến I. Cột "Cỡ" là ước lượng công: S nhỏ, M vừa, L lớn.

### A · Cầu dao hạn mức (S)

| File | Thay đổi |
| --- | --- |
| `packages/agents/src/runner.ts` | Thêm mã lỗi `QUOTA`. Nhận diện bằng mẫu `/hit your .*limit\|usage limit/i`; đọc giờ hồi từ "resets 2:30am (Asia/Saigon)". Thêm trạng thái `breaker` dùng chung cho tiến trình: khi đã ngắt, `run()` trả ngay `QUOTA` **trước khi** sinh tiến trình `claude`. Cầu dao tự mở lại sau giờ hồi. `NOT_LOGGED_IN` cũng ngắt cầu dao. Ba lỗi `CLI_ERROR` liên tiếp ngắt với mã `AI_ERROR` |
| `packages/agents/src/run-task.ts` | Không thử lại với `QUOTA`, `NOT_LOGGED_IN`. Lời gọi bị cầu dao chặn không ghi dòng `agent_call`; ghi một dòng tổng "bị chặn N lời gọi" cho bước. Ném `AppError('AGENT_QUOTA')` có `until` |
| `packages/pipeline/src/runtime.ts` | `startAttempt` từ chối xếp job khi cầu dao đang ngắt (trả lý do và giờ hồi) |
| `tests/fake-claude/claude.mjs` | Thêm `FAKE_CLAUDE_MODE=quota` trả đúng câu lỗi hạn mức |

**Kiểm:** test tích hợp với 30 lời gọi song song, lời gọi thứ 5 gặp `quota`. Số lần sinh tiến trình ghi trong `FAKE_CLAUDE_LOG` ≤ 5 + số luồng song song.

### B · Trần token, ước tính, bất thường (M)

| File | Thay đổi |
| --- | --- |
| `packages/pipeline/src/estimate.ts` (mới) | Ước tính số lời gọi và token theo từng bước, từ số JD, số đoạn, số nhiệm vụ và số nhóm đã biết. Hệ số lấy từ số đo lượt 16/11 (Phụ lục A của spec), cộng phần khung CLI ≈ 1 200 token mỗi lời gọi |
| `packages/pipeline/src/sessions.ts` | Khi tạo lượt: ghi `budget = { run_tokens, block_tokens }` = 1,5 × ước tính vào snapshot |
| `packages/agents/src/run-task.ts` | Trước mỗi lời gọi: (1) ước token input từ số ký tự, theo hệ số đo được trên `agent_call`; trên 8 000 thì ném `ANOMALY_INPUT`; (2) cộng dồn token của lượt và của bước (bộ đếm trong bộ nhớ, khởi tạo từ DB khi bước bắt đầu); vượt trần thì ném `BUDGET`; (3) số lời gọi của bước vượt 1,5 × ước tính thì ném `ANOMALY_CALLS`. `AGENT_MAX_CALLS_PER_RUN` giữ làm chốt cuối |
| `packages/pipeline/src/runtime.ts` | Thao tác "Chạy tiếp, chấp nhận vượt": nâng trần của đúng bước đó một lần, ghi sự kiện có người xác nhận |
| API | `GET /sessions/:id/estimate` cho màn tạo lượt |

**Lưu ý:** với ngưỡng 8 000 token, T8 hiện tại (≈ 50 nghìn token mỗi lời gọi) sẽ luôn bị chặn ở lời gọi đầu tiên. Đây là chủ ý: B5 kiểu cũ chỉ chạy được khi người vận hành bấm xác nhận vượt.

### C · Sự kiện, giờ của bước, lý do dừng (M)

| File | Thay đổi |
| --- | --- |
| `packages/db/migrations/0005_run_tracking.sql` (mới) | `block_attempt.started_at`, `block_attempt.finished_at`; `run_auto.stop jsonb` (mã, bước, câu giải thích, thao tác, `until`) |
| `packages/db/src/schema.ts` | Khai báo các cột trên |
| `packages/pipeline/src/runtime.ts` | `processNextJob`: ghi `started_at` khi nhận job; sự kiện `BLOCK_STARTED`. `runAttempt`: `finished_at` lấy lúc xong (hiện `computedAt` lấy lúc bắt đầu, dòng 167); `computedAt` cũng lấy lúc xong. Sự kiện `BLOCK_DONE` / `BLOCK_STOPPED` kèm tổng lời gọi, token, chi phí. `advanceAuto` ghi `run_auto.stop` có cấu trúc thay vì chỉ ghi chữ |
| `packages/pipeline/src/runtime.ts` | Trong lúc chạy, gia hạn `job.locked_at` mỗi 60 giây để job dài hơn 15 phút không bị worker khác nhận lại |
| `packages/pipeline/src/runtime.ts` | Chạy tự động là mặc định khi bấm "Chạy"; bỏ việc chờ "Đã hiểu" trên giao diện (worker tự xác nhận như chế độ tự động hiện nay) |

Bảy mã dừng: `QUOTA`, `GATE`, `AI_ERROR`, `PAUSED`, `BUDGET`, `ANOMALY`, `DONE` (đã tới B8, chờ duyệt).

### D · Vết và bản ghi phép tính ghi dần (L)

| File | Thay đổi |
| --- | --- |
| `0005_run_tracking.sql` | Bảng `trace_event (attempt_id, seq, event jsonb)` và `calc_record (attempt_id, seq, step, substep, item_ref, formula, inputs, output, decision, seat)`, cả hai có chỉ mục theo `attempt_id, seq` |
| `packages/pipeline/src/types.ts` (`TraceBuilder`) | Mỗi nhịp chỉ lưu phần biến **đổi**, không lưu toàn bộ trạng thái tích lũy. Ghi dồn xuống `trace_event` mỗi khoảng 1 giây trong lúc chạy. `block_attempt.trace` giữ bản gọn khi xong để tương thích |
| `blocks-a.ts`, `blocks-b.ts` | Ghi `calc_record` cho các phép tính đang có: trùng JD (Jaccard), trọng số nhiệm vụ, độ giống với từ điển, độ phủ, thử bỏ một, trung vị bậc, đồng thuận chỉ báo. Phép tính của SOP để P2 |

**Kiểm:** bước B2 trên bộ 175 JD có vết < 1 MB (hiện 41 MB); vết của bước đang chạy đọc được trước khi bước xong.

### E · Thử nghiệm bộ đệm T8 (S, có tốn token)

1. Thêm vào `CliRequest` trường `shared` (văn bản dùng chung). Runner nối `shared` vào cuối `--system-prompt`. `taskKey` không đổi, nên 107 kết quả T8 đã lưu vẫn dùng lại được.
2. T8 đưa `competencies` vào `shared`, user message chỉ còn `task`.
3. Chạy 3 lời gọi **tuần tự** trên dữ liệu lượt 16/11, bỏ qua kết quả đã lưu.
4. Đạt khi lời gọi 2 và 3 có `cache_read_input_tokens` ≥ 45 000 và `cache_creation_input_tokens` < 5 000.
5. Đạt thì B5 chạy một lời gọi làm nóng trước, rồi mới chạy song song. Không đạt thì gỡ thay đổi ở bước 2 (giữ trường `shared` cho P1), ghi kết quả vào spec.

Chi phí thử: ≈ 0,3 USD quy đổi, ≈ 160 nghìn token, dưới 1% hạn mức.

### F · Tách token và chi phí (S)

| File | Thay đổi |
| --- | --- |
| `packages/pipeline/src/usage.ts` (mới) | Từ `agent_call.usage`: cộng `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `cost_usd` theo lời gọi, tác vụ, bước, lượt |
| API | `GET /runs/:id/usage`, `GET /attempts/:id/calls` (lọc theo tác vụ, trạng thái; sắp theo chi phí; gộp lỗi giống nhau thành một dòng có số đếm) |

**Phần hạn mức đã dùng:** CLI không trả số này trong chế độ `-p`. P0 hiển thị ước lượng "≈ x% của mốc 39,5 USD", ghi rõ là ước lượng. Nếu sau này CLI có cách đọc số này thì thay vào.

### G · API cho màn mới (M)

Thêm vào router hiện có (`apps/web/lib/server/router`):

| Đường dẫn | Trả về |
| --- | --- |
| `GET /sessions/:id/runs` | Danh sách lượt: bắt đầu, bộ JD, từ điển nền, tiến độ, thời gian, chi phí, kết quả |
| `GET /runs/:id/overview` | 9 bước: trạng thái, cổng, `started_at`, `finished_at`, lời gọi, token, chi phí, bước con đang chạy; lý do dừng; 6 chỉ số |
| `GET /runs/:id/blocks/:b/attempts` | Các lần chạy của bước: lý do chạy, kết quả, số lời gọi lấy từ kết quả đã lưu |
| `GET /attempts/:id/trace?since=seq` | Vết ghi dần |
| `GET /attempts/:id/calc?substep=` | Bản ghi phép tính |
| `POST /runs/:id/resume` · `/pause` · `/schedule` | Chạy tiếp, tạm dừng, hẹn giờ theo giờ hồi hạn mức |

Màn hỏi lại mỗi 2 giây khi lượt đang chạy, mỗi 30 giây khi không chạy.

### H · Giao diện (L)

| File | Thay đổi |
| --- | --- |
| `apps/web/components/run/RunScreen.tsx` (mới) | Màn Lượt chạy theo wireframe: banner dừng, 6 chỉ số, 9 dòng bước, bước con có thanh tiến độ |
| `apps/web/components/run/StepDetail.tsx` (mới) | 5 tab: Bước con, Kết quả và biểu đồ (dùng lại nội dung `line/ComputeTab.tsx`), Lời gọi AI, Các lần chạy, Kỹ thuật |
| `apps/web/components/run/StopBanner.tsx`, `RunHistory.tsx` (mới) | Banner cho 7 mã dừng; lịch sử lượt chỉ đọc |
| `apps/web/components/shell/Shell.tsx` | Thanh điều hướng: Đầu vào · Lượt chạy · Kết quả · Từ điển. "Kết quả" tạm gom hai màn Khung năng lực và Audit hiện có cho tới P3. Bỏ khẩu hiệu đầu trang, thẻ "Phiên đang chạy", 5 nút chạy |
| `apps/web/app/demo/` (mới) | Chế độ Ví dụ chuyển sang đường dẫn `/demo`, giữ nguyên tính năng |
| `components/line/Workbench.tsx` | Gỡ khỏi điều hướng chính sau khi `StepDetail` thay được; xóa file ở cuối P0 |

### I · Kiểm thử (M)

- Unit: nhận diện lỗi hạn mức và đọc giờ hồi; ước tính; cộng token; ước token theo số ký tự.
- Tích hợp (fake CLI): cầu dao; trần token; bất thường input và số lời gọi; sự kiện bắt đầu / xong / dừng và thời gian; vết ghi dần; gia hạn khóa job.
- E2E: mở Lượt chạy trong lúc một bước đang chạy (fake CLI có độ trễ), thấy bước con và tiến độ; giả lập hạn mức thì thấy banner `QUOTA`.
- Không test tự động nào gọi Claude CLI thật.

## 5. Thứ tự làm và điểm duyệt

| # | Việc | Cần duyệt |
| --- | --- | --- |
| 1 | A cầu dao | |
| 2 | B trần token và bất thường | |
| 3 | C sự kiện, giờ, lý do dừng (có migration) | |
| 4 | D vết và bản ghi phép tính | |
| 5 | F tách token, G API | |
| 6 | H giao diện, I kiểm thử | |
| 7 | Chạy migration, khởi động lại web và worker | ✋ báo trước khi dừng hai tiến trình đang chạy |
| 8 | E thử nghiệm bộ đệm T8 (3 lời gọi thật) | ✋ |
| 9 | Lượt nghiệm thu 15 JD | ✋ |

Bước 1–6 không gọi Claude CLI thật.

## 6. Lượt nghiệm thu và token

Lượt 15 JD chạy B0 → B4 bình thường. Tới B5, T8 kiểu cũ bị chặn bởi ngưỡng bất thường; đó chính là điều cần nghiệm thu. Không bấm vượt.

| Phần | Token ước tính |
| --- | ---: |
| Thử nghiệm E | ≈ 160 nghìn |
| Lượt 15 JD, B1–B4 | ≈ 150–250 nghìn |
| **Cộng P0** | **≈ 0,3–0,4 triệu, khoảng 2–3% hạn mức 5 giờ** |

Số này thay con số 1,2 triệu ở mục 12.3 của spec.

## 7. Nghiệm thu P0

1. Màn Lượt chạy hiện đúng bước con và tiến độ trong lúc chạy, trễ ≤ 5 giây.
2. Thời gian mỗi bước khớp hiệu giờ `BLOCK_STARTED` và `BLOCK_DONE`.
3. Giả lập hạn mức: số tiến trình `claude` sinh ra sau lỗi đầu tiên ≤ số luồng song song; banner `QUOTA` có giờ hồi; chạy tự động tắt.
4. Lượt 15 JD dừng ở B5 với mã `ANOMALY`, ghi rõ lời gọi T8 ≈ bao nhiêu token so với ngưỡng 8 000.
5. Mở được mọi bước, mọi lần chạy của lượt đã xong hoặc đã dừng; vết của B2 < 1 MB.
6. Thử nghiệm E có kết luận đạt hoặc không đạt, kèm số đo, ghi vào spec.
7. `pnpm typecheck` và `pnpm test` đạt.
