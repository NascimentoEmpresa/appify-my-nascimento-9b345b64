import Recrutamento from "@/pages/rh/Recrutamento";
import { AcessoGate } from "@/components/auth/AcessoGate";

/**
 * Diretoria › Gestão Recrutamento (16/09/2026).
 *
 * A MESMA tela de /app/rh/recrutamento, no escopo "diretoria": só a fila
 * "Pendente Diretoria" — vaga administrativa ou com setor —, recortada pelos
 * setores marcados pra pessoa em Acesso por Usuário. Aprovar manda pro
 * Recrutamento ("Pendente Recrutamento"); antes disso o Recrutamento nem vê.
 * Menu: diretoria_recrutamento (ação aprovar).
 */
export default function DiretoriaRecrutamento() {
  // O RouteGuard já nega a rota a quem não tem o menu; o gate é o padrão
  // das outras telas (J1.F) e trava o miolo também.
  return (
    <AcessoGate menu="diretoria_recrutamento" acao="visualizar"
      fallback={<p className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela. Peça a liberação em Administração › Acesso por Usuário.</p>}>
      <Recrutamento escopo="diretoria" />
    </AcessoGate>
  );
}
