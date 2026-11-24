@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist server\.env (
  echo Falta la configuracion. Ejecuta primero instalar.bat y elige 1 (XAMPP^).
  pause
  exit /b 1
)
echo === SOLE 20 con XAMPP ===
echo Recuerda: en el XAMPP Control Panel, MySQL debe estar en Start.
echo.
echo Preparando la tienda (tarda alrededor de un minuto)...
call npm run build
if errorlevel 1 (
  echo No se pudo preparar la tienda.
  pause
  exit /b 1
)
rem Modo produccion en el puerto 4000: tienda en / y panel en /admin
set NODE_ENV=production
set PORT=4000
set COOKIE_SECURE=false
start "" cmd /c "timeout /t 15 >nul && start http://localhost/sole20/"
echo.
echo Tienda encendida. NO cierres esta ventana mientras la uses.
echo Entrada: http://localhost/sole20/
call npm run start:prod
pause
