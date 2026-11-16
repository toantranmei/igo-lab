'use client';

import type { CSSProperties } from 'react';
import type { CatalogApi, CatProfile } from '@cl/example';
import { hasFormula, pct, type CatPick } from './model';

interface Props {
  catalog: CatalogApi;
  ps: CatProfile[];
  group: string;
  pick: CatPick;
  onCell(cid: string, industry: string): void;
}

export default function Matrix({ catalog, ps, group, pick, onCell }: Props) {
  const columns = catalog.industries.filter((i) => ps.some((p) => p.industry === i.id));
  const rows = catalog.competencies.filter((c) => (group === 'all' || c.group === group) && ps.some((p) => p.requirements.some((q) => q.id === c.id)));

  if (!columns.length || !rows.length) {
    return <p className="muted-box catalog-empty">Không có ô nào để hiển thị: bộ lọc hiện tại không chứa khung gắn ngành cụ thể.</p>;
  }

  return (
    <div className="catalog-matrix" data-row-count={rows.length} data-col-count={columns.length}>
      <div className="matrix-caption">Ô màu thể hiện trọng số ưu tiên trung bình (tính cả 0) theo ngành; bấm ô để thấy các khung tạo ra con số. Lọc nhóm không chuẩn hóa lại trọng số.</div>
      <div className="table-wrap scroll-x">
        <table className="industry-matrix">
          <thead>
            <tr>
              <th scope="col">NĂNG LỰC CHUNG</th>
              {columns.map((i) => (
                <th key={i.id} scope="col">
                  {i.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const sm = catalog.summaries(ps, c.id);
              return (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    <small>
                      {c.group} · {c.id}
                    </small>
                  </td>
                  {columns.map((i) => {
                    const x = sm.sectors.find((s) => s.industry.id === i.id);
                    const configured = ps.every((p) => {
                      if (p.industry !== i.id) return true;
                      const q = p.requirements.find((r) => r.id === c.id);
                      return !q || hasFormula(q);
                    });
                    const weight = configured ? x?.weight || 0 : 0;
                    const chosen = pick.type === 'cell' && pick.cid === c.id && pick.industry === i.id;
                    const text = configured ? pct(weight) : '—';
                    return (
                      <td key={i.id}>
                        <button
                          type="button"
                          data-cell={`${c.id}|${i.id}`}
                          aria-pressed={chosen}
                          aria-label={`${c.name} × ${i.name}: ${text}, ${x?.count || 0}/${x?.total || 0} khung có yêu cầu`}
                          style={{ '--intensity': Math.min(0.85, weight * 4 + 0.05) } as CSSProperties}
                          onClick={() => onCell(c.id, i.id)}
                        >
                          <b>{text}</b>
                          <small>
                            {x?.count || 0}/{x?.total || 0} khung có yêu cầu
                          </small>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
