# Vorflux — public-docs-only

## Phạm vi bằng chứng và trạng thái truy cập

Bản ghi này là **public-docs-only**. **Ngày truy cập/kiểm tra nguồn: 2026-09-15 (UTC).** Không dùng kiến thức nội bộ nền tảng, nội dung của agent session, hay tài liệu không công khai làm bằng chứng.

Các URL sau truy cập được bằng HTTP 200 vào ngày kiểm tra:

- <https://vorflux.com/docs>
- <https://vorflux.com/docs/api/sessions>
- <https://vorflux.com/docs/subagents>
- <https://vorflux.com/docs/memory>
- <https://vorflux.com/docs/first-session>
- <https://vorflux.com/docs/plan-mode>

Tuy nhiên, trong lần kiểm tra này mọi route trên (kể cả `https://vorflux.ai/docs` và các route cùng tên) trả về **cùng một HTML SPA/placeholder**: cùng kích thước và title *“Vorflux. A cloud-based AI coding agent for teams.”*; HTML không mang nội dung trang route có thể kiểm tra riêng. Vì vậy danh sách URL chỉ chứng minh hostname/trang SPA công khai đang truy cập được, **không** chứng minh API session, subagent, memory, plan mode hoặc semantics của các route đó.

HTML placeholder công khai có metadata/description tự nhận Vorflux là một cloud-based AI coding agent cho teams và có “dedicated machines”. Đây là mô tả marketing của trang, không phải đặc tả kỹ thuật hay security guarantee.

## Điều không có bằng chứng công khai có thể kiểm tra hiện tại

Từ các trang đang reachable, không thể xác minh các tuyên bố trước đây về:

- API tạo session/message, lifecycle hoặc trạng thái session;
- delegation/subsession, transcript riêng hoặc lineage;
- `/memory/`, persistence, account scope, ownership hay ACL;
- plan mode, workflow-script, routing hoặc orchestration;
- isolation process/container/VM, filesystem/network, credential flow, event/artifact schema hay retention.

Do đó, tài liệu này không quy các hành vi đó cho Vorflux và không tạo snapshot/code-reference cho sản phẩm này.

## Đề xuất độc lập cho BoxFox

Các điểm sau là **đề xuất BoxFox**, không phải bằng chứng về Vorflux:

1. Gán ID, owner, lineage, permission và retention rõ ràng cho session, child session và artifact.
2. Tách shared memory khỏi shared authority; mỗi record cần namespace, trust label, provenance và ACL.
3. Thiết kế event store/audit và resume/reconnect có kiểm thử; không suy luận chúng từ UI hoặc URL route.
4. Chỉ nâng mức bằng chứng cho Vorflux khi một trang public có nội dung route cụ thể và có thể kiểm tra, hoặc khi có nguồn công khai khác được trích dẫn chính xác.
