Write-Host "Procurando processos do worker (Chrome/Node presos na sessao do WhatsApp)..."
Write-Host ""

$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' or Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*wwebjs_auth*" }

if ($procs) {
  $procs | ForEach-Object {
    Write-Host ("Encerrando PID " + $_.ProcessId + " (" + $_.Name + ")")
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Write-Host ""
  Write-Host "Pronto. Pode iniciar o worker de novo."
} else {
  Write-Host "Nenhum processo preso encontrado. Se o erro continuar, feche manualmente pelo Gerenciador de Tarefas."
}
