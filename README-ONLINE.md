# 🧠 สมองมึงคิดเหมือนกูไหม? — Online Edition

เวอร์ชันนี้ทำให้เล่นกับเพื่อนจากคนละบ้านผ่านอินเทอร์เน็ตได้ โดยใช้ WebSocket และรองรับ HTTPS/WSS อัตโนมัติ

## สิ่งที่เพิ่มจากเวอร์ชันเดิม

- 🌍 เล่นข้ามบ้าน/ข้าม Wi‑Fi ได้
- 🔑 Room Code 4 ตัว
- ⚡ WebSocket real-time
- 🔒 ถ้าเว็บเป็น HTTPS จะใช้ WSS อัตโนมัติ
- 💓 heartbeat + reconnect สำหรับ connection ที่หลุด
- 🧹 ล้างห้องร้างหลัง 30 นาที
- 🩺 `/health` สำหรับตรวจสถานะเซิร์ฟเวอร์
- 🚀 มี `render.yaml` สำหรับ Render
- 🎯 15 รอบ / สุ่ม 15 คำถามจากคลัง 200 ข้อ / ไม่ซ้ำในแมตช์เดียว

## วิธี Deploy ให้เป็นเว็บจริงด้วย Render

### 1) สร้าง GitHub repository
สร้าง repository ใหม่ เช่น:

`brain-same-game`

แล้วอัปโหลดไฟล์ทั้งหมดใน ZIP นี้ขึ้น GitHub

### 2) เปิด Render
เข้า Render แล้วเลือก:

**New → Web Service**

เชื่อม GitHub repository ของเกม

ค่าที่ใช้:

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Plan: Free (เหมาะสำหรับทดลอง/โปรเจกต์ส่วนตัว)

หรือใช้ `render.yaml` ที่ให้มาเพื่อช่วยตั้งค่า

### 3) Deploy
เมื่อ Deploy เสร็จ Render จะให้ URL ประมาณ:

`https://brain-same-game-xxxx.onrender.com`

เปิด URL นี้ได้จากมือถือ/คอมคนละบ้านเลย

### 4) วิธีเล่น
คนที่ 1:
1. เปิด URL
2. ใส่ชื่อ
3. กด `สร้างห้อง`
4. ส่ง Room Code 4 ตัวให้เพื่อน

คนที่ 2:
1. เปิด URL เดียวกัน
2. ใส่ชื่อ
3. กด `เข้าห้องเพื่อน`
4. ใส่ Room Code

จากนั้นเริ่มเกม 15 รอบ

## หมายเหตุเรื่อง Free Hosting

Render Free เหมาะกับการทดลองและโปรเจกต์ส่วนตัว แต่มีข้อจำกัด เช่น เว็บจะหยุดทำงานเมื่อไม่มี traffic ตามช่วงเวลาที่กำหนด และเมื่อปลุกกลับขึ้นมาอาจใช้เวลาประมาณหนึ่งนาที

ข้อมูลห้องในเวอร์ชันนี้เก็บใน RAM ของเซิร์ฟเวอร์ ดังนั้นถ้า service restart/deploy ห้องที่กำลังเล่นอยู่จะหายและต้องสร้างห้องใหม่

ถ้าจะเปิดให้คนทั่วไปเล่นจำนวนมาก ควรเพิ่ม:
- Redis/Key Value สำหรับ room state
- rate limiting
- persistent player accounts
- analytics
- moderation
- matchmaking
- scaling หลาย instance

## Local

```bash
npm install
npm start
```

แล้วเปิด:

`http://localhost:3000`

## Health Check

เปิด:

`/health`

ควรได้ JSON ประมาณ:

```json
{"ok":true,"rooms":0}
```
