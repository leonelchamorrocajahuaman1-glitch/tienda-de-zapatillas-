@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Copia SOLO la pagina de entrada a htdocs (el proyecto no: tiene contrasenas en server\.env)
set "HTDOCS=C:\xampp\htdocs"
if not exist "%HTDOCS%" set /p "HTDOCS=No encuentro C:\xampp\htdocs. Escribe la ruta de la carpeta htdocs de tu XAMPP: "
set "HTDOCS=%HTDOCS:"=%"
if not exist "%HTDOCS%" (
  echo No existe la carpeta: %HTDOCS%
  pause
  exit /b 1
)
xcopy /E /I /Y "xampp\sole20" "%HTDOCS%\sole20" >nul
if errorlevel 1 (
  echo No se pudo copiar a %HTDOCS%\sole20
  pause
  exit /b 1
)
echo Listo: ya aparece "sole20" en http://localhost/
echo Para usar la tienda, abre iniciar-xampp.bat y entra en http://localhost/sole20/
pause
