# Review tổng P0–P5

Ba agent review đọc độc lập ba vùng rủi ro, mỗi vùng 12 phát hiện, tổng cộng 36. Từng phát hiện đã được đối chiếu với code. 31 phát hiện đã sửa và có test hồi quy (`tests/unit/review-fixes.test.ts` và bổ sung trong các test tích hợp); 5 phát hiện còn lại cần chủ sản phẩm quyết hoặc để sau (mục 4).

Sau khi sửa: `pnpm typecheck` sạch, `pnpm test` 124/124, `pnpm e2e` 14/14.

## 1. Chặn thất thoát token và runtime

| # | Phát hiện | Đã sửa |
| --- | --- | --- |
| 1 | Lời gọi đang xếp hàng vẫn sinh tiến trình ngay sau khi cầu dao ngắt (cầu dao ngắt sau khi khe semaphore đã nhả) | Đánh giá kết quả và ngắt cầu dao ngay trong khe, trước khi nhả; kiểm lại cầu dao và tín hiệu dừng ngay trước `spawn`; kết quả của lời gọi sinh trước lần ngắt không tính vào chuỗi lỗi mới |
| 2 | Hẹn giờ chạy tiếp tác động sai lượt và lặp mãi | Lịch hẹn bị xóa trước khi chạy; chỉ chạy tiếp đúng lượt đã hẹn và chỉ khi đó còn là lượt hiện tại |
| 3 | Chạy tiếp thường, hoặc chạy lại, có ngay ngân sách và hạn mức lời gọi mới của bước | Tính phần đã dùng trên mọi lần chạy của bước; dừng vì ngân sách hoặc bất thường thì bắt buộc dùng "chấp nhận vượt" |
| 4 | Token của lần thử đầu bị lỗi không được ghi | Ghi `agent_call` cho lần thử đầu trước khi thử lại |
| 5 | E8 được ước tính ở B8 thay vì B7; thiếu E9 | Sửa ước tính; E10 nay luôn được tính |
| 6 | "Chấp nhận vượt" nâng sai phép kiểm, hoặc không gỡ được dừng vì trần của lượt | Tách cờ cho trần bước, trần lượt, số lời gọi của lượt; nâng tương đối với phần đã dùng |
| 7 | Job bị nhận lại không giới hạn | Tối đa 3 lần; quá thì bước dừng với mã `JOB_RETRIES` |
| 8 | Worker khởi động lại trong 3 phút không nhận lại job mồ côi | Khi khởi động, nhận lại mọi job đang chạy dở |
| 9 | Nhịp vết cuối có thể chưa ghi khi bước đã báo xong | Chờ cho tới khi không còn lần ghi nào nối thêm |
| 11 | Chạy tiếp có thể để chạy tự động bật mà không có job nào | Xếp job trước, bật chạy tự động sau |
| 12 | Số liệu khi bước dừng chưa phải cuối cùng | Chờ các lời gọi đang chạy xong (tối đa hết thời hạn) trước khi ghi lý do dừng |

## 2. Công thức và cổng

| # | Phát hiện | Đã sửa |
| --- | --- | --- |
| 1 | Luật "tối đa 1 meta" không có hiệu lực | B6.G5 thành cổng bắt buộc |
| 2 | Vòng viết lại có thể đẩy một bậc quá 4 chỉ báo | Mỗi bậc chỉ thêm đúng số chỉ báo đã bị bỏ |
| 3 | Bộ nhớ E1 theo từng JD thiếu cấp bậc và ngành trong khóa | Đã thêm vào khóa |
| 4 | Còn lọt dữ liệu cá nhân vào input gửi AI: số có ngoặc, tên trước dấu hai chấm, danh xưng + tên; và che nhầm chữ thường | Viết lại `maskPII`, có test |
| 5 | E23 cho phép hai lần tách chồng nhau | Kiểm và khử trùng |
| 6 | Câu được mã vào nhiều năng lực bị tính là lệch trong κ | Đúng khi E9 chọn một trong các mã của câu |
| 9 | Cỡ mẫu E9 thấp hơn mức tối thiểu để tính κ | Mẫu ≥ `kappa_min_items` |
| 10 | Một ghế bị loại làm mọi chỉ báo trượt | Ghế bị loại ra khỏi mẫu số |
| 11 | Mục kiểm tra của ghế chứa nguyên tên năng lực | Dùng định nghĩa, không có tên |
| 12 | Chữ "dataset" ở bất kỳ đâu làm E = 2 | Chỉ nhận tiền tố `hf:` hoặc `dataset:` |

## 3. Sổ đăng ký, dữ liệu người, quyền

| # | Phát hiện | Đã sửa |
| --- | --- | --- |
| 1 | Khử nhận dạng bỏ sót dạng tiếng Việt phổ biến: `\b` không hiểu chữ có dấu, danh xưng viết hoa, tên đầu câu, họ ngoài danh sách cũ, tổ chức và địa danh không có từ khóa, số định danh | Ranh giới từ theo Unicode; danh sách họ dài hơn; danh mục tổ chức và địa danh phổ biến; số có nhóm và ngoặc; có test |
| 2 | Nguồn, tham chiếu đồng ý và tên năng lực trong khảo sát không được kiểm | Kiểm mọi trường được lưu |
| 3 | Client tự đặt `audit_sampled: false` để bỏ qua thẩm định | Chỉ việc tạo lô mới đặt được. Khi cả lô vào mẫu, khung đã qua B7 mà chưa thẩm định thì B7/B8 thành cũ và hồ sơ dự kiến bị rút |
| 4 | Hạn lưu so sánh theo chuỗi; bản sao trong snapshot không bao giờ bị xóa | Bắt buộc dạng YYYY-MM-DD trong tương lai; khi dọn định kỳ, bản sao trong snapshot cũng bị che |
| 5 | Nhãn ba số trùng sau khi quay lui | Tăng từ nhãn cao nhất từng ghi |
| 6 | Bỏ một UPDATE làm năng lực biến khỏi khung rồi bị ngừng dùng | Năng lực giữ ở bản nền, kèm chỉ báo của bản nền |
| 7 | Năng lực đã ngừng dùng được dùng lại vẫn mang trạng thái ngừng | Tự chuyển lại Hiệu lực (MINOR) |
| 8 | Tạo lô lỗi giữa chừng để lại lô dở | Kiểm toàn bộ lô trước khi tạo |
| 9 | Nhãn cũ "1.N" của khung bị bỏ qua | Đọc làm bí danh |
| 10 | Mã hiển thị năng lực bị tái dùng sau quay lui | Lấy số lớn nhất từng cấp |
| 11 | Đọc sổ công cụ AI (quyền VIEW) lại ghi vào DB | Chỉ tạo mục mặc định khi tạo lượt |
| 12 | `sql.raw` tự thoát chuỗi; khảo sát xóa và ghi ngoài transaction | Truy vấn có tham số; dùng transaction |

## 4. Quyết định của chủ sản phẩm (19/11/2026)

1. **JD trùng gần đúng:** loại khỏi N và không dùng làm bằng chứng. Lý do: công sức bỏ vào gần như không cải thiện kết quả. Đây đã là cách hệ thống đang chạy.
2. **Hơn 14 năng lực được giữ:** giữ cách hiện tại. Xếp hạng rồi cắt về 14; B5.G5 ghi cảnh báo, không chặn.
3. **Model của E8:** Opus 5.5, effort thấp (cấu hình `agents-3`). Không có model nào nhỏ hơn Haiku 5.5, và (31) cần model thẩm định khác mọi model đã làm. E8 gọi khoảng 2 lần mỗi khung, nên chi phí tăng ít. G7.6 nay đạt bằng dữ liệu, không cần phiếu sai lệch.
4. **Khử nhận dạng bằng agent (KS2):** đưa vào mục tối ưu sau.
5. **Bộ neo:** người chỉ đưa JD vào. Nhãn chuẩn do model mạnh hơn gắn (`pnpm anchor:label`, mặc định Opus 5.5 effort cao, cùng tác vụ E1); `pnpm anchor:eval` đo E1 Haiku so với nhãn đó. Script từ chối đo một model trên nhãn do chính nó gắn.
6. **Ngày đăng:** tin đăng quá 24 tháng bị loại ở B1 trước khi gửi AI. Tin không rõ ngày vẫn được dùng, với điểm độ mới D = 0. Ngày đăng nhập được ở form dán, ở từng tệp, và lấy tự động từ cột ngày của dataset nếu có.
7. **Bộ dữ liệu tính tay:** không cần người. Đáp án được tính bằng một bản cài đặt Python độc lập, viết chỉ từ spec và white paper (`tests/reference/`).
8. **Danh mục nghề:** dùng Danh mục nghề nghiệp Việt Nam (QĐ 34/2020/QĐ-TTg) và O*NET, nối qua ISCO-08 (`data/reference/`).

### Kết quả đối chiếu đáp án độc lập (bước 18 của P2)

- `tests/reference/golden.json` có 149 trường hợp, phủ đủ 37 công thức. Bản cài đặt tham chiếu viết từ bản `.docx` của white paper (chỉ bản này có đánh số công thức) và từ spec, không đọc code.
- `tests/unit/golden.test.ts` so 98 trường hợp có hàm tương ứng trong code, sai số cho phép 0,01.
- Tìm ra hai lỗi trong code, đã sửa:
  - (20): khi chỉ một ghế chấm, r_wg ra 1. Nay ra null, và luật giữ (21) không đạt.
  - (36): ngày 29/02 cộng 12 tháng ra 01/03. Nay ra 28/02.
- Ba chỗ lệch do hai cách đọc đều hợp lệ, ghi trong test, giữ cách của code:
  - (16): F1 = 0 thay vì null khi không có dự đoán đúng.
  - (13): S = 0 thay vì null khi không có bằng chứng nào.
- Những điểm còn mập mờ trong tài liệu ở `tests/reference/README.md`. Các điểm chính:
  - Spec và white paper đánh số (22)–(23), (35)–(37) lệch nhau.
  - Spec ghi E9 khi là Opus, khi là Sonnet.
  - (31) so theo agent hay theo model. Code so theo model, chặt hơn.

### Neo nghề (G2) với dữ liệu thật

- E23 nhận danh mục nghề VN cấp 4: 509 mã, tên viết không dấu, chỉ gửi ở lời gọi E23 đầu tiên của lượt, khoảng 7 nghìn token. E23 chọn một mã, code kiểm mã có trong danh mục.
- Code nối mã ISCO-08 sang 1–2 nghề O*NET, xếp theo liên kết trực tiếp, số nghề ESCO ủng hộ và độ trùng từ.
- Lấy tối đa 20 nhiệm vụ O*NET có điểm Importance (ưu tiên nhiệm vụ Core). E4 cho biết nhiệm vụ nào ủng hộ năng lực nào; mỗi nhiệm vụ ủng hộ cộng ω = 3 vào (12).
- G2 đạt bằng dữ liệu khi có mã VN và ít nhất một nghề O*NET.
- Mã ISCO cho nhóm 0 và nhóm 1 (lực lượng vũ trang, lãnh đạo) cùng 28 mã khác là suy ra từ tên nghề, cần người xem lại (`data/reference/SOURCES.md`).

## 4b. Chạy thật và sửa (19/11/2026, chiều)

Chi phí đo thật (lượt 01 phiên mẫu, 5 JD): 0,347 USD quy đổi; E8 Opus 48%, E6 Sonnet 37%. Chi phí gần như cố định theo số JD vì B6–B7 làm trên ≤ 14 năng lực lõi.

| Thay đổi | Lý do |
| --- | --- |
| E8 theo mức: C dùng Haiku, A/B dùng Opus (`agentConfigFor`) | Mức C không bao giờ lên tầng thị trường; (31) chỉ quyết tầng đó |
| B5: E10 chọn lõi trước, E5 chỉ ghép với lõi | Ma trận chỉ còn ≤ 14 cột; B5 giảm khoảng 60% token với 100 JD |
| Ước tính hiệu chỉnh theo lượt thật (E6 ≈ 890 token/năng lực, E7 ≈ 140/phiếu), thêm USD quy đổi | Ước tính cũ thấp hơn thực tế khoảng 1/3 |
| E6 giữ Sonnet | Haiku bị G0 (2) chặn: E7 (Haiku) là bên kiểm của E6 |
| E7, E23 dùng ngưỡng bất thường của tác vụ theo lô | Gửi cả khung hoặc cả danh mục nghề trong một lời gọi theo thiết kế |
| E4: chừa chỗ cho danh sách O*NET khi chia lô; thêm lượt gộp đồng nghĩa nhìn toàn bộ cụm | Lô vượt ngưỡng; tên đồng nghĩa ở các lô khác nhau không được gộp |
| E8: lời gọi chính mang cổng, thống kê, mẫu câu và chấm 10 biến; lô phụ chỉ duyệt mục (prompt p5) | Phần cố định lặp lại ở mọi lô làm vượt trần ngân sách B7 |
| E8: căn cứ đánh giá ở mức năng lực; chỉ báo theo bậc thiếu câu JD tối đa LOW | Chỉ báo do E6 soạn và được kiểm bằng dịch ngược (27); JD hiếm khi mô tả hành vi theo bậc |
| B6 (28): lớp lệch (P̄_e ≥ 0,6) thì xét đồng ý quan sát P̄ ≥ 0,70 | Nghịch lý kappa; quyết định của chủ sản phẩm |
| B6: chỉ báo viết lại lấy số trống của bậc | Hai chỉ báo trùng mã (`I-…-11`), một bản đè bản kia khi ghi từ điển |
| Giao diện Đầu vào thành wizard 3 bước, popup; màn chốt hiện USD | Yêu cầu của chủ sản phẩm |
| Banner STOP hiện lỗi tại chỗ; màn Thẩm định có nút "Loại lesson" | Mở lại thất bại không có thông báo; chỉ có nút "An toàn" |

Kết quả: phiên "Phiên đầy đủ · Product Owner" (15 JD, SOP mức C) chạy trọn B0→B8 và công bố từ điển 1.0.0 (8 năng lực). Còn tồn: Haiku gộp đồng nghĩa thận trọng; năng lực "Quản lý backlog và ưu tiên tính năng" bị B6 loại ở mọi lượt; kết quả B6 phụ thuộc phiếu ngẫu nhiên của ba ghế.

## 5. Còn để sau

1. **Cầu dao mở lại cho mọi lời gọi cùng lúc**, chưa có trạng thái "nửa mở" chỉ cho một lời gọi thăm dò. Mức thấp.
2. **Ghi con trỏ hướng dẫn với quyền VIEW.** Có từ trước P0; để nguyên vì màn hướng dẫn của người chỉ xem cũng ghi con trỏ.
3. **Khử nhận dạng vẫn theo mẫu** (xem quyết định 4).
