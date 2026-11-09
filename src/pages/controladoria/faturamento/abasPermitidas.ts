// Controle de Faturamento: quais abas a pessoa vê. Sem a ação 'visao_completa' (Administração > Módulos) ela vê só "NFs Não Emitidas",
// mesmo que a URL ou um clique (ex.: KPI) peça outra aba. Lógica de permissão fica em arquivo próprio, com teste.
export const ABA_SO_NAO_EMITIDAS = "pendentes";

export function abaPermitida(aba: string, temVisaoCompleta: boolean): string {
  return temVisaoCompleta ? aba : ABA_SO_NAO_EMITIDAS;
}
