Prompt cho Codex CLI: thêm quản lý PM2 theo Linux user
Bạn đang làm việc trong fork local của https://github.com/keizaken/pm2-monitor.
Hãy đọc repo hiện tại, triển khai các yêu cầu dưới đây, kiểm tra và cập nhật tài liệu.
Đây là yêu cầu thực hiện code, không chỉ đề xuất kế hoạch.
1. Mục tiêu và phạm vi
Giữ app lightweight: Express + HTML/JavaScript như hiện tại, không đổi framework, không thêm database, Redis, Docker bắt buộc, dịch vụ cloud hoặc hệ thống tài khoản phức tạp.
Một codebase phải hỗ trợ hai chế độ:
- single-user (mặc định): dashboard quản lý PM2 của Linux user đang chạy dashboard.
- multi-user (bật rõ ràng qua cấu hình): dashboard quản lý PM2 của user hiện tại và các user được cấu hình cho phép.
Trường hợp cụ thể:
- Dashboard chạy bằng lamson với cấu hình mặc định: chỉ xem và quản lý PM2 của lamson.
- Dashboard chạy bằng ploi với multi-user được bật: xem và quản lý PM2 của ploi và lamson, có nhãn và bộ lọc theo user.
- ploi có quyền sudo; lamson không có sudo toàn máy.
- Có quyền sudo không đồng nghĩa tự động bật multi-user.
2. Trước khi sửa
Đọc AGENTS.md áp dụng nếu có; kiểm tra git status và bảo toàn thay đổi của người dùng.
Đọc server.js, public/index.html, package.json và README hiện tại; không giả định repo vẫn giống phiên bản được mô tả ở đây.
Nêu kế hoạch ngắn rồi triển khai liên tục đến khi hoàn thành. Không dừng để hỏi lại những quyết định kỹ thuật thông thường đã có thể giải quyết từ yêu cầu.
Không commit, push hoặc mở PR trừ khi tôi yêu cầu riêng.
Nếu đang trên đúng Ubuntu server đích, kiểm tra read-only Linux user, home, Node, PM2 và PM2_HOME thực tế.
Nếu không có môi trường đích, dùng cấu hình mẫu và test giả lập; không coi việc thiếu user lamson là lý do để dừng triển khai.
3. Giữ cơ chế truy cập đơn giản
Giữ đúng mô hình bản gốc:
- Mở web là xem được trạng thái server, danh sách process, CPU/RAM và log mà không cần login.
- Login admin bằng ADMIN_PASSWORD và session hiện tại để start/stop/restart hoặc thực hiện thao tác thay đổi khác đang được giữ lại.
- Không thêm username, đăng nhập Ubuntu/PAM, đăng ký tài khoản, OAuth, RBAC nhiều cấp hoặc bắt login mới được xem.
- Chế độ multi-user vẫn dùng một mật khẩu admin cho instance dashboard đó.
- Mật khẩu web không phải mật khẩu sudo; tuyệt đối không dùng mật khẩu web để chạy sudo.
Các API thay đổi process phải kiểm tra session ở backend. Giữ logout và hành vi đăng nhập hiện có.
Không tự sinh thêm giao diện setup tài khoản. .env.example phải dùng placeholder cho secret/password; không ghi secret thực vào repo hoặc log.
4. Cấu hình và môi trường
Thêm cấu hình rõ ràng cho mode, danh sách target user, PM2_HOME và thông tin runtime/helper cần thiết.
Tên biến/file do bạn chọn sao cho đơn giản, dễ hiểu; có ví dụ single-user và multi-user.
- single-user tự lấy danh tính user hiện tại từ hệ điều hành; không tin tên user do browser gửi.
- single-user chỉ cho phép user hiện tại, kể cả khi request bị sửa để chỉ sang user khác.
- multi-user có allowlist explicit, ví dụ ploi và lamson; không tự quét mọi Linux user.
- PM2_HOME mặc định dựa trên home thực của từng target; cho phép override nếu cần.
- Node/npm/PM2 cài qua NVM. Đường dẫn ví dụ của ploi:
  /home/ploi/.nvm/versions/node/v24.21.0/bin/node
  /home/ploi/.nvm/versions/node/v24.21.0/bin/pm2
- Không hardcode phiên bản này và không mặc định lamson có cùng đường dẫn.
- Không dựa vào NVM tự được load trong shell không tương tác. Hỗ trợ đường dẫn tuyệt đối được kiểm tra.
- Không yêu cầu chuyển app đang chạy từ PM2 của lamson sang ploi hoặc chia sẻ một PM2_HOME giữa hai user.
- Giữ PORT hiện có; cho phép cấu hình HOST, không tự đổi cách truy cập mạng hiện tại khi chưa cần.
Dùng biến .env sau để chọn chế độ hoạt động:

PM2_MONITOR_MODE=single-user

Chỉ hỗ trợ hai giá trị:
- single-user: chế độ mặc định, quản lý PM2 của Linux user đang
  chạy dashboard, giữ cách sử dụng như source gốc.
- multi-user: bật tính năng quản lý PM2 của nhiều Linux user
  theo danh sách target được cấu hình.

Quy tắc:
- Không khai báo biến hoặc giá trị rỗng: mặc định single-user.
- Giá trị khác single-user/multi-user: báo lỗi cấu hình rõ ràng
  khi khởi động, không tự chuyển sang multi-user.
- single-user không khởi chạy helper cho user khác, không gọi
  sudo và không yêu cầu cấu hình multi-user.
- Cấu hình target user/helper chỉ được đọc và kiểm tra khi
  PM2_MONITOR_MODE=multi-user.
- Không tự bật multi-user dựa trên tên user hoặc quyền sudo.
- Đọc mode lúc khởi động; thay đổi .env cần restart dashboard.
- Cả hai mode giữ nguyên: xem trạng thái/log không cần login,
  thao tác thay đổi process phải login admin như bản gốc.

.env.example đặt mặc định:
PM2_MONITOR_MODE=single-user

README hướng dẫn bật tính năng mới bằng:
PM2_MONITOR_MODE=multi-user

Danh sách target user, PM2_HOME và runtime/helper được cấu hình
riêng; tên các cấu hình đó do bạn chọn sao cho đơn giản.
5. Kết nối và điều khiển nhiều daemon
Ưu tiên helper/worker nhỏ giữ kết nối PM2 riêng cho từng target user, giao tiếp với backend bằng IPC hoặc JSON qua stdin/stdout.
Không cần chạy thêm HTTP server cho mỗi user.
- Kết nối PM2 của user hiện tại chạy với quyền hiện tại.
- Helper cho lamson chạy dưới danh tính lamson, được ploi khởi chạy qua sudo không tương tác, ví dụ cơ chế sudo -n -u lamson.
- Không chạy toàn bộ web backend bằng root.
- Không đổi process.env.PM2_HOME qua lại để phục vụ các user trong cùng process Node đang xử lý request song song.
- Đảm bảo cấu hình PM2_HOME được áp dụng trước khi thư viện PM2 được load trong helper.
- Không spawn PM2 CLI và sudo lại mỗi 2 giây cho mỗi browser nếu có thể giữ kết nối/helper.
- Có thể dùng thiết kế khác nếu đơn giản hơn nhưng phải đáp ứng đầy đủ việc tách danh tính, tách daemon và xử lý request đồng thời; giải thích ngắn lựa chọn.
Quyền sudo:
- Cung cấp helper/launcher và cấu hình sudoers mẫu giới hạn ở việc chạy helper dưới user đích.
- Không dùng NOPASSWD: ALL, không cho browser gửi shell command, đường dẫn executable hay target tùy ý.
- Ưu tiên launcher cố định không nhận argv tùy ý; helper nhận thao tác qua giao thức có validation.
- Các file thực thi được sudoers tin cậy phải có hướng dẫn cài đặt và ownership phù hợp.
- Khi chưa cấp quyền hoặc sudo cần mật khẩu, báo lỗi rõ trên UI; không treo để chờ nhập mật khẩu.
Vòng đời:
- Có timeout, kiểm tra exit/error, xử lý helper mất kết nối, shutdown sạch và retry có giới hạn/backoff.
- stdout dùng cho protocol phải không bị lẫn log debug; dùng stderr cho log.
- Nếu target PM2 daemon chưa chạy, hiển thị trạng thái unavailable/not running. Việc đọc dashboard không được tự khởi tạo daemon PM2 mới.
- Một target lỗi không được làm mất dữ liệu của target còn lại.
- Dùng cache ngắn/coalesce polling khi cần, tránh mỗi browser tạo helper riêng.
6. API và giao diện
Định danh process bằng cặp (targetUser, pm_id), không chỉ pm_id.
Ví dụ ploi:0 và lamson:0 là hai process độc lập.
Áp dụng danh tính này xuyên suốt:
- API lấy danh sách, đọc log và thao tác.
- Khóa cache/lịch sử biểu đồ.
- Process đang được mở trong modal.
- Nhãn thông báo lỗi và xác nhận thao tác.
Giao diện:
- Giữ bố cục và tính năng cơ bản hiện có.
- multi-user: thêm filter All users / ploi / lamson theo các target được cấu hình.
- Mỗi process có nhãn Linux user rõ ràng.
- single-user: giao diện gọn, có thể ẩn dropdown nếu chỉ có một user.
- Thống kê CPU/RAM/disk toàn server chỉ hiển thị một lần; không cộng lặp theo user.
- Thao tác phải gửi đúng target user và process ID.
- Start cần bật lại process đã có trong PM2 nhưng đang stopped; không thêm tính năng tạo app từ command tùy ý.
- Có loading/error hợp lý; không báo thành công khi PM2 thực tế trả lỗi.
- Giữ log viewer; chỉ đọc log của process được PM2 target đó trả về, không nhận đường dẫn file tùy ý từ browser.
- Đọc log có giới hạn dữ liệu; tránh đọc đồng bộ toàn bộ file log lớn chỉ để lấy vài dòng cuối.
Nếu giữ delete/rename như bản gốc, chúng cũng cần login và target validation. Không thêm quản lý env, deploy app, terminal hay tính năng ngoài phạm vi.
7. Những sửa nhỏ cần thiết trong phần liên quan
- Backend validate allowlist user, process ID nguyên không âm và action được phép.
- Không cho ID "all", tên process hoặc wildcard lọt vào endpoint chỉ thao tác một process.
- Dùng spawn/execFile với argv, không ghép shell command từ request.
- Bảo vệ process dashboard khỏi stop/delete ở backend, dựa trên danh tính thực thay vì chỉ tên hiển thị; vẫn cho phép thao tác cần thiết khác nếu hợp lý.
- Render tên process/user như text an toàn, tránh chèn dữ liệu chưa escape vào innerHTML hoặc inline JavaScript.
- Kiểm tra callback lỗi PM2, input và response đầy đủ.
- Sửa các lỗi nhỏ của luồng hiện có nếu trực tiếp cản trở tính năng, nhưng không mở rộng thành đợt refactor toàn repo.
Các điểm trên không thay đổi yêu cầu trạng thái/log được xem công khai và login admin đơn giản.
8. Kiểm tra
Viết và chạy test tập trung cho:
1. single-user hoạt động với user hiện tại, không cần sudo.
2. single-user từ chối request nhắm sang user khác.
3. multi-user gộp được ploi và lamson, kể cả hai bên đều có pm_id=0.
4. stop/restart/start được định tuyến đúng target; không tác động process bên còn lại.
5. Request thay đổi chưa login bị từ chối; status/log vẫn public.
6. User ngoài allowlist, ID không hợp lệ và action không hỗ trợ bị từ chối.
7. PM2/helper/sudo lỗi hoặc timeout không báo success, không làm hỏng toàn dashboard.
8. Polling không tự tạo daemon chưa tồn tại; không tạo helper mới cho từng browser/request.
9. Quy tắc bảo vệ dashboard được thực thi ở backend.
Ưu tiên test với mock/fake adapter/helper có hành vi thực tế, không cần sudo hoặc daemon thật trong CI.
Smoke test với PM2 thật chỉ dùng app thử nghiệm riêng và PM2_HOME riêng do test tạo; không stop/restart/delete app đang chạy của tôi.
Kiểm tra UI ở single-user và multi-user; nếu không có browser thì nêu đúng giới hạn kiểm tra.
Không khai đã test trên server thật nếu thực tế chỉ dùng mock.
10. Không khai báo PM2_MONITOR_MODE hoặc để rỗng: chạy single-user.
11. single-user vẫn hoạt động khi không có cấu hình/helper/sudo
    dành cho multi-user.
12. multi-user kích hoạt đúng luồng quản lý nhiều user.
13. Mode không hợp lệ làm startup báo lỗi rõ ràng.

9. Tài liệu và triển khai
Cập nhật README, .env.example và file cấu hình mẫu:
- Cách chạy single-user bằng lamson.
- Cách chạy multi-user bằng ploi.
- Cách xác định đường dẫn Node/PM2 và PM2_HOME từng user.
- Cách cài helper/launcher, sudoers tối thiểu và kiểm tra bằng visudo.
- Cách giữ dashboard chạy với PM2; port khác nhau nếu chạy cả hai instance.
- Troubleshooting khi NVM PATH thiếu, target không chạy hoặc sudo chưa được cấp.
- Lệnh kiểm tra read-only và cách gỡ cấu hình/helper đã thêm.
Có thể tạo script cài đặt có bước kiểm tra và chế độ dry-run nếu giúp triển khai.
Trong lượt thực hiện này, hoàn thành code, test và tài liệu trong repo; không tự sửa sudoers hệ thống, ownership thư mục home, service production hoặc restart app hiện tại.
10. Kết quả cần bàn giao
Hoàn thành implementation, không dừng ở TODO cho phần quản lý nhiều user.
Báo cáo ngắn bằng tiếng Việt:
- Đã thay đổi gì và kiến trúc được chọn.
- File chính liên quan.
- Test đã chạy và kết quả thực tế.
- Cấu hình/lệnh tôi cần chạy để áp dụng trên Ubuntu.
- Giới hạn hoặc bước cấu hình môi trường còn lại, nếu có.
Tiêu chí hoàn thành:
- lamson chạy default như bản gốc, xem public và login để điều khiển.
- ploi bật multi-user thấy cả ploi/lamson, lọc theo user, thao tác đúng daemon.
- Không cần hệ thống đăng nhập mới hay framework nặng.
- Quyền cần cấp được mô tả cụ thể, không chỉ ghi chung chung "cần sudo".