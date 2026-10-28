@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Impresoras instaladas en esta PC ^(la marcada con una estrella es la predeterminada^):
echo.
node agente-impresion.mjs --listar
echo.
pause
