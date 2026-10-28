@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Imprime un ticket de prueba SIN pasar por la tienda (comprueba la conexion con la impresora).
echo.
set /p IMPRESORA=Escribe el nombre exacto de la impresora (Enter = predeterminada): 
node agente-impresion.mjs --probar "%IMPRESORA%"
echo.
pause
