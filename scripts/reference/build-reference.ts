/**
 * Build the occupation-anchoring reference data used by gate G2.
 *
 *   pnpm exec tsx scripts/reference/build-reference.ts <rawDir> [outDir=data/reference]
 *
 * <rawDir> must contain the raw downloads, unchanged, in these subfolders:
 *
 *   vsco/Danh-muc-nghe-nghiep-Viet-Nam.xlsx
 *     Phụ lục I "Danh mục nghề nghiệp Việt Nam" ban hành kèm Quyết định 34/2020/QĐ-TTg
 *     (26/11/2020, hiệu lực 15/01/2021), published by Tổng cục Thống kê / Cục Thống kê (NSO/GSO):
 *     https://www.nso.gov.vn/wp-content/uploads/2020/12/Danh-muc-nghe-nghiep-Viet-Nam.xlsx
 *     (listed on https://www.nso.gov.vn/phuong-phap-luan-thong-ke/danh-muc/nghe-nghiep/ ;
 *      signed decision: .../2020/12/QD-34.2020.QD-TTg-Danh-muc-nghe-nghiep-Viet-Nam.pdf).
 *     Licence: legal normative document — not subject to copyright (Luật SHTT 2005, Điều 15).
 *
 *   onet/occupation_data.csv, onet/task_statements.csv, onet/task_ratings.csv
 *     O*NET 31.0 Database, CSV version, https://www.onetcenter.org/database.html
 *     https://www.onetcenter.org/dl_files/database/db_31_0_csv/{occupation_data,task_statements,task_ratings}.csv
 *     Licence: CC BY 4.0 (https://www.onetcenter.org/license_db.html) — attribution required.
 *
 *   crosswalk/ESCO_to_ONET-SOC.xlsx
 *     O*NET-SOC 2019 Crosswalks: "ESCO to O*NET-SOC 2019" (ESCO v1.1.0), O*NET Resource Center,
 *     https://www.onetcenter.org/crosswalks/esco/ESCO_to_ONET-SOC.xlsx (page: https://www.onetcenter.org/crosswalks.html)
 *     Licence: O*NET Resource Center, CC BY 4.0; uses the ESCO classification of the European Commission.
 *
 * Retrieved 2026-11-19. Outputs (outDir): vsco2020.json, onet.json, isco08_onet.json.
 *
 * VSCO → ISCO-08 derivation (see deriveIsco below):
 *  - groups 2–9: VSCO level-4 code == ISCO-08 unit-group code when that code exists in ISCO-08
 *    (ISCO-08 code set = every 4-digit prefix in the ESCO crosswalk + 8 unit groups ESCO has no
 *    occupations for). Where VSCO split/renumbered a group (e.g. 2121/2122, 239x, 244x, 36xx, 440x,
 *    540x, 820x, 920x, 940x) or reused an ISCO code with another meaning (3355 Kiểm lâm), a manual
 *    override (MANUAL) gives the ISCO code and an isco08_note.
 *  - group 1 (Vietnam-specific leadership structure) and group 0 (armed forces / public security):
 *    all mapped manually by title; every one carries an isco08_note.
 *  - level 5 inherits from its level-4 parent; levels 1–3 have isco08 = null.
 *
 * isco08 → O*NET: from the official ESCO→O*NET-SOC 2019 crosswalk. Rows whose ESCO/ISCO code is a
 * bare 4-digit ISCO unit group are "direct"; rows for ESCO occupations (code "NNNN.x") are
 * aggregated to their ISCO prefix and counted as support. No BLS ISCO↔SOC file is used
 * (bls.gov returned HTTP 403 to scripted downloads).
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const rawDir = process.argv[2];
const outDir = resolve(process.argv[3] ?? "data/reference");
if (!rawDir) {
  console.error("usage: tsx scripts/reference/build-reference.ts <rawDir> [outDir]");
  process.exit(1);
}
const raw = (p: string) => join(rawDir, p);

// ---------- minimal xlsx reader (first sheet, shared strings + inline values) ----------
const xmlDecode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");

function readXlsx(path: string): Record<string, string>[] {
  const z = unzipSync(readFileSync(path));
  const ssXml = z["xl/sharedStrings.xml"] ? strFromU8(z["xl/sharedStrings.xml"]) : "";
  const ss = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    xmlDecode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const sheet = strFromU8(z["xl/worksheets/sheet1.xml"]);
  const rows: Record<string, string>[] = [];
  for (const r of sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: Record<string, string> = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (v == null) continue;
      cells[c[1]] = /t="s"/.test(c[2]) ? ss[+v] : xmlDecode(v);
    }
    rows.push(cells);
  }
  return rows;
}

// ---------- minimal RFC4180 CSV reader ----------
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else f += ch;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

// ======================= ESCO → O*NET crosswalk (also yields the ISCO-08 code set) =======================
const escoRows = readXlsx(raw("crosswalk/ESCO_to_ONET-SOC.xlsx"));
const escoNote = escoRows.map((r) => r.B ?? "").find((b) => /ESCO v\d/.test(b)) ?? "";
const escoVersion = escoNote.match(/ESCO v[\d.]+/)?.[0] ?? "unknown";

type CwAgg = { title: string; direct: boolean; esco: Set<string> };
const iscoTitle = new Map<string, string>(); // official ISCO-08 English titles where the crosswalk has a direct row
const cw = new Map<string, Map<string, CwAgg>>(); // isco -> onet -> agg
const iscoCodes = new Set<string>();
let cwRowCount = 0;
for (const r of escoRows) {
  const code = (r.A ?? "").trim();
  const m = code.match(/^(\d{4})(\.[\d.]+)?$/);
  if (!m) continue;
  cwRowCount++;
  const isco = m[1];
  iscoCodes.add(isco);
  const direct = !m[2];
  if (direct) iscoTitle.set(isco, clean(r.B ?? ""));
  const onet = (r.C ?? "").trim();
  if (!/^\d{2}-\d{4}\.\d{2}$/.test(onet)) continue;
  const byOnet = cw.get(isco) ?? new Map<string, CwAgg>();
  cw.set(isco, byOnet);
  const agg = byOnet.get(onet) ?? { title: clean(r.D ?? ""), direct: false, esco: new Set<string>() };
  byOnet.set(onet, agg);
  if (direct) agg.direct = true;
  else agg.esco.add(code);
}
// ISCO-08 unit groups that have no ESCO occupation, hence absent from the crosswalk file.
const ISCO_WITHOUT_ESCO: Record<string, string> = {
  "1113": "Traditional chiefs and heads of villages",
  "2240": "Paramedical practitioners",
  "4414": "Scribes and related workers",
  "6310": "Subsistence crop farmers",
  "6320": "Subsistence livestock farmers",
  "6330": "Subsistence mixed crop and livestock farmers",
  "6340": "Subsistence fishers, hunters, trappers and gatherers",
  "9624": "Water and firewood collectors",
};
for (const [c, t] of Object.entries(ISCO_WITHOUT_ESCO)) {
  iscoCodes.add(c);
  if (!iscoTitle.has(c)) iscoTitle.set(c, t);
}

// ======================= VSCO 2020 =======================
type M = [isco: string | null, note: string];
// Manual VSCO level-4 → ISCO-08 mapping. Applies to all of groups 0 and 1, and to codes in
// groups 2–9 that are not ISCO-08 codes or whose meaning differs from the same ISCO code.
const MANUAL: Record<string, M> = {
  // --- group 0: Lực lượng vũ trang (VN-specific split army / public security / cipher) ---
  "0110": ["0110", "Sĩ quan quân đội → ISCO 0110 Commissioned armed forces officers"],
  "0120": ["0210", "Hạ sĩ quan, binh sĩ → ISCO 0210 NCOs (binh sĩ có thể thuộc 0310)"],
  "0130": ["0310", "Lực lượng khác trong quân đội → ISCO 0310 Armed forces occupations, other ranks (không chắc)"],
  "0210": ["3355", "Sĩ quan công an: ISCO xếp cảnh sát ngoài nhóm 0 → 3355 Police inspectors and detectives (không chắc; có thể 5412). Mã VN 0210 KHÁC nghĩa ISCO 0210"],
  "0220": ["5412", "Hạ sĩ quan, chiến sĩ công an → ISCO 5412 Police officers. Mã VN 0220 không có trong ISCO"],
  "0230": ["5412", "Lực lượng khác trong công an → ISCO 5412 Police officers (không chắc)"],
  "0310": [null, "Cơ yếu: không có nhóm ISCO-08 tương ứng rõ ràng. Mã VN 0310 KHÁC nghĩa ISCO 0310"],
  "0320": ["0310", "Lực lượng vũ trang khác → ISCO 0310 (không chắc)"],
  // --- group 1: lãnh đạo, quản lý (VN structure; mapped by title) ---
  ...Object.fromEntries(
    ["1011", "1012", "1013", "1014", "1015", "1016", "1021", "1022", "1023", "1024", "1031", "1032", "1033", "1040", "1050"].map(
      (c) => [c, ["1114", "Lãnh đạo Đảng (chuyên trách) → ISCO 1114 Senior officials of special-interest organizations (political party officials)"] as M],
    ),
  ),
  "1111": ["1111", "Lãnh đạo Quốc hội → ISCO 1111 Legislators"],
  "1112": ["1111", "Chủ nhiệm/Phó Chủ nhiệm Ủy ban của Quốc hội → ISCO 1111 Legislators"],
  "1113": ["1112", "Vụ trưởng, Phó Vụ trưởng Văn phòng Quốc hội → ISCO 1112 Senior government officials"],
  "1121": ["1111", "Chủ tịch nước → ISCO 1111 (ISCO-08 xếp nguyên thủ/head of state vào 1111)"],
  "1122": ["1112", "→ ISCO 1112 Senior government officials"],
  "1123": ["1112", "→ ISCO 1112 Senior government officials"],
  "1211": ["1111", "Thủ tướng, Phó Thủ tướng → ISCO 1111 (ISCO-08 1111 gồm bộ trưởng/thủ tướng)"],
  "1212": ["1112", "→ ISCO 1112 Senior government officials"],
  "1213": ["1112", "→ ISCO 1112 Senior government officials"],
  "1221": ["1111", "Bộ trưởng → ISCO 1111 (government minister); Thứ trưởng có thể là 1112"],
  "1222": ["1112", "→ ISCO 1112 Senior government officials"],
  "1223": ["1112", "→ ISCO 1112 Senior government officials"],
  "1231": ["1112", "→ ISCO 1112 Senior government officials"],
  "1232": ["1112", "→ ISCO 1112 Senior government officials"],
  "1311": ["1112", "Lãnh đạo TAND/VKSND tối cao → ISCO 1112 (không chắc; thẩm phán là 2612)"],
  "1312": ["1112", "→ ISCO 1112 Senior government officials"],
  "1321": ["1112", "Chánh án/Viện trưởng cấp tỉnh → ISCO 1112 (không chắc; có thể 2612)"],
  "1322": ["2612", "Chánh án TAND cấp huyện → ISCO 2612 Judges (không chắc; có thể 1112)"],
  "1330": ["2612", "Chánh án Tòa án khác → ISCO 2612 Judges (không chắc; có thể 1112)"],
  "1411": ["1111", "Thường trực HĐND cấp tỉnh → ISCO 1111 Legislators"],
  "1412": ["1111", "Trưởng ban HĐND cấp tỉnh → ISCO 1111 Legislators"],
  "1413": ["1111", "Thường trực HĐND cấp huyện → ISCO 1111 Legislators"],
  "1414": ["1111", "Trưởng ban HĐND cấp huyện → ISCO 1111 Legislators"],
  "1415": ["1111", "Chủ tịch HĐND cấp xã → ISCO 1111 Legislators"],
  "1421": ["1111", "Chủ tịch UBND cấp tỉnh → ISCO 1111 (governor/mayor) (không chắc; có thể 1112)"],
  "1422": ["1111", "Chủ tịch UBND cấp huyện → ISCO 1111 (mayor) (không chắc; có thể 1112)"],
  "1423": ["1111", "Chủ tịch UBND cấp xã → ISCO 1111 (mayor) (không chắc; có thể 1113)"],
  "1424": ["1112", "Giám đốc sở cấp tỉnh → ISCO 1112 Senior government officials"],
  "1425": ["1112", "Trưởng phòng cấp huyện → ISCO 1112 (không chắc; có thể 1213/1219)"],
  ...Object.fromEntries(
    ["1511", "1512", "1513", "1514", "1515", "1521", "1522", "1523", "1524", "1525", "1526", "1527"].map(
      (c) => [c, ["1114", "Lãnh đạo đoàn thể/công đoàn → ISCO 1114 Senior officials of special-interest organizations"] as M],
    ),
  ),
  "1610": ["1114", "Tổ chức nghiệp chủ → ISCO 1114 (employers' organizations)"],
  "1620": ["1114", "Tổ chức nhân đạo/vì quyền lợi đặc thù → ISCO 1114"],
  "1710": ["1120", "Chủ tịch HĐQT, Tổng giám đốc, Hiệu trưởng ĐH lớn → ISCO 1120 Managing directors and chief executives (Hiệu trưởng có thể 1345)"],
  ...Object.fromEntries(
    (["2", "4"] as const).flatMap((d) => [
      [`17${d}1`, ["1311", "Giám đốc đơn vị nông, lâm, thủy sản → ISCO 1311 (thủy sản: 1312)"] as M],
      [`17${d}2`, ["1321", "Khai khoáng, chế biến chế tạo, điện/khí/nước → ISCO 1321 Manufacturing managers (khai khoáng: 1322)"] as M],
      [`17${d}3`, ["1323", "Xây dựng → ISCO 1323 Construction managers"] as M],
      [`17${d}4`, ["1420", "Bán buôn, bán lẻ → ISCO 1420 Retail and wholesale trade managers"] as M],
      [`17${d}5`, ["1411", "Lưu trú và ăn uống → ISCO 1411 Hotel managers (ăn uống: 1412)"] as M],
      [`17${d}6`, ["1324", "Vận tải, kho bãi; Thông tin truyền thông → ISCO 1324 Supply, distribution and related managers (ICT: 1330)"] as M],
      [`17${d}7`, ["1219", "Dịch vụ kinh doanh → ISCO 1219 (không chắc; tài chính/bảo hiểm: 1346, chuyên môn: 1349)"] as M],
      [`17${d}8`, ["1439", "Dịch vụ cá nhân và cộng đồng → ISCO 1439 (không chắc; y tế/giáo dục/xã hội: 134x)"] as M],
      [`17${d}9`, ["1439", "Đơn vị còn lại chưa phân vào đâu → ISCO 1439 (không chắc)"] as M],
    ]),
  ),
  "1731": ["1211", "Tài chính, kế toán, quản trị hành chính → ISCO 1211 Finance managers (hành chính: 1219)"],
  "1732": ["1212", "Tổ chức nhân sự → ISCO 1212 Human resource managers"],
  "1733": ["1221", "Bán hàng và tiếp thị → ISCO 1221 Sales and marketing managers"],
  "1734": ["1222", "Quảng cáo, quan hệ công chúng → ISCO 1222 Advertising and public relations managers"],
  "1735": ["1324", "Cung ứng và phân phối → ISCO 1324 Supply, distribution and related managers"],
  "1736": ["1330", "Dịch vụ và tính toán → ISCO 1330 ICT service managers (không chắc)"],
  "1737": ["1223", "Nghiên cứu và phát triển → ISCO 1223 Research and development managers"],
  "1739": ["1219", "Đơn vị khác → ISCO 1219 (không chắc)"],
  // --- groups 2–9: codes VSCO split, renumbered or reused with another meaning ---
  "2121": ["2120", "VSCO tách ISCO 2120 Mathematicians, actuaries and statisticians thành 2121/2122"],
  "2122": ["2120", "VSCO tách ISCO 2120 Mathematicians, actuaries and statisticians thành 2121/2122"],
  "2311": ["2310", "VSCO tách ISCO 2310 University and higher education teachers"],
  "2312": ["2310", "VSCO tách ISCO 2310 University and higher education teachers"],
  "2331": ["2330", "VSCO tách ISCO 2330 Secondary education teachers"],
  "2332": ["2330", "VSCO tách ISCO 2330 Secondary education teachers"],
  "2391": ["2351", "VSCO 239x = ISCO 235x Other teaching professionals"],
  "2392": ["2352", "VSCO 239x = ISCO 235x Other teaching professionals"],
  "2393": ["2353", "VSCO 239x = ISCO 235x Other teaching professionals"],
  "2394": ["2354", "VSCO 239x = ISCO 235x Other teaching professionals"],
  "2395": ["2355", "VSCO 239x = ISCO 235x Other teaching professionals"],
  "2396": ["2356", "VSCO 239x = ISCO 235x Other teaching professionals"],
  "2399": ["2359", "VSCO 239x = ISCO 235x Other teaching professionals"],
  "2441": ["3351", "VSCO 244x (bậc cao) không có trong ISCO; ISCO chỉ có 335x bậc trung"],
  "2442": ["3352", "VSCO 244x (bậc cao) không có trong ISCO; ISCO chỉ có 335x bậc trung"],
  "2443": ["3353", "VSCO 244x (bậc cao) không có trong ISCO; ISCO chỉ có 335x bậc trung"],
  "2444": ["3354", "VSCO 244x (bậc cao) không có trong ISCO; ISCO chỉ có 335x bậc trung"],
  "2445": ["3359", "Kiểm lâm (bậc cao): không có nhóm ISCO riêng → 3359 (không chắc; ESCO xếp forest ranger vào 6210, có thể 2133)"],
  "2446": ["2422", "Nhà ngoại giao → ISCO 2422 Policy administration professionals (không chắc; đại sứ: 1112)"],
  "2449": ["3359", "VSCO 244x (bậc cao) không có trong ISCO → 3359 (không chắc)"],
  "3144": ["3142", "Kỹ thuật viên nuôi trồng thủy sản: ISCO không có 3144 → 3142 Agricultural technicians (không chắc)"],
  "3316": ["3313", "Thủ quỹ: ISCO không có 3316 → 3313 Accounting associate professionals (không chắc; có thể 4311/4211)"],
  "3355": ["3359", "Kiểm lâm: mã VN 3355 KHÁC nghĩa ISCO 3355 (Police inspectors) → 3359 (không chắc; ESCO xếp forest ranger vào 6210)"],
  "3439": ["3435", "VSCO 3439 = ISCO 3435 Other artistic and cultural associate professionals"],
  "3610": ["2341", "VSCO 36 (Giáo viên bậc trung) không có trong ISCO → 2341 Primary school teachers"],
  "3620": ["2342", "VSCO 36 (Giáo viên bậc trung) không có trong ISCO → 2342 Early childhood educators"],
  "3630": ["2352", "VSCO 36 (Giáo viên bậc trung) không có trong ISCO → 2352 Special needs teachers"],
  "3641": ["2320", "Giáo viên sơ cấp → ISCO 2320 Vocational education teachers (không chắc)"],
  "3642": ["2359", "Giáo viên đào tạo khác → ISCO 2359 Teaching professionals n.e.c. (không chắc)"],
  "4401": ["4411", "VSCO 440x = ISCO 441x Other clerical support workers"],
  "4402": ["4412", "VSCO 440x = ISCO 441x Other clerical support workers"],
  "4403": ["4413", "VSCO 440x = ISCO 441x Other clerical support workers"],
  "4404": ["4414", "VSCO 440x = ISCO 441x Other clerical support workers"],
  "4405": ["4415", "VSCO 440x = ISCO 441x Other clerical support workers"],
  "4406": ["4416", "VSCO 440x = ISCO 441x Other clerical support workers"],
  "4409": ["4419", "VSCO 440x = ISCO 441x Other clerical support workers"],
  "5401": ["5414", "Nhân viên an ninh (trừ công an) → ISCO 5414 Security guards"],
  "5409": ["5419", "→ ISCO 5419 Protective services workers n.e.c."],
  "8201": ["8211", "VSCO 820x = ISCO 821x Assemblers"],
  "8202": ["8212", "VSCO 820x = ISCO 821x Assemblers"],
  "8209": ["8219", "VSCO 820x = ISCO 821x Assemblers"],
  "9201": ["9211", "VSCO 920x = ISCO 921x Agricultural, forestry and fishery labourers"],
  "9202": ["9212", "VSCO 920x = ISCO 921x Agricultural, forestry and fishery labourers"],
  "9203": ["9213", "VSCO 920x = ISCO 921x Agricultural, forestry and fishery labourers"],
  "9204": ["9214", "VSCO 920x = ISCO 921x Agricultural, forestry and fishery labourers"],
  "9205": ["9215", "VSCO 920x = ISCO 921x Agricultural, forestry and fishery labourers"],
  "9206": ["9216", "VSCO 920x = ISCO 921x Agricultural, forestry and fishery labourers"],
  "9401": ["9411", "VSCO 940x = ISCO 941x Food preparation assistants"],
  "9402": ["9412", "VSCO 940x = ISCO 941x Food preparation assistants"],
};
// Same code as ISCO-08 but the Vietnamese title reads differently: kept, flagged.
const SAME_CODE_NOTES: Record<string, string> = {
  "7213": "Tên VN 'Thợ luyện kim loại' khác nghĩa với ISCO 7213 Sheet-metal workers; giữ theo mã",
  "6223": "VN: khai thác thủy sản trong vùng biển Việt Nam; ISCO 6223 Deep-sea fishery workers",
  "2240": "VN 'Bác sỹ phụ tá' (y sĩ) ↔ ISCO 2240 Paramedical practitioners",
};

function deriveIsco(l4: string): { isco08: string | null; isco08_note?: string } {
  const m = MANUAL[l4];
  if (m) {
    if (m[0] && !iscoCodes.has(m[0])) throw new Error(`manual map ${l4} → ${m[0]} is not an ISCO-08 code`);
    return { isco08: m[0], isco08_note: `thủ công: ${m[1]}` };
  }
  if (l4[0] === "0" || l4[0] === "1") return { isco08: null, isco08_note: "chưa ánh xạ (nhóm 0/1 cần ánh xạ thủ công)" };
  if (iscoCodes.has(l4)) {
    const note = SAME_CODE_NOTES[l4];
    return note ? { isco08: l4, isco08_note: `cùng mã; ${note}` } : { isco08: l4 };
  }
  return { isco08: null, isco08_note: "mã VN không có trong ISCO-08 và chưa có ánh xạ thủ công" };
}

type VscoRow = { code: string; level: number; title_vi: string; parent_code: string | null; isco08: string | null; isco08_note?: string };
const vsco: VscoRow[] = [];
const vscoAnomalies: string[] = [];
{
  const rows = readXlsx(raw("vsco/Danh-muc-nghe-nghiep-Viet-Nam.xlsx"));
  const cols = ["A", "B", "C", "D", "E"] as const;
  const seen = new Set<string>();
  const lastAt: (string | null)[] = [null, null, null, null, null];
  const header = rows.findIndex((r) => /Tên gọi nghề nghiệp/.test(r.F ?? ""));
  for (const r of rows.slice(header + 1)) {
    const title = clean(r.F ?? "");
    const present = cols.map((c, i) => [i + 1, (r[c] ?? "").trim()] as const).filter(([, v]) => v !== "");
    if (!present.length) continue;
    for (const [level, code] of present) {
      if (!/^\d+$/.test(code) || code.length !== level) {
        vscoAnomalies.push(`mã '${code}' ở cột cấp ${level} có độ dài ${code.length} (bỏ qua)`);
        continue;
      }
      const parent = level === 1 ? null : lastAt[level - 2];
      if (parent && !code.startsWith(parent)) vscoAnomalies.push(`mã ${code} không bắt đầu bằng mã cha ${parent}`);
      lastAt[level - 1] = code;
      for (let k = level; k < 5; k++) lastAt[k] = null;
      if (seen.has(code)) { vscoAnomalies.push(`mã trùng ${code}`); continue; }
      seen.add(code);
      let iscoInfo: { isco08: string | null; isco08_note?: string } = { isco08: null };
      if (level === 4) iscoInfo = deriveIsco(code);
      if (level === 5) {
        const p = vsco.find((v) => v.code === parent);
        iscoInfo = p ? { isco08: p.isco08, ...(p.isco08_note ? { isco08_note: p.isco08_note } : {}) } : { isco08: null };
      }
      vsco.push({ code, level, title_vi: title, parent_code: parent, ...iscoInfo });
    }
  }
}

// ======================= O*NET =======================
const occ = readCsv(raw("onet/occupation_data.csv"));
const stmts = readCsv(raw("onet/task_statements.csv"));
const ratings = readCsv(raw("onet/task_ratings.csv"));
const im = new Map<string, number>();
const rt = new Map<string, number>();
for (const r of ratings) {
  const key = `${r["O*NET-SOC Code"]}|${r["Task ID"]}`;
  if (r["Scale ID"] === "IM") im.set(key, +r["Data Value"]);
  else if (r["Scale ID"] === "RT") rt.set(key, +r["Data Value"]);
}
type Task = { task_id: number; statement: string; type: string; importance: number | null; relevance?: number };
const tasksBy = new Map<string, Task[]>();
for (const s of stmts) {
  const soc = s["O*NET-SOC Code"];
  const key = `${soc}|${s["Task ID"]}`;
  const t: Task = {
    task_id: +s["Task ID"],
    statement: clean(s["Task"]),
    type: s["Task Type"] || "n/a",
    importance: im.has(key) ? Math.round(im.get(key)! * 100) / 100 : null,
  };
  if (rt.has(key)) t.relevance = Math.round(rt.get(key)! * 10) / 10;
  const arr = tasksBy.get(soc) ?? [];
  arr.push(t);
  tasksBy.set(soc, arr);
}
const onetOccs = occ.map((o) => {
  const soc = o["O*NET-SOC Code"];
  const tasks = (tasksBy.get(soc) ?? []).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.task_id - b.task_id);
  return { onet_soc: soc, title: clean(o["Title"]), description: clean(o["Description"]), tasks };
});
const onetSet = new Set(onetOccs.map((o) => o.onet_soc));

// ======================= ISCO-08 → O*NET =======================
const unresolved: string[] = [];
const crosswalk = [...iscoCodes].sort().map((isco) => {
  const byOnet = cw.get(isco) ?? new Map<string, CwAgg>();
  const onet = [...byOnet.entries()]
    .filter(([soc]) => {
      if (onetSet.has(soc)) return true;
      unresolved.push(`${isco}→${soc}`);
      return false;
    })
    .map(([soc, a]) => ({ onet_soc: soc, title: a.title, direct: a.direct, esco_support: a.esco.size }))
    .sort((a, b) => Number(b.direct) - Number(a.direct) || b.esco_support - a.esco_support || a.onet_soc.localeCompare(b.onet_soc));
  return { isco08: isco, isco08_title: iscoTitle.get(isco) ?? null, onet };
});

// ======================= write =======================
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => {
  const p = join(outDir, name);
  writeFileSync(p, JSON.stringify(data) + "\n");
  return `${name} ${(statSync(p).size / 1024).toFixed(0)} KB`;
};
const meta = (extra: object) => ({ generated_by: "scripts/reference/build-reference.ts", retrieved: "2026-11-19", ...extra });
const out = [
  write("vsco2020.json", {
    meta: meta({
      source: "Phụ lục I, Quyết định 34/2020/QĐ-TTg — Danh mục nghề nghiệp Việt Nam",
      url: "https://www.nso.gov.vn/wp-content/uploads/2020/12/Danh-muc-nghe-nghiep-Viet-Nam.xlsx",
      isco08_derivation: "level 4: same code if it exists in ISCO-08, else manual table (isco08_note); level 5 inherits from level 4; levels 1–3 null",
    }),
    rows: vsco,
  }),
  write("onet.json", {
    meta: meta({
      source: "O*NET 31.0 Database (CSV): Occupation Data, Task Statements, Task Ratings",
      onet_version: "31.0",
      url: "https://www.onetcenter.org/database.html",
      license: "CC BY 4.0",
      attribution:
        "This product includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. The data has been reformatted (subset of fields); USDOL/ETA has not approved, endorsed, or tested these modifications.",
      fields: "importance = Task Ratings scale IM (1–5); relevance = scale RT (% of incumbents rating task relevant); type = Core/Supplemental; tasks sorted by importance desc",
    }),
    occupations: onetOccs,
  }),
  write("isco08_onet.json", {
    meta: meta({
      source: `O*NET Resource Center crosswalk "ESCO to O*NET-SOC 2019" (${escoVersion})`,
      url: "https://www.onetcenter.org/crosswalks/esco/ESCO_to_ONET-SOC.xlsx",
      license: "CC BY 4.0 (O*NET); uses the ESCO classification of the European Commission",
      chain:
        "ISCO-08 unit group (4-digit) → O*NET-SOC 2019 code. direct=true: crosswalk row for the bare ISCO code; esco_support = number of ESCO occupations under that ISCO group mapped to the O*NET code. Sorted direct first, then by support.",
    }),
    crosswalk,
  }),
];

// ======================= checks / summary =======================
const byLevel = [1, 2, 3, 4, 5].map((l) => vsco.filter((v) => v.level === l).length);
const l4 = vsco.filter((v) => v.level === 4);
const l4Isco = l4.filter((v) => v.isco08);
const l4Noted = l4.filter((v) => v.isco08_note);
const l4NoOnet = l4Isco.filter((v) => !(crosswalk.find((c) => c.isco08 === v.isco08)?.onet.length));
const totalTasks = onetOccs.reduce((n, o) => n + o.tasks.length, 0);
const noIm = onetOccs.reduce((n, o) => n + o.tasks.filter((t) => t.importance == null).length, 0);
console.log(out.join("\n"));
console.log(`VSCO rows by level 1..5: ${byLevel.join(", ")} (total ${vsco.length})`);
console.log(`VSCO level 4: ${l4.length}, with isco08: ${l4Isco.length}, with note: ${l4Noted.length}, isco08 without O*NET link: ${l4NoOnet.map((v) => `${v.code}→${v.isco08}`).join(" ") || "none"}`);
console.log(`VSCO anomalies: ${vscoAnomalies.length ? vscoAnomalies.join("; ") : "none"}`);
console.log(`O*NET occupations: ${onetOccs.length}, with tasks: ${onetOccs.filter((o) => o.tasks.length).length}, tasks: ${totalTasks}, without IM: ${noIm}`);
console.log(`ISCO-08 codes: ${crosswalk.length}, with O*NET: ${crosswalk.filter((c) => c.onet.length).length}, crosswalk rows read: ${cwRowCount}, links: ${crosswalk.reduce((n, c) => n + c.onet.length, 0)}, unresolved O*NET codes: ${unresolved.length ? unresolved.join(" ") : "none"}`);
