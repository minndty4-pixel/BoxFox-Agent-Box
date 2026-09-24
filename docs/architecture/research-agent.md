# Research agent — ba mức, bốn pha, hồ sơ `.research/` và can thiệp giữa lượt (vòng 27)

> Trang này tả **đường nghiên cứu (research)** của BoxFox sau vòng 27: máy chốt độ sâu của một việc
> thế nào, luồng bốn pha, đường ghi hồ sơ, nhịp báo tiến độ, và đường chủ nhà can thiệp giữa lượt.
>
> **Quy ước trạng thái:** mỗi mục ghi rõ **`(đã có trong mã)`** — hành vi do harness ép, kiểm được bằng
> hàm/tệp nêu ngay dưới — hay **`(spec, chưa có trong mã)`** — đã chốt trong kế hoạch vòng 27 nhưng chưa
> thi công. Mục nào lẫn cả hai thì tách ngay trong mục; không mục nào được nói quá thứ có trong mã.
>
> **Nguồn số:** đọc thẳng từ mã tại `a959c51` (2026-09-24), không chép từ kế hoạch. Bảng hằng số tạm trong
> `docs/plan/v27/subplans/flow.md` §"Hằng số mới" đã cũ ở vài chỗ (`RESEARCH_TIER_BRANCHES` nói `3`/`6` còn
> mã là `5`/`15`; `RESEARCH_TIER_TURN_SECONDS` nói `600`/`1200` còn mã là `1200`/`3600`) — nơi nào mã khác kế
> hoạch thì trang này theo **mã**.
>
> **Chưa có benchmark research nào chạy.** Bộ ca `R1–R12` và oracle máy đã có trong mã, nhưng điểm của
> một lượt thật vẫn `blocked` — xem `docs/tracking/eval-tier0-regression.md` và
> `scripts/eval/results/tier-r1-research/README.md` (bất biến F19: báo cáo nào nói khác là báo cáo sai).

## 1. Ba mức và trần theo mức `(đã có trong mã)`

Hằng số: `backend/src/agentbox/agent_core/limits.py`, khối `RESEARCH_TIER_*` (dòng 387–397).
Số **có hiệu lực** khi chạy là số `research_tier_limits()` trả về
(`backend/src/agentbox/agent_core/research_runtime.py:69`) — hàm này kẹp lại theo trần chung trước khi dùng.

| Trần | Mức 1 | Mức 2 (mặc định) | Mức 3 | Hằng số |
| --- | --- | --- | --- | --- |
| Nhánh `research` cho **cả việc** | 1 | 5 | 15 | `RESEARCH_TIER_BRANCHES` |
| Số sóng nhánh | 1 | 1 | 3 | `RESEARCH_TIER_WAVES` |
| Nhánh mở mỗi sóng | 1 | 5 | 5 | `RESEARCH_TIER_WAVE_SIZE` |
| Bước tối đa một nhánh con | 20 | 40 | 40 | `RESEARCH_TIER_CHILD_STEPS` |
| Giây tối đa một nhánh con | 180 | 420 | 900 (kẹp còn 420) | `RESEARCH_TIER_CHILD_SECONDS` |
| Ngân sách LƯỢT | 1 200 s | 1 200 s | 3 600 s | `RESEARCH_TIER_TURN_SECONDS` |
| Trần cứng của lượt | 1 200 s (20′) | 1 800 s (30′) | 7 200 s (120′) | `RESEARCH_TIER_HARD_CEILING_SECONDS` |
| Phản biện độc lập bắt buộc | không | không | có | `RESEARCH_TIER_CRITIQUE` |
| Nới trần một lần ở mức 3 | — | — | 1 800 s | `RESEARCH_TURN_EXTENSION_SECONDS_TIER3` |

- **Kẹp theo trần chung:** `waveSize`/`branchCeilingPerWave` kẹp theo `FANOUT_PER_PARENT_MAX = 6`;
  `childSteps` kẹp theo `CHILD_MAX_STEPS = 40`; `childSeconds` kẹp theo `CHILD_DEADLINE_SECONDS = 420`
  — nên mức 3 khai 900 s nhưng số áp là **420 s**. `branchCeiling` (cả lượt) **cố ý không kẹp**: 15 nhánh
  của mức 3 là ba sóng × năm nhánh, không phải sáu nhánh chạy cùng lúc.
- **Mức mơ hồ ⇒ mức 2** (`RESEARCH_TIER_DEFAULT`), kèm notice `RESEARCH_TIER_DEFAULTED`. Hồ sơ việc lạ
  cũng bị kẹp về hồ sơ hợp lệ (`RESEARCH_PROFILE_INVALID`).
- **`research_brief` là cửa duy nhất chốt mức** (vai orchestrator, `research_runtime.py:402`). Một lượt chỉ
  có một việc (`RESEARCH_BRIEF_TAKEN`); trong cùng lượt chỉ được **hạ** mức hoặc **rút ngắn** trần — xin
  nâng là `RESEARCH_BRIEF_RAISE_REFUSED`. Brief đi vào `session['config']['research']` qua `update_config`
  (vì `save` chỉ ghi messages).

Bốn công tắc (`research_runtime._mode`; giá trị lạ ⇒ notice `…_MODE_UNKNOWN` rồi dùng mặc định):

| Công tắc | Giá trị | Mặc định | Việc |
| --- | --- | --- | --- |
| `BOXFOX_RESEARCH_BRIEF` | `enforce` · `warn` · `off` | `warn` | cổng mềm **thiếu brief** khi giao việc `research` |
| `BOXFOX_RESEARCH_GATE` | `enforce` · `warn` · `off` | `enforce` | cổng **chất lượng hồ sơ** trước khi ghi (§3) |
| `BOXFOX_RESEARCH_PROGRESS` | `on` · `off` | `on` | nhịp báo tiến độ (§4) |
| `BOXFOX_STEER` | `on` · `off` | `on` | chỉ thị giữa lượt của chủ nhà (§4) |

Các công cụ của luồng nằm ở hai nhóm trong `tool_groups.py`: `researchLedger`
(`source_add`, `source_list`, `source_verify`) và `researchDossiers`
(`research_brief`, `dossier_write`, `research_verify`, `research_status`, `cancel_child`).

## 2. Luồng bốn pha `(đã có trong mã)`

Khung bốn pha và danh mục nhắc nhánh nằm trong skill
`backend/src/agentbox/vendor/hermes/skills/research/research-team/SKILL.md`; phần **máy ép** ở mỗi pha:

1. **Pha 1 — BẢN ĐỒ (scoping).** Main đọc câu hỏi, chia nhánh theo danh mục. Pha này **chưa có cổng nào**
   trong mã: cách chia nhánh là luật model đọc skill.
2. **Pha 2 — CHỐT.** Main gọi `research_brief(...)` (chốt mức + hồ sơ việc + phòng hồ sơ + trần), rồi
   `delegate_task(role="research")`. Ngay trước khi mua slot con, harness chạy hai cổng
   `missing_brief_gate` rồi `branch_limit_check` (`research_runtime.py:589`, `:568`; gọi tại
   `runtime.py:5149-5150`), và kẹp `childSteps`/`childSeconds` của con `research` theo mức
   (`runtime.py:5152-5156`). Giao việc research mà chưa brief: `warn` ⇒ notice `RESEARCH_BRIEF_MISSING`
   + log, `enforce` ⇒ lỗi chặn; quá trần nhánh ⇒ `RESEARCH_BRANCH_LIMIT`.
3. **Pha 3 — ĐÀO SÂU.** Con `research` (`roles.py:233`; toolset `RESEARCH` = `READ` +
   `browser_use`/`web_search`/`web_fetch`/`read_source`/`paper_citations`) mở nguồn thật, rồi
   `source_add` từng khẳng định kèm đoạn trích nguyên văn. Mức 3 đuổi trích dẫn lùi tới bão hoà, mâu thuẫn
   thì dựng bảng đối chiếu. Hình dạng tệp và trần số hàng ở §3.
4. **Pha 4 — PHẢN BIỆN ĐỘC LẬP.** Main giao `delegate_task(role="research-review")`
   (`roles.py:238`; quyền `READ | SOURCE_READ` — đọc được sổ nhưng **không** `source_add`, **không** quyền
   ghi). Câu trả lời của người phản biện phải kết thúc bằng **đúng một dòng** `VERDICT: ok` hoặc
   `VERDICT: revise`, và nếu quá ngắn (dưới `RESEARCH_REVIEW_MIN_ANSWER_CHARS = 400` ký tự) thì
   `research_verify` từ chối (`RESEARCH_VERIFY_NO_CRITIC`). Main gọi `research_verify` — orchestrator-only,
   vì **người phản biện không tự ghi phán quyết của chính mình**. Máy từ chối khi không có con phản biện
   thật chạy sau bản hồ sơ, khi thiếu `version`, hoặc khi `verdict` lệch với điều phản biện đã nói
   (`RESEARCH_VERIFY_VERDICT_MISMATCH`). `revise` cho sửa tối đa `RESEARCH_VERIFY_REVISE_MAX = 1` vòng;
   quá trần thì bản hồ sơ mang nhãn do máy viết `chưa đạt phản biện`.

Ở mức 1–2 (`RESEARCH_TIER_CRITIQUE = False`) không bắt con phản biện riêng: hồ sơ khai `Critique: none`,
và chỗ chặn là cổng chất lượng ở §3. Việc ghi hồ sơ (`dossier_write`) nằm giữa pha 3 và pha 4, vì phản
biện phải soi một bản **đã ghi**.

Trước vòng 27 luồng này chưa có: một việc research chỉ là một con `research` chạy tự do — không sổ nguồn,
không cổng chất lượng, không pha phản biện (xem `docs/architecture/decisions/0004-research-ledger-and-critique.md`).

## 3. Đường ghi hồ sơ và phòng `.research/` `(đã có trong mã)`

- **Phòng hồ sơ:** `<workspace>/.research/<slug>-<yyyymmdd-hhmm>` (giờ UTC), một phòng cho một việc
  (`dossier_dir_for`, `research_runtime.py:162`). Slug lấy từ `researchId` nếu khớp
  `RESEARCH_SLUG_RE = ^[a-z0-9]+(-[a-z0-9]+)*$`; không thì rút ≤ 5 từ / ≤ 40 ký tự từ câu hỏi; cuối cùng mới
  tới `research-<4 số>`.
- **Tệp hồ sơ:** `f'{dossier_dir}/v{version}-{research_id}.md'` (`research_runtime.py:751`), `version` =
  số bản đã ghi + 1. Cha ghi lại ⇒ `v2`, `v1` giữ nguyên.
- **Một lần ghi là một bộ tệp** (op `dossier_write` trong `backend/src/agentbox/sandbox/worker.py`): tệp hồ
  sơ + `sources.jsonl` + `sources.md`, thêm `tables/<tên>.md` cho từng bảng và `review.md` khi `review`
  khác rỗng. Ghi **TẤT CẢ hoặc KHÔNG GÌ**: mọi kích thước bị kiểm trước khi ghi tệp nào; tệp hồ sơ đã tồn
  tại thì `DOSSIER_VERSION_TAKEN` và phải ghi bản kế. Đường dẫn phải khớp `DOSSIER_PATH_RE` (chỉ trong
  `.research/`) và đi qua cổng chặn thoát workspace.
- **Trần:** `DOSSIER_MAX_BYTES = 262 144` (256 KiB) cho **từng tệp**; `RESEARCH_MAX_ROWS_PER_DOSSIER = 400`
  hàng sổ mỗi hồ sơ; đoạn trích ≥ `RESEARCH_MIN_EXCERPT_CHARS = 80` ký tự (cắt ở 2 000).
- **Đầu hồ sơ** là khối HTML comment `<!-- boxfox-research … -->` (`research_header.py`, tối đa 14 dòng) với
  bảy khoá: `Version / ResearchId / Profile / Level / Critique / Gate / Rows`. `Critique` ∈ `none|ok|revise`;
  `Gate` ∈ `clear|warn|unbacked`.
- **Mục bắt buộc theo mức** (máy soi tiêu đề, khớp bỏ dấu): mức 1 Câu hỏi / Phát hiện / Nguồn; mức 2 thêm
  Mâu thuẫn còn lại / Việc chưa làm; mức 3 thêm Phản biện (`research_quality.DOSSIER_SECTIONS`).
- **Sổ nguồn trong hồ sơ:** hàng id `r1, r2, …`; trong văn xuôi trích `[r<N>]`, cuối mục có dòng `**Nguồn:**`.
  Hàng sổ chỉ dùng khi nguồn đã **mở thật** (`source_add` idempotent theo URL chuẩn hoá + đoạn trích).
- **Cổng chất lượng chạy TRƯỚC khi ghi**, hai lớp (`research_quality.py`): (a) ghi chú máy lên câu trả lời
  của con (`annotate_child_answer`) — **không bao giờ chặn**; (b) `assess(...)` sinh phán quyết, ở chế độ
  `enforce` thì hỏng là `ValueError` mang tiền tố `RESEARCH_QUALITY_REJECTED` kèm câu khắc phục
  (15 mã trong `research_quality.RESEARCH_CODES` / `REMEDIES`). Cổng này ở **tệp riêng** — `evidence_gate.py`
  cố ý không nhận luật citation (D-18), và ghi sổ hỏng chỉ log rồi đi tiếp.
- Mỗi bản ghi xong còn ghim một hàng sổ trỏ vào tệp (`pin_source_ledger`); ghim hỏng cũng chỉ log.

## 4. Nhịp tiến độ và can thiệp giữa lượt `(đã có trong mã)`

**Nhịp báo tiến độ** — `maybe_nudge_progress` (`runtime.py:2590`) chạy ở ranh giới bước:

- Cứ `RESEARCH_PROGRESS_NUDGE_SECONDS = 600` giây (≈10 phút) bơm **một** mục `user` mở đầu
  `[Nhịp tiến độ:`, tối đa `RESEARCH_PROGRESS_MAX_PER_TURN = 12` lần một lượt.
- Câu nhắc **không phát event và không sinh hàng `D:`** — nó là một mục trong transcript, không phải sự kiện
  của phiên; đếm nó thành lượt hay vẽ nó thành một dải trạng thái đều sai. Trạng thái nhịp sống theo phiên
  và tự đặt lại khi sang lượt mới.
- `BOXFOX_RESEARCH_PROGRESS=off` tắt hẳn nhịp.
- *Khuôn chữ* của câu báo (`Đang ở: <pha> · Đã xong: … · Còn lại: … · Chờ: …`, không khối, không dải, không
  huy hiệu) là luật trong skill `research-team` — `(spec, chưa có trong mã)`: máy chỉ ép **nhịp**, nội dung
  do model viết.

**Chỉ thị giữa lượt của chủ nhà** — hàng vào bảng `session_steers`:

- `queue_owner_steer` (`research_runtime.py:1044`): `BOXFOX_STEER=off` ⇒ trả `None` (không nhận); nội dung
  rỗng ⇒ `STEER_EMPTY`; cắt ở `STEER_TEXT_MAX_CHARS = 4 000` ký tự; hàng đợi đầy
  (`STEER_MAX_PENDING = 5`) ⇒ `STEER_QUEUE_FULL`. HTTP trả `202 {'status': 'steered', 'steerId', 'turn', 'pending'}`.
- Mỗi **ranh giới bước**, `drain_steers` (`runtime.py:3165`) nhận tối đa `STEER_DRAIN_MAX = 3` hàng rồi bơm
  mỗi nhóm **một** mục `user` mở đầu `[Chỉ thị giữa lượt của chủ nhà]` — mỗi chỉ thị vào transcript **đúng
  một lần**.
- Trạng thái hàng: `pending → injected` khi vào transcript; `pending → dropped` khi chỉ thị không còn dùng
  được (nhánh của nó bị huỷ).
- `cancel_child` (orchestrator, `research_runtime.py:1005`) dừng **đúng một** nhánh con của phiên gọi, đánh
  `dropped` các chỉ thị đang chờ của nhánh đó, trả slot về; kết quả nhánh ấy về cha như mọi kết quả con khác.

## 5. Ngân sách và nút duyệt — phần mã `(đã có trong mã)`, phần duyệt `(spec, chưa có trong mã)`

Đã có trong mã:

- Ba con số của một việc: ngân sách **lượt** theo mức (`turnSeconds` 1 200 / 1 200 / 3 600 s), **trần cứng**
  (`hardCeilingSeconds` 1 200 / 1 800 / 7 200 s = 20 / 30 / 120 phút), và **một lần nới** cho lượt mức 3
  (`RESEARCH_TURN_EXTENSION_SECONDS_TIER3 = 1 800 s`).
- `research_brief` chỉ cho trần **ngắn đi**: `ceiling = max(60, min(wanted, turnSeconds))`; xin dài hơn ⇒ kẹp
  + notice `RESEARCH_CEILING_CLAMPED`.
- Xin trần dài hơn ngân sách lượt đang chạy ⇒ `extend_research_budget(sid, tier, ceiling)`
  (`runtime.py:2545`) nới lượt **đúng một lần**, không quá `hardCeilingSeconds`; xin chạm/vượt trần cứng ⇒
  notice `RESEARCH_HARD_CEILING` nói rõ phần vượt phải là một lượt mới (không nới ngầm).

Chưa có trong mã (hiện chỉ là **luật model trong skill**):

- Nút duyệt việc lớn: không có mã nào đọc hay ghi `research-budget` (`grep -rn "research-budget" backend/src
  frontend/src` không ra kết quả). Luật nằm ở `vendor/hermes/skills/research/research-team/SKILL.md`
  §"Ngân sách và nút duyệt (#5964)": gọi
  `request_approval(action='research-budget: <mức>, <trần> phút, <n> nhánh, <lý do>')`, và in một dòng
  `Ngân sách: mức <n> · đã dùng <mm:ss> / trần <mm:ss> · <n> nhánh · <token> token`.
- Thẻ duyệt trong chat và dòng ngân sách cuối là hành vi model; harness **chưa ép**.
- Đơn vị tiền: harness chỉ có `usage` (token), không quy đổi USD — đừng bịa số USD cho một việc research.

## 6. Ranh giới với Phạm vi A và B (không làm trùng)

Vòng 27 chia ba phạm vi. C là vòng này — bảng dưới theo
`docs/plan/v27/subplans/flow.md` §"Ranh giới với Phạm vi A và B (không làm trùng)", với hai tên đã đổi cho
khớp mã: vai con phản biện là `research-review` (kế hoạch viết `research-critique`), bộ ca là `R1–R12`
(kế hoạch viết `R1–R7`).

| Việc | A (đọc thật) | B (sổ nguồn) | C (luồng, vòng 27) |
| --- | --- | --- | --- |
| Giải nén gzip, `offset` khi đọc, định tuyến reader, thêm provider | A | | |
| `read_source` / đọc theo khoảng, xử lý PDF/bảng | A | | |
| Sổ nguồn `source_ledger` (khẳng định ↔ nguồn ↔ trích nguyên văn ↔ ngày ↔ tier ↔ confidence), thang 4 tầng | | B | C **gọi** sổ: `sources.md` sinh từ sổ |
| Cổng chất lượng research (tệp **mới**, ngoài `evidence_gate.py`) | | B | C ghi luật + tạo điểm đọc (front matter trong tệp hồ sơ) |
| Con phản biện `research-review` + vòng `revise` | | B | C định nghĩa *khi nào gọi* + chỗ ghi `critique.md` |
| Ba mức, trần theo mức, `research_brief`, skill `research-team`, bốn pha | | | C |
| Đường ghi tệp cho con (`dossier_write`, `.research/`) | | | C |
| Nhịp tiến độ, steer giữa lượt, `cancel_child` | | | C |
| Ngân sách + nút duyệt, bộ ca `R1–R12` + oracle máy, tài liệu | | | C |

## 7. Trạng thái đo

- Bộ ca research `R1–R12` và 27 oracle máy đã có trong mã (`scripts/eval/research_checks.py`,
  `scripts/eval/fixtures/R1.json … R12.json`, `scripts/eval/rubric.py`), chạy được **offline**, không cần model.
- **Chưa có lượt research thật nào được chấm.** Mục `research-scores` của tầng `tier-r1` trong
  `scripts/eval/benchmarks/tiers.json` đang `blocked`, và `scripts/eval/results/tier-r1-research/` chỉ có
  ví dụ dựng tay. Cách chạy lại nằm ở `docs/tracking/eval-tier0-regression.md` và README của thư mục đó.

Đọc tiếp: `docs/naming.md` §11 (tên phòng `.research/` và mã dòng sổ nguồn `r<N>`),
`docs/architecture/decisions/0004-research-ledger-and-critique.md` (quyết định của lớp B),
`docs/tracking/owner-decisions.md` (#5960–#6025, D-40, D-41).
