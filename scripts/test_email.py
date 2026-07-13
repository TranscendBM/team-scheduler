#!/usr/bin/env python3
"""
test_email.py
─────────────
Quick smoke-test for Gmail SMTP credentials.
Sends a plain test message without touching Firebase.

Usage:
  python scripts/test_email.py

Required env vars (or edit the constants below):
  GMAIL_USER         – e.g. yourapp@gmail.com
  GMAIL_APP_PASSWORD – Gmail App Password
  TEST_RECIPIENT     – where to send the test mail
"""

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

# ── Config ─────────────────────────────────────────────────────────────────────
GMAIL_USER      = os.environ.get('GMAIL_USER', '')
GMAIL_PASS      = os.environ.get('GMAIL_APP_PASSWORD', '')
TEST_RECIPIENT  = os.environ.get('TEST_RECIPIENT', 'elvis_cheng@transcend-info.com')

# ── HTML body ──────────────────────────────────────────────────────────────────
NOW = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
HTML = f"""
<html><body style="font-family:sans-serif;color:#1f2937;max-width:480px;margin:auto;padding:24px">
  <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:16px 20px;border-radius:8px;margin-bottom:20px">
    <h2 style="margin:0 0 4px;font-size:18px">✅ Team Scheduler 發信測試</h2>
    <p style="margin:0;color:#6b7280;font-size:13px">如果您收到這封信，代表 Gmail SMTP 設定正確！</p>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr style="background:#f9fafb">
      <td style="padding:8px 12px;color:#6b7280;width:40%">寄件時間</td>
      <td style="padding:8px 12px;font-weight:600">{NOW} (本機時間)</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;color:#6b7280">寄件帳號</td>
      <td style="padding:8px 12px">{GMAIL_USER}</td>
    </tr>
    <tr style="background:#f9fafb">
      <td style="padding:8px 12px;color:#6b7280">收件人</td>
      <td style="padding:8px 12px">{TEST_RECIPIENT}</td>
    </tr>
  </table>
  <p style="color:#9ca3af;font-size:12px;margin-top:32px">
    此信件由 Team Scheduler 自動發信測試腳本產生。
  </p>
</body></html>
"""

# ── Send ───────────────────────────────────────────────────────────────────────
def main():
    if not GMAIL_USER or not GMAIL_PASS:
        print('❌  請設定環境變數 GMAIL_USER 和 GMAIL_APP_PASSWORD')
        print()
        print('  範例（macOS/Linux）:')
        print('  export GMAIL_USER="yourapp@gmail.com"')
        print('  export GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx"')
        print('  python scripts/test_email.py')
        return

    print(f'📤  寄送測試信至 {TEST_RECIPIENT} ...')
    msg = MIMEMultipart('alternative')
    msg['Subject'] = '[Team Scheduler] Gmail SMTP 發信測試'
    msg['From']    = GMAIL_USER
    msg['To']      = TEST_RECIPIENT
    msg.attach(MIMEText(HTML, 'html', 'utf-8'))

    # 先試 465 (SSL)，逾時就改試 587 (STARTTLS)——有些網路會擋其中一個埠
    def send_465():
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=15) as s:
            s.login(GMAIL_USER, GMAIL_PASS)
            s.sendmail(GMAIL_USER, [TEST_RECIPIENT], msg.as_string())

    def send_587():
        with smtplib.SMTP('smtp.gmail.com', 587, timeout=15) as s:
            s.starttls()
            s.login(GMAIL_USER, GMAIL_PASS)
            s.sendmail(GMAIL_USER, [TEST_RECIPIENT], msg.as_string())

    try:
        try:
            print('   嘗試 465 (SSL) …')
            send_465()
        except (smtplib.SMTPServerDisconnected, TimeoutError, OSError) as e:
            print(f'   465 連不上（{e}），改試 587 (STARTTLS) …')
            send_587()
        print('✅  測試信已發送！請至收件匣確認。')
    except smtplib.SMTPAuthenticationError:
        print('❌  認證失敗：請確認 GMAIL_APP_PASSWORD 是否正確、且帳號已開啟兩步驟驗證。')
        print('   （需使用 App Password，不是 Google 帳號密碼）')
    except Exception as e:
        print(f'❌  發送失敗：{type(e).__name__}: {e}')

if __name__ == '__main__':
    main()
