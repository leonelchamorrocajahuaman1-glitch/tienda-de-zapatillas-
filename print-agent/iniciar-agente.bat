@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Agente de impresion de boletas
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
echo.
echo  Agente de impresion de boletas
echo  Deja esta ventana abierta ^(puedes minimizarla^). Para detenerlo, cierrala.
echo.
:inicio
node agente-impresion.mjs
echo.
echo  El agente se detuvo. Se reinicia en 10 segundos...
timeout /t 10 >nul
goto inicio
