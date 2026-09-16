# ADR-0001: Giữ ba lựa chọn cô lập shell, spike worker ngắn hạn trước

- **Trạng thái:** Đề xuất để thử nghiệm; chưa chọn kiến trúc production.
- **Ngày:** 2026-09-15
- **Quyết định liên quan:** `docs/architecture/agent-harness.md`, `docs/architecture/sandbox.md`.

## Bối cảnh và thuật ngữ

**ADR (Architecture Decision Record)** là bản ghi bối cảnh, lựa chọn và hệ quả của một quyết định. **Shell** là công cụ chạy lệnh tùy ý. **Sandbox** là ranh giới thực thi hạn chế tài nguyên. **Mount** là thư mục host/volume được gắn vào môi trường chạy. **Worker ngắn hạn** là process/container sinh cho một action hoặc run rồi bị hủy. **Scope** là tập đường dẫn/capability đã cấp quyền. **OS (Operating System)** là hệ điều hành.

BoxFox cần khớp giữa grant logic của IFC và enforcement thật. Container desktop hiện hữu hữu ích cho trải nghiệm, nhưng không được tự coi là chứng minh rằng mỗi lệnh shell chỉ thấy các đường dẫn đã cấp. Đặc biệt, Docker bind mount được cấu hình khi tạo container; không được diễn giải một kiểm tra path ở application là filesystem isolation.

## Ba lựa chọn giữ nguyên

| Lựa chọn | Mô tả | Lợi ích | Đánh đổi/rủi ro cần chứng minh |
|---|---|---|---|
| 1. **Worker ngắn hạn với mount riêng** | Tạo worker cho action/run với read/write mounts đúng scope và network profile; trả artifact/diff rồi hủy | Ranh giới filesystem/process dễ quan sát và test nhất; revocation/cancel có nghĩa rõ | Tốn orchestration, đồng bộ workspace/desktop và cần dọn process/con; không tự giải quyết egress |
| 2. **Sandbox process trong desktop** | Chạy tool process trong desktop container qua cơ chế OS/policy filesystem/network | Trải nghiệm liên tục, ít đồng bộ hơn | Khó bảo đảm process tree, filesystem, symlink, network và đa nền tảng; cần primitive enforcement thực thay vì wrapper path |
| 3. **Shell toàn workspace** | Cho shell thấy workspace chung, chỉ dựa vào approval/audit và các giới hạn khác | Đơn giản, phù hợp prototype/trải nghiệm desktop | Không được tuyên bố path-scoped shell isolation; grant hẹp không có enforcement tương ứng |

## Khuyến nghị và quyết định hiện tại

Chưa chốt phương án production. **Spike phương án 1 trước** vì nó tạo ranh giới dễ kiểm chứng nhất giữa một grant scope và tài nguyên process/filesystem thực. Song song chỉ nghiên cứu phương án 2 khi có cơ chế OS cụ thể có thể kiểm thử. Phương án 3 vẫn là lựa chọn hợp lệ cho trải nghiệm/prototype nếu được nêu minh bạch là workspace-wide shell và không dùng để chứng minh IFC path isolation.

Không được tự chọn phương án 3 như fallback im lặng khi spike thất bại. `run_command` không được tuyên bố an toàn theo scope hẹp cho đến khi enforcement được chứng minh.

## Tiêu chí spike và hệ quả

Đo với host sentinel và secrets/config không được mount, không dùng `/etc/passwd` trong container làm bằng chứng thoát host:

1. Lệnh/symlink/path traversal không đọc/ghi sibling ngoài scope hay host sentinel.
2. Worker không truy cập credential/control API; raw token không có trong environment/mount/log.
3. Cancellation, timeout và revoke dừng cả process tree; không còn child sống sót.
4. Network profile đo được riêng: off/controlled/open; request egress không đi vòng shell/browser ngoài policy.
5. Artifact/diff và audit nối lại đúng action/grant/epoch sau crash.
6. Regression có kết quả pass/fail cho read, write, execute, symlink race, subprocess và resume unknown outcome.

Kết quả spike sẽ cập nhật ADR này bằng evidence, phạm vi công bố bảo mật và quyết định production. Cho đến lúc đó harness chỉ gọi executor/sandbox qua API và không giả định lựa chọn nào đã đạt.
