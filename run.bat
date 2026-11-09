@echo off
title البرودكاست بوت - تشغيل السيرفر
echo ====================================================
echo    تشغيل لوحة تحكم البرودكاست بوت (Discord Broadcast)
echo ====================================================
echo.
if not exist node_modules (
    echo [!] جاري تثبيت الحزم المطلوبة لأول مرة...
    call npm install
)
echo [*] جاري تشغيل السيرفر على الرابط: http://localhost:3000
echo [*] يمكنك فتح الرابط في متصفحك بعد التشغيل.
echo.
npm start
pause

