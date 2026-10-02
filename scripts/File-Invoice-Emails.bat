@echo off
title File Invoice Emails
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Process-InvoiceEmails.ps1" %*
echo.
pause
