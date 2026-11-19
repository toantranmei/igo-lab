/* Competence Lab wireframe: animated data stories and live formula computation.
   Every number shown in these stories is computed here from the item-level data below. */
(() => {
  const hasG = typeof window.gsap !== 'undefined';
  const NS = 'http://www.w3.org/2000/svg';
  const S = (tag, a = {}, p) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const T = (p, x, y, s, a = {}) => { const e = S('text', { x, y, 'font-size': 11, fill: '#1d1d1b', ...a }, p); e.textContent = s; return e; };
  const vn = (x, d = 2) => Number(x).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const C = { c1: '#2a78d6', c2: '#eb6834', c3: '#1baf7a', ink: '#1d1d1b', ink2: '#5c5b57', ink3: '#9a9893', line: '#d9d8d3', fill: '#efeee9', bad: '#b3261e', ok: '#1a8a5c', warn: '#b4580f', ai: '#6a4fc4' };
  const SEAT = [{ n: 'Haiku', c: '#1baf7a' }, { n: 'Sonnet', c: '#2a78d6' }, { n: 'Opus', c: '#6a4fc4' }];
  const sha256 = async (s) => { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return 'không tính được trong trình duyệt này'; } };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const variance = (a) => { const m = mean(a); return a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1); };
  const rwg = (a) => Math.max(0, 1 - variance(a) / 2);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const tri = (s) => { s = ' ' + s.toLowerCase().normalize('NFC') + ' '; const set = new Set(); for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3)); return set; };
  const jac = (a, b) => { const A = tri(a), B = tri(b); let n = 0; A.forEach((x) => B.has(x) && n++); return n / (A.size + B.size - n); };
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // ---------- styles ----------
  document.head.insertAdjacentHTML('beforeend', `<style>
  .pl { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #fff; }
  .pl-ctl { display: flex; gap: 6px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--line); background: var(--fill); flex-wrap: wrap; }
  .pl-ctl button { cursor: pointer; font: inherit; } .pl-scrub { flex: 1; min-width: 160px; accent-color: #1d1d1b; }
  .pl-main { display: grid; grid-template-columns: 230px minmax(0, 1fr); }
  .pl-beats { margin: 0; padding: 8px; list-style: none; border-right: 1px solid var(--line); background: #fcfcfb; }
  .pl-beats li { padding: 6px 8px; border-radius: 6px; cursor: pointer; margin-bottom: 2px; font-size: 12px; color: var(--ink2); }
  .pl-beats li b { display: block; color: var(--ink); font-weight: 600; font-size: 12px; } .pl-beats li span { display: block; font-size: 11.5px; line-height: 1.4; }
  .pl-beats li.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); } .pl-beats li.done b::after { content: " ✓"; color: var(--ok); }
  .pl-right { min-width: 0; } .pl-stage { display: block; width: 100%; height: auto; background: #fcfcfb; }
  .pl-calc { border-top: 1px solid var(--line); padding: 8px 12px; font-size: 12px; min-height: 54px; background: #fff; }
  .pl-calc .f { font-family: "Times New Roman", serif; font-style: italic; font-size: 13.5px; } .pl-calc .k { color: var(--ink3); font-size: 10.5px; letter-spacing: .5px; font-weight: 700; text-transform: uppercase; margin-right: 6px; }
  .pl-calc table td { padding: 3px 6px; }
  .compsel { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; } .compsel span { border: 1px solid var(--line2); border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; background: #fff; } .compsel span.on { background: var(--ink); color: #fff; border-color: var(--ink); }
  .ev-row { cursor: pointer; } .ev-row.on td { background: var(--accent-soft); }
  .netwrap .legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11.5px; color: var(--ink2); padding: 6px 10px; border-top: 1px solid var(--line); }
  .netwrap .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 4px; vertical-align: -2px; }
  </style>`);

  // ---------- player ----------
  function player(root, beats, build, h = 380) {
    if (root._tl) root._tl.kill();
    root.innerHTML = '';
    if (!hasG) { root.innerHTML = '<div class="banner warn"><div class="small">Không tải được thư viện hoạt ảnh GSAP (cần mạng để tải từ cdnjs). Các phép tính vẫn hiện ở tab Kết quả và biểu đồ.</div></div>'; return null; }
    const wrap = document.createElement('div');
    wrap.className = 'pl';
    wrap.innerHTML = `<div class="pl-ctl"><button class="btn pri" data-a="play">▶ Phát</button><button class="btn" data-a="prev" title="Nhịp trước">‹</button><button class="btn" data-a="next" title="Nhịp sau">›</button><button class="btn ghost" data-a="restart">⟲ Từ đầu</button><span class="seg pl-speed"><span data-v="0.5">0,5×</span><span data-v="1" class="on">1×</span><span data-v="2">2×</span></span><input type="range" min="0" max="1000" value="0" class="pl-scrub" aria-label="Tua"></div>
      <div class="pl-main"><ol class="pl-beats">${beats.map((b, i) => `<li data-i="${i}"><b>${i + 1}. ${b[0]}</b><span>${b[1]}</span></li>`).join('')}</ol><div class="pl-right"><svg class="pl-stage" viewBox="0 0 900 ${h}" role="img"></svg><div class="pl-calc"></div></div></div>`;
    root.appendChild(wrap);
    const svg = wrap.querySelector('svg'), calc = wrap.querySelector('.pl-calc');
    const tl = gsap.timeline({ paused: true });
    const labels = [];
    const mark = (i, gap = 0.25) => { if (i > 0) tl.to({}, { duration: gap }); tl.addLabel('b' + i); labels[i] = tl.labels['b' + i]; };
    build({ svg, calc, tl, mark });
    tl.to({}, { duration: 0.4 });
    const lis = [...wrap.querySelectorAll('.pl-beats li')];
    const scrub = wrap.querySelector('.pl-scrub'), playB = wrap.querySelector('[data-a=play]');
    const beatAt = () => { const t = tl.time(); let k = 0; labels.forEach((v, i) => { if (t >= v - 1e-6) k = i; }); return k; };
    const sync = () => { scrub.value = Math.round(tl.progress() * 1000); const k = beatAt(); lis.forEach((l, i) => { l.classList.toggle('on', i === k); l.classList.toggle('done', i < k || tl.progress() >= 1); }); playB.textContent = tl.isActive() ? '⏸ Dừng' : tl.progress() >= 1 ? '⟲ Phát lại' : '▶ Phát'; };
    tl.eventCallback('onUpdate', sync); tl.eventCallback('onComplete', sync);
    wrap.addEventListener('click', (e) => {
      const sp = e.target.closest('.pl-speed span');
      if (sp) { tl.timeScale(+sp.dataset.v); wrap.querySelectorAll('.pl-speed span').forEach((x) => x.classList.toggle('on', x === sp)); return; }
      const li = e.target.closest('.pl-beats li');
      if (li) { tl.seek(labels[+li.dataset.i] + 0.001, false); tl.play(); sync(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'play') { if (tl.isActive()) tl.pause(); else if (tl.progress() >= 1) tl.restart(); else tl.play(); }
      if (a === 'restart') tl.restart();
      if (a === 'next') { const k = beatAt(); tl.pause(); tl.seek(labels[k + 1] != null ? labels[k + 1] : tl.duration(), false); }
      if (a === 'prev') { const k = beatAt(); const back = tl.time() - labels[k] > 0.3 ? k : Math.max(0, k - 1); tl.pause(); tl.seek(labels[back], false); }
      sync();
    });
    scrub.addEventListener('input', () => { tl.pause(); tl.progress(scrub.value / 1000, false); sync(); });
    root._tl = tl; sync();
    return tl;
  }
  // A counter tween: fn(value) renders the state for that value, so scrubbing back and forth stays correct.
  const ctr = (tl, from, to, dur, fn, pos) => { const o = { v: from }; fn(from); tl.to(o, { v: to, duration: dur, ease: 'none', onUpdate: () => fn(o.v) }, pos); };
  const setCalc = (calc, html) => { if (calc._h !== html) { calc.innerHTML = html; calc._h = html; } };

  // ====================== DATA ======================
  // Core set after B5 (12 + 1 meta). Ratings: importance I and discrimination D from 3 independent seats; L = level per seat.
  const CAND = [
    { id: 'C-003', n: 'Lập kế hoạch dự án', lop: 'I', I: [5, 5, 4], D: [4, 4, 5], L: [3, 3, 4], E: 212, jd: 118, seg: 164, def: 'Xây dựng kế hoạch có mốc, nguồn lực và phụ thuộc cho dự án', q: 'Xây dựng kế hoạch tổng thể và theo dõi tiến độ dự án', reuse: true },
    { id: 'C-007', n: 'Quản lý tiến độ', lop: 'I', I: [4, 5, 4], D: [4, 3, 4], L: [3, 3, 3], E: 171, jd: 104, seg: 131, def: 'Theo dõi tiến độ so với kế hoạch và điều chỉnh kịp thời', q: 'Theo dõi tiến độ, cập nhật báo cáo hằng tuần', reuse: true },
    { id: 'C-014', n: 'Quản lý rủi ro dự án', lop: 'III', I: [4, 4, 5], D: [4, 4, 4], L: [3, 3, 3], E: 123, jd: 76, seg: 98, def: 'Nhận diện, đánh giá và ứng phó rủi ro của dự án', q: 'Nhận diện, đánh giá rủi ro và đề xuất phương án ứng phó', reuse: true },
    { id: 'cand-31', n: 'Quản lý các bên liên quan', lop: 'II', I: [4, 4, 4], D: [4, 3, 4], L: [3, 3, 3], E: 100, jd: 64, seg: 87, def: 'Xác định, phối hợp và quản lý kỳ vọng của các bên liên quan', q: 'Phối hợp với khách hàng, nhà thầu và ban giám đốc', reuse: false },
    { id: 'C-018', n: 'Quản lý ngân sách', lop: 'III', I: [4, 4, 3], D: [3, 4, 3], L: [3, 2, 3], E: 66, jd: 49, seg: 58, def: 'Lập và kiểm soát ngân sách dự án', q: 'Lập dự toán và kiểm soát chi phí dự án', reuse: true },
    { id: 'cand-12', n: 'Quản lý phạm vi và thay đổi', lop: 'III', I: [4, 3, 4], D: [3, 3, 4], L: [3, 3, 3], E: 58, jd: 41, seg: 52, def: 'Kiểm soát phạm vi và xử lý yêu cầu thay đổi', q: 'Tiếp nhận và đánh giá yêu cầu thay đổi phạm vi', reuse: false },
    { id: 'C-001', n: 'Giao tiếp', lop: 'II', I: [4, 4, 4], D: [3, 3, 3], L: [3, 3, 3], E: 93, jd: 88, seg: 102, def: 'Truyền đạt thông tin rõ ràng, lắng nghe và phản hồi', q: 'Truyền đạt thông tin rõ ràng tới các bên', reuse: true },
    { id: 'C-009', n: 'Lãnh đạo nhóm', lop: 'II', I: [4, 4, 5], D: [4, 3, 3], L: [3, 3, 3], E: 53, jd: 47, seg: 61, def: 'Định hướng, phân việc và phát triển thành viên nhóm', q: 'Điều phối đội dự án 8–15 người', reuse: true },
    { id: 'cand-19', n: 'Ra quyết định', lop: 'I', I: [4, 3, 4], D: [3, 4, 3], L: [3, 3, 3], E: 57, jd: 36, seg: 40, def: 'Đưa ra quyết định kịp thời dựa trên dữ liệu và rủi ro', q: 'Chủ động ra quyết định trong phạm vi được giao', reuse: false },
    { id: 'cand-22', n: 'Đàm phán', lop: 'II', I: [3, 4, 4], D: [4, 3, 4], L: [3, 3, 2], E: 32, jd: 27, seg: 31, def: 'Đàm phán phạm vi, giá và điều khoản với các bên', q: 'Đàm phán với nhà thầu về phạm vi và chi phí', reuse: false },
    { id: 'cand-27', n: 'Quản lý chất lượng', lop: 'III', I: [4, 4, 3], D: [3, 3, 4], L: [3, 3, 3], E: 41, jd: 33, seg: 38, def: 'Đặt tiêu chí và kiểm soát chất lượng bàn giao', q: 'Kiểm soát chất lượng sản phẩm bàn giao', reuse: false },
    { id: 'cand-08', n: 'Báo cáo và theo dõi', lop: 'I', I: [4, 4, 4], D: [3, 3, 3], L: [3, 3, 3], E: 84, jd: 79, seg: 90, def: 'Lập báo cáo tình trạng và chỉ số dự án', q: 'Báo cáo tình trạng dự án cho ban giám đốc', reuse: false },
    { id: 'cand-40', n: 'Học hỏi và thích ứng', lop: 'Meta', I: [4, 3, 4], D: [3, 4, 3], L: [3, 3, 3], E: 22, jd: 19, seg: 21, def: 'Tự rút kinh nghiệm và thích ứng với bối cảnh mới', q: 'Sẵn sàng học công nghệ và phương pháp mới', reuse: false, meta: true },
    { id: 'cand-05', n: 'Tư duy phân tích', lop: 'I', I: [5, 4, 2], D: [4, 3, 3], L: [3, 3, 3], E: 61, jd: 44, seg: 47 },
    { id: 'cand-03', n: 'Làm việc nhóm', lop: 'II', I: [5, 3, 2], D: [3, 2, 3], L: [2, 2, 2], E: 72, jd: 58, seg: 60 },
    { id: 'cand-14', n: 'Chịu áp lực', lop: 'I', I: [4, 4, 3], D: [2, 2, 3], L: [2, 2, 2], E: 38, jd: 35, seg: 35 },
    { id: 'cand-17', n: 'Tin học văn phòng', lop: 'I', I: [3, 3, 4], D: [2, 2, 2], L: [2, 2, 2], E: 44, jd: 41, seg: 41 },
    { id: 'cand-25', n: 'Quản lý hợp đồng', lop: 'III', I: [3, 3, 3], D: [4, 3, 4], L: [3, 3, 3], E: 18, jd: 14, seg: 15 },
  ];
  const maxE = Math.max(...CAND.map((c) => c.E));
  CAND.forEach((c) => {
    c.mI = mean(c.I); c.mD = mean(c.D); c.s2 = variance(c.I); c.r = rwg(c.I); c.S = c.E / maxE; c.lv = median(c.L);
    c.keep = c.mI >= 3.5 && c.mD >= 3.0 && c.r >= 0.7;
    c.why = c.keep ? 'giữ' : c.r < 0.7 ? `r_wg ${vn(c.r)} < 0,70` : c.mI < 3.5 ? `quan trọng ${vn(c.mI)} < 3,5` : `phân biệt ${vn(c.mD)} < 3,0`;
  });
  const KEPT = CAND.filter((c) => c.keep);
  const CORE = KEPT.filter((c) => !c.meta), META = KEPT.filter((c) => c.meta);
  const TASKS = [
    { id: 'NV-01', n: 'Lập kế hoạch nguồn lực', nt: 118, links: ['C-003', 'C-018'] },
    { id: 'NV-02', n: 'Theo dõi tiến độ', nt: 106, links: ['C-007', 'cand-08'] },
    { id: 'NV-03', n: 'Báo cáo tình trạng', nt: 86, links: ['cand-08', 'C-001'] },
    { id: 'NV-04', n: 'Quản lý rủi ro', nt: 76, links: ['C-014'] },
    { id: 'NV-05', n: 'Phối hợp các bên', nt: 70, links: ['cand-31', 'C-001', 'cand-22'] },
    { id: 'NV-06', n: 'Điều phối nhóm', nt: 61, links: ['C-009'] },
    { id: 'NV-07', n: 'Lập ngân sách', nt: 52, links: ['C-018'] },
    { id: 'NV-08', n: 'Quản lý thay đổi', nt: 43, links: ['cand-12', 'cand-19'] },
    { id: 'NV-09', n: 'Kiểm soát chất lượng', nt: 38, links: ['cand-27'] },
    { id: 'NV-10', n: 'Đàm phán nhà thầu', nt: 16, links: ['cand-22'] },
    { id: 'NV-11', n: 'Soạn tài liệu kỹ thuật', nt: 60, links: [] },
    { id: 'NV-12', n: 'Hỗ trợ bán hàng', nt: 42, links: [] },
  ];
  const N_JD = 131;
  TASKS.forEach((t) => (t.w = t.nt / N_JD));
  const sumW = TASKS.reduce((a, t) => a + t.w, 0);
  const coverage = (set) => TASKS.reduce((a, t) => a + (t.links.some((l) => set.has(l)) ? t.w : 0), 0) / sumW;
  const keptIds = new Set(KEPT.map((c) => c.id));
  const COV = coverage(keptIds);
  const LOO = KEPT.map((c) => { const s = new Set(keptIds); s.delete(c.id); return { c, v: coverage(s) }; });

  // B6 indicators: lv = level written for; seats = level each blind seat put it at; rw = rewrite after failing.
  const IND = {
    'C-014': [
      { lv: 1, t: 'Nhận diện rủi ro rõ ràng khi được hỏi', s: [1, 1, 1] }, { lv: 1, t: 'Ghi rủi ro vào sổ theo mẫu có sẵn', s: [1, 1, 1] },
      { lv: 3, t: 'Đánh giá xác suất và tác động cho từng rủi ro', s: [3, 3, 3] }, { lv: 3, t: 'Đề xuất phương án ứng phó cho rủi ro chính', s: [3, 3, 5], rw: { t: 'Đề xuất và theo dõi phương án cho 5 rủi ro lớn nhất', s: [3, 3, 3] } },
      { lv: 3, t: 'Hiểu tầm quan trọng của rủi ro', s: [1, 3, 5], rw: { t: 'Cập nhật sổ rủi ro hằng tuần và báo cáo thay đổi', s: [3, 3, 3] } },
      { lv: 5, t: 'Thiết kế quy trình rủi ro cho danh mục dự án', s: [5, 5, 5] }, { lv: 5, t: 'Huấn luyện đội dự án nhận diện rủi ro', s: [5, 5, 5] },
    ],
    'C-003': [
      { lv: 1, t: 'Lập danh sách công việc theo mẫu', s: [1, 1, 1] }, { lv: 1, t: 'Ước lượng thời gian cho việc được giao', s: [1, 1, 1] },
      { lv: 3, t: 'Lập kế hoạch tổng thể có mốc và nguồn lực', s: [3, 3, 3] }, { lv: 3, t: 'Điều chỉnh kế hoạch khi phạm vi thay đổi', s: [3, 5, 3], rw: { t: 'Cập nhật kế hoạch và mốc khi thay đổi được duyệt', s: [3, 3, 3] } },
      { lv: 3, t: 'Có tư duy lập kế hoạch tốt', s: [1, 3, 3], rw: { t: 'Xác định đường găng và phụ thuộc giữa các việc', s: [3, 3, 3] } },
      { lv: 5, t: 'Chuẩn hóa phương pháp lập kế hoạch cho đơn vị', s: [5, 5, 5] }, { lv: 5, t: 'Lập kế hoạch cho chương trình nhiều dự án', s: [5, 5, 5] },
    ],
    'cand-31': [
      { lv: 1, t: 'Liệt kê các bên liên quan chính của dự án', s: [1, 1, 1] }, { lv: 1, t: 'Gửi cập nhật theo lịch đã định', s: [1, 1, 1] },
      { lv: 3, t: 'Lập bản đồ ảnh hưởng và mối quan tâm các bên', s: [3, 3, 3] }, { lv: 3, t: 'Xử lý mâu thuẫn yêu cầu giữa hai bên', s: [3, 3, 5], rw: { t: 'Tổ chức họp giải quyết yêu cầu mâu thuẫn', s: [3, 3, 3] } },
      { lv: 3, t: 'Làm hài lòng khách hàng', s: [3, 1, 5], rw: { t: 'Lập kế hoạch giao tiếp riêng cho từng nhóm', s: [3, 3, 3] } },
      { lv: 5, t: 'Xây dựng quan hệ chiến lược với lãnh đạo khách hàng', s: [5, 5, 5] }, { lv: 5, t: 'Thiết lập cơ chế điều phối nhiều bên', s: [5, 5, 5] },
    ],
    'C-009': [
      { lv: 1, t: 'Phân việc theo hướng dẫn của trưởng nhóm', s: [1, 1, 1] }, { lv: 1, t: 'Báo cáo vướng mắc của nhóm kịp thời', s: [1, 3, 1], rw: { t: 'Báo cáo vướng mắc cho trưởng nhóm trong ngày', s: [1, 1, 1] } },
      { lv: 3, t: 'Giao việc theo năng lực từng thành viên', s: [3, 3, 3] }, { lv: 3, t: 'Phản hồi định kỳ cho từng thành viên', s: [3, 3, 3] },
      { lv: 3, t: 'Truyền cảm hứng cho nhóm', s: [5, 1, 3], rw: { t: 'Tổ chức họp rút kinh nghiệm sau mỗi mốc', s: [3, 3, 3] } },
      { lv: 5, t: 'Phát triển trưởng nhóm kế cận', s: [5, 5, 5] }, { lv: 5, t: 'Xây dựng cách làm việc chung cho nhiều nhóm', s: [5, 5, 5] },
    ],
  };
  const pOf = (it) => it.s.filter((x) => x === it.lv).length / 3;
  const fleiss = (items) => {
    const cats = [1, 3, 5], n = 3, N = items.length;
    const nij = items.map((it) => cats.map((c) => it.s.filter((x) => x === c).length));
    const pj = cats.map((_, j) => nij.reduce((a, r) => a + r[j], 0) / (N * n));
    const Pi = nij.map((r) => (r.reduce((a, x) => a + x * x, 0) - n) / (n * (n - 1)));
    const P = mean(Pi), Pe = pj.reduce((a, x) => a + x * x, 0);
    return { P, Pe, k: (P - Pe) / (1 - Pe) };
  };

  // ====================== STORIES ======================
  const STORY = {};

  STORY.B0 = (root) => player(root, [
    ['Nạp đầu vào', 'Charter, bộ JD và bộ ngưỡng của mức C được đọc vào snapshot.'],
    ['Niêm phong (1)', 'Băm toàn bộ snapshot bằng SHA-256. Đổi một ký tự là ra mã khác.'],
    ['Kiểm cặp agent (2)', 'Ở mỗi bước, agent kiểm phải dùng model khác agent làm.'],
    ['Cổng G0', 'Ba điều kiện cùng đạt thì dây chuyền mới chạy.'],
  ], ({ svg, calc, tl, mark }) => {
    const fields = [['Vị trí', 'Project Manager'], ['Ngành', 'Công nghệ thông tin'], ['Cấp bậc', 'Trung cấp'], ['Mục đích', 'Tuyển dụng'], ['Mức chặt chẽ', 'C'], ['Bộ JD', '175 tệp · bản 1'], ['Từ điển nền', 'v0'], ['Bộ ngưỡng', 'mức C · bản 3']];
    const snap = JSON.stringify(fields);
    let hash = '…';
    sha256(snap).then((h) => (hash = h));
    const g = S('g', {}, svg);
    T(g, 30, 28, 'SNAPSHOT', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 });
    const rows = fields.map(([k, v], i) => { const r = S('g', { opacity: 0 }, g); S('rect', { x: 30, y: 40 + i * 30, width: 300, height: 24, rx: 5, fill: C.fill }, r); T(r, 40, 56 + i * 30, k, { fill: C.ink2 }); T(r, 140, 56 + i * 30, v, { 'font-weight': 600 }); return r; });
    const hb = S('g', { opacity: 0 }, g); S('rect', { x: 380, y: 40, width: 490, height: 70, rx: 8, fill: '#e6effb', stroke: C.c1 }, hb); T(hb, 395, 62, 'H = SHA-256(snapshot)', { 'font-style': 'italic', 'font-size': 13 }); const ht = T(hb, 395, 92, '', { 'font-family': 'ui-monospace, Menlo, monospace', 'font-size': 10.5 });
    const arrow = S('path', { d: 'M335 150 C 360 150, 350 75, 378 75', stroke: C.c1, fill: 'none', 'stroke-width': 2, 'stroke-dasharray': 200, 'stroke-dashoffset': 200 }, g);
    const pairs = [['B3 · mã hóa', 'Sonnet', 'Opus'], ['B5 · chấm ưu tiên', 'Sonnet', 'Haiku, Sonnet, Opus*'], ['B6 · dịch ngược', 'Sonnet', 'Haiku, Opus, Opus*'], ['B7 · thẩm định', 'Sonnet', 'Opus']];
    const pg = pairs.map(([b, a, c], i) => { const r = S('g', { opacity: 0 }, g); const y = 140 + i * 36; S('rect', { x: 380, y, width: 490, height: 30, rx: 5, fill: '#fff', stroke: C.line }, r); T(r, 392, y + 19, b, { 'font-weight': 600 }); T(r, 530, y + 19, 'làm: ' + a, { fill: C.ai }); T(r, 640, y + 19, 'kiểm: ' + c, { fill: C.warn }); const ok = T(r, 850, y + 20, '✓', { fill: C.ok, 'font-size': 15, 'font-weight': 700, opacity: 0, 'text-anchor': 'end' }); return { r, ok }; });
    T(g, 380, 300, '* ghế trùng tên model với agent làm thì dùng model khác; hệ thống từ chối cấu hình vi phạm', { 'font-size': 10, fill: C.ink3 });
    const gate = S('g', { opacity: 0 }, g); S('rect', { x: 30, y: 300, width: 300, height: 44, rx: 8, fill: '#e3f3ec', stroke: C.ok }, gate); T(gate, 45, 327, 'G0 đạt · đủ trường ∧ H khớp ∧ làm ≠ kiểm', { 'font-weight': 700, fill: C.ok });
    mark(0); tl.to(rows, { opacity: 1, x: 0, duration: 0.3, stagger: 0.12 });
    ctr(tl, 0, fields.length, 1, (v) => setCalc(calc, `<span class="k">Snapshot</span>${Math.round(v)} / ${fields.length} trường đã đọc`), '<');
    mark(1); tl.to(arrow, { attr: { 'stroke-dashoffset': 0 }, duration: 0.5 }).to(hb, { opacity: 1, duration: 0.3 });
    ctr(tl, 0, 64, 1.6, (v) => { ht.textContent = hash.slice(0, Math.round(v)); setCalc(calc, `<span class="k">Công thức (1)</span><span class="f">H = SHA-256(snapshot)</span> = <span class="mono">${hash.slice(0, Math.round(v))}</span>`); });
    mark(2); pg.forEach((p) => tl.to(p.r, { opacity: 1, duration: 0.25 }).to(p.ok, { opacity: 1, duration: 0.2 }));
    ctr(tl, 0, 4, 0.1, (v) => v > 0 && setCalc(calc, `<span class="k">Công thức (2)</span>Mỗi bước: model của agent làm ∉ model của agent kiểm · 4 / 4 bước đạt`));
    mark(3); tl.fromTo(gate, { opacity: 0, scale: 0.9, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2)' });
    ctr(tl, 0, 1, 0.1, (v) => v > 0 && setCalc(calc, `<span class="k">Cổng G0</span><span class="f">G0 = (đủ trường) ∧ (H khớp) ∧ (agent làm ≠ agent kiểm)</span> = đạt`));
  }, 360);

  STORY.B1 = (root) => player(root, [
    ['Nạp 175 JD', 'Mỗi chấm là một JD.'],
    ['Loại trùng (4)', 'Cặp JD có hệ số Jaccard ≥ 0,8 bị coi là một; bản sau bị loại.'],
    ['Sai vị trí (3)', 'AI đọc mỗi JD một lần; JD không đúng vị trí bị loại.'],
    ['Xếp hạng nguồn (5)–(7)', 'Code tính hai lăng kính từ 5 tiêu chí A–E, rồi xếp P1, P2, P3.'],
    ['Cổng G1 (8)', 'Đủ 15 JD hợp lệ và 5 JD hạng P1.'],
  ], ({ svg, calc, tl, mark }) => {
    const r = rng(7);
    const N = 175, dup = new Set(), bad = new Set();
    while (dup.size < 24) dup.add(Math.floor(r() * N));
    while (bad.size < 20) { const k = Math.floor(r() * N); if (!dup.has(k)) bad.add(k); }
    const valid = [...Array(N).keys()].filter((i) => !dup.has(i) && !bad.has(i));
    const partner = {}; [...dup].forEach((d) => (partner[d] = valid[Math.floor(r() * valid.length)]));
    const jOf = (d) => { const a = 40, k = 2 + (d % 5); const shared = a - k; return shared / (a + a - shared); };
    const target = valid.map((_, i) => (i < 41 ? 1 : i < 90 ? 2 : 3));
    const crit = target.map((t) => { for (let z = 0; z < 20000; z++) { const c = [0, 0, 0, 0, 0].map(() => Math.floor(r() * 4)); const [A, B, Cc, D, E] = c; const L = 3 * A + 2 * Cc + D + E, M = 3 * B + 2 * Cc + D + E; const sc = A >= 2 ? Math.max(L, M) : L; const rk = sc >= 18 ? 1 : sc >= 13 ? 2 : 3; if (rk === t) return { c, L, M, sc, rk }; } return null; });
    const pos = (i) => ({ x: 40 + (i % 25) * 15, y: 60 + Math.floor(i / 25) * 15 });
    T(svg, 40, 36, 'BỘ JD', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 });
    const cnt = T(svg, 420, 36, '', { 'font-size': 13, 'font-weight': 700, 'text-anchor': 'end' });
    const bins = [[40, 'Trùng'], [230, 'Sai vị trí']];
    bins.forEach(([x, l]) => { S('rect', { x, y: 200, width: 170, height: 70, rx: 6, fill: 'none', stroke: C.line, 'stroke-dasharray': '4 3' }, svg); T(svg, x + 6, 214, l, { 'font-size': 10, fill: C.ink3 }); });
    const cols = [[470, 'P1', C.c3], [610, 'P2', C.c1], [750, 'P3', C.c2]];
    const colLbl = cols.map(([x, l, c]) => { T(svg, x, 36, l, { 'font-size': 12, 'font-weight': 700, fill: c }); return T(svg, x + 120, 36, '0', { 'font-size': 12, 'text-anchor': 'end', fill: C.ink2 }); });
    const dots = [...Array(N).keys()].map((i) => { const p = pos(i); return S('circle', { cx: p.x, cy: p.y, r: 5, fill: C.c1, opacity: 0 }, svg); });
    const lines = S('g', {}, svg);
    const card = S('g', { opacity: 0 }, svg);
    const ex = crit[3], exI = valid[3];
    S('rect', { x: 40, y: 290, width: 830, height: 56, rx: 8, fill: '#fff', stroke: C.line }, card);
    T(card, 52, 310, `Ví dụ JD #${exI + 1}: A=${ex.c[0]} B=${ex.c[1]} C=${ex.c[2]} D=${ex.c[3]} E=${ex.c[4]}`, { 'font-weight': 600 });
    T(card, 52, 333, `L = 3·${ex.c[0]} + 2·${ex.c[2]} + ${ex.c[3]} + ${ex.c[4]} = ${ex.L} ; M = 3·${ex.c[1]} + 2·${ex.c[2]} + ${ex.c[3]} + ${ex.c[4]} = ${ex.M} ; ${ex.c[0] >= 2 ? 'A ≥ 2 nên lấy max(L, M)' : 'A < 2 nên chỉ dùng L'} = ${ex.sc} → P${ex.rk}`, { 'font-style': 'italic', 'font-size': 12.5, 'font-family': 'Times New Roman, serif' });
    let alive = N;
    const show = () => (cnt.textContent = `còn ${alive} JD`);
    mark(0); tl.to(dots, { opacity: 1, duration: 0.15, stagger: 0.006 });
    ctr(tl, 0, N, 1, (v) => { alive = Math.round(v); show(); setCalc(calc, `<span class="k">Nạp</span>${Math.round(v)} JD · chuẩn hóa, che số điện thoại và email, cắt đoạn`); }, '<');
    mark(1);
    const dl = [...dup];
    dl.forEach((d, k) => {
      const a = pos(d), b = pos(partner[d]);
      const ln = S('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: C.c2, 'stroke-width': 1.5, opacity: 0 }, lines);
      const at = 1.3 + k * 0.06;
      tl.to(ln, { opacity: 1, duration: 0.15 }, 'b1+=' + k * 0.06).to(ln, { opacity: 0, duration: 0.2 }, 'b1+=' + (k * 0.06 + 0.4));
      tl.to(dots[d], { attr: { cx: 50 + (k % 12) * 13, cy: 230 + Math.floor(k / 12) * 14 }, fill: C.c2, duration: 0.5 }, 'b1+=' + (k * 0.06 + 0.25));
    });
    ctr(tl, 0, 24, 24 * 0.06 + 0.6, (v) => { const k = Math.min(23, Math.floor(v)); alive = N - Math.round(v); show(); const d = dl[k]; setCalc(calc, `<span class="k">Công thức (4)</span><span class="f">J(A, B) = |A ∩ B| / |A ∪ B|</span> · JD #${d + 1} với JD #${partner[d] + 1}: <b>J = ${vn(jOf(d))}</b> ≥ 0,8 → trùng · đã loại ${Math.round(v)}`); }, 'b1');
    mark(2);
    [...bad].forEach((d, k) => tl.to(dots[d], { attr: { cx: 240 + (k % 12) * 13, cy: 230 + Math.floor(k / 12) * 14 }, fill: C.ink3, duration: 0.5 }, 'b2+=' + k * 0.05));
    ctr(tl, 0, 20, 1.5, (v) => { alive = 151 - Math.round(v); show(); setCalc(calc, `<span class="k">Công thức (3)</span><span class="f">hợp lệ ⇔ đúng vị trí ∧ không trùng ∧ đủ nội dung</span> · loại ${Math.round(v)} JD sai vị trí → còn ${151 - Math.round(v)}`); }, 'b2');
    mark(3);
    const placed = [0, 0, 0];
    valid.forEach((d, i) => { const c = crit[i].rk - 1; const k = placed[c]++; tl.to(dots[d], { attr: { cx: cols[c][0] + 6 + (k % 9) * 13, cy: 56 + Math.floor(k / 9) * 13 }, fill: cols[c][2], duration: 0.55 }, 'b3+=' + (i * 0.008)); });
    ctr(tl, 0, valid.length, 1.6, (v) => { const n = Math.round(v); const c = [0, 0, 0]; for (let i = 0; i < n; i++) c[crit[i].rk - 1]++; colLbl.forEach((t, j) => (t.textContent = c[j])); const e = crit[Math.max(0, n - 1)]; setCalc(calc, `<span class="k">Công thức (5)–(7)</span><span class="f">L = 3A + 2C + D + E ; M = 3B + 2C + D + E</span> · JD #${valid[Math.max(0, n - 1)] + 1}: L = ${e.L}, M = ${e.M} → P${e.rk} · P1 ≥ 18, P2 13–17, P3 ≤ 12`); }, 'b3');
    tl.to(card, { opacity: 1, duration: 0.3 });
    mark(4);
    const gate = S('g', { opacity: 0 }, svg); S('rect', { x: 470, y: 210, width: 400, height: 60, rx: 8, fill: '#e3f3ec', stroke: C.ok }, gate);
    const p1 = crit.filter((c) => c.rk === 1).length;
    T(gate, 485, 235, `G1: N = ${valid.length} ≥ 15 ∧ N_P1 = ${p1} ≥ 5`, { 'font-weight': 700, fill: C.ok, 'font-size': 13 }); T(gate, 485, 256, 'đạt → chuyển 131 JD hợp lệ sang B2', { fill: C.ink2 });
    tl.fromTo(gate, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 });
    ctr(tl, 0, 1, 0.1, (v) => v > 0 && setCalc(calc, `<span class="k">Cổng G1 (8)</span><span class="f">G1 ⇔ N ≥ 15 ∧ N<sub>P1</sub> ≥ 5</span> = ${valid.length} ≥ 15 ∧ ${p1} ≥ 5 → đạt`));
  }, 360);

  STORY.B2 = (root) => player(root, [
    ['Đọc nhiệm vụ trong JD', 'AI tách mỗi JD thành các câu nhiệm vụ, mỗi câu giữ mã đoạn gốc.'],
    ['Gộp nhiệm vụ trùng', 'Các câu cùng nghĩa từ nhiều JD dồn về một nhiệm vụ chuẩn.'],
    ['Trọng số (11)', 'Nhiệm vụ được nhiều JD nêu thì nặng hơn.'],
    ['Neo nghề (9)', 'Gắn mã nghề Việt Nam và quy điểm nguồn chuẩn ngoài về thang 1–5.'],
  ], ({ svg, calc, tl, mark }) => {
    const jds = [['JD #12 · Công ty A', ['Lập kế hoạch nguồn lực cho dự án', 'Theo dõi tiến độ hằng tuần', 'Nhận diện rủi ro']], ['JD #37 · Công ty B', ['Phân bổ nhân sự theo giai đoạn', 'Báo cáo tình trạng cho BGĐ', 'Phối hợp nhà thầu']], ['JD #58 · Công ty C', ['Cập nhật tiến độ trên Jira', 'Quản lý rủi ro dự án', 'Lập ngân sách']], ['JD #91 · Công ty D', ['Lên kế hoạch nhân lực', 'Làm việc với khách hàng', 'Kiểm soát chất lượng']]];
    const map = [[0, 1, 3], [0, 2, 4], [1, 3, 6], [0, 4, 8]];
    const top = TASKS.slice(0, 10);
    const jg = jds.map(([h, ls], i) => { const g = S('g', { opacity: 0 }, svg); const y = 20 + i * 86; S('rect', { x: 20, y, width: 280, height: 78, rx: 6, fill: '#fff', stroke: C.line }, g); T(g, 30, y + 16, h, { 'font-weight': 700, 'font-size': 10.5 }); const tx = ls.map((l, j) => T(g, 30, y + 34 + j * 16, '• ' + l, { 'font-size': 10.5, fill: C.ink2 })); return { g, y }; });
    const rows = top.map((t, i) => { const y = 24 + i * 34; const g = S('g', { opacity: 0.25 }, svg); T(g, 420, y + 12, t.n, { 'font-weight': 600 }); const n = T(g, 600, y + 12, 'n = 0', { fill: C.ink2, 'text-anchor': 'end' }); S('rect', { x: 610, y: y + 3, width: 260, height: 11, rx: 2, fill: C.fill }, g); const bar = S('rect', { x: 610, y: y + 3, width: 0, height: 11, rx: 2, fill: C.c1 }, g); const w = T(g, 870, y + 28, '', { 'font-size': 10, fill: C.ink2, 'text-anchor': 'end' }); return { g, n, bar, w, y }; });
    const flies = [];
    mark(0); tl.to(jg.map((x) => x.g), { opacity: 1, duration: 0.3, stagger: 0.15 });
    ctr(tl, 0, 131, 1.2, (v) => setCalc(calc, `<span class="k">Trích</span>${Math.round(v)} / 131 JD đã đọc · ${Math.round(v * 8.7)} câu nhiệm vụ thô`), '<');
    mark(1);
    map.forEach((m, i) => m.forEach((ti, j) => { const c = S('circle', { cx: 290, cy: jg[i].y + 31 + j * 16, r: 4, fill: C.ai, opacity: 0 }, svg); flies.push(c); const at = 'b1+=' + (i * 0.3 + j * 0.1); tl.to(c, { opacity: 1, duration: 0.1 }, at).to(c, { attr: { cx: 412, cy: rows[ti].y + 8 }, duration: 0.6, ease: 'power2.inOut' }, '>').to(c, { opacity: 0, duration: 0.15 }).to(rows[ti].g, { opacity: 1, duration: 0.2 }, '<'); }));
    ctr(tl, 0, 1, 1.8, (v) => setCalc(calc, `<span class="k">Gộp</span>"Lên kế hoạch nhân lực", "Phân bổ nhân sự theo giai đoạn", "Lập kế hoạch nguồn lực" → <b>Lập kế hoạch nguồn lực</b> · 1 140 câu thô → ${Math.round(1140 - v * 1070)} nhiệm vụ`), 'b1');
    mark(2);
    rows.forEach((r, i) => tl.to(r.g, { opacity: 1, duration: 0.1 }, 'b2'));
    ctr(tl, 0, 1, 1.6, (v) => { rows.forEach((r, i) => { const n = Math.round(top[i].nt * v); r.n.textContent = 'n = ' + n; r.bar.setAttribute('width', (n / N_JD) * 260); r.w.textContent = v > 0.98 ? `w = ${n} / 131 = ${vn(n / N_JD)}` : ''; }); setCalc(calc, `<span class="k">Công thức (11)</span><span class="f">w<sub>t</sub> = n<sub>t</sub> / N</span> · Lập kế hoạch nguồn lực: ${Math.round(118 * v)} / 131 = <b>${vn((118 * v) / N_JD)}</b>`); }, 'b2');
    mark(3);
    const ng = S('g', { opacity: 0 }, svg); S('rect', { x: 20, y: 300, width: 280, height: 40, rx: 6, fill: '#e6effb', stroke: C.c1 }, ng); T(ng, 30, 316, 'Mã nghề VN 2421 · Chuẩn ngoài: PM Specialist', { 'font-size': 10.5, 'font-weight': 600 }); const sc = T(ng, 30, 333, '', { 'font-size': 11.5, 'font-style': 'italic', 'font-family': 'Times New Roman, serif' });
    tl.to(ng, { opacity: 1, duration: 0.3 });
    ctr(tl, 0, 75, 1, (v) => { const s = 1 + (Math.round(v) / 100) * 4; sc.textContent = `s = 1 + ${Math.round(v)}/100 × 4 = ${vn(s, 1)}`; setCalc(calc, `<span class="k">Công thức (9)</span><span class="f">s = 1 + x / 100 × 4</span> · điểm quan trọng nguồn ngoài x = ${Math.round(v)} → s = <b>${vn(s, 1)}</b> trên thang 1–5 · cổng G2 đạt`); });
  }, 360);

  STORY.B3 = (root) => player(root, [
    ['Câu yêu cầu', 'Một số câu yêu cầu trong 1 812 câu, kèm mã đoạn gốc.'],
    ['Thành ứng viên', 'AI gán mỗi câu vào một ứng viên năng lực.'],
    ['So với từ điển (10)', 'Code tính độ giống trigram với từng năng lực đã có; ≥ 0,3 thì dùng lại.'],
    ['Kiểm chéo (15)', 'Opus mã hóa lại 20% câu mà không thấy kết quả lần một; từng câu rơi vào ô ma trận.'],
    ['Kết luận κ', 'κ ≥ 0,61 thì G3 đạt.'],
  ], ({ svg, calc, tl, mark }) => {
    const items = [['Xây dựng kế hoạch tổng thể, mốc và nguồn lực cho dự án', 'Lập kế hoạch dự án'], ['Nhận diện, đánh giá rủi ro và đề xuất phương án ứng phó', 'Quản lý rủi ro'], ['Phối hợp với khách hàng, nhà thầu và ban giám đốc', 'Quản lý các bên liên quan'], ['Theo dõi tiến độ, cập nhật báo cáo hằng tuần', 'Theo dõi tiến độ'], ['Truyền đạt thông tin rõ ràng tới các bên', 'Giao tiếp'], ['Kiểm soát chất lượng sản phẩm bàn giao', 'Quản lý chất lượng']];
    const dict = [['C-003', 'Lập kế hoạch dự án'], ['C-014', 'Quản lý rủi ro dự án'], ['C-007', 'Quản lý tiến độ'], ['C-001', 'Giao tiếp'], ['C-009', 'Lãnh đạo nhóm'], ['C-021', 'Phân tích yêu cầu']];
    const g1 = S('g', {}, svg);
    T(g1, 20, 20, 'CÂU YÊU CẦU', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 }); T(g1, 380, 20, 'ỨNG VIÊN', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 }); T(g1, 700, 20, 'TỪ ĐIỂN 1.2.0', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 });
    const sg = items.map(([s], i) => { const g = S('g', { opacity: 0 }, g1); const y = 34 + i * 50; S('rect', { x: 20, y, width: 320, height: 38, rx: 5, fill: C.fill }, g); T(g, 28, y + 16, cut(s, 52), { 'font-size': 10.5 }); T(g, 28, y + 31, `đoạn doc_${(i * 37 + 11).toString(16)}#${i + 2}`, { 'font-size': 9.5, fill: C.ink3, 'font-family': 'ui-monospace, Menlo, monospace' }); return g; });
    const dn = dict.map(([id, n], i) => { const g = S('g', {}, g1); const y = 34 + i * 50; S('rect', { x: 700, y, width: 180, height: 38, rx: 19, fill: '#fff', stroke: C.c3, 'stroke-width': 1.5 }, g); T(g, 712, y + 16, n, { 'font-weight': 600, 'font-size': 10.5 }); T(g, 712, y + 30, id, { 'font-size': 9.5, fill: C.ink3 }); return { g, y }; });
    const res = items.map(([, c]) => { let best = null; dict.forEach(([id, n], j) => { const s = jac(c, n); if (!best || s > best.s) best = { j, s, id, n }; }); return best; });
    const cg = items.map(([, c], i) => { const g = S('g', { opacity: 0 }, g1); const y = 34 + i * 50; const rc = S('rect', { x: 380, y: y + 4, width: 220, height: 30, rx: 15, fill: '#fff', stroke: C.c1, 'stroke-width': 1.5 }, g); T(g, 392, y + 23, c, { 'font-weight': 600, 'font-size': 10.5 }); const sc = T(g, 610, y + 23, '', { 'font-size': 10.5, fill: C.ink2 }); return { g, rc, sc, y }; });
    const links = S('g', {}, g1);
    mark(0); tl.to(sg, { opacity: 1, duration: 0.25, stagger: 0.12 });
    ctr(tl, 0, 1812, 0.9, (v) => setCalc(calc, `<span class="k">Đầu vào</span>${Math.round(v)} câu yêu cầu từ 131 JD hợp lệ`), '<');
    mark(1); cg.forEach((c, i) => tl.fromTo(c.g, { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.35 }, 'b1+=' + i * 0.12));
    ctr(tl, 0, 614, 1, (v) => setCalc(calc, `<span class="k">AI trích</span>${Math.round(v)} ứng viên thô · mỗi ứng viên phải trỏ về đoạn có thật, nếu không bị từ chối (7 lần)`), 'b1');
    mark(2);
    res.forEach((b, i) => {
      const reuse = b.s >= 0.3;
      const y0 = cg[i].y + 19, y1 = dn[b.j].y + 19;
      const ln = S('path', { d: `M600 ${y0} C 650 ${y0}, 650 ${y1}, 700 ${y1}`, fill: 'none', stroke: reuse ? C.c3 : C.ink3, 'stroke-width': reuse ? 2 : 1, 'stroke-dasharray': reuse ? '300' : '3 3', 'stroke-dashoffset': reuse ? 300 : 0, opacity: 0 }, links);
      const at = 'b2+=' + i * 0.35;
      tl.to(ln, { opacity: reuse ? 1 : 0.5, duration: 0.1 }, at);
      if (reuse) tl.to(ln, { attr: { 'stroke-dashoffset': 0 }, duration: 0.3 }, at);
      tl.call(() => {}, null, at);
      tl.to(cg[i].rc, { attr: { fill: reuse ? '#e3f3ec' : '#e6effb', stroke: reuse ? C.c3 : C.c1 }, duration: 0.2 }, at);
      ctr(tl, 0, b.s, 0.3, (v) => (cg[i].sc.textContent = v > 0 ? `${vn(v)} ${b.s >= 0.3 && v >= b.s - 0.001 ? '→ dùng lại ' + b.id : v >= b.s - 0.001 ? '→ tạo mới' : ''}` : ''), at);
    });
    ctr(tl, 0, items.length, items.length * 0.35, (v) => { const i = Math.min(items.length - 1, Math.floor(v)); const b = res[i]; setCalc(calc, `<span class="k">Công thức (10)</span><span class="f">điểm = max(J<sub>tên</sub>, 0,7 × J<sub>định nghĩa</sub>)</span> · "${items[i][1]}" với "${b.n}": J<sub>tên</sub> = <b>${vn(b.s)}</b> ${b.s >= 0.3 ? '≥ 0,3 → dùng lại ' + b.id : '< 0,3 → tạo năng lực mới'}`); }, 'b2');
    // cross-check
    mark(3);
    const g2 = S('g', { opacity: 0 }, svg);
    const cats = ['Lập KH', 'Rủi ro', 'Bên LQ', 'Giao tiếp'];
    const off = new Set([3, 9, 14, 22, 27, 35]);
    const A = [...Array(40).keys()].map((i) => [0, 0, 1, 2, 3, 0, 1, 2, 0, 1][i % 10]);
    const B = A.map((a, i) => (off.has(i) ? (a + 1) % 4 : a));
    T(g2, 20, 22, 'MẪU 20% · 40 CÂU · lần 1 = Sonnet, lần 2 = Opus (không thấy lần 1)', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 });
    const tok = A.map((a, i) => { const x = 30 + (i % 20) * 19, y = 44 + Math.floor(i / 20) * 26; const g = S('g', {}, g2); S('rect', { x: x - 8, y: y - 9, width: 16, height: 18, rx: 3, fill: '#fff', stroke: C.line }, g); T(g, x, y + 4, String(i + 1), { 'font-size': 8.5, 'text-anchor': 'middle', fill: C.ink2 }); return { g, x, y }; });
    const mx = 520, my = 60, cw = 80, chh = 52;
    cats.forEach((c, j) => { T(g2, mx + j * cw + cw / 2, my - 8, c, { 'font-size': 10, 'text-anchor': 'middle', fill: C.ink2, 'font-weight': 700 }); T(g2, mx - 8, my + j * chh + chh / 2 + 4, c, { 'font-size': 10, 'text-anchor': 'end', fill: C.ink2, 'font-weight': 700 }); });
    T(g2, mx + 160, my - 24, 'lần 2 · Opus →', { 'font-size': 10, 'text-anchor': 'middle', fill: C.ink3 }); T(g2, mx - 70, my + 220, '↑ lần 1 · Sonnet', { 'font-size': 10, fill: C.ink3 });
    const cell = [], cellT = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { cell[a * 4 + b] = S('rect', { x: mx + b * cw + 1, y: my + a * chh + 1, width: cw - 2, height: chh - 2, rx: 3, fill: a === b ? '#e6effb' : C.fill }, g2); cellT[a * 4 + b] = T(g2, mx + b * cw + cw / 2, my + a * chh + chh / 2 + 5, '', { 'font-size': 14, 'font-weight': 700, 'text-anchor': 'middle' }); }
    tl.to(g1, { opacity: 0, duration: 0.3 }, 'b3').to(g2, { opacity: 1, duration: 0.3 }, 'b3');
    A.forEach((a, i) => { const b = B[i]; const at = 'b3+=' + (0.4 + i * 0.07); tl.to(tok[i].g, { x: mx + b * cw + cw / 2 - tok[i].x + ((i % 3) - 1) * 10, y: my + a * chh + chh / 2 - tok[i].y - 12, scale: 0.6, transformOrigin: '50% 50%', duration: 0.45, ease: 'power2.inOut' }, at).to(tok[i].g, { opacity: 0, duration: 0.15 }, '>'); });
    const kap = (n) => { const m = Array(16).fill(0); for (let i = 0; i < n; i++) m[A[i] * 4 + B[i]]++; const N = Math.max(1, n); const po = [0, 1, 2, 3].reduce((s, k) => s + m[k * 4 + k], 0) / N; const rows = [0, 1, 2, 3].map((k) => m.slice(k * 4, k * 4 + 4).reduce((x, y) => x + y, 0)); const colsS = [0, 1, 2, 3].map((k) => m[k] + m[4 + k] + m[8 + k] + m[12 + k]); const pe = rows.reduce((s, r, k) => s + r * colsS[k], 0) / (N * N); return { m, po, pe, k: pe < 1 ? (po - pe) / (1 - pe) : NaN }; };
    ctr(tl, 0, 40, 40 * 0.07 + 0.6, (v) => { const n = Math.round(v); const r = kap(n); r.m.forEach((c, k) => { cellT[k].textContent = c || ''; cell[k].setAttribute('fill', c && k % 5 ? '#fbeee2' : k % 5 === 0 ? '#e6effb' : C.fill); }); setCalc(calc, `<span class="k">Công thức (15)</span><span class="f">κ = (p<sub>o</sub> − p<sub>e</sub>) / (1 − p<sub>e</sub>)</span> · sau ${n} câu: p<sub>o</sub> = ${vn(r.po)}, p<sub>e</sub> = ${vn(r.pe)} → <b>κ = ${Number.isFinite(r.k) ? vn(r.k) : '— (chưa đủ câu)'}</b>`); }, 'b3+=0.4');
    mark(4);
    const fin = kap(40);
    const kb = S('g', { opacity: 0 }, g2); S('rect', { x: 20, y: 110, width: 420, height: 90, rx: 8, fill: '#e3f3ec', stroke: C.ok }, kb); T(kb, 36, 140, `κ = (${vn(fin.po)} − ${vn(fin.pe)}) / (1 − ${vn(fin.pe)}) = ${vn(fin.k)}`, { 'font-size': 15, 'font-weight': 700, fill: C.ok }); T(kb, 36, 164, `${40 - off.size} / 40 câu hai lần trùng nhau · ${off.size} câu lệch (ô cam)`, { fill: C.ink2 }); T(kb, 36, 184, '≥ 0,61 → G3 đạt; câu lệch được ghi lại cho thẩm định B7', { fill: C.ink2 });
    tl.fromTo(kb, { opacity: 0, scale: 0.95, transformOrigin: '0% 50%' }, { opacity: 1, scale: 1, duration: 0.4 });
    ctr(tl, 0, 1, 0.1, (v) => v > 0 && setCalc(calc, `<span class="k">Cổng G3</span>mọi ứng viên trỏ về đoạn gốc (100%) ∧ <b>κ = ${vn(fin.k)} ≥ 0,61</b> → đạt`));
  }, 360);

  STORY.B4 = (root) => player(root, [
    ['Nguồn sự kiện', 'Ở mức C, đầu vào không có sự kiện do con người thu.'],
    ['Xếp loại bằng chứng', 'Mỗi sự kiện vào một làn: thật, mẫu, giả thuyết. Chỉ làn thật được tính.'],
    ['Đủ mẫu (17)–(18)', 'Mức B cần ≥ 3 người và ≥ 6 sự kiện thật cho mỗi năng lực.'],
    ['Chênh lệch nhóm (19)', 'Khi có dữ liệu thật: tần suất ở nhóm xuất sắc trừ nhóm trung bình.'],
  ], ({ svg, calc, tl, mark }) => {
    const lanes = [['Thật (do người thu)', 0, C.c3], ['Mẫu', 120, C.c1], ['Giả thuyết AI', 446, C.c2]];
    const lg = lanes.map(([l, n, c], i) => { const y = 40 + i * 70; T(svg, 30, y + 4, l, { 'font-weight': 700, fill: c }); const nt = T(svg, 880, y + 4, '0', { 'text-anchor': 'end', 'font-weight': 700 }); S('rect', { x: 30, y: y + 12, width: 850, height: 40, rx: 6, fill: C.fill }, svg); return { y, nt, c, n }; });
    const r = rng(3);
    const dots = [];
    lanes.forEach(([, n, c], i) => { for (let k = 0; k < Math.min(n, 150); k++) dots.push({ i, el: S('circle', { cx: 30, cy: lg[i].y + 32, r: 3, fill: c, opacity: 0 }, svg), x: 40 + r() * 830, y: lg[i].y + 18 + r() * 28 }); });
    mark(0); ctr(tl, 0, 1, 0.6, (v) => setCalc(calc, `<span class="k">Đầu vào</span>Mức chặt chẽ C · 0 sự kiện hành vi do con người thu · 566 giả thuyết do AI đề xuất (566 lời gọi)`));
    mark(1); dots.forEach((d, k) => tl.to(d.el, { attr: { cx: d.x, cy: d.y }, opacity: 0.8, duration: 0.4 }, 'b1+=' + k * 0.006));
    ctr(tl, 0, 1, 1.6, (v) => { lg.forEach((l) => (l.nt.textContent = Math.round(l.n * v))); setCalc(calc, `<span class="k">Xếp loại</span>thật ${Math.round(0)} · mẫu ${Math.round(120 * v)} · giả thuyết ${Math.round(446 * v)}`); }, 'b1');
    mark(2);
    const gb = S('g', { opacity: 0 }, svg); S('rect', { x: 30, y: 260, width: 410, height: 60, rx: 8, fill: C.fill, stroke: C.line2 }, gb); T(gb, 44, 285, 'Mức C · số sự kiện thật = 0', { 'font-weight': 700 }); T(gb, 44, 305, 'G4 không áp dụng; khung ra ở tầng Nội bộ', { fill: C.ink2 });
    tl.to(gb, { opacity: 1, duration: 0.3 });
    ctr(tl, 0, 1, 0.1, (v) => v > 0 && setCalc(calc, `<span class="k">Công thức (17)–(18)</span><span class="f">Mức B: số người ≥ 3 ∧ số sự kiện ≥ 6</span> · mức C không đòi → G4 không áp dụng`));
    mark(3);
    const th = [['Chủ động báo rủi ro sớm', 0.58, 0.16], ['Đàm phán lại phạm vi', 0.47, 0.16], ['Lập kế hoạch chi tiết', 0.62, 0.54]];
    const db = th.map(([n, a, b], i) => { const y = 262 + i * 22; const g = S('g', { opacity: 0 }, svg); T(g, 470, y + 10, n, { 'font-size': 10.5 }); S('rect', { x: 640, y, width: 200, height: 12, rx: 2, fill: C.fill }, g); const bar = S('rect', { x: 640, y, width: 0, height: 12, rx: 2, fill: C.c1 }, g); const t = T(g, 880, y + 10, '', { 'font-size': 10.5, 'text-anchor': 'end' }); return { g, bar, t, a, b }; });
    T(svg, 470, 252, 'Ví dụ khi có dữ liệu thật ở lượt sau', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 });
    tl.to(db.map((d) => d.g), { opacity: 1, duration: 0.2 });
    ctr(tl, 0, 1, 1.2, (v) => { db.forEach((d) => { const D = (d.a - d.b) * v; d.bar.setAttribute('width', D * 400); d.t.textContent = '+' + vn(D); }); setCalc(calc, `<span class="k">Công thức (19)</span><span class="f">Δ = f<sub>xuất sắc</sub> − f<sub>trung bình</sub></span> · "Chủ động báo rủi ro sớm": ${vn(0.58)} − ${vn(0.16)} = <b>${vn((0.58 - 0.16) * v)}</b> (chủ đề tạo khác biệt)`); });
  }, 340);

  STORY.B5 = (root) => player(root, [
    ['Ba ghế chấm độc lập', 'Haiku, Sonnet, Opus chấm mức quan trọng và mức phân biệt cho từng ứng viên, không thấy điểm của nhau.'],
    ['Tính đồng thuận (20)', 'Với mỗi ứng viên: trung bình, phương sai, r_wg.'],
    ['Quy tắc giữ (21)–(23)', 'Ứng viên bay vào biểu đồ; chỉ ô xanh được giữ, tối đa 14 lõi và 1 meta.'],
    ['Độ phủ (24)', 'Mỗi năng lực được giữ phủ các nhiệm vụ nó gánh.'],
    ['Thử bỏ một (25)', 'Bỏ từng năng lực xem độ phủ rớt bao nhiêu.'],
    ['Bậc yêu cầu (26)', 'Trung vị bậc của ba ghế.'],
  ], ({ svg, calc, tl, mark }) => {
    const rows = CAND.map((c, i) => {
      const y = 30 + i * 18; const g = S('g', { opacity: 0 }, svg);
      T(g, 20, y + 10, cut(c.n, 24), { 'font-size': 10.5, 'font-weight': c.meta ? 400 : 600, 'font-style': c.meta ? 'italic' : 'normal' });
      const seats = c.I.map((v, k) => T(g, 175 + k * 18, y + 10, String(v), { 'font-size': 10.5, fill: SEAT[k].c, 'font-weight': 700, opacity: 0, 'text-anchor': 'middle' }));
      const mI = T(g, 250, y + 10, '', { 'font-size': 10.5, 'text-anchor': 'end' }); const r = T(g, 296, y + 10, '', { 'font-size': 10.5, 'text-anchor': 'end' }); const mD = T(g, 335, y + 10, '', { 'font-size': 10.5, 'text-anchor': 'end' });
      const why = T(g, 345, y + 10, '', { 'font-size': 9.5, fill: C.ink3 });
      return { g, seats, mI, r, mD, why, y };
    });
    [['ứng viên', 20], ['H', 175], ['S', 193], ['O', 211], ['x̄ QT', 250], ['r_wg', 296], ['x̄ PB', 335]].forEach(([l, x], k) => T(svg, x, 20, l, { 'font-size': 9.5, fill: k >= 1 && k <= 3 ? SEAT[k - 1].c : C.ink3, 'font-weight': 700, 'text-anchor': k ? 'middle' : 'start' }));
    // scatter
    const X = (v) => 520 + ((v - 1) / 4) * 350, Y = (v) => 250 - ((v - 1) / 4) * 220;
    S('rect', { x: X(3.5), y: Y(5), width: X(5) - X(3.5), height: Y(3) - Y(5), fill: '#e3f3ec' }, svg);
    S('line', { x1: X(1), y1: Y(1), x2: X(5), y2: Y(1), stroke: C.line2 }, svg); S('line', { x1: X(1), y1: Y(1), x2: X(1), y2: Y(5), stroke: C.line2 }, svg);
    S('line', { x1: X(3.5), y1: Y(1), x2: X(3.5), y2: Y(5), stroke: C.bad, 'stroke-dasharray': '4 3' }, svg); S('line', { x1: X(1), y1: Y(3), x2: X(5), y2: Y(3), stroke: C.bad, 'stroke-dasharray': '4 3' }, svg);
    T(svg, X(3.5), Y(1) + 13, '3,5', { 'font-size': 9.5, fill: C.bad, 'text-anchor': 'middle' }); T(svg, X(1) - 4, Y(3) + 3, '3,0', { 'font-size': 9.5, fill: C.bad, 'text-anchor': 'end' });
    T(svg, 695, Y(1) + 26, 'mức quan trọng (trung bình 3 ghế)', { 'font-size': 9.5, fill: C.ink2, 'text-anchor': 'middle' });
    const keptT = T(svg, 870, 24, '', { 'font-size': 12, 'font-weight': 700, fill: C.ok, 'text-anchor': 'end' });
    const pts = CAND.map((c, i) => S('circle', { cx: 340, cy: rows[i].y + 6, r: 5.5, fill: C.c1, stroke: '#fff', 'stroke-width': 1.5, opacity: 0 }, svg));
    // coverage strip
    const sx = 520, sw = 350, sy = 300;
    T(svg, sx, sy - 8, 'NHIỆM VỤ · độ rộng theo trọng số', { 'font-size': 9.5, fill: C.ink3, 'font-weight': 700 });
    let acc = 0; const segs = TASKS.map((t) => { const w = (t.w / sumW) * sw; const r = S('rect', { x: sx + acc, y: sy, width: Math.max(1, w - 2), height: 22, rx: 2, fill: C.fill }, svg); acc += w; return r; });
    const covT = T(svg, 870, sy + 44, '', { 'font-size': 13, 'font-weight': 700, 'text-anchor': 'end' });
    mark(0);
    tl.to(rows.map((r) => r.g), { opacity: 1, duration: 0.2, stagger: 0.03 });
    rows.forEach((r, i) => r.seats.forEach((s, k) => tl.to(s, { opacity: 1, duration: 0.12 }, 'b0+=' + (0.3 + i * 0.06 + k * 0.04))));
    ctr(tl, 0, CAND.length, 0.3 + CAND.length * 0.06, (v) => { const c = CAND[Math.min(CAND.length - 1, Math.floor(v))]; setCalc(calc, `<span class="k">Ba ghế</span>"${c.n}": quan trọng <b style="color:${SEAT[0].c}">${c.I[0]}</b> · <b style="color:${SEAT[1].c}">${c.I[1]}</b> · <b style="color:${SEAT[2].c}">${c.I[2]}</b> ; phân biệt ${c.D.join(' · ')} · 45 ứng viên, hiện 18`); }, 'b0');
    mark(1);
    ctr(tl, 0, CAND.length, 2.2, (v) => { const n = Math.round(v); rows.forEach((r, i) => { const c = CAND[i]; const on = i < n; r.mI.textContent = on ? vn(c.mI) : ''; r.r.textContent = on ? vn(c.r) : ''; r.mD.textContent = on ? vn(c.mD) : ''; r.r.setAttribute('fill', on && c.r < 0.7 ? C.bad : C.ink); }); const c = CAND[Math.max(0, Math.min(CAND.length - 1, n - 1))]; setCalc(calc, `<span class="k">Công thức (20)</span><span class="f">r<sub>wg</sub> = max(0, 1 − s² / 2)</span> · "${c.n}": điểm ${c.I.join(', ')} → x̄ = ${vn(c.mI)}, s² = ${vn(c.s2)} → <b>r<sub>wg</sub> = ${vn(c.r)}</b>${c.r < 0.7 ? ' < 0,70: ba ghế không đồng thuận' : ''}`); }, 'b1');
    mark(2);
    CAND.forEach((c, i) => { const at = 'b2+=' + i * 0.12; tl.to(pts[i], { opacity: 1, duration: 0.05 }, at).to(pts[i], { attr: { cx: X(c.mI) + ((i % 3) - 1) * 4, cy: Y(c.mD) + ((i % 2) * 2 - 1) * 3, fill: c.keep ? C.c3 : C.ink3 }, duration: 0.5, ease: 'power2.inOut' }, at); tl.to(rows[i].g, { opacity: c.keep ? 1 : 0.45, duration: 0.2 }, at); });
    ctr(tl, 0, CAND.length, CAND.length * 0.12 + 0.4, (v) => { const n = Math.round(v); rows.forEach((r, i) => (r.why.textContent = i < n ? (CAND[i].keep ? (CAND[i].meta ? 'giữ · meta' : 'giữ') : CAND[i].why) : '')); const k = CAND.slice(0, n).filter((c) => c.keep); keptT.textContent = `giữ ${k.filter((c) => !c.meta).length} lõi + ${k.filter((c) => c.meta).length} meta`; const c = CAND[Math.max(0, Math.min(CAND.length - 1, n - 1))]; setCalc(calc, `<span class="k">Công thức (21)–(23)</span><span class="f">giữ ⇔ x̄<sub>QT</sub> ≥ 3,5 ∧ x̄<sub>PB</sub> ≥ 3,0 ∧ r<sub>wg</sub> ≥ 0,70 ; 8 ≤ n<sub>lõi</sub> ≤ 14 ∧ n<sub>meta</sub> ≤ 1</span> · "${c.n}" → <b>${c.keep ? 'giữ' : 'loại: ' + c.why}</b> · tổng ${CORE.length} lõi + ${META.length} meta`); }, 'b2');
    mark(3);
    const order = KEPT.map((c) => c.id); const covAt = (n) => coverage(new Set(order.slice(0, n)));
    ctr(tl, 0, order.length, 2.2, (v) => { const n = Math.round(v); const set = new Set(order.slice(0, n)); TASKS.forEach((t, j) => segs[j].setAttribute('fill', t.links.some((l) => set.has(l)) ? C.c1 : C.fill)); const cv = covAt(n); covT.textContent = `bao phủ = ${vn(cv)}`; covT.setAttribute('fill', cv >= 0.8 ? C.ok : C.ink); const last = KEPT[Math.max(0, n - 1)]; setCalc(calc, `<span class="k">Công thức (24)</span><span class="f">bao phủ = Σ w<sub>t</sub> · 1[t có ≥ 1 năng lực] / Σ w<sub>t</sub></span> · thêm "${last.n}" → <b>${vn(cv)}</b>${n === order.length ? ' ≥ 0,80 → đạt · 2 nhiệm vụ không năng lực nào gánh: Soạn tài liệu kỹ thuật, Hỗ trợ bán hàng' : ''}`); }, 'b3');
    mark(4);
    const loo = [...LOO].sort((a, b) => a.v - b.v);
    ctr(tl, 0, loo.length, 2.4, (v) => { const n = Math.min(loo.length - 1, Math.floor(v)); const it = loo[n]; const set = new Set(keptIds); set.delete(it.c.id); TASKS.forEach((t, j) => segs[j].setAttribute('fill', t.links.some((l) => set.has(l)) ? C.c1 : t.links.length && t.links.includes(it.c.id) ? '#f3b9a6' : C.fill)); covT.textContent = `bỏ ${cut(it.c.n, 16)}: ${vn(it.v)}`; covT.setAttribute('fill', it.v < 0.8 ? C.bad : C.ink); setCalc(calc, `<span class="k">Công thức (25)</span>bỏ "${it.c.n}" → bao phủ <b>${vn(it.v)}</b> ${it.v < 0.8 ? '< 0,80: không thể thiếu' : '(không đổi nhiều: nhiệm vụ còn năng lực khác gánh)'} · ${loo.filter((x) => x.v < 0.8).length} năng lực không thể thiếu`); }, 'b4');
    mark(5);
    ctr(tl, 0, 1, 0.8, (v) => { TASKS.forEach((t, j) => segs[j].setAttribute('fill', t.links.some((l) => keptIds.has(l)) ? C.c1 : C.fill)); covT.textContent = `bao phủ = ${vn(COV)}`; covT.setAttribute('fill', C.ok); const c = KEPT[0]; setCalc(calc, `<span class="k">Công thức (26)</span><span class="f">bậc = trung vị(bậc của 3 ghế)</span> · "${c.n}": ${c.L.join(', ')} → <b>bậc ${c.lv}</b> · cổng G5: bao phủ ${vn(COV)} ≥ 0,80 ∧ ${CORE.length} lõi ∈ [8, 14] → đạt`); });
  }, 360);

  STORY.B6 = (root, cid = 'C-014') => {
    const comp = CAND.find((c) => c.id === cid);
    const items = IND[cid].map((it, i) => ({ ...it, i }));
    const after = items.map((it) => (it.rw ? { ...it, t: it.rw.t, s: it.rw.s } : it));
    const fb = fleiss(items), fa = fleiss(after);
    const wrap = document.createElement('div');
    root.innerHTML = '';
    root.appendChild(wrap);
    wrap.insertAdjacentHTML('beforeend', `<div class="compsel">${Object.keys(IND).map((k) => `<span data-c="${k}" class="${k === cid ? 'on' : ''}">${CAND.find((c) => c.id === k).n}</span>`).join('')}</div>`);
    wrap.querySelector('.compsel').addEventListener('click', (e) => { const s = e.target.closest('[data-c]'); if (s) STORY.B6(root, s.dataset.c); });
    const host = document.createElement('div'); wrap.appendChild(host);
    return player(host, [
      ['Soạn chỉ báo (29)', `${items.length} chỉ báo cho "${comp.n}": 2–4 chỉ báo mỗi bậc 1, 3, 5.`],
      ['Xáo và che đáp án', 'Chỉ báo bị xáo thứ tự, che bậc; ba ghế không biết chỉ báo viết cho bậc nào.'],
      ['Ba ghế xếp ngược (27)', 'Mỗi ghế đặt từng chỉ báo vào một bậc. Chấm xanh = đúng bậc, đỏ = sai.'],
      ['Tỷ lệ xếp đúng', 'p_i = số ghế đúng / 3. Dưới 0,70 bị đánh dấu viết lại.'],
      ['Viết lại và thử lại', 'Chỉ báo đỏ được viết lại cụ thể hơn và xếp ngược lần nữa.'],
      ['Fleiss κ (28)', 'Đồng thuận của ba ghế trên toàn bộ chỉ báo.'],
    ], ({ svg, calc, tl, mark }) => {
      const colX = { 1: 20, 3: 315, 5: 610 };
      [1, 3, 5].forEach((l) => { T(svg, colX[l], 22, 'BẬC ' + l, { 'font-size': 11, 'font-weight': 700, fill: C.ink2 }); });
      const per = { 1: 0, 3: 0, 5: 0 };
      const home = items.map((it) => ({ x: colX[it.lv], y: 34 + per[it.lv]++ * 44 }));
      const order = items.map((_, i) => i).sort((a, b) => ((a * 7 + 3) % items.length) - ((b * 7 + 3) % items.length));
      const pool = items.map((_, i) => { const k = order.indexOf(i); return { x: 20 + (k % 3) * 295, y: 214 + Math.floor(k / 3) * 44 }; });
      T(svg, 20, 206, 'KHAY XẾP NGƯỢC · đã che bậc, đã xáo', { 'font-size': 9.5, fill: C.ink3, 'font-weight': 700 });
      SEAT.forEach((s, k) => { S('circle', { cx: 700 + k * 66, cy: 202, r: 5, fill: s.c }, svg); T(svg, 709 + k * 66, 206, s.n, { 'font-size': 10, fill: s.c, 'font-weight': 700 }); });
      const cards = items.map((it, i) => {
        const g = S('g', { transform: `translate(${home[i].x},${home[i].y})`, opacity: 0 }, svg);
        const bg = S('rect', { x: 0, y: 0, width: 280, height: 38, rx: 5, fill: C.fill, stroke: 'none', 'stroke-width': 1.5 }, g);
        const tx = T(g, 8, 15, cut(it.t, 46), { 'font-size': 10.5 });
        const tag = T(g, 272, 15, 'bậc ' + it.lv, { 'font-size': 9.5, fill: C.ink3, 'text-anchor': 'end' });
        const mk = it.s.map((lv, k) => { const ok = lv === it.lv; return { c: S('circle', { cx: 14 + k * 18, cy: 28, r: 5, fill: ok ? C.ok : C.bad, opacity: 0 }, g), t: T(g, 14 + k * 18, 31, ok ? '' : String(lv), { 'font-size': 7.5, fill: '#fff', 'text-anchor': 'middle', opacity: 0 }) }; });
        const pt = T(g, 272, 32, '', { 'font-size': 10, 'font-weight': 700, 'text-anchor': 'end' });
        return { g, bg, tx, tag, mk, pt };
      });
      const kb = S('g', { opacity: 0 }, svg);
      mark(0); cards.forEach((c, i) => tl.fromTo(c.g, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 'b0+=' + i * 0.1));
      ctr(tl, 0, 1, 0.8, (v) => { const cnt = [1, 3, 5].map((l) => items.filter((x) => x.lv === l).length); setCalc(calc, `<span class="k">Công thức (29)</span><span class="f">2 ≤ số chỉ báo mỗi bậc ≤ 4</span> · bậc 1: ${cnt[0]}, bậc 3: ${cnt[1]}, bậc 5: ${cnt[2]} → đạt · (30) mỗi chỉ báo nêu hành vi quan sát được, không nêu kết quả`); }, 'b0');
      mark(1); cards.forEach((c, i) => tl.to(c.g, { attr: { transform: `translate(${pool[i].x},${pool[i].y})` }, duration: 0.6, ease: 'power2.inOut' }, 'b1+=' + i * 0.04).to(c.tag, { opacity: 0, duration: 0.2 }, 'b1'));
      ctr(tl, 0, 1, 0.8, (v) => setCalc(calc, `<span class="k">Mù</span>Thứ tự bị xáo, bậc bị che · ba ghế dùng ba model khác nhau, không thấy câu trả lời của nhau`), 'b1');
      mark(2); cards.forEach((c, i) => c.mk.forEach((m, k) => { const at = 'b2+=' + (i * 0.22 + k * 0.06); tl.fromTo(m.c, { opacity: 0, attr: { cx: 690 + k * 66 - pool[i].x, cy: 202 - pool[i].y } }, { opacity: 1, attr: { cx: 14 + k * 18, cy: 28 }, duration: 0.4, ease: 'power2.out' }, at).to(m.t, { opacity: 1, duration: 0.1 }, '>'); }));
      ctr(tl, 0, items.length, items.length * 0.22 + 0.4, (v) => { const i = Math.min(items.length - 1, Math.floor(v)); const it = items[i]; setCalc(calc, `<span class="k">Xếp ngược</span>"${cut(it.t, 60)}" · viết cho bậc ${it.lv} · ba ghế đặt vào bậc <b style="color:${SEAT[0].c}">${it.s[0]}</b>, <b style="color:${SEAT[1].c}">${it.s[1]}</b>, <b style="color:${SEAT[2].c}">${it.s[2]}</b>`); }, 'b2');
      mark(3); cards.forEach((c, i) => { const p = pOf(items[i]); tl.to(c.g, { attr: { transform: `translate(${home[i].x},${home[i].y})` }, duration: 0.6, ease: 'power2.inOut' }, 'b3+=' + i * 0.04).to(c.tag, { opacity: 1, duration: 0.2 }, 'b3+=0.4').to(c.bg, { attr: { fill: p >= 0.7 ? '#e3f3ec' : '#fbe7e5', stroke: p >= 0.7 ? 'none' : C.bad }, duration: 0.3 }, 'b3+=0.6'); });
      ctr(tl, 0, items.length, 1.2, (v) => { const n = Math.round(v); cards.forEach((c, i) => { const p = pOf(items[i]); c.pt.textContent = i < n ? `p = ${vn(p)}` : ''; c.pt.setAttribute('fill', p >= 0.7 ? C.ok : C.bad); }); const bad = items.filter((it) => pOf(it) < 0.7); setCalc(calc, `<span class="k">Công thức (27)</span><span class="f">p<sub>i</sub> = số ghế xếp đúng / 3 ≥ 0,70</span> · ${items.length - bad.length} / ${items.length} chỉ báo đạt · cần viết lại: ${bad.map((b) => '"' + cut(b.t, 34) + '" (' + vn(pOf(b)) + ')').join(', ')}`); }, 'b3+=0.5');
      mark(4); cards.forEach((c, i) => { const it = items[i]; if (!it.rw) return; const t0 = 0.2 + i * 0.05, at = 'b4+=' + t0; tl.to(c.g, { opacity: 0.2, duration: 0.25 }, at); ctr(tl, 0, 1, 0.01, (v) => { c.tx.textContent = cut(v > 0 ? it.rw.t : it.t, 46); c.mk.forEach((m, k) => { const lv = v > 0 ? it.rw.s[k] : it.s[k]; const ok = lv === it.lv; m.c.setAttribute('fill', ok ? C.ok : C.bad); m.t.textContent = ok ? '' : String(lv); }); const p = v > 0 ? it.rw.s.filter((x) => x === it.lv).length / 3 : pOf(it); c.pt.textContent = `p = ${vn(p)}`; c.pt.setAttribute('fill', p >= 0.7 ? C.ok : C.bad); c.bg.setAttribute('fill', p >= 0.7 ? '#e3f3ec' : '#fbe7e5'); c.bg.setAttribute('stroke', p >= 0.7 ? C.ok : C.bad); }, 'b4+=' + (t0 + 0.25)); tl.to(c.g, { opacity: 1, duration: 0.35 }, 'b4+=' + (t0 + 0.27)); });
      ctr(tl, 0, 1, 1, (v) => v > 0 && setCalc(calc, `<span class="k">Viết lại</span>${items.filter((x) => x.rw).map((x) => `"${cut(x.t, 30)}" → "${cut(x.rw.t, 44)}"`).join(' · ')} · xếp ngược lần 2: mọi chỉ báo p<sub>i</sub> = 1,00`), 'b4');
      mark(5);
      S('rect', { x: 20, y: 330, width: 860, height: 40, rx: 8, fill: '#e3f3ec', stroke: C.ok }, kb); T(kb, 34, 355, `Fleiss κ: trước viết lại ${vn(fb.k)} → sau ${vn(fa.k)} ≥ 0,61 · G6 đạt cho "${comp.n}"`, { 'font-weight': 700, fill: C.ok, 'font-size': 13 });
      tl.to(kb, { opacity: 1, duration: 0.3 });
      ctr(tl, 0, 1, 0.1, (v) => v > 0 && setCalc(calc, `<span class="k">Công thức (28)</span><span class="f">κ = (P̄ − P̄<sub>e</sub>) / (1 − P̄<sub>e</sub>)</span> · sau viết lại: P̄ = ${vn(fa.P)}, P̄<sub>e</sub> = ${vn(fa.Pe)} → <b>κ = ${vn(fa.k)}</b> (trước: ${vn(fb.k)})`));
    }, 380);
  };

  STORY.B7 = (root) => player(root, [
    ['Thẩm định độc lập (31)', 'Opus đọc toàn bộ hồ sơ; nó không làm bước nào trước đó.'],
    ['Chọn mẫu kiểm (32)', 'Chọn ngẫu nhiên 10% JD hợp lệ để đọc lại toàn văn.'],
    ['Soát từng cổng', 'Kết quả từng cổng được đọc lại so với dữ liệu gốc.'],
    ['Cổng G7 (33)', 'Mọi cổng bắt buộc đạt và không có phát hiện mức cao.'],
  ], ({ svg, calc, tl, mark }) => {
    const r = rng(11); const n = Math.ceil(0.1 * N_JD); const pick = new Set(); while (pick.size < n) pick.add(Math.floor(r() * N_JD));
    const dots = [...Array(N_JD).keys()].map((i) => S('circle', { cx: 30 + (i % 22) * 17, cy: 60 + Math.floor(i / 22) * 17, r: 5, fill: C.c1, opacity: 0.25 }, svg));
    T(svg, 30, 36, '131 JD HỢP LỆ', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 });
    const gates = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G8'].map((g, i) => { const x = 450 + (i % 4) * 108, y = 50 + Math.floor(i / 4) * 70; const grp = S('g', {}, svg); const rc = S('rect', { x, y, width: 98, height: 58, rx: 8, fill: C.fill }, grp); T(grp, x + 49, y + 26, g, { 'font-size': 15, 'font-weight': 700, 'text-anchor': 'middle' }); const st = T(grp, x + 49, y + 45, '', { 'font-size': 10, 'text-anchor': 'middle', fill: C.ink2 }); return { rc, st, na: g === 'G4' }; });
    const g7 = S('g', { opacity: 0 }, svg); S('rect', { x: 450, y: 200, width: 422, height: 60, rx: 8, fill: '#e3f3ec', stroke: C.ok }, g7); T(g7, 466, 226, 'G7 đạt', { 'font-size': 16, 'font-weight': 700, fill: C.ok }); T(g7, 466, 246, '7 cổng đạt · 1 không áp dụng · 2 phát hiện mức thấp', { fill: C.ink2 });
    mark(0); ctr(tl, 0, 1, 0.6, (v) => setCalc(calc, `<span class="k">Công thức (31)</span><span class="f">agent thẩm định ∉ {agent đã làm B1–B6}</span> · thẩm định: Opus; các bước trước: Haiku, Sonnet → đạt`));
    mark(1); [...pick].forEach((i, k) => tl.to(dots[i], { opacity: 1, attr: { r: 7 }, fill: C.c2, duration: 0.25 }, 'b1+=' + k * 0.08));
    ctr(tl, 0, n, n * 0.08 + 0.3, (v) => setCalc(calc, `<span class="k">Công thức (32)</span><span class="f">n = ⌈0,10 · N⌉</span> = ⌈0,10 · 131⌉ = <b>${n}</b> · đã chọn ${Math.round(v)}`), 'b1');
    mark(2); gates.forEach((g, i) => tl.to(g.rc, { attr: { fill: g.na ? '#e4e3dd' : '#e3f3ec' }, duration: 0.25 }, 'b2+=' + i * 0.2));
    ctr(tl, 0, gates.length, gates.length * 0.2 + 0.2, (v) => { gates.forEach((g, i) => (g.st.textContent = i < Math.round(v) ? (g.na ? 'không áp dụng' : 'đạt') : '')); setCalc(calc, `<span class="k">Soát</span>${Math.round(v)} / ${gates.length} cổng · phát hiện: chỉ báo bậc 2 "Giao tiếp" mơ hồ (thấp), JD P3 chiếm 31% (ghi nhận)`); }, 'b2');
    mark(3); tl.fromTo(g7, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 });
    ctr(tl, 0, 1, 0.1, (v) => v > 0 && setCalc(calc, `<span class="k">Công thức (33)</span><span class="f">G7 ⇔ mọi cổng bắt buộc đạt ∧ không có phát hiện mức cao</span> → đạt · phát hiện mức thấp thành bài học cho lượt sau`));
  }, 300);

  const CHANGES = [
    { n: 'Quản lý các bên liên quan', from: null, cls: 'mới', type: 'NEW' },
    { n: 'Quản lý rủi ro dự án', from: '1.2.1', cls: 'P · hồ sơ', type: 'MINOR' },
    { n: 'Lập kế hoạch dự án', from: '2.0.0', cls: 'B · sửa lỗi', type: 'PATCH' },
    { n: 'Giao tiếp', from: '1.4.0', cls: 'D · định nghĩa', type: 'MAJOR' },
    { n: 'Thuyết trình', from: null, cls: 'tách từ Giao tiếp', type: 'NEW' },
    { n: 'Quản lý hợp đồng', from: '1.0.0', cls: 'ngừng dùng', type: 'DEPRECATE' },
  ];
  const bump = (v, t) => { if (!v) return '1.0.0'; let [a, b, c] = v.split('.').map(Number); if (t === 'MAJOR') return `${a + 1}.0.0`; if (t === 'MINOR') return `${a}.${b + 1}.0`; if (t === 'PATCH') return `${a}.${b}.${c + 1}`; return v; };
  const dictLevel = (ch) => { const rank = { PATCH: 1, MINOR: 2, NEW: 2, DEPRECATE: 2, MAJOR: 2 }; return Math.max(...ch.map((c) => rank[c.type] || 0)) >= 2 ? 'MINOR' : 'PATCH'; };
  const DICT_FROM = '1.2.0', DICT_TO = bump(DICT_FROM, dictLevel(CHANGES));

  STORY.B8 = (root) => player(root, [
    ['Danh sách thay đổi', 'Code so khung mới với từ điển nền 1.2.0.'],
    ['Xếp loại và tăng phiên bản (38)', 'Mỗi thay đổi được xếp loại; loại quyết định số nào tăng.'],
    ['Phiên bản từ điển (39)', 'Từ điển tăng theo mức cao nhất; MAJOR của một mục chỉ làm từ điển tăng MINOR.'],
    ['Tầng và hạn rà soát (34)–(35)', 'Không có bằng chứng do người thu thì tầng Nội bộ, rà soát sau 12 tháng.'],
    ['Chuỗi nhật ký (36)', 'Mỗi sự kiện được băm nối vào sự kiện trước.'],
  ], ({ svg, calc, tl, mark }) => {
    const rows = CHANGES.map((c, i) => { const y = 30 + i * 36; const g = S('g', { opacity: 0 }, svg); S('rect', { x: 20, y, width: 520, height: 30, rx: 5, fill: C.fill }, g); T(g, 30, y + 19, c.n, { 'font-weight': 600 }); const cl = T(g, 230, y + 19, '', { fill: C.ink2 }); const v = T(g, 530, y + 19, '', { 'font-weight': 700, 'text-anchor': 'end' }); return { g, cl, v }; });
    const dv = S('g', { opacity: 0 }, svg); S('rect', { x: 580, y: 30, width: 300, height: 70, rx: 8, fill: '#e6effb', stroke: C.c1 }, dv); T(dv, 595, 54, 'TỪ ĐIỂN', { 'font-size': 10, fill: C.ink3, 'font-weight': 700 }); const dvt = T(dv, 595, 84, '', { 'font-size': 22, 'font-weight': 700 });
    const tier = S('g', { opacity: 0 }, svg); [['Nội bộ', C.c1], ['Sản phẩm thị trường', '#e4e3dd'], ['Quyết định nhân sự', '#e4e3dd']].forEach(([l, c], i) => { S('rect', { x: 580, y: 120 + i * 30, width: 300, height: 26, rx: 5, fill: c }, tier); T(tier, 592, 137 + i * 30, (i ? '' : '✓ ') + l, { fill: i ? C.ink3 : '#fff', 'font-weight': 700 }); });
    T(tier, 580, 222, 'rà soát trước 18/11/2027', { fill: C.ink2 });
    const chain = S('g', {}, svg); const blocks = [];
    let hashes = ['3a9f…', '77c0…', 'c41d…', '9f3c…'];
    (async () => { let h = '0'.repeat(64); const out = []; for (const e of ['B8 xếp loại', 'tính phiên bản', 'tính tầng', 'chờ duyệt']) { h = await sha256(h + e); out.push(h.slice(0, 4) + '…'); } hashes = out; })();
    const bl = ['B8 xếp loại', 'tính phiên bản', 'tính tầng', 'chờ duyệt'].map((e, i) => { const x = 20 + i * 140; const g = S('g', { opacity: 0 }, chain); S('rect', { x, y: 260, width: 120, height: 46, rx: 6, fill: '#fff', stroke: C.line2 }, g); T(g, x + 8, 278, e, { 'font-size': 10 }); const ht = T(g, x + 8, 296, '', { 'font-size': 10, 'font-family': 'ui-monospace, Menlo, monospace', fill: C.ai }); if (i) S('line', { x1: x - 20, y1: 283, x2: x, y2: 283, stroke: C.ink3 }, g); return { g, ht }; });
    mark(0); tl.to(rows.map((r) => r.g), { opacity: 1, duration: 0.2, stagger: 0.1 });
    ctr(tl, 0, 1, 0.6, (v) => setCalc(calc, `<span class="k">So sánh</span>${CHANGES.length} thay đổi so với từ điển ${DICT_FROM} · 8 năng lực dùng lại nguyên bản`), '<');
    mark(1);
    ctr(tl, 0, CHANGES.length, CHANGES.length * 0.35, (v) => { const n = Math.round(v); rows.forEach((r, i) => { const c = CHANGES[i]; r.cl.textContent = i < n ? c.cls + ' → ' + (c.type === 'NEW' ? 'tạo mới' : c.type === 'DEPRECATE' ? 'ngừng dùng' : c.type) : ''; r.v.textContent = i < n ? (c.type === 'DEPRECATE' ? c.from + ' · ngừng' : `${c.from || '—'} → ${bump(c.from, c.type)}`) : ''; r.v.setAttribute('fill', c.type === 'MAJOR' ? C.bad : c.type === 'NEW' ? C.ok : c.type === 'DEPRECATE' ? C.ink3 : C.c1); }); const c = CHANGES[Math.max(0, Math.min(CHANGES.length - 1, n - 1))]; setCalc(calc, `<span class="k">Công thức (38)</span><span class="f">S, D → MAJOR ; P, L, V → MINOR ; B → PATCH</span> · "${c.n}" (${c.cls}) → <b>${c.from || '—'} → ${c.type === 'DEPRECATE' ? 'ngừng dùng' : bump(c.from, c.type)}</b>`); }, 'b1');
    mark(2); tl.to(dv, { opacity: 1, duration: 0.3 });
    ctr(tl, 0, 1, 0.8, (v) => { dvt.textContent = v < 0.5 ? DICT_FROM : `${DICT_FROM} → ${DICT_TO}`; setCalc(calc, `<span class="k">Công thức (39)</span><span class="f">Δ<sub>từ điển</sub> = max(Δ của từng mục)</span>, với MAJOR của một mục tính là MINOR của từ điển · max = ${dictLevel(CHANGES)} → <b>${DICT_FROM} → ${DICT_TO}</b>`); });
    mark(3); tl.to(tier, { opacity: 1, duration: 0.3 });
    ctr(tl, 0, 1, 0.3, (v) => v > 0 && setCalc(calc, `<span class="k">Công thức (34)–(35)</span><span class="f">tầng = Nội bộ khi số bằng chứng do người thu = 0</span> ; hạn rà soát = ngày phát hành + 12 tháng`));
    mark(4); bl.forEach((b, i) => { tl.to(b.g, { opacity: 1, duration: 0.25 }, 'b4+=' + i * 0.3); ctr(tl, 0, 1, 0.01, (v) => (b.ht.textContent = v > 0 ? 'h = ' + hashes[i] : ''), 'b4+=' + (i * 0.3 + 0.2)); });
    ctr(tl, 0, 1, 1.4, (v) => v > 0 && setCalc(calc, `<span class="k">Công thức (36)</span><span class="f">h<sub>k</sub> = SHA-256(h<sub>k−1</sub> ‖ e<sub>k</sub>)</span> · sửa một sự kiện cũ thì mọi mã băm sau nó đều sai, nên phát hiện được ngay`), 'b4');
  }, 320);

  // ====================== NETWORK DIFF ======================
  const NODES = [
    { id: 'PM', n: 'Project Manager', role: true, x: 80, y: 90 }, { id: 'BA', n: 'Business Analyst', role: true, x: 80, y: 210 }, { id: 'SM', n: 'Scrum Master', role: true, x: 80, y: 320 },
    { id: 'c1', n: 'Lập kế hoạch dự án', x: 330, y: 50, st: 'patch', v: '2.0.0 → 2.0.1' }, { id: 'c2', n: 'Quản lý tiến độ', x: 330, y: 135, st: 'same' }, { id: 'c3', n: 'Quản lý rủi ro dự án', x: 330, y: 220, st: 'minor', v: '1.2.1 → 1.3.0' },
    { id: 'c5', n: 'Phân tích yêu cầu', x: 330, y: 315, st: 'same' }, { id: 'c4', n: 'Giao tiếp', x: 540, y: 190, st: 'major', v: '1.4.0 → 2.0.0' }, { id: 'c4b', n: 'Thuyết trình', x: 650, y: 290, st: 'new', from: 'c4', v: 'mới 1.0.0' },
    { id: 'c6', n: 'Lãnh đạo nhóm', x: 540, y: 70, st: 'same' }, { id: 'c7', n: 'Quản lý ngân sách', x: 540, y: 330, st: 'same' }, { id: 'c8', n: 'Quản lý hợp đồng', x: 770, y: 80, st: 'gone', v: 'ngừng dùng' },
    { id: 'c9', n: 'Quản lý các bên liên quan', x: 790, y: 200, st: 'new', v: 'mới 1.0.0' }, { id: 'c10', n: 'Huấn luyện nhóm', x: 790, y: 320, st: 'same' },
  ];
  const EA = [['PM', 'c1'], ['PM', 'c2'], ['PM', 'c3'], ['PM', 'c4'], ['PM', 'c6'], ['PM', 'c7'], ['PM', 'c8'], ['BA', 'c4'], ['BA', 'c5'], ['BA', 'c2'], ['SM', 'c4'], ['SM', 'c6'], ['SM', 'c10'], ['SM', 'c2']];
  const EB_NEW = [['PM', 'c9'], ['PM', 'c4b']];
  function netDiff(root) {
    root.classList.add('netwrap');
    return player(root, [
      ['Từ điển 1.2.0', 'Mạng trước khi cập nhật: vai trò nối với các năng lực đang ghim.'],
      ['Ngừng dùng', 'Năng lực không còn khung nào dùng mờ đi, nét đứt.'],
      ['Thay đổi nhỏ', 'MINOR và PATCH: viền cam, ghi phiên bản cũ → mới.'],
      ['Thay đổi lớn, tách đôi', 'MAJOR: viền đỏ; năng lực mới tách ra từ nó. Khung đang ghim bản cũ chuyển sang cần rà soát.'],
      ['Năng lực mới', 'Năng lực tạo mới hiện ra, tô xanh đậm, chữ đậm.'],
      ['Từ điển 1.3.0', 'Mức tăng của từ điển tính từ các thay đổi.'],
    ], ({ svg, calc, tl, mark }) => {
      const P = Object.fromEntries(NODES.map((n) => [n.id, n]));
      const eg = S('g', {}, svg), ng = S('g', {}, svg);
      const edge = (a, b, attrs = {}) => S('line', { x1: P[a].x + 62, y1: P[a].y, x2: P[b].x - 16, y2: P[b].y, stroke: '#bdbbb5', 'stroke-width': 1.3, ...attrs }, eg);
      const ea = EA.map(([a, b]) => ({ a, b, el: edge(a, b) }));
      const enew = EB_NEW.map(([a, b]) => { const el = edge(a, b, { stroke: C.c3, 'stroke-width': 2, opacity: 0 }); const len = Math.hypot(P[b].x - 16 - P[a].x - 62, P[b].y - P[a].y); el.setAttribute('stroke-dasharray', len); el.setAttribute('stroke-dashoffset', len); return { el, len }; });
      const G = {};
      NODES.forEach((n) => {
        const g = S('g', {}, ng); G[n.id] = g;
        if (n.role) { S('rect', { x: n.x - 62, y: n.y - 16, width: 124, height: 32, rx: 6, fill: '#e6effb', stroke: C.c1 }, g); T(g, n.x, n.y + 4, n.n, { 'text-anchor': 'middle', 'font-weight': 600 }); n.g = g; return; }
        n.ring = S('circle', { cx: n.x, cy: n.y, r: 21, fill: 'none', stroke: 'transparent', 'stroke-width': 3 }, g);
        n.dot = S('circle', { cx: n.x, cy: n.y, r: 15, fill: '#8db8ec', stroke: '#fff', 'stroke-width': 2 }, g);
        n.lbl = T(g, n.x, n.y + 32, n.n, { 'text-anchor': 'middle', 'font-size': 10.5 });
        n.ver = T(g, n.x, n.y + 45, '', { 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700 });
        if (n.st === 'new') { g.setAttribute('opacity', 0); }
      });
      const badge = S('g', {}, svg); S('rect', { x: 700, y: 360, width: 190, height: 32, rx: 6, fill: '#1d1d1b' }, badge); const bt = T(badge, 795, 381, 'Từ điển 1.2.0', { 'text-anchor': 'middle', fill: '#fff', 'font-weight': 700, 'font-size': 13 });
      const listHtml = (n) => `<table><tr><th>Năng lực</th><th>Loại</th><th>Phiên bản</th></tr>${CHANGES.slice(0, n).map((c) => `<tr><td>${c.n}</td><td>${c.cls}</td><td style="color:${c.type === 'MAJOR' ? C.bad : c.type === 'NEW' ? C.ok : c.type === 'DEPRECATE' ? C.ink3 : C.c1};font-weight:700">${c.type === 'DEPRECATE' ? 'ngừng dùng' : (c.from || '—') + ' → ' + bump(c.from, c.type)}</td></tr>`).join('')}</table>`;
      mark(0); tl.from(ng.children, { opacity: 0, duration: 0.3, stagger: 0.04 });
      ctr(tl, 0, 1, 0.3, () => setCalc(calc, `<span class="k">Trước</span>3 vai trò · 10 năng lực · 14 liên kết ghim phiên bản`), '<');
      mark(1); const c8 = P.c8; tl.to(c8.dot, { attr: { fill: '#e4e3dd', 'stroke-dasharray': '3 3', stroke: C.ink3 }, duration: 0.4 }).to(G.c8, { opacity: 0.35, duration: 0.5 }, '<').to(ea.find((e) => e.b === 'c8').el, { opacity: 0.15, attr: { 'stroke-dasharray': '4 4' }, duration: 0.5 }, '<');
      ctr(tl, 0, 1, 0.01, (v) => { c8.ver.textContent = v > 0 ? 'ngừng dùng' : ''; c8.ver.setAttribute('fill', C.ink3); }, '<');
      ctr(tl, 0, 1, 0.4, (v) => v > 0 && setCalc(calc, listHtml(0) + `<div class="small muted">"Quản lý hợp đồng": không khung nào ở bản mới dùng → ngừng dùng (giữ lại để đọc bản cũ)</div>`), '<');
      mark(2); ['c3', 'c1'].forEach((id, i) => { const n = P[id]; tl.to(n.ring, { attr: { stroke: C.c2 }, duration: 0.3 }, 'b2+=' + i * 0.4).fromTo(n.ring, { attr: { r: 15 } }, { attr: { r: 21 }, duration: 0.5, ease: 'back.out(3)' }, '<'); ctr(tl, 0, 1, 0.01, (v) => { n.ver.textContent = v > 0 ? n.v : ''; n.ver.setAttribute('fill', C.warn); }, 'b2+=' + (i * 0.4 + 0.2)); });
      ctr(tl, 1, 3, 0.8, (v) => setCalc(calc, listHtml(Math.round(v))), 'b2');
      mark(3); const c4 = P.c4, c4b = P.c4b;
      tl.to(c4.ring, { attr: { stroke: C.bad }, duration: 0.3 }).fromTo(c4.ring, { attr: { r: 15 } }, { attr: { r: 23 }, duration: 0.5, ease: 'back.out(3)' }, '<');
      ctr(tl, 0, 1, 0.01, (v) => { c4.ver.textContent = v > 0 ? c4.v : ''; c4.ver.setAttribute('fill', C.bad); }, '<');
      tl.set(G.c4b, { opacity: 1 }).fromTo(G.c4b, { x: c4.x - c4b.x, y: c4.y - c4b.y, scale: 0.4, transformOrigin: `${c4b.x}px ${c4b.y}px` }, { x: 0, y: 0, scale: 1, duration: 0.8, ease: 'power3.out' });
      ea.filter((e) => e.b === 'c4' && e.a !== 'PM').forEach((e) => tl.to(e.el, { attr: { stroke: C.warn, 'stroke-dasharray': '5 4' }, duration: 0.4 }, '<'));
      ctr(tl, 0, 1, 0.01, (v) => { c4b.ver.textContent = v > 0 ? 'tách ra · 1.0.0' : ''; c4b.ver.setAttribute('fill', C.ok); c4b.dot.setAttribute('fill', C.c3); c4b.lbl.setAttribute('font-weight', 700); }, '<');
      ctr(tl, 0, 1, 0.5, (v) => v > 0 && setCalc(calc, listHtml(5) + `<div class="small muted">Business Analyst và Scrum Master vẫn ghim Giao tiếp@1.4.0 (nét cam đứt) → cần rà soát</div>`), '<');
      mark(4); const c9 = P.c9; tl.set(G.c9, { opacity: 1 }).fromTo(G.c9, { scale: 0, transformOrigin: `${c9.x}px ${c9.y}px` }, { scale: 1, duration: 0.6, ease: 'back.out(2)' });
      ctr(tl, 0, 1, 0.01, (v) => { c9.dot.setAttribute('fill', C.c3); c9.lbl.setAttribute('font-weight', 700); c9.ver.textContent = v > 0 ? 'mới · 1.0.0' : ''; c9.ver.setAttribute('fill', C.ok); }, '<');
      tl.fromTo(c9.ring, { attr: { r: 15, stroke: C.c3 }, opacity: 1 }, { attr: { r: 32 }, opacity: 0, duration: 0.9, repeat: 1 }, '<');
      enew.forEach((e) => tl.to(e.el, { opacity: 1, attr: { 'stroke-dashoffset': 0 }, duration: 0.6 }, '<0.2'));
      ctr(tl, 0, 1, 0.5, (v) => v > 0 && setCalc(calc, listHtml(6)), '<');
      mark(5); ctr(tl, 0, 1, 0.6, (v) => { bt.textContent = v > 0.5 ? `Từ điển ${DICT_FROM} → ${DICT_TO}` : `Từ điển ${DICT_FROM}`; if (v > 0) setCalc(calc, listHtml(6) + `<div><span class="k">Công thức (39)</span>mức cao nhất = ${dictLevel(CHANGES)} → <b>${DICT_FROM} → ${DICT_TO}</b> · 2 khung cần rà soát</div>`); });
      tl.fromTo(badge, { scale: 1 }, { scale: 1.08, transformOrigin: '795px 376px', duration: 0.25, yoyo: true, repeat: 1 });
    }, 400);
  }
  function addLegend(root) { root.insertAdjacentHTML('beforeend', `<div class="legend"><span><i style="background:#8db8ec"></i>không đổi</span><span><i style="background:#fff;border:3px solid ${C.c2}"></i>MINOR / PATCH</span><span><i style="background:#fff;border:3px solid ${C.bad}"></i>MAJOR</span><span><i style="background:${C.c3}"></i>mới (chữ đậm)</span><span><i style="background:#e4e3dd;border:1px dashed ${C.ink3}"></i>ngừng dùng (mờ)</span><span><i style="background:${C.warn};border-radius:0;height:3px;width:16px;vertical-align:3px"></i>khung ghim bản cũ, cần rà soát</span></div>`); }

  // ====================== EXTRA PANELS ======================
  function b5Extra() {
    const rows = KEPT.map((c, i) => `<tr class="ev-row" data-c="${c.id}"><td>${i + 1}</td><td><b>${c.n}</b>${c.meta ? ' <span class="chip mute">meta</span>' : ''}<div class="small muted">${c.def}</div></td><td>${c.lop}</td><td class="n">${vn(c.S)}</td><td class="n">${c.jd}</td><td class="n">${c.seg}</td><td>${TASKS.filter((t) => t.links.includes(c.id)).map((t) => t.n).join(', ') || '<span class="faint">không gánh nhiệm vụ riêng</span>'}</td><td class="n">${c.lv}</td><td class="n">${vn(c.r)}</td><td>${c.reuse ? '<span class="chip">dùng lại ' + c.id + '</span>' : '<span class="chip ok">mới</span>'}</td></tr>`).join('');
    return `<div class="card pad" style="margin-top:12px"><h5>Tập năng lực đã chọn · ${CORE.length} lõi + ${META.length} meta</h5>
      <table><tr><th>#</th><th>Năng lực và định nghĩa</th><th>Lớp</th><th class="n">S(c)</th><th class="n">JD</th><th class="n">Đoạn</th><th>Nhiệm vụ gánh</th><th class="n">Bậc</th><th class="n">r<sub>wg</sub></th><th>Từ điển</th></tr>${rows}</table>
      <div class="small muted" style="margin-top:4px">Bấm một năng lực để xem bằng chứng bên dưới. S(c) = E(c) / max E (12)–(13); bậc = trung vị ba ghế (26).</div></div>
      <div class="card pad" style="margin-top:12px"><h5>Bằng chứng nối thế nào · đoạn JD → nhiệm vụ → năng lực</h5><div class="g2" style="grid-template-columns:1.5fr 1fr"><svg id="evmap" viewBox="0 0 640 420" style="width:100%;background:#fcfcfb;border:1px solid var(--line);border-radius:6px"></svg><div id="evside" class="small"></div></div></div>`;
  }
  function evMap() {
    const svg = document.getElementById('evmap'); if (!svg) return;
    const side = document.getElementById('evside');
    const ty = (i) => 22 + i * 33, cy = (i) => 18 + i * 31;
    const tasks = TASKS, comps = KEPT;
    T(svg, 20, 12, 'NHIỆM VỤ (trọng số)', { 'font-size': 9.5, fill: C.ink3, 'font-weight': 700 }); T(svg, 400, 12, 'NĂNG LỰC', { 'font-size': 9.5, fill: C.ink3, 'font-weight': 700 });
    const lines = [];
    tasks.forEach((t, i) => { S('rect', { x: 20, y: ty(i) - 9, width: 180 * (t.w / tasks[0].w), height: 18, rx: 3, fill: t.links.length ? '#e6effb' : '#fbe7e5' }, svg); T(svg, 26, ty(i) + 4, `${t.n} · ${vn(t.w)}`, { 'font-size': 10 }); t.links.forEach((l) => { const j = comps.findIndex((c) => c.id === l); if (j < 0) return; lines.push({ c: l, el: S('path', { d: `M210 ${ty(i)} C 300 ${ty(i)}, 300 ${cy(j)}, 392 ${cy(j)}`, fill: 'none', stroke: '#bdbbb5', 'stroke-width': 1.2 }, svg) }); }); });
    const nodes = comps.map((c, j) => { const g = S('g', { style: 'cursor:pointer' }, svg); S('circle', { cx: 400, cy: cy(j), r: 4 + c.S * 6, fill: c.reuse ? '#8db8ec' : C.c3 }, g); T(g, 414, cy(j) + 4, c.n, { 'font-size': 10.5, 'font-weight': 600 }); g.addEventListener('click', () => pick(c.id)); return g; });
    function pick(id) {
      const c = KEPT.find((x) => x.id === id);
      lines.forEach((l) => { const on = l.c === id; l.el.setAttribute('stroke', on ? C.c1 : '#e4e3dd'); l.el.setAttribute('stroke-width', on ? 2.5 : 1); if (on && hasG) { const len = l.el.getTotalLength(); gsap.fromTo(l.el, { attr: { 'stroke-dasharray': len, 'stroke-dashoffset': len } }, { attr: { 'stroke-dashoffset': 0 }, duration: 0.6, ease: 'power2.out' }); } });
      document.querySelectorAll('#b-viz .ev-row').forEach((r) => r.classList.toggle('on', r.dataset.c === id));
      side.innerHTML = `<h5>${c.n}</h5><div>${c.def}</div><table style="margin-top:6px"><tr><td>Bằng chứng</td><td>${c.jd} JD · ${c.seg} đoạn · E = ${c.E}</td></tr><tr><td>Điểm thị trường</td><td>S = ${c.E} / ${maxE} = <b>${vn(c.S)}</b></td></tr><tr><td>Ba ghế (quan trọng)</td><td>${c.I.join(' · ')} → x̄ ${vn(c.mI)}, r<sub>wg</sub> ${vn(c.r)}</td></tr><tr><td>Bậc yêu cầu</td><td>trung vị(${c.L.join(', ')}) = ${c.lv}</td></tr></table><div style="margin-top:6px" class="muted">Đoạn tiêu biểu: "${c.q}…"</div><div style="margin-top:6px"><a data-go="dict" data-tab="dict:trace">Truy vết đầy đủ trong Từ điển →</a></div>`;
    }
    pick(KEPT[3].id);
    document.querySelectorAll('#b-viz .ev-row').forEach((r) => r.addEventListener('click', () => pick(r.dataset.c)));
  }
  function b6Extra(cid = 'C-014') {
    const others = KEPT.filter((c) => !IND[c.id]);
    const items = IND[cid];
    return `<div class="card pad" style="margin-top:12px" id="b6x"><h5>Chỉ báo từng bậc</h5><div class="compsel">${Object.keys(IND).map((k) => `<span data-c6="${k}" class="${k === cid ? 'on' : ''}">${CAND.find((c) => c.id === k).n}</span>`).join('')}</div>
      <table><tr><th>Bậc</th><th>Chỉ báo (bản phát hành)</th><th>Ba ghế lần 1</th><th class="n">p lần 1</th><th>Ghi chú</th></tr>${items.map((it) => `<tr><td>${it.lv}</td><td>${it.rw ? it.rw.t : it.t}${it.rw ? `<div class="small faint">trước: ${it.t}</div>` : ''}</td><td>${it.s.map((l, k) => `<b style="color:${l === it.lv ? C.ok : C.bad}">${l}</b>`).join(' · ')}</td><td class="n" style="color:${pOf(it) >= 0.7 ? C.ok : C.bad}">${vn(pOf(it))}</td><td>${it.rw ? 'viết lại → p = 1,00' : ''}</td></tr>`).join('')}</table>
      <div class="small muted" style="margin-top:4px">Fleiss κ: ${vn(fleiss(items).k)} → ${vn(fleiss(items.map((it) => (it.rw ? { ...it, s: it.rw.s } : it))).k)} sau viết lại. ${others.length} năng lực còn lại có thẻ chỉ báo cùng cấu trúc: ${others.map((c) => c.n).join(', ')}.</div></div>`;
  }

  // ====================== HOOK INTO WIREFRAME ======================
  // Target-state chips for the block detail (a finished run).
  const done = (t, g) => `<span class="chip ok">Xong · ${t}</span> <span class="chip ok">${g}</span>`;
  B.B5.chips = done('lần 2 · 21:05', 'G5 đạt'); B.B6.chips = done('6:40', 'G6 đạt'); B.B7.chips = done('3:10', 'G7 đạt'); B.B8.chips = done('0:20', 'chờ duyệt');
  B.B5.desc = `Nối nhiệm vụ với năng lực, chọn ${CORE.length} lõi + ${META.length} meta, kiểm độ phủ ${vn(COV)}, đặt bậc yêu cầu.`;
  DEF.blk = 'flow';
  const orig = window.renderBlock;
  window.renderBlock = function (b) {
    orig(b);
    const f = document.getElementById('b-flow');
    if (f) { if (f._tl) f._tl.kill(); f._tl = STORY[b] ? STORY[b](f) : null; }
    const viz = document.getElementById('b-viz');
    if (b === 'B5') { viz.insertAdjacentHTML('beforeend', b5Extra()); evMap(); }
    if (b === 'B6') { const draw = (cid) => { const old = document.getElementById('b6x'); if (old) old.remove(); viz.insertAdjacentHTML('beforeend', b6Extra(cid)); document.querySelectorAll('#b6x [data-c6]').forEach((s) => s.addEventListener('click', () => draw(s.dataset.c6))); }; draw('C-014'); }
  };
  ['net-dict', 'net-out'].forEach((id) => { const el = document.getElementById(id); if (el) { netDiff(el); addLegend(el); } });
  // autoplay a story when its tab or screen becomes visible
  document.addEventListener('click', (e) => { setTimeout(() => { const vis = [...document.querySelectorAll('.screen.on .pane.on')].find((p) => p.querySelector('.pl')); if (!vis) return; const host = vis.querySelector('#b-flow, #net-dict, #net-out'); const tl = host && host._tl; if (tl && tl.progress() === 0 && !tl.isActive()) tl.play(); }, 60); });
  const cur = document.querySelector('.screen.on');
  if (cur && cur.id === 'blk') go('blk', curB, 'blk:' + (location.hash.split('/')[2] || 'flow'));
})();
