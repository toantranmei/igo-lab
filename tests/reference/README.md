# Đáp án tính tay cho công thức (1)–(37)

Bộ đáp án độc lập để đối chiếu với code TypeScript theo nghiệm thu P2 số 1 (đặc tả nâng cấp, dòng 331: "mọi công thức (1)–(37) cho cùng kết quả, sai số làm tròn ≤ 0,01").

`formulas_ref.py` được viết **chỉ từ tài liệu**, không đọc `packages/pipeline/src/formulas.ts`, `blocks-*.ts`, `packages/db/src/*`, `anchor.ts` hay `tests/unit/formulas.test.ts`.

## Cách sinh lại

```sh
python3 -I tests/reference/formulas_ref.py > tests/reference/golden.json
python3 -I tests/reference/formulas_ref.py --dump-whitepaper   # in white paper theo số đoạn ¶
```

Script chỉ dùng thư viện chuẩn. Trước khi in, nó tự kiểm các ví dụ có sẵn trong tài liệu (75 → 4,0; rwg 4,4,5 → 0,83; 5,4,2 → 0; p = 0,33; G1 với 14 JD và với 15 JD có 4 P1; 15 năng lực lõi; ⌈0,1·30⌉ = 3).

`golden.json` có dạng `{tolerance, sources, cases: [{formula, name, inputs, expected, note}]}`. Số thực được làm tròn 6 chữ số. Khi tài liệu không định nghĩa giá trị (0/0, thiếu phiếu…), `expected` là `null`.

## Nguồn và cách trích dẫn

| Ký hiệu | Tệp | Ghi chú |
| --- | --- | --- |
| WP ¶N | `docs/whitepaper/competence-lab-whitepaper.docx` (cùng nội dung bản .pdf) | Chỉ bản docx/pdf có đánh số công thức (1)–(47). ¶N là số thứ tự đoạn trong `word/document.xml`, in bằng `--dump-whitepaper` |
| WPmd L | `docs/whitepaper/competence-lab-whitepaper.md` | Bản đối chiếu trạng thái, cũ hơn, **không có số công thức** |
| SPEC L | `docs/specs/competence-lab-upgrade-spec.md` | |

## Bảng công thức

"Có" nghĩa là có ca trong `golden.json`. Công thức logic (cổng, điều kiện) được kiểm bằng ca đúng/sai. Công thức băm được kiểm theo cấu trúc.

| Số | Nội dung | Có | Nguồn | Loại |
| --- | --- | --- | --- | --- |
| (1) | H = SHA-256(bộ JD, từ điển nền, bộ ngưỡng, cấu hình AI) | Có (cấu trúc) | WP ¶64–65; WPmd L113 | băm, không phải phép tính số |
| (2) | G0 = đủ trường ∧ H khớp ∧ agent làm ≠ agent kiểm | Có | WP ¶83–84; SPEC L251, L270, L335 | logic |
| (3) | hợp lệ = đọc được ∧ không trùng ∧ đúng vị trí | Có | WP ¶88, ¶90 | logic |
| (4) | Jaccard \|A∩B\|/\|A∪B\| | Có | WP ¶92–93; SPEC L168 | số |
| (5) | L = 3A + 2C + D + E | Có | WP ¶95; WPmd L172 | số |
| (6) | M = 3B + 2C + D + E, chỉ khi A ≥ 2 | Có | WP ¶97–98; WPmd L173 | số |
| (7) | Hạng P1/P2/P3 | Có | WP ¶99; WPmd L174 | số → nhãn |
| (8) | G1: N ≥ 15 ∧ N_P1 ≥ 5 | Có | WP ¶101–102; SPEC L252, L332 | logic |
| (9) | s = 1 + x/100 × 4 | Có | WP ¶108–109; WPmd L199 | số |
| (10) | điểm = max(J_tên, 0,7·J_định nghĩa); ≥ 0,3, tối đa 3 | Có | WP ¶115–116 | số |
| (11) | w_t = n_t / N | Có | WP ¶118–119 | số |
| (12) | E(c) = Σ ω_q (3/2/1/3) | Có | WP ¶121–122; WPmd L220–221 | số |
| (13) | S(c) = E(c) / max E | Có | WP ¶123–124 | số |
| (14) | bao phủ thư viện | Có | WP ¶126 | số |
| (15) | Cohen's κ; G3 κ ≥ 0,61 | Có | WP ¶129–130, ¶133; SPEC L254 | số |
| (16) | P, R, F1 | Có | WP ¶132; SPEC L230 | số |
| (17) | Đủ mẫu Mức A | Có | WP ¶141–142; WPmd L254 | logic |
| (18) | Đủ mẫu Mức B; Mức C "không áp dụng" | Có | WP ¶143, ¶148; WPmd L254 | logic |
| (19) | Δ = f_xuất sắc − f_trung bình | Có | WP ¶145–146 | số + nhãn |
| (20) | r_wg = max(0, 1 − s²/2) | Có | WP ¶153–154; SPEC L287–288, L293 | số |
| (21) | Giữ ở Mức A, B | Có | WP ¶156; WPmd L276; SPEC L289, L333 | logic trên số |
| (22) | Giữ ở Mức C: S(c) ≥ 0,60 ∨ s ≥ 3,5 | Có | WP ¶157–158; WPmd L277 | logic trên số |
| (23) | 8 ≤ n_lõi ≤ 14 ∧ n_meta ≤ 1 (kèm cắt về 14 theo SPEC L290) | Có | WP ¶160; WPmd L69, L280; SPEC L290, L333 | logic |
| (24) | Độ phủ nhiệm vụ; cảnh báo 0,8 | Có | WP ¶162–163 | số |
| (25) | Độ phủ khi bỏ một | Có | WP ¶165–166 | số |
| (26) | bậc = trung vị phiếu hợp lệ, ≥ 2 phiếu | Có | WP ¶168; SPEC L256, L291 | số |
| (27) | p_i ≥ 0,70, phiếu trắng trong mẫu số | Có | WP ¶175–176; SPEC L297, L300, L334 | số |
| (28) | Fleiss' κ ≥ 0,61; cờ < 2/3 ghế đồng ý | Có | WP ¶178–179; SPEC L298 | số |
| (29) | 2–4 chỉ báo mỗi (năng lực, bậc 1/3/5) | Có | WP ¶181; WPmd L296 | logic |
| (30) | Ràng buộc năng lực – kết quả | Có | WP ¶182–183; WPmd L296 | logic |
| (31) | Agent thẩm định ∉ {trích, soạn, chấm} | Có | WP ¶190; SPEC L258, L536 | logic |
| (32) | n_mẫu = ⌈0,10 × N_câu⌉ | Có | WP ¶192–193; SPEC L258 | số |
| (33) | G7: cả 10 biến đạt / đạt có điều kiện kèm kế hoạch | Có | WP ¶195; WPmd L323 | logic |
| (34) | Tầng Sản phẩm thị trường | Có | WP ¶201–202; WPmd L346–347; SPEC L308 | logic |
| (35) | Tầng Quyết định nhân sự, còn lại Nội bộ | Có (G11, G12 là đầu vào) | WP ¶203–204; WPmd L345–348 | logic |
| (36) | Hạn rà soát +12 / +24 tháng | Có | WP ¶206–207; WPmd L340 | ngày |
| (37) | h_k = SHA-256(h_{k−1} ‖ e_k) | Có (cấu trúc) | WP ¶209–210; WPmd L124; SPEC L73 | băm, không phải phép tính số |

**Không có ca:** cách code tính D từ ngày đăng và E từ loại nguồn (WP ¶94, SPEC L252). Tài liệu không cho bảng quy đổi, nên D, E là đầu vào của (5)–(6). Cũng không có ca cho ngưỡng cổng đuôi dài K6 (SPEC L173, không có số), cho cỡ mẫu 20% của E9, và cho cảnh báo "đồng thuận bất thường" > 90% (SPEC L275). Các mục này không nằm trong (1)–(37).

## Chỗ tài liệu chưa rõ (đã chọn cách đọc sát chữ nhất)

### Chung

- **Đánh số.** Số công thức chỉ có trong bản docx/pdf. Bản md không đánh số.
- **SPEC đánh số lệch WP.** Script đi theo WP. Các chỗ lệch:
  - SPEC L290 gọi giới hạn tập lõi là "(22)–(23)". Trong WP, (22) là quy tắc giữ Mức C, còn (23) mới là giới hạn tập lõi.
  - SPEC L442 ghi "(34)–(35) Tầng phát hành; hạn rà soát" và SPEC L418 ghi "Rà soát định kỳ theo hạn (35)". Trong WP, (35) là tầng Quyết định nhân sự và (36) là hạn rà soát.
  - SPEC L73 và L443 ghi "(36)–(37) chuỗi nhật ký băm". Trong WP, (36) là hạn rà soát, chỉ (37) là chuỗi băm.
- **Làm tròn.** SPEC L293 làm tròn s² = 0,33 trước khi tính r_wg = 0,83. Script so ngưỡng trên giá trị chưa làm tròn (r_wg = 0,8333). Hai cách lệch nhau dưới 0,01, nhưng ở sát ngưỡng có thể cho kết quả cổng khác nhau.

### Theo công thức

| Số | Chỗ chưa rõ | Cách đọc trong script |
| --- | --- | --- |
| (1) | WP ¶64 không quy định cách tuần tự hóa: thứ tự, dấu phân cách, mã hóa | JSON chuẩn tắc (khóa sắp xếp, không khoảng trắng, UTF-8) của mảng 4 phần tử. Chỉ so được tính chất: 64 ký tự hex, tất định, đổi 1 ký tự thì H đổi |
| (2) | Bộ trường bắt buộc: SPEC L251 có 6 trường. WP ¶81 có thêm chế độ, quyết định phục vụ, tiêu chí hiệu suất | Dùng 6 trường của SPEC |
| (2) | WP ¶83 so **agent**, còn WP ¶84 và SPEC L270 (S2) so **model** | So model |
| (2) | Mâu thuẫn trong SPEC: E6 dùng Sonnet (L187), E7 gồm Haiku + Sonnet + Opus (L188). Vậy một ghế E7 cùng model với agent làm, trái với S2 (L270) | Không giải quyết; chỉ ghi lại |
| (2) | Model của E9: SPEC L190 ghi Opus, SPEC L525 ghi Sonnet | Không giải quyết; chỉ ghi lại |
| (3) | Tiêu chí "đọc được" không định nghĩa | Đầu vào boolean |
| (4) | SPEC L168 ghi "n-gram" nhưng không cho n. WP ¶91 ghi "tập cụm từ". Không quy định cách tách từ | Hàm nhận sẵn tập |
| (4) | WP ¶93 viết "J trên 0,85" (lớn hơn hẳn), còn SPEC L168 viết "ngưỡng 0,85" | Coi là trùng khi J ≥ 0,85. Có ca biên J = 0,85 |
| (4) | J(∅, ∅) không định nghĩa | null, không trùng |
| (5)–(7) | Không có bảng quy đổi ngày đăng ra D và loại nguồn ra E. WPmd L639 chỉ nói thiếu ngày đăng thì điểm độ mới thấp | D, E là đầu vào |
| (6)–(7) | "Chỉ tính khi A từ 2 trở lên": khi A < 2, M không tính hay tính bằng 0? | M = null; hạng lấy theo L (JD J3: L = 15 → P2, dù M sẽ là 21) |
| (8) | WPmd L177 viết "N_đầy đủ" là JD đầy đủ **đã lưu bản chụp**, còn SPEC L252 chỉ ghi N. Chưa rõ có đồng nhất với số JD hợp lệ (3) không | Đầu vào là số đếm sẵn |
| (8) | Khung phái sinh cần thêm ≥ 10 JD (WP ¶102), nhưng điều này nằm ngoài công thức | Không xét |
| (9) | x nằm ngoài 0–100; có làm tròn s hay không | Không chặn, không làm tròn |
| (10) | "cụm ba ký tự của tên và các tên đồng nghĩa": hợp tất cả cụm thành một tập, hay lấy max theo từng tên? Chữ hoa, dấu, đệm đầu cuối, dấu câu cũng không quy định. J định nghĩa tách từ thế nào? | Một tập là hợp các cụm; chữ thường; không đệm; tập từ `\w+`. Ca văn bản phụ thuộc cách tách |
| (10) | "Từ 0,3 trở lên": giữ ≥ 0,3, tối đa 3 phương án. Không quy định cách xử lý khi bằng điểm | ≥ 0,3; khi bằng điểm xếp theo mã |
| (11) | JD trùng gần đúng "vẫn được đếm làm bằng chứng" (SPEC L168). Có tính vào n_t và N không? | Đầu vào là số đếm sẵn |
| (12) | Tính theo câu hay theo JD. Hai câu cùng một JD thì sao? | Mỗi câu một số hạng. Hai câu cùng JD cộng hai lần |
| (12) | Ngưỡng cổng đuôi dài K6 (SPEC L173) không có số | Không có ca |
| (13) | "max trong các ứng viên của khung": lấy trước hay sau khi cắt đuôi? Max = 0 thì sao? | Trên tập đưa vào; max = 0 → null |
| (14) | "Phần tử có sẵn": gồm cả nhiệm vụ hay chỉ năng lực? Câu từ nguồn chuẩn ngoài có nằm trong mẫu số không? | Đầu vào là số đếm sẵn |
| (15) | WP ¶130: p_e "tính từ tần suất dùng từng mã ở mỗi lần", tức tần suất riêng của từng người mã hóa (Cohen), không gộp (Scott) | Cohen |
| (15) | Mã để trống; cách làm tròn 20%; κ bằng đúng 0,61 | ≥ 0,61 đạt. p_e = 1 → null |
| (15) | WPmd L224: ở Mức C hội đồng kiểm ≥ 10% câu. WP ¶113: E9 luôn mã hóa lại | Không xét |
| (16) | Không có quy tắc khớp "đúng / thừa / sót" | Đầu vào là số đếm. Mẫu số 0 → null |
| (17) | "Mỗi người ≥ 4 sự kiện" tính cho cả hai nhóm? κ là κ của mã hóa kép sự kiện (WPmd L254)? | Mọi người trong danh sách; κ là đầu vào |
| (18) | WPmd L254 có thêm nhánh "hoặc BEI ≥ 3 người". WP (18) không có | Theo WP |
| (19) | Không có ngưỡng số cho "chỉ nổi ở nhóm…" | Phân loại theo f = 0 hay f > 0 |
| (20) | WP ¶154 chỉ viết "phương sai"; SPEC L287 viết "phương sai mẫu" và ví dụ L293 khớp với n − 1 | n − 1 |
| (20) | Tính trên điểm nào: SPEC L287 chỉ dùng điểm quan trọng, WP ¶154 viết "các điểm chấm" | Chỉ điểm quan trọng |
| (20) | Phiếu khảo sát của người được "tính cùng" (WP ¶151). Ghế bỏ trống | Bỏ phiếu trắng; dưới 2 phiếu → null |
| (21) | So trên giá trị làm tròn hay chưa làm tròn. Với 3 ghế điểm nguyên, x̄ không bao giờ bằng đúng 3,5 | Chưa làm tròn |
| (22) | Ở dây chuyền tự động Mức C, dùng (22) hay vòng E10 với (21)? SPEC L289 chỉ nêu (21) | Hai hàm riêng |
| (22) | Có 1–4 nghề chuẩn ngoài (WP ¶106) thì lấy s nào? Không có nghề chuẩn ngoài thì sao? | s là đầu vào; null → vế đó sai |
| (23) | Năng lực meta có nằm trong 8–14 không? WPmd L69 viết "8–14 ở lớp I–III và tối đa 1 meta"; WP ¶35 viết "8 đến 14 năng lực và tối đa một meta" | n_lõi chỉ đếm lớp I–III |
| (23) | SPEC L290 cắt về 14 theo x̄_quan trọng rồi S(c), nhưng SPEC L333 lại nói khung 15 lõi không qua G5. Khi vẫn bằng nhau sau cả hai tiêu chí thì xếp thế nào? Ít hơn 8 thì làm gì? | Có cả hai: hàm cắt và kiểm giới hạn. Khi vẫn bằng nhau xếp theo mã |
| (24) | "Ngưỡng cảnh báo 0,8": cảnh báo khi < 0,8 hay ≤ 0,8? | < 0,8. Có ca độ phủ đúng 0,8: số thực nhị phân cho 0,7999…, nên script tính bằng phân số |
| (25) | "Tụt mạnh" không có ngưỡng | Chỉ trả độ phủ |
| (26) | Khi số phiếu chẵn ngoài trường hợp 2 phiếu (có khảo sát của người), làm tròn thế nào? SPEC L291 chỉ nói làm tròn lên cho 2 phiếu | Trung bình hai giá trị giữa, làm tròn lên |
| (27) | Với 3 ghế, 2/3 = 0,667 < 0,70, nên thực chất phải cả 3 ghế đồng ý. Mã cũ dùng ≥ 2/3 (WPmd L312) | Theo chữ: 2/3 không đạt. Có ca 7/10 = 0,70 đạt |
| (27) | Ghế bị loại theo S5 (sai mục kiểm tra) có nằm trong "số agent nhận phiếu" không? | Mẫu số là độ dài danh sách phiếu |
| (28) | Ghế bỏ trống lớp (n thay đổi) không định nghĩa. "Lớp đã gán" do ai gán? | n cố định; lớp gán là đầu vào. P̄_e = 1 → null |
| (29) | Chỉ báo ở bậc 2, 4 có được phép không? (29) chỉ ràng buộc các bậc 1, 3, 5 | Chỉ kiểm 1, 3, 5. Bậc thiếu tính là 0 |
| (30) | "3 đến 5 kết quả chính" (WP ¶182) có thuộc (30) và G6 không? | Báo riêng `outcomes_count_ok` |
| (31) | So agent hay model. SPEC L536: cùng model là "đạt có lưu ý". "Agent chấm" là E10, E7 hay E9? | So agent; cùng model → `same_model_warning` |
| (32) | N_câu là mọi câu đã mã hóa (WP ¶193). WPmd L325, L336 chỉ áp dụng ở Mức C | Mọi mức. Tính ⌈N/10⌉ bằng số nguyên vì 0,1·30 = 3,0000000000000004 |
| (33) | Ít hơn 10 biến thì sao? Thế nào là "đạt có điều kiện" mà không có kế hoạch? | Bắt buộc đúng 10 biến; không có kế hoạch là trượt |
| (34) | G2 và G8 không có trong danh sách phiếu sai lệch; cổng "không áp dụng" ở G1, G3–G5; có cần mọi cổng khác đạt không; phiếu sai lệch còn Mở thì chặn phát hành (WPmd L399) | Theo chữ: G2, G8 không xét; "na" không chặn |
| (35) | G11, G12 không tính được từ dữ liệu trong tài liệu. Đánh số lệch SPEC | Đầu vào boolean |
| (36) | Cộng tháng vào ngày cuối tháng (29/02); họ nghề nào là "công nghệ, dữ liệu, AI". Đánh số lệch SPEC | Kẹp về ngày cuối tháng; họ nghề là đầu vào boolean |
| (37) | h_0, h là chuỗi hex hay byte thô, "‖" là gì, tuần tự hóa e_k | h_0 = "", hex nối chuỗi với JSON chuẩn tắc. Chỉ so được tính chất phát hiện sửa ở đúng chỉ số |
