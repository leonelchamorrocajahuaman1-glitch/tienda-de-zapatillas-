@echo off
chcp 65001 >nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Agente de impresion de boletas.lnk" 2>nul
echo Listo: el agente ya no se iniciara automaticamente.
pause
