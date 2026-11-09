import { describe, expect, it } from 'vitest';
import { csvEntregasMensais, mesAnterior } from '@/lib/suprimentos/entregasMensais';
describe('entregas mensais', () => {
  it('inicia no mês fechado anterior, inclusive na virada do ano', () => {
    expect(mesAnterior(new Date(2026, 0, 31))).toBe('2025-12');
    expect(mesAnterior(new Date(2026, 2, 31))).toBe('2026-02');
  });
  it('exporta contrato com delimitador, aspas e valor em reais', () => {
    const csv = csvEntregasMensais([{ contrato_id: null, contrato: 'Contrato; "A"', recebidos: 2, admissoes: 1, reposicoes: 1, motivo_nao_informado: 0, despachados: 1, correios: 1, supervisores: 0, modalidade_nao_informada: 0, correios_sem_cotacao: 0, frete_estimado: 12.5 }]);
    expect(csv).toContain('"Contrato; ""A"""');
    expect(csv).toContain('"12,50"');
  });
  it('neutraliza fórmulas no nome de contrato exportado', () => {
    const csv = csvEntregasMensais([{ contrato_id: null, contrato: '=1+1', recebidos: 0, admissoes: 0, reposicoes: 0, motivo_nao_informado: 0, despachados: 0, correios: 0, supervisores: 0, modalidade_nao_informada: 0, correios_sem_cotacao: 0, frete_estimado: 0 }]);
    expect(csv).toContain('"\'=1+1"');
  });
});
