import Recrutamento from "@/pages/rh/Recrutamento";

/**
 * Analistas Validações › Gestão Recrutamento.
 *
 * A MESMA tela de /app/rh/recrutamento, no escopo "analista": só a fila
 * "Pendente Analista", com botão de aprovar e reprovar. Quem manda nas
 * permissões aqui é `licitacoes_analistas_recrutamento`.
 *
 * A etapa 1 era do Operacional até 02/09/2026. O menu dele continua de pé
 * (/app/operacional/recrutamento), mas no escopo "operacional", que é leitura
 * pura — ver o cabeçalho de pages/rh/Recrutamento.
 */
export default function AnalistasRecrutamento() {
  return <Recrutamento escopo="analista" />;
}
