// Selo "Novo" da Sidebar que expira sozinho. O item do menu declara `novoDesde`
// (AAAA-MM-DD, dia em que a tela foi liberada); o selo vale por NOVO_DIAS a partir daí.
export const NOVO_DIAS = 15;

// Pura: "hoje" entra por parâmetro para poder ser testada.
export function selNovoVigente(novoDesde: string | undefined, hoje: Date = new Date()): boolean {
  if (!novoDesde) return false;
  const inicio = Date.parse(`${novoDesde}T00:00:00`);
  if (Number.isNaN(inicio)) return false;
  const dias = (hoje.getTime() - inicio) / 86_400_000;
  return dias >= 0 && dias < NOVO_DIAS;
}
