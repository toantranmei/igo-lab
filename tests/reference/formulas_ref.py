#!/usr/bin/env python3
"""Reference implementation ("đáp án tính tay") of formulas (1)–(37).

Derived ONLY from the documents, never from the TypeScript code:

  WP   = docs/whitepaper/competence-lab-whitepaper.docx (same content as the
         .pdf; the numbered formulas (1)–(47) exist only in the docx/pdf).
         "WP ¶N" = paragraph N (1-based) of word/document.xml, as printed by
         `python3 -I tests/reference/formulas_ref.py --dump-whitepaper`.
  WPmd = docs/whitepaper/competence-lab-whitepaper.md (older status audit,
         no formula numbers; cited as "WPmd L<line>").
  SPEC = docs/specs/competence-lab-upgrade-spec.md ("SPEC L<line>").

Usage:
  python3 -I tests/reference/formulas_ref.py > tests/reference/golden.json
  python3 -I tests/reference/formulas_ref.py --dump-whitepaper

Stdlib only. Values that a document leaves undefined (0/0 etc.) are returned
as None (JSON null). Floats in golden.json are rounded to 6 decimals; the
acceptance tolerance is 0.01 (SPEC L331).
"""

import calendar
import datetime
from fractions import Fraction
import hashlib
import html
import json
import math
import os
import re
import sys
import zipfile

LEVEL_ORDER = {"A": 3, "B": 2, "C": 1}  # A đầy đủ > B tiết kiệm > C bàn giấy


def _canon(obj):
    """Canonical JSON used for hashing (our choice; the documents do not fix one)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------- B0 ----

def f01_snapshot_hash(jds, base_dictionary, thresholds, ai_config):
    """(1) H = SHA-256(bộ JD, từ điển nền, bộ ngưỡng, cấu hình AI)   — WP ¶64; WPmd L113.

    Serialisation is NOT defined by the documents. Reference choice: SHA-256 hex of
    the UTF-8 canonical JSON (sorted keys, no spaces) of the 4-element array in the
    order written in the formula. Only structural properties (deterministic; one
    changed character changes H) are portable to the implementation.
    """
    payload = _canon([jds, base_dictionary, thresholds, ai_config]).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


SPEC_G0_REQUIRED = ["vi_tri", "nganh", "cap_bac", "muc_dich", "muc_chat_che", "loai_khung"]


def f02_gate_g0(charter, sealed_hash, recomputed_hash, step_pairs):
    """(2) G0 = (đủ trường bắt buộc) ∧ (H khớp) ∧ (agent làm ≠ agent kiểm ở mọi bước)  — WP ¶83–84.

    "Điều kiện thứ ba được kiểm trên cấu hình: ở mỗi bước, agent kiểm chéo phải dùng
    model khác agent làm" (WP ¶84). Required fields taken from SPEC L251 (vị trí, ngành,
    cấp bậc, mục đích, mức chặt chẽ, loại khung). A field counts as present when it is
    not None and not an empty/whitespace string.
    step_pairs: list of {"step", "maker_model", "checker_model"}.
    """
    fields_ok = all(
        charter.get(k) is not None and str(charter.get(k)).strip() != "" for k in SPEC_G0_REQUIRED
    )
    hash_ok = sealed_hash == recomputed_hash
    indep_ok = all(p["maker_model"] != p["checker_model"] for p in step_pairs)
    return {"fields_ok": fields_ok, "hash_ok": hash_ok, "independence_ok": indep_ok,
            "G0": fields_ok and hash_ok and indep_ok}


# ---------------------------------------------------------------- B1 ----

def f03_valid_jd(readable, not_duplicate, on_target):
    """(3) hợp lệ(j) = đọc được(j) ∧ không trùng(j) ∧ đúng vị trí(j)   — WP ¶90.

    "JD mà AI không chắc được đánh dấu riêng và không được đếm" (WP ¶88): an
    'uncertain' on-target verdict is passed as on_target=False.
    """
    return bool(readable) and bool(not_duplicate) and bool(on_target)


def f04_jaccard(a, b):
    """(4) J(A, B) = |A ∩ B| / |A ∪ B|   — WP ¶92–93; SPEC L168 (K1, ngưỡng 0,85).

    J(∅, ∅) = 0/0 is undefined in the documents → None.
    """
    a, b = set(a), set(b)
    union = a | b
    if not union:
        return None
    return len(a & b) / len(union)


def f04_is_near_duplicate(a, b, threshold=0.85):
    """K1 decision on top of (4). SPEC L168 says "ngưỡng ... 0,85"; WP ¶93 says
    "thường có J trên 0,85". Reference reading: duplicate ⇔ J ≥ 0,85 (threshold
    inclusive, like every other "ngưỡng" in the documents)."""
    j = f04_jaccard(a, b)
    return j is not None and j >= threshold


def f05_lens_L(A, C, D, E):
    """(5) L = 3A + 2C + D + E   — WP ¶95 ("tối đa 21 điểm"); WPmd L172."""
    return 3 * A + 2 * C + D + E


def f06_lens_M(A, B, C, D, E):
    """(6) M = 3B + 2C + D + E, "Chỉ tính khi A từ 2 trở lên"   — WP ¶97–98; WPmd L173.

    A < 2 → M is not computed → None.
    """
    if A < 2:
        return None
    return 3 * B + 2 * C + D + E


def f07_rank(L, M):
    """(7) hạng = P1 nếu max(L, M) ≥ 18; P2 nếu từ 13 đến 17; P3 nếu ≤ 12   — WP ¶99; WPmd L174.

    M = None (A < 2) → max over L only.
    """
    m = L if M is None else max(L, M)
    if m >= 18:
        return "P1"
    if m >= 13:
        return "P2"
    return "P3"


def f05_07_score_jd(A, B, C, D, E):
    L = f05_lens_L(A, C, D, E)
    M = f06_lens_M(A, B, C, D, E)
    return {"L": L, "M": M, "rank": f07_rank(L, M)}


def f08_gate_g1(n_full, n_p1):
    """(8) N_đầy đủ ≥ 15 ∧ N_P1 ≥ 5   — WP ¶101; SPEC L252, L332.

    (Derived / industry-variant frames additionally need ≥ 10 JD of their own level
    or industry, WP ¶102 — not part of the formula, not covered here.)
    """
    return n_full >= 15 and n_p1 >= 5


# ---------------------------------------------------------------- B2 ----

def f09_rescale(x):
    """(9) s = 1 + x/100 × 4   — WP ¶108 ("x = 75 cho s = 4,0"); WPmd L199."""
    return 1 + x / 100 * 4


# ---------------------------------------------------------------- B3 ----

def trigrams(text):
    """Character 3-grams of a lower-cased string (no padding). Tokenisation is NOT
    specified by the documents (case, diacritics, padding, punctuation)."""
    t = " ".join(text.lower().split())
    return {t[i:i + 3] for i in range(len(t) - 2)} if len(t) >= 3 else ({t} if t else set())


def words(text):
    return set(re.findall(r"\w+", text.lower()))


def f10_similarity(j_name, j_def):
    """(10) điểm = max(J_tên, 0,7 × J_định nghĩa)   — WP ¶115–116.

    "Năng lực có điểm từ 0,3 trở lên được đưa ra làm phương án dùng lại, tối đa ba
    phương án" (WP ¶116).
    """
    return max(j_name, 0.7 * j_def)


def f10_similarity_text(cand_name, cand_def, comp_names, comp_def):
    """(10) from text. Reading of "J tên ... trên các cụm ba ký tự của tên và các tên
    đồng nghĩa": ONE trigram set = union over the dictionary competency's name and all
    synonyms, compared with the candidate-name trigram set. J định nghĩa = Jaccard of
    word sets."""
    dict_tri = set()
    for n in comp_names:
        dict_tri |= trigrams(n)
    jn = f04_jaccard(trigrams(cand_name), dict_tri) or 0.0
    jd = f04_jaccard(words(cand_def), words(comp_def)) or 0.0
    return {"J_name": jn, "J_def": jd, "score": f10_similarity(jn, jd)}


def f10_reuse_options(scores, threshold=0.3, k=3):
    """Top-k (k=3) dictionary competencies with score ≥ 0,3, highest first; ties by id."""
    ok = [(cid, s) for cid, s in scores.items() if s >= threshold]
    ok.sort(key=lambda x: (-x[1], x[0]))
    return [cid for cid, _ in ok[:k]]


def f11_task_weight(n_t, N):
    """(11) w_t = n_t / N   — WP ¶118–119 (n = số JD hợp lệ nêu t; N = tổng số JD hợp lệ).
    N = 0 → None."""
    if N == 0:
        return None
    return n_t / N


SOURCE_OMEGA = {"P1": 3, "P2": 2, "P3": 1, "EXT": 3}


def f12_evidence_weight(supporting_sources):
    """(12) E(c) = Σ_{q ủng hộ c} ω_q, ω: P1=3, P2=2, P3=1, nguồn chuẩn ngoài=3
    — WP ¶121–122; WPmd L220–221.  One term per supporting SENTENCE q (two sentences
    from the same JD count twice). 'EXT' = nguồn chuẩn ngoài."""
    return sum(SOURCE_OMEGA[s] for s in supporting_sources)


def f13_market_score(E_by_candidate):
    """(13) S(c) = E(c) / max_k E(k)   — WP ¶123–124 (k over the frame's candidates).
    max = 0 (or no candidates) → None for every c."""
    mx = max(E_by_candidate.values()) if E_by_candidate else 0
    return {c: (None if mx == 0 else e / mx) for c, e in E_by_candidate.items()}


def f14_library_coverage(n_coded_existing, n_sentences):
    """(14) bao phủ = số câu mã hóa được vào phần tử có sẵn / tổng số câu yêu cầu — WP ¶126.
    0 sentences → None."""
    if n_sentences == 0:
        return None
    return n_coded_existing / n_sentences


def f15_cohen_kappa(codes1, codes2):
    """(15) κ = (p_o − p_e) / (1 − p_e)   — WP ¶129–130; G3: κ ≥ 0,61 (WP ¶133; SPEC L254).

    p_o = share of sentences with identical codes; p_e = Σ_k p1(k)·p2(k) from each
    coder's code frequencies. p_e = 1 → None (0/0 or x/0).
    """
    assert len(codes1) == len(codes2) and codes1
    n = len(codes1)
    po = sum(1 for a, b in zip(codes1, codes2) if a == b) / n
    cats = set(codes1) | set(codes2)
    pe = sum((codes1.count(k) / n) * (codes2.count(k) / n) for k in cats)
    kappa = None if pe == 1 else (po - pe) / (1 - pe)
    return {"p_o": po, "p_e": pe, "kappa": kappa,
            "G3": (kappa is not None and kappa >= 0.61)}


def f16_prf(correct, extra, missed):
    """(16) P = đúng/(đúng+thừa); R = đúng/(đúng+sót); F1 = 2PR/(P+R)   — WP ¶132; SPEC L230.
    Any 0 denominator → None for that value."""
    P = None if correct + extra == 0 else correct / (correct + extra)
    R = None if correct + missed == 0 else correct / (correct + missed)
    if P is None or R is None or P + R == 0:
        F1 = None
    else:
        F1 = 2 * P * R / (P + R)
    return {"P": P, "R": R, "F1": F1}


# ---------------------------------------------------------------- B4 ----

def f17_sample_level_A(n_excellent, n_average, events_per_person, kappa):
    """(17) Mức A: số người xuất sắc ≥ 6 ∧ số người trung bình ≥ 3 ∧ mỗi người ≥ 4 sự
    kiện ∧ κ ≥ 0,61   — WP ¶141–142; WPmd L254. kappa None → False."""
    return (n_excellent >= 6 and n_average >= 3
            and len(events_per_person) > 0 and all(e >= 4 for e in events_per_person)
            and kappa is not None and kappa >= 0.61)


def f18_sample_level_B(n_people, n_events):
    """(18) Mức B: số người ≥ 3 ∧ số sự kiện ≥ 6   — WP ¶143.
    (WPmd L254 adds an alternative "hoặc BEI ≥ 3 người" not present in WP (18).)"""
    return n_people >= 3 and n_events >= 6


def f17_18_gate_g4(level, **kw):
    """G4 by level (WP ¶148): A → (17), B → (18), C → 'không áp dụng'."""
    if level == "C":
        return "na"
    if level == "A":
        return f17_sample_level_A(**kw)
    return f18_sample_level_B(**kw)


def f19_delta(n_exc_with, n_exc, n_avg_with, n_avg):
    """(19) Δ = f_xuất sắc − f_trung bình; f = tỷ lệ người trong nhóm có sự kiện mang
    chủ đề   — WP ¶145–146.  Empty group → None.

    Classification (no numeric cut-off in the documents; literal reading of
    "chỉ nổi ở nhóm xuất sắc / có ở cả hai nhóm / chỉ nổi ở nhóm trung bình"):
      f_exc>0 ∧ f_avg=0 → "tao_khac_biet"; both > 0 → "nguong";
      f_exc=0 ∧ f_avg>0 → "can_tranh"; both 0 → None.
    """
    if n_exc == 0 or n_avg == 0:
        return {"f_exc": None, "f_avg": None, "delta": None, "class": None}
    fe, fa = n_exc_with / n_exc, n_avg_with / n_avg
    if fe > 0 and fa == 0:
        cls = "tao_khac_biet"
    elif fe > 0 and fa > 0:
        cls = "nguong"
    elif fa > 0:
        cls = "can_tranh"
    else:
        cls = None
    return {"f_exc": fe, "f_avg": fa, "delta": fe - fa, "class": cls}


# ---------------------------------------------------------------- B5 ----

def sample_variance(xs):
    n = len(xs)
    if n < 2:
        return None
    m = sum(xs) / n
    return sum((x - m) ** 2 for x in xs) / (n - 1)


def f20_rwg(ratings):
    """(20) r_wg = max(0, 1 − s²/2)   — WP ¶153–154; SPEC L287–288, L293.

    s² = SAMPLE variance (n − 1), per SPEC L287 "phương sai mẫu s²" and the worked
    example 4,4,5 → s² = 0,33, r_wg = 0,83; 5,4,2 → s² = 2,33, r_wg = 0 (SPEC L293).
    Blank ratings (None) are dropped; < 2 ratings → None.
    """
    xs = [x for x in ratings if x is not None]
    s2 = sample_variance(xs)
    if s2 is None:
        return {"mean": (xs[0] if xs else None), "s2": None, "rwg": None}
    return {"mean": sum(xs) / len(xs), "s2": s2, "rwg": max(0.0, 1 - s2 / 2)}


def f21_keep_AB(mean_importance, mean_discrimination, rwg):
    """(21) Mức A, B: giữ ⇔ x̄_quan trọng ≥ 3,5 ∧ x̄_phân biệt ≥ 3,0 ∧ r_wg ≥ 0,70
    — WP ¶156; WPmd L276; SPEC L289. Compared on unrounded values. rwg None → False."""
    return (mean_importance >= 3.5 and mean_discrimination >= 3.0
            and rwg is not None and rwg >= 0.70)


def f21_keep_from_seats(importance, discrimination):
    imp = f20_rwg(importance)
    disc = [x for x in discrimination if x is not None]
    md = sum(disc) / len(disc)
    return {"mean_importance": imp["mean"], "mean_discrimination": md,
            "s2": imp["s2"], "rwg": imp["rwg"],
            "keep": f21_keep_AB(imp["mean"], md, imp["rwg"])}


def f22_keep_C(S_c, s_ext):
    """(22) Mức C: giữ ⇔ S(c) ≥ 0,60 ∨ s ≥ 3,5   — WP ¶157–158; WPmd L277.
    s = external importance from (9); missing (None) → that disjunct is False."""
    return (S_c is not None and S_c >= 0.60) or (s_ext is not None and s_ext >= 3.5)


def f23_core_limits(n_core, n_meta):
    """(23) 8 ≤ n_lõi ≤ 14 ∧ n_meta ≤ 1   — WP ¶160; WPmd L69/L280; SPEC L290.
    n_core counts layers I–III only (WPmd L69 "8–14 năng lực ở lớp I–III và tối đa 1
    meta"); the meta competency is NOT inside the 8–14."""
    return 8 <= n_core <= 14 and n_meta <= 1


def f23_trim_to_14(kept):
    """SPEC L290: "nếu nhiều hơn 14 thì xếp theo x̄_quan trọng rồi điểm thị trường S(c)".
    kept: list of {"id", "mean_importance", "S"}; sort desc by mean, then desc by S,
    then id asc (final tiebreak is ours); take 14."""
    order = sorted(kept, key=lambda c: (-c["mean_importance"], -c["S"], c["id"]))
    return [c["id"] for c in order[:14]]


def f24_task_coverage(weights, task_to_comps, selected):
    """(24) độ phủ = Σ_t w_t·1(t có ≥ 1 năng lực được chọn) / Σ_t w_t   — WP ¶162–163.
    "Ngưỡng cảnh báo là 0,8" → warn ⇔ coverage < 0,8.  Σ w = 0 → None.
    Exact decimal arithmetic (Fraction of the decimal string): in binary floats
    (1 + 0.8 + 0.6) / 3.0 = 0.7999999999999999 < 0.8 would wrongly warn.
    """
    sel = set(selected)
    W = {t: Fraction(str(w)) for t, w in weights.items()}
    tot = sum(W.values())
    if tot == 0:
        return {"coverage": None, "warn": None}
    cov = sum(w for t, w in W.items() if sel & set(task_to_comps.get(t, []))) / tot
    return {"coverage": float(cov), "warn": cov < Fraction(8, 10)}


def f25_leave_one_out(weights, task_to_comps, selected):
    """(25) độ phủ_−c = Σ_t w_t·1(t còn năng lực khác c) / Σ_t w_t   — WP ¶165–166.
    Returns {c: coverage without c} for each selected c."""
    out = {}
    for c in selected:
        rest = [x for x in selected if x != c]
        out[c] = f24_task_coverage(weights, task_to_comps, rest)["coverage"]
    return out


def f26_level(votes):
    """(26) bậc = trung vị(các phiếu hợp lệ), cần ít nhất 2 phiếu   — WP ¶168; SPEC L256, L291.
    Blank votes (None) are not valid. < 2 valid → None. Even count → mean of the two
    middle values rounded UP (SPEC L291 "lấy trung vị của hai ghế còn lại và làm tròn
    lên"); result is an integer 1–5."""
    xs = sorted(v for v in votes if v is not None)
    n = len(xs)
    if n < 2:
        return None
    if n % 2:
        return xs[n // 2]
    return math.ceil((xs[n // 2 - 1] + xs[n // 2]) / 2)


# ---------------------------------------------------------------- B6 ----

def f27_retranslation(answer, votes):
    """(27) p_i = số agent xếp đúng cả năng lực và bậc / số agent nhận phiếu ≥ 0,70
    — WP ¶175–176; SPEC L297, L300, L334. Blank (None) stays in the denominator.
    answer/vote = [competency_id, level]."""
    n = len(votes)
    ok = sum(1 for v in votes if v is not None and v[0] == answer[0] and v[1] == answer[1])
    p = ok / n if n else None
    return {"p": p, "pass": p is not None and p >= 0.70}


def f28_fleiss_kappa(ratings, categories=("I", "II", "III", "Meta")):
    """(28) Fleiss' κ = (P̄ − P̄_e)/(1 − P̄_e) ≥ 0,61   — WP ¶178–179; SPEC L298.

    P_i = (Σ_j n_ij² − n)/(n(n − 1)); P̄ = mean P_i; p_j = Σ_i n_ij /(N·n);
    P̄_e = Σ_j p_j². ratings: list (one per competency) of the n seat labels.
    Every item must have the same n (n = 3 in SPEC). P̄_e = 1 → κ None.
    """
    n = len(ratings[0])
    assert all(len(r) == n for r in ratings) and n >= 2
    N = len(ratings)
    Pi = []
    totals = {c: 0 for c in categories}
    for r in ratings:
        counts = {c: r.count(c) for c in categories}
        for c in categories:
            totals[c] += counts[c]
        Pi.append((sum(v * v for v in counts.values()) - n) / (n * (n - 1)))
    Pbar = sum(Pi) / N
    pj = {c: totals[c] / (N * n) for c in categories}
    Pe = sum(v * v for v in pj.values())
    kappa = None if Pe == 1 else (Pbar - Pe) / (1 - Pe)
    return {"P_i": Pi, "P_bar": Pbar, "p_j": pj, "P_e": Pe, "kappa": kappa,
            "pass": kappa is not None and kappa >= 0.61}


def f28_low_agreement(assigned, ratings):
    """SPEC L298: "Năng lực có dưới 2/3 số ghế đồng ý lớp đã gán thì ghi vào hồ sơ".
    Returns indices i where (#seats choosing assigned[i]) / n < 2/3."""
    return [i for i, (a, r) in enumerate(zip(assigned, ratings))
            if r.count(a) * 3 < 2 * len(r)]


def f29_indicator_counts(counts):
    """(29) 2 ≤ số chỉ báo của mỗi (năng lực, bậc) ≤ 4, với bậc ∈ {1, 3, 5}   — WP ¶181;
    WPmd L296. counts: {level(str): n} for ONE competency; a missing level = 0."""
    return all(2 <= counts.get(str(l), 0) <= 4 for l in (1, 3, 5))


def f30_outcome_matrix(core, outcomes, links):
    """(30) mỗi năng lực lõi gắn ≥ 1 kết quả ∧ mỗi kết quả có ≥ 2 năng lực   — WP ¶182–183;
    WPmd L296 (R2). links: list of [competency, outcome]. The "3 đến 5 kết quả chính"
    sentence (WP ¶182) is reported separately as outcomes_count_ok, NOT part of (30)."""
    cset = set(core)
    comp_ok = all(any(c == lc for lc, _ in links) for c in core)
    out_ok = all(len({lc for lc, lo in links if lo == o and lc in cset}) >= 2 for o in outcomes)
    return {"constraint_30": comp_ok and out_ok, "outcomes_count_ok": 3 <= len(outcomes) <= 5}


# ---------------------------------------------------------------- B7 ----

def f31_validator_independent(validator, extractor, author, scorer, model_by_agent=None):
    """(31) agent thẩm định ∉ {agent trích, agent soạn, agent chấm}   — WP ¶190; SPEC L258, L536.
    Compared on agent identity. SPEC L536: same MODEL as a step (E8 Sonnet vs E6
    Sonnet) is not a failure but "đạt có lưu ý" → reported as same_model_warning."""
    ok = validator not in {extractor, author, scorer}
    warn = False
    if model_by_agent:
        vm = model_by_agent.get(validator)
        warn = any(model_by_agent.get(a) == vm for a in (extractor, author, scorer))
    return {"independent": ok, "same_model_warning": ok and warn}


def f32_sample_size(n_sentences):
    """(32) n_mẫu = ⌈0,10 × N_câu⌉   — WP ¶192–193; SPEC L258. Computed exactly as
    ⌈N/10⌉ (integer arithmetic) — naive float 0.1*30 = 3.0000000000000004 would give 4."""
    return -(-n_sentences // 10)


G7_OK = {"dat", "dat_co_dieu_kien_kem_ke_hoach"}


def f33_gate_g7(variables):
    """(33) G7 ⇔ cả 10 biến ∈ {đạt, đạt có điều kiện kèm kế hoạch xử lý}   — WP ¶195; WPmd L323.
    variables: list of status strings; exactly 10 required.
    'dat_co_dieu_kien' (without plan) is NOT in the set."""
    return len(variables) == 10 and all(v in G7_OK for v in variables)


# ---------------------------------------------------------------- B8 ----

def f34_market_product(level, gates):
    """(34) Sản phẩm thị trường ⇔ mức ≥ B ∧ G6, G7 đạt bằng dữ liệu ∧ không cổng nào trong
    G1, G3–G7 qua bằng phiếu sai lệch   — WP ¶201–202; WPmd L346–347; SPEC L308.
    gate status ∈ {"data", "deviation", "na", "fail"}. Literal: G2 and G8 are not
    examined; a 'na' gate in G1, G3–G5 does not block."""
    return (LEVEL_ORDER[level] >= LEVEL_ORDER["B"]
            and gates.get("G6") == "data" and gates.get("G7") == "data"
            and all(gates.get(g) != "deviation" for g in ("G1", "G3", "G4", "G5", "G6", "G7")))


def f35_tier(level, gates, g11, g12):
    """(35) Quyết định nhân sự ⇔ mức = A ∧ điều kiện tầng Sản phẩm ∧ G11 ∧ G12;
    "Các trường hợp còn lại là tầng Nội bộ"   — WP ¶203–204; WPmd L345–348."""
    mp = f34_market_product(level, gates)
    if level == "A" and mp and g11 and g12:
        return "quyet_dinh_nhan_su"
    if mp:
        return "san_pham_thi_truong"
    return "noi_bo"


def add_months(d, months):
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    return datetime.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def f36_review_date(release_date, tech_family):
    """(36) ngày rà soát = ngày phát hành + 12 tháng (họ nghề công nghệ, dữ liệu, AI);
    + 24 tháng (họ nghề khác)   — WP ¶206–207; WPmd L340.
    Calendar months; day clamped to the month's last day (29/02 + 12 → 28/02)."""
    d = datetime.date.fromisoformat(release_date)
    return add_months(d, 12 if tech_family else 24).isoformat()


def f37_chain(events, genesis=""):
    """(37) h_k = SHA-256(h_{k−1} ‖ e_k)   — WP ¶209–210; WPmd L124; SPEC L73.
    Reference choice (not fixed by the documents): h as lowercase hex text,
    ‖ = plain string concatenation, e_k = canonical JSON, h_0 = "" (genesis)."""
    hs, prev = [], genesis
    for e in events:
        prev = hashlib.sha256((prev + _canon(e)).encode("utf-8")).hexdigest()
        hs.append(prev)
    return hs


def f37_verify(events, hashes, genesis=""):
    """Index of the first event whose stored hash does not match (None = chain valid)."""
    prev = genesis
    for i, (e, h) in enumerate(zip(events, hashes)):
        exp = hashlib.sha256((prev + _canon(e)).encode("utf-8")).hexdigest()
        if exp != h:
            return i
        prev = h
    return None


# ------------------------------------------------------- golden cases ----

def _r(x):
    if isinstance(x, float):
        return round(x, 6)
    if isinstance(x, dict):
        return {k: _r(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_r(v) for v in x]
    return x


CASES = []


def case(n, name, inputs, expected, note=""):
    CASES.append({"formula": "(%d)" % n, "name": name, "inputs": inputs,
                  "expected": _r(expected), "note": note})


# Sample dataset: 5 JDs with criteria A–E (0–3).
JDS = {
    "J1": dict(A=3, B=3, C=3, D=3, E=3),
    "J2": dict(A=2, B=3, C=2, D=2, E=2),
    "J3": dict(A=1, B=3, C=3, D=3, E=3),
    "J4": dict(A=3, B=1, C=3, D=2, E=1),
    "J5": dict(A=2, B=2, C=1, D=0, E=1),
}


def build():
    # (1)
    snap = dict(jds=[{"id": "J1", "text": "Quản lý dự án phần mềm"}, {"id": "J2", "text": "PM"}],
                base_dictionary="dict@3.2.0",
                thresholds={"kappa": 0.61, "rwg": 0.70, "retranslation": 0.70},
                ai_config={"E1": "haiku-5.5", "E9": "opus-5.5"})
    h = f01_snapshot_hash(**snap)
    snap2 = json.loads(json.dumps(snap))
    snap2["jds"][1]["text"] = "PM."
    case(1, "snapshot hash, canonical JSON of [jds, base, thresholds, ai_config]", snap,
         {"sha256_hex": h, "length": len(h)},
         "Byte-exact match only if the implementation uses the same serialisation; otherwise compare structure (64 hex chars, deterministic).")
    case(1, "one character changed → H changes", {"a": snap, "b": snap2},
         {"equal": h == f01_snapshot_hash(**snap2)}, "Structural property from WP ¶65.")
    case(1, "same input twice → same H", {"a": snap, "b": snap},
         {"equal": True}, "Determinism.")

    # (2)
    charter = dict(vi_tri="Project Manager", nganh="CNTT", cap_bac="Senior", muc_dich="Tuyển dụng",
                   muc_chat_che="C", loai_khung="goc")
    pairs_ok = [{"step": "B3", "maker_model": "haiku", "checker_model": "opus"},
                {"step": "B6", "maker_model": "sonnet", "checker_model": "haiku"}]
    pairs_bad = [{"step": "B3", "maker_model": "sonnet", "checker_model": "sonnet"}]
    case(2, "all conditions hold", dict(charter=charter, sealed_hash=h, recomputed_hash=h, step_pairs=pairs_ok),
         f02_gate_g0(charter, h, h, pairs_ok))
    case(2, "checker same model as maker (SPEC L335)",
         dict(charter=charter, sealed_hash=h, recomputed_hash=h, step_pairs=pairs_bad),
         f02_gate_g0(charter, h, h, pairs_bad), "Acceptance P2 #5: G0 must block.")
    ch2 = dict(charter, nganh="  ")
    case(2, "missing field + hash mismatch", dict(charter=ch2, sealed_hash=h, recomputed_hash="0" * 64, step_pairs=pairs_ok),
         f02_gate_g0(ch2, h, "0" * 64, pairs_ok), "Whitespace-only field counts as missing.")

    # (3)
    case(3, "readable, unique, on target", dict(readable=True, not_duplicate=True, on_target=True), True)
    case(3, "near-duplicate", dict(readable=True, not_duplicate=False, on_target=True), False)
    case(3, "AI uncertain → not counted", dict(readable=True, not_duplicate=True, on_target=False), False,
         "WP ¶88: JD AI không chắc không được đếm.")

    # (4)
    A = ["quản lý", "dự án", "rủi ro", "ngân sách", "tiến độ", "báo cáo", "nhân sự"]
    B = ["quản lý", "dự án", "rủi ro", "ngân sách", "tiến độ", "báo cáo", "khách hàng"]
    case(4, "Jaccard 6/8", dict(A=A, B=B), {"J": f04_jaccard(A, B), "duplicate": f04_is_near_duplicate(A, B)})
    A2 = ["x%d" % i for i in range(17)] + ["a1", "a2", "a3"]
    B2 = ["x%d" % i for i in range(17)]
    case(4, "J exactly 0.85 (17/20) — boundary", dict(A=A2, B=B2),
         {"J": f04_jaccard(A2, B2), "duplicate": f04_is_near_duplicate(A2, B2)},
         "Ambiguity: ≥ 0,85 (reference) vs > 0,85 ('trên 0,85', WP ¶93).")
    case(4, "both empty", dict(A=[], B=[]), {"J": None, "duplicate": False}, "0/0 undefined → null.")
    case(4, "disjoint", dict(A=["a"], B=["b"]), {"J": 0.0, "duplicate": False})

    # (5)–(7)
    for jid in ("J1", "J2", "J3", "J4", "J5"):
        c = JDS[jid]
        r = f05_07_score_jd(**c)
        case(5, "L for %s" % jid, c, r["L"])
        case(6, "M for %s" % jid, c, r["M"], "null = A < 2, M not computed" if r["M"] is None else "")
        case(7, "rank for %s" % jid, c, r["rank"])
    case(7, "boundary max=13 → P2", dict(L=13, M=None), f07_rank(13, None))
    case(7, "boundary max=12 → P3", dict(L=12, M=11), f07_rank(12, 11))
    case(7, "boundary max=17 → P2", dict(L=10, M=17), f07_rank(10, 17))
    case(6, "A exactly 2 → M computed", dict(A=2, B=3, C=3, D=3, E=3), f06_lens_M(2, 3, 3, 3, 3))

    # (8)
    case(8, "14 JD, 6 P1 (SPEC L332)", dict(n_full=14, n_p1=6), f08_gate_g1(14, 6))
    case(8, "15 JD, 4 P1 (SPEC L332)", dict(n_full=15, n_p1=4), f08_gate_g1(15, 4))
    case(8, "15 JD, 5 P1 — boundary", dict(n_full=15, n_p1=5), f08_gate_g1(15, 5))
    ranks = [f05_07_score_jd(**JDS[j])["rank"] for j in JDS]
    case(8, "sample set of 5 JDs", dict(n_full=5, n_p1=ranks.count("P1")), f08_gate_g1(5, ranks.count("P1")),
         "ranks = %s" % ranks)

    # (9)
    for x in (75, 0, 100, 62.5):
        case(9, "x = %s" % x, dict(x=x), f09_rescale(x), "WP ¶109: 75 → 4,0" if x == 75 else "")

    # (10)
    case(10, "J_name dominates", dict(j_name=0.5, j_def=0.6), f10_similarity(0.5, 0.6))
    case(10, "0.7·J_def dominates", dict(j_name=0.2, j_def=0.5), f10_similarity(0.2, 0.5))
    txt = dict(cand_name="Quản lý rủi ro", cand_def="Nhận diện và kiểm soát rủi ro của dự án",
               comp_names=["Quản lý rủi ro dự án", "Kiểm soát rủi ro"],
               comp_def="Nhận diện, đánh giá và kiểm soát rủi ro dự án")
    case(10, "from text (trigram union of name+synonyms; word-set definition)", txt,
         f10_similarity_text(**txt), "Depends on tokenisation choices — see README ambiguity list.")
    sc = {"C1": 0.31, "C2": 0.30, "C3": 0.29, "C4": 0.8, "C5": 0.45}
    case(10, "reuse options: ≥ 0,3, max 3", dict(scores=sc), f10_reuse_options(sc),
         "0,30 is included (≥); C3 0,29 excluded; only top 3 kept.")

    # (11)
    for nt, N in ((5, 5), (4, 5), (3, 5), (0, 0)):
        case(11, "n_t=%d, N=%d" % (nt, N), dict(n_t=nt, N=N), f11_task_weight(nt, N),
             "N = 0 → null" if N == 0 else "")

    # (12)–(13)
    ev = {"C1": ["P1", "P1", "P2", "EXT"], "C2": ["P2", "P3", "P3"], "C3": ["P1", "P1", "P1", "P1", "P2"],
          "C4": []}
    E = {c: f12_evidence_weight(v) for c, v in ev.items()}
    for c in ev:
        case(12, "E(%s)" % c, dict(sources=ev[c]), E[c], "EXT = nguồn chuẩn ngoài (ω = 3)" if "EXT" in ev[c] else "")
    case(13, "S(c) over 4 candidates", dict(E=E), f13_market_score(E))
    case(13, "all E = 0", dict(E={"C1": 0, "C2": 0}), f13_market_score({"C1": 0, "C2": 0}), "max = 0 → null")

    # (14)
    case(14, "12 of 40 sentences", dict(n_coded_existing=12, n_sentences=40), f14_library_coverage(12, 40))
    case(14, "0 sentences", dict(n_coded_existing=0, n_sentences=0), None, "0/0 → null")

    # (15)
    c1 = ["T1", "T1", "T2", "T2", "T3", "T1", "T2", "T3", "T1", "T2"]
    c2 = ["T1", "T1", "T2", "T3", "T3", "T1", "T2", "T3", "T2", "T2"]
    case(15, "E1 vs E9 on 10 sentences", dict(coder1=c1, coder2=c2), f15_cohen_kappa(c1, c2))
    d1 = ["T1", "T1", "T2", "T2", "T1", "T2"]
    d2 = ["T1", "T2", "T2", "T1", "T2", "T1"]
    case(15, "below threshold (negative κ)", dict(coder1=d1, coder2=d2), f15_cohen_kappa(d1, d2))
    e1 = ["T1"] * 4
    case(15, "both coders use one code → p_e = 1", dict(coder1=e1, coder2=e1), f15_cohen_kappa(e1, e1),
         "κ undefined (0/0) → null; G3 false.")

    # (16)
    case(16, "8 correct, 2 extra, 4 missed", dict(correct=8, extra=2, missed=4), f16_prf(8, 2, 4))
    case(16, "nothing predicted", dict(correct=0, extra=0, missed=3), f16_prf(0, 0, 3), "P = 0/0 → null")
    case(16, "all wrong", dict(correct=0, extra=2, missed=3), f16_prf(0, 2, 3), "P = R = 0 → F1 = 0/0 → null")

    # (17)–(18)
    kA = dict(n_excellent=6, n_average=3, events_per_person=[4] * 9, kappa=0.61)
    case(17, "level A, all at boundary", kA, f17_sample_level_A(**kA))
    kA2 = dict(kA, events_per_person=[4] * 8 + [3])
    case(17, "one person has 3 events", kA2, f17_sample_level_A(**kA2))
    kA3 = dict(kA, kappa=None)
    case(17, "κ missing", kA3, f17_sample_level_A(**kA3))
    case(18, "3 people, 6 events", dict(n_people=3, n_events=6), f18_sample_level_B(3, 6))
    case(18, "3 people, 5 events", dict(n_people=3, n_events=5), f18_sample_level_B(3, 5))
    case(18, "level C → G4 not applicable", dict(level="C"), "na", "WP ¶148; SPEC L336")

    # (19)
    case(19, "only excellent", dict(n_exc_with=4, n_exc=6, n_avg_with=0, n_avg=3), f19_delta(4, 6, 0, 3))
    case(19, "both groups", dict(n_exc_with=6, n_exc=6, n_avg_with=2, n_avg=3), f19_delta(6, 6, 2, 3))
    case(19, "only average", dict(n_exc_with=0, n_exc=6, n_avg_with=1, n_avg=3), f19_delta(0, 6, 1, 3))
    case(19, "empty group", dict(n_exc_with=0, n_exc=0, n_avg_with=1, n_avg=3), f19_delta(0, 0, 1, 3))

    # (20)
    for rs, nt in (([4, 4, 5], "SPEC L293 worked example: 0,83"), ([5, 4, 2], "SPEC L293: rwg 0 → loại"),
                   ([3, 3, 3], ""), ([4, None, 5], "blank dropped, n = 2"), ([4, None, None], "< 2 ratings → null")):
        case(20, "ratings %s" % rs, dict(ratings=rs), f20_rwg(rs), nt)

    # (21)
    case(21, "seats imp 4,4,5 disc 3,3,4", dict(importance=[4, 4, 5], discrimination=[3, 3, 4]),
         f21_keep_from_seats([4, 4, 5], [3, 3, 4]))
    case(21, "seats imp 5,4,2 disc 4,4,4 (SPEC L333)", dict(importance=[5, 4, 2], discrimination=[4, 4, 4]),
         f21_keep_from_seats([5, 4, 2], [4, 4, 4]))
    case(21, "all three at boundary", dict(mean_importance=3.5, mean_discrimination=3.0, rwg=0.70),
         f21_keep_AB(3.5, 3.0, 0.70))
    case(21, "importance just below", dict(mean_importance=3.49, mean_discrimination=3.0, rwg=0.9),
         f21_keep_AB(3.49, 3.0, 0.9))

    # (22)
    case(22, "S ≥ 0,60", dict(S_c=0.60, s_ext=None), f22_keep_C(0.60, None))
    case(22, "S low, s = 3,5", dict(S_c=0.2, s_ext=3.5), f22_keep_C(0.2, 3.5))
    case(22, "both low", dict(S_c=0.59, s_ext=3.4), f22_keep_C(0.59, 3.4))

    # (23)
    for nc, nm in ((8, 1), (14, 0), (15, 0), (7, 1), (10, 2)):
        case(23, "n_core=%d, n_meta=%d" % (nc, nm), dict(n_core=nc, n_meta=nm), f23_core_limits(nc, nm),
             "SPEC L333: 15 core fails G5" if nc == 15 else "")
    kept = [{"id": "K%02d" % i, "mean_importance": 4.0 + (i % 3) / 3, "S": (i % 5) / 5} for i in range(16)]
    case(23, "trim 16 kept → 14 by mean importance then S(c)", dict(kept=kept), f23_trim_to_14(kept),
         "Final tiebreak by id is a reference choice.")

    # (24)–(25)
    W = {"t1": 1.0, "t2": 0.8, "t3": 0.6, "t4": 0.4, "t5": 0.2}  # = (11) with n = 5,4,3,2,1 and N = 5
    T2C = {"t1": ["C1", "C2"], "t2": ["C1"], "t3": ["C3"], "t4": ["C4"], "t5": []}
    for sel in (["C1", "C2", "C3", "C4"], ["C1", "C3"], ["C2"]):
        case(24, "selected %s" % sel, dict(weights=W, task_to_comps=T2C, selected=sel), f24_task_coverage(W, T2C, sel),
             "coverage exactly 0,8 → no warning (float trap: naive float gives 0.7999999999999999)" if sel == ["C1", "C3"] else "")
    case(24, "all weights 0", dict(weights={"t1": 0}, task_to_comps={}, selected=["C1"]),
         {"coverage": None, "warn": None})
    sel = ["C1", "C2", "C3", "C4"]
    case(25, "leave-one-out on 4 selected", dict(weights=W, task_to_comps=T2C, selected=sel), f25_leave_one_out(W, T2C, sel),
         "C2 removal leaves coverage unchanged (overlaps C1) → candidate for merge.")
    case(25, "single competency", dict(weights=W, task_to_comps=T2C, selected=["C1"]), f25_leave_one_out(W, T2C, ["C1"]))

    # (26)
    for v, nt in (([3, 4, 4], ""), ([2, 3, 5], ""), ([3, None, 4], "2 votes, 3,5 → round up 4 (SPEC L291)"),
                  ([None, None, 4], "< 2 votes → null"), ([2, 3, 4, 5], "even n (with survey) → 3,5 → 4")):
        case(26, "votes %s" % v, dict(votes=v), f26_level(v), nt)

    # (27)
    ans = ["C1", 3]
    for votes, nt in (([["C1", 1], ["C1", 3], ["C1", 5]], "SPEC L300: 1/3"),
                      ([["C1", 3], None, None], "SPEC L334: 1 correct + 2 blank = 0,33, fails"),
                      ([["C1", 3], ["C1", 3], ["C2", 3]], "2/3 = 0,667 < 0,70 → fails"),
                      ([["C1", 3]] * 3, "SPEC L300: 1,00"),
                      ([["C1", 3]] * 7 + [["C1", 1]] * 3, "10 raters, 7/10 = 0,70 boundary → pass")):
        case(27, "votes %s" % votes, dict(answer=ans, votes=votes), f27_retranslation(ans, votes), nt)

    # (28)
    R = [["I", "I", "I"], ["II", "II", "III"], ["III", "III", "III"], ["I", "II", "I"], ["Meta", "Meta", "III"]]
    case(28, "5 competencies × 3 seats", dict(ratings=R), f28_fleiss_kappa(R))
    R2 = [["I", "I", "I"], ["II", "II", "II"], ["III", "III", "III"], ["I", "I", "II"], ["Meta", "Meta", "Meta"]]
    case(28, "near-unanimous", dict(ratings=R2), f28_fleiss_kappa(R2))
    R3 = [["II", "II", "II"]] * 3
    case(28, "everyone picks one class → P̄_e = 1", dict(ratings=R3), f28_fleiss_kappa(R3), "κ = 0/0 → null")
    asg = ["I", "II", "III", "II", "Meta"]
    case(28, "competencies with < 2/3 seats agreeing with assigned class", dict(assigned=asg, ratings=R),
         f28_low_agreement(asg, R), "SPEC L298; index 3 has 1/3 agreeing with II")

    # (29)
    for cnt in ({"1": 2, "3": 3, "5": 4}, {"1": 2, "3": 5, "5": 2}, {"1": 2, "3": 2}, {"1": 1, "3": 2, "5": 2}):
        case(29, "counts %s" % cnt, dict(counts=cnt), f29_indicator_counts(cnt))

    # (30)
    core = ["C1", "C2", "C3"]
    outs = ["O1", "O2", "O3"]
    L1 = [["C1", "O1"], ["C2", "O1"], ["C2", "O2"], ["C3", "O2"], ["C1", "O3"], ["C3", "O3"]]
    case(30, "valid matrix", dict(core=core, outcomes=outs, links=L1), f30_outcome_matrix(core, outs, L1))
    L2 = [["C1", "O1"], ["C2", "O1"], ["C2", "O2"], ["C1", "O3"], ["C2", "O3"]]
    case(30, "C3 unlinked, O2 has 1 competency", dict(core=core, outcomes=outs, links=L2), f30_outcome_matrix(core, outs, L2))
    case(30, "only 2 outcomes", dict(core=["C1", "C2"], outcomes=["O1", "O2"],
                                     links=[["C1", "O1"], ["C2", "O1"], ["C1", "O2"], ["C2", "O2"]]),
         f30_outcome_matrix(["C1", "C2"], ["O1", "O2"], [["C1", "O1"], ["C2", "O1"], ["C1", "O2"], ["C2", "O2"]]))

    # (31)
    mods = {"E1": "haiku", "E6": "sonnet", "E10": "haiku+sonnet+opus", "E8": "sonnet"}
    case(31, "E8 vs E1/E6/E10, same model as E6 (SPEC L536)",
         dict(validator="E8", extractor="E1", author="E6", scorer="E10", model_by_agent=mods),
         f31_validator_independent("E8", "E1", "E6", "E10", mods))
    case(31, "validator is the author", dict(validator="E6", extractor="E1", author="E6", scorer="E10"),
         f31_validator_independent("E6", "E1", "E6", "E10"))

    # (32)
    for N in (30, 70, 101, 0, 5):
        case(32, "N_câu = %d" % N, dict(n_sentences=N), f32_sample_size(N),
             "float trap: 0.1*%d = %r" % (N, 0.1 * N) if N in (30, 70) else "")

    # (33)
    ok10 = ["dat"] * 9 + ["dat_co_dieu_kien_kem_ke_hoach"]
    case(33, "9 đạt + 1 đạt có điều kiện kèm kế hoạch", dict(variables=ok10), f33_gate_g7(ok10))
    bad = ["dat"] * 9 + ["dat_co_dieu_kien"]
    case(33, "conditional without plan", dict(variables=bad), f33_gate_g7(bad))
    case(33, "only 9 variables", dict(variables=["dat"] * 9), f33_gate_g7(["dat"] * 9))
    case(33, "one chưa đạt", dict(variables=["dat"] * 9 + ["chua_dat"]), f33_gate_g7(["dat"] * 9 + ["chua_dat"]))

    # (34)–(35)
    allg = {g: "data" for g in ("G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8")}
    tier_cases = [
        ("level C, all data, G4 na (SPEC L336)", "C", dict(allg, G4="na"), False, False),
        ("level B, all data", "B", allg, False, False),
        ("level B, G4 by deviation", "B", dict(allg, G4="deviation"), False, False),
        ("level B, G2 by deviation (G2 not in the list)", "B", dict(allg, G2="deviation"), False, False),
        ("level A, all data, G11 ∧ G12", "A", allg, True, True),
        ("level A, all data, G12 missing", "A", allg, True, False),
        ("level A, G7 by deviation, G11 ∧ G12", "A", dict(allg, G7="deviation"), True, True),
    ]
    for nm, lv, gs, g11, g12 in tier_cases:
        case(34, nm, dict(level=lv, gates=gs), f34_market_product(lv, gs))
        case(35, nm, dict(level=lv, gates=gs, G11=g11, G12=g12), f35_tier(lv, gs, g11, g12))

    # (36)
    for d, tech in (("2026-11-19", True), ("2026-11-19", False), ("2028-02-29", True), ("2026-01-31", False)):
        case(36, "%s tech=%s" % (d, tech), dict(release_date=d, tech_family=tech), f36_review_date(d, tech),
             "29/02 + 12 tháng → clamp to 28/02" if d.endswith("02-29") else "")

    # (37)
    evs = [{"type": "RUN_STARTED", "run": "r1"}, {"type": "BLOCK_DONE", "block": "B0"},
           {"type": "BLOCK_DONE", "block": "B1"}]
    hs = f37_chain(evs)
    case(37, "chain of 3 events (h_0 = '')", dict(events=evs), hs,
         "Byte-exact match only with the same genesis/serialisation; see README.")
    tampered = json.loads(json.dumps(evs))
    tampered[1]["block"] = "B9"
    case(37, "tamper event #1 → first invalid index", dict(events=tampered, hashes=hs), f37_verify(tampered, hs),
         "Structural: modifying an old event is detected at that index.")
    case(37, "untampered chain verifies", dict(events=evs, hashes=hs), f37_verify(evs, hs))

    return CASES


def self_check():
    """Worked examples printed in the documents themselves."""
    assert f09_rescale(75) == 4.0                                       # WP ¶109
    r = f20_rwg([4, 4, 5]); assert abs(r["rwg"] - 0.83) < 0.01          # SPEC L293
    assert abs(r["s2"] - 0.33) < 0.01 and abs(r["mean"] - 4.33) < 0.01
    r = f20_rwg([5, 4, 2]); assert r["rwg"] == 0 and abs(r["s2"] - 2.33) < 0.01
    assert abs(f27_retranslation(["C", 3], [["C", 1], ["C", 3], ["C", 5]])["p"] - 0.33) < 0.01
    assert not f08_gate_g1(14, 5) and not f08_gate_g1(15, 4)            # SPEC L332
    assert not f23_core_limits(15, 0)                                   # SPEC L333
    assert f32_sample_size(30) == 3


def dump_whitepaper():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "docs", "whitepaper",
                        "competence-lab-whitepaper.docx")
    x = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    for i, p in enumerate(re.findall(r"<w:p[ >].*?</w:p>", x, re.S), 1):
        t = "".join(html.unescape(m) for m in re.findall(r"<(?:w|m):t[^>]*>([^<]*)</(?:w|m):t>", p))
        print("%d\t%s" % (i, t))


if __name__ == "__main__":
    if "--dump-whitepaper" in sys.argv:
        dump_whitepaper()
        sys.exit(0)
    self_check()
    out = {"generated_by": "tests/reference/formulas_ref.py", "tolerance": 0.01,
           "sources": {"WP": "docs/whitepaper/competence-lab-whitepaper.docx (¶ = paragraph index, see --dump-whitepaper)",
                       "WPmd": "docs/whitepaper/competence-lab-whitepaper.md", "SPEC": "docs/specs/competence-lab-upgrade-spec.md"},
           "cases": build()}
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
