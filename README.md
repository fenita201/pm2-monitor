# PM2 Monitor

Dashboard nhẹ dùng Express + HTML/JavaScript, hỗ trợ một user hoặc gom dữ liệu từ nhiều dashboard single-user qua HTTP. Không cần database, Redis, helper/sudo hay tài khoản Linux trong trình duyệt. Node.js >= 20.19; dùng Node/NVM đã có của từng user.

## Hai mode

- `single-user` (mặc định): quản lý PM2 của Linux user chạy dashboard. Lấy danh tính từ hệ điều hành, dùng `PM2_HOME` nếu được khai báo, nếu không dùng home thực của user + `/.pm2`. Không đọc file targets và không gọi sudo.
- `multi-user`: tự bao gồm PM2 của user hiện tại, đồng thời kết nối N dashboard single-user đã cấu hình. Không tự quét user hay cổng trên máy. Target phải trả đúng danh tính Linux user qua `/api/info`; không chấp nhận dashboard multi-user làm target để tránh gom dữ liệu vòng lặp.

`PM2_MONITOR_MODE` thiếu, rỗng hoặc chỉ có khoảng trắng => `single-user`. Giá trị khác hai mode trên gây lỗi startup. Dashboard không chạy bằng root. Mode/.env được đọc khi startup; đổi mode cần restart. Thêm/sửa/xóa target qua UI áp dụng ngay.

Đây là kiến trúc **B (HTTP)** đã được chọn, thay cho schema launcher/helper/sudo trong `prompt.md`. Mỗi target tiếp tục chạy dashboard riêng. Cả dashboard tổng và target cần dùng phiên bản code mới này; bản gốc không có handshake/API đầy đủ.

## Cài đặt và nâng cấp

Trong shell của đúng Linux user, với NVM/Node đã được nạp:

```bash
node --version
command -v node
command -v pm2
npm ci --omit=dev
```

Khi cài mới:

```bash
cp .env.example .env
openssl rand -hex 32
```

Sửa `.env`, đặt `ADMIN_PASSWORD` và `SESSION_SECRET` riêng cho instance. Không chép đè `.env` khi nâng cấp. Bản single-user gốc không cần thêm mode hoặc file targets khi nâng cấp. `PORT` giữ mặc định `8877`; `HOST` không khai báo giữ phạm vi bind của bản gốc, khai báo `HOST=127.0.0.1` nếu chỉ cần truy cập nội bộ/reverse proxy.

```dotenv
PORT=8877
PM2_MONITOR_MODE=single-user
ADMIN_PASSWORD=<your-dashboard-password>
SESSION_SECRET=<random-secret>
```

Start dashboard mới, hoặc restart instance đã tồn tại:

```bash
pm2 start server.js --name pm2-dashboard
# Khi đã có instance (kể cả stopped):
pm2 restart pm2-dashboard --update-env
```

Các lệnh PM2 này phải chạy dưới đúng user và đúng `PM2_HOME`, trong thư mục checkout của user đó. Nếu chưa có PM2 daemon thì việc start dashboard qua PM2 là thao tác khởi tạo rõ ràng của quản trị viên; việc mở web hoặc chạy kiểm tra cấu hình không tự tạo daemon. `pm2 save` là bước tùy chọn do quản trị viên chủ động thực hiện để lưu danh sách app.

Nếu dùng ecosystem, đặt `cwd` đúng thư mục repo và `interpreter` là Node executable phù hợp nếu cần. Cập nhật `env` trong ecosystem rồi dùng `pm2 startOrReload ecosystem.config.js --update-env` (thêm `--env production` nếu dùng `env_production`). Biến môi trường PM2 kế thừa có ưu tiên cao hơn `.env`; tránh khai báo cùng biến ở hai nơi. Sửa `.env` vẫn cần restart Node process. Không cần các user dùng cùng phiên bản Node/NVM/PM2.

## Ví dụ máy hiện tại: ploi => lamson

Bên `lamson`, checkout code mới vào dashboard riêng `/home/lamson/pm2-monitor`, giữ password/secret hiện có và cổng `8888`:

```dotenv
PORT=8888
PM2_MONITOR_MODE=single-user
ADMIN_PASSWORD=<lamson-dashboard-password>
SESSION_SECRET=<lamson-instance-secret>
```

Cài dependency và restart **trong shell của lamson**:

```bash
cd /home/lamson/pm2-monitor
npm ci --omit=dev
pm2 restart pm2-dashboard --update-env
curl --fail http://127.0.0.1:8888/api/info
```

`/api/info` phải trả `protocolVersion: 1`, `mode: "single-user"`, `user: "lamson"` và UID thực. Dashboard lamson vẫn chỉ điều khiển PM2 của lamson, dùng web login riêng như trước. `SESSION_SECRET` không cần giống bên ploi.

Bên `ploi`, trong `/home/ploi/Desktop/pm2-monitor`:

```dotenv
PORT=8877
PM2_MONITOR_MODE=multi-user
PM2_MONITOR_TARGETS_FILE=./config/pm2-targets.json
ADMIN_PASSWORD=<ploi-dashboard-password>
SESSION_SECRET=<ploi-instance-secret>
```

Cài dependencies và start/restart dashboard như hướng dẫn trên. Mở dashboard, login admin, chọn **Manage targets** và nhập:

| Trường | Giá trị ví dụ |
| --- | --- |
| Linux username | `lamson` |
| Host / URL | `http://127.0.0.1` (điền sẵn) |
| Port | `8888` (điền sẵn) |
| Dashboard admin password | Password web của dashboard lamson |

Bấm **Check & add**. Backend kiểm tra phiên bản, mode, danh tính user và password (nếu có), rồi lưu file và áp dụng ngay. Nếu kiểm tra thất bại, cấu hình cũ được giữ nguyên. Daemon target có thể đang unavailable; target đã lưu sẽ báo lỗi riêng trên UI.

File targets chưa tồn tại được xem như danh sách rỗng để có thể thêm target đầu tiên qua UI. File tồn tại nhưng sai JSON/schema hoặc trùng username/URL gây lỗi startup. Đây là thay đổi có chủ đích so với prompt A ban đầu.

## Quản lý target qua UI

Chỉ admin được thêm, sửa hoặc xóa target. Username được xác minh với **user thực chạy dashboard target**, không suy ra từ tên app PM2. Host/URL chỉ nhận HTTP(S) origin, không nhận shell command, path, query hoặc user/password trong URL. Với cùng máy, `127.0.0.1` được backend dashboard tổng truy cập, không phải máy browser của người xem. Nếu dùng máy khác, dùng URL HTTPS hoặc mạng riêng tin cậy.

- Password để trống khi thêm: chỉ xem status/log; thao tác điều khiển bị từ chối.
- Password để trống khi sửa: giữ credential hiện có. Muốn chuyển sang chỉ đọc, gỡ target rồi thêm lại không có password.
- Xóa target: gỡ kết nối và cấu hình; PM2/app/dashboard bên target vẫn tiếp tục chạy.
- Thêm/sửa/xóa áp dụng ngay, không cần restart. Sửa file targets bằng tay hoặc thay biến credential trong `.env` cần restart để nạp lại.
- Target lỗi không làm mất các target khác. UI phân biệt không có process với mất kết nối/daemon chưa chạy.

UI lưu password trực tiếp trong file JSON riêng trên server, theo lựa chọn giữ cấu hình nhẹ; đây không phải mã hóa. File được ghi atomically bằng file tạm và rename, quyền `0600`, API không trả password về browser. Có giới hạn kích thước file 1 MiB, không giới hạn cố định số user; polling chạy tối đa bốn target đồng thời. Chỉ một dashboard process nên quản lý mỗi file targets; không chạy cluster/nhiều writer cho cùng file.

## Cấu hình JSON thủ công

Đường dẫn tương đối của `PM2_MONITOR_TARGETS_FILE` luôn resolve từ project root (thư mục `server.js`), không phụ thuộc shell cwd. Xem `config/pm2-targets.example.json`.

Có thể đặt password trong `.env` thay vì JSON:

```dotenv
APPUSER_DASHBOARD_PASSWORD=<appuser-web-password>
WORKER_DASHBOARD_PASSWORD=<worker-web-password>
```

```json
{
  "targets": [
    {
      "user": "appuser",
      "baseUrl": "http://127.0.0.1:8888",
      "adminPasswordEnv": "APPUSER_DASHBOARD_PASSWORD"
    },
    {
      "user": "worker",
      "baseUrl": "http://127.0.0.1:8889",
      "adminPasswordEnv": "WORKER_DASHBOARD_PASSWORD"
    },
    {
      "user": "service-a",
      "baseUrl": "http://127.0.0.1:8890"
    }
  ]
}
```

Ví dụ dashboard tổng chạy bằng `deploy`: tự có PM2 của deploy, cộng appuser/worker/service-a. service-a trong ví dụ chỉ đọc. Các target không cần có quyền sudo hoặc quyền đọc home/socket của nhau. Mỗi user chỉ cần duy trì dashboard single-user của mình trên cổng riêng.

`password` và `adminPasswordEnv` không được dùng cùng lúc trong một entry. Biến password chưa được khai báo có nghĩa là chưa có credential điều khiển; UI hiển thị **Read only**. Có thể bổ sung password qua UI. Username và URL không được trùng target khác; không cấu hình user hiện tại hoặc root thành remote target.

`.env` và `config/pm2-targets.json` đã được ignore. Nếu dùng tên/đường dẫn khác trong repo, thêm nó vào `.gitignore` trước khi lưu secret. File example không chứa secret thật.

## Login, session và quyền điều khiển

Status/server stats/process/log được xem công khai. Người mở dashboard tổng thấy mọi target mà instance đó cấu hình. Login admin cấp quyền thao tác process và cấu hình target trên instance đó; không thêm username, tài khoản hay RBAC.

Backend dashboard tổng giữ một session riêng với từng target. Khi session target hết hạn hoặc target restart, backend tự login lại khi thao tác bị trả `401`. Không tự retry start/stop/restart nếu timeout, vì thao tác có thể đã được thực hiện; hãy kiểm tra status trước khi thử lại. Mật khẩu web không được dùng cho sudo/Linux login.

`SESSION_SECRET` ký cookie phiên đăng nhập để ngăn giả mạo cookie. Nó không phải password login và không mã hóa file targets. Mỗi instance nên có secret ngẫu nhiên riêng, cố định trong `.env`. Cookie có tên riêng theo UID/cổng để hai dashboard cùng hostname không ghi đè phiên của nhau. Session dùng bộ nhớ như bản gốc, sống tối đa một giờ; restart dashboard làm mất các phiên và phải login lại. Nếu không cấu hình secret, app tạo secret ngẫu nhiên cho lần chạy đó. Password fallback `admin123` được giữ cho tương thích bản gốc; hãy đặt password riêng trong `.env` trước khi sử dụng thực tế.

Process được định danh bằng `(targetUser, pm_id)` trong API, UI, log và lịch sử biểu đồ. Hai user có ID `0` không bị trộn. Start bật lại process stopped/errored đã tồn tại; online hiện Stop + Restart. Stop/delete/rename dashboard bị chặn ở backend bằng PID thực hoặc đường dẫn script của instance, không theo tên hiển thị. Restart dashboard vẫn được phép và có thể làm kết nối tạm gián đoạn.

Log chỉ đọc từ đường dẫn mà đúng PM2 daemon trả về, tối đa 64 KiB và 100 dòng cho mỗi stdout/stderr. Tên user/process và log được render bằng text, không đưa vào HTML/inline JavaScript. API kiểm tra allowlist target, ID nguyên không âm và action; không nhận arbitrary command hoặc đường dẫn log từ browser.

Kết nối local dùng các RPC method của dependency PM2 đã khóa trong `package-lock.json`, chỉ kết nối socket daemon hiện hữu. Không gọi `pm2.connect()`/CLI khi polling. Request có timeout và giới hạn số đang chạy; cache/coalesce ngắn dùng chung cho các browser, target lỗi retry với backoff tối đa 30 giây. Khi nâng dependency PM2 cần chạy lại smoke test vì transport phụ thuộc protocol PM2.

## Kiểm tra cấu hình và troubleshooting

```bash
npm run check-config
curl --fail http://127.0.0.1:8888/api/info
curl --fail http://127.0.0.1:8888/api/status
```

`check-config` kiểm tra read-only danh tính/kết nối và danh sách process, không thử password hoặc thay đổi process. Chạy dưới đúng user của dashboard tổng. Exit code khác 0 nếu cấu hình hoặc bất kỳ target nào lỗi. Thêm/sửa qua UI kiểm tra password riêng.

| Lỗi | Cách kiểm tra |
| --- | --- |
| Target must run the updated PM2 Monitor | Cập nhật code cả target; `/api/info` phải có protocolVersion 1. |
| Target dashboard must use single-user mode | Sửa mode target và restart đúng instance. |
| Linux user identity does not match | Dùng username thực từ `/api/info`, kiểm tra đang trỏ đúng cổng. |
| Cannot reach target dashboard | Kiểm tra listener, URL/port và dashboard target đang chạy. |
| Password was rejected | Nhập ADMIN_PASSWORD của dashboard target, không phải password Linux. |
| PM2 daemon unavailable / socket inaccessible | Trong shell target, kiểm tra PM2_HOME và daemon của user đó; không chia sẻ socket giữa user. |
| Start requires a stopped process / state changed | Refresh và xem trạng thái hiện tại trước khi thử lại. |
| Cannot save config | Kiểm tra quyền ghi thư mục chứa file targets của user chạy dashboard tổng. |
| Sau cập nhật `.env` vẫn dùng giá trị cũ | Kiểm tra env trong PM2/ecosystem có ghi đè không; restart với env phù hợp. |

Trong shell của từng target, có thể kiểm tra mà không khởi tạo daemon:

```bash
id
getent passwd "$(id -un)"
command -v node
node --version
command -v pm2
nvm current
printf '%s\n' "${PM2_HOME:-$HOME/.pm2}"
```

Chỉ chạy `pm2 list` khi đã xác nhận daemon tồn tại; CLI PM2 có thể khởi tạo daemon nếu chưa có. Không cần đưa các đường dẫn Node/NVM/PM2_HOME này vào cấu hình HTTP của dashboard tổng.

Để gỡ kết nối: xóa target qua UI. Nếu muốn gỡ dashboard target, quản trị viên thực hiện riêng dưới đúng user; dashboard tổng không tự dừng hoặc gỡ nó.

## Kiểm thử

```bash
npm ci
npm test
npm run test:smoke
```

Unit/integration tests dùng fake PM2/socket và các Express dashboard thử nghiệm trên port ngẫu nhiên; không cần real target user, sudo, NVM hoặc daemon production. Smoke test là opt-in, tạo app/daemon riêng trong `PM2_HOME` tạm ở `/tmp`, chạy list/log/start/stop/restart/rename/delete rồi dọn daemon/file tạm. Không dùng PM2_HOME của app thật.

Browser test tùy chọn; dependencies chỉ phục vụ phát triển, không cần cho runtime:

```bash
npm install --no-save --package-lock=false playwright chart.js
npx playwright install chromium
npm run test:browser
```

Chromium kiểm tra cả hai mode, public/admin, CRUD target, credential che trên UI, Start/Stop/Restart, log/chart khi ID trùng, tên process chứa HTML và bố cục mobile. Chart.js được phục vụ từ package test để không phụ thuộc CDN trong test. Ảnh test lưu ở `test-artifacts/` (ignored). Test này dùng danh tính target giả; việc deploy và xác minh trên user thật là bước riêng.

## License

MIT. Original project: [keizaken/pm2-monitor](https://github.com/keizaken/pm2-monitor).
