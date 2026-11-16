# Competence Lab Website Specification

Đặc tả bàn giao để triển khai lại website Competence Lab và mở rộng sang xử lý JD thật. Ngôn ngữ giao diện mặc định: tiếng Việt.

**Website tham chiếu:** https://competence-lab-po-simulator.toantran-mei.chatgpt.site/  
**Mã nguồn dùng để đối chiếu:** commit `3e515bc0b0968e5edb9578b75449eb3618f3254c`. Các fixture của bản này nằm trong phụ lục, có thể dùng ngay khi chỉ nhận được file spec.

## 1. Phạm vi và kết quả cần bàn giao

1. Tái tạo trải nghiệm hiện tại: dây chuyền B0–B8, nhánh đầy đủ và nhánh nhanh, trình xem từng phép tính, dữ liệu đầu vào, khung năng lực, từ điển và đồ thị 2D/3D, audit và bài học.
2. Mở lần đầu vào phiên dựng sẵn **Default Example** với seed Product Owner hiện tại và catalog liên ngành. Phiên mẫu chạy được ngay bằng logic xác định, kể cả khi chưa cấu hình AI.
3. Cho phép tạo **phiên JD mới**, dán hoặc tải các JD, lưu thành bộ đầu vào có phiên bản và chạy bằng mô hình AI được kết nối ở máy chủ. Role lấy từ phiên, hỗ trợ chức danh tùy chỉnh.
4. Tích lũy một từ điển dùng chung qua nhiều phiên. Agent tạo đề xuất thêm, sửa hoặc dùng lại. Phiên sau dùng phiên bản từ điển đã được công bố gần nhất khi tạo lượt chạy, hoặc dùng phiên bản cụ thể do người dùng chọn.
5. Xuất gói dữ liệu có lược đồ và lịch sử đủ để đọc lại trên hệ thống khác. Cung cấp nhập thử và khôi phục để chứng minh gói có thể dùng cho chuyển hạ tầng.
6. Bàn giao mã nguồn, hướng dẫn chạy local và triển khai, cấu hình mẫu không chứa bí mật, mô tả định dạng backup và kiểm thử theo mục 12. Có thể chọn framework, nhà cung cấp model và hạ tầng. Ưu tiên ứng dụng có máy chủ và cơ sở dữ liệu bền vững cho dữ liệu thật, cùng kho file nếu cần giữ bản gốc.

**Quy ước về quyền phê duyệt:** phiên Live dùng AI để thực hiện các tác vụ phân tích trong từng block. Phê duyệt tuân theo chính sách đã khóa cho lượt. Mặc định JD-only chỉ được xây đề xuất hoặc công bố nội bộ cho mục đích soạn thảo/phát triển sau khi người có quyền duyệt. Khi áp dụng SOP yêu cầu đánh giá độc lập bằng người, phải giữ cổng đó. Trạng thái “AI đã chạy thật” và “bằng chứng nghề đã được kiểm chứng” là hai trường riêng. Việc xác nhận bài học và mở lại sau STOP do người có quyền thực hiện ngoài block.

## 2. Điều hướng và giao diện

Giao diện desktop nền tối, sidebar trái, thanh đầu trang có bộ chọn phiên, tình trạng lượt, tiến độ B0–B8 và nút **Bắt đầu lại**. Mobile chuyển sidebar thành menu và các bảng độ rộng lớn thành vùng cuộn riêng. Nhãn tên vai trò cập nhật theo phiên.

| Màn hình | Nội dung và thao tác |
| --- | --- |
| Dây chuyền sản xuất | Card B0–B8 theo thứ tự, nhánh nhanh rẽ sau B3, nút chính **Tiến 1 bước**, nút **Giao bản thử nhanh** khi đủ điều kiện. Chọn card để xem giải thích, phép tính, nghiệm thu, bàn giao và nhật ký. Khi đang chờ xác nhận, nút chính mở lại block hiện tại. |
| Dữ liệu đầu vào | Danh sách JD, nhiệm vụ, sự kiện, nguồn, phiên bản và thông tin loại bằng chứng. Mở một bản ghi xem toàn văn, đoạn dùng trong phép tính, trạng thái nguồn và trường dữ liệu thực. Live có thêm tạo/sửa bộ JD, xem trước import và chọn dữ liệu cho lượt. |
| Khung năng lực | Đồ thị nhiệm vụ → năng lực → chỉ báo. Mở từng node xem căn cứ và cấp độ bằng chứng. Bậc yêu cầu lấy từ liên kết vai trò–năng lực R. Xem danh sách, thanh bậc 1–5 và so sánh hai phiên bản. Có xuất khung JSON. |
| Từ điển và tái sử dụng | Tab Mạng 2D, Mạng node 3D, Ma trận liên ngành, So sánh vai trò, Truy vết nguồn, Phiên bản/diff và Dữ liệu chi tiết. Live đọc từ điển dùng chung có quyền truy cập. Hiển thị tham chiếu bản gốc, phần kế thừa và phần thay đổi. |
| Audit và bài học | Nhật ký từng lượt, findings, bằng chứng, kết quả kiểm từng cổng, bài học đang chờ/an toàn/áp dụng, trạng thái STOP, quyền và lý do mở lại. |
| Quản lý phiên | Danh sách phiên và lượt, tìm theo role, mở lại phiên, tạo phiên JD mới. Hiện chế độ Example/Live và phiên bản từ điển đầu lượt. |
| Xuất và khôi phục | Export JSON khung hiện tại, gói từ điển đã công bố, hoặc backup có lịch sử lượt theo quyền. Import có kiểm tra trước khi áp dụng. |

### 2.1 Trình xem từng nhịp trong block

- **Tiến 1 bước** mở ngăn từ bên phải và chọn đúng block tiếp theo. Desktop có ba cột **seed/bản ghi đang dùng → phép tính → đầu ra nháp**. Mobile có tab Seed, Phép tính, Output nháp với bộ điều khiển luôn thấy.
- Mặc định **thủ công** cho mỗi lần mở. Nút **Tiếp theo** có viền và xung sáng nhẹ liên tục khi đang chờ người dùng. Tôn trọng cài đặt giảm chuyển động bằng viền tĩnh. Nút **Tự động** bật/tắt ngay trong ngăn, có chỉnh tốc độ, tự dừng ở nhịp cuối. Có **Trước**, **Xem lại**, đóng và mở lại. Trang phía sau giữ vị trí cuộn.
- Trình tự từng block: nhận dữ liệu → đọc từng bản ghi/phiếu/hạng tử → nghiệm thu từng điều kiện → kết quả bàn giao. Nhịp hiển thị ID bản ghi, nội dung và trường được dùng, công thức, số được thay vào, mẫu số, giá trị **trước → sau**, output mục nào thêm, đổi hoặc giữ và vì sao.
- Ví dụ B1 nhịp đọc JD thứ hai hiện `1 + 1 = 2`, tỷ lệ trên 2 bản đã đọc, số JD toàn lô và danh sách JD đã xét. B5 hiện tử số thay đổi, mẫu số cố định từ B2 và danh sách liên kết đang hình thành. B6 hiện từng phiếu và số khớp thay đổi qua mỗi lần đọc.
- Cổng nghiệm thu hiện thực tế, điều kiện và bằng chứng, rồi đánh dấu từng dòng. Nút **Đã hiểu** hiện ở cuối, xác nhận người dùng đã xem và mở khóa điều hướng tới block tiếp. Đóng ngăn hoặc tải lại giữ cursor. Cổng thất bại vẫn giữ trạng thái chặn sau khi xác nhận.
- Example có thể dựng trace bằng phép tính trên fixture. Live lưu job, đầu ra nháp và các event thực thi/trình bày trên máy chủ. Tách trạng thái xem và trạng thái nghiệp vụ. Model có thể hoàn tất một job trước khi người dùng xem xong, ghi rõ thời điểm đã tính. Nút Tiếp theo chỉ phát lại event đã có hoặc tiếp tục phép tính đã định nghĩa. Dùng output có cấu trúc, căn cứ nguồn và phép tính công khai để giải thích, không phụ thuộc vào suy luận riêng tư của model.
- Khóa việc bàn giao ở cấp máy chủ cho đến khi block có kết quả và cổng hợp lệ. Đã hiểu chỉ là xác nhận xem. Việc công bố từ điển dùng hành động có quyền ở B8. Chọn block chưa chạy trong phiên Live mở mô tả và dữ liệu đã có. Chạy thử không phát sinh model call hoặc thay đổi dữ liệu khi chỉ mở card.

### 2.2 Đồ thị và tương tác

- Mạng 2D và 3D lấy chung tập node/cạnh theo cùng bộ lọc. Node là họ nghề, role, năng lực. Cạnh họ → role và role → năng lực rõ loại. Giữ các node khác ở chế độ mờ khi chọn một node. Có chế độ toàn mạng và xem vùng lân cận.
- Bấm node xem tên, ID, định nghĩa, bậc theo R, phạm vi dùng và profile liên quan. Bấm cạnh xem ngành, bậc, trọng số, dữ liệu nguồn và phép tính. Có lọc họ nghề, ngành, nhóm năng lực, phóng to, đổi góc, bật nhãn và toàn màn hình. 3D hỗ trợ xoay, pan, zoom và danh sách node có thể dùng bằng bàn phím. Tọa độ 3D chỉ phục vụ bố trí.
- Tab ma trận dùng heatmap và cho mở ô xem chi tiết. So sánh chọn hai profile, hiển thị các năng lực chung, mỗi bên và chênh lệch bậc/trọng số. View truy vết cho phép đi từ khung/chỉ báo tới JD hoặc sự kiện với phiên bản chính xác. Link nguồn cũ tiếp tục mở đúng snapshot lịch sử.
- Công thức catalog mẫu: `s = importance × (mentions / totalSources) × criticality`, `weight = s / Σs` trong một profile và `core = importance ≥ 4 OR criticality ≥ 4`. Bộ lọc không đổi mẫu số. Cạnh role–C trên toàn mạng là trung bình trọng số trên các profile đang xét của role, tính 0 khi profile không có C. So sánh có Jaccard theo trọng số `Σmin(wA,wB)/Σmax(wA,wB)`. Tổng mẫu số bằng 0 hiển thị không tính được. Rating và trọng số catalog là tham số seed. Trong Live, chỉ hiển thị điểm khi công thức, đầu vào và nguồn được cấu hình và truy vết.

## 3. Phiên và lượt chạy

| Khái niệm | Quy tắc |
| --- | --- |
| Workspace | Ranh giới dữ liệu và quyền. Một workspace có từ điển dùng chung, các phiên và lịch sử công bố. |
| Phiên | Hồ sơ công việc có tên, role, họ nghề/ngành tùy chọn, mục đích và danh sách bộ JD. Một phiên có nhiều lượt. |
| Bộ JD | Phiên bản tập tài liệu cho phiên. Cập nhật JD tạo phiên bản mới, giữ liên kết tới bản trước. Một tệp có thể được tham chiếu từ nhiều bộ nếu quyền phù hợp. |
| Lượt chạy | Chụp và khóa phiên bản bộ JD, bản chụp nguồn, phiên bản từ điển, policy, cấu hình model và lesson ngay từ đầu. Trạng thái và event theo từng block. |
| Lần thử block | Retry có mã mới và tham chiếu lần trước. Chỉ tái dùng kết quả các bước không bị ảnh hưởng theo phụ thuộc đã ghi nhận. |
| Phiên bản từ điển | Kết quả công bố vào workspace qua B8. Có mã phiên bản cha và diff. Các lượt đang chạy tiếp tục đọc phiên bản đã khóa. |

**Default Example.** Luôn truy cập được qua bộ chọn phiên. Reset đưa riêng phiên mẫu về ban đầu. Cho phép lượt 1 và lượt 2 để quan sát việc tái sử dụng. Dữ liệu demo có namespace riêng cho cả engine và catalog. Giữ nguyên phiên mẫu khi người dùng thêm phiên Live.

**Phiên JD mới.** Luồng tạo: tên phiên → vị trí/role → mục đích và bối cảnh → thêm JD → xem trước → chọn phiên bản từ điển nền → B0. Mặc định Live dùng từ điển đã công bố gần nhất của workspace; workspace mới có từ điển rỗng. Catalog ví dụ có thể xem tham khảo cạnh Live dưới nhãn “seed”.

**Tạo lượt mới.** Có lựa chọn “Dùng lại bộ JD”, “Bổ sung JD” và “Chạy lại theo phiên bản mới”. Chỉnh sau khi khóa giữ lại snapshot cũ và tạo lượt mới. “Bắt đầu lại” trong Live tạo lượt mới với bộ JD đã chọn và giữ lịch sử, tránh ngữ nghĩa xóa dữ liệu. Tải lại trang, mở lại ngày khác hoặc đổi thiết bị tiếp tục ở trạng thái đã lưu.

## 4. Nhập JD tùy chỉnh

- MVP: dán văn bản và tải nhiều `.txt`, `.md`, `.pdf` có text, `.docx`. Cho user đặt tên, role, nguồn gốc/tổ chức nếu biết, ngành, thời điểm, ngôn ngữ, ghi chú quyền sử dụng. Mỗi bản dán có source ref nội bộ và người gửi. URL nguồn là metadata tùy chọn. Nếu triển khai lấy nội dung từ URL hoặc OCR, hiển thị lỗi và cho người dùng đối soát bản trích.
- Màn xem trước cho thấy nội dung trích, số trang hoặc đoạn, lỗi font/mã hóa, tài liệu rỗng, bản trùng, các trường cần hoàn thiện. Chỉ nhận nội dung khi người dùng xác nhận phiên bản. Giới hạn số file, dung lượng và độ dài do cấu hình triển khai, hiện trước lúc tải.
- Mỗi tài liệu có `document_id`, `document_version`, `source_kind`, `source_ref`, `original_name`, `content_sha256`, văn bản chuẩn hóa có phiên bản, `origin_group` khi xác định được, `submitted_by/at`, `role_id`, ngôn ngữ, trạng thái kiểm. Lưu file gốc theo chính sách lưu trữ; giữ văn bản đã trích để truy vết.
- Đoạn căn cứ có `evidence_id`, tham chiếu phiên bản JD, trang/đoạn, `start/end` theo quy ước offset đã công bố, trích đoạn và hash. Khi đổi parser hoặc chuẩn hóa phải ghi phiên bản để offset lịch sử vẫn đúng. Dùng hash phát hiện trùng byte, phát hiện bản gần trùng bằng đề xuất kiểm riêng. Chỉ đếm nguồn độc lập khi có căn cứ xác định origin group.
- Nội dung JD đi vào model dưới dạng dữ liệu. Agent chỉ nhận các đoạn được cấp cho bước hiện tại, quyền gọi công cụ và ghi dữ liệu do server kiểm. Cho phép xem lại và loại thông tin cá nhân không cần thiết trước khi chạy. Kiểm quyền đọc và xuất ở máy chủ.

## 5. Dây chuyền B0–B8

| Bước | Đầu ra và phép kiểm trong Live | Diễn giải cần hiện |
| --- | --- | --- |
| B0 · Chốt phạm vi | A9/A0 tạo charter, khóa role, mục đích, bộ JD, phiên bản lõi, luật, provider/model, lesson và quyền. Bộ kiểm xác nhận từng trường và phiên bản. | Trường bắt buộc, giá trị thực, trạng thái và lý do thiếu. |
| B1 · Thu và kiểm JD | A1 xử lý nguồn, parse, trùng và phạm vi. `valid += 1[đạt luật]`, `traceRate = JD hợp lệ có nguồn / JD hợp lệ`. Báo origin groups riêng. | Từng JD, số đếm cộng dồn, lý do loại, cổng số lượng theo policy. Mẫu số bằng 0 là chưa đánh giá. |
| B2 · Neo nghề và nhiệm vụ | A1 trích vai trò và nhiệm vụ có nguồn, hợp nhất bản tương đương. Mã chuẩn có hệ mã/phiên bản/căn cứ hoặc trạng thái chưa xác minh. Khóa danh sách nhiệm vụ trước B5. | Trích đoạn → task → ID, nguồn/trọng số. Tổng trọng số tính từ nhiệm vụ đã khóa. |
| B3 · Mã hóa ứng viên | A2 gửi đoạn JD thật vào model để trích năng lực, ánh xạ C hiện có hoặc đề xuất mới. Server kiểm quote/offset và schema, kiểm trùng. Nếu có gold độc lập, tính `P=TP/(TP+FP)`, `R=TP/(TP+FN)`, `F1=2TP/(2TP+FP+FN)` theo ghép một đối một đã định nghĩa. | Ứng viên qua từng JD, ID đề xuất, cạnh nguồn, gộp/khác nghĩa, reuse/update/add. Thiếu gold thì các chỉ số so gold là chưa đánh giá. |
| B4 · Sự kiện và căn cứ | A3/A4/A5 nhận sự kiện thật do user cung cấp nếu có, hoặc đề xuất giả thuyết với nhãn rõ. Kiểm nguồn hỗ trợ mệnh đề. JD là bằng chứng về yêu cầu nêu trong JD. | Loại nguồn, tình huống/hành động/kết quả nếu thực sự thu được, mẫu số phủ căn cứ. Nếu policy cho phép JD-only thì đánh dấu các phép kiểm sự kiện không áp dụng kèm lý do. |
| B5 · Chọn và đề xuất bậc | A6/A7 lập ma trận task–C, chọn năng lực và lưu lý do. `coverage=Σ(w_task × 1[có C được chọn và có cạnh hợp lệ])/Σw_task`. Giữ danh sách task trọng yếu bị hở. Chỉ đề xuất bậc nếu có rubric và căn cứ. | Cộng từng hạng tử, coverage cộng dồn, phép thử bỏ 1 C, phiếu bậc và trung vị nếu có thang và phiếu hợp lệ. Bậc thiếu căn cứ hiển thị chưa xác định. |
| B6 · Viết chỉ báo và kiểm | A8 soạn hành vi quan sát được, lưu C và chỉ báo theo phiên bản. Khi có retranslation, reviewer độc lập nhận chỉ báo đã ẩn đáp án dự kiến, các nhãn ứng viên và rubric. Đếm đúng C, đúng bậc và đúng cả cặp với mẫu số định trước, ghi phiếu abstain. Khi SOP đòi hỏi reviewer người, kết quả AI thuộc lớp sàng trước. | Câu chỉ báo, phiên bản, gói đã ẩn đáp án, từng phiếu sau khi đã khóa, số trước/sau và tiêu chí từng item. Có vòng sửa → phiên bản mới → kiểm lại. |
| B7 · Thẩm định | Tổng hợp kết quả cổng bắt buộc, tính đầy đủ nguồn, nhất quán phiên bản và phạm vi sử dụng. Quy tắc AND cho các cổng bắt buộc, giữ quyền duyệt theo policy. | Danh sách từng cổng và bằng chứng. Trạng thái đạt, chờ dữ liệu, cần sửa hoặc chặn. |
| B8 · Hồ sơ và ghi lõi | A9 tạo candidate diff. AU kiểm hồ sơ đã hoàn tất, người có quyền quyết công bố nội bộ khi đủ điều kiện. Registry kiểm phiên bản cha và ghi nguyên khối các bản ghi/diff/lịch sử. Sau công bố kiểm receipt, AU có thể hậu kiểm log phát hành đã đóng. | Dự kiến và đã ghi phân biệt rõ. Số ADD/UPDATE/REUSE, ID và phiên bản thay đổi, kết quả audit, người quyết và receipt. |

- Cổng có `PASS | FAIL | NOT_EVALUATED | NOT_APPLICABLE`, kèm trị thực, tiêu chí, input refs và phiên bản luật. Chỉ coi không áp dụng là hợp lệ khi policy cho phép và có lý do. Trạng thái cổng chính sách ở chế độ thật lấy từ dữ liệu kiểm, không đặt sẵn theo kết quả Example.
- B3 thực hiện truy xuất C từ phiên bản nền theo tên/alias và định nghĩa, có thể dùng embedding để tìm ứng viên. Kết quả so khớp kèm ranh giới nghĩa, cạnh nguồn, độ chắc và phương án nếu không chắc. Tên giống chưa đủ để gộp. Một đề xuất sửa định nghĩa dùng chung phải liệt kê các khung bị ảnh hưởng trước khi duyệt.
- B6 ghi rõ chỉ số tính theo đúng nhãn dự kiến hay đồng thuận giữa reviewer. Ví dụ 2/3 = 66,7%, không đạt ngưỡng 70% nếu policy thực sự dùng ngưỡng đó. Kappa cấp lô là thống kê riêng, không thay cổng từng item. Trường hợp JD-only thiếu bằng chứng hoặc phiếu vẫn lưu được bản nháp có nguồn để tiếp tục xây từ điển.
- Nhánh nhanh có sau B3. Phiên mẫu hiển thị bản thử danh sách năng lực và pilot seed 9/12. Live tạo ứng viên thử nếu được phép, ghi phạm vi phát triển, nguồn và phần chưa kiểm, không ghi W/C/R từ nhánh này. Dữ liệu phản hồi thuộc V, có mục đích và nhãn riêng.

## 6. Thế nào là chạy AI thật

1. Máy chủ có adapter provider/model cấu hình bằng biến môi trường hoặc kho bí mật. Ưu tiên một provider làm được end-to-end trước. Chỉ truyền văn bản JD vào provider sau khi người dùng chọn chạy và màn hình đã nêu provider cùng phạm vi dữ liệu gửi. Secret không xuống trình duyệt, log hoặc export.
2. Job nhận snapshot và thực hiện tác vụ trích nhiệm vụ, ứng viên năng lực, đề xuất mapping và soạn chỉ báo từ nội dung thật. Model trả JSON theo schema bắt buộc. Mỗi ứng viên và link cần evidence refs. Log giữ metadata model, phiên bản prompt/rubric, thời gian, số lần gọi, usage và trạng thái. Có giới hạn thời gian, kích thước, ngân sách và cơ chế thử lại.
3. Server kiểm output và tính chỉ số từ chính dữ liệu đầu ra có cấu trúc. Tách điểm do model đề xuất khỏi trị đo được. Lưu output đã nhận với attempt ID để replay trace. Nếu cần trích dẫn, kiểm trích đoạn tồn tại trong snapshot. Kiểm trích dẫn tồn tại và kiểm nó hỗ trợ mệnh đề là hai phép kiểm riêng.
4. Nếu chưa cấu hình AI, khóa chạy Live và hiện cách cấu hình. Nếu model lỗi, timeout hoặc JSON sai, hiển thị lỗi, cho thử lại từ bước đủ điều kiện. Progress hiện **Đang chờ / Đang tính / Chờ xem / Cần bổ sung / Chặn / Đạt**. Hai lần bấm hoặc tải lại không tạo hai job/cùng một attempt. Không dùng fallback seed cho Live.
5. Dùng văn bản và bằng chứng thực để dựng output. Kiểm nghiệm bằng hai bộ JD khác nội dung của cùng role, kiểm số request thật, căn cứ đầu ra và phần thay đổi. Giữ fixture/mock chỉ trong kiểm thử. Một JD có thể làm nháp, số nguồn tối thiểu cho mục đích khác do policy quy định, không kế thừa mặc định sáu JD của demo.

## 7. Lược đồ từ điển và tích lũy

| Khối | Thực thể và thuộc tính tối thiểu |
| --- | --- |
| W | `role_id, role_version, title, family_id, grade, context`; task có ID, phiên bản, câu nhiệm vụ, trọng số nếu có, evidence refs. |
| C | `competency_id, competency_version, label, definition, group, aliases, status`; indicator có `indicator_id, indicator_version, competency_ref, statement, anchor_level?, evidence_refs, evaluation_ref?`. |
| R | `framework_id, framework_version, role_ref, context, purpose`; mỗi requirement khóa C và indicator theo phiên bản, `required_level?`, trọng số tùy chọn, lý do, task refs và evidence refs. |
| V | Source, bản chụp tài liệu, đoạn nguồn, sự kiện, kết quả thử, phiếu và lớp bằng chứng. Mỗi record lưu provenance, nguồn thực/seed/giả thuyết và phạm vi sử dụng. |
| G | Policy, release, quyết định nghiệm thu, actor, diff, receipt, finding, lesson và trạng thái an toàn. |

- ID C bền vững ở cấp workspace, có thể dùng UUID và mã hiển thị riêng. Cùng định nghĩa cho nhiều role dùng chung ID. Bậc yêu cầu của role thuộc R. Neo độ khó của hành vi thuộc indicator. Chỉnh bậc R hoặc sửa chỉ báo tạo phiên bản đúng thực thể. Thay đổi định nghĩa C mới tăng phiên bản C. Các khung cũ luôn trỏ được bản cũ.
- **ADD** khi có khái niệm mới đủ căn cứ. **REUSE** tham chiếu nguyên phiên bản được chấp nhận, có thể tạo link R và bằng chứng mới. **UPDATE** tạo phiên bản mới của đúng thực thể và ghi diff. Khi chưa chắc tương đương dùng “Cần xem xét”, giữ riêng trong draft. Việc thêm alias, merge, deprecate đều có lịch sử và giữ được khả năng truy vết.
- B8 đưa ra gói đề xuất có lý do cho từng thay đổi và danh sách role chịu ảnh hưởng. Người có quyền có thể chấp nhận toàn gói hoặc bỏ mục không cần, sau đó hệ thống kiểm lại tính đầy đủ và ràng buộc tham chiếu. Tồn tại hai lớp từ điển nháp theo lượt và từ điển đã công bố theo workspace.
- Ví dụ Live: phiên PO nhập JD có hành vi đo sản phẩm, tạo C “Đo lường giá trị” từ các đoạn nguồn và công bố nội bộ. Phiên Data Analyst sau đó có JD nêu đo hiệu quả thử nghiệm. Với cùng nội hàm, dùng lại C chung và ghi yêu cầu, bậc nếu đủ căn cứ, chỉ báo và nguồn phù hợp trong R của Data Analyst. Nếu JD nói giám sát chất lượng dữ liệu, vẫn có thể tạo C khác nếu ranh giới và căn cứ khác. Graph thể hiện hai role chung một C khi thực sự dùng lại.
- Commit nguyên khối, kiểm `base_release_id`, khóa idempotency theo workspace + run + candidate, kiểm tham chiếu và trạng thái STOP trước ghi. Xung đột 2 phiên báo phiên bản nền đã đổi và yêu cầu so lại diff trên nền mới. Khôi phục bằng release mới tham chiếu bản cũ hoặc cơ chế rollback có log.
- Phần mở rộng có thể dùng PostgreSQL và object storage, hoặc lựa chọn tương đương hỗ trợ giao dịch, backup và khôi phục. Giữ JSON contract độc lập với bảng, storage path, model provider và framework. Dữ liệu thật lưu bền trên server theo workspace; trạng thái demo có thể dùng localStorage.

## 8. Audit, lesson và STOP

- Sự kiện append-only có workspace/session/run/attempt/block ID, thời gian máy chủ, actor, phiên bản model/prompt/policy, hash input/output, rule results và refs. Tách INPUT_LOCKED, JOB_RESULT, GATE_RESULT, CANDIDATE_READY, AUDIT, APPROVAL, RELEASE_COMMITTED và ACKNOWLEDGED. Quy tắc truy cập và bản lưu độc lập giúp kiểm toàn vẹn. Hash đối chiếu byte hoặc nội dung đã chuẩn hóa, không thay đánh giá nguồn.
- AQ theo dõi quyền, schema và cổng khi chạy. AU rà sau khi có hồ sơ ứng viên hoàn tất, đánh giá thứ tự, nguồn, nội dung, quyền, lặp lỗi và toàn vẹn dữ liệu. Sau ghi, đối chiếu receipt/phiên bản. Finding có điều mong đợi, điều quan sát, refs, ảnh hưởng, mức độ, tái tạo, owner. Mỗi lô có tối thiểu một kết luận kiểm toán có căn cứ, kể cả điểm cần cải tiến hoặc phạm vi chưa kiểm. Finding thực tế có thể bằng 0.
- Lesson có fingerprint, nguồn finding, điều kiện áp dụng, thay đổi đề xuất, test tái tạo và test chống tác dụng phụ, trạng thái và người quyết. A0/AQ nhận cảnh báo với bằng chứng, chỉ đưa lesson an toàn vào snapshot lượt sau. Lượt mới ghi danh sách lesson đã nạp và phiên bản rule.
- Vi phạm nghiêm trọng được kích hoạt STOP theo policy ở phạm vi workspace/lô bị ảnh hưởng, chặn cả hai nhánh và kiểm lại ngay trước ghi. Theo dõi số lỗi mới và lặp trên số cơ hội kiểm cùng loại, cấu hình ngưỡng theo baseline đã duyệt. Dữ liệu chưa đủ thì báo chưa đủ để đánh giá xu hướng. Mở lại cần quyết định của người có quyền và bằng chứng xử lý lesson liên quan. Job đang chạy có thể kết thúc kỹ thuật nhưng kết quả giữ trong draft khi bị STOP.

## 9. Export và chuyển hạ tầng

Ba lựa chọn:

1. **Xuất khung JSON**: một phiên bản R, các ID/phiên bản C và indicator ứng với R, nhiệm vụ và refs. Dành cho dùng khung ở hệ khác.
2. **Xuất từ điển đầy đủ**: gói portable của workspace gồm W/C/R/V/G đã công bố, mọi phiên bản cần để resolve tham chiếu, alias, diff, quyết định và metadata nguồn. Mặc định bao gồm các đoạn nguồn được phép xuất. Tùy chọn bỏ nội dung JD nhạy cảm, ghi manifest các refs đã lược và trạng thái `metadata_only`.
3. **Backup khôi phục**: toàn bộ gói từ điển, cùng sessions, JD revisions, run/block/attempt, review/audit/lesson, input/output và file nguồn theo quyền. Cho chọn phạm vi và bật bao gồm bản gốc. Giao diện hiện rõ mức hoàn chỉnh để người dùng chọn đúng gói.

### 9.1 Định dạng gói

ZIP thư mục chuẩn và JSON UTF-8. Thứ tự record chỉ để tiện so sánh. Khóa đối chiếu là ID kèm phiên bản. Ví dụ:

```text
manifest.json
data/W.jsonl
data/C.jsonl
data/indicators.jsonl
data/R.jsonl
data/V.jsonl
data/G.jsonl
runs/sessions.jsonl
runs/jd_revisions.jsonl
runs/attempts.jsonl
runs/events.jsonl
blobs/<sha256>               # khi được chọn
schemas/*.schema.json
README.md
```

- Manifest có `format: competence-lab-bundle`, `schema_version`, `export_kind`, `exported_at` UTC, `workspace_id`, `release_id`, `scope`, số đếm mỗi loại, danh sách file (đường dẫn tương đối, bytes, sha256), tùy chọn redaction và refs bị lược. Các thành phần runs/blobs chỉ xuất hiện khi thuộc phạm vi. Record có ID, version, refs và timestamp. Chọn một phiên bản schema ban đầu và mô tả cách đọc độc lập.
- Secret, API key, access token, session cookie và path tuyệt đối của máy chủ không xuất. Có bản chỉ metadata cho dữ liệu nguồn cần hạn chế chia sẻ. Backup đầy đủ coi là dữ liệu nội bộ và chỉ xuất theo quyền workspace. Gói export dùng một snapshot nhất quán trong suốt quá trình dựng.
- **Nhập thử** kiểm schema version, checksum, kích thước, đường dẫn, ID trùng, ref thiếu và release lineage. Báo trước counts/duplicates/conflicts, phần nguồn bị lược và nhánh lịch sử có thể phục hồi. Hash sai hoặc ref bắt buộc thiếu chặn import. Schema cũ có migration rõ ràng, phiên bản mới chưa hỗ trợ thì báo chính xác version.
- MVP có hai chế độ an toàn: khôi phục vào workspace rỗng giữ nguyên ID/version, và tải lại cùng bundle vào workspace đã nhập để xác nhận idempotency. Gặp cùng ID/version khác nội dung thì hiển thị conflict và chặn ghi. Hợp nhất hai workspace độc lập có thể là tính năng sau MVP. Sau import, mở graph và khung lịch sử, kiểm checksum và đối chiếu truy vết. Import chạy nguyên khối hoặc giữ staging đến lúc áp dụng. Cùng export phải khôi phục được trên môi trường sạch và tạo lượt Live mới kế thừa C đã nhập.

## 10. Khuyến nghị API và quyền

Tên endpoint có thể thay đổi theo framework. Hợp đồng nghiệp vụ giữ các thao tác dưới đây.

| Thao tác | Input chính | Kết quả |
| --- | --- | --- |
| Tạo phiên, cập nhật bộ JD | Metadata, nội dung hoặc file refs | Session/phiên bản bộ JD, preview và lỗi parse |
| Tạo lượt | Session, bộ JD, policy, base release | Run snapshot |
| Chạy block / retry | Run, block, idempotency key | Job/attempt, event và output có cấu trúc |
| Lấy state / event | Run ID, cursor event | Trạng thái và phần event tiếp theo |
| Xác nhận đã xem | Run, block, attempt, cursor | Receipt xem, không ghi từ điển |
| Review và công bố | Candidate ref, quyết định, expected base | Release receipt hoặc conflict |
| Export | Workspace, release, phạm vi, chế độ | Gói tải được và manifest |
| Import preview / commit | Bundle ref, mode, digest preview | Báo cáo hoặc receipt nhập |
| STOP / mở lại / SAFE | Scope, finding/lesson refs, lý do | Sự kiện quản trị có người quyết |

Tối thiểu quyền **Xem**, **Vận hành phiên**, **Duyệt công bố và lesson**, **Quản trị backup**. Server xác định workspace và quyền từ phiên đăng nhập, không tin role hoặc scope do client gửi. Với bản chạy một người, vẫn giữ kiểm quyền và namespace dữ liệu để có thể mở rộng sau này. Phản hồi lỗi có mã, chi tiết có thể xử lý, ID lần thử và nút phù hợp để tiếp tục.

## 11. Phiên mẫu và cách tái lập

- Bộ sinh chính xác seed PO ở Phụ lục A, gồm cả văn bản, nhãn concept, nhiệm vụ, sự kiện, rating và từ điển đầu kỳ. Bộ sinh catalog ở Phụ lục B. Các khối JS này chỉ là dữ liệu và logic tham chiếu để tái tạo demo, có thể chuyển sang framework/language khác.
- Demo lượt 1: 8 JD, 6 nhiệm vụ và sự kiện, tổng trọng số 15. B3 có 7 ứng viên gồm alias stakeholder, 6 concept duy nhất, precision 6/7 và recall seed 6/6. B5 gộp trùng muộn, tích lũy coverage 3/15, 6/15, 9/15, 11/15, 13/15, 15/15. B6 hiện phiếu fixture `[ID, ID, ID]` và ngưỡng demo 70%, với nhãn phiếu seed gán sẵn để giải thích phép đếm. B8 phiên bản 1.0 có 6 C, 4 ADD, 2 UPDATE và finding LL-001 liên quan khử trùng muộn.
- Demo lượt 2: 11 JD, 7 nhiệm vụ/sự kiện, thêm C07, mẫu số coverage 19. Lesson LL-001 đã an toàn nên B3 khử trùng sớm. C04 có rating `[4,4,3]` → `[3,4,4]` → bậc 4, chỉ báo bổ sung đánh giá tác động có nhóm đối chiếu khi phù hợp. Lõi 1.1: 1 ADD, 1 UPDATE, 5 REUSE. Giữ R 1.0 và R 1.1. Có lỗi mô phỏng mất nguồn tại B1 hoặc ghi trái quyền tại B6, khóa cả hai nhánh và cho phục hồi có dấu vết.
- Catalog: 5 họ nghề, 10 role, 4 bối cảnh ngành, 21 C và 40 profile gồm 10 gốc và 30 biến thể. Profile seed có 20 nguồn giả lập. View toàn mạng mặc định dùng profile ngành, cho 36 node và 134 cạnh; lọc sản phẩm số + tài chính còn 3 role. Nhóm FND/LDR/PRO/MC và metadata seed giữ nguyên.

## 12. Nghiệm thu sản phẩm

| Mã | Thực hiện và kết quả phải thấy |
| --- | --- |
| A01 | Mở lần đầu vào Default Example, chạy offline đủ hai lượt và đối chiếu các số ở mục 11. Export khung 1.0 sau khi chạy 1.1 vẫn đọc đúng bậc 3 của C04. |
| A02 | Mỗi click Tiến 1 bước mở đúng ngăn, mặc định thủ công. Xem 2 JD liên tiếp, kiểm thay đổi bộ đếm. Tải lại giữa block tiếp tục đúng cursor. Chế độ tự động dừng để xác nhận. |
| A03 | 2D/3D có cùng node/cạnh/trọng số, chọn cạnh và xem refs. Kiểm ma trận, filter, so sánh, xem màn hình điện thoại không tràn ngang toàn trang. |
| A04 | Thêm JD bằng dán và file, sửa tạo JD revision, kiểm lỗi parse, trùng và nguồn. Phiên đã khóa giữ đúng nội dung trước khi sửa. |
| A05 | Hai phiên Live với JD khác nhau thực sự gọi model. Đọc được Job/attempt, bằng chứng trích nguyên đoạn, output khác theo dữ liệu, và trạng thái chưa kiểm chứng ở cấp phù hợp. Thử thiếu API key và lỗi trả schema, UI giữ bản nháp và hiện lỗi. |
| A06 | Lượt thứ hai dùng từ điển đã công bố, thấy reuse đúng một C chung và R riêng. Từ khóa gần nghĩa có thể vào chờ xem xét. Phê duyệt thay đổi cho phép thấy diff và phiên bản cũ. |
| A07 | Chạy nhánh nhanh, lỗi gate, STOP hoặc hủy giữa chừng. Đối chiếu lõi và receipt để xác nhận chỉ các commit đủ điều kiện xuất hiện. Retry commit không nhân đôi, hai lượt cùng base phát hiện conflict. |
| A08 | Export backup từ môi trường A, nhập thử rồi phục hồi vào B rỗng. So counts, ID/version, diff, hash và đồ thị, mở bằng chứng lịch sử và chạy lượt mới từ C đã phục hồi. Thử chỉnh một byte và thử cùng ID khác nội dung để kiểm cơ chế chặn. |
| A09 | Phiên mẫu không đi vào từ điển Live. Người xem không có quyền duyệt hoặc tải gói đầy đủ. Kiểm log và export không chứa bí mật. |

**Trình tự triển khai gợi ý:** tái tạo giao diện và chạy fixture → phiên/bộ JD/versions → Live B0–B8 có evidence → kho từ điển và công bố → export/import → kiểm đầu cuối bằng các ca trên.

## Phụ lục A Seed Product Owner gốc

Dùng `seed(1)`, `seed(2)` và `initial()` để tái tạo input và trạng thái đầu.

```js
const clone=x=>JSON.parse(JSON.stringify(x));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const defs=[['C01','Tầm nhìn sản phẩm','vision'],['C02','Ưu tiên backlog','priority'],['C03','Khám phá nhu cầu','discovery'],['C04','Đo lường giá trị','metrics'],['C05','Quản trị stakeholder','stakeholder'],['C06','Quản lý vòng giao hàng','delivery'],['C07','Quản trị AI và dữ liệu','governance']];
const tasks=defs.map((d,i)=>({id:'T'+(i+1),name:['Định hướng sản phẩm','Ưu tiên giá trị','Kiểm chứng nhu cầu','Đo kết quả sản phẩm','Thống nhất stakeholder','Đưa giá trị đến người dùng','Kiểm soát rủi ro AI'][i],concept:d[2],weight:[3,3,3,2,2,2,4][i]}));
const clauses={vision:'Chuyển mục tiêu kinh doanh thành mục tiêu sản phẩm cho nhóm khách hàng cụ thể.',priority:'Sắp xếp backlog theo giá trị kỳ vọng, chi phí trì hoãn và rủi ro; ghi rõ đánh đổi.',discovery:'Lập giả thuyết nhu cầu, chọn khách hàng phỏng vấn và thiết kế phép thử để bác bỏ giả thuyết.',metrics:'Chọn metric kết quả, ghi baseline trước thử nghiệm và đọc dữ liệu sau phát hành.',stakeholder:'Tổng hợp nhu cầu xung đột của kinh doanh và kỹ thuật, chốt quyết định trong decision log.',delivery:'Làm rõ tiêu chí chấp nhận, thống nhất phạm vi sprint và kiểm tra giá trị bàn giao.',governance:'Phân loại dữ liệu tính năng AI, kiểm quyền truy cập và đặt điều kiện dừng thử nghiệm.'};
const makeJD=(i,round)=>{const skills=i===0?defs.slice(0,6).map(d=>d[2]):i%3===0?['vision','priority','metrics']:i%3===1?['discovery','stakeholder','delivery']:['priority','metrics','delivery'];return {id:`JD-${round}-${i+1}`,origin:`seed-company-${i+1}`,industry:i%2?'Fintech':'SaaS',role:'Product Owner',synthetic:true,source:`seed://round-${round}/jd/${i+1}`,skills,skillStatements:skills.map(concept=>({concept,text:clauses[concept]})),text:skills.map(c=>clauses[c]).join(' ')}};
function seed(round){let jds=Array.from({length:round===1?8:11},(_,i)=>makeJD(i,round));if(round===2)jds.slice(-3).forEach(j=>{j.skills.push('governance');j.skillStatements.push({concept:'governance',text:clauses.governance});j.text+=' '+clauses.governance});const situations=['Doanh nghiệp muốn tăng doanh thu nhưng chưa chọn phân khúc ưu tiên.','Ba bên yêu cầu ba hạng mục trong khi sprint chỉ đủ nguồn lực cho một.','Nhóm tin rằng khách hàng cần tính năng mới nhưng chưa có bằng chứng nhu cầu.','Tính năng đã phát hành nhưng nhóm chỉ báo cáo số lượt truy cập.','Kinh doanh muốn tăng tốc còn kỹ thuật yêu cầu xử lý nợ hệ thống.','Một hạng mục hoàn thành về kỹ thuật nhưng chưa có tiêu chí chấp nhận.','Một tính năng AI dự định dùng dữ liệu có thông tin khách hàng.'];return {label:'DỮ LIỆU TỔNG HỢP · không phải khảo sát thực tế',jds,tasks:clone(tasks.slice(0,round===1?6:7)),events:defs.slice(0,round===1?6:7).map((d,i)=>({id:`EV-${round}-${i+1}`,concept:d[2],source:`seed://round-${round}/event/${i+1}`,type:'synthetic_case',ratings:(round===2&&d[2]==='metrics'?[4,4,3]:[3,3,3]),ratingBasis:round===2&&d[2]==='metrics'?'Giả định seed: hai phiếu yêu cầu thiết kế đối chiếu và đánh giá tác động (4); một phiếu chỉ yêu cầu đối chiếu baseline (3).':'Giả định seed: cả ba phiếu gán mức thực hiện độc lập trong tình huống của vai trò (3). Không phải số được suy tự động từ mô tả.',situation:situations[i],action:clauses[d[2]],outcome:round===2&&d[2]==='metrics'?'Seed có baseline và đề xuất nhóm đối chiếu; bổ sung yêu cầu kiểm tra tác động.':'Sản phẩm công việc seed: '+['bản mục tiêu sản phẩm và giả thuyết giá trị','backlog có thứ tự và căn cứ đánh đổi','kế hoạch thử nhu cầu và tiêu chí bác bỏ','bảng metric kết quả và baseline','decision log ghi quyết định và bên liên quan','hạng mục có tiêu chí chấp nhận kiểm được','danh sách quyền truy cập và điều kiện dừng AI'][i]+'. Chưa có kết quả hiệu suất thực tế.'}))}};
const initial=()=>({version:'0.9',W:[],C:defs.slice(0,2).map(d=>({id:d[0],name:d[1],concept:d[2],version:1,indicators:[]})),R:[],V:[],G:[],lessons:[]});
```

## Phụ lục B Catalog liên ngành gốc

Bộ sinh catalog và các phép lọc, tổng hợp, so sánh của website hiện tại.

```js
(function(root){
const families=[['PRODUCT','Sản phẩm số'],['ENGINEERING','Phát triển phần mềm'],['DATA','Phân tích dữ liệu'],['SALES','Kinh doanh & dịch vụ'],['ANALYSIS','Phân tích nghiệp vụ']].map(([id,name])=>({id,name,synthetic:true}));
const industries=[['TECH','Công nghệ & dịch vụ số'],['FIN','Tài chính – ngân hàng'],['RETAIL','Bán lẻ'],['MANU','Sản xuất']].map(([id,name])=>({id,name,codeSystem:'internal_seed_only',note:'Bối cảnh ngành giả lập; chưa ánh xạ mã VSIC.'}));
const competencies=[['C01','Tầm nhìn sản phẩm','PRO'],['C02','Ưu tiên backlog','PRO'],['C03','Khám phá nhu cầu','PRO'],['C04','Đo lường giá trị','PRO'],['C05','Quản trị stakeholder','PRO'],['C06','Quản lý vòng giao hàng','PRO'],['C07','Quản trị AI và dữ liệu','PRO'],['F01','Đạo đức và trách nhiệm','FND'],['F02','Hợp tác liên chức năng','FND'],['F03','Hiểu và sử dụng dữ liệu','FND'],['L01','Định hướng đội ngũ','LDR'],['L02','Phát triển người khác','LDR'],['M01','Học và điều chỉnh cách làm','MC'],['C08','Thiết kế phần mềm','PRO'],['C09','Kiểm thử và chất lượng','PRO'],['C10','Phân tích dữ liệu','PRO'],['C11','Truy vấn và mô hình dữ liệu','PRO'],['C12','Phát triển cơ hội bán hàng','PRO'],['C13','Khám phá nhu cầu khách hàng','PRO'],['C14','Kiểm soát rủi ro nghiệp vụ','PRO'],['C15','Phân tích và cải tiến quy trình','PRO']].map(([id,name,group])=>({id,name,group,version:1,definition:'Khái niệm seed dùng chung: '+name.toLowerCase()+'. Yêu cầu cụ thể được gắn ở từng liên kết R.',synthetic:true}));
const specs=[['PO','Product Owner','PRODUCT','CV2',['TECH','FIN','RETAIL'],['C01','C02','C03','C04','C05','C06','C07']],['SPO','Senior Product Owner','PRODUCT','CV3',['TECH','FIN','RETAIL'],['C01','C02','C03','C04','C05','C06','C07']],['PM','Product Manager','PRODUCT','QL4',['TECH','FIN','RETAIL'],['C01','C02','C03','C04','C05','C06','C07']],['SE','Software Engineer','ENGINEERING','CV2',['TECH','FIN','MANU'],['C08','C09','C06','C07','C05']],['TL','Engineering Lead','ENGINEERING','QL4',['TECH','FIN','MANU'],['C08','C09','C06','C07','C05']],['DA','Data Analyst','DATA','CV2',['TECH','FIN','RETAIL','MANU'],['C10','C11','C04','C05','C07']],['SDA','Senior Data Analyst','DATA','CV3',['TECH','FIN','RETAIL','MANU'],['C10','C11','C04','C05','C07']],['SALES','Sales Consultant','SALES','CV2',['FIN','RETAIL'],['C12','C13','C04','C05','C14']],['BM','Branch Manager','SALES','QL4',['FIN','RETAIL'],['C12','C13','C04','C05','C14','C15']],['BA','Business Analyst','ANALYSIS','CV2',['TECH','FIN','MANU'],['C15','C05','C13','C02','C14']]];
const roles=specs.map(([id,name,family,grade,contexts,skills])=>({id,name,family,grade,contexts,skills,synthetic:true}));
const base={C01:[5,14,3],C02:[5,18,4],C03:[4,14,3],C04:[4,14,3],C05:[4,17,3],C06:[4,16,4],C07:[3,8,3],F01:[4,14,4],F02:[4,18,3],F03:[3,14,3],L01:[2,8,2],L02:[2,7,2],M01:[3,12,2],C08:[5,18,4],C09:[5,17,4],C10:[5,17,4],C11:[4,16,4],C12:[5,18,4],C13:[5,16,4],C14:[4,12,4],C15:[5,17,4]};
function inputs(role,industry,cid){let [importance,mentions,criticality]=base[cid];let level=role.grade==='CV3'?4:3;if(cid==='L01'||cid==='L02'){const lead=role.grade==='QL4';importance=lead?5:2;mentions=lead?17:5;criticality=lead?4:2;level=lead?4:1;}else if(role.grade==='QL4')level=['C08','C09','C11'].includes(cid)?3:4;if(industry==='FIN'&&['C07','C14','F01','C09'].includes(cid)){importance=5;criticality=5;mentions=Math.min(20,mentions+3);level=Math.min(5,level+1)}if(industry==='RETAIL'&&['C04','C12','C13','C05'].includes(cid)){importance=5;mentions=Math.min(20,mentions+2)}if(industry==='MANU'&&['C09','C15','C14'].includes(cid)){importance=5;criticality=5;mentions=Math.min(20,mentions+2)}if(industry==='TECH'&&cid==='C07'){importance=4;mentions=12}return {importance,mentions,totalSources:20,criticality,level}}
const profiles=[];for(const r of roles)for(const industry of ['BASE',...r.contexts]){const ids=[...new Set([...r.skills,...(industry==='FIN'?['C14']:[]),'F01','F02','F03','L01','L02','M01'])];const req=ids.map(id=>({id,...inputs(r,industry,id)}));const sources=Array.from({length:20},(_,i)=>({id:`CAT-${r.id}-${industry}-JD-${i+1}`,source:`seed://catalog/${r.id}/${industry}/jd/${i+1}`,synthetic:true,competencies:req.filter(c=>i<c.mentions).map(c=>c.id)}));const requests=req.map(c=>({...c,frequency:c.mentions/c.totalSources,score:c.importance*(c.mentions/c.totalSources)*c.criticality,core:c.importance>=4||c.criticality>=4,evidence:sources.filter(s=>s.competencies.includes(c.id)).map(s=>s.id)}));const sum=requests.reduce((a,c)=>a+c.score,0);requests.forEach(c=>c.weight=c.score/sum);profiles.push({id:`R-${r.id}-${industry}`,role:r.id,industry,version:'seed-1.0',type:industry==='BASE'?'Khung gốc liên ngành':'Biến thể ngành',context:industry==='BASE'?null:{type:'industry',id:industry},base:`R-${r.id}-BASE`,requirements:requests,sources,synthetic:true})}
for(const p of profiles){const base=profiles.find(x=>x.id===p.base);p.requirementsView='materialized_from_base_plus_overrides';p.overrides=p.industry==='BASE'?[]:p.requirements.flatMap(q=>{const old=base.requirements.find(o=>o.id===q.id);if(!old)return [{id:q.id,change:'ADD',after:q}];const fields=['importance','mentions','criticality','level'];const changes=fields.filter(k=>old[k]!==q[k]);return changes.length?[{id:q.id,change:'UPDATE',fields:changes,before:Object.fromEntries(changes.map(k=>[k,old[k]])),after:Object.fromEntries(changes.map(k=>[k,q[k]]))}]:[]});const r=roles.find(r=>r.id===p.role),first=roles.find(x=>x.family===r.family);p.derivedFromRole=r.id!==first.id?first.id:null;}
function filtered({family='all',industry='all',group='all'}={}){return profiles.filter(p=>(industry==='BASE'?p.industry==='BASE':p.industry!=='BASE')&&(family==='all'||roles.find(r=>r.id===p.role).family===family)&&(industry==='all'||p.industry===industry)).map(p=>({...p,requirements:p.requirements.filter(q=>group==='all'||competencies.find(c=>c.id===q.id).group===group)}))}
function summaries(ps,cid){const rs=[...new Set(ps.map(p=>p.role))].map(id=>{const all=ps.filter(p=>p.role===id),hits=all.filter(p=>p.requirements.some(q=>q.id===cid)),qs=hits.map(p=>p.requirements.find(q=>q.id===cid));return {role:roles.find(r=>r.id===id),profiles:hits,coverage:hits.length/all.length,weight:qs.reduce((s,q)=>s+q.weight,0)/all.length,levels:qs.map(q=>q.level)}}).filter(r=>r.profiles.length);const sectors=industries.map(i=>{const all=ps.filter(p=>p.industry===i.id),hits=all.filter(p=>p.requirements.some(q=>q.id===cid));return {industry:i,total:all.length,count:hits.length,coverage:all.length?hits.length/all.length:0,weight:all.length?all.reduce((s,p)=>s+(p.requirements.find(q=>q.id===cid)?.weight||0),0)/all.length:0}}).filter(s=>s.total);return {roles:rs,sectors}}
function compare(a,b){const ids=new Set([...a.requirements.map(c=>c.id),...b.requirements.map(c=>c.id)]),rows=[...ids].map(id=>({competency:competencies.find(c=>c.id===id),a:a.requirements.find(c=>c.id===id),b:b.requirements.find(c=>c.id===id)}));const intersection=rows.reduce((s,r)=>s+Math.min(r.a?.weight||0,r.b?.weight||0),0),union=rows.reduce((s,r)=>s+Math.max(r.a?.weight||0,r.b?.weight||0),0);return {rows,shared:rows.filter(r=>r.a&&r.b).length,jaccard:union?intersection/union:0}}
root.Catalog={version:'catalog-seed-1.0',families,industries,competencies,roles,profiles,filtered,summaries,compare};
})(typeof module==='object'?module.exports:window);
```
