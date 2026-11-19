# Plan P4 · Dữ liệu từ con người và nâng tầng

| | |
| --- | --- |
| Đặc tả gốc | `docs/specs/competence-lab-upgrade-spec.md`, mục 8 và 13 (bước 23–26) |
| Trạng thái | Đã làm bước 23–25. Chờ nghiệm thu bước 26 |

## 1. Đã làm

| Mã | Làm gì | Nơi |
| --- | --- | --- |
| P4.1 | Sự kiện có mã người giả danh (P01…), nhóm xuất sắc / trung bình, loại BEI / phiếu viết; phiếu khảo sát (mã người trả lời, năng lực, quan trọng, phân biệt, bậc 1–5). Nhập ở Đầu vào, tab Thiết lập lượt mới | `human.ts`, migration `0009` |
| P4.2 | Khử nhận dạng bắt buộc khi lưu: phát hiện email, số điện thoại, số định danh, tên người (sau danh xưng, hoặc họ phổ biến + tên), tổ chức, địa danh. Còn dấu hiệu thì từ chối (`DEIDENTIFY_REQUIRED`) kèm bản đề xuất đã khử, có nút "Dùng bản đã khử". Có mã người thì bắt buộc tham chiếu đồng ý. Hạn lưu: worker xóa sự kiện và phiếu hết hạn mỗi 6 giờ | `human.ts`, worker |
| P4.3 | B4 tính (17) mức A, (18) mức B trên người thật, (19) phân loại chủ đề tạo khác biệt / ngưỡng / cần tránh. B5 dùng phiếu khảo sát của người thay ba ghế AI khi đủ người (A ≥ 10, B ≥ 5); G5 cỡ mẫu đạt bằng dữ liệu. Tầng tự tính lại theo (34) | `blocks-b.ts` |
| P4.4 | Hiệu chuẩn agent: dùng khung của P1 (`agent_measure`, công thức (16), khóa agent chưa đạt) | `anchor.ts` |
| P4.5 | Sổ đăng ký công cụ AI (bảng `ai_tool`, mục mặc định Anthropic / Claude CLI); snapshot trỏ tới mục trong sổ; hiện ở Đầu vào | `human.ts` |
| P4.6 | Tác vụ đọc dữ liệu người (T7) chỉ lưu mã băm của input trong `agent_result.input_canonical` | `TaskDef.sensitive` |
| P4.7 | Charter nhận mã kết quả G11, G12; có cả hai thì tầng Quyết định nhân sự được xét (35) | `types.ts`, B8 |

Thêm: (30) ràng buộc năng lực – kết quả chính tính trên 3–5 kết quả chính khai trong charter; E6 gắn mỗi năng lực với kết quả.

## 2. Lệch so với spec, cần chủ sản phẩm biết

1. **Mức A chưa đạt được G4 bằng dữ liệu**: (17) cần κ của mã hóa kép sự kiện, mà hệ thống chưa có người mã hóa thứ hai.
2. **Agent kiểm bản đã khử (KS2) chưa có**: việc khử nhận dạng làm bằng mẫu nhận dạng. Các mẫu bắt được tên có danh xưng, họ phổ biến, tổ chức, địa danh; tên không theo các mẫu này có thể lọt.
3. ~~Không lên được tầng Sản phẩm thị trường với chính sách model 12.5.~~ Đã chốt 19/11/2026: E8 dùng Opus 5.5 effort thấp (`agents-3`), nên (31) đạt bằng dữ liệu.
4. **Khảo sát gửi đường dẫn cho người trả lời chưa có**: hiện nhập kết quả dạng dòng.

## 3. Nghiệm thu P4 · test

| # | Tiêu chí | Test |
| --- | --- | --- |
| 1 | Mức B, ≥ 3 người, ≥ 6 sự kiện → G4 đạt; các cổng khác đạt bằng dữ liệu → Sản phẩm thị trường | `tests/integration/p4.test.ts` (E8 = Opus, xem mục 2.3) |
| 2 | Sự kiện có tên người, tên công ty bị chặn khi lưu | `p4.test.ts` |
| 3 | Agent F1 dưới ngưỡng không chạy được | `p1.test.ts` (AGENT_LOCKED) |
