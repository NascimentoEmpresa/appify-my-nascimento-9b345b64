import Recrutamento from "@/pages/rh/Recrutamento";

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
  return <Recrutamento escopo="diretoria" />;
}
