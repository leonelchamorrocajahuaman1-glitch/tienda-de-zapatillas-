@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\Agente de impresion de boletas.lnk'); $s.TargetPath='%~dp0iniciar-agente.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
if errorlevel 1 (
  echo No se pudo crear el acceso directo.
) else (
  echo Listo: el agente se iniciara solo ^(minimizado^) cada vez que enciendas la PC.
)
pause
