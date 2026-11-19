# Plan P5 · Sản xuất hàng loạt và chất lượng từ điển

| | |
| --- | --- |
| Đặc tả gốc | `docs/specs/competence-lab-upgrade-spec.md`, mục 9 và 13 (bước 27–29) |
| Trạng thái | Đã làm bước 27–28. Chờ nghiệm thu bước 29 |

## 1. Đã làm · `packages/pipeline/src/production.ts`, màn `/production`

| Mã | Làm gì |
| --- | --- |
| P5.1 | Danh mục sản xuất (`production_item`, migration `0010`): khung gốc, phái sinh theo cấp bậc, biến thể ngành. Tạo lô ở màn Sản xuất |
| P5.2 | Phái sinh kế thừa charter (bộ ngưỡng, kết quả chính, người phụ trách) và trỏ về phiên của khung gốc. Năng lực dùng lại nguyên từ từ điển, đã đủ 2–4 chỉ báo mỗi bậc 1/3/5, thì giữ chỉ báo: không gọi E6, E7 cho phần kế thừa |
| P5.3 | Tỷ lệ trùng với khung gốc (43) = \|C khung ∩ C khung gốc\| / \|C khung\|, tính ở B8; dưới 0,60 ghi "nên làm khung gốc mới". Hiện ở màn Sản xuất |
| P5.4 | Thẩm định theo lô: E8 thẩm định mọi khung gốc và ⌈1/5⌉ khung phái sinh chọn ngẫu nhiên (seed theo lô). Khung ngoài mẫu: G7 đạt bằng phiếu sai lệch. Một khung trượt thẩm định thì cả lô vào mẫu |
| P5.5 | Chất lượng từ điển: Phân biệt (cặp gần nghĩa ≥ 0,6), Bao phủ (được khung dùng), Rõ và đo được, Có căn cứ, Ổn định (không đổi S/D trong 4 bản gần nhất) |
| P5.6 | Khung đến hạn rà soát (36) trong 60 ngày, có liên kết mở phiên để tạo lượt rà soát |
| P5.7 | Chỉ số vận hành mỗi khung: chu kỳ, tỷ lệ dùng lại từ điển, tỷ lệ trùng khung gốc, tỷ lệ chỉ báo đạt lần đầu, số cổng qua lần đầu, số phiếu sai lệch, token, chi phí, số chỉ báo kế thừa |

Kèm theo: chỉ báo ghi vào từ điển có thêm `level`. Mục dùng lại (REUSE) giữ căn cứ có sẵn trong từ điển, nên không bị tính là "thiếu nguồn" ở B7, B8.

## 2. Lệch so với spec

1. **Tỷ lệ trùng chưa hiện ở Từ điển → So sánh vai trò và Đầu vào (khung gốc gợi ý)**: mới có ở màn Sản xuất và output B8.
2. **"Chạy lại B1 rút gọn với JD mới" khi đến hạn rà soát** chưa tự động: màn Sản xuất chỉ liệt kê và dẫn tới phiên để tạo lượt mới.
3. **Định nghĩa (43)**: white paper không ghi công thức trong bản văn bản; dùng tỷ lệ năng lực của khung nằm trong khung gốc.
4. **Kiểm soát theo lô chỉ quét KS1 trong từng lượt** (G6), chưa có lượt quét chung cho cả lô.

## 3. Nghiệm thu P5 · test

Một lô 1 khung gốc + 3 khung phái sinh chạy xong; phái sinh không gọi E6, E7 cho phần kế thừa; tỷ lệ trùng = 1; đúng 1/3 phái sinh được thẩm định, và cả lô vào mẫu khi một khung trượt: `tests/integration/p5.test.ts`, `tests/e2e/a11-production.spec.ts`.
