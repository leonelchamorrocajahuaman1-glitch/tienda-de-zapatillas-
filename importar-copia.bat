@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist server\.env (
  echo Falta la configuracion. Ejecuta primero instalar.bat
  pause
  exit /b 1
)
echo === Importar una copia de seguridad de SOLE 20 ===
echo.
echo La copia se descarga en el panel: Mi cuenta ^> Descargar copia de seguridad.
echo ATENCION: se BORRAN los datos actuales de esta instalacion y se cargan los de la copia.
echo (Con XAMPP, el modulo MySQL debe estar iniciado.)
echo.
set /p COPIA=Arrastra aqui el archivo .jsonl.gz y pulsa Enter: 
set COPIA=%COPIA:"=%
if not exist "%COPIA%" (
  echo No se encontro el archivo: %COPIA%
  pause
  exit /b 1
)
set /p OK=Escribe SI para continuar: 
if /i not "%OK%"=="SI" (
  echo Cancelado. No se cambio nada.
  pause
  exit /b 0
)
call npm run datos:importar -- "%COPIA%" --reemplazar
pause
