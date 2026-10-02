import Recrutamento from "@/pages/rh/Recrutamento";

/**
 * Analistas Validações › Gestão Recrutamento.
 *
 * A MESMA tela de /app/rh/recrutamento, no escopo "analista": só a fila
 * "Pendente Analista" (na tela, "Pendente Operacional"). Quem manda em ver a
 * tela é `licitacoes_analistas_recrutamento`; o botão de aprovar e reprovar é
 * de quem tem `licitacoes_aprova_vagas` — "APROVA VAGAS" em Licitações, no
 * Acesso por Usuário (02/10/2026, mig 287).
 *
 * A etapa 1 era do Operacional até 02/09/2026. O menu dele continua de pé
 * (/app/operacional/recrutamento), e desde 02/10/2026 aprova também quem tem
 * o "APROVA VAGAS" do Operacional — ver o cabeçalho de pages/rh/Recrutamento.
 */
export default function AnalistasRecrutamento() {
  return <Recrutamento escopo="analista" />;
}
