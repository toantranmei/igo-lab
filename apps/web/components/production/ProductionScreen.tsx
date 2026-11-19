'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/live-source';
import '@/components/run/run.css';
import { WorkspaceShell } from '@/components/shell/AppHeader';

type Item = { id: string; batch_id: string; role_title: string; level: string | null; industry: string | null; framework_type: string; session_id: string | null; audit_sampled: boolean; run_no: number | null; steps_done?: number; cycle_ms?: number | null; reuse_rate?: number | null; overlap_with_root?: number | null; g6_first_pass?: number | null; gates_first_pass?: string; deviations?: number; tier?: string | null; review_date?: string | null; tokens?: number; cost_usd?: number; inherited_indicators?: number };
type Quality = { version: string; competencies: number; distinct: { score: number | null; near_pairs: { a: string; b: string; similarity: number }[] }; coverage: { score: number | null; unused: string[] }; clear: { score: number | null }; evidenced: { score: number | null }; stable: { score: number | null } } | null;
type Due = { framework_id: string; role_title: string; version_label: string; review_date: string; session_id: string | null; owner: string | null; overdue: boolean };
const TYPE: Record<string, string> = { ROOT: 'khung gốc', DERIVED_LEVEL: 'phái sinh cấp bậc', INDUSTRY_VARIANT: 'biến thể ngành' };
const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 1000) / 10}%`);
const TIER: Record<string, string> = { INTERNAL: 'Nội bộ', MARKET: 'Sản phẩm thị trường', HR_DECISION: 'Quyết định nhân sự' };

/** P5: production catalogue, batch creation, dictionary quality, reviews due, operating metrics. */
export default function ProductionScreen() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [quality, setQuality] = useState<Quality>(null);
  const [due, setDue] = useState<Due[]>([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', role: '', purpose: 'Khung nội bộ', policy: 'sop-c', owner: '', derived: 'Junior, Senior', variants: '' });
  const load = async () => {
    try {
      const [a, b, c] = await Promise.all([api<Item[]>('/production'), api<Quality>('/dictionary/quality'), api<Due[]>('/reviews/due?days=60')]);
      setItems(a);
      setQuality(b);
      setDue(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => void load(), []);
  const create = async () => {
    setErr('');
    const list = (x: string) => x.split(',').map((y) => y.trim()).filter(Boolean);
    try {
      await api('/production/batches', { method: 'POST', json: { name: form.name || form.role, purpose: form.purpose, charter: { policy_id: form.policy, owner: form.owner || undefined }, items: [{ role_title: form.role, framework_type: 'ROOT' }, ...list(form.derived).map((level) => ({ role_title: form.role, level, framework_type: 'DERIVED_LEVEL', root_index: 0 })), ...list(form.variants).map((industry) => ({ role_title: form.role, industry, framework_type: 'INDUSTRY_VARIANT', root_index: 0 }))] } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <WorkspaceShell active="production" title="Sản xuất hàng loạt" note="Lô khung gốc và phái sinh, chất lượng từ điển chung, khung đến hạn rà soát và chỉ số vận hành của cả workspace.">
      <div id="production">
        {err ? <div className="cl-err">{err}</div> : null}

        <div className="lv-card" style={{ marginTop: 0 }}>
          <h4>Tạo lô: một khung gốc và các phái sinh</h4>
          <div className="cl-row">
            <label className="cl-field" style={{ flex: 2 }}>Vị trí<input id="pb-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="ví dụ: Product Owner" /></label>
            <label className="cl-field" style={{ flex: 2 }}>Phái sinh theo cấp bậc (phẩy)<input value={form.derived} onChange={(e) => setForm({ ...form, derived: e.target.value })} /></label>
            <label className="cl-field" style={{ flex: 2 }}>Biến thể ngành (phẩy)<input value={form.variants} onChange={(e) => setForm({ ...form, variants: e.target.value })} placeholder="ví dụ: Ngân hàng" /></label>
          </div>
          <div className="cl-row">
            <label className="cl-field" style={{ flex: 1 }}>Bộ ngưỡng
              <select value={form.policy} onChange={(e) => setForm({ ...form, policy: e.target.value })}>
                <option value="sop-c">SOP mức C</option>
                <option value="sop-b">SOP mức B</option>
                <option value="sop-a">SOP mức A</option>
                <option value="dev-small">Phát triển</option>
              </select>
            </label>
            <label className="cl-field" style={{ flex: 1 }}>Người phụ trách<input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
            <label className="cl-field" style={{ flex: 2 }}>Mục đích<input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
          </div>
          <button id="pb-create" className="lv-btn pri" disabled={!form.role.trim()} onClick={() => void create()}>
            Tạo lô
          </button>
          <p className="lv-muted" style={{ fontSize: 12 }}>Phái sinh kế thừa charter và năng lực của khung gốc; không gọi AI cho phần kế thừa. Thẩm định E8 đủ khung gốc và ít nhất 1/5 khung phái sinh chọn ngẫu nhiên; một khung trượt thẩm định thì cả lô được thẩm định.</p>
        </div>

        <div className="lv-card">
          <h4>Danh mục và chỉ số vận hành</h4>
          {!items ? <div className="lv-empty">Đang tải…</div> : !items.length ? <div className="lv-empty">Chưa có lô nào.</div> : (
            <div className="lv-scroll">
              <table className="lv-table" data-testid="production-table">
                <thead>
                  <tr><th>Khung</th><th>Loại</th><th>Lượt</th><th className="n">Bước xong</th><th className="n">Chu kỳ</th><th className="n">Dùng lại từ điển</th><th className="n">Trùng khung gốc</th><th className="n">Chỉ báo đạt lần đầu</th><th className="n">Cổng qua lần đầu</th><th className="n">Phiếu sai lệch</th><th className="n">Token</th><th>Tầng</th><th>Thẩm định</th></tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <tr key={x.id}>
                      <td>{x.session_id ? <Link href={`/s/${x.session_id}/inputs`}>{x.role_title}{x.level ? ` · ${x.level}` : ''}{x.industry ? ` · ${x.industry}` : ''}</Link> : x.role_title}</td>
                      <td>{TYPE[x.framework_type] ?? x.framework_type}</td>
                      <td>{x.run_no ?? '—'}</td>
                      <td className="n">{x.steps_done ?? 0}/9</td>
                      <td className="n">{x.cycle_ms ? `${Math.round(x.cycle_ms / 60000)} phút` : '—'}</td>
                      <td className="n">{pct(x.reuse_rate)}</td>
                      <td className="n" style={{ color: x.overlap_with_root != null && x.overlap_with_root < 0.6 ? 'var(--orange)' : undefined }} title={x.overlap_with_root != null && x.overlap_with_root < 0.6 ? 'Dưới 0,60: nên làm khung gốc mới (43)' : undefined}>{pct(x.overlap_with_root)}</td>
                      <td className="n">{pct(x.g6_first_pass)}</td>
                      <td className="n">{x.gates_first_pass ?? '—'}</td>
                      <td className="n">{x.deviations ?? '—'}</td>
                      <td className="n">{x.tokens ? x.tokens.toLocaleString('vi-VN') : '—'}</td>
                      <td>{x.tier ? TIER[x.tier] : '—'}</td>
                      <td>{x.framework_type === 'ROOT' ? 'đủ' : x.audit_sampled ? 'trong mẫu' : 'ngoài mẫu'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lv-g3" style={{ marginTop: 14 }}>
          <div className="lv-card" style={{ marginTop: 0 }} data-testid="quality">
            <h4>Chất lượng từ điển {quality ? `· bản ${quality.version}` : ''}</h4>
            {!quality ? <div className="lv-empty">Chưa có bản phát hành.</div> : (
              <>
                {[['Phân biệt', quality.distinct.score], ['Bao phủ', quality.coverage.score], ['Rõ và đo được', quality.clear.score], ['Có căn cứ', quality.evidenced.score], ['Ổn định', quality.stable.score]].map(([k, v]) => (
                  <div className="lv-hbar" key={k as string}>
                    <span>{k}</span>
                    <div className="tr"><i style={{ width: `${((v as number | null) ?? 0) * 100}%` }} /></div>
                    <span className="v">{pct(v as number | null)}</span>
                  </div>
                ))}
                {quality.distinct.near_pairs.length ? <p className="lv-muted" style={{ fontSize: 12 }}>Cặp gần nghĩa: {quality.distinct.near_pairs.slice(0, 5).map((p) => `${p.a} ~ ${p.b} (${p.similarity})`).join('; ')}</p> : null}
                {quality.coverage.unused.length ? <p className="lv-muted" style={{ fontSize: 12 }}>Chưa khung nào dùng: {quality.coverage.unused.slice(0, 8).join(', ')}</p> : null}
              </>
            )}
          </div>
          <div className="lv-card" style={{ marginTop: 0 }} data-testid="reviews-due">
            <h4>Khung đến hạn rà soát (60 ngày)</h4>
            {!due.length ? <div className="lv-empty">Không có khung nào đến hạn.</div> : (
              <table className="lv-table">
                <tbody>
                  {due.map((d) => (
                    <tr key={d.framework_id}>
                      <td>{d.role_title} {d.version_label}</td>
                      <td className={d.overdue ? 'cl-err' : ''}>{d.review_date}</td>
                      <td>{d.owner ?? '—'}</td>
                      <td>{d.session_id ? <Link href={`/s/${d.session_id}/inputs`}>Rà soát →</Link> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
