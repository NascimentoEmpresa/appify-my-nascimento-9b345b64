export function mesAnterior(hoje = new Date()): string {
  const data = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

export interface ResumoEntregasMensais {
  recebidos: number; admissoes: number; reposicoes: number; motivo_nao_informado: number;
  despachados: number; correios: number; supervisores: number; modalidade_nao_informada: number;
  correios_sem_cotacao: number; frete_estimado: number;
}
export type ContratoEntregasMensais = ResumoEntregasMensais & { contrato_id: string | null; contrato: string };
export interface EntregasMensaisDados { resumo: ResumoEntregasMensais; contratos: ContratoEntregasMensais[] }

export function csvEntregasMensais(linhas: ContratoEntregasMensais[]): string {
  const celula = (valor: string | number) => {
    const texto = typeof valor === 'string' && /^[\s]*[=+@-]/.test(valor) ? `'${valor}` : String(valor);
    return `"${texto.replace(/"/g, '""')}"`;
  };
  return [
    ['Contrato', 'Recebidos', 'Admissão', 'Reposição', 'Motivo não informado', 'Despachados', 'Correios', 'Supervisores', 'Modalidade não informada', 'Correios sem cotação', 'Frete estimado (R$)'],
    ...linhas.map(l => [l.contrato, l.recebidos, l.admissoes, l.reposicoes, l.motivo_nao_informado, l.despachados, l.correios, l.supervisores, l.modalidade_nao_informada, l.correios_sem_cotacao, l.frete_estimado.toFixed(2).replace('.', ',')]),
  ].map(l => l.map(celula).join(';')).join('\r\n');
}
