/**
 * node scripts/sample/po-full.mjs [--base=http://127.0.0.1:3100] [--session=<id>]   (BASIC_AUTH=user:password behind basic auth)
 *
 * Creates a demo session "Phiên đầy đủ · Product Owner" (SOP level C) with 15 Product Owner JDs written for the demo:
 * fictional companies across 15 industries, posted within the last 6 months, each with a source URL, sharing the same
 * ~10 competency themes in different wording, so a run can go through B0→B8 under the SOP thresholds
 * (≥ 15 valid JDs, ≥ 5 P1, core 8–14, coverage ≥ 80%). Calls the web API only; no AI call.
 */
const base = (process.argv.find((a) => a.startsWith('--base=')) ?? '--base=http://127.0.0.1:3100').slice(7);

const COMPANIES = [
  ['Ví Sao Mai', 'fintech', 'ví điện tử cho người dùng cá nhân', 'visaomai.vn'],
  ['Giao Nhanh 247', 'logistics', 'nền tảng điều phối giao hàng chặng cuối', 'giaonhanh247.vn'],
  ['Học Vui', 'giáo dục trực tuyến', 'ứng dụng học tiếng Anh cho học sinh', 'hocvui.edu.vn'],
  ['Khám Nhanh', 'y tế số', 'ứng dụng đặt lịch khám và hồ sơ sức khỏe', 'khamnhanh.vn'],
  ['Chợ Phố', 'thương mại điện tử', 'sàn thương mại điện tử cho người bán nhỏ', 'chopho.vn'],
  ['Nhân Sự Một', 'phần mềm nhân sự', 'phần mềm chấm công và tính lương SaaS', 'nhansumot.com'],
  ['Đi Đâu', 'du lịch', 'nền tảng đặt phòng và tour trong nước', 'didau.travel'],
  ['Bảo An Số', 'bảo hiểm', 'ứng dụng mua và bồi thường bảo hiểm', 'baoanso.vn'],
  ['Bếp Nhà', 'bán lẻ thực phẩm', 'ứng dụng đi chợ online', 'bepnha.vn'],
  ['Ngân Hàng Số Việt', 'ngân hàng', 'ngân hàng số cho doanh nghiệp nhỏ', 'nganhangsoviet.vn'],
  ['Nhà Tốt Hơn', 'bất động sản', 'nền tảng đăng tin và quản lý cho thuê', 'nhatothon.vn'],
  ['Kho Thông Minh', 'chuỗi cung ứng', 'phần mềm quản lý kho SaaS', 'khothongminh.vn'],
  ['Phim Mới', 'giải trí', 'ứng dụng xem phim theo gói', 'phimmoi.media'],
  ['Viễn Thông Xanh', 'viễn thông', 'cổng tự phục vụ cho thuê bao di động', 'vienthongxanh.vn'],
  ['Nông Sản Việt', 'nông nghiệp số', 'sàn kết nối nông dân và nhà thu mua', 'nongsanviet.vn'],
];

// Ten competency themes; every JD uses most of them, worded differently (index = variant).
const DUTIES = [
  ['Xây dựng, duy trì và sắp xếp thứ tự ưu tiên product backlog theo giá trị kinh doanh.', 'Quản lý product backlog, ưu tiên hạng mục theo giá trị mang lại và rủi ro.', 'Sắp xếp ưu tiên các hạng mục trong backlog dựa trên giá trị cho khách hàng và chi phí trì hoãn.'],
  ['Viết user story kèm tiêu chí nghiệm thu rõ ràng, kiểm thử được.', 'Chuyển yêu cầu thành user story và tiêu chí nghiệm thu cho đội phát triển.', 'Soạn user story và acceptance criteria đủ chi tiết để đội phát triển ước lượng và kiểm thử.'],
  ['Làm việc với khách hàng và các phòng ban để thu thập, phân tích yêu cầu nghiệp vụ.', 'Phân tích yêu cầu nghiệp vụ từ khách hàng, kinh doanh và vận hành.', 'Thu thập và phân tích yêu cầu từ người dùng và các bộ phận nghiệp vụ.'],
  ['Điều phối các bên liên quan để thống nhất phạm vi và thứ tự ưu tiên.', 'Làm cầu nối giữa đội kỹ thuật, kinh doanh và ban lãnh đạo, thống nhất phạm vi từng đợt phát hành.', 'Trao đổi với các bên liên quan, đàm phán phạm vi và giải quyết xung đột ưu tiên.'],
  ['Xác định tầm nhìn sản phẩm và lộ trình phát triển theo quý.', 'Xây dựng lộ trình sản phẩm gắn với mục tiêu kinh doanh của công ty.', 'Đề xuất và cập nhật lộ trình sản phẩm theo chiến lược và phản hồi thị trường.'],
  ['Tham gia sprint planning, sprint review và retrospective cùng đội Scrum.', 'Đồng hành cùng đội phát triển trong các sự kiện Scrum, làm rõ yêu cầu trong sprint.', 'Tham gia lập kế hoạch sprint và buổi review, trả lời câu hỏi của đội phát triển trong sprint.'],
  ['Nghiệm thu tính năng trước khi phát hành theo tiêu chí đã thống nhất.', 'Kiểm tra và nghiệm thu sản phẩm trước mỗi lần phát hành.', 'Nghiệm thu kết quả của sprint so với tiêu chí nghiệm thu trước khi đưa tới người dùng.'],
  ['Theo dõi chỉ số sử dụng sau phát hành và đề xuất cải tiến.', 'Đo lường kết quả sau phát hành (tỷ lệ chuyển đổi, giữ chân) để quyết định bước tiếp theo.', 'Phân tích số liệu sử dụng sản phẩm sau phát hành để đánh giá giá trị mang lại.'],
  ['Thu thập phản hồi người dùng, phối hợp với đội UX để kiểm chứng giải pháp.', 'Phối hợp với thiết kế UX phỏng vấn và thử nghiệm giải pháp với người dùng thật.', 'Tổ chức thu thập phản hồi khách hàng và kiểm chứng giả thuyết sản phẩm cùng đội thiết kế.'],
  ['Phối hợp với đội kỹ thuật đánh giá tính khả thi và đánh đổi giải pháp.', 'Làm việc với kiến trúc sư và lập trình viên để cân nhắc phương án kỹ thuật.', 'Trao đổi với đội kỹ thuật về giới hạn, API và phương án triển khai.'],
  ['Lập kế hoạch phát hành, theo dõi phụ thuộc giữa các đội và cảnh báo sớm rủi ro tiến độ.', 'Quản lý kế hoạch phát hành nhiều đợt và các phụ thuộc liên đội.', 'Theo dõi rủi ro và phụ thuộc của từng đợt phát hành, điều chỉnh kế hoạch khi cần.'],
  ['Trình bày demo và truyền đạt giá trị tính năng mới cho khách hàng, đội kinh doanh và hỗ trợ.', 'Chuẩn bị tài liệu giới thiệu tính năng và hướng dẫn đội hỗ trợ trước khi phát hành.', 'Truyền đạt thay đổi sản phẩm tới khách hàng và các đội nội bộ.'],
  ['Đảm bảo yêu cầu sản phẩm tuân thủ quy định pháp lý, bảo mật và quyền riêng tư dữ liệu.', 'Đưa yêu cầu bảo mật và tuân thủ quy định vào tiêu chí của từng tính năng.', 'Phối hợp pháp chế và bảo mật để sản phẩm đáp ứng quy định dữ liệu cá nhân.'],
];
const REQS = [
  ['Kinh nghiệm quản lý backlog và ưu tiên tính năng.', 'Kỹ năng ưu tiên hóa theo giá trị kinh doanh.', 'Thành thạo kỹ thuật ưu tiên như MoSCoW, WSJF.'],
  ['Kỹ năng viết user story và tiêu chí nghiệm thu.', 'Viết tài liệu yêu cầu rõ ràng, mạch lạc.', 'Viết user story và acceptance criteria chất lượng.'],
  ['Kỹ năng phân tích yêu cầu nghiệp vụ tốt.', 'Tư duy phân tích, mô hình hóa nghiệp vụ.', 'Khả năng phân tích và làm rõ yêu cầu phức tạp.'],
  ['Kỹ năng giao tiếp và quản lý các bên liên quan.', 'Khả năng đàm phán và thuyết phục.', 'Giao tiếp tốt với cả đội kỹ thuật và kinh doanh.'],
  ['Tư duy sản phẩm, định hướng tầm nhìn và lộ trình.', 'Khả năng xây dựng lộ trình sản phẩm.', 'Hiểu thị trường và định hướng chiến lược sản phẩm.'],
  ['Hiểu biết vững về Agile/Scrum.', 'Có kinh nghiệm làm việc trong môi trường Scrum.', 'Nắm chắc vai trò Product Owner trong Scrum; có chứng chỉ PSPO là lợi thế.'],
  ['Cẩn thận trong nghiệm thu chất lượng sản phẩm.', 'Kinh nghiệm kiểm thử chấp nhận người dùng (UAT).', 'Có kinh nghiệm nghiệm thu sản phẩm phần mềm.'],
  ['Tư duy dữ liệu, biết đọc chỉ số sản phẩm; biết SQL cơ bản là lợi thế.', 'Ra quyết định dựa trên số liệu.', 'Kỹ năng phân tích dữ liệu sản phẩm (Google Analytics, Mixpanel hoặc tương đương).'],
  ['Hiểu nghiên cứu người dùng và trải nghiệm người dùng.', 'Biết cách thu thập và tổng hợp phản hồi khách hàng.', 'Quan tâm tới trải nghiệm người dùng, từng làm việc với designer.'],
  ['Hiểu biết kỹ thuật cơ bản về web, mobile và API.', 'Nền tảng kỹ thuật phần mềm để trao đổi với lập trình viên.', 'Hiểu kiến trúc hệ thống ở mức đủ để cân nhắc đánh đổi kỹ thuật.'],
  ['Kinh nghiệm lập kế hoạch phát hành và quản lý rủi ro tiến độ.', 'Kỹ năng quản lý phụ thuộc giữa nhiều đội.', 'Biết lập và điều chỉnh kế hoạch phát hành.'],
  ['Kỹ năng trình bày và truyền đạt sản phẩm cho khách hàng.', 'Khả năng thuyết trình, demo sản phẩm.', 'Truyền đạt rõ ràng tới đối tượng không chuyên kỹ thuật.'],
  ['Hiểu biết về bảo mật dữ liệu và quy định pháp lý của ngành.', 'Hiểu quy định về dữ liệu cá nhân.', 'Có ý thức tuân thủ và bảo mật khi thiết kế sản phẩm.'],
];

// one task specific to each company's product, so no two postings read alike (near-duplicate J < 0.85)
const OWN = [
  ['Ưu tiên tính năng thanh toán QR và chuyển tiền nhanh theo dữ liệu giao dịch.', 'Phối hợp bộ phận tuân thủ để yêu cầu sản phẩm đáp ứng quy định của Ngân hàng Nhà nước.'],
  ['Tối ưu luồng phân tuyến cho tài xế cùng đội vận hành kho.', 'Xác định yêu cầu tích hợp API với các sàn thương mại điện tử đối tác.'],
  ['Thiết kế lộ trình học cá nhân hóa cùng đội chuyên môn sư phạm.', 'Phân tích tỷ lệ hoàn thành bài học để cải tiến nội dung.'],
  ['Làm rõ yêu cầu tích hợp với hệ thống bệnh viện (HIS) cùng đối tác.', 'Đảm bảo yêu cầu bảo mật dữ liệu sức khỏe được đưa vào từng user story.'],
  ['Cải tiến luồng đăng sản phẩm cho người bán nhỏ.', 'Ưu tiên các tính năng khuyến mãi theo mùa cao điểm.'],
  ['Thu thập yêu cầu tính lương theo quy định bảo hiểm xã hội từ khách hàng doanh nghiệp.', 'Phối hợp đội triển khai để nghiệm thu với khách hàng lớn.'],
  ['Tối ưu luồng tìm kiếm và đặt phòng trên ứng dụng di động.', 'Làm việc với đối tác khách sạn để chuẩn hóa dữ liệu phòng.'],
  ['Đơn giản hóa luồng nộp hồ sơ bồi thường trực tuyến.', 'Phối hợp bộ phận thẩm định để tự động hóa quy tắc xét duyệt.'],
  ['Cải tiến luồng giỏ hàng và giao hàng trong ngày.', 'Phân tích hành vi mua lặp lại để đề xuất tính năng gợi ý.'],
  ['Ưu tiên tính năng mở tài khoản trực tuyến cho doanh nghiệp (eKYC).', 'Làm việc với khối rủi ro để đưa hạn mức giao dịch vào yêu cầu sản phẩm.'],
  ['Xây dựng tính năng quản lý hợp đồng thuê cho chủ nhà.', 'Cải thiện chất lượng tin đăng bằng quy tắc kiểm duyệt tự động.'],
  ['Xác định yêu cầu quét mã vạch và kiểm kê trên thiết bị cầm tay.', 'Phối hợp đội tích hợp kết nối với phần mềm kế toán của khách hàng.'],
  ['Ưu tiên tính năng gợi ý nội dung dựa trên lịch sử xem.', 'Làm việc với đội bản quyền để đưa điều kiện phát hành vào yêu cầu.'],
  ['Đơn giản hóa luồng đổi gói cước và nạp tiền trên cổng tự phục vụ.', 'Phân tích cuộc gọi tổng đài để tìm nhu cầu tự phục vụ mới.'],
  ['Xây dựng tính năng đặt cọc và theo dõi đơn thu mua cho nhà thu mua.', 'Làm việc với hợp tác xã để kiểm chứng giải pháp tại vùng trồng.'],
];
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = (xs) => xs.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const today = new Date();
const daysAgo = (n) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
const docs = COMPANIES.map(([name, industry, product, domain], i) => {
  // each JD uses 10 of the 13 themes (three left out, rotating), one wording per theme so the extracted competencies
  // agree across postings; postings differ by company, product, the subset of themes and their order. Thirteen themes
  // leave room above the core minimum of 8 when the seats drop a few candidates.
  const N = DUTIES.length;
  const skip = new Set([(i * 3) % N, (i * 7 + 4) % N, (i * 5 + 9) % N]);
  for (let k = 1; skip.size < 3; k++) skip.add((i + k) % N);
  const themes = [...Array(N).keys()].filter((k) => !skip.has(k));
  const v = i % 3;
  const years = 2 + (i % 3);
  const text = [
    `Product Owner (cấp Chuyên viên) – ${product}`,
    `${name} là công ty phần mềm phát triển sản phẩm số cho lĩnh vực ${industry}; đội sản phẩm làm việc theo Scrum.`,
    `Vị trí: Product Owner · Cấp bậc: Chuyên viên · ${years}–${years + 2} năm kinh nghiệm phát triển sản phẩm phần mềm.`,
    'Mô tả công việc:',
    ...shuffle(themes.map((k) => DUTIES[k][0])).map((x) => `- ${x}`),
    'Yêu cầu:',
    `- ${years} năm trở lên ở vị trí Product Owner hoặc Business Analyst cho sản phẩm phần mềm.`,
    ...shuffle(themes.slice(0, 5).map((k) => REQS[k][0])).map((x) => `- ${x}`),
  ].join('\n');
  return { name: `PO · ${name} (${industry})`, text, source_ref: `https://${domain}/tuyen-dung/product-owner`, origin_group: name, posted_at: daysAgo(10 + i * 11) };
});

async function call(path, init) {
  // BASIC_AUTH=user:password for a site behind basic auth (production)
  const auth = process.env.BASIC_AUTH ? { authorization: `Basic ${Buffer.from(process.env.BASIC_AUTH).toString('base64')}` } : {};
  const r = await fetch(`${base}/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...auth, ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(body)}`);
  return body;
}
const existing = (process.argv.find((a) => a.startsWith('--session=')) ?? '').slice(10);
const session = existing ? { id: existing } : await call('/sessions', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Phiên đầy đủ · Product Owner',
    role_title: 'Product Owner',
    purpose: 'Khung tuyển dụng và đánh giá Product Owner',
    context: 'Công ty phần mềm phát triển sản phẩm số theo Scrum',
    family: 'Quản lý sản phẩm',
    industry: 'Phần mềm',
    charter: { policy_id: 'sop-c', level: 'Chuyên viên', framework_type: 'ROOT', decision: 'Tuyển dụng và đánh giá thử việc', owner: 'Trưởng nhóm sản phẩm', outcomes: ['Sản phẩm phát hành đúng hạn và đúng phạm vi đã thống nhất', 'Mỗi lần phát hành mang lại giá trị kinh doanh đo được', 'Đội phát triển hiểu rõ và thống nhất thứ tự ưu tiên'] },
  }),
});
const set = await call(`/sessions/${session.id}/jd-sets`, { method: 'POST', body: JSON.stringify({ documents: docs }) });
console.log(JSON.stringify({ session: session.id, revision: set.revision, documents: docs.length, url: `${base}/s/${session.id}/inputs` }));
