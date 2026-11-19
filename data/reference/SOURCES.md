# Dữ liệu tham chiếu cho G2 (neo nghề nghiệp)

Tạo lại bằng lệnh:
`pnpm exec tsx scripts/reference/build-reference.ts <thư-mục-raw> [data/reference]`
(thư mục raw có các thư mục con `vsco/`, `onet/`, `crosswalk/` chứa đúng các tệp tải về nêu dưới đây, không chỉnh sửa). Ngày tải: 2026-11-19.

## 1. `vsco2020.json` — Danh mục nghề nghiệp Việt Nam (VSCO 2020)

- Nguồn: Phụ lục I, Quyết định 34/2020/QĐ-TTg ngày 26/11/2020 (hiệu lực 15/01/2021), bản Excel do Cục Thống kê (NSO/GSO) công bố:
  https://www.nso.gov.vn/wp-content/uploads/2020/12/Danh-muc-nghe-nghiep-Viet-Nam.xlsx
  (trang: https://www.nso.gov.vn/phuong-phap-luan-thong-ke/danh-muc/nghe-nghiep/ ; văn bản ký: `QD-34.2020.QD-TTg-Danh-muc-nghe-nghiep-Viet-Nam.pdf` cùng thư mục). Tệp sửa lần cuối 2020-11-26.
- Giấy phép: văn bản quy phạm pháp luật, không thuộc đối tượng bảo hộ quyền tác giả (Luật SHTT, Điều 15). Nên ghi nguồn "Quyết định 34/2020/QĐ-TTg".
- Số dòng: 1.504 (cấp 1: 10, cấp 2: 48, cấp 3: 152, cấp 4: 509, cấp 5: 785). Có đủ 5 cấp.
- Trường `isco08`: chỉ có ở cấp 4 và 5 (cấp 5 kế thừa từ cấp 4); cấp 1–3 là `null`.
  - Nhóm 2–9: mã cấp 4 VN trùng mã ISCO-08 thì lấy nguyên mã (bộ mã ISCO-08 lấy từ bảng chuyển đổi ESCO→O*NET, cộng 8 nhóm ISCO không có nghề ESCO).
  - 142 mã cấp 4 ánh xạ thủ công theo tên gọi (có `isco08_note` bắt đầu bằng "thủ công"): toàn bộ nhóm 0 và nhóm 1 (cấu trúc lãnh đạo đặc thù VN), và các nhóm VN tách/đánh số lại (2121/2122, 231x, 233x, 239x, 244x, 3144, 3316, 3439, 36xx, 440x, 540x, 820x, 920x, 940x) hoặc dùng mã ISCO với nghĩa khác (3355 Kiểm lâm, 0210…).
  - 28 mã ghi "không chắc" trong `isco08_note`; 3 mã trùng mã nhưng tên khác sắc thái (2240, 6223, 7213).
- Thiếu sót đã biết:
  - 0310 "Cơ yếu" không có ISCO tương ứng (`isco08 = null`).
  - Nguồn ghi mã cấp 5 của 1330 là "1330" (sai độ dài) nên không xuất dòng cấp 5 cho 1330; dùng mã cấp 4.
  - Không có Phụ lục II (mô tả nghề) — chỉ có tên gọi.
  - Ánh xạ VN→ISCO là suy diễn của nhóm dự án, không phải bảng chuyển đổi chính thức của GSO/ILO.

## 2. `onet.json` — O*NET 31.0

- Nguồn: O*NET 31.0 Database (bản CSV), https://www.onetcenter.org/database.html — các tệp `occupation_data.csv`, `task_statements.csv`, `task_ratings.csv` tại `https://www.onetcenter.org/dl_files/database/db_31_0_csv/`.
- Giấy phép: CC BY 4.0. **Bắt buộc ghi công** (đặt ở nơi hiển thị dữ liệu O*NET):
  > This product includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. [Tên tổ chức] has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications.
- Số dòng: 1.016 nghề (923 nghề có nhiệm vụ; các nghề "All Other" không có), 18.838 nhiệm vụ (Core 14.071, Supplemental 4.349, 418 chưa phân loại).
- Mỗi nhiệm vụ: `importance` = thang IM (1–5), `relevance` = thang RT (% người làm nghề cho là liên quan), `type`. Giữ cả Core và Supplemental vì kích thước vẫn nhỏ (~3,7 MB); lọc `type === "Core"` khi cần. Nhiệm vụ sắp xếp theo `importance` giảm dần.
- Thiếu sót: 418 nhiệm vụ chưa có điểm IM (`importance: null`) — là nhiệm vụ mới chưa được khảo sát.

## 3. `isco08_onet.json` — ISCO-08 → O*NET-SOC 2019

- Nguồn: O*NET Resource Center, "ESCO to O*NET-SOC 2019" crosswalk (dùng ESCO v1.1.0), https://www.onetcenter.org/crosswalks/esco/ESCO_to_ONET-SOC.xlsx (trang https://www.onetcenter.org/crosswalks.html). Giấy phép CC BY 4.0 (O*NET); "This publication uses the ESCO classification of the European Commission."
- Chuỗi chuyển đổi: mã ISCO-08 4 chữ số → mã O*NET-SOC 2019. `direct: true` = dòng chuyển đổi của chính nhóm ISCO; `esco_support` = số nghề ESCO thuộc nhóm ISCO đó được nối tới mã O*NET này. Sắp xếp: direct trước, rồi theo support.
- Số dòng: 436 nhóm ISCO-08; 428 có ít nhất 1 mã O*NET (344 có liên kết trực tiếp, 84 chỉ có liên kết qua nghề ESCO); 4.103 liên kết; mọi mã O*NET đều có trong `onet.json`.
- Thiếu sót:
  - 8 nhóm ISCO không có liên kết O*NET: 1113, 2240, 4414, 6310, 6320, 6330, 6340, 9624. Các mã VN ánh xạ tới chúng: 2240, 4404, 6310, 6320, 6330, 6340, 9624.
  - Liên kết chỉ qua nghề ESCO (không direct) có thể nhiễu (ví dụ ISCO 3313 → có cả 11-2033.00 Fundraising Managers); 109 mã VN cấp 4 rơi vào trường hợp này — nên ưu tiên `direct` và `esco_support` cao.
  - Không dùng được bảng BLS ISCO-08↔SOC 2010 (bls.gov trả HTTP 403 với tải tự động).
