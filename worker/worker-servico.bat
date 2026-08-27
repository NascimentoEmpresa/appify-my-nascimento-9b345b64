@echo off
setlocal enabledelayedexpansion

rem =====================================================================
rem  Worker como servico: sobe sozinho no login e volta sozinho se cair.
rem
rem  Diferente do iniciar.bat, que e para rodar na mao:
rem    - nao tem "pause" no fim (pause travaria a tarefa agendada para
rem      sempre, esperando uma tecla que ninguem vai apertar);
rem    - tem laco de reinicio, porque o processo pode cair por queda de
rem      internet, sessao do WhatsApp expirada ou erro nao tratado, e um
rem      worker parado significa nota fiscal nao buscada e alerta de
rem      certificado nao enviado.
rem
rem  Registrar para subir no login:
rem    schtasks /Create /TN "ERP Worker" /SC ONLOGON /TR "<caminho deste bat>"
rem =====================================================================

set WORKER_DIR=C:\Users\Eduardo Monteiro\Desktop\Projeto_ERP_LOVABLE\worker
set LOG=%WORKER_DIR%\state\worker.log

cd /d "%WORKER_DIR%" || exit /b 1
if not exist "%WORKER_DIR%\state" mkdir "%WORKER_DIR%\state"

:loop
echo. >> "%LOG%"
echo ===== worker iniciado em %DATE% %TIME% ===== >> "%LOG%"

rem O log vai para arquivo porque a tarefa agendada roda sem janela: sem
rem isso, um erro de inicializacao some e o sintoma vira "parou de buscar
rem nota" sem nenhuma pista de quando ou por que.
call npm start >> "%LOG%" 2>&1

echo ===== worker caiu (codigo %ERRORLEVEL%) em %DATE% %TIME% ===== >> "%LOG%"
call node alerta-processo-caiu.js >> "%LOG%" 2>&1

rem 15s antes de tentar de novo: sem essa pausa, uma falha imediata e
rem repetida (credencial errada, por exemplo) viraria um laco em rajada
rem que enche o log e o Discord de alerta em segundos.
timeout /t 15 /nobreak > nul
goto loop
