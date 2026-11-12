// =====================================================================
// LIMITE DE TAMANHO DE ANEXO — conferido ANTES de enviar (03/11/2026)
//
// Regra do Eduardo (item 10): 10 MB por padrão, 25 MB para documentos e
// currículos. O banco é quem garante (storage.buckets.file_size_limit,
// migration 20261103009300 — o Storage responde 413 acima do limite); aqui é
// a mesma regra conferida no navegador, por dois motivos:
//   1. não subir 90 MB pela rede da empresa para só no fim ouvir "não";
//   2. a recusa do Storage vem em inglês ("The object exceeded the maximum
//      allowed size"); a daqui diz o nome do arquivo, o tamanho e o limite.
//
// A tabela abaixo é o file_size_limit de cada bucket DEPOIS da migration.
// Bucket novo sem linha aqui cai no PADRÃO (10 MB) — o mesmo que a migration
// aplica a bucket criado sem limite. Mudou o limite no banco? Mude aqui.
// =====================================================================

const MB = 1024 * 1024;
export const LIMITE_PADRAO_MB = 10;

export const LIMITE_POR_BUCKET_MB: Record<string, number> = {
  "anexos": 25, "avatars": 10, "avisos-anexos": 5, "bi-capas": 10, "caepi": 25,
  "cartao-classificacao-anexos": 25, "cartao-faturas": 25, "cartao-logos": 10, "chamados-sistemas": 20,
  "checklist-faturamento-anexos": 25, "colaboradores-fotos": 10,
  "conciliacao-fluxo-caixa": 10, "concord": 25, "convencoes-coletivas": 25,
  "copiloto-audios": 10, "cotacoes-arquivos": 10, "cs-formularios": 25,
  "cs-veiculos": 25, "curriculos": 25, "debito-automatico-anexos": 20,
  "demissoes-docs": 10, "denuncia-evidencias": 25, "diarias": 10, "doc-canaa": 20,
  "extrator-beneficios": 25, "faturamento-justificativa-anexos": 25, "fcr-uploads": 25, "grade-atas": 10, "hora-extra": 10,
  "identidade-visual": 10, "integration-uploads": 10, "juridico-comprovantes": 25,
  "juridico-docs": 25, "juridico-notificacoes": 25, "malote-anexos": 25,
  "migracao-zero": 25, "nf-emissao": 25, "nfe-xml": 10, "org-processos": 20,
  "ponto-encarregados": 20, "pre-titulos-fiscal": 25, "Recrutamento": 10,
  "reembolsos": 20, "reunioes": 25, "rh-documentos": 20, "rh-rateio": 20,
  "sistema-solicitacoes": 25, "solicitacoes-ajuste-anexos": 25,
  "solicitacoes-anexos": 25, "sup-comprovacoes": 10, "sup-crachas": 10,
  "sup-patrimonio": 10, "sup-solicitacoes-manutencao": 5, "sup-veiculo-foto": 10,
  "ti-ativos": 20, "whatsapp-midia": 25,
  // Vídeo de treinamento/TV: fora da regra de 10/25 MB até decisão do
  // Eduardo (docs/infra/limite-de-anexo.md) — há aulas de 67 e 243 MB no ar.
  "treinamentos": 200, "trn-midia": 500, "tv-midia": 200,
};

export function limiteDoBucketMb(bucket: string): number {
  return LIMITE_POR_BUCKET_MB[bucket] ?? LIMITE_PADRAO_MB;
}

const fmtMb = (bytes: number) => `${(bytes / MB).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

/** Tamanho do corpo do upload, quando dá para saber (File/Blob/ArrayBuffer). */
function tamanhoDe(corpo: unknown): number | null {
  if (corpo && typeof corpo === "object") {
    if ("size" in corpo && typeof (corpo as Blob).size === "number") return (corpo as Blob).size;
    if ("byteLength" in corpo && typeof (corpo as ArrayBuffer).byteLength === "number") return (corpo as ArrayBuffer).byteLength;
  }
  return null;
}

/** Mensagem de recusa, ou null se o arquivo cabe. */
export function conferirTamanho(bucket: string, corpo: unknown, nome?: string): string | null {
  const tam = tamanhoDe(corpo);
  if (tam === null) return null;
  const limite = limiteDoBucketMb(bucket);
  if (tam <= limite * MB) return null;
  const quem = nome || (corpo as File)?.name || "O arquivo";
  return `${quem} tem ${fmtMb(tam)} e o limite deste anexo é ${limite} MB. Reduza o arquivo (PDF comprimido, foto em resolução menor) ou divida em partes.`;
}

/**
 * Instala a conferência em supabase.storage.from(bucket).upload/update —
 * os 63 pontos de upload do ERP passam por aqui sem mudar uma linha.
 * Recusa do jeito que o supabase-js já devolve erro ({ data: null, error }),
 * então cada tela mostra a mensagem no toast que já tem.
 */
export function limitarUploads(storage: { from: (bucket: string) => any }) {
  const fromOriginal = storage.from.bind(storage);
  storage.from = (bucket: string) => {
    const api = fromOriginal(bucket);
    for (const metodo of ["upload", "update"] as const) {
      const original = api[metodo]?.bind(api);
      if (!original) continue;
      api[metodo] = async (caminho: string, corpo: unknown, opcoes?: unknown) => {
        const recusa = conferirTamanho(bucket, corpo);
        if (recusa) return { data: null, error: Object.assign(new Error(recusa), { name: "ArquivoGrandeDemais", statusCode: "413" }) };
        return original(caminho, corpo, opcoes);
      };
    }
    return api;
  };
}
