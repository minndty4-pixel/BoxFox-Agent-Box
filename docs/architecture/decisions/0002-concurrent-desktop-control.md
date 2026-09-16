# ADR-0002: Hoãn quyết định điều khiển desktop đồng thời

- **Trạng thái:** Hoãn; cần quyết định sản phẩm và spike executor trước khi bật computer use có tác dụng phụ.
- **Ngày:** 2026-09-15
- **Quyết định liên quan:** `docs/architecture/sandbox.md`, `docs/architecture/element-selector.md`, `docs/architecture/agent-harness.md`.

## Bối cảnh và thuật ngữ

**Desktop control** là click/type/keyboard có tác dụng phụ trong desktop sandbox. **Concurrent control** là người dùng và agent đều có thể gửi input trong cùng thời gian. **Perception** là ảnh/DOM (Document Object Model — biểu diễn cấu trúc trang web)/trạng thái agent dùng để chọn action. **Revision** là số phiên bản đơn điệu của perception/desktop state. **Stale action** là action được tính từ revision không còn hiện tại. **Serialize** là buộc action xảy ra theo thứ tự loại trừ nhau. **VNC (Virtual Network Computing)** là giao thức xem và điều khiển desktop từ xa. **UI (User Interface)** là giao diện người dùng; **UX (User Experience)** là trải nghiệm người dùng.

BoxFox đã có desktop VNC và endpoint quan sát/chọn phần tử. Những khả năng này không tự chứng minh click/type của agent còn đúng sau khi người dùng thay đổi cửa sổ, focus hoặc DOM. Chỉ cờ “perception fresh” ở client không đóng cuộc đua giữa lần kiểm tra và lần executor gửi action.

## Lựa chọn được giữ mở

| Lựa chọn | Trải nghiệm | Bảo đảm và chi phí |
|---|---|---|
| 1. **Người dùng lấy điều khiển thì pause agent** | Dễ hiểu, có thể làm gián đoạn agent | Dễ tránh action stale nhất cho bản đầu; cần UX handoff/resume rõ |
| 2. **Revision + khóa action ngắn** | Cả hai có thể xen kẽ nhanh hơn | Executor phải kiểm revision tại điểm action, serialize đoạn ngắn và hủy mọi proposal stale; phức tạp hơn |
| 3. **Input tự do, chỉ audit** | Linh hoạt nhất | Không được tuyên bố chống stale action; chỉ phù hợp quan sát/prototype khi người dùng chấp nhận giới hạn |

## Quyết định hiện tại

Không chọn thay người dùng. Computer use có side effect bị giữ sau feature flag cho đến khi product quyết định một lựa chọn và executor có test race. Nếu cần bản đầu ổn định, khuyến nghị **lựa chọn 1**. Lựa chọn 2 là hướng sau khi action executor hỗ trợ revision atomic; lựa chọn 3 phải hiện rõ giới hạn trong giao diện và tài liệu.

## Tiêu chí trước khi bật

- Mỗi perception/element target mang `screen_revision` hoặc revision nguồn tương đương.
- Executor kiểm revision, target validity và policy ngay trước click/type, không chỉ lúc model đề nghị.
- Test mô phỏng input người dùng giữa perception và action; action cũ phải bị cancel/review lại theo lựa chọn đã chốt.
- Audit phân biệt actor user/agent với nhãn của dữ liệu; actor user không làm dữ liệu hiển thị trở thành trusted instruction.
- Pause/cancel lan tới pending browser actions và UI thể hiện trạng thái rõ khi reconnect.
