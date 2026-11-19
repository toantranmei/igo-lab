# Plan P3 · Từ điển, phiên bản và duyệt ở đầu ra

| | |
| --- | --- |
| Đặc tả gốc | `docs/specs/competence-lab-upgrade-spec.md`, mục 7 và 13 (bước 19–22); white paper chương 6 |
| Trạng thái | Đã làm bước 19–21 (giao diện còn hai hạn chế, mục 2). Chờ nghiệm thu bước 22 |

## 1. Đã làm

### Phiên bản và ghi · `packages/registry/src/versioning.ts`, `commit.ts`

| Mã | Làm gì |
| --- | --- |
| P3.1 | Năng lực, chỉ báo, khung mang nhãn `data.semver` MAJOR.MINOR.PATCH; từ điển mang nhãn ba số (bản đầu 1.0.0). Bản cũ có số nguyên `n` đọc thành `n.0.0`; nhãn hai phần `1.N` của bản phát hành được migration `0008` đổi thành `1.N.0`. Xuất khung nhận nhãn cũ làm bí danh |
| P3.2 | Phân loại thay đổi khi ghi (38): S cấu trúc, D định nghĩa → MAJOR; P hồ sơ, V lớp, L pháp lý → MINOR; B bằng chứng, E sửa lỗi → PATCH. Sửa ≤ 3 ký tự là E; thêm nhãn đồng nghĩa là P |
| P3.3 | Mức tăng của từ điển (39): có MAJOR, năng lực mới hoặc năng lực ngừng dùng → MINOR; còn lại → PATCH |
| P3.4 | Khung ghim `năng lực@phiên bản` như trước; MAJOR liệt kê khung đang ghim bản cũ (cột "Ảnh hưởng") |
| P3.5 | Ghi khi nền chưa đổi; nền đã đổi thì từ chối (`BASE_CHANGED`), không ghi đè |
| P3.6 | Biên nhận và bản phát hành bất biến như trước |
| P3.7 | Năng lực không còn khung nào của bản mới dùng thì ghi một phiên bản `DEPRECATED` (MINOR); không xóa |
| P3.8 | Quay lui là bản mới, tăng PATCH (1.1.0 → 1.1.1). **Sửa lỗi:** ghi tiếp sau quay lui từng trùng khóa `mã@phiên bản`; nay phiên bản lưu trữ kế tiếp luôn lớn hơn mọi phiên bản đã ghi |
| P3.9 | Ghi chú phát hành tự sinh (mới, đổi loại gì, cũ → mới, khung đang ghim, ngừng dùng), lưu trong bản phát hành và bản ghi G |

Hồ sơ dự kiến ở B8 đã tính trước loại thay đổi và phiên bản cũ → mới bằng đúng hàm mà sổ đăng ký dùng khi ghi, để người duyệt thấy trước.

Lý do từ chối (Q2) tự nạp vào lượt sau của cùng vị trí (`lessons_loaded`), hiện ở màn Đầu vào mục "Bài học tự nạp".

### Giao diện (một phần bước 21)

- Từ điển: tab **Bản phát hành** (dòng phiên bản, ghi chú, thay đổi kèm loại và mức tăng, khung đang ghim bản cũ, khôi phục kèm lý do).
- Kết quả → Duyệt: mỗi mục hồ sơ hiện phiên bản cũ → mới và loại thay đổi.
- Đầu vào: khối "Bài học tự nạp".

## 2. Giao diện bước 21 (đã làm sau)

1. **Đầu vào** 3 tab: Thiết lập lượt mới, Dữ liệu của lượt, Bài học tự nạp.
2. **Kết quả và duyệt** 4 tab: Thay đổi từ điển, Khung, Khung bị ảnh hưởng (khung đang ghim bản cũ, nút "Tạo lượt rà soát": tạo lượt, không tự chạy, theo Q4), Thẩm định và bài học. Khối duyệt (lý do, từ chối, chấp nhận và phát hành) nằm ở chân hai tab Thay đổi từ điển và Thẩm định.
3. **Từ điển**: bộ chọn "Xem tại bản"; tab Bản phát hành có "mạng cập nhật" giữa bản và bản cha (mới xanh đậm, MINOR/PATCH viền cam kèm cũ → mới, MAJOR viền đỏ, ngừng dùng mờ nét đứt, khung ghim bản cũ nét cam đứt).

Còn hạn chế:
- "Xem tại bản" mới áp cho 4 góc nhìn dựng từ catalog (Mạng 2D, Mạng 3D, Ma trận, So sánh vai trò). Truy vết nguồn, Phiên bản/diff và Dữ liệu chi tiết vẫn theo bản của lượt hiện tại.
- Mạng cập nhật là lưới node có kiểu, chưa phải đồ thị có cạnh và hoạt ảnh.

## 3. Lệch so với spec

- **"Tính lại phần chênh" (41)**: khi nền đã đổi, hệ thống từ chối và yêu cầu tạo lượt mới. Phần chênh không được tính lại ngay trên hồ sơ cũ. Hai lượt ghi trên cùng nền vẫn không ghi đè nhau (nghiệm thu 3).
- **Khung đổi tập năng lực là S nên lên MAJOR** (1.0.0 → 2.0.0), không phải 1.1 như cách đánh số cũ. Đây là hệ quả đúng của (38), nhưng khác thói quen cũ.

## 4. Nghiệm thu P3 · trạng thái test

| # | Tiêu chí | Test |
| --- | --- | --- |
| 1 | Sửa chính tả → E, PATCH; đổi định nghĩa → D, MAJOR, liệt kê khung ghim | `tests/unit/versioning.test.ts`; `pipeline.test.ts` (UPDATE) |
| 2 | 1.2.0 + một MAJOR + một mới → 1.3.0 | `versioning.test.ts` |
| 3 | Hai lượt cùng nền không ghi đè | `pipeline.test.ts` (commit nguyên khối, base đổi) |
| 4 | Quay lui rồi ghi tiếp không trùng khóa | `pipeline.test.ts` (lượt 2) |
| 5 | Lý do từ chối có ở Bài học tự nạp của lượt sau | `p2.test.ts` |
