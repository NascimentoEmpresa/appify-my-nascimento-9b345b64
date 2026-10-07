// Selo "revisar" do Fluxo de Caixa: a view devolve os motivos numa string só,
// separados por " · ". Aqui eles viram uma lista, cada um com o campo do lápis
// que o resolve (quando existe um).
export type CampoRevisar = "contrato" | "classificacao" | null;

// Valor do seletor de Contrato (lápis) para "este lançamento não tem contrato".
export const SEM_CONTRATO = "__sem_contrato__";

export interface MotivoRevisar {
  texto: string;
  campo: CampoRevisar;
  dica?: string;
}

const DICA_CONTRATO = "Escolha o contrato real ou, se não pertence a nenhum, “Sem contrato (administrativo)”.";

export function motivosRevisar(inconsistencia: string | null | undefined): MotivoRevisar[] {
  if (!inconsistencia) return [];
  return inconsistencia
    .split(" · ")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((texto): MotivoRevisar => {
      const contrato = texto.startsWith("Contrato não mapeado");
      return {
        texto,
        campo: contrato ? "contrato" : texto.startsWith("Classificação não mapeada") ? "classificacao" : null,
        dica: contrato ? DICA_CONTRATO : undefined,
      };
    });
}

export const camposComPendencia = (motivos: MotivoRevisar[]): Set<CampoRevisar> => new Set(motivos.map((m) => m.campo));
