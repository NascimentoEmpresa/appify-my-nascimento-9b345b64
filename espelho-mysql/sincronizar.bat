@echo off
REM ====================================================================
REM  Espelho MySQL -> Supabase, execucao diaria.
REM  Chamado pelo Agendador de Tarefas do Windows (tarefa "EspelhoMySQL").
REM
REM  O caminho do node.exe esta escrito por extenso de proposito: o
REM  Agendador nao herda o PATH do terminal, entao "node" solto nao acha.
REM ====================================================================

setlocal

set PASTA=%~dp0
set NODE="C:\Program Files\nodejs\node.exe"
set LOGS=%PASTA%logs

if not exist "%LOGS%" mkdir "%LOGS%"

REM Data no formato AAAA-MM-DD, independente do formato regional do Windows.
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set HOJE=%%d
set LOG=%LOGS%\%HOJE%.log

echo. >> "%LOG%"
echo ================================================== >> "%LOG%"
powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'" >> "%LOG%"
echo ================================================== >> "%LOG%"

cd /d "%PASTA%"
%NODE% espelho.mjs sincronizar --commit >> "%LOG%" 2>&1
set RESULTADO=%ERRORLEVEL%

if %RESULTADO%==0 (
  echo RESULTADO: sucesso >> "%LOG%"
) else (
  echo RESULTADO: FALHOU ^(codigo %RESULTADO%^) >> "%LOG%"
)

REM Apaga log com mais de 30 dias, para a pasta nao crescer sem fim.
powershell -NoProfile -Command "Get-ChildItem '%LOGS%\*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force" 2>nul

REM O "&" aqui nao e enfeite: sem ele, o endlocal apaga RESULTADO antes do
REM exit /b ser expandido, o .bat sempre devolve 0, e o Agendador registra
REM falha como sucesso. Na mesma linha, a expansao acontece antes.
endlocal & exit /b %RESULTADO%
