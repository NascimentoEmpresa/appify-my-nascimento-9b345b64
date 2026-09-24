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
REM      scripts\banco.cmd              (fica aberto, atualiza a cada 60s)
REM      scripts\banco.cmd -UmaVez      (le, mostra e sai - ~2s)
REM      scripts\banco.cmd -SemAlerta   (so olhar, sem avisar ninguem)
REM
REM  Funciona em QUALQUER maquina que clone o repositorio: o %~dp0 resolve
REM  a pasta deste proprio arquivo, entao o caminho onde o projeto foi
REM  clonado nao importa.
REM
REM  Antes do primeiro uso e preciso ter o worker\.env preenchido - ele nao
REM  vem no git porque tem segredo dentro. O proprio script explica o que
REM  fazer se estiver faltando.
REM ===================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0monitor-supabase.ps1" %*
