// Contrato ↔ município dos processos trabalhistas. Saiu de Processos.tsx em
// 17/09/2026 só para o arquivo da tela exportar apenas o componente (regra
// react-refresh/only-export-components) — a lógica e os comentários são os
// mesmos; os testes em src/test/juridico-sugerir-contrato.test.ts cobrem.
import { MUNICIPIOS_POR_UF } from "@/data/municipios-brasil";


// ── Contrato a partir do município ─────────────────────────────────
// Os nomes em CONTRATOS."NOME CONTRATO" quase sempre começam pela cidade
// ("CHARQUEADAS - 005.2021", "BENTO GONÇALVES - LIMPEZA - 048.2026"), então
// dá para sugerir o contrato a partir do município digitado. É sugestão: o
// campo continua editável, e a mesma cidade pode ter vários contratos.
const semAcento = (s: string) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const PALAVRA_CURTA = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "-"]);
const tokens = (s: string) => semAcento(s).split(/[^A-Z0-9]+/).filter(t => t.length > 1 && !PALAVRA_CURTA.has(t));

// O número do contrato ("062/2025", "95.2026") não identifica nada: é o que
// sobra depois dele que diz de qual contrato se trata.
const tokensNome = (s: string) => tokens(s).filter(t => !/^\d+$/.test(t));

// Pontua o quanto um nome de contrato "casa" com o texto do município.
//
// O campo guarda duas coisas na prática: cidade ("CHARQUEADAS") e descrição de
// posto ("UFRGS - JARDINAGEM CAMPUS SAUDE TRI"). Por isso a comparação olha
// nos DOIS sentidos e fica com o mais forte:
//   • quanto do MUNICÍPIO aparece no contrato — resolve "RIO GRANDE" →
//     "CAMARA DE RIO GRANDE-LIMPEZA";
//   • quanto do CONTRATO é explicado pelo município — resolve
//     "UFRGS - JARDINAGEM CAMPUS SAUDE TRI" → "UFRGS - JARDINAGEM - 062/2025",
//     que só ganha das outras 9 linhas da UFRGS porque é a única cujo nome
//     inteiro (UFRGS + JARDINAGEM) está no texto.
// Exigir os dois lados altos rejeitaria o primeiro caso; exigir só um lado
// baixo aceitaria "SANTA MARIA" como "SANTA CRUZ".
function pontuarContrato(municipio: string, nomeContrato: string): number {
  const m = semAcento(municipio), c = semAcento(nomeContrato);
  if (!m || !c) return 0;
  // Sem nenhuma palavra significativa não há o que casar. Fica ANTES das
  // comparações de texto: "DE" casaria por substring com "CAMARA DE RIO
  // GRANDE" e sugeriria um contrato sem nada a ver.
  const tm = tokensNome(municipio), tc = tokensNome(nomeContrato);
  if (!tm.length || !tc.length) return 0;
  if (c === m) return 1000;
  if (c.startsWith(m)) return 900 - c.length / 100;     // prefixo: o mais curto ganha
  if (c.includes(m)) return 800 - c.length / 100;

  const sm = new Set(tm), sc = new Set(tc);
  const covMunicipio = [...sm].filter(t => sc.has(t)).length / sm.size;
  const covContrato  = [...sc].filter(t => sm.has(t)).length / sc.size;
  const forte = Math.max(covMunicipio, covContrato);
  if (forte < 0.6) return 0;
  // Cobertura forte manda; a outra desempata; nome curto desempata por último.
  return forte * 500 + Math.min(covMunicipio, covContrato) * 100 - c.length / 100;
}

export function sugerirContrato(municipio: string, contratos: string[]): string {
  let melhor = "", pontos = 0;
  for (const c of contratos) {
    const p = pontuarContrato(municipio, c);
    if (p > pontos) { pontos = p; melhor = c; }
  }
  return pontos > 0 ? melhor : "";
}

// ── Município a partir do contrato ─────────────────────────────────
// O caminho inverso do de cima, e o que a tela usa hoje: o contrato vem da
// Sênior (CONTRATOS) e o município tem que ser a cidade DAQUELE contrato.
//
// A CONTRATOS não tem coluna de cidade — só "Endereço" (logradouro) e "CEP" —,
// então a cidade sai do próprio nome do contrato, casando-o contra a lista de
// municípios do IBGE. Quando nada casa, o campo fica em branco e a validação do
// Salvar cobra o preenchimento (é obrigatório).
const partesNome = (s: string) => semAcento(s).split(/[^A-Z0-9']+/).filter(Boolean);

// Índice nome-normalizado → nome com acento. Ignora nomes com menos de 4 letras
// ("Ipê", "Iuiú"): curtos demais para casar sem falso positivo. Montado uma vez.
let MUN_IDX: Map<string, string> | null = null;
function municipiosIndexados(): Map<string, string> {
  if (!MUN_IDX) {
    MUN_IDX = new Map();
    for (const lista of Object.values(MUNICIPIOS_POR_UF))
      for (const nome of lista) {
        const chave = partesNome(nome).join(" ");
        if (chave.replace(/[^A-Z]/g, "").length >= 4 && !MUN_IDX.has(chave)) MUN_IDX.set(chave, nome);
      }
  }
  return MUN_IDX;
}

/**
 * Procura um município dentro do nome do contrato, do trecho mais longo para o
 * mais curto ("SALTO DO JACUI" antes de "SALTO").
 *
 * `noInicio` diz se a cidade ABRE o nome ("CAXIAS DO SUL - 2026/95"). Só nesse
 * caso a tela preenche o município sozinha: aí a cidade é a identidade do
 * contrato, e nos 57 contratos ativos os 8 casos assim estão todos certos.
 * Casado no meio do nome, vira sugestão de um clique — acerta "UFFS CHAPECO" e
 * "HUSM SANTA MARIA", mas também tira "Saúde" (município de SC) de "UFRGS -
 * AUXILIAR DE SAÚDE BUCAL". Gravar esse chute sozinho seria erro silencioso:
 * ninguém desconfia de campo já preenchido.
 */
export function cidadeDoContrato(nomeContrato: string): { cidade: string; noInicio: boolean } {
  const idx = municipiosIndexados();
  const t = partesNome(nomeContrato);
  for (let n = Math.min(5, t.length); n >= 1; n--)
    for (let i = 0; i + n <= t.length; i++) {
      const m = idx.get(t.slice(i, i + n).join(" "));
      if (m) return { cidade: m, noInicio: i === 0 };
    }
  return { cidade: "", noInicio: false };
}

