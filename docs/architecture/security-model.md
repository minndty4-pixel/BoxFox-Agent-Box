# Mô hình bảo mật và kiểm soát luồng dữ liệu của BoxFox

> **Trạng thái:** đặc tả kiến trúc và tiêu chí kiểm thử, **chưa phải** bằng chứng rằng backend hiện tại đã thực thi các cơ chế này. Repository hiện chưa có security gateway/harness hoàn chỉnh để chứng minh enforcement đầu-cuối.
>
> Tài liệu này là nguồn chuẩn cho mô hình đe dọa, nhãn, approval, lease và audit. Harness phải gọi cổng chính sách này, không tự diễn giải lại luật trong prompt. Xem [kiến trúc harness](agent-harness.md), [kiến trúc model router](model-router.md), [kiến trúc sandbox](sandbox.md), [nghiên cứu harness](../research/agent-harness/) và [nghiên cứu router](../research/model-router/).

## 1. Mục tiêu, thuật ngữ và ranh giới

**IFC (Information-Flow Control — kiểm soát luồng thông tin)** trả lời dữ liệu từ nguồn nào được phép ảnh hưởng hành động nào và đi tới đích nào. **TCB (Trusted Computing Base — cơ sở tính toán phải tin cậy)** là phần sai một lần thì các bảo đảm dưới đây không còn giá trị. **Egress** là dữ liệu/request rời BoxFox đến provider model, website, API hoặc receiver kiểm thử. **Lease** là giấy phép có hạn: quyền có phạm vi, thời hạn, điều kiện và khả năng thu hồi.

Mục tiêu là giảm tác động của nội dung độc đã được agent đọc: nội dung đó không được tự biến thành quyền `WRITE`, `EXEC` hay `EGRESS`. Quyết định quyền là mã chính sách xác định, không phải output của mô hình ngôn ngữ lớn (LLM). Việc ẩn tool trong prompt, lọc lời mô hình hoặc hiện một thẻ UI chỉ hỗ trợ trải nghiệm; executor phải kiểm lại ở thời điểm thực thi.

Mô hình này không tuyên bố phát hiện chính xác hành động nào “bị ảnh hưởng” bởi một đoạn văn bản. Khi LLM đã đọc dữ liệu, quan hệ nhân quả bên trong model không quan sát được. Thay vào đó, khi ngữ cảnh có dữ liệu không tin cậy, policy xử lý bảo thủ mọi hành động nguy hiểm.

## 2. Mô hình kẻ tấn công A1–A7

| Mã | Kẻ tấn công | Khả năng giả định | Phạm vi |
|---|---|---|---|
| **A1** | Nội dung web/repository độc | Ghi chỉ thị vào web, README, issue, comment, file hướng dẫn hoặc skill mà agent đọc; không chạy mã trên máy. | Có, mục tiêu chính. |
| **A2** | Kết quả tool bên ngoài độc | Trả dữ liệu/chỉ thị qua API, connector hoặc tool; benchmark có thể dùng tool giả lập thay vì tích hợp giao thức bên ngoài thật. | Có, mục tiêu chính. |
| **A3** | Tiêm chỉ thị bằng hình ảnh (visual prompt injection) | Vẽ chữ/banner/ảnh mà agent nhìn qua screenshot hoặc vision. | Có, mục tiêu chính. |
| **A4** | Package/skill có script độc | Thực thi mã khi cài, import hoặc load script. | Một phần: không coi nội dung bên thứ ba là trusted; cần sandbox và quy tắc không tự chạy script. Không hứa loại bỏ mọi lỗ hổng mã thực thi. |
| **A5** | Provider/LLM trả output độc hoặc bị lạm dụng | Đề nghị tool call bất kỳ, kể cả trái mục tiêu. | Một phần: output vẫn đi qua policy/executor; không bảo vệ sự đúng đắn, tính sẵn sàng hay riêng tư của provider ngoài policy đã cấu hình. |
| **A6** | Người dùng chủ động phá máy/quyền của mình | Có quyền chủ máy và xác nhận hành động độc. | Ngoài phạm vi. Người dùng phê duyệt sai vẫn có thể làm tấn công thành công. |
| **A7** | Kẻ đã có shell/quyền quản trị host hay kho policy | Sửa code, database, policy, audit hoặc bí mật. | Ngoài phạm vi. |

A1–A3 chỉ kiểm soát **nội dung**, không có quyền sửa enforcement. A4–A7 nhắc rõ nơi các giả định yếu đi; không được dùng mô hình này để tuyên bố chống mã độc host hay quản trị viên ác ý.

## 3. TCB và đường kiểm tra bắt buộc

TCB dự kiến gồm: controller/harness phía server ở phần chuyển trạng thái; Policy Engine, Lease/Approval/Label Store; secret/credential broker; tool executor first-party; artifact/event/audit store; cấu hình route/egress; và nền sandbox/host thực thi các giới hạn đã được kiểm chứng. UI, LLM output, web, file workspace, kết quả tool ngoài, pixel màn hình, skill tải ngoài và script bên thứ ba **không** thuộc TCB.

```text
Dữ liệu/LLM/tool output không tin cậy
             │
             ▼
Harness ──proposal──> Policy Engine ──allow/ask/deny──> Executor/sandbox
             │                                      │
             └──────── Model Router <── egress ────┘
                            │
                    audit đã che bí mật
```

Mọi tool call, model egress, network egress, tạo agent con và kênh phụ trợ cần một cổng kiểm tra có thể audit. `allow` của policy không đủ: executor kiểm lại action, resource/đích đã chuẩn hóa, epoch, expiry, revocation, use-count và trạng thái dữ liệu **ngay trước khi chạy**. Điều này ngăn approval/lease hết hạn hoặc bị thu hồi trong thời gian chờ hàng đợi.

## 4. Ba trục nhãn độc lập

Một nhãn “an toàn/không an toàn” trộn ba câu hỏi khác nhau. Web công khai không nên chỉ đạo agent nhưng có thể được gửi lên model cloud; API key do người dùng dán có thể là ý định hợp lệ nhưng không được gửi cloud; README do người dùng dán để phân tích vẫn là dữ liệu, không phải system instruction.

| Trục | Câu hỏi trả lời | Dùng để quyết định |
|---|---|---|
| **Provenance (nguồn gốc)** | Dữ liệu đến từ đâu và được biến đổi qua đâu? | Giải thích, audit, truy vết `derived_from`. |
| **Integrity (toàn vẹn/quyền chỉ đạo)** | Dữ liệu có được phép ảnh hưởng hành động nguy hiểm không? | `WRITE`, `EXEC`, tạo agent con, và quyền hành động. |
| **Confidentiality (bí mật)** | Dữ liệu được phép đi tới model/đích nào? | Chọn route model, egress policy, log/redaction. |

### 4.1 Schema chuẩn hóa

Tên enum không được dùng để suy thứ tự theo chuỗi. Policy dùng hạng số xác định để `min`/`max` không đổi khi đổi tên hiển thị hoặc locale.

```text
IntegrityRank: UNTRUSTED = 0, USER_AUTHORIZED = 1
ConfidentialityRank: PUBLIC = 0, INTERNAL = 1, SECRET = 2

ArtifactLabel {
  label_id, artifact_id, content_hash,
  provenance: {
    source_kind, source_uri?, ingestion_tool?, actor?, created_at,
    derived_from: [label_id...]
  },
  integrity: { value, rank },
  confidentiality: { value, rank },
  policy_revision
}

ContextState {
  label_ids: [label_id...],
  integrity_floor_rank: min(labels.integrity.rank),
  confidentiality_ceiling_rank: max(labels.confidentiality.rank)
}
```

`derived_from` tạo đồ thị dẫn xuất: summary, ảnh crop, file mới, URL, tham số tool, model output, checkpoint, artifact của agent con và dữ liệu resume đều giữ cha liên quan. Một session không có một nhãn chung; context là một tập artifact có nhãn.

### 4.2 Gán nhãn mặc định

| Nguồn | Integrity | Confidentiality | Lưu ý |
|---|---|---|---|
| Người dùng gõ mục tiêu/lệnh | `USER_AUTHORIZED` | `INTERNAL` | Ý định người dùng không tự cấp capability. |
| Dữ liệu người dùng dán để phân tích | `UNTRUSTED` | `INTERNAL` hoặc `SECRET` | Tách lệnh gõ với nội dung được trích dẫn/dán. |
| Cấu hình BoxFox đã quản trị | `USER_AUTHORIZED` | `INTERNAL` | Thuộc TCB sau khi bảo vệ cấu hình được chứng minh. |
| File workspace hoặc ngoài workspace | `UNTRUSTED` | `INTERNAL`, có thể `SECRET` | Detector/path policy hỗ trợ, không phát hiện hết bí mật. |
| Web/DOM công khai | `UNTRUSTED` | `PUBLIC` | Công khai không có nghĩa được quyền chỉ đạo. |
| Kết quả tool/connector ngoài | `UNTRUSTED` | do declaration/policy của tool xác định | Không tin tool chỉ vì schema hợp lệ. |
| Screenshot/pixel | `UNTRUSTED` | bảo thủ theo nguồn màn hình; không xác định thì `INTERNAL` | Nhãn toàn ảnh là mô hình thô, không thay thế nhãn theo vùng. |
| Kết quả shell/tool | hợp của input, mount, tham số và output | hợp mức cao nhất của nguồn | Không chỉ dựa vào đường dẫn output. |

Dữ liệu dẫn xuất không được hạ `integrity` hoặc `confidentiality` chỉ vì đổi định dạng. Với confidentiality, phép hợp bảo thủ lấy cấp cao nhất. Với integrity, một đầu vào không tin cậy làm kết quả không tin cậy, trừ endorsement do người dùng được lưu bằng chứng cụ thể.

## 5. Bảo đảm, giới hạn và chống bùng nổ vết bẩn

### 5.1 Tuyên bố hẹp

Với A1–A3, và với điều kiện TCB/enforcement hoạt động đúng, BoxFox chỉ có thể tuyên bố:

> Không thực thi `WRITE`, `EXEC` hoặc `EGRESS` do agent khởi tạo khi context chứa dữ liệu `UNTRUSTED`, trừ khi tại thời điểm thực thi có một quyết định hợp lệ được cấp **sau trạng thái bẩn liên quan**, có action/scope/đích/epoch/hash khớp và chưa hết hạn, hết lượt hoặc bị thu hồi.

Tuyên bố này không nói biết chính xác dữ liệu nào gây ảnh hưởng; không chống A4/A7; không hứa người dùng nhận ra bước độc; không cho rằng approval rộng luôn hẹp như approval một lần; và không coi plan/skill là policy. Nếu người dùng duyệt hành động độc, đó vẫn là attack success trong đánh giá.

Dữ liệu mới hoặc derived data sau grant phải được kiểm theo `policy_revision` và context snapshot hiện tại. Không cho phép dùng lease cũ chỉ vì string resource còn khớp. Resume/task mới tăng epoch; approval/lease cũ không tự hồi sinh.

### 5.2 Ba cơ chế giảm taint explosion

| Cơ chế | Tác dụng hợp lệ | Điều không được làm |
|---|---|---|
| **Endorsement (chuẩn thuận)** | Người dùng xác nhận đúng artifact/hash sau khi xem nguồn; integrity của artifact đó được nâng theo policy và audit giữ provenance/actor/thời điểm. | Không chuẩn thuận cả session, pattern mơ hồ hay summary chưa chỉ rõ nguồn. |
| **Compartment (ngăn cách)** | Xử lý dữ liệu bẩn trong ngăn riêng; chỉ đưa ra giá trị có schema/kiểu để giảm bề mặt injection. | Không coi output LLM phụ, schema hay summary là “sạch”. Nó vẫn giữ `UNTRUSTED` và `derived_from`. |
| **Reset ngữ cảnh** | Bắt đầu context mới sau khi loại bỏ artifact bẩn **và toàn bộ cây dẫn xuất**. | Không giữ summary/file dẫn xuất rồi đặt context sạch. |

Ba bất biến để kiểm thử: (1) mọi derived artifact giữ nhãn/provenance bảo thủ; (2) reset loại toàn bộ đồ thị dẫn xuất liên quan; (3) chỉ endorsement của người dùng, với bằng chứng cụ thể, mới nâng integrity. Canary, regex hay classifier chỉ là heuristic/ablation: chúng có false negative/positive nên không nằm trên đường bảo đảm.

## 6. Approval và capability lease

### 6.1 Bốn loại quyết định không được gộp

| Loại | Cấp cho | Hiệu lực khi context bẩn | Ý nghĩa |
|---|---|---|---|
| **Allow once** | Một proposal/action cụ thể | Có, đúng một lần | Lựa chọn hẹp nhất; gắn request/action digest. |
| **Endorse artifact** | Một artifact/hash cụ thể | Có | Nâng integrity theo policy nhưng không xóa provenance. |
| **Lease thường** | Lớp action đã chuẩn hóa trong scope | Không | Dùng khi context đạt integrity yêu cầu. |
| **Dirty-context lease** | Lớp action hẹp sau khi người dùng đã xem context bẩn liên quan | Có, nếu neo còn hợp lệ | Ngoại lệ có chủ ý, không phải lease mặc định. |

Dirty-context lease phải được cấp từ một **permission proposal** hiển thị nguồn bẩn, không tự sinh khi simulator hoặc UI chỉ “đồng ý”. Nó neo ít nhất vào `dirty_context_digest`/tập label, hash proposal, scope digest và `task_epoch`. Nếu xuất hiện artifact `UNTRUSTED` mới ngoài phạm vi/tập đã review, hoặc dữ liệu dẫn xuất thay đổi digest, lease không còn dùng được và phải hỏi lại. Một endorsement khác dirty lease: endorsement thay nhãn của một artifact; dirty lease giữ context bẩn nhưng cho phép action hẹp.

**PlanReview** là một artifact/proposal riêng: người dùng review hash của plan, danh sách nguồn, scope chuẩn hóa và giới hạn. Nó không tự là lease, và trạng thái file `approved` không có giá trị. Nếu sau này hỗ trợ plan-scoped lease, lease phải trỏ `plan_review_id`, `plan_hash`, `scope_digest`, `task_epoch`, tập/digest dữ liệu bẩn đã thấy, hạn và giới hạn dùng. Egress và dữ liệu `SECRET` bị loại khỏi plan scope mặc định. Mọi action vẫn kiểm execution-time.

### 6.2 Dữ liệu lease tối thiểu

```text
Lease {
  lease_id, kind, task_id, task_epoch, policy_revision,
  proposal_id, proposal_hash, scope_digest,
  operation, tool_name, canonical_resources[], destinations[],
  required_integrity_rank, max_confidentiality_rank,
  dirty_context_digest?, plan_review_id?, plan_hash?,
  granted_by, granted_at, expires_at, max_uses, used_count,
  revoked_at?, revocation_reason?
}
```

`canonical_resources` và `destinations` phải chuẩn hóa trước so sánh; với filesystem cần cơ chế ranh giới thật (ví dụ mount/worker scope đã spike), không chỉ `realpath()` hay parser command. `used_count` được reserve/tăng nguyên tử trong transaction hoặc bằng idempotency key; revoke phải có hiệu lực trước dispatch kế tiếp.

### 6.3 Bảng quyết định

Bảng này áp dụng sau khi xác thực capability/tool, scope, confidentiality/egress, epoch, proposal hash, expiry, revocation và use count; “khớp” luôn gồm các kiểm tra đó.

| Context/action | Lease thường khớp | Dirty/plan-scoped lease hợp lệ | Quyết định |
|---|---:|---:|---|
| Integrity đủ, action không thuộc dirty context | Có | — | Cho phép, executor kiểm lần cuối. |
| Integrity đủ | Không | — | Hỏi hoặc từ chối theo policy. |
| Context bẩn | Có | Không | Hỏi: lease thường được cấp trước/không dành cho context bẩn không mở quyền. |
| Context bẩn | — | Có | Cho phép trong scope hẹp, sau execution-time check. |
| Context bẩn, artifact/digest mới hoặc PlanReview/hash/epoch lệch | bất kỳ | Không hợp lệ | Hỏi hoặc từ chối; không tái dùng approval. |
| Egress/secret vượt classification hoặc destination | bất kỳ | bất kỳ | Từ chối hoặc yêu cầu proposal phù hợp; không fallback lặng lẽ. |

## 7. Bí mật, dữ liệu dẫn xuất và egress

Credential hệ thống và token OAuth/API key thuộc broker/secret manager, không vào prompt, sandbox, workspace, log hay snapshot. Bí mật workspace có nhãn `SECRET`; mọi output/screenshot/summary/URL/tham số dẫn xuất phải giữ confidentiality bảo thủ. Path pattern và detector nội dung chỉ là best effort; người dùng cần cách tự khai báo artifact là `SECRET`.

Egress được tách thành ít nhất ba kênh: (1) router gọi provider model, (2) fetch/API tool, (3) network từ sandbox/browser/desktop. Tắt mạng sandbox không chứng minh không có dữ liệu rời máy: host/router vẫn có thể gọi provider. Policy/audit phải ghi receiver/route thật, classification, destination và kết quả cho từng kênh; router không được fallback tới provider không được phép.

Audit/log/UI chỉ lưu tham số đã redaction hoặc hash cần thiết, không chép raw secret. Xem boundary credential và route ở [model router](model-router.md); xem giới hạn network/container hiện có ở [sandbox](sandbox.md).

## 8. Audit và giới hạn hash chain

Audit cần trả lời: (1) dữ liệu nào/qua receiver nào đã rời hệ thống; (2) action được cho phép hay bị chặn bởi policy/approval/lease nào; (3) artifact/label/provenance nào ảnh hưởng quyết định. Bản ghi dự kiến gồm correlation/request ID, actor, task/epoch, action và scope digest, label/context digest, proposal/approval/lease IDs-hash, route/destination, policy revision, decision, executor outcome, thời điểm và redaction metadata.

Chuỗi hash nối tiếp chỉ phát hiện sửa đổi khi có **neo độc lập** (ví dụ chữ ký/hash định kỳ gửi sang kho hay máy khác mà A7 không sửa được). Nếu A7 có thể sửa cùng database và khóa, họ có thể tính lại cả chuỗi. Vì vậy hash chain nội bộ không phải bảo vệ chống A7 và không được trình bày là tamper-proof. Nếu chưa có external anchoring, audit chỉ là nhật ký vận hành hữu ích cho A1–A3 và điều tra lỗi trong giả định TCB.

## 9. Tiêu chí triển khai và kiểm thử

Trước khi tuyên bố enforcement, cần integration test trên ranh giới thật cho: A1–A3; summary/compaction/reset/child-session giữ đồ thị nhãn; approval replay và hash/scope/epoch stale; dirty-context lease bị invalid bởi nguồn mới; revocation/expiry/use count khi hàng đợi; derived secret bị chặn khỏi route cloud; từng kênh egress có receiver canary quan sát được; và audit redaction/truy vấn lineage. Thiết kế benchmark, simulator và các cấu hình đối chứng nằm tại [kế hoạch đánh giá Agent Box](../plan/agent-box-evaluation.md).
