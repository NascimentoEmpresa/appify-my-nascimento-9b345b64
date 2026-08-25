@echo off
setlocal

rem Caminho fixo pra pasta do worker — funciona mesmo se este .bat for
rem movido pra outra pasta/computador (ajuste esta linha se mudar o local
rem do projeto).
set WORKER_DIR=C:\Users\Eduardo Monteiro\Desktop\Projeto_ERP_LOVABLE\worker

cd /d "%WORKER_DIR%"
if errorlevel 1 (
  echo Nao foi possivel acessar %WORKER_DIR%
  pause
  exit /b 1
)

echo Iniciando o worker de automacao de reunioes...
echo (sessao do WhatsApp e reaproveitada automaticamente, sem precisar escanear QR de novo)
echo.

call npm start

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo O worker encerrou com erro (codigo %ERRORLEVEL%^). Enviando alerta pro Discord...
  call node alerta-processo-caiu.js
) else (
  echo.
  echo O worker encerrou normalmente.
)

echo.
pause
