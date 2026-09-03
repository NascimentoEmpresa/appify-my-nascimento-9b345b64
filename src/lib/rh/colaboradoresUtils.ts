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
  const d = br ? new Date(+br[3], +br[2] - 1, +br[1]) : new Date(s);
  return isNaN(d.getTime()) || d.getFullYear() < 1900 ? null : d;
};
export const fmtData = (v: any) => { const d = parseData(v); return d ? d.toLocaleDateString("pt-BR") : "—"; };

export const ehSaidaDe = (e: any) => /DEMIT|DESLIG|RESCIS|APOSENT/i.test(String(e?.["Situação"] ?? ""));

// O cargo exibido vem de "Título do Cargo" (texto oficial da folha, igual ao
// resto do sistema: Recrutamento, Processos, Solicitações etc.). "Nome do
// Cargo" (mapeado por código na tabela CARGOS) é só fallback — evita "Sem
// cargo"/"AMBÍGUO" quando o código não está casado.
export const nomeCargoDe = (e: any): string =>
  String(e?.["Título do Cargo"] ?? "").trim() || String(e?.["Nome do Cargo"] ?? "").trim() || "—";
