# 🚀 AutoSkip - AI AdBlocker Bất Tử

AutoSkip là một tiện ích mở rộng (Chrome Extension) chặn quảng cáo thế hệ mới. Tiện ích kết hợp giữa **Cơ chế Tua nhanh bạo lực (Ad Speeding)** trên YouTube và **Trí tuệ nhân tạo (Gemini AI)** trên các website ngoài để tiêu diệt các loại quảng cáo tinh vi nhất mà không lo bị YouTube khoá tài khoản.

---

## 🌟 Tính năng nổi bật

1. **Trên YouTube (Chế độ Bạo lực):**
   - Vượt mặt hệ thống chặn click của YouTube.
   - Cướp quyền điều khiển, ép tua nhanh mọi quảng cáo (cả skippable và unskippable) để nó tự động kết thúc trong 0.1 giây. 
   - 100% an toàn cho tài khoản Google (không chặn luồng kết nối máy chủ như AdBlock).

2. **Trên Website Khác (Phim ảnh, Báo chí, v.v.):**
   - **Text Scanner:** Nhận diện và tự động đóng các nút có chữ "bỏ qua", "đóng qc", "tắt qc" ngay cả khi bị ẩn sâu trong video.
   - **Cross-origin Blocker:** Chặn vĩnh viễn thẻ ảnh, iframe, video của các tên miền lạ nếu chứa từ khoá cờ bạc (bet, casino...), 18+ (sex, porn...).
   - **Gemini AI Scanner:** Quét và đưa các popup khổng lồ "kỳ lạ" lên AI để phán xét và tiêu diệt một cách thông minh, không "giết nhầm" nội dung thật.

---

## 🛠️ Hướng dẫn cài đặt (Dành cho người mới)

### Bước 1: Tải mã nguồn về máy tính
**Dành cho Mac/Linux:**
1. Nhấn tổ hợp phím `Command + Space`, gõ `Terminal` và nhấn Enter để mở Terminal.
2. Copy và dán lệnh sau vào Terminal, rồi nhấn Enter:
   ```bash
   git clone https://github.com/binhle217-creator/autoskipads.git
   ```
3. Code sẽ được tải về thành một thư mục trên máy của bạn.

**Dành cho Windows:**
1. Mở `Command Prompt` (hoặc PowerShell).
2. Copy và dán lệnh tương tự như trên.

### Bước 2: Kích hoạt Tiện ích trên Chrome / Edge / Brave
1. Mở trình duyệt, nhập vào thanh địa chỉ: `chrome://extensions/` và nhấn Enter.
2. Nhìn lên góc trên cùng bên phải, bật công tắc **"Chế độ dành cho nhà phát triển" (Developer mode)**.
3. Bấm vào nút **"Tải tiện ích đã giải nén" (Load unpacked)** ở góc trên bên trái.
4. Chọn đúng thư mục mã nguồn bạn vừa tải về ở Bước 1. Tiện ích AutoSkip sẽ xuất hiện!

---

## ⚙️ Hướng dẫn thiết lập API Key (Để AI hoạt động)

Tiện ích cần kết nối với Google Gemini AI để "mọc mắt" nhìn quảng cáo rác trên các trang web.
1. Truy cập: [Google AI Studio](https://aistudio.google.com/apikey) (Hoàn toàn miễn phí).
2. Đăng nhập bằng tài khoản Google, bấm nút **"Create API Key"**.
3. Copy đoạn mã Key đó (bắt đầu bằng `AIza...`).
4. Bấm tổ hợp phím tắt **`Alt + Shift + S`** (hoặc bấm vào icon AutoSkip trên thanh công cụ) để mở bảng điều khiển của AutoSkip.
5. Dán Key vào ô Gemini AI và bấm nút **Lưu (💾)**. Khi chữ chuyển sang màu xanh "Đã kết nối" là thành công!

---

## 📊 Cách Tracking (Theo dõi) và Bật/Tắt
- **Bật/Tắt Toàn Hệ Thống:** Mở bảng điều khiển (`Alt + Shift + S`) và gạt công tắc trên cùng.
- **Tính năng Chặn Tab Rác:** Gạt công tắc "Chặn tab QC". Khi các website phim lậu cố tình mở 1 tab rác ngầm, AutoSkip sẽ lập tức gửi tab đó cho AI, nếu là quảng cáo nó sẽ hiện một popup nhỏ hỏi bạn có muốn đóng tab rác đó không (mà không làm gián đoạn phim bạn đang xem).
- **Phím tắt Bật/Tắt Anti-Pause Shield (YouTube):** Vì tính năng khiên bảo vệ (Shield) sẽ vô hiệu hoá mọi lệnh pause (kể cả thao tác của người dùng), nếu bạn muốn pause thủ công video YouTube, chỉ cần **nhấn đúp phím `Space` (Dấu cách)** trên bàn phím. Một thông báo nhỏ màu đỏ sẽ hiện ra xác nhận Shield đã tắt. Nhấn đúp thêm lần nữa để bật lại.
- **Theo dõi hiệu quả:** Bảng điều khiển sẽ hiện số đếm "Quảng cáo đã diệt". Bạn có thể bấm nút Xoá để đếm lại từ đầu.
- **Log nâng cao:** Nhấn `F12` mở Console trên website đang xem, bạn sẽ thấy AutoSkip liên tục báo cáo các hành động "Phát hiện nút skip", "Tua nhanh", "Gửi AI", v.v.
