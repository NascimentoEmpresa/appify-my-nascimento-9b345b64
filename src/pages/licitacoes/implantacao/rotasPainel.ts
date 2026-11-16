// Rotas do painel por setor da Implantação (fora do .tsx de componentes por
// causa do fast refresh).
export const ROTA_PAINEL = "/app/licitacoes/implantacao/painel";
export const ROTA_FORMULARIO = "/app/licitacoes/implantacao";

export function rotaSetor(slug: string, contratoId: string | null) {
  return `${ROTA_PAINEL}/${slug}${contratoId ? `?contrato=${contratoId}` : ""}`;
}
export function rotaPainel(contratoId: string | null) {
  return `${ROTA_PAINEL}${contratoId ? `?contrato=${contratoId}` : ""}`;
}
export function rotaFormulario(contratoId: string | null, setor?: string) {
  const p = new URLSearchParams();
  if (contratoId) p.set("contrato", contratoId);
  if (setor) p.set("setor", setor);
  const q = p.toString();
  return `${ROTA_FORMULARIO}${q ? `?${q}` : ""}`;
}
