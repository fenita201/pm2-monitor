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

Repo có sẵn `ecosystem.config.js`, dùng được ở mọi checkout/user, cả hai mode:

```bash
# Trong thư mục repo, với Node/NVM mong muốn đang active:
pm2 start ecosystem.config.js
# Khi dashboard đã chạy, áp dụng code/cấu hình ecosystem mới:
pm2 startOrReload ecosystem.config.js --update-env
```

File này dùng `cwd: __dirname`, script `server.js` và Node executable của tiến trình PM2 CLI (`process.execPath`), không hardcode username hoặc đường dẫn NVM. Chọn phiên bản bằng `nvm use` trước khi chạy lệnh. Giữ mode/port/password/secret trong `.env`; ecosystem chỉ đặt `NODE_ENV=production`. Một instance fork, không watch; tắt instrumentation PM2.io và Git metadata không dùng trong UI. CPU/RAM process do PM2 đo vẫn hoạt động. `kill_timeout=6000` cho app thời gian shutdown sạch.

Biến môi trường PM2 kế thừa có ưu tiên cao hơn `.env`; tránh khai báo cùng biến ở hai nơi. Sửa `.env` vẫn cần restart Node process. Không cần các user dùng cùng phiên bản Node/NVM/PM2.

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

`SESSION_SECRET` ký cookie phiên đăng nhập để ngăn giả mạo cookie. Nó không phải password login và không mã hóa file targets. Mỗi instance nên có secret ngẫu nhiên riêng, cố định trong `.env`. Cookie có tên riêng theo UID/cổng để hai dashboard cùng hostname không ghi đè phiên của nhau. Session dùng bộ nhớ như bản gốc, hết hạn sau một giờ không hoạt động; mỗi phút dọn session hết hạn kể cả browser không quay lại. Restart dashboard làm mất các phiên và phải login lại. Nếu không cấu hình secret, app tạo secret ngẫu nhiên cho lần chạy đó. Password fallback `admin123` được giữ cho tương thích bản gốc; hãy đặt password riêng trong `.env` trước khi sử dụng thực tế.

Process được định danh bằng `(targetUser, pm_id)` trong API, UI, log và lịch sử biểu đồ. Hai user có ID `0` không bị trộn. Start bật lại process stopped/errored đã tồn tại; online hiện Stop + Restart. Stop/delete/rename dashboard bị chặn ở backend bằng PID thực hoặc đường dẫn script của instance, không theo tên hiển thị. Restart dashboard vẫn được phép và có thể làm kết nối tạm gián đoạn.

Log chỉ đọc từ đường dẫn mà đúng PM2 daemon trả về, tối đa 64 KiB và 100 dòng cho mỗi stdout/stderr. Tên user/process và log được render bằng text, không đưa vào HTML/inline JavaScript. API kiểm tra allowlist target, ID nguyên không âm và action; không nhận arbitrary command hoặc đường dẫn log từ browser.

Kết nối local dùng các RPC method của dependency PM2 đã khóa trong `package-lock.json`, chỉ kết nối socket daemon hiện hữu. Không gọi `pm2.connect()`/CLI khi polling. Request có timeout và giới hạn số đang chạy; cache/coalesce ngắn dùng chung cho các browser, target lỗi retry với backoff tối đa 30 giây. Khi nâng dependency PM2 cần chạy lại smoke test vì transport phụ thuộc protocol PM2.

## Link PM2 Monitor trong Cockpit

Plugin redirect là năm file tĩnh trong `cockpit/pm2monitor/`, thêm mục **PM2 Monitor** dưới Tools. Trang này liệt kê dashboard của user hiện tại trước, sau đó là các dashboard trong cấu hình targets nếu có. Bấm **Open PM2 Monitor** trên từng dashboard để mở tab mới; login Cockpit và admin dashboard vẫn riêng. Plugin không gọi PM2, không thêm Node process, không tự start/restart dashboard.

Cài riêng cho user đang chạy lệnh, không dùng sudo:

```bash
# Shell của ploi, trong checkout ploi:
cd /home/ploi/Desktop/pm2-monitor
npm run cockpit:install
cockpit-bridge --packages
```

Sau đó refresh hoặc logout/login Cockpit bằng ploi. Plugin được cài tại `~/.local/share/cockpit/pm2monitor/` (tôn trọng `XDG_DATA_HOME` nếu có). User khác không thấy plugin này, trừ khi tự cài hoặc máy đã có bản global cùng tên.

Muốn lamson thấy link của riêng mình, chạy dưới shell lamson, với checkout có các file plugin/script mới:

```bash
cd /home/lamson/pm2-monitor
npm run cockpit:install
```

Installer đọc `.env` từ project root, không phụ thuộc cwd. Port dashboard của user chạy installer lấy từ `--port` nếu có, nếu không từ biến `PORT` kế thừa hoặc `PORT` trong `.env`, cuối cùng mặc định `8877`. Ví dụ `.env` của lamson có `PORT=8888` thì chỉ cần chạy `npm run cockpit:install`, không cần nhập lại port.

Các link khác lấy từ `PM2_MONITOR_TARGETS_FILE` trong môi trường/`.env`, hoặc `config/pm2-targets.json` mặc định. File không có => chỉ tạo link dashboard của user hiện tại; có file => thêm các entry theo thứ tự `targets`. File sai schema/JSON => báo lỗi trước khi ghi plugin. Installer đọc file này nếu tồn tại kể cả dashboard chạy single-user; quy tắc single-user không đọc targets của backend vẫn giữ nguyên.

Link mặc định dùng hostname bạn đang mở Cockpit và port đã chọn. Ví dụ vào Cockpit qua `https://server-ip:9090` thì ploi mở dashboard `http://server-ip:8877`. Các target `http://127.0.0.1:8888`, `http://localhost:8888` hoặc IPv6 loopback cũng được đổi sang hostname Cockpit, giữ nguyên scheme và port. URL của target ở host khác được giữ nguyên. `127.0.0.1` trong URL browser trỏ máy browser, không phải server ở xa. Nếu đi qua domain/reverse proxy/tunnel và port không truy cập trực tiếp được, cấu hình URL dashboard hiện tại bằng `--url`, và cấu hình `baseUrl` của target bằng địa chỉ truy cập được từ browser:

```bash
npm run cockpit:install -- --url https://dashboard.example.com/
# Xem trước, không ghi file:
npm run cockpit:install -- --dry-run
```

Cài lại bằng lệnh trên sẽ cập nhật năm file plugin và danh sách link. Cấu hình được chụp tại thời điểm cài: đổi `.env` hoặc thêm/sửa/xóa target trên dashboard thì chạy lại installer để cập nhật link Cockpit. `--port`/`--url` chỉ ghi đè dashboard của user hiện tại, không đổi các link target.

Chỉ username và dữ liệu URL/port được đưa vào `config.js` của plugin; không chép `.env`, password, tên biến credential hay file targets vào thư mục Cockpit. Dashboard cần đang chạy và URL phải truy cập được từ browser. Mỗi user thấy link của mình và những target đã khai báo trong checkout của mình; việc có link không cấp quyền thao tác. Ẩn link theo user không chặn truy cập URL trực tiếp: status/log của dashboard vẫn public theo mô hình đã chọn.

## Biểu đồ và bộ nhớ

CPU Usage trên đầu trang lấy phần trăm thời gian CPU bận giữa hai lần lấy mẫu, cộng các core bằng `os.cpus().times`. Load average một phút vẫn có trong API/tooltip nhưng không dùng để giả lập CPU usage bằng phép nhân như source gốc. Cache stats dùng chung nên các browser không tạo bộ lấy mẫu/timer riêng. RAM giữ công thức `total - free` của bản gốc, hiển thị thêm `used / total GB`; số này gồm cả bộ nhớ hệ điều hành đang dùng cho cache, không phải `total - MemAvailable` của lệnh `free`.

Hai biểu đồ CPU/RAM có animation 500 ms và đường cong như source gốc. Polling giữ chu kỳ khoảng hai giây và không chồng request. Khi tab ẩn, status/log polling được tạm dừng; khi quay lại, status được lấy ngay. Chart animation chạy ở browser, không tăng bộ nhớ của process dashboard trên server.

Cache log/status hết hạn được dọn mỗi năm giây bằng một timer cho cả instance, không giữ lại payload cũ vô thời hạn. Session hết hạn được dọn mỗi phút. Cả hai timer đều `unref` và được dọn khi shutdown. Không thêm dependency runtime.

Giải phóng dữ liệu giữ trong heap giúp Node tái sử dụng bộ nhớ và giảm tăng trưởng lâu dài; RSS có thể chưa giảm ngay do V8 giữ các trang đã cấp phát. Trong phép đo riêng 64 bộ log stdout/stderr, mỗi bộ 128 KiB, heap sau idle giảm từ khoảng 12.16 xuống 4.16 MiB khi dọn cache; RSS gần như không đổi ngay trong phép đo này. Đây là phép đo cache riêng có GC chủ động, không phải cam kết mọi dashboard giảm 8 MiB RSS.

Ecosystem tắt PM2.io instrumentation (`automation: false`, `pmx: false`) để tránh nạp module không cần cho UI. Không đặt heap cap hoặc `max_memory_restart` mặc định: heap cap có thể gây OOM với nhiều target, còn ngưỡng restart chỉ khởi động lại app và làm mất session, không phải cách giảm nhu cầu bộ nhớ. Nếu cần giới hạn bộ nhớ vận hành, đo tải thực tế trước khi thêm các tùy chọn đó.

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
npm run test:ecosystem
```

Unit/integration tests dùng fake PM2/socket và các Express dashboard thử nghiệm trên port ngẫu nhiên; không cần real target user, sudo, NVM hoặc daemon production. Smoke test là opt-in, tạo app/daemon riêng trong `PM2_HOME` tạm ở `/tmp`, chạy list/log/start/stop/restart/rename/delete rồi dọn daemon/file tạm. Không dùng PM2_HOME của app thật.

`test:ecosystem` chạy hai dashboard thử trong PM2_HOME và cổng riêng, kiểm tra Node/cwd, CPU/RAM, login và bảo vệ dashboard; in RSS của hai cấu hình có/không instrumentation sau cùng số request warm-up. Kết quả phụ thuộc Node/PM2/tải và không thay thế đo dài hạn. Có thể chọn PM2 CLI khác bằng biến `PM2_TEST_CLI` chỉ dành cho test.

Browser test tùy chọn; dependencies chỉ phục vụ phát triển, không cần cho runtime:

```bash
npm install --no-save --package-lock=false playwright chart.js
npx playwright install chromium
npm run test:browser
```

Chromium kiểm tra cả hai mode, public/admin, CRUD target, credential che trên UI, Start/Stop/Restart, log/chart khi ID trùng, tên process chứa HTML và bố cục mobile. Chart.js được phục vụ từ package test để không phụ thuộc CDN trong test. Ảnh test lưu ở `test-artifacts/` (ignored). Test này dùng danh tính target giả; việc deploy và xác minh trên user thật là bước riêng.

## License

MIT. Original project: [keizaken/pm2-monitor](https://github.com/keizaken/pm2-monitor).
