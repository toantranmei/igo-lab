# Plan P2 · Công thức và cổng ở 9 bước

| | |
| --- | --- |
| Đặc tả gốc | `docs/specs/competence-lab-upgrade-spec.md`, mục 6 và 13 (bước 13–18); white paper chương 4 |
| Trạng thái | Đã làm bước 13–17. Chờ bước 18 (kiểm trên bộ dữ liệu tính tay của chủ sản phẩm, rồi lượt nghiệm thu 50 JD) |

## 1. Đã làm

### Công thức · `packages/pipeline/src/formulas.ts`

Mọi công thức (1)–(37) mà code tính đều nằm trong module này, dạng hàm thuần, có test so với đáp án tính tay (`tests/unit/formulas.test.ts`). Các công thức đã có sẵn ở nơi khác: (1), (37) ở `@cl/db`; (4), (10) ở `prep.ts` và B3; (16) ở `anchor.ts`; (24), (25) ở B5. Mỗi phép tính trong lượt ghi một dòng `calc_record` (vào, ra, quyết định, ghế, seed).

### Theo từng bước

| Bước | Đã làm | Cổng |
| --- | --- | --- |
| B0 | Charter (cấp bậc, loại khung, quyết định phục vụ, người phụ trách, bộ ngưỡng) trên phiên; bộ ngưỡng có phiên bản (`sop-c`, `sop-b`, `sop-a`, `dev-small`), khóa vào snapshot; kiểm cặp làm / kiểm khác model: E1–E9, E6–E7 | G0 (2): đủ trường ∧ hash ∧ khác model |
| B1 | E1 chấm A, B, C; code tính D (ngày đăng), E (loại nguồn), L, M, hạng | G1 (8): N ≥ 15 ∧ N_P1 ≥ 5 |
| B2 | E2 gợi ý ISCO-08; ghi lý do | G2 đạt bằng phiếu sai lệch (xem mục 2) |
| B3 | Trọng số bằng chứng theo hạng (12), S(c) (13), độ bao phủ thư viện (14); E9 (Sonnet) mã hóa lại ≥ 20% câu, Cohen κ (15) | G3: κ ≥ 0,61 (cần ≥ 10 câu, ít hơn thì phiếu sai lệch) |
| B4 | Làn giả thuyết đã bỏ ở P1 | G4: Mức C không áp dụng; A, B chưa đạt cho tới P4 |
| B5 | E10 ba ghế chấm mọi ứng viên; r_wg (20), quy tắc giữ (21), tập lõi (23), bậc trung vị (26), độ phủ và bỏ một trên tập lõi | G5: lõi 8–14, mọi năng lực lõi có bậc; cỡ mẫu khảo sát; độ phủ thành cảnh báo |
| B6 | E6 viết 2–4 chỉ báo ở bậc 1, 3, 5; E7 ba ghế dịch ngược mù vào năng lực **và** bậc, xếp lớp; mỗi ghế có thứ tự xáo theo seed, mã ngắn riêng, 2 mục kiểm tra (S5); p_i (27) có phiếu trắng trong mẫu số; viết lại một vòng rồi bỏ; Fleiss κ (28); (29); KS1 | G6: có năng lực đủ chỉ báo; κ lớp ≥ 0,61; KS1 0 lỗi; (30) phiếu sai lệch; ≤ 1 meta |
| B7 | E8 thẩm định độc lập: 10 biến, hỗ trợ từng mục, mẫu ⌈0,1·N⌉ câu (32) | G7 (33); (31) đạt có lưu ý khi E8 cùng model một bước làm |
| B8 | Tầng phát hành (34)–(35), hạn rà soát (36), người phụ trách; ghi vào khung | G8: phiên bản, hạn rà soát, người phụ trách |

Phiếu sai lệch (P2.1–P2.3): cổng thiếu dữ liệu ghi `PASS` kèm `deviation { reason, risk, status }`; giao diện hiện "đạt bằng phiếu sai lệch"; khung có phiếu ở G1, G3–G7 không lên được tầng Sản phẩm thị trường.

Seed xáo của các ghế lấy theo nội dung, không theo lần chạy, nên chạy lại cùng dữ liệu vẫn dùng lại kết quả đã lưu.

### Giao diện

- Tab **Diễn biến dữ liệu ▶** (P2.4): phát lại từng bản ghi phép tính của lần chạy (công thức, vào, ra, quyết định, ghế), có phát / dừng, tua, chọn nhịp, tốc độ 0,5× / 1× / 2×. GSAP chạy cục bộ (`apps/web/public/vendor/gsap.min.js`).
- Tab **Kết quả và biểu đồ** (P2.5): bảng ba ghế và tập lõi của B5 (phiếu, x̄, s², r_wg, S(c), bậc, kết quả); bảng chỉ báo theo bậc của B6 (lớp, p_i, viết lại).
- Màn Lượt chạy (P2.6): dòng **Kiểm chéo** dưới mỗi bước có vòng kiểm độc lập (κ của E9; r_wg nhỏ nhất và model ghế; số chỉ báo đạt và κ lớp; số biến thẩm định). Cột cổng hiện số phiếu sai lệch.
- Form tạo phiên: thêm ngành, cấp bậc, loại khung, bộ ngưỡng, quyết định phục vụ, người phụ trách.

## 2. Lệch so với spec, cần chủ sản phẩm biết

1. **G2 luôn đạt bằng phiếu sai lệch**: chưa nạp Danh mục nghề nghiệp Việt Nam và nguồn chuẩn ngoài (O*NET hoặc tương đương) để đối chiếu. Mã ISCO do E2 gợi ý được ghi nhưng chưa kiểm.
2. **D (độ mới) luôn bằng 1**: hệ thống chưa thu ngày đăng tin. Với D = 1, một JD chỉ đạt P1 khi A = 3, C = 3 và E = 2 (nguồn có URL hoặc dataset). JD dán tay không có URL tối đa được P2.
3. **(30) kết quả chính chưa có dữ liệu**: charter chưa có trường 3–5 kết quả chính, nên ràng buộc này đạt bằng phiếu sai lệch.
4. **KS1 mới có một phần**: trùng nguyên văn giữa năng lực là lỗi; câu mô tả tính cách và câu quá dài là cảnh báo. Chưa có "câu hai hành vi", "thiếu cách đo", "bậc không tăng dần".
5. **Mục kiểm tra của ghế (S5)** chỉ chấm năng lực, không chấm bậc.
6. **G3 chưa có vòng mã hóa lại**: spec yêu cầu "làm rõ định nghĩa mã và mã hóa lại một vòng" khi κ thấp. Hiện dừng ngay ở lần đầu.
7. **Phát hiện mức cao của thẩm định** vẫn dừng ở B8 (STOP cả không gian làm việc, ghi bài học), không dừng ở B7.
8. **Bộ `dev-small`** cho bộ JD nhỏ (thử nghiệm, demo). Bộ này nới số đếm của G1 và G5, cho thiếu trường charter bằng phiếu sai lệch, và không bao giờ cho khung vượt tầng Nội bộ. Mặc định khi tạo phiên là `sop-c`.
9. **Hoạt ảnh Diễn biến dữ liệu dùng chung một khuôn** (thẻ công thức, vào, ra, quyết định) cho mọi bước. Đó chưa phải hoạt ảnh riêng từng bước như wireframe (JD bay vào cột P1/P2/P3, ma trận hai lần mã hóa…). Số liệu đã đúng nguồn; phần hình sẽ làm tiếp.
10. **Thêm 4 lời gọi mỗi khung so với P1**: E9 và ba ghế E10. Bộ thử 2 JD dùng ≈ 13 lời gọi.

## 3. Còn chờ

| # | Việc | Cần |
| --- | --- | --- |
| 18 | Bộ dữ liệu mẫu có đáp án tính tay cho (1)–(37) | Đã làm 19/11/2026: đáp án độc lập trong `tests/reference/`, test `tests/unit/golden.test.ts`; sửa (20), (36) |
| 18 | Lượt nghiệm thu 50 JD | Duyệt chạy thật |
| — | Danh mục nghề Việt Nam, nguồn chuẩn ngoài; ngày đăng tin; kết quả chính trong charter | Quyết định nguồn dữ liệu |
