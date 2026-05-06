#!/usr/bin/env python3
"""
send_notifications.py
─────────────────────
Run daily at 09:00 Taiwan time (01:00 UTC) via GitHub Actions.
Checks Firestore for events happening tomorrow and sends Gmail notifications.

Notification triggers:
  1. 設計類專案開始 (design/seasonal_kv) → notify assigned designers & planners
  2. 秀展 Planner 開始規劃日              → notify that planner
  3. 活動開始日 (event type)              → notify assigned people
  4. 同仁休假開始 (any leave)             → notify ADMIN_EMAIL

Required env vars:
  FIREBASE_SERVICE_ACCOUNT  – JSON string of Firebase service account key
  FIREBASE_PROJECT_ID       – Firebase project ID
  GMAIL_USER                – Gmail address for sending
  GMAIL_APP_PASSWORD        – Gmail App Password (not account password)
  ADMIN_EMAIL               – Admin email to receive leave reminders
"""

import json
import os
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import firebase_admin
from firebase_admin import credentials, firestore

# ── Timezone ──────────────────────────────────────────────────────────────────
TW_TZ = timezone(timedelta(hours=8))

def tomorrow_tw() -> str:
    """Return tomorrow's date string in Taiwan time as YYYY-MM-DD."""
    now_tw = datetime.now(TW_TZ)
    tmr = now_tw + timedelta(days=1)
    return tmr.strftime('%Y-%m-%d')

# ── Milestone rules (mirrors DEFAULT_RULES in milestoneUtils.js) ──────────────
DEFAULT_RULES = {
    'plannerStart': 8,
    'plannerStart_輕度': 6,
    'plannerStart_中度': 8,
    'plannerStart_高度': 10,
}

def get_loading_level(booth_size, project_name=''):
    """Mirror getLoadingLevel() from milestoneUtils.js."""
    if project_name and 'COMPUTEX' in project_name.upper():
        return '高度'
    try:
        count = int(booth_size or 0)
    except (ValueError, TypeError):
        count = 0
    if count <= 0:
        return None
    if count >= 9:
        return '高度'
    if count >= 5:
        return '中度'
    return '輕度'

def resolve_rule(rules: dict, base_key: str, loading_level: str | None) -> int:
    """Mirror resolveRule() from milestoneUtils.js."""
    if loading_level:
        lk = f'{base_key}_{loading_level}'
        if lk in rules:
            return rules[lk]
    return rules.get(base_key, DEFAULT_RULES.get(base_key, 8))

def planner_start_date(project_start: str, rules: dict, loading_level: str | None) -> str:
    """Return the date a planner should start (YYYY-MM-DD)."""
    weeks = resolve_rule(rules, 'plannerStart', loading_level)
    start = datetime.strptime(project_start, '%Y-%m-%d')
    work_start = start - timedelta(weeks=weeks)
    return work_start.strftime('%Y-%m-%d')

# ── Firebase init ─────────────────────────────────────────────────────────────
def init_firebase():
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
    if not sa_json:
        sys.exit('❌  FIREBASE_SERVICE_ACCOUNT env var not set.')
    sa_info = json.loads(sa_json)
    cred = credentials.Certificate(sa_info)
    firebase_admin.initialize_app(cred)
    return firestore.client()

# ── Email helper ───────────────────────────────────────────────────────────────
def send_email(to_addrs: list[str], subject: str, html_body: str):
    """Send a single email to one or more recipients."""
    gmail_user = os.environ.get('GMAIL_USER', '')
    gmail_pass = os.environ.get('GMAIL_APP_PASSWORD', '')
    if not gmail_user or not gmail_pass:
        print(f'  ⚠️  Gmail credentials not set – skipping email to {to_addrs}')
        return

    to_addrs = [a for a in to_addrs if a]  # drop empty strings
    if not to_addrs:
        return

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = gmail_user
    msg['To'] = ', '.join(to_addrs)
    msg.attach(MIMEText(html_body, 'html', 'utf-8'))

    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(gmail_user, gmail_pass)
            server.sendmail(gmail_user, to_addrs, msg.as_string())
        print(f'  ✉️  Sent "{subject}" → {to_addrs}')
    except Exception as exc:
        print(f'  ❌  Failed to send "{subject}": {exc}')

# ── Email templates ────────────────────────────────────────────────────────────
def _base_html(title: str, body_html: str) -> str:
    return f"""
<html><body style="font-family:sans-serif;color:#1f2937;max-width:560px;margin:auto;padding:24px">
  <div style="background:#f0f9ff;border-left:4px solid #3b82f6;padding:16px 20px;border-radius:8px;margin-bottom:20px">
    <h2 style="margin:0 0 4px;font-size:18px">{title}</h2>
  </div>
  {body_html}
  <p style="color:#9ca3af;font-size:12px;margin-top:32px">
    此信件由 Team Scheduler 自動發送，請勿回覆。
  </p>
</body></html>
"""

def email_design_start(project_name: str, start_date: str, person_name: str) -> tuple[str, str]:
    subject = f'[Team Scheduler] 明日開始：{project_name}'
    body = _base_html(
        f'📐 設計專案即將開始',
        f"""
        <p>Hi {person_name}，</p>
        <p>提醒您，以下設計專案將於 <strong>{start_date}</strong> 開始：</p>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 12px;background:#f3f4f6;border-radius:6px;font-weight:600">
              {project_name}
            </td>
          </tr>
        </table>
        <p>請確認相關準備事項皆已就緒。</p>
        """
    )
    return subject, body

def email_planner_start(project_name: str, work_start_date: str, person_name: str, show_date: str) -> tuple[str, str]:
    subject = f'[Team Scheduler] 明日開始規劃：{project_name}'
    body = _base_html(
        f'📋 秀展規劃期即將開始',
        f"""
        <p>Hi {person_name}，</p>
        <p>提醒您，以下秀展的 Planner 規劃期將於 <strong>{work_start_date}</strong> 開始：</p>
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#f3f4f6">
            <td style="padding:8px 12px;color:#6b7280;width:40%">專案名稱</td>
            <td style="padding:8px 12px;font-weight:600">{project_name}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#6b7280">展覽日期</td>
            <td style="padding:8px 12px">{show_date}</td>
          </tr>
        </table>
        <p>請開始進行前置準備工作。</p>
        """
    )
    return subject, body

def email_event_start(project_name: str, event_date: str, person_name: str) -> tuple[str, str]:
    subject = f'[Team Scheduler] 明日活動：{project_name}'
    body = _base_html(
        f'🎯 活動明日開始',
        f"""
        <p>Hi {person_name}，</p>
        <p>提醒您，以下活動將於 <strong>{event_date}</strong> 開始：</p>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 12px;background:#fff7ed;border-left:3px solid #f97316;font-weight:600">
              {project_name}
            </td>
          </tr>
        </table>
        <p>請確認活動相關事宜皆已安排妥當。</p>
        """
    )
    return subject, body

def email_leave_reminder(person_name: str, leave_date: str, leave_type: str, leave_end: str) -> tuple[str, str]:
    subject = f'[Team Scheduler] 明日休假提醒：{person_name}'
    date_range = leave_date if leave_date == leave_end else f'{leave_date} ～ {leave_end}'
    body = _base_html(
        f'🏖️ 同仁休假提醒',
        f"""
        <p>提醒您，以下同仁明日開始休假：</p>
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#f3f4f6">
            <td style="padding:8px 12px;color:#6b7280;width:40%">姓名</td>
            <td style="padding:8px 12px;font-weight:600">{person_name}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#6b7280">假別</td>
            <td style="padding:8px 12px">{leave_type}</td>
          </tr>
          <tr style="background:#f3f4f6">
            <td style="padding:8px 12px;color:#6b7280">日期</td>
            <td style="padding:8px 12px">{date_range}</td>
          </tr>
        </table>
        """
    )
    return subject, body

# ── Main logic ─────────────────────────────────────────────────────────────────
def main():
    tmr = tomorrow_tw()
    print(f'🗓  Checking notifications for tomorrow: {tmr}')

    db = init_firebase()

    # Load milestone rules from Firestore (settings/milestoneRules)
    rules = dict(DEFAULT_RULES)
    try:
        rules_doc = db.collection('settings').document('milestoneRules').get()
        if rules_doc.exists:
            rules.update(rules_doc.to_dict())
    except Exception as e:
        print(f'  ⚠️  Could not load milestoneRules: {e}')

    # Load all people (for name/email lookup)
    people_map = {}  # id → {name, email, role}
    for doc in db.collection('people').stream():
        d = doc.to_dict()
        people_map[doc.id] = d

    admin_email = os.environ.get('ADMIN_EMAIL', '')

    # Load all projects
    projects = []
    for doc in db.collection('projects').stream():
        d = doc.to_dict()
        d['id'] = doc.id
        projects.append(d)

    notifications_sent = 0

    for proj in projects:
        ptype = proj.get('type', '')
        assignments = proj.get('assignments', [])
        proj_name = proj.get('name', '（無名稱）')
        start_date = proj.get('startDate', '')
        end_date = proj.get('endDate', '')

        # ── 1. 設計類專案開始 ─────────────────────────────────────────────────
        if ptype in ('design', 'seasonal_kv') and start_date == tmr:
            print(f'  [設計類] {proj_name} 開始 → 通知指派人員')
            for asn in assignments:
                person = people_map.get(asn.get('personId', ''))
                if not person:
                    continue
                email = person.get('email', '')
                if not email:
                    continue
                subj, html = email_design_start(proj_name, start_date, person['name'])
                send_email([email], subj, html)
                notifications_sent += 1

        # ── 2. 秀展 Planner 開始規劃 ─────────────────────────────────────────
        elif ptype == 'tradeshow' and start_date:
            level = get_loading_level(proj.get('boothSize'), proj_name)
            computed_start = planner_start_date(start_date, rules, level)
            if computed_start == tmr:
                print(f'  [秀展] {proj_name} Planner 開始 → 通知 Planner')
                for asn in assignments:
                    if asn.get('role') != 'planner':
                        continue
                    person = people_map.get(asn.get('personId', ''))
                    if not person:
                        continue
                    email = person.get('email', '')
                    if not email:
                        continue
                    subj, html = email_planner_start(proj_name, tmr, person['name'], start_date)
                    send_email([email], subj, html)
                    notifications_sent += 1

        # ── 3. 活動開始日 ─────────────────────────────────────────────────────
        elif ptype == 'event' and start_date == tmr:
            print(f'  [活動] {proj_name} 開始 → 通知指派人員')
            for asn in assignments:
                person = people_map.get(asn.get('personId', ''))
                if not person:
                    continue
                email = person.get('email', '')
                if not email:
                    continue
                subj, html = email_event_start(proj_name, start_date, person['name'])
                send_email([email], subj, html)
                notifications_sent += 1

    # ── 4. 同仁休假提醒 → notify admin ───────────────────────────────────────
    if admin_email:
        for doc in db.collection('leaves').stream():
            lv = doc.to_dict()
            if lv.get('startDate') == tmr:
                person = people_map.get(lv.get('personId', ''))
                if not person:
                    continue
                print(f'  [休假] {person["name"]} 明日開始休假 → 通知管理員')
                subj, html = email_leave_reminder(
                    person['name'],
                    lv.get('startDate', tmr),
                    lv.get('type', '假'),
                    lv.get('endDate', tmr),
                )
                send_email([admin_email], subj, html)
                notifications_sent += 1
    else:
        print('  ⚠️  ADMIN_EMAIL not set – skipping leave notifications')

    print(f'\n✅  Done. {notifications_sent} notification(s) sent.')

if __name__ == '__main__':
    main()
