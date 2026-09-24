@echo off
REM ===================================================================
REM  Atalho para o monitor do banco.
REM
REM  Existe porque o Windows vem com a execucao de scripts .ps1
REM  DESABILITADA por padrao (ExecutionPolicy = Restricted), e chamar
REM  o .ps1 direto devolve PSSecurityException / UnauthorizedAccess.
REM
REM  Este .cmd chama o PowerShell com Bypass apenas para ESTA execucao.
REM  Nao altera configuracao nenhuma da maquina e nao precisa de admin.
REM
REM  USO
REM      scripts\banco.cmd              (fica aberto, atualizando)
REM      scripts\banco.cmd -UmaVez      (le, mostra e sai - ~2s)
REM      scripts\banco.cmd -SemAlerta   (so olhar, sem avisar ninguem)
REM ===================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0monitor-supabase.ps1" %*
