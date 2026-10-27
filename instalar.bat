@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Configurando la tienda (solo la primera vez)...
call npm run setup
pause
