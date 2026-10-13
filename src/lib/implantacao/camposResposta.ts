/**
 * Controles especiais definidos pela planilha de ajustes da Implantação.
 *
 * A chave continua sendo `checklist_items.row_index`: textos do checklist já
 * mudaram no passado e não são uma chave estável. Os parsers aceitam também
 * respostas antigas em texto livre para a mudança não apagar histórico.
 */

export type OpcaoSimNao = "Sim" | "Não" | "N/A";

export const ROW_INDEX_SIM_NAO_DETALHE: ReadonlySet<number> = new Set([
  20, // Exposição a agentes
  21, // Contato com pacientes/resíduos
  23, // Vacinação específica
  24, // Prazo envio ASOs
  26, // Exames complementares
  30, // Atividades especiais
]);

export const OPCOES_FORMA_ENVIO = ["E-mail", "1DOC", "SEI", "Sistema interno"] as const;
export const OPCOES_EMISSAO_NOTA = ["Cidade", "Secretaria", "Posto"] as const;

export interface RespostaSimNaoDetalhe {
  opcao: OpcaoSimNao | "";
  detalhe: string;
}

function ehOpcaoSimNao(valor: unknown): valor is OpcaoSimNao {
  return valor === "Sim" || valor === "Não" || valor === "N/A";
}

export function lerLista(valor: string): string[] {
  if (!valor.trim()) return [];
  try {
    const parsed = JSON.parse(valor);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  } catch {
    // Resposta legada em texto: preserva como uma seleção única.
  }
  return [valor.trim()];
}

export function salvarLista(valores: string[]): string {
  const unicos = [...new Set(valores.map((v) => v.trim()).filter(Boolean))];
  return unicos.length ? JSON.stringify(unicos) : "";
}

export function lerSimNaoDetalhe(valor: string): RespostaSimNaoDetalhe {
  if (!valor.trim()) return { opcao: "", detalhe: "" };
  try {
    const parsed = JSON.parse(valor) as { opcao?: unknown; detalhe?: unknown };
    if (ehOpcaoSimNao(parsed.opcao)) {
      return {
        opcao: parsed.opcao,
        detalhe: typeof parsed.detalhe === "string" ? parsed.detalhe : "",
      };
    }
  } catch {
    // Continua abaixo para respostas gravadas antes do controle estruturado.
  }

  const legado = valor.match(/^(Sim|Não|N\/A)(?:\s*[—:-]\s*(.*))?$/i);
  if (!legado) return { opcao: "", detalhe: valor };
  const normalizada: OpcaoSimNao =
    legado[1].toLowerCase() === "sim" ? "Sim" :
    legado[1].toLowerCase() === "não" ? "Não" : "N/A";
  return { opcao: normalizada, detalhe: legado[2]?.trim() ?? "" };
}

export function salvarSimNaoDetalhe(opcao: OpcaoSimNao | "", detalhe: string): string {
  if (!opcao) return "";
  return JSON.stringify({ opcao, detalhe: opcao === "Sim" ? detalhe.trim() : "" });
}

export function lerListaComOutro(
  valor: string,
  opcoes: readonly string[],
): { opcao: string; outro: string } {
  const limpo = valor.trim();
  if (!limpo) return { opcao: "", outro: "" };
  if (opcoes.includes(limpo)) return { opcao: limpo, outro: "" };
  const outro = limpo.replace(/^Outro:\s*/i, "").trim();
  return { opcao: "Outro", outro };
}

export function salvarListaComOutro(opcao: string, outro: string): string {
  if (!opcao) return "";
  if (opcao !== "Outro") return opcao;
  const limpo = outro.trim();
  // Mantém o estado intermediário para o campo de texto aparecer; a tela
  // impede salvar enquanto o complemento estiver vazio.
  return limpo ? `Outro: ${limpo}` : "Outro:";
}

/** Texto curto mostrado quando a linha está recolhida. */
export function resumoResposta(rowIndex: number, valor: string): string {
  if (!valor) return "";
  if (rowIndex === 8 || rowIndex === 22) return lerLista(valor).join(", ");
  if (ROW_INDEX_SIM_NAO_DETALHE.has(rowIndex)) {
    const { opcao, detalhe } = lerSimNaoDetalhe(valor);
    if (!opcao) return detalhe || valor;
    return detalhe ? `${opcao} — ${detalhe}` : opcao;
  }
  return valor;
}
