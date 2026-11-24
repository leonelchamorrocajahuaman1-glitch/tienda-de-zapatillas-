@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist server\.env (
  echo Falta la configuracion. Ejecuta primero instalar.bat
  pause
  exit /b 1
)
echo Guardando una copia de seguridad de todos los datos en la carpeta "copias"...
echo (Con XAMPP, el modulo MySQL debe estar iniciado.)
call npm run datos:exportar
echo.
echo Guarda esa copia fuera de esta PC (USB o nube): contiene datos de tus clientes.
pause
