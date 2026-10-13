# PM2 Monitor

Dashboard nhẹ để xem trạng thái server, theo dõi process PM2 và điều khiển app trên web hoặc ngay trong Cockpit.

![Dashboard PM2 Monitor](docs/images/dashboard.png)

*Hình minh họa với dữ liệu mẫu.*

## App làm được gì?

- Xem CPU, RAM, disk của server và CPU/RAM của từng process.
- Xem trạng thái, biểu đồ và log của app.
- Start, stop, restart, đổi tên hoặc xóa process khỏi PM2.
- Theo dõi PM2 của một user hoặc gom nhiều dashboard, lọc theo user.
- Hiển thị trực tiếp trong Cockpit.

Status và log xem được không cần login admin. Các thao tác thay đổi cần mật khẩu admin dashboard. Trong Cockpit cũng giữ cách này: login Cockpit để vào xem, login admin dashboard để điều khiển.

## Setup và chạy

Cần Linux, Node.js **>= 20.19** và npm. Nếu dùng NVM, chọn phiên bản Node trước. Chạy bằng user quản lý PM2, không dùng sudo/root.

```bash
git clone https://github.com/fenita201/pm2-monitor.git
cd pm2-monitor
./start.sh
```

Script tự cài dependency nếu thiếu và chạy setup trước:

- Đã có `.env`: Enter để giữ nguyên; nhập `no` để tạo lại toàn bộ.
- Chưa có `.env`: tạo mới; Enter ở từng câu hỏi để dùng default.
- Mode: `1` = single-user (default), `2` = multi-user.
- Mặc định port `8877`, mật khẩu admin `admin123`, session secret tự sinh. Có thể nhập mật khẩu riêng khi setup.
- Cách chạy: Enter/`1` = foreground, `2` = chạy bằng PM2.

Mở **http://<server-ip>:8877**, hoặc port đã chọn. Với foreground, Ctrl+C để dừng.

## Các command

| Command | Dùng để |
| --- | --- |
| `./setup.sh` | Tạo hoặc kiểm tra `.env`. |
| `./start.sh` | Setup rồi chọn chạy foreground hoặc PM2. |
| `./reload.sh` | Reload dashboard đang chạy bằng PM2, nạp lại cấu hình. |
| `./stop.sh` | Enter/`1`: stop; `2`: remove dashboard khỏi PM2. |
| `./install-cockpit-plugin.sh` | Cài plugin Cockpit cho user hiện tại. |
| `npm run check-config` | Kiểm tra cấu hình và kết nối PM2/targets. |
| `npm test` | Chạy test tự động. |

Các script PM2 chỉ thao tác process `pm2-dashboard`, dùng `PM2_HOME` theo cấu hình.

## Theo dõi nhiều user

1. Mỗi user chạy một dashboard **single-user**, dùng port riêng.
2. Dashboard tổng chọn **multi-user** khi setup.
3. Login admin trên dashboard tổng, mở **Manage targets**, thêm username, URL/port và mật khẩu dashboard đích.

Không nhập mật khẩu target thì chỉ xem status/log. Các dashboard kết nối qua HTTP(S); không cần sudo để gom dữ liệu.

## Cài vào Cockpit

Chạy trong repo bằng đúng user đăng nhập Cockpit:

```bash
./install-cockpit-plugin.sh
# Xem trước hoặc chọn port khác:
./install-cockpit-plugin.sh --dry-run
./install-cockpit-plugin.sh --port 8888
```

Refresh hoặc logout/login Cockpit, mở **Tools → PM2 Monitor**. Backend dashboard cần đang chạy. Plugin mặc định kết nối tới `127.0.0.1:<PORT>` trên server; không cần browser truy cập trực tiếp port dashboard. Refresh trang plugin cần login admin dashboard lại.

## Cập nhật

```bash
git pull --ff-only
npm ci --omit=dev
./reload.sh                       # Nếu đang chạy bằng PM2
./install-cockpit-plugin.sh        # Nếu dùng Cockpit
```

Nếu chạy foreground, dừng bằng Ctrl+C rồi chạy lại `./start.sh`. Giữ `.env` hiện có khi setup; chạy lại installer Cockpit để cập nhật giao diện.
