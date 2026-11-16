(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=x=>Number((100*x).toFixed(1))+'%';
const names=['Chốt phạm vi','Thu & kiểm JD','Neo nghề / ngành','Mã hóa khái niệm','Thu sự kiện','Chọn năng lực','Viết & kiểm chỉ báo','Thẩm định AI','Phát hành & audit'];
const agents=['A9 · Charter','A1 · Research','A1 · Mapper','A2 · Coder','A3 / A4 / A5','A6 / A7','A8 · Indicators','A9 + 3 AI reviewer','A9 · Registry → AU'];
const artifacts=['Charter + policy','JD có nguồn','W + nhiệm vụ','Ứng viên C + nguồn','Sự kiện + nhãn','C đã chọn + bậc R','Chỉ báo bản nháp','Quyết định kiểm','W / C / R / V / G'];
function snapshot(lab,id){
 const actual=id==='FAST'?lab.fast:lab.outputs[id];
 if(actual)return {lab,out:actual,actual:true,blockedAt:null};
 const sim=Object.assign(new root.Lab(),copy(lab));
 const n=id==='FAST'?3:Number(id.slice(1));
 while(sim.position<=n&&!sim.halted&&!sim.completed)sim.step();
 if(id==='FAST'&&!sim.halted)sim.quick();
 return {lab:sim,out:id==='FAST'?sim.fast:sim.outputs[id],actual:false,blockedAt:sim.halted?'B'+sim.position:null};
}
function explain(lab,id){
 const o=id==='FAST'?lab.fast:lab.outputs[id];if(!o)return null;
 const p=lab.outputs, n=lab.data.jds.length, rows=[], calc=[], notes=[];
 const add=(label,formula,substitution,meaning)=>calc.push({label,formula,substitution,meaning});
 let input=[],output=[],flow=[],handoff='',method='',source='';
 if(id==='B0'){
  input=[['Vai trò','Product Owner'],['Lõi đầu lượt','v'+lab.startDictionary.version],['Lesson an toàn',lab.config.approvedLessons.join(', ')||'0 lesson']];
  add('Cổng cấu hình','G₀ = has(policy.version) ∧ AIOnly',`${o.policy.version} có phiên bản ∧ ${o.policy.AIOnly} = ${o._gate?'ĐẠT':'CHẶN'}`,'Hai kiểm tra đang có trong engine; mục đích và giới hạn được ghi trong charter, chưa có bộ đo chất lượng charter.');
  output=[['Nhánh',o.branches.join(' / ')],['Giới hạn',o.permittedUse],['Snapshot',o.policy.version]];
  flow=['Đọc lõi đầu lượt','Nạp lesson đã an toàn','Khóa policy cho lượt'];handoff='B1 nhận charter; B2 đọc nhiệm vụ seed. Policy và lesson đã khóa dùng chung cho toàn lượt.';method='Hợp đồng đầu vào có phiên bản';
 }else if(id==='B1'){
  const valid=o.jds.filter(j=>j.source).length;
  input=[['JD đầu vào',n+' bản ghi'],['Nguồn gốc riêng',o.uniqueOrigins+' seed-company'],['Điều kiện tối thiểu','N ≥ '+lab.config.minJD]];
  add('Số lượng hợp lệ','N_valid = Σⱼ 1[sourceⱼ ≠ ∅]',o.jds.map(j=>j.source?1:0).join(' + ')+' = '+valid,`Yêu cầu ≥ ${lab.config.minJD}. Đây là ngưỡng giả định thiết kế, chưa phải cỡ mẫu thống kê.`);
  add('Tỷ lệ có địa chỉ nguồn','Trace = N_valid / N_total',`${valid} / ${o.jds.length} = ${pct(valid/o.jds.length)}`,'Yêu cầu 100%. Có địa chỉ seed chưa đồng nghĩa nguồn thực hoặc nội dung đúng.');
  rows.push(...o.jds.map(j=>({id:j.id,name:j.industry,value:j.source?'Có nguồn':'THIẾU NGUỒN',detail:j.source||'Không được bàn giao',bad:!j.source})));
  output=[['JD có địa chỉ',valid+'/'+o.jds.length],['Cổng',o._gate?'Đạt → bàn giao':'Chặn cả hai nhánh'],['Dữ liệu', 'Synthetic / seed']];flow=['Đọc bản ghi','Đếm địa chỉ nguồn','So với 2 điều kiện'];handoff='B3 sử dụng trực tiếp danh sách JD đã kiểm ở B1; B2 chạy trước để cung cấp W và nhiệm vụ.';method='Kiểm cấu trúc và truy nguồn';source='prov';
 }else if(id==='B2'){
  input=[['Charter',p.B0.role],['Bối cảnh',o.industry.join(' / ')],['Nhiệm vụ seed',o.tasks.length+' nhiệm vụ']];
  add('Có nhiệm vụ','G₂a = [|T| > 0]',`${o.tasks.length} > 0 = ${o.tasks.length>0}`,'Bộ kiểm hiện tại xác nhận số nhiệm vụ > 0; chưa kiểm định nội dung hay đối chiếu mã nghề ngoài.');
  add('Không gán chuẩn chưa kiểm','G₂b = [externalStatus = chưa xác minh]',o.mapping.externalStatus,'Dùng ID W-PO nội bộ. Không suy diễn đây là ánh xạ đã xác nhận với chuẩn nghề / ngành.');
  rows.push(...o.tasks.map(t=>({id:t.id,name:t.name,value:'w = '+t.weight,detail:'concept: '+t.concept})));
  output=[['Vai trò nội bộ',o.mapping.internal],['Nhiệm vụ W',o.tasks.length],['Mã bên ngoài','Chưa xác minh']];flow=['Đọc nhiệm vụ seed','Gắn W-PO','Giữ trạng thái mã ngoài'];handoff='B5 lấy nhiệm vụ và trọng số từ seed W; B8 ghi W khi phát hành.';method='Neo nhiệm vụ vào vai trò';
 }else if(id==='B3'){
  const m=o._metrics;
  input=[['JD đã kiểm',p.B1.jds.length],['C dùng lại',lab.startDictionary.C.length+' định nghĩa'],['Khử trùng sớm',o.earlyDedup?'Có LL-001':'Chưa nạp LL-001']];
  add('Precision trên đáp án seed','P = TP / (TP + FP)',`${m.TP} / (${m.TP} + ${m.FP}) = ${pct(m.precision)}`,'TP = khái niệm seed; FP = ứng viên dư / trùng. Chỉ số chẩn đoán, hiện không phải điều kiện chặn B3.');
  add('Recall trên đáp án seed','R = TP / (TP + FN)',`${m.TP} / (${m.TP} + ${m.FN}) = ${pct(m.recall)}`,'Yêu cầu R = 100% và mọi ứng viên có ít nhất một ID nguồn. Đáp án biết trước vì đây là seed.');
  rows.push(...o.candidates.map((c,i)=>({id:c.id+(c.alias?' · alias':''),name:c.name,value:c.evidence.length+' JD',detail:c.concept+' ← '+c.evidence.join(', '),bad:!!c.alias,index:i})));
  output=[['Ứng viên',o.candidates.length],['Khái niệm duy nhất',m.TP],['Ứng viên dư',m.FP]];flow=['JD.skills → concept','Gắn C ID và nguồn',o.earlyDedup?'Gộp sớm theo lesson':'Giữ alias để AU phát hiện'];handoff='B4 thu sự kiện cho concept; B5 đọc lại ứng viên B3 và gộp trùng trước chọn. Nhánh nhanh cũng đọc B3.';method='Mã hóa có đáp án đối chiếu';source='skill';notes.push('Lượt 1 cố ý để lọt alias stakeholder: cổng vẫn đạt vì precision chưa là điều kiện chặn. Đây là lỗ hổng được AU ghi lại, không che bằng trạng thái PASS.');
 }else if(id==='B4'){
  const traced=o.events.filter(e=>e.source).length,labeled=o.events.filter(e=>e.type==='synthetic_case').length;
  input=[['Concept cần căn cứ',new Set(p.B3.candidates.map(c=>c.concept)).size],['Sự kiện seed',o.events.length],['Câu hỏi từ pilot V',o.pilotQuestions.length]];
  add('Truy nguồn sự kiện','Trace_EV = N_source / N_EV',`${traced} / ${o.events.length} = ${pct(traced/o.events.length)}`,'Yêu cầu 100% sự kiện có địa chỉ seed.');
  add('Giữ loại bằng chứng','Label = N_synthetic_case / N_EV',`${labeled} / ${o.events.length} = ${pct(labeled/o.events.length)}`,'Yêu cầu mọi sự kiện giữ nhãn synthetic_case. Không phải phỏng vấn BEI người thật.');
  rows.push(...o.events.map(e=>({id:e.id,name:e.concept,value:e.ratings.join(' / '),detail:e.source+' · '+e.action})));
  output=[['Sự kiện truy nguồn',traced],['Loại bằng chứng',o.evidenceClass],['Giá trị ngoài thực tế','Chưa kiểm chứng']];flow=['A3: giả thuyết','A4: căn cứ seed','A5: sự kiện giả lập'];handoff='B5 ghép sự kiện theo concept và dùng ba rating seed để đề xuất bậc yêu cầu.';method='Tách giả thuyết và bằng chứng';source='prov';
 }else if(id==='B5'){
  const ts=lab.data.tasks,ss=o.selected,den=ts.reduce((a,t)=>a+t.weight,0),num=ts.filter(t=>ss.some(c=>c.concept===t.concept)).reduce((a,t)=>a+t.weight,0);
  input=[['Ứng viên B3',p.B3.candidates.length],['Sự kiện B4',p.B4.events.length],['Trọng số nhiệm vụ',ts.map(t=>t.weight).join(' + ')]];
  add('Bao phủ có trọng số','Coverage(S) = Σₜ wₜ·1[∃c∈S: aₜc = 1] / Σₜ wₜ',`(${ts.map(t=>t.weight+'×'+Number(ss.some(c=>c.concept===t.concept))).join(' + ')}) / ${den} = ${num}/${den} = ${pct(o.coverage)}`,'w là trọng số thiết kế seed; a = 1 khi trùng concept. Yêu cầu 100%. Đây là kiểm bao phủ, chưa giải bài toán tối ưu chi phí chọn tập.');
  add('Bậc yêu cầu','Level(c) = median(r₁, r₂, r₃)',ss.map(c=>`${c.id}: median(${c.ratings.join(',')}) = ${c.level}`).join(' · '),'Ba rating là seed thứ bậc 1–5. Bậc nằm trên liên kết yêu cầu R của vai trò, không phải bậc cá nhân hay thuộc tính C chung.');
  rows.push(...ss.map(c=>({id:c.id,name:c.name,value:'Bậc R '+c.level,detail:'ratings ['+c.ratings.join(', ')+'] · concept '+c.concept})));
  output=[['C duy nhất',ss.length],['Trùng bị gộp ở B5',o.removedLate],['Bao phủ',pct(o.coverage)]];flow=['Gộp theo concept','Ghép T ↔ C','Tính coverage + median'];handoff='B6 nhận danh sách C, bậc yêu cầu R, các ID JD và rating sự kiện để soạn chỉ báo.';method='Bao phủ nhiệm vụ + trung vị';
 }else if(id==='B6'){
  const agreements=o.cards.map(c=>c.votes.filter(v=>v===c.id).length/c.votes.length),min=Math.min(...agreements);
  input=[['C đã chọn',p.B5.selected.length],['Phiếu / chỉ báo','3 phiếu seed cố định'],['Quyền ghi','Chỉ vùng draft']];
  add('Gán nhãn đúng ID seed','Aᵢ = Σᵥ 1[voteᵥ = IDᵢ] / N_vote',`Mỗi chỉ báo: 3/3 = 100%; min(Aᵢ) = ${pct(min)} ≥ ${pct(lab.config.minAgreement)}`,'Đếm phiếu khớp ID đã biết. Đồng thuận này không đo độ đúng của câu chỉ báo, không phải ba model độc lập.');
  add('Ranh giới ghi','WriteAllowed = [writeScope = draft]',`${lab.fault==='forbidden_write'?'core':'draft'} = draft → ${lab.fault==='forbidden_write'?'SAI · CHẶN':'ĐÚNG'}`,'B6 không được ghi W/C/R lõi. Sự cố ghi trái quyền phải khóa quy trình dù agreement = 100%.');
  rows.push(...o.cards.map(c=>({id:c.id,name:c.name,value:pct(c.agreement)+' · v'+c.version,detail:c.indicator+' | votes: '+c.votes.join(', ')})));
  output=[['Chỉ báo nháp',o.cards.length],['Min agreement',pct(min)],['Phạm vi ghi',lab.fault==='forbidden_write'?'core · vi phạm':'draft']];flow=['Soạn hành vi quan sát','Gán nhãn bằng phiếu seed','Kiểm quyền ghi'];handoff='B7 đọc thẻ chỉ báo và toàn bộ kết quả cổng B0–B6; chưa có quyền phát hành ở B6.';method='Kiểm gán nhãn + phân quyền';notes.push('Ngưỡng 70% là giả định. Với 3 phiếu, 2/3 = 66,7% không đạt; thực tế cần 3/3. Cần hiệu chỉnh ngưỡng trên bộ đối chiếu thực trước khi vận hành.');
 }else if(id==='B7'){
  input=[['Cổng trước',7],['Reviewer',o.reviewers.length+' vai AI seed'],['Chỉ báo nháp',p.B6.cards.length]];
  add('Hội các cổng','G₇ = (G₀ ∧ G₁ ∧ … ∧ G₆) ∧ [Coverage = 1]',Array.from({length:7},(_,i)=>`${'B'+i}: ${p['B'+i]._gate?'1':'0'}`).join(' ∧ ')+` ∧ ${o.coverage} = 1 → ${o._gate?'ĐẠT':'CHẶN'}`,'Không dùng điểm tổng hợp để bù trừ một cổng sai. Ba tên reviewer đang mô phỏng vai trò, chưa kiểm độc lập giữa model.');
  rows.push(...Array.from({length:7},(_,i)=>({id:'B'+i,name:names[i],value:p['B'+i]._gate?'Đạt':'Chặn',detail:p['B'+i]._rules.map(r=>r.name).join(' · '),bad:!p['B'+i]._gate})));
  output=[['Quyết định',o.decision],['Bao phủ',pct(o.coverage)],['Kiểm chứng ngoài',o.externalValidation]];flow=['Đọc các cổng','Kiểm coverage','Chốt ứng viên phát hành'];handoff='B8 đóng phiên bản. AU hậu kiểm log sau khi khung ứng viên đã được tạo; lesson áp dụng ở vòng kế tiếp.';method='Cổng bắt buộc, không bù trừ';
 }else if(id==='B8'){
  const ch=o.changes,find=o.audit.findings;
  input=[['Ứng viên B7',p.B7._gate?'Đã đạt':'Chưa đạt'],['Chỉ báo B6',p.B6.cards.length],['Lõi trước','v'+lab.startDictionary.version]];
  add('Phân loại thay đổi','ADD = chưa có ID; UPDATE = mới phiên bản / thiếu chỉ báo; REUSE = giữ bản cũ', ['ADD','UPDATE','REUSE'].map(k=>k+' = '+ch.filter(c=>c.action===k).length).join(' · '),'G lưu diff; R lưu khung theo phiên bản. Lõi C dùng chung; màn hình từ điển tách yêu cầu bậc ra R.');
  add('Kết quả hậu kiểm AU','Issue_late = |Candidates_B3| − |Selected_B5|',`${p.B3.candidates.length} − ${p.B5.selected.length} = ${p.B5.removedLate} → ${find.length} finding`,'Kiểm vấn đề có căn cứ trong seed. Không bịa issue khi lượt 2 đã khử trùng; lượt 1 tạo LL-001 và buộc xác nhận an toàn trước lượt 2.');
  rows.push(...ch.map(c=>({id:c.id,name:o.frame.competencies.find(x=>x.id===c.id)?.name||c.id,value:c.action,detail:c.action==='UPDATE'?'Trước: '+(c.before||'chưa có chỉ báo')+' | Sau: '+c.after:'Ghi nhận trong G v'+o.version})));
  output=[['Phiên bản','v'+o.version],['Khung R',o.frame.competencies.length+' năng lực'],['AU / lesson',find.length+' finding · '+lab.dictionary.lessons.length+' lesson']];flow=['Đóng khung R','AU đọc chuỗi / ghi lesson','G ghi diff và phiên bản'];handoff='R → xem Khung PO; C/V/G → từ điển. LL-001 an toàn → A0/AQ nạp snapshot mới → B3 gộp sớm ở lượt 2.';method='Phiên bản + audit có dấu vết';source='prov';notes.push('Bản hiện tại là mô phỏng cục bộ, chưa có giao dịch cơ sở dữ liệu hoặc kiểm toán độc lập. Hai luật B8 đang chạy: AU hoàn tất và nhãn synthetic_only.');
 }else if(id==='FAST'){
  const f=o.feedback;
  input=[['Ứng viên B3',p.B3.candidates.length],['Phạm vi','Hỗ trợ / phát triển'],['Quyền lõi W/C/R','Không ghi']];
  add('Giá trị dùng thử seed','SuccessRate = N_success / N_task',`${f.success} / ${f.tasks} = ${pct(f.successRate)}`,'9 thành công, 3 lỗi là seed cố định, không phải kết quả pilot ngoài đời; chưa có ngưỡng giữ / sửa / dừng được hiệu chỉnh.');
  add('Điều kiện giao thử','Trial = has(B3) ∧ ¬STOP',`${!!p.B3} ∧ ${!lab.halted} = ${!!p.B3&&!lab.halted}`,'Đầu ra trial, không có bậc; pilot chỉ ghi V, không tự chuyển thành bản kiểm chứng đầy đủ.');
  rows.push(...o.competencies.map(c=>({id:c.id,name:c.name,value:'Nháp',detail:'Không kết luận bậc yêu cầu hoặc cá nhân'})));
  output=[['Bản thử',o.version],['Khung nháp',o.competencies.length+' C'],['Pilot V',f.errors+' lỗi / '+f.tasks+' bài']];flow=['Chọn tạm / soạn nháp','AU kiểm phạm vi seed','Giao thử → phản hồi V'];handoff='Pilot V → B4 lượt sau → bổ sung câu hỏi kiểm. Muốn phát hành đầy đủ vẫn cần B4–B8.';method='Vòng học nhanh có giới hạn';
 }
 return {input,output,rows,calc,notes,flow,handoff,method,source};
}
const Model={snapshot,explain,names,agents,artifacts};root.ProductionModel=Model;
if(typeof document==='undefined')return;
let recordPick={},equationPick={},inspectMode='compute',omitted={};
const pairList=rs=>rs.map(([a,b])=>`<div class="prod-pair"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
function receipt(l,id){const o=l.outputs[id];if(!o)return 'Chờ đầu vào';if(!o._gate)return '⊘ Không bàn giao';return ({B0:o.policy?.version,B1:o.jds?.length+' JD',B2:o.tasks?.length+' nhiệm vụ',B3:o.candidates?.length+' ứng viên C',B4:o.events?.length+' sự kiện',B5:o.selected?.length+' C · '+pct(o.coverage),B6:o.cards?.length+' chỉ báo',B7:'Ứng viên đã kiểm',B8:'Lõi v'+o.version})[id]}
function node(l,id,sel){let i=Number(id.slice(1)),o=l.outputs[id],awaiting=l.guide?.pending?.id===id;return `<button class="prod-node ${sel===id?'chosen':''} ${o?o._gate?'done':'blocked':''}" data-prod-select="${id}" aria-pressed="${sel===id}"><div><b>${id}</b><span>${awaiting?'CHỜ ĐÃ HIỂU':o?o._gate?'✓ ĐẠT':'⊘ CHẶN':'CHƯA CHẠY'}</span></div><strong>${names[i]}</strong><small>${agents[i]}</small><div class="prod-receipt">${esc(receipt(l,id))}</div><em>${artifacts[i]}</em></button>`}
function line(l,ids,sel){return `<div class="prod-line">${ids.map((id,i)=>node(l,id,sel)+(i<ids.length-1?'<span class="prod-arrow" aria-hidden="true">→</span>':'')).join('')}</div>`}
function matrix(l){const s=l.outputs.B5.selected,excluded=omitted[String(l.round)]||[];return `<div class="prod-table-scroll"><table class="prod-matrix"><caption>Ma trận aₜc · cột mờ = C bị bỏ trong kịch bản thử; chọn C để soi rating</caption><thead><tr><th>Nhiệm vụ / wₜ</th>${s.map(c=>`<th><button data-prod-record="${c.id}">${c.id}</button></th>`).join('')}</tr></thead><tbody>${l.data.tasks.map(t=>`<tr><td>${esc(t.id+' · '+t.name)} <b>w=${t.weight}</b></td>${s.map(c=>`<td class="${excluded.includes(c.id)?'omitted':t.concept===c.concept?'linked':''}">${t.concept===c.concept?(excluded.includes(c.id)?'×':'1'):'·'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
function render(lab,selected,actions){
 const host=document.getElementById('production-board');if(!host)return;
 const id=selected||'B0',i=Number(id.slice(1)),snap=snapshot(lab,id),s=snap.lab,o=snap.out,m=o?explain(s,id):null;
 const status=snap.actual?(id==='FAST'?'BẢN THỬ ĐÃ TẠO':o._gate?'KẾT QUẢ LƯỢT HIỆN TẠI · ĐẠT':'KẾT QUẢ LƯỢT HIỆN TẠI · CHẶN'):'XEM TRƯỚC BẰNG SEED · CHƯA GHI VÀO LƯỢT CHẠY';
 const mayRun=!actions.busy&&!lab.halted&&(id==='FAST'?!lab.fast:!lab.outputs[id]);
 host.innerHTML=`<div class="prod-command"><span><b>A0</b> phân việc & khóa snapshot <i>→</i> <b>AI B0–B8</b> sản xuất <i>→</i> <b>AQ</b> kiểm cổng / dừng</span><small>Đọc được nội bộ; đầu vào và quyền ghi bị kiểm soát khi chạy.</small></div>
 <div class="prod-map"><div class="prod-lane-label">01 / CHUẨN BỊ CHUNG <span>Hợp đồng → dữ liệu → nhiệm vụ → khái niệm</span></div>${line(lab,['B0','B1','B2','B3'],id)}
 <div class="prod-branch-link">↓ B3 chia nhánh theo mục đích <span>Nhánh đầy đủ vẫn đọc dữ liệu B1/B2/B3; không chỉ nhận output liền trước.</span></div>
 <div class="prod-quick-lane"><button class="${id==='FAST'?'chosen':''}" data-prod-select="FAST"><b>↗ GIAO NHANH</b><span>A6/A8 soạn nháp → AU kiểm phạm vi → trial → pilot V</span><small>${lab.fast?lab.fast.version+' · 9/12 bài seed đạt':'Có thể xem trước / giao thử sau B3'} · không ghi lõi W/C/R</small></button><span>↘ V → B4 lượt sau</span></div>
 <div class="prod-lane-label">02 / KIỂM CHỨNG ĐẦY ĐỦ <span>Căn cứ → chọn → chỉ báo → kiểm → phiên bản</span></div>${line(lab,['B4','B5','B6','B7','B8'],id)}
 <div class="prod-memory"><b>↶ AU sau khung ứng viên</b><span>Finding có bằng chứng → lesson → quyết định an toàn ngoài B → A0/AQ nạp lượt sau → B3 tránh lặp lỗi</span></div></div>
 <section class="prod-workbench" aria-label="Chi tiết block ${id}"><div class="prod-workhead"><div><div class="eyebrow">MỞ BLOCK / ${id} · ${id==='FAST'?'A6 / A8 / A9 + AU':agents[i]}</div><h2>${id==='FAST'?'Giao bản thử & học từ pilot':names[i]}</h2><p>${m?esc(m.method):'Block chưa được phép xử lý do cổng trước bị chặn.'}</p></div><div><span class="prod-state ${snap.actual?(o._gate===false?'halted':'actual'):'preview'}">${status}</span><button id="prod-run" class="primary" ${mayRun?'':'disabled'}>${id==='FAST'&&lab.outputs.B3?'Chạy nhánh giao thử':'Chạy từng bước từ B'+lab.position}</button></div></div>
 ${!snap.actual?'<div class="prod-preview-note">Bảng dưới là kết quả tính thử trên bản sao của seed lượt '+lab.round+'. Không thay đổi lõi, log, lesson hay tiến độ của bạn. Mỗi lần chạy chỉ thực hiện một block và mở phần diễn giải. Bạn xác nhận “Đã hiểu” trước khi sang block kế tiếp.</div>':''}
 ${m?`<div class="prod-io"><article><div class="prod-section-label">01 / ĐẦU VÀO</div>${pairList(m.input)}</article><div class="prod-io-arrow">→</div><article class="prod-process"><div class="prod-section-label">02 / XỬ LÝ BỞI AI</div>${m.flow.map((t,k)=>`<div><b>${k+1}</b>${esc(t)}</div>`).join('')}</article><div class="prod-io-arrow">→</div><article><div class="prod-section-label">03 / ĐẦU RA</div>${pairList(m.output)}</article></div>
 <div class="prod-checkstrip">${(o._rules||[]).map(r=>`<span class="${r.pass?'pass':'fail'}"><b>${r.pass?'✓':'⊘'}</b> ${esc(r.name)} <em>${esc(r.actual)} / ${esc(r.expect)}</em></span>`).join('')}</div><div class="prod-worktabs"><button data-prod-mode="compute" class="${inspectMode==='compute'?'chosen':''}">Phép tính & dữ liệu</button><button data-prod-mode="accept" class="${inspectMode==='accept'?'chosen':''}">Nghiệm thu & bàn giao</button><button data-prod-mode="raw" class="${inspectMode==='raw'?'chosen':''}">Bản ghi đầy đủ</button></div>
 ${inspectMode==='compute'?computeHTML(m,s,id):inspectMode==='accept'?acceptHTML(m,o,snap,id):`<pre>${esc(JSON.stringify(o,null,2))}</pre>`}
 <div class="prod-handoff"><div><b>04 / BÀN GIAO ${id==='FAST'?'→ KHO V':id==='B8'?'→ LÕI & VÒNG SAU':'→ BƯỚC TIẾP'}</b><p>${esc(m.handoff)}</p></div><span class="${snap.actual&&o._gate===false?'bad':''}">${snap.actual?(o._gate===false?'⊘ BỊ KHÓA':'✓ ĐÃ TẠO OUTPUT'):'○ CHƯA BÀN GIAO'}</span></div>
 ${m.notes.map(t=>`<div class="prod-caveat">${esc(t)}</div>`).join('')}
 ${m.source?`<div class="prod-method-source">Tham chiếu phương pháp: ${m.source==='prov'?'<a href="https://www.w3.org/TR/prov-o/" target="_blank" rel="noopener">W3C PROV · nguồn → hoạt động → đầu ra</a>':'<a href="https://aclanthology.org/2022.naacl-main.366/" target="_blank" rel="noopener">SkillSpan · trích xuất kỹ năng có dữ liệu đối chiếu</a>'}. Công thức áp dụng và các ngưỡng trên đây là thiết kế mô phỏng riêng, không phải ngưỡng do tài liệu này xác nhận.</div>`:''}
 `:`<div class="empty">${esc(snap.blockedAt||'Cổng trước')} đang chặn. ${esc(id)} không có đầu ra hợp lệ để tính. Chọn block bị chặn để xem điều kiện lỗi.</div>`}
 <div class="prod-footnav"><button data-prod-select="${id==='FAST'?'B3':'B'+Math.max(0,i-1)}">← ${id==='FAST'?'B3':'B'+Math.max(0,i-1)}</button><span>Ngưỡng giả định · dữ liệu tổng hợp · không có model AI trực tiếp</span><button data-prod-select="${id==='FAST'?'B4':i<8?'B'+(i+1):'B0'}">${id==='FAST'?'B4':i<8?'B'+(i+1):'B0 · đầu vòng'} →</button></div></section>`;
 host.querySelectorAll('[data-prod-select]').forEach(b=>b.onclick=()=>{actions.select(b.dataset.prodSelect)});
 host.querySelectorAll('[data-prod-mode]').forEach(b=>b.onclick=()=>{inspectMode=b.dataset.prodMode;render(lab,id,actions)});
 host.querySelectorAll('[data-prod-record]').forEach(b=>b.onclick=()=>{recordPick[id]=b.dataset.prodRecord;render(lab,id,actions)});
 host.querySelectorAll('[data-prod-equation]').forEach(b=>b.onclick=()=>{equationPick[id]=Number(b.dataset.prodEquation);render(lab,id,actions)});
 host.querySelectorAll('[data-prod-scenario]').forEach(b=>b.onclick=()=>{const k=String(s.round),set=new Set(omitted[k]||[]),c=b.dataset.prodScenario;set.has(c)?set.delete(c):set.add(c);omitted[k]=[...set];render(lab,id,actions)});
 const run=host.querySelector('#prod-run');if(run)run.onclick=()=>actions.runTo(id);
}
function coverageSandbox(l){
 const excluded=omitted[String(l.round)]||[],all=l.outputs.B5.selected,chosen=all.filter(c=>!excluded.includes(c.id)),den=l.data.tasks.reduce((a,t)=>a+t.weight,0),covered=l.data.tasks.filter(t=>chosen.some(c=>c.concept===t.concept)),num=covered.reduce((a,t)=>a+t.weight,0),missed=l.data.tasks.filter(t=>!covered.includes(t));
 return `<div class="prod-scenario"><div><b>THỬ TƯ DUY NGƯỢC · Bỏ một C thì nhiệm vụ nào mất căn cứ?</b><p>Chọn để bỏ / thêm C trong bảng tính riêng. Không đổi đầu ra B5 hoặc cổng nghiệm thu đã chạy.</p></div><div class="prod-scenario-options">${all.map(c=>`<button data-prod-scenario="${c.id}" aria-pressed="${!excluded.includes(c.id)}" class="${excluded.includes(c.id)?'excluded':'included'}">${excluded.includes(c.id)?'−':'✓'} ${c.id}</button>`).join('')}</div><div class="prod-scenario-result ${missed.length?'risk':''}"><strong>${num} / ${den} = ${pct(num/den)}</strong><span>${missed.length?'KHÔNG ĐẠT 100% · Mất: '+missed.map(t=>t.id+' (w='+t.weight+')').join(', '):'ĐẠT điều kiện bao phủ trong kịch bản thử'}</span></div></div>`;
}
function computeHTML(m,l,id){
 let eq=Math.min(equationPick[id]||0,m.calc.length-1),c=m.calc[eq],pick=m.rows.find(r=>r.id===recordPick[id])||m.rows[0];
 let viz='';
 if(id==='B5')viz=coverageSandbox(l)+matrix(l);
 if(id==='B3'){
  const candidates=l.outputs.B3.candidates;
  viz=`<div class="prod-transform"><div><b>${l.outputs.B1.jds.length} JD seed</b><span>skills → mã concept</span></div><i>→</i><div><b>${candidates.length} ứng viên C</b><span>${candidates.filter(c=>c.alias).length} alias dư</span></div><i>→</i><div><b>${new Set(candidates.map(c=>c.concept)).size} concept duy nhất</b><span>${l.outputs.B3.earlyDedup?'LL-001 gộp ngay B3':'B5 mới gộp alias stakeholder'}</span></div></div>`;
 }
 if(id==='B8')viz=`<div class="prod-diff-vis">${['ADD','UPDATE','REUSE'].map(k=>`<div><span class="${k}">${k}</span><b>${l.outputs.B8.changes.filter(c=>c.action===k).length}</b><p>${l.outputs.B8.changes.filter(c=>c.action===k).map(c=>c.id).join(' · ')||'Không có'}</p></div>`).join('')}</div>`;
 if(id==='B7')viz=`<div class="prod-gate-chain">${Array.from({length:7},(_,i)=>`<span>${'B'+i}<b>${l.outputs['B'+i]._gate?'✓':'×'}</b></span>`).join('<i>∧</i>')}<i>→</i><strong>B7 ${l.outputs.B7._gate?'ĐẠT':'CHẶN'}</strong></div>`;
 return `${viz}<div class="prod-calc-layout"><article class="prod-calculator"><div class="prod-section-label">BẢNG TÍNH · CHỌN PHÉP KIỂM</div><div class="prod-equation-tabs">${m.calc.map((x,k)=>`<button data-prod-equation="${k}" class="${k===eq?'chosen':''}">${esc(x.label)}</button>`).join('')}</div><div class="prod-math">${esc(c.formula)}</div><div class="prod-substitution"><small>THAY DỮ LIỆU SEED VÀO CÔNG THỨC</small><strong>${esc(c.substitution)}</strong></div><p class="prod-math-definition">${esc(c.meaning)}</p><div class="prod-variables">${variables(id)}</div></article>
 <article class="prod-records"><div class="prod-section-label">BẢN GHI THAM GIA PHÉP TÍNH</div>${m.rows.length?`<div class="prod-record-list">${m.rows.map(r=>`<button class="${pick&&pick.id===r.id?'chosen':''} ${r.bad?'bad-record':''}" data-prod-record="${esc(r.id)}"><span><b>${esc(r.id)}</b> ${esc(r.name)}</span><em>${esc(r.value)}</em></button>`).join('')}</div><div class="prod-record-detail"><b>${esc(pick.id+' · '+pick.name)}</b><p>${esc(pick.detail)}</p>${recordVisual(l,id,pick)}</div>`:'<p>Đầu vào là cấu hình có phiên bản; xem các trường trong ô đầu vào và bản ghi đầy đủ.</p>'}</article></div>`;
}
function variables(id){const v={B0:'∧ = tất cả điều kiện đều đúng. policy.version = phiên bản luật. AIOnly = mọi B do AI thực hiện.',B1:'N_valid = số bản ghi có địa chỉ nguồn; N_total = tổng JD; 1[điều kiện] = 1 nếu đúng, 0 nếu sai.',B2:'T = tập nhiệm vụ của vai trò W. Kiểm mã nghề bên ngoài được giữ riêng với ID nội bộ.',B3:'TP = khái niệm đúng seed; FP = ứng viên dư/trùng; FN = khái niệm seed bị bỏ sót.',B4:'EV = sự kiện; N_source = số sự kiện có nguồn; N_synthetic_case = số giữ đúng nhãn.',B5:'T = nhiệm vụ; S = C được chọn; wₜ = trọng số nhiệm vụ; aₜc = liên kết concept; median = phần tử giữa sau khi sắp xếp.',B6:'Aᵢ = tỷ lệ phiếu khớp ID của chỉ báo i; N_vote = 3; min = giá trị thấp nhất trên mọi chỉ báo.',B7:'Gᵢ = kết quả cổng i. ∧ yêu cầu mọi cổng đúng; coverage phải bằng 1.',B8:'ADD/UPDATE/REUSE là các loại diff. Issue_late chỉ đo lỗi trùng được seed cài sẵn; không đại diện toàn bộ chất lượng audit.',FAST:'N_task = số bài dùng thử; N_success = số bài đạt; STOP = đang bị khóa.'};return esc(v[id]);}
function recordVisual(l,id,r){
 const cid=r.id.split(' · ')[0];
 if(id==='B5'){
 const c=l.outputs.B5.selected.find(c=>c.id===cid),ratings=[...c.ratings].sort((a,b)=>a-b);
 return `<div class="prod-ratings">${ratings.map((v,i)=>`<span class="${i===1?'median':''}">${v}<small>${i===1?'MEDIAN':'rating'}</small></span>`).join('')}<b>→ R bậc ${c.level}</b></div>`;
 }
 if(id==='B6'){
 const c=l.outputs.B6.cards.find(c=>c.id===cid);
 return `<div class="prod-votes">${c.votes.map((v,i)=>`<span>AI seed ${i+1}<b>${esc(v)} ✓</b></span>`).join('')}</div><p>Bậc yêu cầu R: ${c.level}/5 · Chỉ báo v${c.version} · Ghi draft</p>`;
 }
 if(id==='B3'){
 const c=l.outputs.B3.candidates.find(c=>c.id===cid);return `<div class="prod-trace-chips">${c.evidence.map(e=>`<span>${esc(e)}</span>`).join('')}<b>→ ${esc(c.concept)} → ${esc(cid)}</b></div>`;
 }
 if(id==='B4'){
 const e=l.outputs.B4.events.find(e=>e.id===r.id);return `<div class="prod-ratings">${e.ratings.map(v=>`<span>${v}<small>seed</small></span>`).join('')}</div><p>${esc(e.outcome)}</p>`;
 }return '';
}
function acceptHTML(m,o,snap,id){
 const rules=o._rules||[{name:'Truy nguồn bản thử',actual:o.audit.traceability,expect:1,pass:o.audit.traceability===1},{name:'Phạm vi dùng thử',actual:o.audit.scopeAllowed,expect:true,pass:o.audit.scopeAllowed}];
 return `<div class="prod-accept"><div class="prod-section-label">TỪNG ĐIỀU KIỆN BẮT BUỘC · ${snap.actual?'KẾT QUẢ ĐÃ GHI':'KẾT QUẢ TÍNH TRƯỚC'}</div>${rules.map(r=>`<div class="prod-rule ${r.pass?'pass':'fail'}"><b>${r.pass?'✓':'⊘'}</b><div><strong>${esc(r.name)}</strong><small>${r.pass?'Thỏa điều kiện':'Không thỏa → khóa bàn giao'}</small></div><div><small>THỰC TẾ SEED</small><strong>${esc(r.actual)}</strong></div><div><small>YÊU CẦU</small><strong>${esc(r.expect)}</strong></div></div>`).join('')}<p>${id==='FAST'?'Bản thử không thay thế các cổng B4–B8.':'G_'+id.slice(1)+' = '+rules.map(r=>r.pass?1:0).join(' ∧ ')+' = '+(rules.every(r=>r.pass)?'1 · đạt':'0 · chặn')}. ${snap.actual?'Kết quả này có trong log lượt đang chạy.':'Kết quả này chưa có trong log lượt đang chạy.'}</p></div>`;
}
root.renderProduction=render;
})(typeof module==='object'?module.exports:window);
