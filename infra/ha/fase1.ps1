# ===========================================================================
#  Atalho para disparar a Fase 1 do corte de um comando curto, no PowerShell:
#
#      .\infra\ha\fase1.ps1          <- liga a replicacao
#      .\infra\ha\fase1.ps1 --pre    <- so confere os pre-requisitos
#
#  POR QUE ELE EXISTE
#  O trabalho de verdade esta em disparar-fase1.sh, que e bash. E o `bash` do
#  PATH desta maquina e o do WSL -- outro home, outras chaves SSH, nao serve.
#  Este atalho chama o Git Bash pelo caminho certo e roda a partir da raiz do
#  repositorio, para o script achar o .env.local.
# ===========================================================================
$ErrorActionPreference = 'Stop'

$bash = Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe'
if (-not (Test-Path $bash)) {
  throw "Git Bash nao encontrado em $bash - ajuste o caminho neste arquivo."
}

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

& $bash 'infra/ha/disparar-fase1.sh' @args
exit $LASTEXITCODE
