# 🚀 PM2 Manager Pro

PM2 Manager Pro is a lightweight web-based dashboard for monitoring and managing **PM2 processes** directly from your browser.  

---

## 📦 Features

- **Real-Time System Monitoring**  
  Monitor CPU usage, memory consumption, and disk utilization of your VPS in real time.

- **Process Visualization**  
  View PM2 application resource trends through clean and responsive charts powered by Chart.js.

- **Role-Based Access Control**  
  - Read-only access for public users  
  - Admin-only controls for starting, stopping, and restarting processes

- **Safety Protection**  
  Built-in safeguards prevent accidental termination or deletion of the dashboard process from the web interface.

- **Integrated Log Viewer**  
  Access PM2 application logs directly from the dashboard without SSH access.

---

## 🛠️ Installation

### 1. Clone the Repository

    git clone https://github.com/keizaken/pm2-monitor.git
    cd pm2-monitor

### 2. Install Dependencies

    npm install

### 3. Environment Configuration

Create a `.env` file in the project root and configure it as follows:

    PORT=8877
    ADMIN_PASSWORD=your_admin_password
    SESSION_SECRET=your_random_session_secret

### 4. Run with PM2

Start the dashboard as a persistent background service:

    pm2 start server.js --name pm2-dashboard

---

## 🔐 Security Notes

- The `.env` file contains sensitive credentials.
- Ensure `.env` is included in `.gitignore` to prevent accidental exposure in version control.
- Always use strong passwords and a long, unpredictable session secret in production environments.

---

## 📌 Use Cases

- Managing PM2 processes on production or staging servers
- Monitoring Node.js applications in real time
- Providing system visibility without granting shell access

---

## 📄 License

This project is released under the **MIT License**.

---

## 👤 Author

Developed by **[keizaken](https://github.com/keizaken)**
