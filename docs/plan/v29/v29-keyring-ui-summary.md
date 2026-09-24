# Vòng 29 — "key ring" trên giao diện Settings

> **TL;DR:** Một connection giữ **nhiều khoá** thay vì một ô "Replace API key"; giao diện hiện danh sách khoá kèm trạng thái và tự xoay khi hết hạn mức, gộp khoá của các connection trùng vào một connection, và gộp danh sách model còn **một dòng cho mỗi model**.

## Hiện tại và sau khi làm

| | Hôm nay | Sau vòng 29 |
|---|---|---|
| Khoá của một connection | **Một** ô input (`Replace API key` — `ProviderView.tsx:408`, `:829-861`) — gõ là ghi đè khoá cũ | Danh sách khoá có thứ tự; mỗi dòng có nhãn, tiền tố che, trạng thái, và ba nút Thay / Bỏ / Thử ngay |
| Trạng thái khoá | Không có | `ready` · `cooling · HH:MM` (đếm ngược 30 giây) · `quota exhausted` · `error` (kèm dòng lỗi cuối) |
| Xoay khoá | Xoay **giữa các connection** (`roundRobin` + `connectionOrder`) | Xoay **bên trong** connection khi 429; xoay giữa connection vẫn còn nguyên |
| Bốn connection `opencode` | Bốn connection riêng, ba khoá rải rác | Gộp khoá về **một** connection; connection trùng được xoá bằng một cú bấm |
| Danh sách model | Một dòng cho mỗi (connection, model) — chủ nhà thấy "key1 model A, key2 model A" | Một dòng cho mỗi model, ghi rõ số connection phục vụ nó |

## Cách làm

**Khoá (tab API và tab Router).** Thêm component `ConnectionKeyRing` hiển thị danh sách khoá của một connection, đặt đúng chỗ ô input đơn hôm nay: `ProviderView.tsx:403-421` ở tab API (thay dòng 408) và `:829-861` ở tab Router (chỉ với connection không phải OAuth). Connection chưa có khoá thì khối này tự hiện empty state kèm nút **Add key** — không bắt chủ nhà đi vòng qua nút Edit. Mọi lệnh đều đi qua `providerStore.request()` như các nút hiện có, nên lỗi vẫn hiện ở banner và snapshot tự tải lại.

**Gộp khoá.** Một hành động **"Merge keys from another connection"** trên card: chọn một connection **cùng provider**, gửi đúng một lời gọi để router chuyển khoá phía server. Giao diện **không bao giờ** thấy hay giữ secret. Sau khi gộp, connection nguồn **vẫn hiện** ở trạng thái rỗng khoá kèm dòng "đã chuyển N khoá sang X" và nút Delete được bật — không có gì tự xoá. Nút Delete của một connection còn khoá thì **bị chặn ngay trên giao diện**, kèm câu giải thích, và router vẫn là lớp chặn thứ hai.

**Danh sách model.** Chọn cách **gộp theo provider**: một model chỉ có một dòng, thêm chip `N connections` khi nhiều connection cùng phục vụ. Lý do: đúng yêu cầu "một dòng cho mỗi model", sau khi gộp khoá thì ca phổ biến thu về đúng danh sách hôm nay, và không để lỗi nhân đôi quay lại khi ai đó thêm connection thứ hai. Bật/tắt một dòng sẽ ghi cho mọi connection phục vụ nó, với checkbox trạng thái một phần và câu báo khi chỉ thành công một phần. Model picker trong khung chat dùng cùng luật, vì đó là chỗ chủ nhà nhìn thấy lỗi nhân đôi.

## Rủi ro và phụ thuộc

- **Phụ thuộc router plan:** kế hoạch này **không tự đặt tên đường dẫn**. Nó liệt kê 5 đường dẫn cần và các field snapshot cần; tên thật do `v29-keyring-router-plan.md` chốt. Sai lệch chỉ sửa ở một file hằng số.
- **Không phá đường cũ:** nếu snapshot không có danh sách khoá, card giữ nguyên hành vi hôm nay. Hai màn chết (`LlmApiKeysView.tsx`, `RouterView.tsx`) không bị đụng tới.
- **Bí mật không bao giờ hiện:** chỉ tiền tố đã che; dòng lỗi lọc bớt chuỗi dài giống khoá; test ghim điều này.

## Cần chủ nhà chốt

1. Nhãn trạng thái bằng **tiếng Anh** cho khớp toàn màn Settings, hay tiếng Việt? (kế hoạch gom vào một khối nên đổi rất nhanh)
2. "Gộp khoá" chuyển **tất cả** khoá của connection nguồn (kế hoạch chọn vậy), hay từng khoá một?
3. Bỏ khoá **cuối cùng** thì connection vẫn còn (rỗng khoá) hay router tự xoá luôn?
