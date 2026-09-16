# So sánh harness: Hermes Agent, OpenCode và nền tảng public-docs-only

## Phạm vi và cách dùng bảng này

So sánh này phục vụ quyết định thiết kế BoxFox, không phải benchmark, chứng nhận an toàn hay bảng tính năng sản phẩm. **Hermes Agent** và **OpenCode** được đối chiếu từ mã nguồn ở commit ghim; mỗi ghi chép chi tiết liên kết file upstream và snapshot có manifest/checksum. **Claude Code, OpenAI Codex, Cursor, Devin và Vorflux** là **public-docs-only**: cột của chúng chỉ nêu điều tài liệu chính thức công bố, không điền chi tiết nội bộ bằng suy đoán.

- Hermes Agent: MIT, [`69fd61b0efbe2bf7f412714ed8c35e40dfddc534`](https://github.com/NousResearch/hermes-agent/tree/69fd61b0efbe2bf7f412714ed8c35e40dfddc534); bằng chứng [architecture](hermes-agent/architecture.md), [loop](hermes-agent/agent-loop.md), [skills](hermes-agent/skills.md), [subagents](hermes-agent/subagents.md).
- OpenCode: MIT, [`e03db9bc6908f75c9334d8aa997deeaac81c0298`](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298); bằng chứng [architecture](opencode/architecture.md), [prompt/tools](opencode/prompts-tools.md), [skills/subagents](opencode/skills-subagents.md), [permission/context](opencode/permissions-context.md).
- Snapshot nội bộ: [`code-reference/agent-harness/`](../../../code-reference/agent-harness/); xem [`code-reference/README.md`](../../../code-reference/README.md) để biết verifier và giới hạn reuse.
- Định nghĩa thuật ngữ: [terminology](../terminology.md). Kiến trúc mục tiêu BoxFox: [agent harness](../../architecture/agent-harness.md).

## Ma trận bằng chứng và pattern

| Chủ đề | Hermes Agent — mã đã kiểm tra | OpenCode — mã đã kiểm tra | Nền tảng public-docs-only | Quyết định BoxFox |
|---|---|---|---|---|
| **Vòng lặp và state** | Conversation loop chia phase preflight, dựng request, intake, tool round và finalizer; executor có tuần tự/phân đoạn. | `SessionPrompt` phối hợp processor, run-state busy/idle và parts; session có parent ID. | Một số sản phẩm có bề mặt session/subsession hoặc API công khai; Vorflux hiện chỉ có trang SPA/marketing reachable, không xác minh được semantics route. Không có state machine nội bộ. | **Adopt:** `session/task/run/turn` rõ ràng, event bền vững, cancel/recover/idempotency. **Avoid:** suy diễn event store hay sandbox từ UI, route URL hoặc việc có session. |
| **Prompt và instructions** | Prompt builder, profile/toolset và context modules tách lớp. | Ghép instruction theo scope, system/environment, skill catalog, MCP, history và schema tool. | Codex nói về `AGENTS.md`; Claude Code settings; Cursor Rules; các cơ chế này là context công khai. | **Adopt:** compiler prompt có version, trust class và provenance. **Avoid:** gộp file dự án/web thành trusted policy hoặc tin prompt filtering là enforcement. |
| **Tool registry/executor** | Registry tách toolset và executor; model nhận schema tool đã lọc. | Registry built-in/custom/plugin, context tool có callback permission; output có thể truncate. | Claude Code công bố rule/mode/hook; Codex công bố sandbox/approval tách nhau. Không có executor source nội bộ. | **Adopt:** schema/registry tách executor, output là artifact. **Avoid:** chạy tool chỉ dựa vào việc tool hiện trong catalog hoặc approval UI. |
| **Permission và sandbox** | Có guard/runtime/toolset nhưng source không chứng minh một security boundary tổng quát cho BoxFox. | `allow`/`ask`/`deny`, queue/reply approval; `visibleTools()` chỉ là UX, còn `Permission.ask()` ở luồng tool. | Claude Code, Codex, Cursor, Devin đều có bề mặt public về permission/security; implementation không công khai. | **Adopt:** kiểm policy tại executor, grant có scope/expiry/revocation/audit. **Avoid:** coi hidden tool, rule, hook hoặc mode là sandbox; BoxFox phải cưỡng chế filesystem/process/network riêng. |
| **Skills** | Quét skill, trust/quarantine, catalog ngắn rồi `skill_view`; compaction có marker reload. Đóng gói skill orchestration cho Claude Code/Codex/OpenCode/Claude Design. | Quét OpenCode/Claude/agent-compatible skill và remote catalog; nạp toàn văn qua tool sau permission. | Các sản phẩm đóng công bố rules/instruction ở mức khác nhau, không có source skill loader nội bộ. | **Adopt:** catalog-first, load dần, hash/license/publisher/trust record. **Avoid:** coi skill trong repo/URL là trusted hoặc để `code-reference/` trên discovery path. |
| **Subagent** | Child `AIAgent`/conversation độc lập, depth/concurrency, async recovery và summary về parent. | `TaskTool` tạo/resume child session, depth/background/cancel; source nói quyền child không tự bị giới hạn hoàn toàn bởi parent. | Claude Code mô tả chặn/kế thừa mode subagent; Cursor/Devin có bề mặt cloud/session công khai. Với Vorflux, route `subagents` hiện chỉ trả SPA/placeholder nên không chứng minh hành vi subagent. | **Adopt:** child session có lineage, budget, deadline, cancel và evidence summary. **Avoid:** inherit/hợp quyền ngầm; effective capability phải là **giao** quyền parent, profile child, grant và sandbox. |
| **Context, memory, compaction** | Memory provider, session persistence và compression/retained window được tách module. | Compaction là message/part nhìn thấy được; xử lý overflow và summary. | Devin công bố knowledge. Với Vorflux, route `memory` hiện chỉ trả SPA/placeholder nên không chứng minh memory; nội bộ retention/compaction của các nền tảng đóng không được biết. | **Adopt:** compact như event/artifact có source range, nhãn/provenance và version. **Avoid:** biến summary free-text thành nguồn sự thật, hoặc để compaction rửa nhãn/nguồn gốc. |
| **Provider và credential** | Provider profiles/registry và fallback tách khỏi loop; một số credential flow gắn runtime Hermes. | Provider/model được điều phối trong session; đây không là cơ chế broker BoxFox. | Dịch vụ đóng có login/secret configuration public khác nhau, nhưng không chứng minh storage/flow nội bộ. | **Adopt:** router + credential broker riêng, handle mờ, usage/budget audit. **Avoid:** copy OAuth/credential flow của reference hoặc đưa raw token vào agent/sandbox/log. |
| **Mở rộng và tương thích** | Plugin, MCP, profile, skill và gateway là extension point, không phải một API công khai duy nhất. | Plugin/custom tool/MCP/agent config mở rộng bề mặt thực thi. | Claude Code hooks/settings; Cursor/Devin cloud API là bề mặt công khai. | **Adopt:** adapter boundary cho protocol/tool/skill. **Avoid:** plugin hoặc compatibility adapter tự bypass policy/credential/sandbox. |

## Chi tiết so sánh theo nguồn

### 1. Hermes Agent: học cấu trúc, không nhập nguyên runtime

**Bằng chứng mã nguồn.** `AIAgent`, conversation loop nhiều phase, tool registry/executor và provider registry cho thấy một harness có thể tách điều phối model khỏi catalog tool và adapter provider; xem [kiến trúc](hermes-agent/architecture.md) và [vòng lặp](hermes-agent/agent-loop.md). Pattern đặc biệt hữu ích là skill catalog trước, nội dung sau, với trust/quarantine và path guard; xem [skills](hermes-agent/skills.md). Delegation tạo conversation/task riêng, giới hạn depth/concurrency và trả summary về parent; xem [subagents](hermes-agent/subagents.md).

**Quyết định.** Lấy Hermes làm tham khảo chính cho sự phân rã loop, registry, progressive skill loading và delegation lifecycle. Không import repository như một thư viện BoxFox: CLI/gateway, SQLite state, browser/terminal backend, OAuth và prompt phụ thuộc vận hành Hermes. Các `SKILL.md` Hermes cho Claude Code, Codex, OpenCode và Claude Design chỉ là hướng dẫn orchestration do Hermes phát hành theo MIT; chúng không là mã nguồn hoặc prompt hệ thống của các sản phẩm đó.

### 2. OpenCode: học session processor và kiểm permission ở hành động

**Bằng chứng mã nguồn.** OpenCode biểu diễn history bằng session/message/part, có run-state theo session và `SessionPrompt` điều phối stream/processor; xem [kiến trúc](opencode/architecture.md). Nó ghép instruction theo scope, system/environment, catalog skill/MCP và schema tool; xem [prompt/tools](opencode/prompts-tools.md). Permission engine hỗ trợ `allow`/`ask`/`deny` và approval pending, đồng thời tài liệu source chỉ rõ lọc tool khỏi prompt không thay enforcement executor; xem [permission/context](opencode/permissions-context.md). `TaskTool` tạo/resume child session, nhưng evidence hiện có không chứng minh child luôn có ít quyền hơn parent; xem [skills/subagents](opencode/skills-subagents.md).

**Quyết định.** Lấy OpenCode làm đối chiếu chính cho session processor, compaction nhìn thấy được, tool permission path và child session/cancel. Không copy mặc định auto-approval, implementation TypeScript/Effect, hay semantics kế thừa quyền của subagent. BoxFox phải thêm task/run/turn, capability grant có hạn, event store, artifact ACL và bất biến quyền child không tăng.

### 3. Nền tảng đóng: học UX/bề mặt công khai, không gán implementation

| Sản phẩm | Điều public có thể tham khảo | Không được kết luận | Bản ghi |
|---|---|---|---|
| Claude Code | rules/modes quyền, subagent control, hook và settings | prompt, tool executor, compaction, sandbox, credential/state internal | [public-docs-only](closed-platforms/claude-code.md) |
| OpenAI Codex | tách sandbox và approval; `AGENTS.md` theo scope | backend, routing, transcript, sandbox implementation; Codex CLI source không đại diện backend | [public-docs-only](closed-platforms/codex.md) |
| Cursor | rules, agent security, cloud/background agent và API public | scheduler, VM/container isolation, secret flow, lineage format | [public-docs-only](closed-platforms/cursor.md) |
| Devin | session API, knowledge, security profiles, secrets configuration và handoff | capability semantics, VM, credential storage, event/artifact/retry internals | [public-docs-only](closed-platforms/devin.md) |
| Vorflux | Chỉ trang sản phẩm SPA/marketing có thể kiểm tra: tự mô tả là cloud-based AI coding agent cho teams và nhắc “dedicated machines”. Các route docs riêng hiện trả cùng placeholder. | session/subsession, lifecycle, memory, API, plan mode, isolation, credential flow, transcript/artifact schema và orchestration/router | [public-docs-only](closed-platforms/vorflux.md) |

**Quyết định.** Chỉ dùng các nguồn này để tham khảo UX/hợp đồng public khi nội dung cụ thể có thể kiểm tra: permission mode, approval, rules/instructions, session API, cloud handoff và quản trị secrets tùy từng sản phẩm. Riêng Vorflux hiện chưa có tài liệu route cụ thể có thể kiểm tra ngoài mô tả sản phẩm cấp cao. Không tạo `code-reference` từ sản phẩm đóng, không viết compatibility dựa trên prompt/tool internals chưa công bố, và không diễn giải trang marketing/security overview thành đặc tả ranh giới thực thi.

## Quyết định adopt / adapt / avoid cho BoxFox

| Hạng mục | Quyết định | Lý do và điều kiện chấp nhận |
|---|---|---|
| Loop theo phase và registry tách executor | **Adopt pattern** từ Hermes/OpenCode | Phù hợp multi-agent; phải có state machine, event/idempotency, policy check ở executor và test cancellation/retry. |
| Catalog skill trước, load nội dung sau | **Adopt pattern** từ Hermes/OpenCode | Giảm context và tăng reviewability; catalog phải mang publisher, commit/version, SHA-256, license, trust state và capability cần thiết. |
| Child session, lineage, budget, cancel | **Adopt with stronger constraints** | Hermes/OpenCode chứng minh pattern hữu ích, nhưng BoxFox phải làm quyền child là giao và gắn artifact/provenance vào summary. |
| `allow`/`ask`/`deny` và approval request | **Adapt** từ OpenCode/UX công khai | Thêm principal, scope digest, task epoch, expiry, revocation, audit, idempotency; không copy `--auto` hay `always` vượt scope mặc định. |
| Compaction rõ ràng trong transcript | **Adopt with provenance** | Được OpenCode/Hermes minh họa, nhưng BoxFox cần source event IDs, label, hash, model/version compactor và retention policy. |
| Rules/`AGENTS.md`/skill dự án | **Adapt as untrusted input** | Hữu ích cho interoperability; phải qua classify/scan/quarantine và không được đổi policy hoặc tự cấp quyền. |
| Prompt/tool filtering như lớp bảo vệ | **Avoid as enforcement** | Cả source evidence và sản phẩm public không làm nó thành sandbox; mọi đường built-in/plugin/MCP/API phải về cùng enforcement point. |
| Import/copy cả Hermes/OpenCode runtime | **Avoid** | Dependency graph và assumption vận hành lớn; snapshot mặc định `reference-only`, chỉ chuyển thể file được review license/security. |
| Raw API key/OAuth token trong session/worker | **Avoid** | Dùng credential broker/opaque handle; raw secret không nằm trong prompt, transcript, log hay sandbox. |
| Khẳng định internals của Claude Code/Codex/Cursor/Devin/Vorflux | **Avoid** | Phạm vi chỉ public-docs-only. Nếu cần tương thích hoặc trust claim, phải có tài liệu chính thức mới hoặc source được cấp quyền kiểm tra. |

## Tiêu chí kiểm chứng trước khi thành implementation

1. Mỗi tool call, plugin, MCP call và adapter route đi qua policy enforcement point giống nhau; tool hidden khỏi prompt vẫn bị chặn tại executor.
2. Child session không thể có capability ngoài giao của parent, child profile, task grant và sandbox; test depth, cancel, expiry, revocation và concurrent lease.
3. Snapshot referenced thật sự có manifest/hash/license hợp lệ và runtime không import nó: `python3 code-reference/scripts/verify_code_reference.py`.
4. Prompt compiler giữ trust/provenance; project instruction, skill, web/DOM và tool output không thành stable policy.
5. Artifact, summary, checkpoint và child result giữ `derived_from`, nhãn, hash, owner/ACL và event sequence khi resume.
6. Router/credential broker không trả raw credential cho harness worker; log/telemetry đã redact và fallback không vượt policy/data boundary.

Các hợp đồng và roadmap BoxFox nằm trong [kiến trúc harness](../../architecture/agent-harness.md), [kiến trúc router](../../architecture/model-router.md) và [kế hoạch sản phẩm](../../plan/agent-box-plan.md).
