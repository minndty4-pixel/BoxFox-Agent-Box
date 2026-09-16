# Kế hoạch sản phẩm BoxFox Agent Box

> **Trạng thái:** kế hoạch sản phẩm và lộ trình thực hiện. Đây không phải tuyên bố rằng backend harness, cơ chế kiểm soát luồng dữ liệu hay quyền đã được triển khai.
>
> **Cập nhật:** 2026-09-15 · **Ưu tiên đã chọn:** harness sản phẩm nhiều agent.

BoxFox là một **AI Computer tự host**: môi trường làm việc có giao diện, workspace, desktop sandbox và agent có thể đọc tài liệu, lập kế hoạch, gọi công cụ và hoàn thành tác vụ. Điểm khác biệt dự kiến là agent không chỉ được đánh giá theo khả năng hoàn thành việc mà còn theo việc giữ ranh giới dữ liệu và quyền trong lúc làm việc.

Tài liệu này giữ mục tiêu, trạng thái đã xác minh, quyết định sản phẩm, lộ trình và các lựa chọn còn mở. Không lặp lại đặc tả runtime dài. Chi tiết về **harness — bộ chạy và điều phối agent** — nằm tại [Kiến trúc harness](../architecture/agent-harness.md); chi tiết về **model router — bộ định tuyến mô hình** — nằm tại [Kiến trúc model router](../architecture/model-router.md). Tài liệu sandbox hiện có là [Kiến trúc sandbox](../architecture/sandbox.md).

## 1. Cách đọc và mức độ chắc chắn

- **Đã xác minh** nghĩa là đã kiểm tra trong repository ở thời điểm cập nhật.
- **Đã quyết định** là hướng sản phẩm cần giữ khi thiết kế và triển khai.
- **Dự kiến** là kiến trúc hoặc công việc chưa có runtime hoàn chỉnh; không được trình bày như chức năng đã bảo vệ người dùng.
- **Nghiên cứu** phải có bằng chứng nguồn, commit, giấy phép và checksum trong `docs/research/` cùng `code-reference/`. Bản snapshot chỉ làm bằng chứng, không được runtime import hoặc tự phát hiện như skill.

Các tài liệu kiến trúc và nghiên cứu dùng thuật ngữ đầy đủ trước khi dùng viết tắt. Khi một quy tắc bảo mật được triển khai, đặc tả và kiểm thử của quy tắc đó là nguồn chuẩn; bản kế hoạch này chỉ nêu quyết định cấp sản phẩm.

## 2. Thuật ngữ thiết yếu

| Thuật ngữ | Nghĩa trong BoxFox |
|---|---|
| **Agent** | Phần mềm dùng mô hình ngôn ngữ lớn để nhận mục tiêu, suy luận và đề xuất hoặc gọi công cụ. Mô hình không phải thành phần được tin để tự cấp quyền. |
| **Runtime** | Mã và dịch vụ đang chạy để thực hiện chức năng; khác với mock (dữ liệu/hành vi mô phỏng) hoặc một mô tả trên giao diện. |
| **Harness** | Bộ chạy và điều phối agent: quản lý phiên, tác vụ, ngữ cảnh, prompt, công cụ, kỹ năng, agent con, ngân sách, trạng thái và kết quả. |
| **Agent con (sub-agent)** | Agent chuyên trách do agent cha giao việc. Nó có phiên, ngữ cảnh, ngân sách, quyền và vòng đời riêng; không phải chỉ là một lần gọi mô hình. |
| **Router** | Bộ nhận yêu cầu mô hình, chọn tuyến, nhà cung cấp, credential và adapter giao thức rồi chuẩn hóa kết quả trả về. |
| **Sandbox** | Ranh giới thực thi cho tiến trình, filesystem và mạng của agent. Lọc tên tool hoặc câu lệnh trong prompt không phải sandbox. |
| **Provenance (nguồn gốc)** | Dấu vết dữ liệu đến từ đâu, phiên bản nào và được biến đổi qua bước nào. |
| **IFC — Information-Flow Control** | Kiểm soát luồng thông tin: chính sách xét dữ liệu từ nguồn nào được đi tới đích nào. |
| **Lease (giấy phép có hạn)** | Quyền được cấp cho hành động có kiểu, phạm vi, thời hạn, điều kiện sử dụng và khả năng thu hồi. |
| **Credential** | Bí mật hoặc handle dùng để xác thực với nhà cung cấp, ví dụ API key hoặc liên kết OAuth do người dùng cho phép. **OAuth** là cơ chế người dùng ủy quyền cho ứng dụng mà không đưa mật khẩu trực tiếp. |
| **Artifact** | Đầu ra có thể định danh và lưu vết, như kế hoạch đã duyệt, diff, tệp, kết quả tool, bản tóm tắt hoặc báo cáo. |
| **Event store** | Kho sự kiện có thứ tự, là nguồn sự thật cho việc tiếp tục phiên, phát lại cho giao diện và audit; WebSocket chỉ là kênh vận chuyển. |
| **UI — User Interface (giao diện người dùng)** | Phần để người dùng xem tiến độ, artifact và gửi quyết định; UI không thay thế enforcement phía server. **API — Application Programming Interface** là hợp đồng để các phần mềm gọi nhau. |
| **Egress** | Luồng dữ liệu hoặc request đi từ BoxFox ra một đích bên ngoài, ví dụ provider model, website hoặc receiver kiểm thử. |
| **MVP — Minimum Viable Product** | Phiên bản nhỏ nhất có thể kiểm chứng giá trị sản phẩm; không mặc nhiên bao gồm mọi tích hợp dự kiến. **UX — User Experience** là trải nghiệm thao tác của người dùng. |
| **MITM — Man-in-the-Middle** | Proxy/chứng chỉ trung gian chặn và chuyển tiếp lưu lượng. Đây là cơ chế đặc quyền cao, chỉ là lựa chọn nghiên cứu sau này, không phải mặc định. |

## 3. Mục tiêu sản phẩm

### 3.1 Người dùng và việc cần làm

BoxFox hướng tới người dùng muốn giao việc dài hơn một lần hỏi đáp: khảo sát repository, sửa và kiểm thử mã, chuẩn bị artifact, nghiên cứu có nguồn và các tác vụ browser/desktop khi ranh giới an toàn đã đủ rõ. Giao diện phải cho người dùng xem tiến độ, ngữ cảnh quan trọng, artifact, quyền đang chờ và kết quả của từng agent.

Sản phẩm ưu tiên **harness nhiều agent**, không chỉ một agent chat có danh sách model. Một agent chính có thể phân rã công việc; agent con chuyên trách có thể nghiên cứu, rà soát, kiểm thử hoặc chuẩn bị artifact. Delegation phải làm công việc dễ kiểm soát hơn, không tạo đường vòng né chính sách.

### 3.2 Giá trị khác biệt cần giữ

1. **Quyền nằm ngoài mô hình.** Quyết định cho phép, từ chối, hết hạn và thu hồi do mã chính sách xác định thực hiện; output của mô hình không tự cấp quyền.
2. **Tách ba câu hỏi về dữ liệu.** Hệ thống phân biệt nguồn dữ liệu, dữ liệu có được phép chỉ đạo agent không, và dữ liệu được phép đi đến những đích nào. Không dùng một nhãn “an toàn/không an toàn” cho cả ba.
3. **Quyền có ngữ cảnh.** Một quyền phải có hành động, tài nguyên/đích, thời hạn, số lần dùng và neo vào trạng thái dữ liệu liên quan. Quyền cũ không được tự hồi sinh khi resume.
4. **Nguồn gốc không bị rửa.** Nhãn và provenance phải đi qua tool result, tóm tắt, checkpoint, khôi phục phiên, artifact và kết quả agent con.
5. **Bảo mật và khả năng làm việc cùng được đo.** Đánh giá phải báo tách tỷ lệ tấn công thành công, khả năng hoàn thành việc và số lần phải hỏi người dùng; giảm một số bằng cách làm số khác bằng không không phải thành công.

### 3.3 Những điều sản phẩm không tuyên bố

- BoxFox hiện **không** có backend harness hay security gateway hoàn chỉnh đã chứng minh bằng kiểm thử đầu-cuối.
- Việc không đưa tool vào prompt chỉ giảm khả năng gọi nhầm; nó không phải cơ chế cưỡng chế quyền.
- Desktop container hiện có không tự chứng minh shell bị giới hạn theo từng đường dẫn hoặc mọi luồng mạng đều được kiểm soát.
- Người dùng bấm duyệt không làm sạch toàn bộ ngữ cảnh; chỉ bằng chứng/nguồn cụ thể được xác nhận mới có thể thay đổi trạng thái theo đặc tả.
- Kế hoạch, skill hoặc tệp trong workspace do agent tạo không phải tài liệu chính sách được tin.
- Hỗ trợ nhiều agent không có nghĩa agent con được mở rộng quyền, nhận raw credential hay điều khiển desktop đồng thời mặc định.
- Không tuyên bố người dùng luôn phát hiện một bước độc trong kế hoạch, hay giấy phép theo phạm vi luôn hẹp bằng giấy phép từng hành động.

## 4. Phạm vi và trạng thái đã xác minh

### 4.1 Phạm vi của đợt kiến trúc

Đợt này chuẩn hóa bằng chứng nghiên cứu, đặc tả kiến trúc và kế hoạch triển khai. Nó **không** triển khai backend harness, router, security gateway hoặc thay đổi giao diện chỉ vì các tài liệu đã được tạo.

Ưu tiên tiếp theo là đường chạy sản phẩm có kiểm thử: hợp đồng phiên/quyền/sự kiện, cổng tool và cổng model, sau đó là delegation nhiều agent. Các tính năng desktop, browser và router đa giao thức phải nối vào các ranh giới này thay vì tự tạo đường đi riêng.

### 4.2 Trạng thái repository đã kiểm tra

| Khu vực | Trạng thái đã xác minh | Hệ quả đối với kế hoạch |
|---|---|---|
| Backend `backend/src/agentbox/` | Các package agent core, controller, security, tools, memory, router, sandbox, computer use, API và config hiện là khung `__init__.py`; chưa có entrypoint backend hay runtime harness tương ứng. | Không gọi những cơ chế trong kế hoạch là “đã thực thi”. Cần bắt đầu bằng hợp đồng và test. |
| Frontend | React/TypeScript, workspace UI, transport abstraction và cấu hình harness có mặt; luồng agent mặc định còn có mock. | Có thể tận dụng UI và event contract, nhưng UI không chứng minh chính sách server-side. |
| Sandbox desktop | Docker desktop, editor, terminal, màn hình và API phụ trợ có mã chạy. | Đây là nền cần kiểm tra/cô lập thêm, không phải bằng chứng cho quyền filesystem hay egress chi tiết. |
| Duyệt plan hiện có | Trạng thái `draft/approved` của tệp được suy từ quy ước phiên bản/giao diện. | Không dùng nhãn file làm bằng chứng phê duyệt hay capability. Backend tương lai cần proposal ID, hash, scope digest, epoch, actor và kiểm tra giao dịch. |
| Benchmark | Có cấu trúc/tài liệu benchmark, chưa có pipeline backend chứng minh kết quả. | Các chỉ số và ca kiểm là kế hoạch thử nghiệm, chưa là kết quả nghiên cứu. |

## 5. Bản đồ kiến trúc sản phẩm

```text
Người dùng và giao diện
        │  yêu cầu, xem artifact, trả lời/duyệt
        ▼
Harness điều phối nhiều agent
  session · task · run · turn · prompt · delegation · event store
        ├──────────────► Cổng chính sách và audit
        │                 nhãn · approval · lease · budget · egress policy
        ├──────────────► Tool executor và artifact store
        │                 file · shell · browser · desktop · kỹ năng
        └──────────────► Model router
                          canonical request · route · credential broker · provider adapter
                                      │
                              Sandbox và nhà cung cấp bên ngoài
```

### 5.1 Ranh giới trách nhiệm

| Ranh giới | Trách nhiệm | Không được làm |
|---|---|---|
| Harness | Điều phối vòng đời, ghép ngữ cảnh, lên lịch agent con, xử lý hủy/retry/resume và phát sự kiện. | Tự quyết định cấp quyền, giữ raw credential trong sandbox, hoặc coi tool visibility là enforcement. |
| Cổng chính sách | Xét nhãn, scope, lease, approval, budget và đích ra; ghi audit. | Gọi mô hình để “đoán” hành động có an toàn hay không. |
| Tool executor/sandbox | Thực thi công cụ trong ranh giới đã kiểm chứng, trả kết quả và artifact có provenance. | Tin câu lệnh/prompt hoặc mount toàn workspace rồi tuyên bố giới hạn theo đường dẫn. |
| Router | Chuẩn hóa giao thức, chọn route, lấy credential opaque, áp dụng fallback/rate limit và che dữ liệu nhạy cảm trong quan sát. | Đưa raw token cho agent hoặc fallback tới route không được policy cho phép. |
| UI | Hiển thị đúng proposal, scope, trạng thái và event; gửi ý chí của người dùng. | Là nguồn duy nhất để cưỡng chế quyền hoặc suy từ một nhãn hiển thị rằng server đã kiểm tra. |

### 5.2 Harness nhiều agent là sản phẩm ưu tiên

Thiết kế chi tiết, state machine và API nằm ở [Kiến trúc harness](../architecture/agent-harness.md). Kế hoạch này chốt các yêu cầu sản phẩm sau:

- Mỗi agent con là **child session** có `lineage` (chuỗi cha-con), depth limit, ngân sách, deadline, cancellation tree và phạm vi tool riêng.
- Quyền hiệu lực của agent con là giao của quyền cha, chính sách vai trò và phạm vi dữ liệu được giao; agent con không thể tự tăng quyền hoặc chuyển raw credential cho agent khác.
- Delegation tạo hợp đồng đầu vào/đầu ra rõ: mục tiêu, artifact cần trả, giới hạn dữ liệu, budget và điều kiện hoàn thành. Kết quả trả về mang provenance cùng nhãn tổng hợp của dữ liệu thực đã dùng.
- Agent chính không nhập nguyên văn “kết luận” của agent con như chỉ thị hệ thống. Prompt compiler phải giữ tách lệnh hệ thống tin cậy với dữ liệu/artifact không tin cậy.
- Scheduler phải hỗ trợ dừng, retry có giới hạn, resume idempotent và trạng thái kết quả chưa biết nếu tool crash giữa lúc chạy. Cần event store bền vững trước khi hứa reconnect.
- Bản đầu có thể dùng delegation tuần tự hoặc song song hạn chế theo budget; điều khiển desktop đồng thời chưa được chọn và không mặc định bật.

Harness cũng quản lý **Plan/Act** như trải nghiệm sản phẩm: Plan giúp người dùng xem phương án và phạm vi đề xuất; Act chỉ bắt đầu từ ý chí người dùng và bằng chứng proposal cụ thể. Kế hoạch do agent viết là artifact để xem xét, không phải cơ chế bảo mật. Mọi tool call vẫn bị kiểm lại ngay trước thực thi.

### 5.3 Router đa giao thức và credential

Thiết kế canonical request, adapter, route policy và quan sát chi tiết nằm ở [Kiến trúc model router](../architecture/model-router.md). Hướng sản phẩm được chốt:

```text
client adapter → protocol ingress → canonical request → route policy
              → credential broker → provider adapter → normalizer stream/tool-call
              → log đã che dữ liệu nhạy cảm
```

- Hỗ trợ hai đường credential: API key do người dùng/tổ chức cung cấp; và kết nối bên thứ ba do người dùng cấp qua OAuth hoặc credential handle.
- Agent sandbox chỉ nhận handle opaque hoặc kết quả được policy cho phép, không nhận raw token, cookie, OAuth refresh token hay credential database.
- Model alias phải ánh xạ tới catalog server có capability, protocol, context size, modality, route và credential reference; không dùng nhãn hiển thị trên UI làm ID định tuyến.
- Fallback, retry, rate limit và streaming không được làm request vượt sang provider/đích bị cấm. Quan sát phải che bí mật và lưu lý do route bị chặn.
- MITM, chặn lưu lượng ứng dụng khác, hoặc dùng subscription/endpoint không chính thức không thuộc mặc định MVP. Chỉ xem xét sau nghiên cứu tương thích, điều khoản và mô hình quyền phù hợp.

### 5.4 Tool, skill, context và artifact

- Tool registry công bố capability để lập kế hoạch; executor kiểm capability, scope và lease tại thời điểm chạy. Đọc dữ liệu cũng có thể cần policy; `SAFE` không đồng nghĩa đọc mọi tài nguyên.
- Skill được catalog trước rồi mới progressive-load nội dung khi cần. Mỗi skill cần metadata, nguồn gốc, hash, namespace, giới hạn kích thước, trạng thái trust/quarantine và quy tắc cập nhật. Nội dung skill là dữ liệu, không tự thành policy.
- Prompt gồm phần ổn định tin cậy, phần ngữ cảnh có nhãn và phần biến động theo lượt. Nén ngữ cảnh chỉ là biến đổi dữ liệu: phải giữ nhãn, `derived_from` và provenance, không nâng summary bẩn lên vị trí “system”.
- Artifact store lưu ID, hash, nguồn, quan hệ dẫn xuất, trạng thái phê duyệt và quyền xem. Checkpoint/resume phải khôi phục trạng thái/nội dung liên quan nhưng không tự hồi sinh lease cũ.

Các hợp đồng chi tiết thuộc tài liệu harness để tránh lặp lại toàn bộ kiến trúc trong kế hoạch này.

## 6. Các quyết định bảo mật sản phẩm cần giữ

Các quyết định sau định hướng mọi pha; chúng không phải lời khẳng định implementation hiện tại đã đáp ứng.

1. **Một đường kiểm tra bắt buộc.** Mọi hành động agent khởi tạo — tool, model egress, network egress, tạo agent con và kênh phụ trợ — cần đi qua cổng kiểm tra tương ứng. Không có fast path vì “đang ở Plan mode” hay “tool read-only”.
2. **LLM là không tin cậy cho quyết định quyền.** Controller/policy code không dựa vào phân loại an toàn của model để cấp quyền. Tool visibility/prompt filtering chỉ là UX và giảm lỗi, không thay executor check.
3. **Nhãn và provenance qua mọi biến đổi.** Summary, file dẫn xuất, tool output, screenshot, checkpoint, restore, agent con và artifact đều cần giữ đường nguồn. Actor là người dùng không tự làm nội dung họ xem/chạy trở thành chỉ thị tin cậy.
4. **Approval gắn bằng chứng cụ thể.** Approval phải gắn proposal ID, hash, scope digest, task epoch, actor, hạn và request ID; server kiểm lại trạng thái tại lúc cấp/thực thi. Không suy quyền từ `approved` trong workspace hay một click không gắn nội dung.
5. **Lease không tự sống lại.** Lease có scope chuẩn hóa, hành động/đích, hạn, số lần dùng và điều kiện thu hồi. Resume hoặc task mới không hồi sinh lease; thay đổi trạng thái dữ liệu cần được đánh giá lại theo đặc tả.
6. **Bảo mật dữ liệu dẫn xuất.** Chính sách không chỉ dựa vào đường dẫn tệp. Dữ liệu bí mật/không tin cậy có thể xuất hiện trong tham số tool, file mới, URL, ảnh, log, summary hoặc output model và cần theo dõi/phòng thủ theo luồng phù hợp.
7. **Sandbox là ranh giới thực thi.** `realpath`, allowlist chuỗi lệnh hay Docker container đang chạy không tự tạo scope filesystem. Shell tùy ý chỉ được mở sau spike chứng minh cơ chế cưỡng chế và test được các đường thoát liên quan.
8. **Tách egress.** Model egress, fetch egress và sandbox/browser egress là các kênh khác nhau cần audit/chính sách riêng. “Tắt mạng box” không có nghĩa không dữ liệu nào rời máy nếu host còn gọi provider.
9. **Bí mật không vào sandbox.** Credential broker quản lý bí mật và cấp handle hạn chế; log/UI/trace cần redaction. Detector bí mật là lớp hỗ trợ, không là chứng minh không rò rỉ.
10. **Audit có thể đối chiếu.** Event/audit phải trả lời được ai/yếu tố nào tạo yêu cầu, dữ liệu ảnh hưởng, policy/lease nào được xét, route/tool nào chạy và kết quả gì, mà không chép bí mật vào log.

## 7. Lộ trình theo phụ thuộc, ưu tiên sản phẩm

Thứ tự dưới đây thay cho lịch ngày cố định của bản cũ. Chỉ gắn nhân lực/ngày sau khi chốt phạm vi, kết quả spike shell và năng lực đội. Mỗi pha phải có kiểm thử/tiêu chí nghiệm thu trước khi mở rộng bề mặt.

| Pha | Mục tiêu và sản phẩm đầu ra | Phụ thuộc/tiêu chí nghiệm thu |
|---|---|---|
| **0 — Bằng chứng và quyết định** | Hoàn thiện research, code-reference có provenance/license/checksum; ghi rõ trạng thái implemented/prototype/planned; chuyển nội dung cũ bằng bảng ở §10. | Không có claim về upstream/closed product không có nguồn. Snapshot không được runtime import. |
| **1 — Hợp đồng tin cậy** | Schema session/task/run/turn/epoch, message parts, label/provenance, approval, lease, budget, artifact, event/outbox và state machine với model/tool giả. | Test bất biến: tool trái mode, approval replay/stale, lease hết hạn, resume, context bẩn và derived data. Event replay không double-execute. |
| **2 — Spike shell và egress** | So sánh ba lựa chọn shell ở §9.1; mô hình hóa egress theo kênh và runner test cô lập. | Không mở `run_command` như capability bảo mật trước khi chứng minh được agent không chạm host sentinel, sibling ngoài scope, secret không mount hoặc network ngoài cấu hình. |
| **3 — Vertical slice một agent** | Plan/Act thật, một cổng model, một cổng tool, artifact server-side, read/write có scope và UI event thật. | Hoàn thành task coding nhỏ; server kiểm tool call; secret-derived context không đi cloud khi policy cấm; retry/budget dừng đúng. |
| **4 — Nền nhiều agent** | Child session, lineage, role/capability profile, delegation contract, budget/cancellation tree, artifact handoff và scheduler. | Agent con không tăng quyền/rửa provenance; hủy/retry/resume không tạo hành động trùng; cấu hình chưa hỗ trợ báo rõ. |
| **5 — Router sản phẩm** | Canonical protocol, provider/client adapters cần thiết, catalog model, credential broker opaque, route/fallback/rate limit/observability. | Credential không vào sandbox/log; fallback không vượt policy; stream/tool call được chuẩn hóa và có audit. |
| **6 — Skills, context và bề mặt desktop** | Progressive skills có provenance/quarantine, compaction an toàn, browser/vision, UI approval rõ và lựa chọn desktop-control đã chốt. | Skill độc không đổi quyền; summary không mất nhãn; test stale perception và user/agent control theo quyết định đã chọn. |
| **7 — Đánh giá và hardening** | Bộ kiểm bất biến, benchmark/fixture quan sát được, simulator card-specific, báo cáo ASR/utility/prompts/cost/latency và giới hạn. | So sánh cùng topology/model/config; receiver kiểm thử quan sát được; phân biệt attack bị router chặn với utility chưa chạy. |

### 7.1 Các gate cần quyết định

- **Gate A — sau pha 0:** tài liệu/bằng chứng phân biệt rõ code đã có, mock và thiết kế dự kiến.
- **Gate B — sau pha 2:** chọn ranh giới shell; nếu chưa đạt, `run_command` không được quảng bá là giới hạn theo path.
- **Gate C — sau pha 3:** vertical slice có event/approval/tool enforcement thực; nếu không đạt, dừng mở rộng đa agent.
- **Gate D — sau pha 4:** delegation giữ được quyền con và provenance; nếu không đạt, giữ một agent cho runtime nhưng không bỏ schema/hợp đồng.
- **Gate E — trước browser/desktop concurrent:** chốt mô hình điều khiển người dùng/agent và chứng minh xử lý stale action.

## 8. Đánh giá sản phẩm và nghiên cứu

Mục này chỉ giữ mục tiêu và điều kiện cấp sản phẩm. Đặc tả protocol, fixture, simulator, cấu hình, metrics, tái tạo và roadmap nằm tại [Kế hoạch đánh giá Agent Box](agent-box-evaluation.md). Tài liệu đó là kế hoạch nghiên cứu, không phải kết quả benchmark đã có.

Mục tiêu đánh giá là xem các ranh giới có giúp giảm tấn công mà vẫn để agent làm việc hay không, không phải tuyên bố BoxFox vượt mọi benchmark năng lực tổng quát.

- Giữ ba chỉ số chính: **Attack Success Rate (ASR — tỷ lệ tấn công thành công)**, utility/khả năng hoàn thành tác vụ và số lần hỏi người dùng. Báo thêm invariant violations, lease được cấp/đã dùng, route blocks, cost, latency và failure reasons khi có dữ liệu.
- Các ca phải bao gồm input độc từ repository, web/tool, màn hình, rửa nhãn, quyền mang qua thời điểm và delegation. Ca kiểm bất biến là test pass/fail từ sớm; benchmark là thí nghiệm có số liệu.
- So sánh cấu hình phải dùng cùng task, topology network, model/route version và simulator đã chốt. Nếu dùng C0/C1/C2/C3 hoặc biến thể strict/plan-scoped, mô tả rõ từng policy thay vì gán chúng cho mọi sản phẩm hiện có.
- Simulated user chỉ nhìn thấy nội dung UI/card được phép thấy và dùng luật chốt trước. Không để simulator biết ground truth bí mật hoặc tự vô tình biến ASR thành 0 bằng cách không cấp loại quyền đang đo.
- Egress attack cần receiver canary trong mạng test cô lập để quan sát side effect; tắt mạng làm đích không nhận được dữ liệu không phải bằng chứng policy đã chặn đúng.

## 9. Những quyết định còn mở

### 9.1 Shell và phạm vi filesystem

Chưa có lựa chọn nào được coi là đã chọn hoặc đã triển khai. [ADR-0001 — ba lựa chọn cô lập shell](../architecture/decisions/0001-shell-isolation-options.md) là nguồn chi tiết: worker ngắn hạn với mount riêng (thử trước), sandbox tiến trình trong desktop, hoặc shell toàn workspace với tuyên bố bảo mật thu hẹp. ADR cũng định nghĩa spike cho sibling write, symlink race, host sentinel, secret không mount, process con và egress. Không mở shell tự do như capability bảo mật trước khi spike đạt.

### 9.2 Điều khiển desktop đồng thời

Quyết định này được hoãn. [ADR-0002 — điều khiển desktop đồng thời](../architecture/decisions/0002-concurrent-desktop-control.md) giữ ba hướng: user takeover tạm dừng agent, revision cộng khóa action ngắn, hoặc input tự do chỉ audit. Khuyến nghị bản đầu là pause khi user nhận điều khiển; không tự chọn thay cho quyết định trải nghiệm sản phẩm và không bật computer use có side effect trước khi executor có test race.

### 9.3 Các câu hỏi sản phẩm cần trả lời trước khi cam kết lịch

1. Nhóm người dùng đầu tiên và loại tác vụ chính là gì: coding, research hay desktop/browser workflow?
2. Mức cloud nào chấp nhận được khi định vị local-first: chỉ self-host, hybrid hay hosted control plane?
3. Multi-agent MVP cần những vai trò nào, giới hạn bao nhiêu child session/budget và agent nào được phép dùng tool nào?
4. Có cần nghiên cứu tích hợp tài khoản subscription/traffic interception không, hay chỉ hỗ trợ API key và OAuth chính thức trong MVP?
5. Sau spike, có chấp nhận giảm claim filesystem nếu phải chọn shell toàn workspace không?

## 10. Bảng chuyển từ kế hoạch cũ (Phần 0–XVI)

Bản kế hoạch trước dài 2.844 dòng. Không xóa quyết định mà không có nơi thay thế: bảng dưới ánh xạ từng phần sang tài liệu chủ hoặc phần được giữ lại. Các số liệu thị trường/model/ước lượng cũ chỉ được tái dùng sau khi có nguồn và ngày kiểm.

| Phần cũ | Nội dung cũ | Nơi hiện hành | Xử lý |
|---|---|---|---|
| **0** | Từ điển thuật ngữ | §2 của tài liệu này; `docs/research/terminology.md` | Giữ glossary ngắn ở đây; chi tiết/ký hiệu chỉ để nơi chuyên trách. |
| **I** | Sản phẩm là gì | §3 | Giữ mục tiêu, người dùng và khác biệt sản phẩm. |
| **II** | Kiến trúc tổng thể | §5 | Giữ map/ràng buộc cấp cao; chi tiết interface chuyển sang architecture docs. |
| **III** | Bối cảnh và prompt injection | `docs/research/agent-harness/` và §3.2, §6 | Chỉ giữ lý do sản phẩm; claim nghiên cứu cần evidence. |
| **IV** | Đối thủ và công trình liên quan | `docs/research/agent-harness/`, `docs/research/model-router/` | Chuyển toàn bộ khảo sát, nguồn/so sánh và public-docs-only record sang research. |
| **V** | Agent Core, Plan/Act, Controller, multi-agent | [Kiến trúc harness](../architecture/agent-harness.md), §5.2, §7 | Harness là nguồn chuẩn cho vòng đời/prompt/delegation; giữ ưu tiên nhiều agent và UX Plan/Act ở plan. |
| **VI** | Tool và Skill | [Kiến trúc harness](../architecture/agent-harness.md), §5.4, §6 | Chuyển registry/executor/skill schema; giữ quyết định progressive load và enforcement. |
| **VII** | Sandbox/AI Computer | [Kiến trúc sandbox](../architecture/sandbox.md), §6, §9.1 | Giữ ranh giới và lựa chọn shell; không lặp cấu hình desktop. |
| **VIII** | Computer Use | [Kiến trúc harness](../architecture/agent-harness.md), [Kiến trúc sandbox](../architecture/sandbox.md), §9.2 | Chuyển action/perception detail; giữ decision desktop concurrent mở. |
| **IX** | Bảo mật, nhãn, lease, audit | §6; [Mô hình bảo mật](../architecture/security-model.md) | **Đã chuyển.** Đặc tả TCB, mô hình đe dọa, nhãn, approval/lease, egress, audit và tiêu chí test có một nguồn chuẩn ở security model. |
| **X** | Memory và Context | [Kiến trúc harness](../architecture/agent-harness.md), §5.4 | Chuyển ContextChunk/compaction/prompt composition; giữ bất biến provenance. |
| **XI** | Model Router | [Kiến trúc model router](../architecture/model-router.md), §5.3 | Chuyển protocol/provider/adapter; thay hướng LiteLLM-only bằng router đa giao thức. |
| **XII** | Giao diện Web | §5.1, §7, §9.2; **tạm thời:** `git show main:docs/plan/agent-box-plan.md` (mục 12.1–12.7) | Mới giữ vai trò UI, approval/event contract và quyết định desktop. Bố cục năm khung, card, API/UI state và lộ trình chi tiết **vẫn phải được trích xuất** sang frontend/spec chuyên trách; chưa coi migration hoàn tất. |
| **XIII** | Benchmark và đánh giá | §8; [Kế hoạch đánh giá Agent Box](agent-box-evaluation.md) | **Đã chuyển.** Câu hỏi nghiên cứu, fixtures, simulator, cấu hình, metrics, tái tạo và roadmap có một nguồn chuẩn ở evaluation plan. |
| **XIV** | Lộ trình đồ án | §7 | Thay lịch/nhân lực mâu thuẫn bằng pha phụ thuộc và gate nghiệm thu. |
| **XV** | Lộ trình sản phẩm/cloud | §3, §5.3, §7, §9.3 | Giữ local-first, router/credential boundary và quyết định cloud cần chốt. |
| **XVI** | Rủi ro và điểm cần quyết | §3.3, §9 | Giữ giới hạn trung thực, shell, desktop control và câu hỏi sản phẩm. |

## 11. Tiêu chí hoàn tất tài liệu và chuyển sang triển khai

Trước khi dùng kế hoạch này làm căn cứ triển khai, kiểm tra tối thiểu:

1. Link từ research tới snapshot và manifest hoạt động; mỗi snapshot có commit SHA đầy đủ, checksum, giấy phép, nguồn và phân loại `copy`, `adapt` hoặc `reference-only`.
2. Tài liệu về sản phẩm đóng ghi `public-docs-only`, không suy đoán mã nội bộ hoặc tạo pseudo-snapshot.
3. Không có tài liệu nào nhầm UI mock, Docker desktop hoặc package rỗng với security enforcement/backend runtime.
4. Harness/router không lặp toàn bộ chính sách bảo mật; chúng gọi qua boundary và trỏ tới [mô hình bảo mật](../architecture/security-model.md) cùng [kế hoạch đánh giá](agent-box-evaluation.md) làm nguồn chuẩn. Chỉ chi tiết UI của Phần XII còn được bảo toàn để trích xuất bằng `git show main:docs/plan/agent-box-plan.md`; chưa coi migration Phần XII hoàn tất.
5. Mọi thuật ngữ/viết tắt xuất hiện trong plan được giải thích trước khi dùng, hoặc dẫn glossary.
6. Trước khi mở capability nguy hiểm, có test chứa model/tool giả cho bypass; trước khi công bố enforcement, có integration test trên ranh giới thực.

---

## Liên kết liên quan

- [Tóm tắt kế hoạch](agent-box-plan-summary.md)
- [Kiến trúc harness](../architecture/agent-harness.md)
- [Kiến trúc model router](../architecture/model-router.md)
- [Kiến trúc sandbox](../architecture/sandbox.md)
- [Ghi chép nghiên cứu harness](../research/agent-harness/)
- [Ghi chép nghiên cứu router](../research/model-router/)
- [`code-reference/`](../../code-reference/) — snapshot mã nguồn làm bằng chứng, không thuộc runtime
