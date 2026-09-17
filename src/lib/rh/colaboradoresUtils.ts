// Leituras compartilhadas de EMPREGADOS: normalizações que a tela de
// Colaboradores (pages/rh/Colaboradores.tsx) e o Exportar Dados
// (components/rh/ExportarDados.tsx) precisam ler DA MESMA FORMA. Nasceram
// dentro da tela e saíram pra cá em 04/09/2026 — duas implementações da
// mesma regra de negócio já divergiram uma vez neste módulo (o select de
// contrato do modo manual de vaga lia a coluna errada), então esta é a
// fonte única.

// Empresas do grupo (código numérico da coluna "Empresa" → nome curto).
export const EMPRESA_MAP: Record<string, string> = { "1": "HAGG", "2": "SN", "3": "CANAÃ", "5": "NH" };

export const empresaDe = (e: any): string => {
  const code = String(e?.["Empresa"] ?? "").trim();
  if (EMPRESA_MAP[code]) return EMPRESA_MAP[code];
  const nome = String(e?.["Nome da Empresa"] ?? "").toUpperCase();
  if (nome.includes("HAGG")) return "HAGG";
  if (nome.includes("CANA")) return "CANAÃ";
  if (/\bNH\b/.test(nome)) return "NH";
  if (/\bSN\b/.test(nome)) return "SN";
  return String(e?.["Nome da Empresa"] ?? "").trim() || "—";
};

// "Valor Salário" vem como texto pt-BR ("2.002,6900") — normaliza para número.
export const parseSalario = (v: any): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  let s = String(v).trim().replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

// Datas: aceita "DD/MM/AAAA", ISO ou Date.
// Ano anterior a 1900 é o "vazio" do sistema legado (30/12/1899 = serial 0 do
// Excel), não uma data real — vale como SEM data.
export const parseData = (v: any): Date | null => {
  if (!v) return null;
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  // ISO só com a data ("2026-08-26"): o `new Date` lê como UTC e, no Brasil,
  // vira 25/08 às 21h — dia errado na tela e no banco. Monta como data local.
  const iso = !br && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = br ? new Date(+br[3], +br[2] - 1, +br[1]) : iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : new Date(s);
  return isNaN(d.getTime()) || d.getFullYear() < 1900 ? null : d;
};
export const fmtData = (v: any) => { const d = parseData(v); return d ? d.toLocaleDateString("pt-BR") : "—"; };

/**
 * Data de EMPREGADOS pronta para uma coluna `date` do Postgres ("AAAA-MM-DD").
 *
 * "Admissão" (como "Nascimento") vem em DOIS formatos: ISO na maioria e
 * "DD/MM/AAAA" numa minoria (105 de 2.217 Trabalhando em 17/09/2026). Mandar
 * a string crua pro banco estourava `date/time field value out of range:
 * "26/08/2026"` na Solicitação de Demissão — e o `brToISO` que Férias usava
 * fazia o inverso: devolvia NULL para quem estava em ISO. Um conversor só,
 * que aceita os dois e devolve NULL para vazio/inválido/ano < 1900.
 */
export const dataParaIso = (v: unknown): string | null => {
  const d = parseData(v);
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const ehSaidaDe = (e: any) => /DEMIT|DESLIG|RESCIS|APOSENT/i.test(String(e?.["Situação"] ?? ""));

// O cargo exibido vem de "Título do Cargo" (texto oficial da folha, igual ao
// resto do sistema: Recrutamento, Processos, Solicitações etc.). "Nome do
// Cargo" (mapeado por código na tabela CARGOS) é só fallback — evita "Sem
// cargo"/"AMBÍGUO" quando o código não está casado.
export const nomeCargoDe = (e: any): string =>
  String(e?.["Título do Cargo"] ?? "").trim() || String(e?.["Nome do Cargo"] ?? "").trim() || "—";

// O CONTRATO de uma pessoa é a FILIAL do Senior, com o código na frente:
// "1109 - POLICIA CIVIL RS LIMPEZA 066.2026". Desde 11/09/2026 a coluna
// "Nome Filial" já vem assim do banco (migration 20260930000089: a função
// de enriquecimento grava com código e um trigger prefixa o que chegar sem)
// — aqui só se garante o formato para linha que ainda não passou por lá.
//
// NÃO é "Descrição do Local". Essa coluna é o POSTO do organograma
// ("1109 - PALÁCIO DA POLÍCIA", "1109 - DECA"...): um contrato tem dezenas
// de postos, e a Solicitação de Demissão passou 10 dias gravando o posto
// na coluna `contrato` por ler ela. No espelho do Senior:
// BiFilial.apelido = contrato, BiOrganogramas.descricao_local = posto.
const PREFIXO_CODIGO = /^\s*\d+\s*-\s*/;

export const nomeContratoDe = (e: any): string => {
  const codigo = String(e?.["Filial"] ?? "").trim();
  const nome = String(e?.["Nome Filial"] ?? "").trim();
  if (!nome) return codigo;
  if (!codigo || PREFIXO_CODIGO.test(nome)) return nome;
  return `${codigo} - ${nome}`;
};

// O nome sem o código, para comparar com CONTRATOS."NOME CONTRATO" — que
// não leva código, só o nome ("POLICIA CIVIL RS LIMPEZA 066.2026").
export const semCodigoFilial = (nome: unknown): string =>
  String(nome ?? "").replace(PREFIXO_CODIGO, "").trim();

/**
 * "2 anos e 3 meses" desde a admissão — a ficha do advertido mostra isso ao
 * lado da data (17/09/2026). Menos de um mês vira "menos de 1 mês"; sem
 * admissão (ou admissão no futuro) devolve "".
 */
export const tempoDeEmpresa = (admissao: unknown, hoje: Date = new Date()): string => {
  const d = parseData(admissao);
  if (!d || d > hoje) return "";
  let meses = (hoje.getFullYear() - d.getFullYear()) * 12 + (hoje.getMonth() - d.getMonth());
  if (hoje.getDate() < d.getDate()) meses -= 1;
  if (meses < 1) return "menos de 1 mês";
  const anos = Math.floor(meses / 12), resto = meses % 12;
  const pa = anos ? `${anos} ano${anos > 1 ? "s" : ""}` : "";
  const pm = resto ? `${resto} ${resto > 1 ? "meses" : "mês"}` : "";
  return [pa, pm].filter(Boolean).join(" e ");
};
