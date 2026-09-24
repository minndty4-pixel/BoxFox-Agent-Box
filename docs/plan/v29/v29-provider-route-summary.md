# Vòng 29 — Chọn model theo **provider + model**: một dòng cho mỗi model, router tự chuyển connection/khoá

> **TL;DR:** Thêm dạng route thứ ba (provider + model) đi hết đường từ picker tới router: danh sách model gộp còn một dòng cho mỗi cặp provider+model, phiên lưu cặp đó thay vì ghim một connection, và router tự thử các connection/khoá còn hạn mức — **router không phải sửa một dòng nào** vì nó đã nhận `providerId` + `modelId` và đã failover sẵn.

## Vấn đề

Mỗi connection chỉ giữ một khoá, nên bốn khoá opencode là bốn connection, và picker hiện bốn dòng giống nhau. Phiên lại ghim đúng một connection, nên khi khoá đó hết hạn mức thì router không còn chỗ nào để chuyển — đúng cái đã làm sáu lượt research trước chết ở 429.

## Cách làm

1. **Picker gộp dòng:** gom theo cặp (providerId, modelId) trên các connection dùng được ⇒ một dòng `OpenCode Free · muse-spark-…`, nhãn theo tên nhà cung cấp (không theo tên connection), kèm số connection khi nhiều hơn một.
2. **Ghim vẫn còn:** nhóm nào có từ hai connection trở lên thì dòng provider mở ra danh sách con — mỗi hàng con là một connection (chỗ còn hiện "key 1/2/3"), chọn hàng con là ghim đúng connection như trước. Nhóm một connection thì không có nhánh ghim.
3. **Phiên lưu provider + model:** dạng route mới `{providerId, modelId}` thay cho `{connectionId, modelId}` khi owner chọn dòng provider; dạng cũ giữ nguyên cho các phiên đã lưu và cho lựa chọn ghim. Harness gửi nguyên cặp đó lên router — **không** tự phân giải thành alias hay danh sách target, vì như vậy là chép lại luật "connection nào dùng được" ở chỗ thứ hai, và danh sách alias đóng băng trong khi router phải tính lại mỗi lượt.
4. **Router lo phần chuyển:** đã có sẵn target list theo thứ tự connection của provider, xoay vòng khi bật `roundRobin`, và chuyển sang target kế khi gặp lỗi retryable mà chưa có output. Kế hoạch này không sửa mã router.

## Điểm cần chốt trong kế hoạch (đã quyết)

- **Cửa sổ ngữ cảnh / mức thinking của một dòng provider:** lấy trên *mọi* connection dùng được của provider đó — cửa sổ là **số nhỏ nhất**, mức thinking là **giao** các danh sách công bố. Lý do: router có thể chạy lượt trên bất kỳ target nào, nên metadata phải đúng cho ca xấu nhất; hứa số đẹp nhất sẽ chết vì tràn ngữ cảnh sau khi đã chuyển target.
- **Mức thinking:** route provider chỉ mang mức khi mức đang chọn có trong giao đó; không biết giao thì không gửi mức nào — đúng luật đã áp cho alias.
- **Back-compat:** phiên cũ giữ `{connectionId, modelId}` chạy y nguyên; route là JSON tự do nên không cần migration, không đổi bảng nào.
- **Không đổi:** `/v1/chat/completions` và hình dạng wire của OpenCode Free, không thêm dependency, không thêm endpoint router, không đụng phạm vi key ring (kế hoạch riêng).

## Ranh giới với kế hoạch key ring

Key ring (một connection chứa nhiều khoá, xoay khi 429, cooldown 30 giây hoặc `retry-after` tối đa 2 phút) và việc gộp bốn connection opencode **không** thuộc kế hoạch này. Kế hoạch này dựng mặt bằng để sau khi gộp, một dòng provider vẫn định tuyến được và tự thử các khoá còn hạn mức; nó đúng ở cả hai trạng thái (chưa gộp: bốn dòng con để ghim; đã gộp: một dòng, không nhánh ghim).

## Kiểm thử

- Backend: tệp test mới cho route provider (luật gộp metadata, lưu route nguyên văn, `route_for` hiểu tiền tố provider, chế độ single-model, lượt đổi model vẫn đối chiếu mức) + ba tệp pin cũ chạy lại làm regression.
- Frontend: ca gộp dòng (bốn connection ⇒ một dòng, hai connection ⇒ hai hàng con ghim), ca body phiên/lượt mang `providerId` + `modelId`, ca picker render nhánh ghim, ca thanh ngữ cảnh lấy số nhỏ nhất.
- Router: chỉ chạy lại bộ cũ (không sửa mã).
- Trên app thật: chọn provider một lần, gửi lượt, và làm hết hạn mức khoá đang dùng để thấy lượt sau vẫn sống.

## Kích thước và thứ tự

Khoảng **13 tệp, ~680 dòng** (3 tệp mới). Hai đợt đầu chạy song song (backend route+metadata; frontend dạng selection + gộp dòng + payload), đợt ba làm giao diện picker và nhánh ghim, đợt bốn ghi số vào sổ sau khi kiểm trên app thật.

## Còn mở (ngắn)

- Nhánh provider của router có nên bỏ target đang cooldown khi tính offset xoay vòng (hiện chỉ bỏ qua lúc chạy).
- `snapshot.defaultRoute` có nhận dạng provider hay không — kế hoạch này để nguyên.
- Câu chữ và vị trí nút ghim (thay đổi giao diện, cần design subagent trước khi thi công đợt ba).
