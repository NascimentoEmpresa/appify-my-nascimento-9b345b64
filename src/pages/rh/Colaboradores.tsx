import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import ImportarColaboradores from "@/components/rh/ImportarColaboradores";
import IntegrarCargos from "@/components/rh/IntegrarCargos";
import CarregandoLogo from "@/components/ui/CarregandoLogo";
import { useScreenAccess } from "@/hooks/useScreenAccess";

// =========================================================================
// RH — Colaboradores (fonte: tabela EMPREGADOS, read-only + edição de campos RH)
// Filtros: empresa / contrato / situação (padrão "Trabalhando") + busca.
// Dashboard ao vivo (refiltra junto): headcount, folha, admissões/desligamentos,
// tempo de casa, ativos por cargo.
// Cargo = "Título do Cargo" (texto oficial da folha, igual ao resto do sistema:
// Recrutamento, Processos, Solicitações etc.). O antigo seletor por código da
// tabela CARGOS foi removido do modal — ele deixava "Sem cargo"/"AMBÍGUO"
// quando o código não estava casado.
// =========================================================================

// Empresas do grupo (código numérico da coluna "Empresa" → nome curto).
const EMPRESA_MAP: Record<string, string> = { "1": "HAGG", "2": "SN", "3": "CANAÃ", "5": "NH" };
const empresaDe = (e: any): string => {
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
const parseSalario = (v: any): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  let s = String(v).trim().replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};
const money = (n: number) => "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyK = (n: number) => n >= 1000 ? "R$ " + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k" : money(n);

// Navegador de competência (mês).
const MESES_ABREV = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const pad2 = (n: number) => String(n).padStart(2, "0");

// Datas: aceita "DD/MM/AAAA", ISO ou Date.
// Ano anterior a 1900 é o "vazio" do sistema legado (30/12/1899 = serial 0 do
// Excel), não uma data real — vale como SEM data.
const parseData = (v: any): Date | null => {
  if (!v) return null;
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const d = br ? new Date(+br[3], +br[2] - 1, +br[1]) : new Date(s);
  return isNaN(d.getTime()) || d.getFullYear() < 1900 ? null : d;
};
const fmtData = (v: any) => { const d = parseData(v); return d ? d.toLocaleDateString("pt-BR") : "—"; };
const anoDe = (v: any) => parseData(v)?.getFullYear() ?? null;
const anosDeCasa = (v: any): number | null => {
  const d = parseData(v); if (!d) return null;
  return Math.max(0, (Date.now() - d.getTime()) / (365.25 * 864e5));
};
const ehTrabalhando = (e: any) => String(e?.["Situação"] ?? "").trim().toUpperCase().startsWith("TRABALH");
// O cargo exibido vem de "Título do Cargo" (texto oficial da folha, igual ao
// resto do sistema). "Nome do Cargo" (mapeado por código na tabela CARGOS) é
// só fallback — evita "Sem cargo"/"AMBÍGUO" quando o código não está casado.
const nomeCargoDe = (e: any): string => String(e?.["Título do Cargo"] ?? "").trim() || String(e?.["Nome do Cargo"] ?? "").trim() || "—";

// Cascata de fallback: "Empresa" já era conhecida por falhar em alguns
// ambientes (por isso o SAFE original não a tem). "Cargo" e "Nome do Cargo"
// precisam sobreviver a essa queda — por isso entram ANTES de "Empresa" ser
// descartada, não depois.
// "Contrato" NÃO entra: a coluna não existe na EMPREGADOS (o contrato sai da
// CONTRATOS pela Filial). Enquanto estava aqui, os dois primeiros recortes
// falhavam sempre e a tela ainda perdia "Empresa" junto no fallback.
const FULL = '"ID","Nome","CPF","Cargo","Título do Cargo","Nome do Cargo","Situação","Admissão","Data Afastamento","Valor Salário","Empresa","Nome da Empresa","Filial","Nome Filial","Setor_ERP","Perfil_ERP","LIDER","C.Custo","Titulo C.Custo","PIS","email","Descrição do Local"';
const SEM_NOME_CARGO_NOVO = '"ID","Nome","CPF","Cargo","Título do Cargo","Situação","Admissão","Data Afastamento","Valor Salário","Empresa","Nome da Empresa","Filial","Nome Filial","Setor_ERP","Perfil_ERP","LIDER","C.Custo","Titulo C.Custo","PIS","email","Descrição do Local"'; // sem "Nome do Cargo" (antes da migration)
const SAFE_COM_CARGO = '"ID","Nome","CPF","Cargo","Título do Cargo","Nome do Cargo","Situação","Admissão","Data Afastamento","Valor Salário","Nome da Empresa","Filial","Nome Filial","Setor_ERP","Perfil_ERP","LIDER","C.Custo","Titulo C.Custo","PIS","email","Descrição do Local"'; // sem Empresa/Contrato, mas com Cargo/Nome do Cargo
const SAFE_COM_CARGO_SEM_NOME = '"ID","Nome","CPF","Cargo","Título do Cargo","Situação","Admissão","Data Afastamento","Valor Salário","Nome da Empresa","Filial","Nome Filial","Setor_ERP","Perfil_ERP","LIDER","C.Custo","Titulo C.Custo","PIS","email","Descrição do Local"';
const SAFE = '"ID","Nome","CPF","Título do Cargo","Situação","Admissão","Data Afastamento","Valor Salário","Nome da Empresa","Filial","Nome Filial","Setor_ERP","Perfil_ERP","LIDER","C.Custo","Titulo C.Custo","PIS","email","Descrição do Local"'; // último recurso (sem Cargo)

const CHUNK = 1000;

// Cache de módulo: a tela inteira sai de um único carregamento de ~12 mil
// linhas. Sem isso, cada volta ao menu refazia tudo e a tela ficava vários
// segundos vazia. Quem já carregou uma vez na sessão vê os dados na hora e a
// atualização acontece por trás (stale-while-revalidate).
let cacheRows: any[] | null = null;
let cacheContratos: Record<string, string> = {};
let cacheSetores: string[] = [];
// Se o banco já tem as RPCs, não adianta testar de novo a cada visita.
let cacheModo: "rpc" | "client" | null = null;
// Último resultado com a tela "recém-aberta" (sem filtro, 1ª página, mês
// atual) — é exatamente o que a próxima visita mostra, então pinta na hora.
let cacheDash: any = null;
let cacheLista: any = null;

const PERFIS = ["PADRAO", "ENCARREGADO", "ADMINISTRATIVO", "DIRETORIA", "ADMIN"];
// Campos principais editáveis (coluna da EMPREGADOS → rótulo). Situação é tratada à parte (select).
// Cargo NÃO entra aqui: é um select próprio ligado à tabela CARGOS.
const MAIN_FIELDS: [string, string][] = [
  ["Nome", "Nome"],
  ["CPF", "CPF"],
  ["Admissão", "Admissão"],
  ["Data Afastamento", "Data de afastamento"],
  ["Valor Salário", "Salário"],
  ["PIS", "PIS/PASEP"],
  ["Nome da Empresa", "Empresa"],
  ["Nome Filial", "Filial"],
  // "Contrato" não entra: a coluna não existe na EMPREGADOS — o campo aparecia
  // vazio no modal e nunca salvava nada (o contrato vem da CONTRATOS/Filial).
  ["C.Custo", "Centro de custo"],
  ["email", "E-mail"],
];
const FAIXAS = [
  { label: "< 1 ano", min: 0, max: 1 },
  { label: "1–3 anos", min: 1, max: 3 },
  { label: "3–5 anos", min: 3, max: 5 },
  { label: "5–10 anos", min: 5, max: 10 },
  { label: "10+ anos", min: 10, max: Infinity },
];

function barRow(label: string, valor: number, max: number, cor: string, right: string) {
  const pct = max > 0 ? Math.round((valor / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: "#334155", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{label}</span>
        <span style={{ color: "#0f172a", fontWeight: 800 }}>{right}</span>
      </div>
      <div style={{ height: 8, background: "#eef2f7", borderRadius: 20, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: cor, borderRadius: 20 }} />
      </div>
    </div>
  );
}

// ── Formato dos dados da tela ─────────────────────────────────────────────
// É o mesmo shape que a RPC rh_colaboradores_dashboard devolve. Quando o SQL
// ainda não foi aplicado, `calcDashClient` produz esse mesmo objeto a partir
// das linhas — assim a tela não sabe (nem precisa saber) de onde veio.
type KV = { k: string; v: number };
type Dash = {
  kpis: { ativos_mes: number; no_recorte: number; total: number; folha: number; admitidos: number; desligados: number };
  por_empresa: KV[]; folha_empresa: KV[]; por_situacao: KV[]; por_cargo: KV[]; por_contrato: KV[];
  por_faixa: { label: string; n: number }[];
  timeline: { ano: number; adm: number; desl: number }[];
  opcoes: { empresas: string[]; contratos: string[]; situacoes: string[]; setores: string[] };
};
type Linha = {
  id: any; nome: string; cpf: string; cargo: string; empresa: string; contrato: string;
  filial: string; situacao: string; setor: string; admissao: string | null; salario: number;
};
type Filtro = { ini: Date; fim: Date; empresa: string; contrato: string; situacao: string; busca: string };

const DASH_VAZIO: Dash = {
  kpis: { ativos_mes: 0, no_recorte: 0, total: 0, folha: 0, admitidos: 0, desligados: 0 },
  por_empresa: [], folha_empresa: [], por_situacao: [], por_cargo: [], por_contrato: [],
  por_faixa: FAIXAS.map(f => ({ label: f.label, n: 0 })), timeline: [],
  opcoes: { empresas: [], contratos: [], situacoes: [], setores: [] },
};

const ehSaidaDe = (e: any) => /DEMIT|DESLIG|RESCIS|APOSENT/i.test(String(e?.["Situação"] ?? ""));

const linhaDe = (e: any, contratoDe: (e: any) => string): Linha => ({
  id: e["ID"], nome: String(e["Nome"] ?? ""), cpf: String(e["CPF"] ?? ""),
  cargo: nomeCargoDe(e), empresa: empresaDe(e), contrato: contratoDe(e),
  filial: String(e["Nome Filial"] ?? "").trim() || String(e["Filial"] ?? "").trim() || "—",
  situacao: String(e["Situação"] ?? "").trim(), setor: String(e["Setor_ERP"] ?? "").trim(),
  admissao: e["Admissão"] ?? null, salario: parseSalario(e["Valor Salário"]),
});

const agrupar = (arr: any[], keyFn: (e: any) => string, valFn?: (e: any) => number): KV[] => {
  const m = new Map<string, number>();
  for (const e of arr) { const k = keyFn(e) || "—"; m.set(k, (m.get(k) || 0) + (valFn ? valFn(e) : 1)); }
  return [...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
};

// Fallback (migration ainda não aplicada): os três recortes que a tela usa,
// exatamente como a RPC faz do lado do banco.
const recortesClient = (rows: any[], contratoDe: (e: any) => string, f: Filtro) => {
  const casaBusca = (e: any) => {
    if (!f.busca) return true;
    const q = f.busca.toLowerCase();
    return [e["Nome"], e["CPF"], e["Título do Cargo"], e["Nome do Cargo"], e["Nome Filial"], e["Setor_ERP"]]
      .some(x => String(x ?? "").toLowerCase().includes(q));
  };
  // Mesmo critério da RPC: admitido até o fim do mês e, para quem tem situação
  // de SAÍDA, afastamento do início do mês em diante. Saída sem data legível
  // fica de fora — senão demitido antigo aparece como presente em todo mês.
  const noMesQuadro = (e: any) => {
    const adm = parseData(e["Admissão"]);
    if (adm && adm.getTime() > f.fim.getTime()) return false;
    if (ehSaidaDe(e)) {
      const afa = parseData(e["Data Afastamento"]);
      if (!afa || afa.getTime() < f.ini.getTime()) return false;
    }
    return true;
  };
  const casaEmp = (e: any) => !f.empresa || empresaDe(e) === f.empresa;
  const casaCtr = (e: any) => !f.contrato || contratoDe(e) === f.contrato;

  const semsit = rows.filter(e => noMesQuadro(e) && casaEmp(e) && casaCtr(e) && casaBusca(e));
  // Filtrar por uma situação de SAÍDA = navegar TODOS com aquela situação
  // (consulta/edição do histórico), sem o recorte de presença no mês. O
  // dashboard usa `semsit`, então continua com a régua de presença.
  const ehSaidaSit = /DEMIT|DESLIG|RESCIS|APOSENT/i.test(f.situacao || "");
  const fil = ehSaidaSit
    ? rows.filter(e => casaEmp(e) && casaCtr(e) && casaBusca(e) && String(e["Situação"] ?? "").trim() === f.situacao)
    : semsit.filter(e => !f.situacao || String(e["Situação"] ?? "").trim() === f.situacao);
  const tempo = rows.filter(e => casaEmp(e) && casaCtr(e));
  return { fil, semsit, tempo };
};

const calcDashClient = (rows: any[], contratoDe: (e: any) => string, f: Filtro, rec: ReturnType<typeof recortesClient>): Dash => {
  const { fil, semsit, tempo } = rec;
  const noPeriodo = (v: any) => { const d = parseData(v); return !!d && d.getTime() >= f.ini.getTime() && d.getTime() <= f.fim.getTime(); };
  const anoAtual = new Date().getFullYear();
  const anos: Record<number, { adm: number; desl: number }> = {};
  for (const e of tempo) {
    const a = anoDe(e["Admissão"]); if (a) (anos[a] ??= { adm: 0, desl: 0 }).adm++;
    const d = ehSaidaDe(e) ? anoDe(e["Data Afastamento"]) : null; if (d) (anos[d] ??= { adm: 0, desl: 0 }).desl++;
  }
  const uniq = (arr: string[]) => [...new Set(arr)].filter(x => x && x !== "—").sort();

  return {
    kpis: {
      ativos_mes: semsit.length, no_recorte: fil.length, total: rows.length,
      folha: fil.reduce((s, e) => s + parseSalario(e["Valor Salário"]), 0),
      admitidos: tempo.filter(e => noPeriodo(e["Admissão"])).length,
      desligados: tempo.filter(e => ehSaidaDe(e) && noPeriodo(e["Data Afastamento"])).length,
    },
    por_empresa: agrupar(fil, empresaDe),
    folha_empresa: agrupar(fil, empresaDe, e => parseSalario(e["Valor Salário"])),
    por_situacao: agrupar(semsit, e => String(e["Situação"] ?? "").trim() || "—"),
    por_cargo: agrupar(semsit, nomeCargoDe),
    por_contrato: agrupar(fil, contratoDe).slice(0, 10),
    por_faixa: FAIXAS.map(x => ({
      label: x.label,
      n: fil.filter(e => { const a = anosDeCasa(e["Admissão"]); return a != null && a >= x.min && a < x.max; }).length,
    })),
    timeline: Object.entries(anos).map(([ano, v]) => ({ ano: +ano, ...v }))
      .filter(x => x.ano >= anoAtual - 6 && x.ano <= anoAtual).sort((a, b) => a.ano - b.ano),
    opcoes: {
      empresas: uniq(rows.map(empresaDe)),
      contratos: uniq(rows.map(contratoDe)),
      situacoes: uniq(rows.map(e => String(e["Situação"] ?? "").trim())),
      setores: uniq(rows.map(e => String(e["Setor_ERP"] ?? "").trim())),
    },
  };
};

export default function Colaboradores() {
  const [rows, setRows] = useState<any[]>(cacheRows ?? []);
  const [contratoPorFilial, setContratoPorFilial] = useState<Record<string, string>>(cacheContratos);
  const [loading, setLoading] = useState(!cacheRows && !cacheDash);
  const [erro, setErro] = useState<string | null>(null);

  const [setoresTabela, setSetoresTabela] = useState<string[]>(cacheSetores);
  const [atualizando, setAtualizando] = useState(false);
  // "rpc" = banco agrega e pagina (rápido); "client" = modo antigo, baixa tudo.
  const [modo, setModo] = useState<"rpc" | "client" | null>(cacheModo);
  const [dashRpc, setDashRpc] = useState<Dash | null>(cacheDash);
  const [listaRpc, setListaRpc] = useState<{ total: number; linhas: Linha[] } | null>(cacheLista);
  const [busca, setBusca] = useState("");
  // Busca aplicada: refiltrar 12 mil linhas a cada tecla travava a digitação.
  const [buscaQ, setBuscaQ] = useState("");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fContrato, setFContrato] = useState("");
  const [fSituacao, setFSituacao] = useState(""); // Situação = status atual; no quadro do mês começa em "Todas"
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50); // 50 (padrão) ou 100
  const [sitIdx, setSitIdx] = useState(0); // card rotativo de situação
  const hoje = new Date();
  const [mesRef, setMesRef] = useState<{ ano: number; mes: number }>({ ano: hoje.getFullYear(), mes: hoje.getMonth() }); // competência

  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; tipo: "ok" | "err" } | null>(null);
  const aviso = (msg: string, tipo: "ok" | "err" = "ok") => { setToast({ msg, tipo }); setTimeout(() => setToast(null), 3200); };

  // Um bloco da EMPREGADOS. O 1º pede o count junto (uma requisição a menos) e
  // é ele que descobre qual recorte de colunas o ambiente aceita.
  // Salário é opt-in. No modo RPC o corte é no banco (as duas RPCs são
  // SECURITY DEFINER, então tem que ser lá); aqui a tela deixa de reservar
  // espaço para uma coluna e dois cards que viriam vazios, e o modo client
  // deixa de pedir a coluna. Declarado no topo porque `semSalario`, logo
  // abaixo, já depende dele.
  const { data: verSalario } = useScreenAccess("colaboradores_ver_salario", "visualizar");

  /**
   * Tira "Valor Salário" da lista de colunas de quem não tem a permissão.
   *
   * O modo `client` lê a EMPREGADOS direto (as constantes FULL/SAFE acima),
   * então o corte feito nas RPCs não alcança este caminho. Recortar a coluna
   * no SELECT é melhor que escondê-la depois: o número não chega nem a
   * trafegar, e a policy da tabela — que é all-or-nothing por linha, não por
   * coluna — deixaria de qualquer forma.
   */
  const semSalario = (cols: string) =>
    verSalario ? cols : cols.replace('"Valor Salário",', "");

  const bloco = (cols: string, de: number, comCount = false) =>
    (supabase as any).from("EMPREGADOS")
      .select(semSalario(cols), comCount ? { count: "exact" } : undefined)
      .order("Nome", { ascending: true })
      .range(de, de + CHUNK - 1);

  // `silencioso` = já existe cache na tela; recarrega por trás, sem esvaziar.
  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    iniciar(); setErro(null);

    // Contratos (resolve o contrato pela Filial), setores e o 1º bloco da
    // EMPREGADOS saem JUNTOS. Antes era tudo em série - 13 blocos de mil, um
    // depois do outro, e a tela só aparecia no fim.
    // O `.then` aqui não é decorativo: o builder do supabase-js só dispara a
    // requisição quando alguém a "thena" — sem isso as duas só sairiam depois
    // do 1º bloco, em série de novo.
    const contratosP = (supabase as any).from("CONTRATOS").select('"NOME CONTRATO", Filial').eq("ATIVO", "SIM").then((r: any) => r);
    const setoresP = (supabase as any).from("SETORES").select("*").limit(2000).then((r: any) => r);

    let cols = FULL;
    let primeiro = await bloco(cols, 0, true);
    for (const alt of [SEM_NOME_CARGO_NOVO, SAFE_COM_CARGO, SAFE_COM_CARGO_SEM_NOME, SAFE]) {
      if (!primeiro.error) break;
      cols = alt; primeiro = await bloco(cols, 0, true);
    }
    if (primeiro.error) {
      setErro(primeiro.error.message || "Falha ao carregar EMPREGADOS.");
      if (!cacheRows) setRows([]);
      setLoading(false); terminar(); return;
    }

    // Sabendo o total, os blocos restantes vão todos de uma vez.
    const total = Math.min(primeiro.count ?? (primeiro.data?.length ?? 0), 200000);
    const faixas: number[] = [];
    for (let de = CHUNK; de < total; de += CHUNK) faixas.push(de);
    const [ct, st, ...partes] = await Promise.all([contratosP, setoresP, ...faixas.map(de => bloco(cols, de))]);

    const todos = (primeiro.data || []).concat(...partes.map((p: any) => p.data || []));
    cacheRows = todos; setRows(todos);

    if (ct.data) {
      const m: Record<string, string> = {};
      for (const c of ct.data) if (c.Filial != null) m[String(c.Filial)] = c["NOME CONTRATO"] || "";
      cacheContratos = m; setContratoPorFilial(m);
    }
    // Setores válidos (tabela SETORES, se existir). Cai pros valores reais da EMPREGADOS se não houver.
    if (!st.error && Array.isArray(st.data)) {
      const pick = (row: any) => {
        for (const k of Object.keys(row)) if (/setor|nome|descri/i.test(k) && typeof row[k] === "string" && row[k].trim()) return row[k].trim();
        for (const k of Object.keys(row)) if (typeof row[k] === "string" && row[k].trim()) return row[k].trim();
        return "";
      };
      const lista = [...new Set(st.data.map(pick).filter(Boolean) as string[])];
      cacheSetores = lista; setSetoresTabela(lista);
    }
    setLoading(false); terminar();
  };
  useEffect(() => { const t = setTimeout(() => setBuscaQ(busca), 180); return () => clearTimeout(t); }, [busca]);
  useEffect(() => { setPagina(1); }, [buscaQ, fEmpresa, fContrato, fSituacao, porPagina, mesRef]);

  // ── Caminho rápido: o banco entrega o dashboard e a página da lista ──
  const argsRpc = () => ({
    _ano: mesRef.ano, _mes: mesRef.mes + 1,
    _empresa: fEmpresa, _contrato: fContrato, _situacao: fSituacao, _busca: buscaQ,
  });
  // Migration ainda não aplicada neste banco → cai no modo antigo em vez de
  // mostrar erro (a `main` em produção pode rodar sem o SQL por um tempo).
  const semRpc = (e: any) => !!e && (e.code === "42883" || e.code === "PGRST202"
    || /does not exist|could not find the function|schema cache/i.test(String(e.message || "")));

  // Clicar numa situação e depois noutra deixa duas consultas no ar. Sem um
  // carimbo de ordem, a que voltar por último manda — mesmo sendo a antiga —
  // e os painéis passam a mostrar o filtro anterior. Só a mais recente aplica.
  const pedidoDash = useRef(0);
  const pedidoLista = useRef(0);

  // Consultas em voo (dashboard e lista são independentes): o véu de
  // carregamento só sai quando as duas terminam.
  const emVoo = useRef(0);
  const iniciar = () => { emVoo.current++; setAtualizando(true); };
  const terminar = () => { emVoo.current = Math.max(0, emVoo.current - 1); if (!emVoo.current) setAtualizando(false); };

  const ehPadrao = () => !fEmpresa && !fContrato && !fSituacao && !buscaQ && pagina === 1 && porPagina === 50
    && mesRef.ano === hoje.getFullYear() && mesRef.mes === hoje.getMonth();

  // Dashboard e lista são consultas independentes: trocar de página não
  // recalcula os painéis (que não mudam), só busca as 50 linhas novas.
  const buscarDash = async (): Promise<boolean> => {
    const meu = ++pedidoDash.current;
    iniciar();
    const d = await (supabase as any).rpc("rh_colaboradores_dashboard", argsRpc());
    terminar();
    if (semRpc(d.error)) return false;
    if (meu !== pedidoDash.current) return true;   // resposta atrasada: descarta
    if (d.error) { setErro(d.error.message); return true; }
    setDashRpc(d.data as Dash); setErro(null);
    if (ehPadrao()) cacheDash = d.data;
    return true;
  };

  const buscarLista = async (): Promise<boolean> => {
    const meu = ++pedidoLista.current;
    iniciar();
    const l = await (supabase as any).rpc("rh_colaboradores_lista", { ...argsRpc(), _offset: (pagina - 1) * porPagina, _limite: porPagina });
    terminar();
    if (semRpc(l.error)) return false;
    if (meu !== pedidoLista.current) return true;
    if (l.error) { setErro(l.error.message); return true; }
    const lista = { total: Number(l.data?.total ?? 0), linhas: (l.data?.linhas ?? []) as Linha[] };
    setListaRpc(lista);
    if (ehPadrao()) cacheLista = lista;
    return true;
  };

  const buscarRpc = async () => { await Promise.all([buscarDash(), buscarLista()]); };

  // Painéis: só filtros e competência mexem neles.
  useEffect(() => {
    if (modo === "client") return;
    let vivo = true;
    (async () => {
      const ok = await buscarDash();
      if (!vivo) return;
      cacheModo = ok ? "rpc" : "client";
      setModo(cacheModo);
      if (ok) setLoading(false);
    })();
    return () => { vivo = false; };
  }, [modo, mesRef, fEmpresa, fContrato, fSituacao, buscaQ]);

  // O véu só aparece se a consulta passar de ~250ms: com o banco respondendo
  // em milissegundos, mostrar sempre viraria um piscar a cada clique.
  const [veu, setVeu] = useState(false);
  useEffect(() => {
    if (!atualizando) { setVeu(false); return; }
    const t = setTimeout(() => setVeu(true), 250);
    return () => clearTimeout(t);
  }, [atualizando]);

  // Lista: filtros + paginação.
  useEffect(() => {
    if (modo !== "rpc") return;
    buscarLista();
  }, [modo, mesRef, fEmpresa, fContrato, fSituacao, buscaQ, pagina, porPagina]);

  // Modo antigo: baixa a tabela inteira uma vez e calcula tudo aqui.
  useEffect(() => { if (modo === "client") load(!!cacheRows); }, [modo]);

  const recarregar = () => { if (modo === "client") load(true); else buscarRpc(); };

  // O contrato do colaborador sai da CONTRATOS, casado pela Filial.
  const contratoDe = (e: any): string => contratoPorFilial[String(e?.["Filial"] ?? "")] || "—";

  // ── Competência (quadro do mês) ──────────────────────────────────────
  // "Estava na empresa no mês": admitido até o fim do mês. A "Data Afastamento"
  // NÃO é só demissão (a folha a preenche em férias/atestado/licença e até em
  // quem segue Trabalhando), então ela só serve de corte para quem REALMENTE
  // saiu (Situação = Demitido/Desligado/Rescisão/Aposentadoria): aí a pessoa
  // aparece só nos meses até a saída. Sem data não exclui (não perde cadastro).
  const inicioMes = useMemo(() => new Date(mesRef.ano, mesRef.mes, 1), [mesRef]);
  const fimMes = useMemo(() => new Date(mesRef.ano, mesRef.mes + 1, 0, 23, 59, 59, 999), [mesRef]);
  const irMes = (delta: number) => setMesRef(m => { const d = new Date(m.ano, m.mes + delta, 1); return { ano: d.getFullYear(), mes: d.getMonth() }; });
  const ehMesAtual = mesRef.ano === hoje.getFullYear() && mesRef.mes === hoje.getMonth();

  // ── Números da tela ──────────────────────────────────────────────────
  // No modo RPC vêm prontos do banco; no fallback são calculados aqui no mesmo
  // formato. Daqui pra baixo a tela não sabe (nem precisa saber) a origem.
  const filtro = useMemo<Filtro>(() => ({ ini: inicioMes, fim: fimMes, empresa: fEmpresa, contrato: fContrato, situacao: fSituacao, busca: buscaQ }),
    [inicioMes, fimMes, fEmpresa, fContrato, fSituacao, buscaQ]);
  const recClient = useMemo(() => modo === "client" ? recortesClient(rows, contratoDe, filtro) : null,
    [modo, rows, contratoPorFilial, filtro]);
  const dashClient = useMemo(() => recClient ? calcDashClient(rows, contratoDe, filtro, recClient) : null,
    [recClient, rows, contratoPorFilial, filtro]);
  const dash = (modo === "rpc" ? dashRpc : dashClient) ?? DASH_VAZIO;

  const empresas = dash.opcoes.empresas;
  const contratos = dash.opcoes.contratos;
  const situacoes = dash.opcoes.situacoes;
  // opções de Setor: tabela SETORES ∪ valores reais da EMPREGADOS, sempre com PADRAO.
  const setorOptions = useMemo(() => [...new Set(["PADRAO", ...setoresTabela, ...dash.opcoes.setores])].sort(), [setoresTabela, dash]);

  const folhaTotal = dash.kpis.folha;
  const salarioMedio = dash.kpis.no_recorte ? folhaTotal / dash.kpis.no_recorte : 0;
  // "Ativos no mês" = presença pelas datas (não depende da Situação atual, que só
  // reflete o status de hoje). É o número que se mantém estável mês a mês.
  const ativosNoMes = dash.kpis.ativos_mes;
  const admitidosMes = dash.kpis.admitidos;
  // desligados = saída de verdade (Situação) com Data Afastamento no mês (a data
  // sozinha não vale: também marca férias/atestado/licença).
  const desligadosMes = dash.kpis.desligados;
  const porEmpresa = dash.por_empresa;
  const porSituacao = dash.por_situacao;
  const porContrato = dash.por_contrato;
  // card rotativo: passa por cada situação a cada 3s (movimento leve).
  useEffect(() => {
    if (porSituacao.length <= 1) return;
    const t = setInterval(() => setSitIdx(i => (i + 1) % porSituacao.length), 3000);
    return () => clearInterval(t);
  }, [porSituacao.length]);
  const sitAtual = porSituacao.length ? porSituacao[sitIdx % porSituacao.length] : null;
  const corSituacao = (s: string) => { const u = (s || "").toUpperCase(); return u.startsWith("TRABALH") ? "#15803d" : u.includes("FÉRIAS") || u.includes("FERIAS") ? "#2563eb" : u.includes("AFAST") || u.includes("LICEN") ? "#d97706" : u.includes("DEMIT") || u.includes("DESLIG") ? "#dc2626" : "#7c3aed"; };
  const folhaPorEmpresa = dash.folha_empresa;
  // presença no mês por cargo (não usa Situação atual, que só vale para hoje).
  const ativosPorCargo = dash.por_cargo;
  const porFaixa = dash.por_faixa;
  const timeline = dash.timeline;
  const maxTl = Math.max(1, ...timeline.flatMap(t => [t.adm, t.desl]));

  // paginação: no modo RPC a página já vem pronta do banco.
  const totalFiltrado = modo === "rpc" ? (listaRpc?.total ?? 0) : (recClient?.fil.length ?? 0);
  const totalGeral = dash.kpis.total;
  const totalPag = Math.max(1, Math.ceil(totalFiltrado / porPagina));
  const visiveis: Linha[] = useMemo(() => modo === "rpc"
    ? (listaRpc?.linhas ?? [])
    : (recClient?.fil ?? []).slice((pagina - 1) * porPagina, pagina * porPagina).map(e => linhaDe(e, contratoDe)),
    [modo, listaRpc, recClient, pagina, porPagina, contratoPorFilial]);

  const limparFiltros = () => { setBusca(""); setFEmpresa(""); setFContrato(""); setFSituacao(""); };

  // ── Edição de campos RH na EMPREGADOS ────────────────────────────────
  // A lista traz só o necessário p/ a tabela; o cadastro completo (PIS, e-mail,
  // centro de custo…) é buscado ao abrir o modal.
  const abrirEditPorId = async (id: any) => {
    const { data } = await (supabase as any).from("EMPREGADOS").select("*").eq("ID", id).maybeSingle();
    if (!data) { aviso("Não foi possível abrir o cadastro.", "err"); return; }
    abrirEdit(data);
  };
  const abrirEdit = (e: any) => {
    setEditing(e);
    const f: Record<string, string> = {};
    for (const [col] of MAIN_FIELDS) f[col] = e[col] ?? "";
    f["Título do Cargo"] = String(e["Título do Cargo"] ?? "").trim();
    f["Situação"] = e["Situação"] ?? "";
    f["Setor_ERP"] = String(e["Setor_ERP"] ?? "").trim() || "PADRAO";
    f["LIDER"] = String(e["Título do Cargo"] ?? "").trim() || String(e["LIDER"] ?? "").trim(); // Nível puxa do cargo
    f["Perfil_ERP"] = String(e["Perfil_ERP"] ?? "").trim() || "PADRAO";
    setForm(f);
  };
  const salvarEdit = async () => {
    if (!editing) return;
    const patch: any = {};
    for (const k of Object.keys(form)) {
      if (!(k in editing)) continue;
      patch[k] = form[k] === "" ? null : form[k];
    }
    const { error } = await (supabase as any).from("EMPREGADOS").update(patch).eq("ID", editing["ID"]);
    if (error) { aviso("Erro ao salvar: " + error.message, "err"); return; }
    setRows(rs => rs.map(r => r["ID"] === editing["ID"] ? { ...r, ...patch } : r));
    setEditing(null); aviso("Colaborador atualizado.");
    if (modo === "rpc") buscarRpc();   // os números vêm do banco: refaz a consulta
  };
  const setCampo = (col: string, v: string) => setForm(f => ({ ...f, [col]: v }));

  const card = (titulo: string, valor: string, cor: string, sub?: string) => (
    <div style={{ flex: 1, minWidth: 150, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor, marginTop: 4 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const painel = (titulo: string, children: ReactNode) => (
    <div style={{ flex: 1, minWidth: 260, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#0f3171", marginBottom: 14 }}>{titulo}</div>
      {children}
    </div>
  );

  return (
    <div style={{ padding: "4px 2px" }}>
      <style>{`
        .col-fi{height:36px;border:1px solid #cbd5e1;border-radius:9px;padding:0 11px;font-size:13px;background:#fff;color:#0f172a;outline:none}
        .col-fi:focus{border-color:#0f3171}
        .col-btn{height:36px;border-radius:9px;padding:0 13px;font-size:13px;font-weight:700;cursor:pointer;border:1px solid #e2e8f0;background:#fff;color:#475569}
        .col-th{padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;text-align:left;white-space:nowrap}
        .col-td{padding:10px 12px;font-size:12.5px;color:#334155;border-top:1px solid #eef2f7}
        @keyframes col-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes col-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes col-grow{from{width:0}}
        .col-bar-anim{animation:col-grow .7s ease}
        .col-sit-row{cursor:pointer;border-radius:8px;padding:2px 6px;margin:0 -6px;transition:background .15s}
        .col-sit-row:hover{background:#f1f5f9}
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>👥 Colaboradores</div>
          <div style={{ fontSize: 13, color: "#64748b" }}>Quadro de {MESES_ABREV[mesRef.mes]}/{mesRef.ano} (quem esteve na empresa no mês) · dashboard ao vivo.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* Navegador de competência (mês) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "6px 8px 6px 12px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
            <span style={{ fontSize: 15 }}>📅</span>
            <div style={{ lineHeight: 1.15, minWidth: 92 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f766e" }}>{MESES_ABREV[mesRef.mes]} {mesRef.ano}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>01/{pad2(mesRef.mes + 1)} a {pad2(fimMes.getDate())}/{pad2(mesRef.mes + 1)}</div>
            </div>
            {!ehMesAtual && <button className="col-btn" onClick={() => setMesRef({ ano: hoje.getFullYear(), mes: hoje.getMonth() })} title="Voltar ao mês atual" style={{ height: 30, padding: "0 8px", fontSize: 11, background: "#f1f5f9" }}>Hoje</button>}
            <button className="col-btn" onClick={() => irMes(-1)} title="Mês anterior" style={{ height: 30, width: 30, padding: 0, fontSize: 16, lineHeight: 1 }}>‹</button>
            <button className="col-btn" onClick={() => irMes(1)} disabled={ehMesAtual} title="Próximo mês" style={{ height: 30, width: 30, padding: 0, fontSize: 16, lineHeight: 1, opacity: ehMesAtual ? .4 : 1, cursor: ehMesAtual ? "not-allowed" : "pointer" }}>›</button>
          </div>
          <ImportarColaboradores onImported={recarregar} />
          <IntegrarCargos onImported={recarregar} />
          {/* Recarrega por trás: a lista continua na tela enquanto atualiza. */}
          <button className="col-btn" onClick={recarregar} disabled={atualizando}
            style={{ background: "#eef4ff", color: "#0f3171", borderColor: "#dbe4f0", opacity: atualizando ? .6 : 1 }}>
            {atualizando ? "↻ Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
      </div>

      {/* 1ª abertura: nada na tela ainda, então a marca ocupa o lugar todo. */}
      {loading && <CarregandoLogo texto="Carregando colaboradores…" tamanho={96} />}

      {/* KPIs — esmaecem durante o recálculo, mas continuam legíveis */}
      <div style={{ display: loading ? "none" : "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, opacity: veu ? .4 : 1, transition: "opacity .2s ease" }}>
        {card("Ativos no mês", String(ativosNoMes), "#15803d", `${MESES_ABREV[mesRef.mes]}/${mesRef.ano} · presença`)}
        {card("No recorte", String(totalFiltrado), "#0f3171", `${totalGeral} no total`)}
        {verSalario && card("Folha (recorte)", moneyK(folhaTotal), "#0f766e", money(folhaTotal))}
        {verSalario && card("Salário médio", money(salarioMedio), "#7c3aed")}
        {card("Admitidos no mês", String(admitidosMes), "#2563eb", `${MESES_ABREV[mesRef.mes]}/${mesRef.ano}`)}
        {card("Desligados no mês", String(desligadosMes), "#dc2626", `${MESES_ABREV[mesRef.mes]}/${mesRef.ano}`)}
      </div>

      {/* Filtros — ficam fora do véu: dá pra trocar de filtro enquanto recalcula */}
      <div style={{ display: loading ? "none" : "block", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, marginBottom: 16, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="col-fi" style={{ minWidth: 240, flex: 1 }} placeholder="Buscar por nome, CPF, cargo, filial, setor…" value={busca} onChange={e => setBusca(e.target.value)} />
          <select className="col-fi" value={fEmpresa} onChange={e => setFEmpresa(e.target.value)}>
            <option value="">Todas as empresas</option>{empresas.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <select className="col-fi" style={{ maxWidth: 240 }} value={fContrato} onChange={e => setFContrato(e.target.value)}>
            <option value="">Todos os contratos</option>{contratos.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <select className="col-fi" value={fSituacao} onChange={e => setFSituacao(e.target.value)}>
            <option value="">Todas as situações</option>{situacoes.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          {(busca || fEmpresa || fContrato || fSituacao) && <button className="col-btn" onClick={limparFiltros} style={{ background: "#f1f5f9" }}>Limpar</button>}
        </div>
      </div>

      {/* Painéis e tabela: é o que o recálculo muda, então o véu cobre só daqui
          pra baixo — o conteúdo antigo fica visível embaixo até o novo chegar. */}
      <div style={{ display: loading ? "none" : "block", position: "relative" }}>
      {veu && <CarregandoLogo overlay texto="Recalculando…" />}

      {/* Dashboard ao vivo */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {painel("Headcount por empresa", porEmpresa.length === 0 ? <Vazio /> : porEmpresa.map(x => <div key={x.k}>{barRow(x.k, x.v, porEmpresa[0].v, "#0f3171", String(x.v))}</div>))}
        {painel("Por situação (todas)", (
          <>
            {!ehMesAtual && (
              <div style={{ fontSize: 11, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px", marginBottom: 10 }}>
                ⚠ Situação = status <b>atual</b> (a folha não guarda histórico por mês). Para o quadro do mês use "Ativos no mês".
              </div>
            )}
            {sitAtual && (
              <div key={sitAtual.k} onClick={() => setFSituacao(sitAtual.k === fSituacao ? "" : sitAtual.k)}
                style={{ cursor: "pointer", marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: corSituacao(sitAtual.k) + "12", border: "1px solid " + corSituacao(sitAtual.k) + "33", animation: "col-fade .5s ease, col-float 4.5s ease-in-out infinite" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Em destaque · alterna a cada 3s</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 800, color: corSituacao(sitAtual.k) }}>{sitAtual.k}</span>
                  <span style={{ fontSize: 26, fontWeight: 800, color: "#0f172a" }}>{sitAtual.v}</span>
                </div>
                <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>clique para filtrar por esta situação</div>
              </div>
            )}
            {porSituacao.length === 0 ? <Vazio /> : porSituacao.map(x => {
              const pct = porSituacao[0].v ? Math.round((x.v / porSituacao[0].v) * 100) : 0;
              return (
                <div key={x.k} className="col-sit-row" onClick={() => setFSituacao(x.k === fSituacao ? "" : x.k)} title="Clique para filtrar">
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: x.k === fSituacao ? "#0f172a" : "#334155", fontWeight: x.k === fSituacao ? 800 : 600 }}>{x.k}{x.k === fSituacao ? " ✓" : ""}</span>
                    <span style={{ color: "#0f172a", fontWeight: 800 }}>{x.v}</span>
                  </div>
                  <div style={{ height: 8, background: "#eef2f7", borderRadius: 20, overflow: "hidden" }}>
                    <div className="col-bar-anim" style={{ width: pct + "%", height: "100%", background: corSituacao(x.k), borderRadius: 20, transition: "width .5s ease" }} />
                  </div>
                </div>
              );
            })}
          </>
        ))}
        {painel("Folha por empresa (R$)", folhaPorEmpresa.length === 0 ? <Vazio /> : folhaPorEmpresa.map(x => <div key={x.k}>{barRow(x.k, x.v, folhaPorEmpresa[0].v, "#0f766e", moneyK(x.v))}</div>))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {painel(`Ativos por cargo (${ativosPorCargo.length} cargos)`, ativosPorCargo.length === 0 ? <Vazio /> : (
          <div style={{ maxHeight: 285, overflowY: "auto", paddingRight: 4 }}>
            {ativosPorCargo.map(x => <div key={x.k}>{barRow(x.k, x.v, ativosPorCargo[0].v, "#0e7490", String(x.v))}</div>)}
          </div>
        ))}
        {painel("Top contratos (headcount)", porContrato.length === 0 ? <Vazio /> : porContrato.map(x => <div key={x.k}>{barRow(x.k, x.v, porContrato[0].v, "#7c3aed", String(x.v))}</div>))}
        {painel("Tempo de casa", <div>{porFaixa.map(f => <div key={f.label}>{barRow(f.label, f.n, Math.max(1, ...porFaixa.map(z => z.n)), "#2563eb", String(f.n))}</div>)}</div>)}
        {painel(`Admissões × Desligamentos (por ano)`, timeline.length === 0 ? <Vazio /> : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150, paddingTop: 8 }}>
            {timeline.map(t => (
              <div key={t.ano} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 110 }}>
                  <div title={`Admitidos: ${t.adm}`} style={{ width: 12, height: `${(t.adm / maxTl) * 100}%`, background: "#2563eb", borderRadius: "3px 3px 0 0" }} />
                  <div title={`Desligados: ${t.desl}`} style={{ width: 12, height: `${(t.desl / maxTl) * 100}%`, background: "#dc2626", borderRadius: "3px 3px 0 0" }} />
                </div>
                <span style={{ fontSize: 10.5, color: "#64748b", fontWeight: 700 }}>{t.ano}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid #eef2f7" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{totalFiltrado} colaborador(es)</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {erro && <span style={{ fontSize: 12, color: "#dc2626" }}>⚠ {erro}</span>}
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Por página:</span>
            <select className="col-fi" style={{ height: 32 }} value={porPagina} onChange={e => setPorPagina(Number(e.target.value))}>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
        {visiveis.length === 0 ? (
          <div style={{ padding: 50, textAlign: "center", color: "#94a3b8" }}>Nenhum colaborador no recorte atual.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f8fafc" }}>
                <th className="col-th">Nome</th><th className="col-th">CPF</th><th className="col-th">Cargo</th>
                <th className="col-th">Empresa</th><th className="col-th">Contrato</th><th className="col-th">Filial</th>
                <th className="col-th">Admissão</th><th className="col-th">Casa</th>
                {verSalario && <th className="col-th" style={{ textAlign: "right" }}>Salário</th>}
                <th className="col-th">Situação</th><th className="col-th"></th>
              </tr></thead>
              <tbody>
                {visiveis.map((l, i) => {
                  const trab = l.situacao.toUpperCase().startsWith("TRABALH"); const casa = anosDeCasa(l.admissao);
                  return (
                    <tr key={l.id ?? i} onMouseEnter={ev => (ev.currentTarget.style.background = "#f8fbff")} onMouseLeave={ev => (ev.currentTarget.style.background = "#fff")}>
                      <td className="col-td" style={{ fontWeight: 700, color: "#0f172a" }}>{l.nome || "—"}<div style={{ fontSize: 10.5, color: "#94a3b8" }}>{l.setor}</div></td>
                      <td className="col-td" style={{ fontVariantNumeric: "tabular-nums" }}>{l.cpf || "—"}</td>
                      <td className="col-td">{l.cargo}</td>
                      <td className="col-td"><span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#eef4ff", color: "#0f3171" }}>{l.empresa}</span></td>
                      <td className="col-td" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.contrato}</td>
                      <td className="col-td">{l.filial}</td>
                      <td className="col-td" style={{ whiteSpace: "nowrap" }}>{fmtData(l.admissao)}</td>
                      <td className="col-td" style={{ whiteSpace: "nowrap" }}>{casa != null ? `${casa.toFixed(1)}a` : "—"}</td>
                      {verSalario && <td className="col-td" style={{ textAlign: "right", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>{money(l.salario)}</td>}
                      <td className="col-td"><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20, background: trab ? "#dcfce7" : "#f1f5f9", color: trab ? "#15803d" : "#64748b" }}>{l.situacao || "—"}</span></td>
                      <td className="col-td" style={{ textAlign: "right" }}><button className="col-btn" onClick={() => abrirEditPorId(l.id)} style={{ height: 30, padding: "0 11px", background: "#eef4ff", color: "#0f3171", borderColor: "#dbe4f0" }}>Editar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {totalPag > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, padding: "12px 16px", borderTop: "1px solid #eef2f7" }}>
            <button className="col-btn" disabled={pagina <= 1} onClick={() => setPagina(p => Math.max(1, p - 1))} style={{ opacity: pagina <= 1 ? .5 : 1 }}>‹ Anterior</button>
            <span style={{ fontSize: 12.5, color: "#475569", fontWeight: 600 }}>Página {pagina} de {totalPag}</span>
            <button className="col-btn" disabled={pagina >= totalPag} onClick={() => setPagina(p => Math.min(totalPag, p + 1))} style={{ opacity: pagina >= totalPag ? .5 : 1 }}>Próxima ›</button>
          </div>
        )}
      </div>
      </div>{/* fim do bloco coberto pelo véu */}

      {/* Modal editar campos RH */}
      {editing && (
        <div onClick={ev => { if (ev.target === ev.currentTarget) setEditing(null); }} style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(15,23,42,.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 600, maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative" }}>
            <button onClick={() => setEditing(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer", zIndex: 1 }}>✕</button>
            <div style={{ padding: "20px 22px 12px" }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{editing["Nome"] || "Colaborador"}</div>
              <div style={{ fontSize: 12.5, color: "#64748b" }}>{nomeCargoDe(editing)} · {empresaDe(editing)} · {contratoDe(editing)}</div>
            </div>
            <div style={{ padding: "0 22px", overflowY: "auto", flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 10 }}>Dados do colaborador</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {MAIN_FIELDS.slice(0, 2).map(([col, label]) => (
                  <Campo key={col} label={label} value={form[col] ?? ""} onChange={v => setCampo(col, v)} />
                ))}
                <Campo label="Cargo" value={form["Título do Cargo"] ?? ""} onChange={v => setCampo("Título do Cargo", v)} />
                {MAIN_FIELDS.slice(2).map(([col, label]) => (
                  <Campo key={col} label={label} value={form[col] ?? ""} onChange={v => setCampo(col, v)} />
                ))}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Situação</label>
                  <select className="col-fi" style={{ width: "100%" }} value={form["Situação"] ?? ""} onChange={e => setCampo("Situação", e.target.value)}>
                    {[form["Situação"] ?? "", "Trabalhando", ...situacoes].filter((v, i, a) => v && a.indexOf(v) === i).map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", margin: "18px 0 3px" }}>Configurações extras (ERP)</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>Setor, nível e perfil usados pelo sistema (permissões/encarregados).</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Setor</label>
                  <select className="col-fi" style={{ width: "100%" }} value={form["Setor_ERP"] ?? ""} onChange={e => setCampo("Setor_ERP", e.target.value)}>
                    {[...new Set([form["Setor_ERP"] ?? "", ...setorOptions])].filter(Boolean).map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <Campo label="Nível" value={form["LIDER"] ?? ""} onChange={v => setCampo("LIDER", v)} />
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Perfil</label>
                  <select className="col-fi" style={{ width: "100%" }} value={form["Perfil_ERP"] ?? ""} onChange={e => setCampo("Perfil_ERP", e.target.value)}>
                    {[...new Set([form["Perfil_ERP"] ?? "", ...PERFIS])].filter(Boolean).map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ height: 8 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px", borderTop: "1px solid #e2e8f0" }}>
              <button className="col-btn" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="col-btn" onClick={salvarEdit} style={{ background: "#0f3171", color: "#fff", borderColor: "#0f3171" }}>Salvar tudo</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.18)", background: toast.tipo === "ok" ? "#ecfdf3" : "#fef2f2", color: toast.tipo === "ok" ? "#15803d" : "#b91c1c", border: `1px solid ${toast.tipo === "ok" ? "#86efac" : "#fecaca"}` }}>{toast.msg}</div>
      )}
    </div>
  );
}

function Vazio() { return <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "6px 0" }}>Sem dados no recorte.</div>; }
function Campo({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>{label}</label>
      <input className="col-fi" style={{ width: "100%" }} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
