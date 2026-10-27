@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist server\.env (
  echo Falta la configuracion. Ejecuta primero instalar.bat
  pause
  exit /b 1
)
echo Iniciando API, tienda y panel...
start "" cmd /c "timeout /t 8 >nul && start http://localhost:5173 && start http://localhost:5174/admin/"
call npm run dev
pause
