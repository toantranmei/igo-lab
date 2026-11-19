# Competence Lab · Đặc tả nâng cấp

| | |
| --- | --- |
| Trạng thái | Bản 2, chờ duyệt. Chưa có dòng code nào được sửa theo tài liệu này |
| Ngày | 18/11/2026 |
| Nền | Nhánh `toantran.mei/feat-built-in`, commit `cc94b45` |
| Đích | Làm đủ toàn bộ white paper `docs/whitepaper/competence-lab-whitepaper.pdf` (chương 3–8, công thức (1)–(47)), theo chuẩn SOP |
| Giao diện | Wireframe `docs/wireframe/competence-lab-wireframe.html`. Mỗi phase dưới đây ghi rõ màn nào của wireframe nó làm |
| Thay cho | Bản 1 ngày 17/11/2026. Bản 1 đặt con người vào giữa dây chuyền; bản 2 theo white paper: con người chỉ ở hai đầu, các vòng kiểm ở giữa do agent độc lập làm |

---

## 1. Tóm tắt

Đặc tả có **6 phase, P0 đến P5**. Làm xong P5 là làm đủ white paper.

| Phase | Tên | Kết quả dùng được khi xong | Màn wireframe |
| --- | --- | --- | --- |
| **P0** | Theo dõi lượt và chặn thất thoát token | Biết lượt đang ở đâu, vì sao dừng, từng bước con xử lý dữ liệu thế nào; không lượt nào đốt hết hạn mức ngoài ý muốn | Gói 0: Lượt chạy, Chi tiết một bước, Khi lượt dừng, Lịch sử lượt; Trang demo |
| **P1** | Thiết kế AI tối ưu | Bộ 50–200 JD chạy xong trong một cửa sổ hạn mức; token giảm ≥ 90% | Tab Lời gọi AI; ước tính ở Đầu vào |
| **P2** | Công thức và cổng theo chuẩn ở cả 9 bước | Mọi công thức (1)–(37) được code tính; kiểm chéo bằng agent khác model; tầng phát hành do máy tính | Chi tiết một bước: Diễn biến dữ liệu, Kết quả và biểu đồ; Lượt chạy tự động (cột Kiểm chéo) |
| **P3** | Từ điển, phiên bản và duyệt ở đầu ra | Phiên bản ba số, khung ghim phiên bản, ghi chú phát hành, quay lui; người duyệt chấp nhận hoặc từ chối có lý do; mạng từ điển hiện thay đổi | Đầu vào, Kết quả và duyệt, Từ điển (7 góc nhìn + Bản phát hành + mạng cập nhật) |
| **P4** | Dữ liệu từ con người và nâng tầng | Nạp sự kiện hành vi, khảo sát ở đầu vào của lượt sau; khung lên tầng Sản phẩm thị trường khi đủ bằng chứng; agent được hiệu chuẩn với nhãn của người | Đầu vào mục 3; Kết quả (tầng) |
| **P5** | Sản xuất hàng loạt và chất lượng từ điển | Khung gốc, phái sinh, biến thể ngành; tỷ lệ trùng (43); chất lượng từ điển theo quý | Đầu vào (khung gốc gợi ý); Từ điển, So sánh vai trò |

Thứ tự và phụ thuộc:

```
P0 ──► P1 ──► P2 ──► P3 ──► P5
               │             ▲
               └──► P4 ──────┘
```

- P0 làm trước vì đang chặn dùng thật: lượt 175 JD đã tiêu 10,7 triệu token, 747 lời gọi bị từ chối sau khi hết hạn mức, và màn hiện tại không cho biết lượt đang ở đâu.
- P1 trước P2 vì P2 thêm các vòng kiểm ba ghế; chạy chúng trên cách gọi AI hiện tại sẽ nhân chi phí lên.
- P3 có thể làm song song với nửa sau của P2 (phần phiên bản không phụ thuộc công thức của B1–B6), nhưng màn Kết quả cần tầng phát hành của P2.
- P4 cần cổng và tầng của P2. P5 cần phiên bản và khung ghim của P3.

Mặc định đề xuất cho các quyết định còn mở ở mục 11; mọi phase dùng các mặc định đó cho tới khi chủ sản phẩm chốt khác.

---

## 2. Nguyên tắc chung

1. **Con người ở hai đầu.** Đầu vào: charter, bộ JD, dữ liệu do người thu (nếu có). Đầu ra: chấp nhận hoặc từ chối hồ sơ. Giữa hai đầu không bước nào chờ người (white paper 3.4). Bỏ hẳn trạng thái "CHỜ ĐÃ HIỂU", phát lại bắt buộc, "Giao bản thử nhanh".
2. **Kiểm chéo độc lập thay người kiểm giữa chừng.** Agent kiểm dùng model khác agent làm, không thấy kết quả của agent làm, nhận mục đã xáo và che mã. Mọi vòng kiểm ra một con số có ngưỡng (white paper 5.2).
3. **Code tính, AI phán đoán.** Mọi phép đếm, so chuỗi, thống kê, cổng, tầng, phiên bản do code tính. AI chỉ đọc mỗi tài liệu một lần và chỉ phán đoán trên danh sách đã rút gọn (white paper 8.4).
4. **Không bỏ cổng.** Thiếu dữ liệu thì ghi phiếu sai lệch; khung dừng ở tầng thấp hơn. Người duyệt không nâng được tầng (white paper 5.4).
5. **Một nguồn sự thật cho ngưỡng.** Ngưỡng nằm trong bộ chính sách có phiên bản, khóa vào snapshot của lượt.
6. **Mọi phép tính để lại bản ghi theo từng mục** (mục 3). Màn "Diễn biến dữ liệu" phát lại từ bản ghi này, không tự dựng số.
7. **Giữ các cam kết đã có:** truy nguồn tới đoạn JD, nhật ký chỉ ghi thêm có chuỗi băm, một cửa ghi vào từ điển, ghim phiên bản, lưu kết quả AI theo địa chỉ nội dung.
8. **Ràng buộc vận hành giữ nguyên:** chỉ worker gọi AI và gọi qua Claude CLI; worker không dùng `ANTHROPIC_API_KEY` hay `ANTHROPIC_AUTH_TOKEN`; web chỉ nghe 127.0.0.1; không ghi bí mật vào nhật ký hay bản xuất.

---

## 3. Bản ghi phép tính và sự kiện (dùng chung cho mọi phase)

Hai cấu trúc dữ liệu mới, tạo ở P0, được mọi phase sau ghi vào.

### 3.1 Sự kiện của lượt

Bảng `event` hiện có thêm các loại sự kiện:

| Loại | Khi nào | Trường bắt buộc |
| --- | --- | --- |
| `BLOCK_STARTED` | Worker nhận job của một bước | bước, lần chạy, lý do chạy (tự động, chạy tiếp, chạy lại), số mục cần xử lý |
| `STEP_PROGRESS` | Mỗi bước con xong, hoặc mỗi 5% lời gọi AI | bước con, đã xong / tổng |
| `BLOCK_DONE` | Bước xong | giờ xong thật, thời gian chạy, số lời gọi, token, chi phí quy đổi, kết quả cổng |
| `BLOCK_STOPPED` | Bước dừng giữa chừng | mã lý do (mục 4.3), câu giải thích, thao tác gợi ý, giờ hồi hạn mức nếu có |
| `RUN_WARNING` | Bất thường chưa tới mức dừng | mã cảnh báo, số đo, ngưỡng |

Sự kiện vẫn nối chuỗi băm như hiện nay (công thức (36)–(37)).

### 3.2 Bản ghi phép tính

Mỗi bước con ghi một danh sách bản ghi theo từng mục dữ liệu:

```
calc_record {
  attempt_id, step, substep,
  item_ref,          // JD, câu, ứng viên, chỉ báo… (mã ngắn + mã gốc)
  formula,           // số công thức trong white paper, ví dụ "20"
  inputs,            // giá trị đầu vào, ví dụ { seats: [4,4,5] }
  output,            // kết quả, ví dụ { mean: 4.33, s2: 0.33, rwg: 0.83 }
  decision,          // nếu có: giữ, loại + lý do, dùng lại, tạo mới…
  seat               // nếu là vòng kiểm: model của ghế
}
```

- Ghi dần trong lúc chạy, không chờ cuối bước. Thay cho cách hiện nay chỉ ghi `trace` một lần khi bước xong.
- Không lưu trạng thái tích lũy trong từng bản ghi (vết của B2 hiện nặng 41 MB vì lý do này). Mục tiêu: < 1 MB cho bước lớn nhất của bộ 200 JD.
- Không chứa dữ liệu cá nhân: mọi văn bản trong bản ghi lấy từ bản đã che.

---

## 4. P0 · Theo dõi lượt và chặn thất thoát token

**Mục tiêu.** Người vận hành biết lượt đang chạy tới đâu, vì sao dừng, từng bước con xử lý dữ liệu thế nào, và xem lại được mọi bước đã chạy. Không lượt nào đốt hết hạn mức ngoài ý muốn.

### 4.1 Worker

- P0.1 Ghi các sự kiện ở mục 3.1. Hiện không có sự kiện bắt đầu bước.
- P0.2 Ghi đúng giờ xong. Hiện `computedAt = now` được gán từ đầu `runAttempt` (`packages/pipeline/src/runtime.ts`, dòng 181 và 188 dùng giá trị lấy lúc bắt đầu), nên giờ xong sai và không tính được thời gian mỗi bước.
- P0.3 Ghi vết và bản ghi phép tính dần theo bước con (mục 3.2).
- P0.4 Lý do dừng có cấu trúc. Hiện chỉ có `run_auto.note` là một dòng chữ bị ghi đè ở `advanceAuto`.
- P0.5 Khóa job được gia hạn theo tín hiệu sống; job mồ côi tự xếp lại khi worker khởi động lại.

### 4.2 Ba sửa nhanh về token

| # | Sửa | Vì sao | Vị trí |
| --- | --- | --- | --- |
| P0.6 | Đưa danh sách năng lực dùng chung của T8 vào `--system-prompt`, user message chỉ còn nhiệm vụ; chạy một lời gọi làm nóng rồi mới song song. Kiểm bằng thử nghiệm 3 lời gọi trước khi áp dụng (plan P0, bước E) | CLI đặt điểm bộ đệm ở cuối user message nên phần chung ≈ 50 000 token bị ghi lại mỗi lời gọi (giá ×2), chỉ ≈ 1 169 token được đọc lại. (Bản trước ghi nguyên nhân là thứ tự khóa; sai, vì `canonicalJson` đã đặt danh sách năng lực lên trước.) T8 chiếm $22,39 / $40,54 của lượt | `packages/agents/src/runner.ts`, `packages/pipeline/src/blocks-b.ts:89` |
| P0.7 | **Cầu dao hạn mức:** lỗi "hit your limit" hoặc lỗi xác thực từ CLI dừng ngay cả bước, tắt chạy tự động, ghi giờ hồi | Lượt thật còn gọi thêm 747 lần sau khi hết hạn mức | `packages/agents/src/runner.ts`, `run-task.ts` |
| P0.8 | Ghi tách token ghi bộ đệm / đọc bộ đệm / thường / ra cho mỗi lời gọi và cộng theo bước | Cần thấy được vì sao tốn | `agent_call.usage` đã có số; thiếu phần cộng và hiển thị |

P0.6 là sửa tạm cho tới khi P1 thay T8 bằng E5.

### 4.3 Ngân sách và lý do dừng

- P0.9 Ước tính trước khi chạy: số lời gọi và token theo từng bước, tính bằng code từ số JD; hiện ở Đầu vào cạnh hạn mức còn lại.
- P0.10 Ngân sách token cho mỗi lượt và mỗi bước, thay `AGENT_MAX_CALLS_PER_RUN` (đếm lời gọi).
- P0.11 Cảnh báo bất thường: lời gọi có input > 8 000 token, hoặc bước có số lời gọi vượt ước tính 1,5 lần, thì dừng chờ xác nhận. Hai điều kiện này đủ để chặn lượt 175 JD ngay từ lời gọi T8 đầu tiên.
- P0.12 Bốn loại dừng, mỗi loại có câu giải thích và một thao tác chính:

| Mã | Ví dụ câu hiển thị | Thao tác |
| --- | --- | --- |
| `QUOTA` | Dừng ở B5 · hết hạn mức 5 giờ của Claude CLI. 107/270 lời gọi đã lưu. Hạn mức hồi lúc 02:30 | Chạy tiếp · Hẹn giờ chạy |
| `GATE` | Dừng ở B1 · cổng G1 chặn. Cần ≥ 15 JD hợp lệ và ≥ 5 P1; thực tế 11 và 3 | Xem phễu JD · Thêm JD |
| `AI_ERROR` | Dừng ở B3 · 3 lời gọi liên tiếp lỗi "claude thoát với mã 1" | Xem lời gọi lỗi · Thử lại |
| `PAUSED` | Tạm dừng theo yêu cầu, trước B6 | Chạy tiếp |

Thêm `BUDGET` (vượt ngân sách, P0.10) và `ANOMALY` (P0.11) cùng khuôn.

### 4.4 Giao diện

Theo wireframe, mục Gói 0:

- P0.13 **Lượt chạy** thay màn Dây chuyền sản xuất: banner lý do dừng; 6 chỉ số (bước đã xong, thời gian, lời gọi và số lỗi, token, chi phí quy đổi, % hạn mức); 9 dòng bước có cột cổng, thời gian, lời gọi, chi phí; bước đang chạy mở các bước con với thanh tiến độ. Bỏ sơ đồ hai làn, 5 nút chạy, khẩu hiệu đầu trang, mã nội bộ A0/AQ/AU ở lớp chính.
- P0.14 **Chi tiết một bước**, 5 tab:
  - Bước con: dòng thời gian từng bước con, đầu vào → đầu ra bằng số đếm, công thức với số thật, bảng cổng.
  - Lời gọi AI: thanh tách token, tiền theo tác vụ, trạng thái, bảng lời gọi lọc/sắp xếp được, xem đầu vào (đã che) và đầu ra; lỗi giống nhau gộp một dòng; xuất CSV.
  - Các lần chạy: mỗi lần chạy lại của bước, lý do, kết quả, số mục lấy từ kết quả đã lưu.
  - Kỹ thuật: mã tác vụ, mã băm vào/ra, phiên bản, dữ liệu thô (nội dung tab "Bản ghi đầy đủ" hiện tại).
  - Kết quả và biểu đồ: ở P0 hiện phần đã tính được; P2 bổ sung đủ.
- P0.15 **Khi lượt dừng**: banner theo mục 4.3 và nhật ký lượt lọc theo dừng, lỗi.
- P0.16 **Lịch sử lượt**: mở lượt cũ ra màn Lượt chạy ở chế độ chỉ đọc.
- P0.17 **Trang demo tách riêng**: chế độ Ví dụ hiện tại thành trang có đường dẫn riêng, giữ nguyên tính năng; màn thật không còn theo khuôn của nó.

### 4.5 Nghiệm thu P0

1. Trong lúc một bước chạy, màn Lượt chạy hiện đúng bước con và tiến độ, trễ không quá 5 giây.
2. Thời gian mỗi bước trên màn khớp hiệu giờ `BLOCK_STARTED` và `BLOCK_DONE`.
3. Giả lập lỗi hạn mức ở lời gọi thứ k: bước dừng trước lời gọi k + 3 (tính theo số luồng song song), banner `QUOTA` có giờ hồi.
4. Chạy lại T8 trên bộ 175 JD sau P0.6: token đọc bộ đệm mỗi lời gọi ≥ 40 000, token ghi bộ đệm chỉ ở lời gọi đầu.
5. Mở được mọi bước của một lượt đã xong, kể cả các lần chạy cũ.

---

## 5. P1 · Thiết kế AI tối ưu

**Mục tiêu.** Theo white paper chương 8: giảm ≥ 90% token so với thiết kế hiện tại, không hạ chất lượng đo trên bộ neo.

### 5.1 Bước code chạy trước AI

| Mã | Việc | Công thức |
| --- | --- | --- |
| K1 | Loại JD trùng gần đúng bằng Jaccard trên tập n-gram, ngưỡng cấu hình (đề xuất 0,85). Bản trùng kế thừa kết quả, vẫn được đếm làm bằng chứng | (4) |
| K2 | Che dữ liệu cá nhân (tên, số điện thoại, email người liên hệ) **trước** khi dựng input; lưu bản che riêng; AI chỉ nhận bản che | — |
| K3 | Mã ngắn trong mỗi lời gọi (`s1…`, `t1…`, `c1…`); code giữ bảng ánh xạ; JD gửi dạng dòng đánh số | — |
| K4 | Tra từ điển trước: câu khớp chắc chắn với nhiệm vụ, năng lực có sẵn không gửi AI để tạo ứng viên | (10) |
| K5 | Gom sơ bộ nhiệm vụ và ứng viên bằng độ giống văn bản | — |
| K6 | Cổng đuôi dài: chỉ cụm có trọng số bằng chứng đạt ngưỡng mới đi tiếp; phần còn lại lưu với nhãn "chưa đủ căn cứ" | (12) |
| K7 | Lọc câu chung chung ("thực hiện các công việc khác theo yêu cầu…") theo danh sách mẫu cấu hình được | — |

### 5.2 Agent

Theo bảng 8.1 của white paper:

| Agent | Thay cho | Bước | Model mặc định | Đơn vị gọi |
| --- | --- | --- | --- | --- |
| E1 Đọc JD | T1 + T2 + T4 | B1, B3 | Sonnet 5.5; Haiku 5.5 khi qua bộ neo | mỗi JD không trùng |
| E2 Neo nghề | mới | B2 | Sonnet 5.5 | 1 mỗi khung |
| E3 Duyệt cụm nhiệm vụ | T3 | B3 | Sonnet 5.5 | 1 mỗi 400 mục; chỉ trả phần sửa |
| E4 Duyệt cụm năng lực | T5 + T6 | B3 | Sonnet 5.5 | 1 mỗi 400 mục |
| E5 Ma trận nhiệm vụ × năng lực | T8 | B5 | Sonnet 5.5 | 1 mỗi 25 nhiệm vụ; danh sách năng lực là tiền tố cố định |
| E6 Soạn chỉ báo | T10 | B6 | Sonnet 5.5; Opus 5.5 cho phần viết lại | 1 mỗi 3 năng lực lõi |
| E7 Dịch ngược và xếp lớp | T11 | B6 | Haiku + Sonnet + Opus 5.5 | 3 mỗi khung |
| E8 Thẩm định | T12 | B7 | Opus 5.5 | 1 mỗi khung |
| E9 Mã hóa kiểm chéo | mới | B3 | Opus 5.5 (khác model của E1) | 1 mỗi 200 câu |
| E10 Chấm ưu tiên và bậc | T9 | B5 | Haiku + Sonnet + Opus 5.5 | 3 mỗi khung |
| S1, S2 Tìm JD | T14, T15 | B1 | giữ như hiện tại | theo lần quét |
| (bỏ) | T13 giả thuyết | — | — | — |

P1 dựng E1–E6 và E8. E7, E9, E10 có khung gọi ở P1 nhưng được nối vào cổng ở P2.

Mọi agent giữ: schema đầu ra đóng, kiểm tham chiếu bằng code, một lần sửa lỗi, lưu kết quả theo địa chỉ nội dung, phần chung của prompt đặt làm tiền tố để đọc bộ đệm.

### 5.2a Gom lời gọi: khoảng 14 lời gọi cho một khung

Số lời gọi tự nó không tốn nhiều; thứ tốn là nội dung bị gửi lặp lại và phần khung CLI (≈ 1 200 token) cộng vào mỗi lời gọi. Vì vậy agent được gom tới mức nhỏ nhất mà vẫn giữ được ba điều kiện: code tính cổng giữa các bước, agent kiểm độc lập với agent làm, và đầu ra không quá dài.

| # | Lời gọi | Nội dung | Số lời gọi (50 JD) |
| --- | --- | --- | ---: |
| 1 | E1 theo lô | 15–20 JD mỗi lời gọi (đã qua K1, K2, K8); trả về phạm vi, tiêu chí A–C, câu yêu cầu, nhiệm vụ, ứng viên, mã đoạn | 3 |
| 2 | E2 + E3 + E4 gộp | Cụm do code gom sẵn, năng lực gần nhất trong từ điển, danh sách mã nghề rút gọn; trả về phần sửa | 1 |
| 3 | E9 | Mã hóa lại 20% câu, model khác E1 | 1 |
| 4 | E5 | Ma trận nhiệm vụ × năng lực trên tập đã cắt đuôi | 1 |
| 5 | E10 | Ba ghế, ba model | 3 |
| 6 | E6 | Chỉ báo cho cả tập lõi trong một lời gọi | 1 |
| 7 | E7 | Ba ghế dịch ngược và xếp lớp | 3 |
| 8 | E8 | Thẩm định | 1 |
| | **Cộng** | | **≈ 14** (hiện tại 2 191; white paper 58) |

Thêm một bước code:

- **K8 Cắt phần không mô tả công việc** trước khi gửi: giới thiệu công ty, phúc lợi, cách ứng tuyển, địa chỉ. Đọc JD là phần lớn nhất của token sau P1, nên đây là đòn bẩy còn lại lớn nhất. Đoạn bị cắt vẫn lưu và vẫn truy nguồn được.

**Vì sao không dồn cả lượt vào một lời gọi:**

1. Các cổng phải do code tính **giữa** các bước. Ví dụ chỉ báo chỉ được viết cho 12–14 năng lực đã qua quy tắc giữ (21)–(23). Một lời gọi làm hết thì AI tự chọn và tự chấm, trái nguyên tắc 3.
2. Kiểm chéo cần agent khác model, không thấy kết quả của agent làm. Agent làm và agent kiểm không thể là cùng một lời gọi.
3. Đầu ra của cả khung dài vài chục nghìn token. Token ra đắt gấp 5 lần token vào, và đầu ra quá dài thì dễ bị cắt hoặc lỗi; hỏng một lời gọi là mất cả lượt.
4. Đọc quá nhiều JD trong một lời gọi làm giảm chất lượng trích ở các JD giữa danh sách. Lô 15–20 JD giữ được chất lượng mà vẫn ít lời gọi.

Ước tính cho bộ 50 JD: ≈ 160 nghìn token (so với ≈ 250 nghìn của bảng 5.2 và 10,7 triệu của lượt 16/11). Kích thước lô và việc gộp E2–E4 được nghiệm thu trên bộ neo; nếu chất lượng giảm thì tách lại.

### 5.3 Bộ neo

- P1.1 Bộ neo tối thiểu: 50 JD chuẩn có nhãn của người cho phạm vi, nhiệm vụ, ứng viên năng lực, cụm. Dùng để nghiệm thu P1 và để tính độ chính xác, độ đầy đủ, F1 (16).
- P1.2 Kết quả đo lưu theo (agent, model, phiên bản prompt). Agent chưa đạt ngưỡng đã chốt trước thì bị khóa.

### 5.4 Nghiệm thu P1

1. Bộ 50 JD chuẩn chạy hết B0–B8 với tổng token ≤ 10% số đo của thiết kế hiện tại trên cùng bộ (hiện 6,82 triệu). Ước tính theo white paper khi chạy qua CLI: ≈ 250 nghìn token, ≈ 1,0–1,1 USD quy đổi.
2. Không lời gọi nào có input > 8 000 token.
3. Chỉ số trên bộ neo không thấp hơn thiết kế hiện tại quá biên đã chốt.
4. Không đoạn văn nào gửi AI còn email, số điện thoại hay tên người liên hệ (test trên `agent_result.input_canonical`).
5. Chạy lại cùng bộ JD không phát sinh lời gọi mới.

---

## 6. P2 · Công thức và cổng theo chuẩn ở cả 9 bước

**Mục tiêu.** Mọi công thức (1)–(37) của white paper được code tính và ghi bản ghi phép tính; mọi cổng G0–G8 theo đúng ngưỡng; kiểm chéo bằng agent khác model.

### 6.1 Theo từng bước

| Bước | Việc | Công thức | Cổng |
| --- | --- | --- | --- |
| B0 | Charter đủ trường (vị trí, ngành, cấp bậc, mục đích, mức chặt chẽ, loại khung); bộ chính sách có phiên bản khóa vào snapshot; kiểm cặp agent làm / kiểm khác model ở mọi bước, cấu hình vi phạm bị từ chối | (1)–(2) | G0 |
| B1 | JD hợp lệ; trùng gần đúng (K1); chấm 5 tiêu chí A–E (AI gợi ý A, B, C; code tính D từ ngày đăng, E từ loại nguồn); lăng kính L, M; hạng P1/P2/P3 | (3)–(7) | G1: N ≥ 15 ∧ N_P1 ≥ 5 (8) |
| B2 | Mã nghề Việt Nam, ISCO-08, 1–4 nghề chuẩn ngoài có lý do; quy thang 0–100 về 1–5. Bỏ giá trị `UNVERIFIED` | (9) | G2 |
| B3 | Trọng số nhiệm vụ; điểm giống năng lực đã có; trọng số bằng chứng theo hạng nguồn; điểm thị trường; độ bao phủ thư viện; **E9 mã hóa lại 20% câu**, tính Cohen's kappa | (10)–(15) | G3: κ ≥ 0,61 |
| B4 | Ba làn bằng chứng (thật, mẫu, giả thuyết); chỉ làn thật được tính; đủ mẫu theo mức; chênh lệch nhóm xuất sắc / trung bình → ngưỡng hay tạo khác biệt | (17)–(19) | G4 (không áp dụng ở mức C) |
| B5 | **E10 ba ghế** chấm quan trọng, phân biệt, bậc; trung bình, s², rwg; quy tắc giữ; tập lõi 8–14 + ≤ 1 meta; độ phủ; thử bỏ một; bậc = trung vị, làm tròn về số nguyên 1–5 | (20)–(26) | G5 |
| B6 | E6 soạn 2–4 chỉ báo mỗi bậc 1, 3, 5; **E7 ba ghế** dịch ngược mù (xáo, che bậc) vào năng lực **và** bậc; p_i ≥ 0,70, phiếu trắng tính vào mẫu số; chỉ báo dưới ngưỡng viết lại (Opus) và xếp lại; xếp lớp I/II/III/Meta, Fleiss' kappa; ràng buộc năng lực – kết quả | (27)–(30) | G6 |
| B7 | E8 thẩm định độc lập (không làm bước nào trước); mẫu kiểm ⌈0,1·N⌉; 10 biến thẩm định; phát hiện mức cao làm lượt dừng | (31)–(33) | G7 |
| B8 | Tầng phát hành tính từ cổng và loại bằng chứng; hạn rà soát 12/24 tháng; chuỗi nhật ký | (34)–(37) | G8 |

### 6.1a Quy định ghế

"Ghế" là một người chấm độc lập trong các vòng kiểm cần ≥ 3 người theo chuẩn SOP. Trong dây chuyền tự động, mỗi ghế là **một lời gọi AI riêng**. Có hai vòng dùng ghế: E10 ở B5 và E7 ở B6.

**Điều kiện để một ghế hợp lệ:**

| # | Quy định | Kiểm bằng |
| --- | --- | --- |
| S1 | Mỗi ghế là một lời gọi riêng, ngữ cảnh mới; không thấy phiếu của ghế khác, không thấy đầu ra hay lập luận của agent làm | Code dựng input; không trường nào của ghế khác lọt vào |
| S2 | Ghế không cùng model với agent làm ra thứ được chấm (E7 Haiku chấm chỉ báo do E6 Sonnet viết) | Cổng G0, công thức (2) |
| S3 | Mỗi ghế một vai và một cách diễn đạt thang khác nhau (bảng dưới) | Ba câu lệnh có phiên bản riêng |
| S4 | Mỗi ghế nhận các mục theo một thứ tự xáo riêng; mã thật được che bằng mã ngắn ngẫu nhiên; bậc gốc của chỉ báo bị che | Code xáo theo seed ghi trong bản ghi phép tính |
| S5 | Mỗi ghế nhận thêm 2–3 **mục kiểm tra** có đáp án biết trước, trộn lẫn với mục thật. Ghế trả sai quá một mục kiểm tra thì phiếu của ghế đó bị loại và ghế chạy lại một lần | Code so đáp án |
| S6 | Đầu ra chỉ là điểm hoặc lựa chọn theo khuôn đóng, có thể bỏ trống; không cần giải thích | Schema đầu ra |
| S7 | Nếu ba ghế cho cùng một đáp án ở hơn 90% số mục, ghi cảnh báo "đồng thuận bất thường" vào hồ sơ cho người duyệt | Code đếm |

**Ba vai:**

| Ghế | Vai trong câu lệnh | Cách diễn đạt thang |
| --- | --- | --- |
| Ghế 1 | Quản lý trực tiếp của vị trí | Thang 1–5 diễn đạt theo hậu quả nếu thiếu năng lực |
| Ghế 2 | Chuyên gia nghề, đọc từ các nghề chuẩn ngoài | Thang 1–5 diễn đạt theo tần suất cần dùng trong công việc |
| Ghế 3 | Người đánh giá năng lực, tập trung vào hành vi quan sát được | Thang 1–5 diễn đạt theo mức khác biệt giữa người giỏi và người trung bình |

**Vòng E10 · chấm ưu tiên và bậc (B5).** Mỗi ghế nhận danh sách ứng viên (tên, định nghĩa, 2–3 đoạn căn cứ tiêu biểu) và trả cho mỗi ứng viên ba số nguyên: mức quan trọng 1–5, mức phân biệt 1–5, bậc yêu cầu 1–5. Code tính:

- trung bình x̄ và phương sai mẫu s² của ba điểm quan trọng;
- r_wg = max(0, 1 − s² / 2), với 2 là phương sai của phân bố đều trên thang 5 điểm (20);
- giữ khi x̄_quan trọng ≥ 3,5, x̄_phân biệt ≥ 3,0 và r_wg ≥ 0,70 (21);
- tập lõi 8–14, tối đa 1 meta (22)–(23); nếu nhiều hơn 14 thì xếp theo x̄_quan trọng rồi điểm thị trường S(c);
- bậc = trung vị ba điểm bậc (26). Ba số nguyên luôn có trung vị nguyên; ghế bỏ trống thì lấy trung vị của hai ghế còn lại và làm tròn lên.

Ví dụ: "Quản lý rủi ro dự án" được chấm quan trọng 4, 4, 5. Vậy x̄ = 4,33; s² = 0,33; r_wg = 1 − 0,33 / 2 = 0,83 → giữ. "Tư duy phân tích" được chấm 5, 4, 2. Vậy x̄ = 3,67; s² = 2,33; r_wg = 0 → loại, dù trung bình đạt ngưỡng.

**Vòng E7 · dịch ngược và xếp lớp (B6).** Mỗi ghế nhận toàn bộ chỉ báo của khung đã xáo và bị che bậc, cùng danh sách năng lực (chỉ tên và định nghĩa). Với mỗi chỉ báo, ghế chọn năng lực và bậc 1, 3 hoặc 5, hoặc bỏ trống. Ghế cũng xếp mỗi năng lực vào lớp I, II, III hoặc Meta. Code tính:

- p_i = số ghế chọn đúng **cả** năng lực **và** bậc / 3 (27). Phiếu trắng tính vào mẫu số. Chỉ báo có p_i < 0,70 được gửi lại E6 viết lại rồi xếp lại một lần; vẫn trượt thì bỏ chỉ báo đó;
- Fleiss' kappa cho việc xếp lớp (28): P_i = (Σ_j n_ij² − n) / (n(n − 1)) với n = 3 ghế; P̄ là trung bình P_i; P̄_e = Σ_j p_j²; κ = (P̄ − P̄_e) / (1 − P̄_e). Đạt khi κ ≥ 0,61. Năng lực có dưới 2/3 số ghế đồng ý lớp đã gán thì ghi vào hồ sơ thẩm định.

Ví dụ: chỉ báo "Hiểu tầm quan trọng của rủi ro" viết cho bậc 3; ba ghế xếp vào bậc 1, 3, 5. Vậy p = 1/3 = 0,33 → viết lại thành "Cập nhật sổ rủi ro hằng tuần và báo cáo thay đổi"; xếp lại được 3, 3, 3, nên p = 1,00.

Mọi phiếu của từng ghế được lưu trong bản ghi phép tính (mục 3.2), kèm model, phiên bản câu lệnh và seed xáo, để tab Diễn biến dữ liệu phát lại đúng từng phiếu.

### 6.2 Phiếu sai lệch

- P2.1 Phiếu sai lệch là một đối tượng: cổng, lý do, rủi ro, trạng thái. Do hệ thống tự lập khi thiếu dữ liệu cho một cổng.
- P2.2 Cổng ghi một trong bốn kết quả: đạt bằng dữ liệu, đạt bằng phiếu sai lệch, không áp dụng, chưa đạt.
- P2.3 Khung có cổng đạt bằng phiếu sai lệch không lên được tầng Sản phẩm thị trường (34).

### 6.3 Giao diện

- P2.4 Tab **Diễn biến dữ liệu** ở Chi tiết một bước: phát lại từng mục dữ liệu đi qua công thức, dựng từ bản ghi phép tính của lượt thật. Có phát/dừng, tua, chọn nhịp, tốc độ 0,5×/1×/2×. Thư viện hoạt ảnh GSAP để cục bộ trong ứng dụng, không tải từ CDN. Nội dung từng bước theo wireframe:

| Bước | Hoạt ảnh |
| --- | --- |
| B0 | Các trường snapshot nạp vào; mã SHA-256; kiểm từng cặp agent |
| B1 | Từng JD: nối với bản trùng kèm J, rơi vào khay trùng / sai vị trí, hoặc bay vào cột P1/P2/P3 theo L, M |
| B2 | Câu nhiệm vụ bay về nhiệm vụ chuẩn; thanh trọng số tăng; quy thang |
| B3 | Câu → ứng viên → so từ điển (dùng lại / tạo mới); 20% câu rơi vào ma trận hai lần mã hóa, κ tính lại sau mỗi câu |
| B4 | Sự kiện vào ba làn; kiểm đủ mẫu; Δ |
| B5 | Ba ghế chấm từng ứng viên; x̄, s², rwg; ứng viên bay vào biểu đồ quy tắc giữ kèm lý do loại; thanh độ phủ tô dần; thử bỏ từng năng lực |
| B6 | Chọn năng lực; chỉ báo bị xáo và che bậc; phiếu ba ghế bay vào; p_i; viết lại; Fleiss κ trước / sau |
| B7 | Chọn mẫu; soát từng cổng; G7 |
| B8 | Xếp loại thay đổi; phiên bản; tầng; chuỗi băm |

- P2.5 Tab **Kết quả và biểu đồ** đủ biểu đồ cho từng bước theo wireframe. B5 có bảng tập năng lực đã chọn (định nghĩa, lớp, S(c), số JD, số đoạn, nhiệm vụ gánh, bậc, rwg, dùng lại hay mới) và sơ đồ bằng chứng đoạn JD → nhiệm vụ → năng lực, bấm một năng lực thì sáng đường nối. B6 có bảng chỉ báo từng bậc kèm bản trước khi viết lại.
- P2.6 Màn **Lượt chạy tự động**: thêm cột Kiểm chéo (κ, rwg nhỏ nhất, kết quả dịch ngược, model của các ghế). Khi B8 xong, chuyển sang Kết quả và báo người duyệt.

### 6.4 Nghiệm thu P2

1. Với bộ dữ liệu mẫu có đáp án tính tay, mọi công thức (1)–(37) cho cùng kết quả (sai số làm tròn ≤ 0,01).
2. Bộ 14 JD không qua G1; bộ 15 JD có 4 P1 không qua G1.
3. Khung 15 năng lực lõi không qua G5. Ứng viên có điểm ba ghế 5, 4, 2 bị loại vì rwg < 0,70.
4. Chỉ báo có 1 phiếu đúng và 2 phiếu trắng có p_i = 0,33, không đạt (hiện đang đạt 100%).
5. Cấu hình agent kiểm trùng model với agent làm thì G0 chặn.
6. Khung mức C không có sự kiện thật: G4 "không áp dụng", tầng Nội bộ, không có trường nào sửa tầng bằng tay.
7. Mọi số trên tab Diễn biến dữ liệu và Kết quả và biểu đồ lấy từ bản ghi phép tính của lượt, không có số đặt cứng.

---

## 7. P3 · Từ điển, phiên bản và duyệt ở đầu ra

**Mục tiêu.** White paper chương 6 và công thức (38)–(42).

### 7.1 Phiên bản và ghi

- P3.1 Phiên bản MAJOR.MINOR.PATCH cho năng lực, chỉ báo, khung và từ điển, thay số nguyên. Di trú bản cũ: `n` → `n.0.0`, giữ mã cũ làm bí danh.
- P3.2 Tự xếp loại thay đổi theo bảy loại (S cấu trúc, D định nghĩa, P hồ sơ, V lớp biến động, B bằng chứng, E sửa lỗi, L pháp lý) và tăng phiên bản theo (38). Thêm một nhãn đồng nghĩa không còn tăng phiên bản như đổi định nghĩa.
- P3.3 Mức tăng của từ điển theo (39): MAJOR của một mục làm từ điển tăng MINOR.
- P3.4 Khung ghim `năng lực@phiên bản`; khung không tự nâng (40). MAJOR của một năng lực liệt kê mọi khung đang ghim bản cũ.
- P3.5 Điều kiện ghi (41): ghi khi từ điển chưa đổi kể từ bản nền của lượt; nếu đã đổi thì tính lại phần chênh, không ghi đè.
- P3.6 Biên nhận bản phát hành (42); bản phát hành bất biến.
- P3.7 Vòng đời Nháp → Hiệu lực → Ngừng dùng; năng lực không còn khung nào dùng chuyển Ngừng dùng; không xóa.
- P3.8 Quay lui là một bản phát hành mới (ví dụ 1.3.0 quay về nội dung 1.2.0 tạo 1.3.1); có màn hình và có test cho trường hợp ghi tiếp sau quay lui.
- P3.9 Ghi chú phát hành tự sinh.

### 7.2 Giao diện

- P3.10 **Đầu vào**, 3 tab:
  - Thiết lập lượt mới: charter, mức chặt chẽ, khung gốc gợi ý, bộ JD, dữ liệu do người thu, kiểm tra trước khi chạy (gồm ước tính token so với hạn mức).
  - Dữ liệu của lượt: nội dung màn Dữ liệu đầu vào hiện tại.
  - Bài học tự nạp: phát hiện của B7 và lý do từ chối của lượt trước, nạp thẳng vào lượt sau, thay nút duyệt bài học.

  Một nút "Chạy lượt mới"; hệ thống tự chạy B0 → B8.
- P3.11 **Kết quả và duyệt**, 4 tab:
  - Thay đổi từ điển: loại, phiên bản cũ → mới, lý do; hoạt ảnh mạng từ điển thay đổi.
  - Khung: giữ 3 góc nhìn của màn Khung năng lực hiện tại.
  - Khung bị ảnh hưởng: khung ghim bản cũ, nút "Tạo lượt rà soát".
  - Thẩm định và bài học: nội dung màn Audit hiện tại.

  Chân màn: ô lý do (bắt buộc khi từ chối), Từ chối, Chấp nhận và phát hành.
- P3.12 **Từ điển**: giữ đủ 7 góc nhìn hiện có (Mạng 2D, Mạng node 3D, Ma trận liên ngành, So sánh vai trò, Truy vết nguồn, Phiên bản/diff, Dữ liệu chi tiết). Thêm ba thứ:
  - Tab Bản phát hành: dòng phiên bản, ghi chú, quay lui, khung đang ghim.
  - Bộ chọn "Xem tại bản" áp cho mọi góc nhìn.
  - Mạng cập nhật giữa hai bản: node ngừng dùng mờ và nét đứt; MINOR/PATCH viền cam kèm phiên bản cũ → mới; MAJOR viền đỏ, node tách ra từ node cũ; node mới hiện ra xanh đậm, chữ đậm; liên kết của khung ghim bản cũ nét cam đứt.

  Mọi mắt xích của Truy vết nguồn bấm được về đúng bước và đúng JD.

### 7.3 Nghiệm thu P3

1. Sửa một lỗi chính tả tạo thay đổi loại E, tăng PATCH; đổi định nghĩa tạo loại D, tăng MAJOR và liệt kê đủ khung đang ghim bản cũ.
2. Từ điển 1.2.0 có một MAJOR và một năng lực mới → 1.3.0.
3. Hai lượt ghi đồng thời trên cùng bản nền: lượt sau không ghi đè lượt trước.
4. Quay lui rồi ghi tiếp không trùng khóa `mã@phiên bản`.
5. Từ chối có lý do: lượt sau của cùng vị trí có lý do đó trong tab Bài học tự nạp.

---

## 8. P4 · Dữ liệu từ con người và nâng tầng

**Mục tiêu.** White paper 3.4, 5.2 (hiệu chuẩn), 7.2 và giới hạn 10.1: dữ liệu do người tạo không chen vào giữa dây chuyền mà vào ở đầu vào của lượt sau; khung lên tầng khi đủ bằng chứng.

- P4.1 Nạp sự kiện hành vi, kết quả khảo sát, đánh giá chuyên gia ở Đầu vào mục 3. Mỗi loại có khuôn dữ liệu và kiểm đủ mẫu theo mức A, B (17)–(18).
- P4.2 Khử nhận dạng bắt buộc trước khi lưu và trước khi gửi AI (tên thành mã; bỏ tổ chức, dự án, địa danh, số định danh); agent kiểm bản đã khử (KS2); ghi tham chiếu đồng ý; hạn lưu.
- P4.3 Khi có dữ liệu của người, hệ thống tính lại mọi thống kê trên dữ liệu mới và tính lại tầng (34); dữ liệu của người được ưu tiên hơn phiếu của agent ở cùng cổng.
- P4.4 Hiệu chuẩn agent với nhãn của người: định kỳ đo từng agent trên bộ mẫu do người gắn nhãn (16); agent không đạt thì khóa cho tới khi đổi prompt hoặc model.
- P4.5 Sổ đăng ký công cụ AI: nhà cung cấp, loại tài khoản, điều khoản lưu và xóa, không dùng dữ liệu để huấn luyện; snapshot trỏ tới mục trong sổ.
- P4.6 Hạn lưu input của AI: `agent_result.input_canonical` hiện lưu vô thời hạn; với dữ liệu từ người chỉ lưu mã băm.
- P4.7 Tầng Quyết định nhân sự cần thêm kiểm định theo tiêu chí hiệu suất và kiểm tra công bằng giữa các nhóm (G11, G12); P4 chỉ dựng chỗ nạp mã của hai kết quả này, không tự tính.

**Nghiệm thu P4:**

1. Khung mức B có ≥ 3 người và ≥ 6 sự kiện thật qua G4 và có thể lên tầng Sản phẩm thị trường nếu các cổng khác đạt bằng dữ liệu.
2. Sự kiện chứa tên người hoặc tên công ty bị chặn ở bước lưu cho tới khi được khử.
3. Agent có F1 dưới ngưỡng trên bộ hiệu chuẩn không chạy được.

---

## 9. P5 · Sản xuất hàng loạt và chất lượng từ điển

**Mục tiêu.** White paper 6.7, 6.8 và công thức (43).

- P5.1 Danh mục sản xuất: vị trí, cấp bậc, ngành, loại khung (gốc, phái sinh cấp bậc, biến thể ngành).
- P5.2 Khung phái sinh và biến thể kế thừa charter, mã nghề, và mã hóa thẳng vào năng lực của khung gốc; chỉ chạy dịch ngược cho chỉ báo mới hoặc sửa; không gọi AI cho phần kế thừa.
- P5.3 Tỷ lệ trùng với khung gốc (43): dưới 0,60 thì báo "làm khung gốc mới". Hiện ở Đầu vào (khung gốc gợi ý) và Từ điển, So sánh vai trò.
- P5.4 Kiểm soát theo lô: KS1 trên mọi khung; E8 thẩm định đủ khung gốc và ít nhất 1/5 khung phái sinh chọn ngẫu nhiên; một khung chưa đạt thì thẩm định cả lô.
- P5.5 Chất lượng từ điển mỗi quý: Phân biệt, Bao phủ, Rõ và đo được, Có căn cứ, Ổn định; quét cặp năng lực gần nghĩa trên toàn từ điển.
- P5.6 Rà soát định kỳ theo hạn (35): chạy lại B1 rút gọn với JD mới, kết quả thành thay đổi theo loại.
- P5.7 Chỉ số vận hành: thời gian chu kỳ, tỷ lệ tái sử dụng từ điển, tỷ lệ trùng với khung gốc, tỷ lệ chỉ báo đạt G6 lần đầu, tỷ lệ khung qua cổng lần đầu, số phiếu sai lệch mỗi khung, token mỗi khung.

**Nghiệm thu P5:** một lô gồm 1 khung gốc và 3 khung phái sinh chạy xong; phái sinh không gọi AI cho phần kế thừa; tỷ lệ trùng hiện đúng trên So sánh vai trò.

---

## 10. Công thức nào làm ở phase nào

Mọi nhóm công thức của Phụ lục A đều có phase. Không nhóm nào bị để ngoài.

| Công thức | Nội dung | Phase |
| --- | --- | --- |
| (1)–(2) | Mã băm snapshot; G0 và tính độc lập của agent | P0 hiển thị mã băm; P2 kiểm cặp agent |
| (3)–(4) | JD hợp lệ; Jaccard | P1 (K1); P2 cổng |
| (5)–(8) | Lăng kính L, M; hạng P1/P2/P3; G1 | P2 |
| (9) | Quy thang 0–100 về 1–5 | P2 |
| (10)–(14) | Điểm giống; trọng số nhiệm vụ; trọng số bằng chứng; điểm thị trường; độ bao phủ thư viện | P1 (K4, K6); P2 |
| (15) | Cohen's kappa | P2 (E9) |
| (16) | Độ chính xác, độ đầy đủ, F1 | P1 (bộ neo); P4 (hiệu chuẩn) |
| (17)–(19) | Đủ mẫu; chênh lệch nhóm | P2 tính; P4 có dữ liệu thật |
| (20)–(26) | rwg; quy tắc giữ; tập lõi; độ phủ; thử bỏ một; trung vị | P2 (E10) |
| (27)–(30) | Tỷ lệ dịch ngược; Fleiss' kappa; số chỉ báo mỗi bậc; ràng buộc năng lực – kết quả | P2 (E6, E7) |
| (31)–(33) | Thẩm định độc lập; cỡ mẫu; G7 | P2 (E8) |
| (34)–(35) | Tầng phát hành; hạn rà soát | P2 tính; P4 nâng tầng; P5 rà soát định kỳ |
| (36)–(37) | Chuỗi nhật ký băm | P0 (sự kiện mới vẫn nối chuỗi) |
| (38)–(39) | Tăng MAJOR, MINOR, PATCH; mức tăng của từ điển | P3 |
| (40)–(42) | Khung ghim; điều kiện ghi; biên nhận | P3 |
| (43) | Tỷ lệ trùng với khung gốc | P5 |
| (44)–(47) | Token và chi phí | P0 (đo, ngân sách); P1 (nghiệm thu) |

---

## 11. Quyết định cần chủ sản phẩm chốt

Q1–Q4 đã chốt ngày 18/11/2026 theo đề xuất. Q5–Q8 còn mở; các phase dùng đề xuất làm mặc định.

| # | Câu hỏi | Đề xuất | Ảnh hưởng phase |
| --- | --- | --- | --- |
| Q1 | Người duyệt duyệt cả bản phát hành từ điển hay từng khung? | **Đã chốt:** Cả bản phát hành của một lượt (một khung và các thay đổi từ điển kèm theo), như màn Kết quả | P3 |
| Q2 | Khi từ chối: lý do có bắt buộc và có tự thành đầu vào của lượt sau không? | **Đã chốt:** Bắt buộc; tự nạp vào tab Bài học tự nạp | P3 |
| Q3 | "Khác model" khi chỉ dùng Claude CLI: ba bậc Haiku, Sonnet, Opus có đủ độc lập không? | **Đã chốt:** Đủ cho tầng Nội bộ; giới hạn ghi rõ (white paper 10.2) và bù bằng hiệu chuẩn P4.4 | P2, P4 |
| Q4 | MAJOR của một năng lực: chỉ liệt kê khung bị ảnh hưởng hay tự chạy lượt rà soát? | **Đã chốt:** Liệt kê, có nút "Tạo lượt rà soát"; không tự chạy để tránh tiêu hạn mức ngoài ý muốn | P3 |
| Q5 | Ngưỡng cắt đuôi dài K6 | Trọng số bằng chứng ≥ 4 (ví dụ hai JD hạng P2); cấu hình được | P1 |
| Q6 | E1 dùng Haiku hay Sonnet? (**đã chốt theo 12.5: Haiku**) | Haiku theo chế độ tiết kiệm (12.5) ngay khi qua bộ neo; Sonnet cho tới lúc đó | P1 |
| Q7 | Có thêm đường Claude API hoặc Batch API bên cạnh CLI? | Chưa; mức giảm của P1 không phụ thuộc đường truyền. Xét lại ở P5 khi chạy hàng loạt | P5 |
| Q8 | Dataset công khai không rõ giấy phép có dùng làm bằng chứng cho tầng Sản phẩm thị trường? | Chỉ tầng Nội bộ cho tới khi có ý kiến pháp chế | P2, P4 |

---

## 12. Kiểm soát token khi phát triển và khi chạy

Chủ sản phẩm lo ngại về token. Mục này gom mọi chốt chặn và đặt chúng thành yêu cầu.

### 12.1 Trần cho mỗi lượt

| Cỡ bộ JD | Ước tính thiết kế P1 (qua CLI) | Trần mặc định của lượt | So với lượt 16/11 (10,7 triệu token, chạm hạn mức) |
| --- | ---: | ---: | ---: |
| 15 JD | ≈ 110 nghìn | 170 nghìn | ≈ 1% |
| 50 JD | ≈ 250 nghìn | 380 nghìn | ≈ 2,3% |
| 175 JD | ≈ 650 nghìn | 1 triệu | ≈ 6% |

- Trần = 1,5 lần ước tính, tính bằng code từ số JD trước khi chạy (P0.9, P0.10). Vượt trần thì lượt dừng với mã `BUDGET`, không tự chạy tiếp.
- Ước tính đã gồm các vòng kiểm chéo của P2 (E7, E9, E10: 3 lời gọi mỗi khung cho mỗi vòng ba ghế, E9 một lời gọi mỗi 200 câu). Các vòng này cộng thêm dưới 10% vì chạy trên tập đã chọn, không chạy trên mọi ứng viên.
- Số ước tính ở bảng sẽ được thay bằng số đo của lượt nghiệm thu P1.

### 12.2 Khi phát triển

- K1 Test của pipeline chạy bằng **runner giả** trả kết quả đã ghi sẵn; không test tự động nào gọi Claude CLI.
- K2 Kết quả AI đã lưu theo địa chỉ nội dung được dùng lại khi chạy lại cùng đầu vào; chỉ phần đổi mới gọi AI.
- K3 Lượt thật trong lúc phát triển dùng bộ 15 JD. Bộ 50 JD chỉ chạy một lần cho nghiệm thu mỗi phase (P1, P2). Không chạy lại bộ 175 JD cho tới khi P1 đạt nghiệm thu.
- K4 Kiểm sửa nhanh P0.6 bằng 3 lời gọi tuần tự trên dữ liệu lượt 16/11, không chạy lại cả bước.
- K5 Mỗi lượt có báo cáo token theo agent và theo bước; số này lưu cùng snapshot để so giữa các lần sửa.

### 12.3 Thứ tự chi tiêu theo phase

| Phase | Lượt thật cần chạy | Token dự kiến |
| --- | --- | ---: |
| P0 | Thử nghiệm bộ đệm T8 (3 lời gọi); một lượt 15 JD dừng ở B5 do ngưỡng bất thường | ≈ 0,3–0,4 triệu |
| P1 | Vài lượt 15 JD khi chỉnh agent; một lượt nghiệm thu 50 JD | ≈ 1 triệu |
| P2 | Vài lượt 15 JD; một lượt nghiệm thu 50 JD | ≈ 1 triệu |
| P3–P5 | Chủ yếu code, dùng lại kết quả đã lưu | < 0,5 triệu mỗi phase |

### 12.4 Đo theo hạn mức 5 giờ, không chỉ theo token

Hạn mức của gói Claude không tính theo số token thô: model lớn tốn hạn mức hơn model nhỏ, và ghi bộ đệm cũng bị tính. Vì vậy hệ thống dùng **chi phí quy đổi theo giá API** làm thước đo gần đúng cho phần hạn mức đã dùng. Lượt 16/11 chạm hạn mức khi chi phí quy đổi của các lời gọi thành công đạt ≈ 39,5 USD.

| Cấu hình | Chi phí quy đổi một lượt 50 JD (ước tính, qua CLI) | Phần hạn mức 5 giờ (ước tính) |
| --- | ---: | ---: |
| Thiết kế hiện tại | ≈ 28 USD (đo 40,54 USD cho 175 JD và chưa chạy xong) | ≈ 70% (175 JD: vượt 100%) |
| P1, giữ model như white paper | ≈ 1,0–1,1 USD | ≈ 3% |
| P1 + gom lời gọi (5.2a) + chính sách model (12.5) | ≈ 0,25–0,35 USD | ≈ 0,5–1% |

- P0 thêm số đo: phần hạn mức còn lại trước và sau mỗi lượt (đọc từ thông tin hạn mức CLI trả về khi có), lưu cùng báo cáo token. Nghiệm thu P1 dùng số đo này, không dùng bảng ước tính.
- Hạn mức dùng chung với mọi phiên Claude khác của cùng tài khoản, kể cả phiên Claude Code đang dùng để phát triển. Lượt nghiệm thu nên chạy khi không có phiên lớn nào khác.

### 12.5 Chính sách model (chốt 18/11/2026)

Chỉ dùng Haiku 5.5 và Sonnet 5.5, không dùng Opus. Mọi lời gọi chạy ở **effort thấp nhất**. Haiku là mặc định; Sonnet chỉ dùng ở chỗ bắt buộc phải khác model với agent làm, hoặc ở việc khó nhất. Bảng này thay cho cột model ở mục 5.2 và 5.2a.

| Lời gọi | Model | Lý do |
| --- | --- | --- |
| E1 đọc JD theo lô | Haiku | Trích có căn cứ; sai được code bắt bằng kiểm tham chiếu |
| E2 + E3 + E4 duyệt cụm, so từ điển, neo nghề | Haiku | Code đã gom và tra sẵn; AI chỉ trả phần sửa |
| E5 ma trận | Haiku | Phân loại nhiều nhãn trên danh sách ngắn |
| E10 ba ghế chấm ưu tiên và bậc | Haiku × 3 | Ba ghế cùng model, khác câu lệnh và thứ tự (xem rủi ro bên dưới) |
| E7 ba ghế dịch ngược và xếp lớp | Haiku × 3 | Khác model với E6 (Sonnet) |
| E9 mã hóa kiểm chéo | **Sonnet** | Bắt buộc khác model với E1 (Haiku), công thức (2) |
| E6 viết chỉ báo | **Sonnet** | Việc khó nhất, quyết định chất lượng khung |
| E8 thẩm định | **Sonnet** | Thẩm định cần đọc hiểu toàn hồ sơ |

Ước tính cho bộ 50 JD: 14 lời gọi, 11 lời gọi Haiku (≈ 79%), ≈ 75–80% số token ở Haiku, chi phí quy đổi ≈ 0,25–0,35 USD, ≈ 0,5–1% hạn mức 5 giờ.

**Không đẩy Haiku lên 90%** được mà vẫn giữ quy tắc kiểm độc lập: E9 phải khác model với E1, và E8 không được cùng model với mọi agent đã làm. Muốn 90% thì phải cho agent kiểm dùng cùng model với agent làm, tức bỏ ý nghĩa của kiểm chéo.

**Ba chỗ lệch so với white paper, cần ghi vào giới hạn (white paper chương 10):**

1. Ba ghế E7, E10 cùng là Haiku. Ba ghế cùng model dễ đồng ý với nhau hơn ba model khác nhau, nên rwg, tỷ lệ dịch ngược và Fleiss' kappa có thể cao hơn thực tế. Bù bằng: mỗi ghế một câu lệnh khác (vai, cách diễn đạt thang), thứ tự mục xáo khác nhau, và hiệu chuẩn với nhãn của người ở P4.4. Nếu hiệu chuẩn cho thấy đồng thuận bị thổi phồng, nâng ngưỡng của các vòng này.
2. E8 (Sonnet) cùng model với E6 (Sonnet). Công thức (31) yêu cầu agent thẩm định không trùng agent đã làm. Cách xử lý: E8 chạy ngữ cảnh mới, không thấy câu lệnh và lập luận của E6, chỉ đọc hồ sơ đã chốt; cổng G7 ghi "đạt có lưu ý: thẩm định cùng model với một bước". Khung vẫn dừng ở tầng Nội bộ, và người duyệt ở đầu ra là lớp kiểm cuối.
3. Effort thấp ở E6 và E8 có thể giảm chất lượng. Nghiệm thu trên bộ neo; nếu dưới ngưỡng thì chỉ hai lời gọi này lên effort vừa, các lời gọi khác giữ thấp.

---

## 13. Thứ tự thực hiện

Mỗi bước chỉ bắt đầu khi bước trước đã xong. Dấu ✋ là điểm chủ sản phẩm duyệt trước khi đi tiếp.

**P0 · Theo dõi lượt và chặn thất thoát token**

1. Cầu dao hạn mức (P0.7).
2. Trần token, ước tính trước khi chạy, cảnh báo bất thường (P0.9–P0.11).
3. Sự kiện bắt đầu / xong / dừng, giờ xong đúng, lý do dừng có cấu trúc, gia hạn khóa job (P0.1, P0.2, P0.4, P0.5).
4. Bản ghi phép tính ghi dần, tách token đệm (P0.3, P0.8).
5. Sửa nhanh T8 (P0.6), kiểm trên 20 nhiệm vụ.
6. Màn Lượt chạy, Chi tiết một bước, Khi lượt dừng, Lịch sử lượt; tách trang demo (P0.13–P0.17).
7. ✋ Khởi động lại web và worker; một lượt 15 JD để nghiệm thu P0.

**P1 · Thiết kế AI tối ưu**

8. Runner giả cho test; khuôn agent chung (tiền tố bộ đệm, model theo 12.5, effort thấp).
9. Bước code K1–K8, che dữ liệu cá nhân trước tiên.
10. ✋ Bộ neo 50 JD: cần người gắn hoặc duyệt nhãn.
11. 14 lời gọi theo 5.2a; bỏ T13.
12. ✋ Lượt nghiệm thu 50 JD, đo phần hạn mức đã dùng.

**P2 · Công thức và cổng ở 9 bước**

13. Charter, bộ chính sách có phiên bản, kiểm cặp model ở G0.
14. Công thức và cổng B1–B4, gồm E9 và κ.
15. Ghế theo 6.1a: E10 và B5; E7 và B6.
16. E8 và G7; tầng, hạn rà soát; phiếu sai lệch.
17. Tab Diễn biến dữ liệu, Kết quả và biểu đồ; cột Kiểm chéo.
18. ✋ Kiểm trên bộ dữ liệu tính tay, rồi một lượt nghiệm thu 50 JD.

**P3 · Từ điển, phiên bản, duyệt ở đầu ra** (bước 19–20 có thể làm song song với bước 14–17)

19. Phiên bản ba số và di trú; bảy loại thay đổi; mức tăng của từ điển.
20. Khung ghim, điều kiện ghi, biên nhận, vòng đời, quay lui, ghi chú phát hành.
21. Màn Đầu vào, Kết quả và duyệt, Từ điển (7 góc nhìn, Bản phát hành, mạng cập nhật).
22. ✋ Nghiệm thu P3.

**P4 · Dữ liệu từ con người và nâng tầng**

23. Nạp sự kiện, khảo sát; khử nhận dạng.
24. Tính lại tầng; hiệu chuẩn agent với nhãn của người.
25. Sổ công cụ AI; hạn lưu input.
26. ✋ Nghiệm thu P4.

**P5 · Sản xuất hàng loạt**

27. Khung gốc, phái sinh, biến thể ngành; tỷ lệ trùng (43); kiểm soát theo lô.
28. Chất lượng từ điển theo quý; rà soát định kỳ; chỉ số vận hành.
29. ✋ Nghiệm thu P5: làm đủ white paper.

---

## Phụ lục A · Số đo nền

Lượt Project Manager ngày 16/11/2026, 175 JD nhập, 131 hợp lệ. Chi phí là số CLI trả về, quy đổi theo giá API.

| Tác vụ | Lời gọi | USD |
| --- | ---: | ---: |
| T1 lọc JD | 175 | 0,12 |
| T2 trích nhiệm vụ | 131 | 2,11 |
| T3 gộp nhiệm vụ | 17 | 2,02 |
| T4 trích năng lực | 189 | 3,28 |
| T5 gom năng lực | 52 | 5,85 |
| T13 giả thuyết | 566 | 4,77 |
| T8 nối nhiệm vụ với năng lực | 110 thành công / 857 | 22,39 |
| **Cộng** | **2 191 lời gọi, 747 lỗi hạn mức, 7 bị từ chối** | **40,54** |

Token: 7,86 triệu ghi bộ đệm, 1,78 triệu đọc bộ đệm, 1,17 triệu ra. Mỗi lời gọi T8 thành công ghi ≈ 50 500 token vào bộ đệm 1 giờ và chỉ đọc lại ≈ 1 169.

Chạy hết lượt này theo thiết kế hiện tại ước tính ≈ 51 triệu token. Thiết kế của P1 cho bộ 50 JD ước tính ≈ 250 nghìn token qua CLI (white paper tính 178 nghìn token, 0,82 USD theo giá API; qua CLI cộng thêm phần khung ≈ 1 200 token mỗi lời gọi và giá ghi bộ đệm ×2).
