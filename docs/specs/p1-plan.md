# Plan P1 · Thiết kế AI tối ưu

| | |
| --- | --- |
| Đặc tả gốc | `docs/specs/competence-lab-upgrade-spec.md`, mục 5, 12.5 và 13 (bước 8–12) |
| Nền code | P0 (chưa commit) |
| Trạng thái | Đã làm bước 8, 9, 11 và phần khung của bước 10. Chờ bộ neo (bước 10) và lượt nghiệm thu 50 JD (bước 12) |

## 1. Đã làm

### Khuôn agent chung (bước 8)

- `TaskDef.shared`: các khóa input dùng chung giữa các lời gọi của một bước được đặt ở cuối `--system-prompt` (`<shared_input>`), user message chỉ còn phần riêng. Áp dụng cho E5, nơi danh sách năng lực giống nhau ở mọi lời gọi. Đây là bài học của thử nghiệm T8 ở P0.
- Model theo mục 12.5 (`DEFAULT_AGENT_CONFIG` bản `agents-2`): Haiku cho E1, E2+E3, E4, E5, E7 (3 ghế), E10 (3 ghế); Sonnet cho E6, E8, E9. Mọi lời gọi chạy effort `low`. Không dùng Opus.
- Ba ghế có vai và cách diễn đạt thang riêng (mục 6.1a, S3), nằm trong cấu hình.
- CLI giả có đủ các agent E và giữ các quy ước fixture cũ.

### Bước code trước AI (bước 9) · `packages/pipeline/src/prep.ts`

| Mã | Làm gì |
| --- | --- |
| K1 | Jaccard trên 3-gram từ, ngưỡng 0,85. Bản trùng kế thừa kết quả của bản gốc và không được gửi AI. `duplicate_of` và `near_duplicate_j` ghi ở B1 |
| K2 | Che email, số điện thoại, liên kết, tên sau "Liên hệ / Contact / Người phụ trách…" trước mọi lời gọi (E1, E5, E6, E8, E10, T7). `agent_result.input_canonical` chỉ chứa bản đã che |
| K3 | Mã ngắn trong mỗi lời gọi (`j1`, `s1`, `t1`, `k1`, `c1`, `d1`); JD gửi dạng dòng đánh số `s12 <text>`; code giữ bảng ánh xạ |
| K4 | Trùng tên (hoặc bí danh) và định nghĩa giống ≥ 0,95 với năng lực trong từ điển thì code quyết REUSE, không gửi AI |
| K5 | Gom sơ bộ nhiệm vụ và ứng viên bằng trigram ký tự ≥ 0,8 (ứng viên so cả tên lẫn định nghĩa); AI chỉ trả phần sửa |
| K6 | Đuôi dài ở B5: giữ nhóm được ≥ max(2, ⌈3% × JD hợp lệ⌉) JD nêu, chỉ áp khi ≥ 10 JD hợp lệ. Phần còn lại ghi `long_tail` ("chưa đủ căn cứ") |
| K7 | Lọc câu chung chung theo danh sách mẫu ("các công việc khác theo yêu cầu…") |
| K8 | Cắt mục giới thiệu công ty, phúc lợi, cách ứng tuyển, địa chỉ, liên hệ tới tiêu đề công việc kế tiếp. Đoạn bị cắt vẫn lưu và vẫn truy nguồn được |

### Lời gọi theo lô (bước 11)

| Bước | Trước P1 | Sau P1 |
| --- | --- | --- |
| B1 | T1 mỗi JD | E1 mỗi lô (≤ 7 000 ký tự, ≤ 20 JD); có bộ nhớ theo từng JD, nên thêm một JD chỉ gửi lại JD đó |
| B2 | T2 mỗi JD + T3 | E2+E3 mỗi lô cụm (đọc nhiệm vụ do E1 trích); trả phần sửa và mã nghề |
| B3 | T4 mỗi JD + T5 + T6 mỗi nhóm | E4 mỗi lô cụm: gộp và quyết định so với từ điển |
| B4 | T7 mỗi sự kiện + T13 mỗi nhóm | T7 mỗi sự kiện; **bỏ T13**, code liệt kê `evidence_needed` |
| B5 | T8 mỗi nhiệm vụ + T9 | E5 mỗi 25 nhiệm vụ × mỗi phần danh sách năng lực; E10 ba ghế khi có rubric |
| B6 | T10 mỗi năng lực + T11 ba ghế | E6 nhiều năng lực mỗi lời gọi; E7 ba ghế |
| B8 | T12 | E8 mỗi lô hồ sơ, kết luận xấu nhất thắng |

Lời gọi của bộ thử 2 JD (fixture): từ ≈ 20 xuống 7. Ước tính cho 50 JD: xem `estimate.ts` và màn Đầu vào.

E9 có khung (schema, prompt) nhưng chưa nối vào cổng; việc đó làm ở P2 cùng Cohen's kappa.

### Bộ neo (khung của bước 10) · `packages/pipeline/src/anchor.ts`

- Công thức (16): P, R, F1; ghép một-một dự đoán với nhãn theo độ giống văn bản.
- Bảng `agent_measure` (migration `0006`): số đo theo (tác vụ, model, phiên bản prompt, bộ neo).
- P1.2: `startAttempt` từ chối chạy bước có agent mà lần đo gần nhất chưa đạt (`AGENT_LOCKED`).
- `pnpm anchor:eval --set=<tệp> [--record]`: chạy E1 trên bộ neo bằng CLI thật (tốn token), in số đo và tùy chọn ghi lại. Chưa chạy lần nào.

## 2. Lệch so với spec, cần chủ sản phẩm biết

1. **E2+E3 và E4 là hai lời gọi**, không phải một như bảng 5.2a. E2+E3 thuộc B2 và E4 thuộc B3; gộp làm một thì chạy lại B3 sẽ phải chạy lại cả phần của B2. Mỗi khung tốn thêm một lời gọi.
2. **E4 chỉ gộp, không tách cụm.** Trong thực tế, gom sơ bộ chỉ gộp các ứng viên gần như trùng cả tên lẫn định nghĩa.
3. **Ngưỡng K6 tăng theo cỡ bộ** (3% số JD hợp lệ). Với ngưỡng cố định 2 JD, bộ 131 JD còn 197 nhóm. Danh sách đó không vừa một lời gọi E5 dưới 8 000 token.
4. **E5 chia danh sách năng lực thành phần** (≈ 4 500 ký tự mỗi phần) khi danh sách dài. Số lời gọi E5 = lô nhiệm vụ × số phần. Việc này giữ nghiệm thu mục 2, nhưng bộ lớn sẽ tốn nhiều lời gọi E5 hơn bảng 5.2a.
5. **Lượt tạo trước P1 không chạy tiếp được** (`RUN_OUTDATED`): snapshot của chúng khóa cấu hình agent cũ. Kết quả cũ vẫn xem được; cần tạo lượt mới.
6. **Tiêu chí A–C của B1, mã ISCO đã kiểm và lăng kính L, M** để sang P2. E2 có trả mã ISCO, nhưng cổng chưa dùng.

## 3. Còn chờ

| # | Việc | Cần |
| --- | --- | --- |
| 10 | Bộ neo 50 JD | Người chỉ đưa 50 JD; nhãn do Opus 5.5 effort cao gắn (`pnpm anchor:label`, quyết định 19/11/2026). Chạy thật cần duyệt |
| 10 | Ngưỡng nghiệm thu trên bộ neo | Chủ sản phẩm chốt; mặc định tạm: phạm vi 0,9, F1 nhiệm vụ 0,7, F1 ứng viên 0,6 |
| 12 | Lượt nghiệm thu 50 JD, đo token và phần hạn mức | Duyệt chạy thật (≈ 160–250 nghìn token theo ước tính) |

Kèm các việc P0 còn treo: migration lên DB phát triển, thử nghiệm E (nay đã có `shared` dùng cho E5), lượt 15 JD.
