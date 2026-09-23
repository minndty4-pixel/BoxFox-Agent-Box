# Kế hoạch chi tiết — Vòng 27 · Phạm vi C: Luồng nghiên cứu

Owner: Nam Nam. Ngôn ngữ: tiếng Việt, thuật ngữ kỹ thuật giữ nguyên tiếng Anh, đường dẫn/tên hàm/tên tool **nguyên văn**.
Nhánh: `vorflux/v22-peer-mesh`. HEAD khi soạn plan: **`2add905`** (cây sạch). Nguồn chân lý yêu cầu: `/code/.plans/v27-owner-answers.md` (#5955–#5998) và `/code/.plans/v27-adr-research-rework.md`.
Ranh giới: **Phạm vi C là luồng chạy.** Lớp đọc/nguồn = Phạm vi A (`plan-v27-reading`). Sổ nguồn, thang mức nguồn, hồ sơ việc làm, cổng chất lượng research, pha phản biện = Phạm vi B (`plan-v27-ledger`). Plan này **chỉ nối vào** hai phạm vi đó.

### Summary

Dạy harness chạy một việc nghiên cứu như một nhóm nghiên cứu thật: main chốt **một con số mức** cho cả việc rồi chia nhánh con theo đúng mức đó; mọi mức đều phải mở nguồn thật; tiến độ được báo theo mốc; chủ nhà gõ được chỉ thị giữa lúc chạy và dừng được một nhánh; **toàn bộ kết quả ghi ra tệp** trong phòng `.research/` thay vì nhồi vào câu trả lời bị cắt ở 8 000 ký tự. C-1 dựng xương sống luồng (mức + trần + skill), C-2 mở đường ghi tệp cho con, C-3 SOP bốn pha + đuổi trích dẫn, C-4 nhịp tiến độ, C-5 can thiệp giữa lúc chạy, C-6 ngân sách, C-7 đo lường, C-8 tài liệu. Phần còn thiếu của owner (thị trường, học thuật/kỹ thuật, phương pháp) ghi thẳng vào plan dưới nhãn `[MỞ — chờ phỏng vấn]`, plan duyệt xong thì phỏng vấn tiếp (#5998).

---

## 0. Trạng thái đo được hôm nay (không đoán, đọc từ code tại `2add905`)

| Sự thật | Chỗ đo | Hệ quả trực tiếp cho plan |
| --- | --- | --- |
| `research` = `READ \| {'browser_use','web_search','web_fetch'}` — **không** `file_write`, không `file_edit_block`, không `terminal_exec` | `backend/src/agentbox/agent_core/roles.py:18` | Con research không thể để lại hồ sơ trên đĩa ⇒ phải mở một đường ghi tệp có giới hạn (C-2) |
| Câu trả lời con bị cắt ở `CHILD_ANSWER_MAX_CHARS = 8000`, kèm dòng `[Bounded at N characters; …]` | `runtime.py:1015`, `runtime.py:1079-1084` | Khảo sát > 8 000 ký tự về tới main **trong trạng thái cắt** — phải chuyển độ sâu sang tệp |
| `bound_child_text` cũng áp cho mỗi kết quả con bơm vào lượt | `runtime.py:4932-4965` | Cắt là hệ thống, không phải lỗi lẻ |
| `PEER_WAIT_RESULT_CHARS = 16 000` cho **cả** payload `await_children`; `PEER_DELIVER_MAX = 4` | `limits.py:135`, `limits.py:139` | 4 nhánh là trần giao hàng mỗi lượt chờ — nhịp báo phải nằm ở lượt, không ở `await_children` |
| Trần con áp cứng: `maxSteps = min(CHILD_MAX_STEPS=40, config['maxSteps'])`, `deadlineSeconds = min(CHILD_DEADLINE_SECONDS=420, config['deadlineSeconds'])` | `runtime.py:4992-5000`, `limits.py:30-31` | Đưa **bảng trần theo mức** vào đúng dòng `min()` này (C-1) |
| Fan-out: 3 mặc định / 6 max mỗi cha / 8 toàn cục / 12 con mỗi lượt / chờ slot 30 s, mã `FANOUT_BUSY` | `limits.py:105-112`, `runtime.py:1839-1874` | Mức 3 (6 nhánh) vừa trần 6 — không cần đổi hạn mức, chỉ cần chọn đúng số nhánh |
| Con **không** được hỏi chủ nhà: `DECISION_UNAVAILABLE` | `runtime.py:3972-3979` | #5961 đã được thực thi ở tầng harness; phần còn thiếu là **luật nhắc trong skill** để main tự tách việc |
| `RESEARCH_INSTRUCTIONS` yêu cầu 4 mục có `### Primary Sources & Citations`, nhưng **không cổng nào kiểm** | `roles.py:140-152` | Cần cổng mới ở **ngoài** `evidence_gate.py` (D-18/F1) — việc của B; C chỉ viết luật và tạo chỗ cho trích dẫn |
| `evidence_gate.classify_turn`: `web_search`/`web_fetch` nằm trong `READ_TOOLS` ⇒ lượt read-only ⇒ verdict `sufficient` | `evidence_gate.py:83-85`, `:269-358` | Một con research trả 8 000 ký tự **không một URL** vẫn "đủ" ⇒ phải có tệp + cổng mới |
| Đang chạy lượt thì prompt thường bị chặn: `busy = session['status'] in {'running','awaiting_decision'}` ⇒ `ValueError('SESSION_BUSY: Turn in progress')` (HTTP 409) | `skills/runtime_commands.py:39-41`, `api/server.py:150-160` | #5981 không thể làm bằng prompt thường ⇒ cần đường steer (C-5) |
| Tiền lệ duy nhất bơm chữ vào giữa lượt: `drain_peer_deliveries`, gọi ở **mốc bước** ngay sau compaction và trước `store.emit('step')` | `runtime.py:4932-4965`, gọi tại `runtime.py:3024` | Khuôn mẫu để làm `drain_steers` + nudge tiến độ, không phát minh cơ chế mới |
| Kết quả con giao tới được chèn bằng `claim_deliveries` (`UPDATE … WHERE state='pending'` trong 1 giao dịch) | `memory/session_store.py:483-500`, `runtime.py:4932-4965` | Khuôn mẫu chống bơm hai lần để copy cho steer |
| `assistant` **không** `final` đã được render giữa lượt như một mục `text` trong timeline | `frontend/src/components/chat/HarnessStepView.tsx:1134-1154` | Nhịp báo tiến độ **không cần UI mới** (tránh F2/F3) |
| Nút gửi của composer bị khoá khi `running`/`starting`/`awaiting_decision`; `SESSION_BUSY` nằm trong `HARNESS_ERROR_CODES` | `frontend/src/components/panels/ChatPanel.tsx:93-101`, `:196-206` | Phải mở khoá này cho đường steer, kèm test phải cập nhật |
| `worker.py` được gửi nguyên văn vào box: `WORKER = Path(__file__).with_name('worker.py').read_text()`, chạy qua `docker exec … -c WORKER` | `backend/src/agentbox/sandbox/executor.py:12`, `:221-222` | Thêm op box `dossier_write` **không cần dựng lại box** — điều kiện khả thi quan trọng của C-2 |
| Op `write_plan` là khuôn mẫu: phòng `.plans`, `PLAN_MAX_BYTES = 1048576`, ghi `exclusive=True`, mã `PLAN_VERSION_TAKEN` | `sandbox/worker.py:77-81`, `:476-518` | Copy nguyên hình dạng cho `.research/` với trần nhỏ hơn |
| `file_read` cắt 30 000 ký tự, **không** `offset`/`limit`; `path()` chặn thoát `ROOT` | `sandbox/worker.py:103-133`, `:83-88` | Hồ sơ dài phải chia nhiều tệp; đọc lại từng phần là việc của A |
| Router **có** tính chi phí (`cost`, `costBasis`, bốn nguồn giá, USD/1M token) trong `router/src/pricing.mjs`, nhưng harness chỉ nhận `response['usage']` thô | `router/src/pricing.mjs:1-22`, `runtime.py:3300` | Trần nêu bằng **giây + token** hôm nay; trần USD là mục `[MỞ]` (cần router trả thêm một trường) |
| `benchmark/cases/*` chỉ có `.gitkeep`; `scripts/eval/results/tier0-regression/` không có `scores.jsonl`; `JudgeRunner.request` ném `NotImplementedError`; `--execute` không có tiền/không có mạng ⇒ exit 5/4 | `benchmark/`, `scripts/eval/judge.py:167-177`, `scripts/eval/run_eval.py:35` | Không được khoe benchmark (F19); bộ ca research phải có **oracle máy** chạy được offline (C-7) |
| `docs/architecture/tools-and-skills.md:128-129` ghi `web_search(query, max_results?)` và `web_extract(url)` — schema thật là `web_search(query, count, source)` / `web_fetch(url, maxChars)`, `web_extract` không tồn tại | `docs/architecture/tools-and-skills.md:128-129`, `tool_contracts.py` | F22: sửa theo `tool_contracts.py` (C-8) |
| `docs/plan/cua-benchmark-plan.md:44,73` nói "BoxFox **chưa có tool tìm kiếm**" và vì thế chặn GAIA level 1 | `docs/plan/cua-benchmark-plan.md:44,73` | F21: thông tin đã cũ (search có từ vòng 9) ⇒ sửa trong C-8 |

**Nguyên nhân gốc của "chỉ đọc phần nổi" (để trích trong báo cáo, việc sửa thuộc A và C):**
1. `web.fetch()` không giải nén gzip ⇒ trang báo Việt Nam trả rác nhị phân dài hơn ngưỡng 200 ký tự nên reader `r.jina.ai` không bao giờ được thử (sửa ở A).
2. `MAX_TEXT_DEFAULT = 8000` và **không có `offset`** ⇒ model chỉ thấy 7 % đầu của tài liệu dài — đúng phần điều hướng (sửa ở A).
3. `RESEARCH` không có tool ghi tệp + trần 8 000 ký tự ⇒ **mọi chiều sâu đều phải nhét vào câu trả lời ngắn** (sửa ở C, đợt C-2).

---

### Tasks

#### 1. **[song song A] C-1 — Xương sống `research_brief`: ba mức, một con số cho cả việc, trần theo mức, skill `research-team`**

**Hiện trạng:** không có khái niệm "mức" nào trong code; `delegate_task` chỉ có `role/goal/context/expect/wait/deliverTo`; trần con cứng 40 bước/420 s (`limits.py:30-31`) và áp bằng `min()` ở `runtime.py:4992-5000`; hướng dẫn research chỉ là prompt 5 bước không ai kiểm (`roles.py:140-152`).

**Thay đổi:**

1.1 **Bảng trần theo mức** — thêm vào `backend/src/agentbox/agent_core/limits.py`, cạnh khối fan-out (mục `LIMITS § fan-out`), kèm chú thích "số tạm, chờ phỏng vấn #5998":

```python
# --- Vòng 27 (C-1): ba mức nghiên cứu. Số ở đây là TẠM cho tới khi owner chốt (#5965/#5967).
RESEARCH_TIERS = (1, 2, 3)
RESEARCH_TIER_DEFAULT = 2                      # câu hỏi mơ hồ ⇒ mức 2 (#5965)
RESEARCH_TIER_BRANCHES = {1: 1, 2: 3, 3: 6}    # ≤ FANOUT_PER_PARENT_MAX (6) ⇒ không cần nới fan-out
RESEARCH_TIER_CHILD_STEPS = {1: 20, 2: 40, 3: 40}     # ≤ CHILD_MAX_STEPS (40)
RESEARCH_TIER_CHILD_SECONDS = {1: 180, 2: 420, 3: 900}  # 900 = CHILD_WALL_MAX_SECONDS
RESEARCH_TIER_TURN_SECONDS = {1: 600, 2: 1200, 3: 1200} # 1200 = DEADLINE_MAX_SECONDS (trần lượt)
RESEARCH_TIER_CRITIQUE = {1: False, 2: False, 3: True}  # mức 3 luôn có phản biện (#5968)
RESEARCH_PROGRESS_NUDGE_SECONDS = 600          # #5969 "khoảng 10 phút"
RESEARCH_BRIEF_ENV = 'BOXFOX_RESEARCH_BRIEF'   # off | warn | enforce; mặc định 'warn'
```

Quy tắc áp: `research_tier_limits(tier)` trả dict đã clamp — giây con `min(RESEARCH_TIER_CHILD_SECONDS[tier], CHILD_DEADLINE_SECONDS)`, bước con `min(RESEARCH_TIER_CHILD_STEPS[tier], CHILD_MAX_STEPS)`, nhánh `min(RESEARCH_TIER_BRANCHES[tier], FANOUT_PER_PARENT_MAX)`. **Không** nới `CHILD_DEADLINE_SECONDS`, `PEER_WAIT_*`, `CHILD_MAX_STEPS` (F9, D-10/D-12). Mức 3 cần lượt dài hơn 1 200 s ⇒ **không tự quyết**, xem `[MỞ]` §M1.

1.2 **Tool `research_brief`** (chỉ orchestrator):
- Schema trong `backend/src/agentbox/agent_core/tool_contracts.py` (đặt cạnh `write_plan`): `tier` (integer, 1|2|3, bắt buộc), `jobProfile` (string, bắt buộc — nhóm 1 văn bản chính thức / nhóm 2 học thuật-kỹ thuật / nhóm 3 thị trường / `owner-docs` tài liệu chủ nhà cung cấp), `question` (string, bắt buộc, nguyên văn câu hỏi nghiên cứu), `branches` (array string, tuỳ chọn, mỗi phần tử là một nhánh dự kiến, tối đa `RESEARCH_TIER_BRANCHES[tier]`), `ceilingSeconds` (integer, tuỳ chọn), `rationale` (string, bắt buộc — vì sao chọn mức này, hiện trong báo cáo cuối).
- Role: `research_brief` vào `ORCHESTRATOR_TOOLS` (`roles.py:185-186`, thêm vào literal set cạnh `write_plan`). **Không** thêm cho role nào khác (đúng #5961: chỉ main chốt mức).
- Xử lý trong `runtime.py`: hàm mới `has_research_brief()`/`research_brief(session, args)` đặt cạnh `write_plan` và nối vào bảng dispatch tại `runtime.py:3506` (`if name == 'research_brief': return await self.research_brief(session, args)`).
  - Kiểm: `tier` không thuộc `{1,2,3}` ⇒ kẹp về `RESEARCH_TIER_DEFAULT` + notice `RESEARCH_TIER_DEFAULTED` + log `research.brief.tier_defaulted`.
  - `ceilingSeconds` bị kẹp bởi `RESEARCH_TIER_TURN_SECONDS[tier]` (và bởi `DEADLINE_MAX_SECONDS`); vượt ⇒ kẹp + notice `RESEARCH_CEILING_CLAMPED`.
  - Ghi `session['config']['research'] = {'tier','jobProfile','question','branches','ceilingSeconds','dossierDir','startedAt','rationale','mode'}` rồi `store.save(sid, messages)`.
  - `dossierDir = '.research/<slug>-<yyyymmdd-hhmm>/'` với `slug` sinh từ `question` (regex như `PLAN_SLUG` ở `sandbox/worker.py:77-78`, giới hạn 40 ký tự).
  - Nhật ký: gọi `journal.record('D', text, sid=sid, turn=turn, data={'kind':'research-brief','tier':…,'jobProfile':…,'ceilingSeconds':…,'branches':…})` — `record()` đã nhận `data`/`numbers` (`journal.py:213-215`), và `write_plan` cũng ghi hàng `P:`/`F:` qua đúng lớp này (`journal.py:152`) — để hồ sơ và báo cáo cuối trích được "mức nào, ai chốt, vì sao".
  - Phát `notice` `{code:'RESEARCH_BRIEF', tier, jobProfile, dossierDir, branches, ceilingSeconds}` + `system_log.write('research.brief', …)`.
  - Trả về `{'tier','jobProfile','dossierDir','branchCeiling','childSteps','childSeconds','critique','next':'delegate_task(role="research", …)'}` để model thấy ngay hạn mức của mình.
  - **Ghi lại (đổi phạm vi giữa lượt — dùng cho C-5):** nếu đã có brief trong cùng lượt thì chỉ cho phép **hạ** mức/hạ trần; nâng ⇒ `ValueError('RESEARCH_BRIEF_RAISE_REFUSED: … xin chủ nhà ở lượt sau')`; hạ ⇒ ghi đè + notice `RESEARCH_BRIEF_UPDATED` + hàng `D:` mới.
- Cổng mềm khi thiếu brief: nếu `mode != 'off'` và lượt này **đã** gọi `delegate_task(role='research')` mà chưa gọi `research_brief` ⇒ notice `RESEARCH_BRIEF_MISSING` + log `research.brief.missing`, **không** chặn (mặc định `warn`; `enforce` để dành cho đợt sau khi bộ ca C-7 chạy xanh — cấm bật enforce sớm, F12 cùng tinh thần).

1.3 **Trần theo mức đi vào `delegate_task`** — sửa `runtime.py:4992-5000`: đọc brief của phiên cha; nếu có, tính thêm hai hệ số mức:
```python
tier = (session['config'].get('research') or {}).get('tier')
if role == 'research' and tier:
    cfg = research_tier_limits(tier)
    max_steps = min(max_steps, cfg['childSteps'])
    deadline  = min(deadline,  cfg['childSeconds'])
```
Đồng thời truyền tier xuống con bằng `context` do main viết (không thêm trường mới vào `delegate_task` — tránh đổi hợp đồng công cụ mà UI/test đang bám): skill bắt main **mở đầu mỗi `context` bằng dòng `Mức: <n> · hồ sơ: <jobProfile> · phòng hồ sơ: <dossierDir>`**. Khi brief chưa có, hành vi **y như hôm nay** (đường lùi an toàn).

1.4 **Cổng đếm nhánh theo mức** — khi brief có tier, `acquire_child_slot` (`runtime.py:1839-1874`) kiểm thêm số con `role='research'` đang mở của lượt này; vượt `RESEARCH_TIER_BRANCHES[tier]` ⇒ `ValueError('RESEARCH_BRANCH_LIMIT: mức <n> cho tối đa <k> nhánh; gộp lại hoặc xin chủ nhà nâng mức')` (thông điệp nêu đúng cách sửa: **gộp nhánh**, #5982). Không dùng `FANOUT_BUSY` vì đây là luật của phiên, không phải tranh chấp slot.

1.5 **Skill mới `research-team`** — `backend/src/agentbox/vendor/hermes/skills/research/research-team/SKILL.md` (+ `references/` nếu dài), đăng ký vào `DEFAULT_SKILLS` (`skills/catalog.py:7-14`) và `ROLE_SKILLS['research']` (`skills/commands.py:31`; giữ `grounded-citations`). Nội dung (tiếng Việt, thuật ngữ EN), theo thứ tự:
  - **Bảng ba mức**: tín hiệu nhận biết → mức; hình dạng đầu ra; có phản biện không; trần mặc định. Tín hiệu mức 1: câu hỏi một điểm dữ kiện, một nguồn là đủ, < ~2 phút; mức 2 (mặc định, mơ hồ ⇒ mức 2): cần dẫn nguồn, nhiều khía cạnh, khảo sát ngắn; mức 3: nhiều trường phái/nguồn mâu thuẫn, hợp đồng/giá/định danh then chốt, owner cần "yên tâm về quyết định".
  - **Luật một con số**: *một mức cho cả việc*; mọi con nhận đúng mức đó trong `context`; con **không** tự nâng mức (nâng ⇒ ghi vào `## Limitations & open questions`).
  - **Luật đọc (#5966)**: mở thật bằng `web_fetch`/đọc tệp → lấy **đoạn liên quan** → dán đoạn trích nguyên văn vào sổ (đường dẫn sổ: Phạm vi B). Tài liệu dài không cần đọc hết, **nhưng** cấm trình bày một mẩu snippet như thể đã đọc toàn văn; không mở được bản gốc ⇒ ghi đúng chữ `chưa mở được bản gốc` (khớp #5984 và oracle Q1/Q6).
  - **SOP bốn pha** (chi tiết §2).
  - **Danh mục nhắc** theo lĩnh vực (luật: số hiệu, ngày hiệu lực, còn/hết hiệu lực; y tế: cơ sở, ngày, phạm vi; tài chính: kỳ, đơn vị tiền; học thuật: DOI, năm, venue; kỹ thuật: phiên bản sản phẩm, ngày; thị trường: ngày chụp giá, khu vực, phân khúc) — mỗi dòng một câu nhắc ngắn để main dán vào `context` con.
  - **Luật gộp nhánh (#5982)**: việc liên quan phải gộp vào **một** con; ví dụ mẫu "giá + khuyến mãi + tồn kho của cùng một mã hàng = MỘT nhánh".
  - **Mẫu hồ sơ** theo mức (§6) và mẫu câu báo tiến độ (§4).
  - **Bảng câu chủ nhà hay gõ → cách áp** (ánh xạ sang `research_brief` / `cancel_child` — §5).
  - **Mức 3**: quy trình đuổi trích dẫn lùi/tiến + tiêu chí bão hoà (§3).

1.6 **Nhắc trong prompt**: thêm vào `RESEARCH_INSTRUCTIONS` (`roles.py:140-152`) một câu trỏ skill: `research-team` (bảng ba mức, luật đọc, mẫu hồ sơ) + một câu vào `ORCHESTRATOR_INSTRUCTIONS` (khối mô tả công cụ trong `runtime.py:96-119`) nói rằng việc nghiên cứu phải mở đầu bằng `research_brief` rồi mới `delegate_task`.

1.7 **Điều phối (đo được → thiết kế):**

| Luật owner (#5961/#5982) | Đo được hôm nay | Việc của C |
| --- | --- | --- |
| Chỉ main nói với chủ nhà | Con `decision()` ném `DECISION_UNAVAILABLE` khi có `parent_id` (`runtime.py:3972-3979`); chỉ orchestrator `delegate_task` được (`:4969-4970`) ⇒ **harness đã đúng** | Viết 1 dòng trong skill: gặp chỗ cần quyết ⇒ con ghi vào `## Limitations & open questions`, main gom lại và hỏi một lần |
| Main tự chia nhánh theo việc | `FANOUT_PER_PARENT_DEFAULT=3`/`MAX=6`, 12 con mỗi lượt (`limits.py:105-111`) | Bảng ba mức cho số nhánh (§1.1) + cổng đếm nhánh theo mức (§1.4) |
| Danh mục nhắc nằm **trong skill** | Hôm nay `RESEARCH_INSTRUCTIONS` chỉ có 5 bước chung chung, không nhắc theo lĩnh vực (`roles.py:140-152`) | Mục "Danh mục nhắc" trong `research-team` (§1.5) + luật: main **dán** dòng nhắc đúng lĩnh vực vào `context` của con (kiểm bằng mắt trong ca R2/R4) |
| Việc liên quan gộp **một** con | Không có luật nào; model tự do tách | Luật + ví dụ trong skill; mã hoá bằng thông điệp lỗi `RESEARCH_BRANCH_LIMIT` **nêu sẵn cách sửa "gộp lại"** (§1.4); mục "gộp hay tách" trong mẫu hồ sơ |

**Nghiệm thu C-1 (máy kiểm được):**
- `backend/tests/unit/test_research_brief.py` (mới): (a) thiếu/ sai `tier` ⇒ kẹp về 2 + notice; (b) `ceilingSeconds=99999` ⇒ kẹp `1200` + notice `RESEARCH_CEILING_CLAMPED`; (c) mức 3 ⇒ `critique=True`; (d) nâng mức trong cùng lượt ⇒ `RESEARCH_BRIEF_RAISE_REFUSED`; (e) role khác gọi ⇒ `PermissionError`; (f) `config['research']` được lưu và hàng `D:` xuất hiện đúng một lần.
- `backend/tests/unit/test_delegate_research_tier.py` (mới): mức 1 ⇒ con nhận `deadlineSeconds == 180`, mức 2 ⇒ `420`, mức 3 ⇒ `900` **và không** vượt `CHILD_DEADLINE_SECONDS`; không có brief ⇒ **bằng đúng giá trị hôm nay** (test hồi quy, so với `a670e0e`).
- Test đếm nhánh: mức 2 + mở con thứ 4 ⇒ `RESEARCH_BRANCH_LIMIT`.
- `test_skills_catalog.py`: `research-team` nằm trong `DEFAULT_SKILLS` và trong `ROLE_SKILLS['research']`; `skill_view('research-team')` trả về file (không auto-run script — `tool_contracts.py:69`).
- Kiểm bằng mắt: một lượt research thật ở mức 2 → trong `events` có `notice{code:'RESEARCH_BRIEF'}` và bảng hạn mức đúng.

#### 2. **[sau 1] C-2 — Đầu ra 100% là tệp: `dossier_write` + phòng `.research/` + hình dạng hồ sơ theo mức**

**Hiện trạng:** con research không có tool ghi tệp (`roles.py:18`), câu trả lời bị cắt 8 000 ký tự (`runtime.py:1015`), và kết quả công cụ trong transcript bị cắt ở 24 000 → 20 000 ký tự (`runtime.py:3376-3377`); `file_read` chỉ trả 30 000 ký tự, không `offset` (`sandbox/worker.py:103-133`). ⇒ Không có đường nào để độ sâu về tới chủ nhà.

**Thay đổi:**

2.1 **Op box `dossier_write`** trong `backend/src/agentbox/sandbox/worker.py`, khuôn theo `write_plan` (`:476-518`):
- Hằng mới cạnh `PLAN_ROOM` (`:80`): `DOSSIER_ROOM = '.research'`, `DOSSIER_MAX_BYTES = 262144` (256 KiB/tệp), `DOSSIER_PATH_RE = re.compile(r'^\.research/[a-z0-9][a-z0-9._-]{0,40}/[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}\.md$')`.
- Hàm `dossier_write_payload(args)`: kiểm `path` khớp regex (sai ⇒ `ValueError('DOSSIER_PATH_INVALID: .research/<việc>/<tên>.md')`); ghi qua `path()` (đã chặn thoát `ROOT`, `:83-88`), tạo thư mục cha, `write_text(..., exclusive=False)` (cho phép ghi đè trong cùng việc — khác `write_plan` vốn `exclusive=True`), chặn `len(markdown.encode()) > DOSSIER_MAX_BYTES` ⇒ `ValueError('DOSSIER_TOO_LARGE')`; trả `{'path','bytes','sha1','title','writtenAt'}`.
- Nối vào bảng op (`:565-578`) **cạnh** `write_plan`; **không** đụng `SESSION_OP_NAMES` (`:524`) hay `EVIDENCE_*`.
- Ghi chú kèm trong docstring: `worker.py` đi nguyên văn theo `executor.py:12` ⇒ thêm op **không cần dựng lại box**; không cần `deploy/docker/*` thay đổi gì.

2.2 **Tool `dossier_write`** phía harness: schema trong `tool_contracts.py` cạnh `write_plan` (`path`, `markdown`, `title` tuỳ chọn; mô tả nói rõ: "ghi hồ sơ vào phòng `.research/<việc>/`, mỗi bản một tệp; **không** dùng để ghi mã nguồn"), dispatch trong `runtime.py:3506` như `write_plan`. Role: thêm `dossier_write` vào `RESEARCH` (`roles.py:18`) **và** `ORCHESTRATOR_TOOLS` (`roles.py:185-186`). `allowed_tools` (`roles.py:189-201`) tự lọc theo cha ⇒ con research của main có tool này, con của role khác thì không — đúng ý "chuyên cho agent research".

2.3 **Chốt phòng hồ sơ với harness:** `runtime.dossier_write` kiểm `path` phải nằm trong `session['config']['research']['dossierDir']` khi phiên có brief (sai phòng ⇒ `ValueError('DOSSIER_DIR_MISMATCH: …')`); phiên con nhận `dossierDir` qua `context` nên phải tự dán đúng tiền tố — luật này ghi trong skill. Không có brief ⇒ cho phép ghi nhưng phát notice `RESEARCH_BRIEF_MISSING` (đường lùi để thử tay).

2.4 **Lệnh gọi lại tệp trong chat:** main kết thúc bằng **báo cáo ngắn** (xem 2.6) có danh sách tệp; frontend hiện đã render liên kết tệp bằng `isEvidenceFileLink` (`frontend/src/components/chat/MarkdownRenderer.tsx:133`). Mở rộng nhận diện cho mọi đường dẫn tương đối nằm dưới `.research/` (thêm hằng `DOSSIER_PREFIX = '.research/'` vào `normalizeArtifactPath`, giữ **nguyên** thứ tự kiểm: evidence-file **trước** `isImageLink`, `:125`/`:133`/`:403-446` — F5). Không dựng khối/badge quanh câu trả lời cuối (D-19–D-25/F2).

2.5 **Đường đọc lại cho main:** main (orchestrator) **đã có** `file_read` (`WRITE ⊇ READ`, `roles.py:13-15`) ⇒ đọc được hồ sơ từng phần 30 000 ký tự/lần; với hồ sơ dài, main đọc theo tệp nhỏ đã chia (dưới đây). Việc thêm `offset/limit` cho `file_read` là **Phạm vi A** — plan này chỉ ghi phụ thuộc, không tự làm.

2.6 **Hình dạng hồ sơ theo mức** (đưa vào skill; số tệp là **tạm**, xem `[MỞ]` §M2):

| Mức | Tệp trong `.research/<việc>/` | Nội dung tối thiểu | Chat |
| --- | --- | --- | --- |
| 1 | `note.md` | câu trả lời ngắn + nguồn đã mở (URL/tệp) + đoạn trích nguyên văn + ngày lấy | 3–6 dòng + đường dẫn |
| 2 | `report.md` + `sources.md` | `report.md`: khung — câu hỏi, phạm vi, phát hiện theo nhóm, mâu thuẫn còn lại, việc chưa làm; `sources.md`: mỗi dòng một nguồn (tiêu đề, URL, ngày lấy, đoạn trích) — **sinh từ sổ nguồn của B** | báo cáo ngắn có bảng nguồn rút gọn + danh sách tệp |
| 3 | `dossier.md` + `branches/<nhánh>.md` (mỗi nhánh một tệp) + `conflicts.md` + `critique.md` + `sources.md` | `dossier.md`: hồ sơ đầy đủ + bảng mâu thuẫn + nhánh nào đã đối chiếu chéo + biên bản phản biện; `critique.md` do **con phản biện** ghi (B) | báo cáo ngắn + bảng mâu thuẫn rút gọn (2–3 dòng) + danh sách tệp |

Mỗi tệp **phải** mở đầu bằng khối front matter 4 dòng cố định (máy kiểm được, và để cổng `research_quality` của B đọc):
```
Mức: 2 · Hồ sơ: thi-truong
Câu hỏi: <nguyên văn>
Nhánh: <tên nhánh hoặc "chính">
Đã mở: <n> nguồn (<danh sách host>)
```
2.7 **Luật ghi tệp cho con** (trong skill + `RESEARCH_INSTRUCTIONS`): mỗi con **phải** ghi **một** tệp cho nhánh mình (khảo sát dài thì chia `branches/<nhánh>-pN.md`, mỗi tệp ≤ 256 KiB) và câu trả lời gửi về main (≤ 8 000 ký tự) chỉ chứa: kết luận chính, số liệu then chốt, **đường dẫn tệp**, mục "Đã mở" và "Chưa mở được". Trần 8 000 ký tự **giữ nguyên** (không nới, tránh rủi ro transcript/compaction) — độ sâu chuyển sang tệp.

**Nghiệm thu C-2:**
- `backend/tests/unit/test_worker_dossier.py` (mới, gọi thẳng op qua `worker.execute`): ghi hợp lệ; `path` ngoài `.research/` ⇒ `DOSSIER_PATH_INVALID`; vượt 256 KiB ⇒ `DOSSIER_TOO_LARGE`; traversal `../../etc/passwd` ⇒ bị `path()` chặn; ghi đè cùng đường dẫn ⇒ OK + sha1 đổi.
- `backend/tests/unit/test_dossier_write_tool.py` (mới): role `research` có `dossier_write` trong `allowed_tools`; role `plan` **không**; sai `dossierDir` ⇒ `DOSSIER_DIR_MISMATCH`; phiên con của main dùng được, phiên con của con ⇒ `PermissionError('Leaf agents cannot delegate')` không liên quan nhưng con của con không tồn tại (D-11 giữ nguyên).
- Đo thật (offline, dùng fixture tài liệu dài trong workspace): một nhánh research mức 2 ghi `branches/…md` **34 000 ký tự**; main nhận `summary` ≤ 8 000 ký tự **có** đường dẫn; `file_read` đọc lại đủ nội dung. Ghi số vào `docs/tracking/eval-tier0-regression.md` mục mới "research dossier".
- Hồi quy UI: `frontend/src/components/chat/MarkdownRenderer.test.tsx` — thêm ca `.research/x/y.md` ⇒ render thành link tệp, ảnh vẫn đi đúng nhánh `isImageLink` (thứ tự kiểm không đổi).

#### 3. **[sau 1] C-3 — Bốn pha và mức 3 đuổi trích dẫn + bão hoà**

**Hiện trạng:** hướng dẫn research chỉ có 5 bước prompt (`roles.py:140-152`), không có pha, không có đuổi trích dẫn, không có tiêu chí dừng; đo được ở `/var/tmp/v27/feasibility-probes.md`: một lần `web_fetch` chỉ cho 8 000 ký tự, kết quả tìm kiếm chỉ là snippet ≤ 400 ký tự (`web.py:51-57`) ⇒ nếu không có luật, model dừng ở snippet. Việc **nối công cụ đuổi trích dẫn** (OpenAlex/Crossref/arXiv, chuyển tiếp) là **Phạm vi A** — C chỉ định nghĩa *khi nào gọi và dừng ở đâu*.

**Thay đổi (skill + nhắc, không thêm mã điều khiển):**

3.1 **SOP bốn pha** trong `research-team/SKILL.md`, mỗi pha có điều kiện hoàn thành máy-đọc-được (ghi vào `dossier.md` mục "Tiến trình"):
- **Pha 1 — Bản đồ (scoping):** liệt kê 5–12 câu hỏi con, phân loại theo nguồn nào có thể trả lời (cơ quan chính thức / bài báo / tài liệu kỹ thuật / dữ liệu thị trường), chỉ ra chỗ mơ hồ. Xong khi: mỗi câu hỏi con có ít nhất một nguồn ứng viên, và số nhánh ≤ `RESEARCH_TIER_BRANCHES[tier]`.
- **Pha 2 — Chốt (plan + mức + ngân sách):** gọi `research_brief` (tier, jobProfile, branches, ceilingSeconds, rationale) rồi `delegate_task` cho từng nhánh. Xong khi: brief đã ghi và mọi nhánh đã có con chạy.
- **Pha 3 — Đào sâu:** mỗi con mở nguồn thật, trích nguyên văn vào sổ, ghi tệp nhánh; main gộp, phát hiện chỗ trống, mở thêm nhánh **trong hạn mức mức**; mâu thuẫn ghi vào `conflicts.md`. Xong khi: mỗi câu hỏi con ở pha 1 có kết luận hoặc một dòng "không tìm được nguồn nào đủ".
- **Pha 4 — Phản biện độc lập:** con `research-critique` (đăng ký ở **Phạm vi B**; C chỉ gọi) chạy trên `dossier.md`; verdict `revise` ⇒ sửa **một** vòng; vẫn `revise` ⇒ giao kèm nhãn "chưa đạt" (#5968). C cung cấp: (a) skill nói rõ *khi nào* gọi (mức 3, bắt buộc; hoặc bất kỳ mức khi hợp đồng/giá/định danh then chốt); (b) main phải chờ verdict trước khi viết báo cáo cuối — cơ chế chờ đã có sẵn (`await_children`, `PEER_DELIVER_MAX`, trần chờ 300 s giữ nguyên).

3.2 **Luật đuổi trích dẫn mức 3 (#5967)** trong skill, viết như quy trình chứ không phải khẩu hiệu:
- *Lùi (backward):* với mỗi bài/bài toán chính, mở danh sách tham chiếu; chọn **tối đa 5** mục mà phần kết luận của bài dựa vào, mở và cập nhật sổ; nếu nguồn gốc là văn bản pháp luật/quy chuẩn thì phải mở bản gốc (hoặc ghi `chưa mở được bản gốc`).
- *Tiến (forward):* gọi nguồn trích dẫn của A (OpenAlex `filter=cites:…`, Crossref/Europe PMC tuỳ lĩnh vực); lấy tối đa 10 kết quả mới nhất, chọn những cái **phản biện trực tiếp** hoặc có số liệu mới hơn.
- *Bão hoà (điều kiện dừng):* dừng khi **hai vòng liên tiếp** không sinh nguồn mới làm đổi kết luận, **và** mọi "khẳng định then chốt" đã có ≥ 2 nguồn độc lập (hoặc 1 nguồn tier 1 — luật #5985/#5996 thuộc B); bắt buộc ghi lại *đã chạy mấy vòng, vòng nào sinh nguồn mới* vào `dossier.md`. Trần cứng để không treo: tối đa 3 vòng hoặc hết ngân sách (C-6), tuỳ cái nào tới trước. Số "2 vòng / 3 vòng / 5 tham chiếu" là **tạm** — xem `[MỞ]` §M3.
- *Chống trôi:* nếu bão hoà chưa đạt mà hết ngân sách ⇒ báo cáo cuối phải ghi "còn chỗ chưa bão hoà: <danh sách>" (không được im lặng).

**Nghiệm thu C-3:** không có oracle máy cho "kỹ"; đo bằng (a) bộ ca R (C-7) — ca R4 kiểm đúng chuỗi hành vi "mở bản gốc + 2 vòng đuổi + ghi nhật ký vòng"; (b) kiểm chéo thủ công trên 1 bài thật: đếm `web_fetch` thật tới host của bài gốc ≥ 1 và số mục trong `sources.md` ≥ 5 (B cung cấp số). Ghi kết quả vào `docs/tracking/test-rounds.md`.

#### 4. **[song song 2] C-4 — Nhịp báo tiến độ theo mốc (#5969)**

**Hiện trạng:** timeline **đã** render câu trả lời giữa lượt: `frontend/src/components/chat/HarnessStepView.tsx:1134-1154` — `assistant` với `final !== false` đóng lượt, còn `assistant` không-final được đẩy vào mục `text` giữa lượt; `notice` (`:1212-1224`) cũng render được. Đồng nghĩa **không cần UI mới** cho nhịp báo. Cái thiếu là luật cho model và một cái đồng hồ nhắc.

**Thay đổi:**
4.1 **Luật trong skill**: sau **mỗi** kết quả con giao tới (`[Kết quả từ chuyên gia …]`) và trước mỗi đợt mở nhánh mới, main viết **một** đoạn ngắn (1–3 dòng) dạng câu trả lời thường, mẫu cố định: `Đang ở: <pha> · Đã xong: <…> · Còn lại: <…> · Chờ: <nhánh nào>`. Không mở mục `###`, không bọc khối, không badge (D-19–D-25/F2), không gọi công cụ nào cho việc này.
4.2 **Đồng hồ nhắc trong harness** (`runtime.py`, cạnh `drain_peer_deliveries`): hàm `nudge_research_progress(sid, messages)`:
- Điều kiện phát: phiên gốc có brief, lượt đang chạy, `now - lastProgressAt >= RESEARCH_PROGRESS_NUDGE_SECONDS` (600 s), và **có ít nhất một con đang mở** (`store.children_of(sid)` với `status='started'`).
- Hành động: chèn vào `messages` một mục `role='user'` với tiền tố hằng số `RESEARCH_NUDGE_PREFIX = '[Nhịp tiến độ: ` cho main; ghi `system_log.write('research.progress.nudged', …)`; **không** phát event (không đụng đếm lượt/UI). Mục này bị `turn_prompt_excerpt` bỏ qua, giống cách `PEER_DELIVERY_PREFIX` (`runtime.py:1030`, `:1161-1173`) đang bị bỏ qua — thêm tiền tố mới vào đúng hàm đó.
- Đặt `lastProgressAt` mỗi khi main phát một `assistant` không-final, và khi bơm kết quả con.
- Gọi từ `runtime.py:3024` (ngay sau `drain_peer_deliveries`, trước `store.emit('step')`) — cùng một mốc bước, không tạo đường đi mới.
- Env `BOXFOX_RESEARCH_PROGRESS` (`on|off`, mặc định `on`) để tắt khi đo.
4.3 **Trần chống ồn:** tối đa `RESEARCH_PROGRESS_MAX_PER_TURN = 12` lần nhắc mỗi lượt; vượt ⇒ log `research.progress.capped` và thôi nhắc (không ném lỗi).

**Nghiệm thu C-4:** `backend/tests/unit/test_research_progress.py` (mới) với đồng hồ giả: (a) con đang mở + 601 s ⇒ đúng 1 mục `user` có tiền tố, `turn_index` không tăng (đếm `_turn_index` bằng `store` — cùng kỹ thuật test đã có cho control command); (b) không có con nào ⇒ không bơm; (c) `off` ⇒ không bơm; (d) 13 lần ⇒ cắt ở 12 + log; (e) `turn_prompt_excerpt` bỏ qua mục có tiền tố. Kiểm bằng mắt: một lượt mức 2 dài → trong timeline thấy dòng tiến độ xen giữa các bước, **không** có khối mới.

#### 5. **[song song 2] C-5 — Can thiệp giữa lúc chạy: `session_steers` + `drain_steers` + `cancel_child` (#5981)**

**Hiện trạng (đo được):** `RuntimeCommands.submit` chặn prompt thường khi `busy` (`runtime_commands.py:39-41`) ⇒ 409 `SESSION_BUSY` (`server.py:150-160`); lệnh điều khiển được phép trong lúc chạy chỉ gồm `INFO = {'help','skills','agents','status','context'}` và `stop`, `compact` (`skills/commands.py:155-200`, `runtime_commands.py:47-128`), và chúng **không nhận tham số**. Không có cách nào để chủ nhà nói "dừng nhánh luật" hay "hạ xuống mức 2". Tiền lệ bơm chữ giữa lượt: `drain_peer_deliveries` + `claim_deliveries` (`runtime.py:4932-4965`, `session_store.py:483-500`).

**Thay đổi:**

5.1 **Bảng `session_steers`** — thêm vào `memory/session_store.py` cạnh `child_deliveries` (`:100-107`) như một bảng mới trong cùng script tạo bảng (additive; `_add_missing_columns` chỉ lo cột, bảng mới thì `CREATE TABLE IF NOT EXISTS` trong khối `executescript`):
```sql
CREATE TABLE IF NOT EXISTS session_steers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL, turn INTEGER, text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',          -- pending | injected | skipped
  created REAL, injected REAL, skip_reason TEXT
)
```
API mới: `queue_steer(sid, text, turn)`, `claim_steers(sid, turn, limit=2)` (một `UPDATE … SET state='injected', injected=? WHERE id IN (SELECT … WHERE state='pending' ORDER BY id LIMIT ?)` trong **một** giao dịch — đúng khuôn chống trùng của `claim_deliveries`), `mark_steer(id, state, skip_reason=None)`, `pending_steer_count(sid)`. Bảng **tự lọc theo `session_id` + `turn`** (F11 — không quét `events`, không phụ thuộc trần 500 hàng).

5.2 **Nhận chỉ thị khi đang bận** — sửa `RuntimeCommands.submit` (`skills/runtime_commands.py:39-41`): khi `busy` và `resolved.kind == 'message'`:
- Nếu phiên là **con** (`session.get('parent_id')`) ⇒ giữ nguyên `ValueError('SESSION_BUSY: Turn in progress')` (chỉ chủ nhà mới gõ vào phiên gốc).
- Nếu là phiên gốc và `BOXFOX_STEER != 'off'`: gọi `store.queue_steer(sid, prompt, session['turn_count'])`, phát event `user` với `{'control': True, 'steer': True}` (để `_turn_index` **không** đếm — `runtime.py:2726-2733`), `system_log.write('steer.queued', …)`, trả `{'status': 'steered', 'steerId': id}`. Route `POST /turn` (`server.py:365-374`) đã trả 202 cho mọi `status == 'running'`; thêm `'steered'` vào cùng nhánh 202 để UI thấy "đã nhận" chứ không phải lỗi.
- Khi `BOXFOX_STEER == 'off'` ⇒ hành vi y hôm nay (409) + notice `STEER_DISABLED` (để không im lặng đổi hành vi — cùng nguyên tắc `mode_from_env`, `runtime.py:971-984`).
- Trần chống lạm dụng: tối đa `STEER_MAX_PENDING = 5` chỉ thị chờ; vượt ⇒ `ValueError('STEER_QUEUE_FULL: chờ main áp chỉ thị trước')`.

5.3 **Bơm chỉ thị vào lượt đang chạy** — `drain_steers(sid, messages)` trong `runtime.py`, **ngay sau** `drain_peer_deliveries` tại `:3024`:
- Lấy `claim_steers(sid, turn, limit=2)`; mỗi chỉ thị chèn một mục `user` với tiền tố hằng số `OWNER_STEER_PREFIX = '[Chỉ thị giữa lượt của chủ nhà]'` + nguyên văn; log `steer.injected`; đánh dấu `mark_steer(id,'injected')` sau khi lưu `store.save(sid, messages)`.
- Chỉ thị còn chờ khi lượt kết thúc ⇒ giữ `pending`; `runtime.start()` của lượt sau gọi `drain_steers` ở bước 0 (thêm một lần gọi ngay sau `begin_turn`) để không bỏ rơi chỉ thị.
- Nhật ký: mỗi chỉ thị sinh **một hàng `D:`** qua `journal.record('D', 'chủ nhà can thiệp giữa lượt: <text>', sid=…, turn=…, data={'kind':'owner-steer'})` để hồ sơ/báo cáo cuối trích được.
- Bảo vệ D-10/D-12/D-13: `drain_steers` **không** gọi công cụ, không phát event, không đụng trần chờ.

5.4 **Nối chỉ thị với quyền đổi phạm vi** — không cần mã riêng: skill dạy main đọc chỉ thị rồi tái gọi `research_brief` (chỉ được **hạ** mức/trần — 1.2 đã cài luật này) và/hoặc gộp lại nhánh. Bảng ánh xạ trong skill:
| Chủ nhà gõ | Main làm |
| --- | --- |
| "dừng nhánh X" | gọi `cancel_child(sessionId của nhánh X, reason='chủ nhà dừng')` |
| "hạ xuống mức 2" | gọi `research_brief(tier=2, …)` (được phép: hạ) |
| "bỏ phần khảo sát giá" | đánh dấu nhánh bỏ trong `dossier.md` + `cancel_child` nếu nhánh còn chạy |
| "nhanh hơn / gọn hơn" | hạ trần lượt, gộp nhánh, chốt sớm vòng bão hoà |
| "kỹ hơn" | **không tự nâng** ⇒ hỏi chủ nhà qua `ask_user` (nâng mức là việc lượt sau, xem `[MỞ]` §M4) |

5.5 **Tool `cancel_child`** (orchestrator-only; schema trong `tool_contracts.py`, dispatch trong `runtime.py`): `sessionId` (bắt buộc), `reason` (bắt buộc). Kiểm: phiên đó phải là con trực tiếp của phiên này (`store.get(child_id)['parent_id'] == sid`), nếu không ⇒ `ValueError('NOT_YOUR_CHILD')`. Thực thi: dùng **đúng đường đóng con sẵn có** (khuôn `peer_watchdog._close`, `peer_watchdog.py:124-146`): `store.child_close_once(child_id, 'failed', reason='OWNER_CANCELLED', …)` + `store.save(child_id, messages, 'cancelled')` + phát event `child` với `{'status':'failed','reason':'OWNER_CANCELLED','cancelledBy':'owner','is_error':False}` + nhả slot fan-out (`release_child_slot`, `runtime.py:1885-1920`) + `system_log.write('steer.child_cancelled', …)`. **Không** thêm giá trị `status` mới cho session (§5(1)): `'cancelled'` đã tồn tại trong `sessions`; sổ con vẫn dùng `'failed'` + `reason` như watchdog đang làm. Nếu con đã đóng ⇒ trả `{'status':'already_closed'}` (không ném lỗi).
Frontend: khi `child` event có `cancelledBy === 'owner'`, panel nhánh hiện "chủ nhà dừng" thay vì "lỗi" (một dòng trong `frontend/src/components/chat/HarnessStepView.tsx`, chỗ render event `child`; thêm ca vào `HarnessStepView.test.tsx` sẵn có — chỗ render `case 'child'`), **không** badge quanh câu trả lời.

5.6 **UI composer khi đang chạy** (điểm chạm duy nhất cần đổi nhiều):
- `frontend/src/components/panels/ChatPanel.tsx`: `isBusy` (`:196-206`) chỉ khoá nút gửi khi `status === 'starting'`; khi `running`/`awaiting_decision` ⇒ cho gửi với nhãn "Gửi cho lượt đang chạy" + dòng chú thích "áp dụng ở bước kế tiếp".
- `frontend/src/store/harnessChatStore.ts`: xử lý `202 {status:'steered'}` ⇒ hiện dòng xác nhận "đã xếp hàng · sẽ áp ở bước kế", **không** đóng lượt, không xoá nội dung đang chạy; giữ `SESSION_BUSY` trong `HARNESS_ERROR_CODES` cho trường hợp `BOXFOX_STEER=off`.
- `frontend/src/components/chat/HarnessStepView.tsx`: event `user` có `steer:true` render như bong bóng người dùng ở vị trí thời gian thật + nhãn nhỏ "can thiệp" (không phải khối quanh câu trả lời).
- i18n: `frontend/src/i18n/*` thêm khoá cho "Gửi cho lượt đang chạy", "đã xếp hàng", "can thiệp", "chủ nhà dừng".
- **Test phải cập nhật (đừng để đỏ):** `ChatPanel.test.tsx` (ca "busy ⇒ khoá composer", khoảng `:383`), `harnessChatStore.decisionBusy.test.ts`, `harnessChatStore.test.ts` (ánh xạ status→busy).

**Nghiệm thu C-5:**
- `backend/tests/unit/test_steer_queue.py` (mới): queue→claim một lần (hai lần `claim` không trả lại bản ghi cũ); chỉ thị của lượt cũ giữ `pending` rồi được bơm ở lượt sau; `STEER_QUEUE_FULL` ở chỉ thị thứ 6; phiên con ⇒ vẫn 409.
- `backend/tests/integration/test_steer_midturn.py` (mới, chạy hết chuỗi thật offline): lượt đang chạy → `POST /turn` trả 202 `steered` → tới bước kế, transcript có mục `[Chỉ thị giữa lượt của chủ nhà]` → hàng `D:` xuất hiện đúng một lần; `_turn_index` không tăng.
- `test_cancel_child.py` (mới): dừng một nhánh ⇒ sổ con `failed`/`OWNER_CANCELLED`, session con `cancelled`, event `child` đúng một lần (`child_close_once` idempotent), slot fan-out được nhả (mở được nhánh mới ngay), gọi lần hai ⇒ `already_closed`.
- Test frontend: 3 tệp trên xanh sau khi cập nhật; ca mới "running ⇒ gửi được chỉ thị" và "steered ⇒ hiện dòng xác nhận".

#### 6. **[sau 1] C-6 — Ngân sách và nút duyệt việc lớn (#5964)**

**Hiện trạng:** đã có `request_approval(action, reason, options, deadlineSeconds, …)` (`tool_contracts.py:160-162`), mặc định `DECISION_DEFAULT_SECONDS = {'ask_user': 300.0, 'request_approval': 600.0}` (`runtime.py:882`), hết hạn ⇒ `defaultChoice='reject'`; `wait_for_decision` tạm hoãn đồng hồ lượt (`budget.reschedule(None)`); `extend_turn_budget(sid, reason)` là tiền lệ mở rộng lượt **một lần**, tối đa `DEADLINE_MAX_SECONDS` (`runtime.py:2472-2505`) và phát notice `TURN_EXTENDED`. Chưa có khái niệm "trần cho việc nghiên cứu" và harness **chưa** nhận USD từ router (chỉ nhận `usage` thô: `runtime.py:3300`).

**Thay đổi:**
6.1 **Luật ngân sách trong skill**, gắn vào `research_brief`:
- Việc nhỏ (mức 1, mức 2 trong hạn mức ngày thường) ⇒ chạy luôn, không xin gì; brief ghi `ceilingSeconds` mặc định của mức.
- Việc lớn ⇒ **trước khi** mở nhánh: gọi `research_brief(...)` rồi `request_approval(action='research-budget: <việc> · mức <n> · khoảng <m> phút · <k> nhánh', reason='<vì sao cần ngần này>', options=['approve','reject','alternative'])`. Ngưỡng "lớn" (tạm, `[MỞ]` §M5): mức 3 **hoặc** dự kiến > 10 phút **hoặc** > 3 nhánh.
- Chủ nhà bấm `approve` ⇒ main giữ nguyên trần; `alternative` ⇒ chủ nhà ghi phương án khác (giảm mức/gộp nhánh/bỏ phần) — main áp đúng cái đó; `reject`/hết hạn ⇒ main hạ về mức 2 với hạn mức mặc định và **nói rõ trong báo cáo cuối** "chủ nhà chưa duyệt ngân sách, đã chạy bản gọn".
- Báo cáo cuối **luôn** có một dòng ngân sách: `Ngân sách: mức <n> · đã dùng <mm:ss> / trần <mm:ss> · <n> nhánh · <token> token`.
6.2 **Mã hoá trần vào lượt:** sau khi `approve`, main gọi lại `research_brief` với `ceilingSeconds` đã chốt (hạ/kẹp như 1.2). Nếu cần **vượt** `DEADLINE_MAX_SECONDS` (1 200 s) ⇒ dùng `extend_turn_budget` hiện có (một lần, tối đa `DEADLINE_MAX_SECONDS`) — **không** tự nới thêm; mức 3 dài hơn nữa là `[MỞ]` §M1 và phải có D-number mới (F9/D-12).
6.3 **Đếm để hiển thị:** số token lấy từ event `usage` (`runtime.py:3300`) cộng dồn theo lượt (hàm `peer_turn_cost` đã làm việc cộng theo con — `runtime.py:2006`; chỉ cần thêm tổng theo lượt nếu chưa có). **Không** hiển thị USD khi router chưa trả `cost` cho harness; ghi rõ trong skill: "chi phí bằng USD chưa đo được ở harness — đừng bịa số".

**Nghiệm thu C-6:** test `test_research_budget_approval.py` (mới): mức 3 chưa duyệt ⇒ thấy đúng một `decision_requested` với `action` bắt đầu `research-budget`; `approve` ⇒ brief cập nhật trần; `reject` ⇒ notice + báo cáo cuối có câu "chưa duyệt"; hết hạn (đồng hồ giả) ⇒ `reject` mặc định, lượt không treo. Ca hồi quy: đường `request_approval` cũ (kế hoạch) không đổi.

#### 7. **[sau 2] C-7 — Đo lường: bộ ca research `R1–R7` + oracle máy (không cần judge)**

**Hiện trạng:** `benchmark/cases/*` rỗng (7 thư mục chỉ có `.gitkeep`); `scripts/eval/results/tier0-regression/` có `README.md` + `cases.jsonl` + `manifest.json` nhưng **thiếu `scores.jsonl`** ⇒ chưa có lượt chạy thật nào; `JudgeRunner.request` ném `NotImplementedError` (`scripts/eval/judge.py:167-177`) nên `--execute` không sinh điểm tự động (`EXIT_NOT_IMPLEMENTED = 5`, `run_eval.py:35`). Bộ khung đã dùng được: `fixtureset.load_fixtures()` quét cả thư mục `scripts/eval/fixtures/` (`fixtureset.py:63-69`), `logread.py` + `manifest.py` lấy số từ nhật ký hệ thống, `rubric.py` có C1–C8 với `HARD_GATE_DIMENSIONS = ('C2','C7')` (`rubric.py:99`), `rushed_index.py` có S1–S10. Các ca Q3/Q5/Q6/Q7 là ca research **gián tiếp** (Q6: URL phải mở lại được; Q7: kết quả con phải đủ 4 mục) nhưng **không** ca nào đo "đọc kỹ".

**Thay đổi:**
7.1 **Thêm 7 fixture mới** `scripts/eval/fixtures/R1.json … R7.json`, **đúng schema** đang dùng (`id`, `case`, `request`, `oracle_pass`, `bad_answer`, `rubric_dimensions`, `environment{network,workspace}`, `budget{max_steps,deadline_seconds,source}`, `seeds`, `layer1_checks`, `open_questions`, `plan_ref`). Nội dung đề xuất (tên + oracle máy):
| Ca | Việc | Mạng | Oracle máy (layer1_checks) |
| --- | --- | --- | --- |
| R1 | mức 1: một dữ kiện, nguồn chính thống | off (tài liệu seed) | `dossier_frontmatter_present`, `sources_opened ≥ 1`, `tier_recorded == 1` |
| R2 | mức 2: khảo sát một chủ đề, 3 nhánh | on | `branch_files_exist ≥ 1`, `dossier_files_exist`, `branch_count ≤ 3`, `claims_have_sources` |
| R3 | mức 2: tài liệu dài (trang fixture 200 KB) | off (http.server trong box) | `read_beyond_first_chunk` (có `read_source`/`web_fetch` với `offset`/chunk khác 0 — phần đọc thuộc A), `no_snippet_cited_as_read` |
| R4 | mức 3: đuổi trích dẫn lùi + tiến + bão hoà | off + thư viện seed (OpenAlex JSON seed) | `citation_chase_logged ≥ 1 vòng lùi và ≥ 1 vòng tiến`, `saturation_logged`, `conflicts_file_exists`, `critique_file_exists` |
| R5 | mức 3: hai nguồn mâu thuẫn về cùng con số | off (seed) | `conflict_row_present` (tệp `conflicts.md` có hàng cho con số đó), `dual_source_declared` |
| R6 | phiên mơ hồ: **không** nói mức | off | `tier_recorded == 2` (đúng #5965) + notice `RESEARCH_BRIEF` tồn tại |
| R7 | mức 2 nhưng main bị chặn nguồn (trang lỗi 403) | off | `blocked_source_recorded` (chuỗi `chưa mở được bản gốc`), `no_fabricated_url`, `no_unread_snippet` |
7.2 **Module oracle máy** `scripts/eval/research_checks.py`: mỗi `layer1_checks` là một hàm thuần đọc **hai đầu vào**: (a) thư mục workspace của phiên (tệp `.research/**`, dùng lại cách `worker.py` đọc), (b) bản ghi event qua `logread.py`. Hàm trả `{name, ok, detail}`. **Không** dùng LLM ⇒ chạy được offline, không cần vốn, không cần mạng. Bổ sung đúng những tên phải dùng vào `scripts/eval/rubric.py` như một khối hằng riêng `RESEARCH_CHECKS` (không sửa C1–C8, không đổi `HARD_GATE_DIMENSIONS`).
7.3 **Thước đo "thật kỹ"** — mỗi ca R in một dòng 5 số (đúng khuôn 5 chiều của brief Phạm vi C): `factual_accuracy` (oracle máy: khẳng định có nguồn / tổng khẳng định), `citation_precision` (nguồn mở được và khớp đoạn trích / tổng nguồn — số này lấy từ sổ nguồn B nếu có, không thì từ `sources.md`), `coverage` (số nhánh có kết luận / số nhánh mở), `source_quality` (phân bố tier 1–4 — thang của B), `efficiency` (số bước + giây đã dùng / trần của mức). Ghi ra `scripts/eval/results/tier-r1-research/{cases.jsonl, manifest.json, scores.jsonl}` cùng khuôn `tier0-regression`.
7.4 **Thêm tier vào kế hoạch chạy**: `scripts/eval/benchmarks/tier-r1.md` + một mục trong `scripts/eval/benchmarks/tiers.json` để `run_eval.py` tính được khối lượng (`build_plan`, `quality_estimate`) mà **không** cần `--execute` (không tiêu tiền, không vướng judge `NotImplementedError`).
7.5 **Nối với UI**: `scores.jsonl` là tệp chủ nhà đọc được; thêm một dòng trong `docs/tracking/eval-tier0-regression.md` trỏ sang tệp điểm mới. **Không** hứa hẹn "đã có benchmark GAIA/quality" (F19) — chỉ nói đúng: "bộ ca R + oracle máy".

**Nghiệm thu C-7:** `python3 scripts/eval/run_eval.py --plan --fixtures R1 --tier tier-r1` in ra kế hoạch có R1 (chứng minh fixture được nhận); `pytest backend/tests/unit/test_research_checks.py` (mới) — mỗi hàm oracle có 1 ca đúng + 1 ca sai (tệp thiếu front matter, thiếu hàng mâu thuẫn, có snippet không nguồn…); chạy R1+R3+R6+R7 (nhóm offline) trên 3 lượt thật và ghi số lần đầu vào `scores.jsonl`.

#### 8. **[sau 2] C-8 — Tài liệu: sửa hai chỗ lệch, thêm trang kiến trúc, cập nhật sổ theo dõi**

**Hiện trạng (số liệu sai đã đo):** `docs/architecture/tools-and-skills.md:128-129` ghi `web_search(query, max_results?: int)` và `web_extract(url)` — schema thật (`tool_contracts.py`) là `web_search(query, count, source)` / `web_fetch(url, maxChars)`, và `web_extract` **không tồn tại** (F22, `grounded-citations` trỏ sai tên tool 5 lần). `docs/plan/cua-benchmark-plan.md:44,73` nói BoxFox "chưa có tool tìm kiếm" và vì thế chặn GAIA level 1 — đã lệch từ vòng 9 (F21).

**Thay đổi:**
8.1 Sửa bảng §"Nhóm 6: Bộ Nhớ, Lịch Sử & Nghiên Cứu Tài Liệu" trong `docs/architecture/tools-and-skills.md`: lấy **nguyên văn** từ `tool_contracts.py` (`web_search`, `web_fetch`, `skill_view`, `delegate_task`, `await_children`, `peer_read`, `journal_write`, `journal_brief`) — thêm một dòng Ghi chú: *"Tên tham số lấy từ `backend/src/agentbox/agent_core/tool_contracts.py`; tài liệu cũ ghi `max_results`/`web_extract` là sai."*
8.2 Sửa `docs/plan/cua-benchmark-plan.md`: (a) dòng 44 — bỏ khẳng định "chưa có tool tìm kiếm", thay bằng mốc "search có từ vòng 9, xem `tool_contracts.py`"; (b) dòng 73 — gỡ lý do chặn GAIA level 1 và ghi lại lý do thật còn vướng (chưa có judge chạy được + chưa cấp ngân sách) — **không** tự mở lại GAIA trong vòng này.
8.3 Trang kiến trúc mới `docs/architecture/research-agent.md`: ba mức + trần (§1.1), luồng bốn pha (§3.1), đường ghi tệp `.research/` + hình dạng hồ sơ (§2), nhịp tiến độ + steer (§4, §5), ngân sách (§6), và **bảng ranh giới A/B/C**. Ghi ở đầu trang: *"Phần nào chưa thi công thì đánh dấu `(spec, chưa có trong mã)`"* — tránh F20.
8.4 Sổ theo dõi theo khuôn vòng 25: `docs/tracking/owner-decisions.md` (ghi #5955–#5998 theo đúng lời owner, kèm mục `[MỞ]`), `docs/tracking/test-rounds.md` (một mục cho mỗi đợt C-1…C-8 với số đo thật), `docs/tracking/bug-register.md` (bug mới nếu phát sinh khi build), `docs/tracking/eval-tier0-regression.md` (mục "research dossier" + trỏ `tier-r1-research`).
8.5 Sửa luôn 3 điểm trôi trong `vendor/hermes/skills/research/grounded-citations/` (tên `web_extract` → `web_fetch`; ghi rõ `gh search`/`xurl`/`reddit-reading` **không** có trong bảng tool của repo; ghi chú `HERMES_HOME` chưa được set ở `backend/src/agentbox`) — đây là tài liệu trong skill, sửa chữ không đổi luồng.

**Nghiệm thu C-8:** `grep -rn "web_extract" docs/ backend/src/agentbox --include=*.md | grep -v CHANGELOG` rỗng; `grep -rn "chưa có tool tìm kiếm" docs/` rỗng; trang `research-agent.md` có mặt và mọi mục ghi rõ đã-có-trong-mã hay spec.

---

### Testing

**Unit (backend)** — mới: `test_research_brief.py`, `test_delegate_research_tier.py` (+ hồi quy "không có brief ⇒ y hôm nay"), `test_worker_dossier.py`, `test_dossier_write_tool.py`, `test_research_progress.py`, `test_steer_queue.py`, `test_cancel_child.py`, `test_research_budget_approval.py`, `test_research_checks.py`; cập nhật: `test_skills_catalog.py` (skill `research-team`), `test_tool_contracts.py` (3 tool mới khớp schema), `test_delegate_task.py` (không đổi khi thiếu brief).
**Integration** — `test_steer_midturn.py` (202 `steered` → bơm ở mốc bước → hàng `D:` đúng một lần → `_turn_index` không tăng); `test_research_dossier_roundtrip.py` (nhánh con ghi tệp 34 KB → main đọc lại đủ → liên kết hiện trong chat); `test_research_tier_e2e.py` mức 1/2/3 với mạng off + tài liệu seed (mức 3 thêm 2 con phản biện giả ⇒ verdict `revise` một vòng rồi `ok`).
**Frontend** — `MarkdownRenderer.test.tsx` (liên kết `.research/**`), `ChatPanel.test.tsx` (đang chạy ⇒ gửi được chỉ thị), `frontend/src/store/harnessChatStore.test.ts` + `harnessChatStore.decisionBusy.test.ts` (202 `steered`, `SESSION_BUSY` khi `BOXFOX_STEER=off`), ca mới "nhãn chủ nhà dừng" cho event `child`.
**Hồi quy toàn bộ** — chạy lại 4 bộ như `docs/tracking/eval-tier0-regression.md` đã ghi (backend / router / frontend / deploy-docker) và **ghi số thật** vào `test-rounds.md`; nếu có ca đỏ thì xử như vòng 25 (sửa hoặc ghi vào `bug-register.md` kèm lý do, không nới cổng cho xanh — F13/F24).
**Đo bằng mắt (bắt buộc, vì "kỹ" không thuần máy)** — một việc mức 2 thật + một việc mức 3 thật trên chủ đề owner quan tâm: đếm số nguồn mở thật, số đoạn trích trong sổ, số tệp hồ sơ, số dòng tiến độ, số lần chỉ thị giữa lượt áp được; chụp ảnh timeline (dòng tiến độ) + tệp hồ sơ trong Files panel → lưu `/code/.generated_artifacts/`.

### [MỞ — chờ phỏng vấn]

Owner đã chốt: *"tạo plan trước, ghi vào plan trước rồi tiếp tục interview"* (#5998). Các mục dưới đây **không** được tự quyết; plan dùng số tạm và phải sửa khi owner trả lời.

- **M1 — Trần lượt cho mức 3.** `DEADLINE_MAX_SECONDS = 1200` (`limits.py:29`) chặn mọi lượt ở 20 phút. Kéo dài là **quyết định kiến trúc mới** (F9/D-12 cấm nới trần chờ của con để "chữa" việc này).
  1. Giữ 1 200 s và dùng `extend_turn_budget` một lần (mức 3 tối đa ~40 phút). *Ưu: không mở cửa rủi ro treo; nhược: việc rất lớn phải chia nhiều lượt.*
  2. Thêm D-number mới: lượt research mức 3 được `maxSteps`/`deadlineSeconds` riêng (ví dụ 40 bước / 3 600 s) **chỉ khi** phiên có brief mức 3 + chủ nhà đã duyệt ngân sách. *Ưu: đúng "big update"; nhược: mở đường cho lượt dài, phải thêm test watchdog/compaction.*
  3. Chạy theo đợt: mức 3 = nhiều lượt nối tiếp, mỗi lượt ≤ 1 200 s, trạng thái nằm trong hồ sơ + nhật ký. *Ưu: an toàn nhất; nhược: chậm hơn, main phải tự "đánh thức" lượt sau.*
  → **Đề xuất:** (2) kèm (1) làm mặc định, vì owner nói "đặc biệt quan trọng" và "thật kỹ".
- **M2 — Hình dạng hồ sơ mỗi mức** (§2.6 đang là bản tạm): (a) giữ 3 tệp cố định như bảng; (b) cho main tự chọn tệp nhưng bắt buộc front matter + `sources.md`; (c) mức 3 luôn có thêm `read-log.md` (mỗi lần mở nguồn một dòng). → **Đề xuất:** (b) + (c) cho mức 3.
- **M3 — "Bão hoà" ở mức 3 = mấy vòng?** (a) 2 vòng liên tiếp không nguồn mới (bản tạm); (b) 3 vòng; (c) theo ngân sách, tối thiểu 2 và tối đa 4. → **Đề xuất:** (a) làm chuẩn, trần cứng 3 vòng.
- **M4 — Chủ nhà đòi "kỹ hơn" giữa lượt** (nâng mức bị cấm trong cùng lượt — §1.2): (a) main `ask_user` xin phép chạy thêm một lượt ở mức cao hơn; (b) main tự mở thêm nhánh **trong** hạn mức mức hiện tại rồi chạy một lượt phụ ở mức cao hơn nếu owner đồng ý; (c) cho phép nâng mức ngay trong lượt (phải nới trần, rủi ro nhất). → **Đề xuất:** (a).
- **M5 — Ngưỡng "việc lớn" phải xin duyệt** (§6.1 tạm: mức 3 **hoặc** > 10 phút **hoặc** > 3 nhánh): (a) giữ bản tạm; (b) chỉ mức 3 mới cần duyệt; (c) luôn duyệt khi dự kiến > 5 phút. → **Đề xuất:** (a).
- **M6 — Trần USD:** harness **chưa** nhận chi phí từ router (`router/src/pricing.mjs` có `cost`/`costBasis`, nhưng `runtime.py:3300` chỉ nhận `usage`). (a) chỉ hiện giây + token trong vòng này; (b) xin router trả thêm trường `boxfox.cost` rồi hiện USD; (c) hiện USD **ước lượng** theo bảng giá tự nhập. → **Đề xuất:** (a) trước, (b) ở vòng sau.
- **Nối phỏng vấn §3 của `v27-owner-answers.md`** (nhóm 3 thị trường; nhóm 2 học thuật/kỹ thuật; phương pháp research) — các mục đó là dữ liệu đầu vào cho skill `research-team` (danh mục nhắc, trường bắt buộc, cách đọc PDF/bảng) nên **skill viết trước theo bản tạm, chờ owner chốt rồi bổ sung**.

### Đợt thi công, điều kiện dừng và rủi ro

| Đợt | Nội dung | Phụ thuộc | Điều kiện dừng (definition of done) | Số để lượng giá |
| --- | --- | --- | --- | --- |
| C-1 | `research_brief` + bảng trần + skill `research-team` | sau A (lớp đọc) | tool chạy, kẹp trần đúng, con nhận trần theo mức, test xanh, không đổi hành vi khi thiếu brief | 6 test mới + 1 hồi quy `delegate_task`; thời gian lượt mức 2 ≤ trần |
| C-2 | `dossier_write` + `.research/` + liên kết chat | sau C-1 | con research ghi được tệp nhánh, main đọc lại đủ, UI mở được tệp | 1 tệp ≥ 30 KB ghi + đọc lại; 0 thay đổi ngoài `.research/` |
| C-3 | SOP bốn pha + đuổi trích dẫn/bão hoà (chữ trong skill) | sau C-1, song song C-2 | skill có 4 pha + 3 vòng luật + bảng ánh xạ chỉ thị; không thêm mã điều khiển | ca R4 ở C-7 |
| C-4 | Nhịp tiến độ + nudge | song song C-2 | dòng tiến độ xuất hiện trong timeline, không tăng số lượt, không có UI mới | ≥ 1 dòng/10 phút, ≤ 12 dòng/lượt, `_turn_index` không đổi |
| C-5 | Steer + `cancel_child` + composer | song song C-2 | chỉ thị giữa lượt áp được ở bước kế; dừng nhánh không rò slot; 409 cũ khi tắt cờ | 3 test backend + 4 test frontend; 1 ca thật "dừng nhánh luật" |
| C-6 | Ngân sách + nút duyệt | sau C-1 | mức 3 chưa duyệt thì có `decision_requested`; hết hạn ⇒ chạy bản gọn + nói rõ | 1 luồng duyệt/từ chối/hết hạn |
| C-7 | Bộ ca `R1–R7` + oracle máy | sau C-2 | `--plan` nhận fixture; 4 ca offline chạy ra `scores.jsonl`; 5 chiều số in ra | `scores.jsonl` lần đầu có dòng |
| C-8 | Tài liệu + sổ | cuối | 2 tài liệu lệch đã sửa; trang kiến trúc có; sổ theo dõi ghi số thật | grep sạch 2 chuỗi sai |

**Rủi ro & cách chặn:**
1. **Lượt dài bị watchdog/compaction cắt** (mức 3): chặn bằng điều kiện `[MỞ]` M1 + luật hồ sơ chia tệp nhỏ; không nới `CHILD_WALL_MAX_SECONDS` (`limits.py:150`) trong vòng này.
2. **Trần 16 000 ký tự của `await_children`** làm mất đường dẫn tệp: chặn bằng luật "câu trả lời con ≤ 8 000 ký tự, độ sâu ở tệp" (§2.7) + test đếm đường dẫn còn nguyên trong payload.
3. **Steer thành ồn** (chủ nhà gõ liên tục): chặn bằng `STEER_MAX_PENDING = 5`, gộp 2 chỉ thị mỗi mốc bước, hiện rõ "áp ở bước kế".
4. **Cổng mềm thành cổng giả**: `BOXFOX_RESEARCH_BRIEF` mặc định `warn` và **không** được bật `enforce` trước khi bộ ca C-7 xanh (cùng tinh thần F12).
5. **Trùng việc với A/B**: chặn bằng bảng ranh giới dưới đây + không chạm `web.py`, `plan_quality.py`, `evidence_gate.py`.
6. **Vô tình đổi hành vi cũ**: mọi đường mới đều có cờ tắt (`BOXFOX_RESEARCH_BRIEF=off`, `BOXFOX_STEER=off`, `BOXFOX_RESEARCH_PROGRESS=off`) và test hồi quy "thiếu brief ⇒ y như `2add905`".

### Ranh giới với Phạm vi A và B (không làm trùng)

| Việc | A (reading) | B (ledger) | C (plan này) |
| --- | --- | --- | --- |
| Giải nén gzip, `offset` khi đọc, định tuyến reader, thêm provider | ✅ | | |
| `read_source`/đọc theo khoảng, xử lý PDF/bảng | ✅ | | |
| Sổ nguồn `source_ledger` (claim ↔ nguồn ↔ trích nguyên văn ↔ ngày ↔ tier ↔ confidence), thang 4 mức | | ✅ | C **gọi** sổ: `sources.md` sinh từ sổ |
| Cổng chất lượng research (file **mới**, ngoài `evidence_gate.py`) | | ✅ | C ghi luật + tạo điểm đọc (front matter trong tệp hồ sơ) |
| Con phản biện `research-critique` + vòng `revise` | | ✅ | C định nghĩa *khi nào gọi* + chỗ ghi `critique.md` |
| Ba mức, trần theo mức, `research_brief`, skill `research-team`, bốn pha | | | ✅ |
| Đường ghi tệp cho con (`dossier_write`, `.research/`) | | | ✅ |
| Nhịp tiến độ, steer giữa lượt, `cancel_child` | | | ✅ |
| Ngân sách + nút duyệt, bộ ca `R1–R7` + oracle máy, tài liệu | | | ✅ |

### Hằng số mới (một chỗ để rà soát)

| Hằng | Tệp | Giá trị tạm |
| --- | --- | --- |
| `RESEARCH_TIERS`, `RESEARCH_TIER_DEFAULT` | `limits.py` | `(1,2,3)`, `2` |
| `RESEARCH_TIER_BRANCHES` / `_CHILD_STEPS` / `_CHILD_SECONDS` / `_TURN_SECONDS` / `_CRITIQUE` | `limits.py` | `{1:1,2:3,3:6}` / `{1:20,2:40,3:40}` / `{1:180,2:420,3:900}` / `{1:600,2:1200,3:1200}` / `{1:F,2:F,3:T}` |
| `RESEARCH_PROGRESS_NUDGE_SECONDS`, `RESEARCH_PROGRESS_MAX_PER_TURN` | `limits.py` | `600`, `12` |
| `STEER_MAX_PENDING`, `STEER_ENV` | `limits.py` | `5`, `'BOXFOX_STEER'` |
| `RESEARCH_BRIEF_ENV`, `RESEARCH_PROGRESS_ENV` | `limits.py` | `'BOXFOX_RESEARCH_BRIEF'` (`off|warn|enforce`, mặc định `warn`), `'BOXFOX_RESEARCH_PROGRESS'` (`on|off`) |
| `DOSSIER_ROOM`, `DOSSIER_MAX_BYTES`, `DOSSIER_PATH_RE` | `sandbox/worker.py` | `'.research'`, `262144`, regex ở §2.1 |
| `DOSSIER_PREFIX` | `frontend/src/components/chat/MarkdownRenderer.tsx` | `'.research/'` |
| `OWNER_STEER_PREFIX`, `RESEARCH_NUDGE_PREFIX` | `runtime.py` | chuỗi cố định, thêm vào danh sách bị `turn_prompt_excerpt` bỏ qua |

### Việc phải nhớ khi build (đừng vi phạm)

- **D-11** con không sinh cháu (`runtime.py:4969-4970`) — mọi thứ "chia nhỏ" phải do main làm.
- **D-12/D-10/F9** không nới trần chờ của con để chữa việc research dài; chỉ đổi trần **lượt** theo `[MỞ]` M1.
- **D-13/F7** không mở parallel read tools; tốc độ đến từ fan-out.
- **R10-6/F14** không bỏ `web_search`/`web_fetch` khỏi orchestrator.
- **D-18/F1** không thêm tiêu chí nguồn vào `evidence_gate.py`; cổng mới thuộc B.
- **D-19–D-25/F2/F3/F4** không khối/badge/nhãn quanh **câu trả lời cuối**; mọi thứ thêm ở đây nằm trong lượt đang chạy hoặc trong tệp.
- **§5(1)** không thêm giá trị `status` mới cho session; **§5(5)** `events()` tối đa 500 hàng ⇒ bảng mới tự lọc.
- Không dựng lại box (op mới đi kèm tiến trình harness), không restart tiến trình của chủ nhà; giữ CRLF/LF theo từng tệp.

### Bàn giao UI (cho main dispatch design subagent)

Ba khung cần mockup ở tab Design trước khi build C-5/C-2: (1) **composer khi lượt đang chạy** — ô nhập vẫn gõ được, nút "Gửi cho lượt đang chạy", dòng chú thích "áp dụng ở bước kế", dòng xác nhận sau khi gửi; (2) **dòng tiến độ giữa lượt** — trông như câu trả lời ngắn trong timeline (không khối, không badge), kèm trạng thái "chờ nhánh nào"; (3) **hàng tệp hồ sơ** — liên kết `.research/...` trong câu trả lời cuối mở đúng tệp trong Files panel, nhãn "hồ sơ nghiên cứu". Mockup cũ có thể tham chiếu: `/code/.plans/designs/lv24-answer-*.html`, `/code/.plans/designs/turns-*.html`.

---

## Phụ lục — điều chỉnh đã chốt ở vòng 9–11 (#6008–#6014, 2026-09-23)

> Bản kế hoạch chính `v1-research-rework.md` (bản 2) đã cập nhật.

1. **M3 đã có đáp án:** bão hoà săn đuổi trích dẫn ở mức 3 = **3 vòng** liên tiếp không thêm bài mới (#6008).
2. **Phương pháp vẫn mở (vòng 12+):** số nhánh con tối đa theo mức · trần thời gian mặc định mỗi mức (+ D-number cho lượt
   research dài, MỞ-G) · hình dạng hồ sơ mẫu mỗi mức · cách chủ nhà nới trần giữa việc · nhịp kiểm chứng (pha 4 chạy cho
   mức nào). Mọi bảng trần trong tệp này **vẫn là nháp** cho tới khi chủ nhà chốt.
3. **Thang đọc FULL năm tầng** (chốt #6010, #6011) ⇒ nhịp tiến độ và hồ sơ có thêm trạng thái "đang mở bản cấu trúc
   (HTML/JATS/PDF)".
4. **Gap TM-3** theo archetype C2′ (hai tầng số + luật chống deadlock) — nhịp báo mốc phải nói rõ khi một gap rơi vào
   "tín hiệu, chưa kiểm".
