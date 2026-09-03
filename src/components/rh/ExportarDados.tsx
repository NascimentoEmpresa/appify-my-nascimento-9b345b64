import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { Download, FileSpreadsheet, X, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { empresaDe, parseSalario, fmtData, nomeCargoDe } from "@/lib/rh/colaboradoresUtils";

// =========================================================================
// RH — Colaboradores: "Exportar Dados".
//
// Chamado pela Presidência (03/09/2026): o relatório de vidas ativas para a
// Protege e para a conferência do faturamento mensal era montado à mão em
// Excel. Pediram um recorte configurável — a pessoa escolhe as colunas e o
// filtro (empresa, contrato, situação) e exporta na hora.
//
// Faz a própria leitura de EMPREGADOS/CONTRATOS (mesmo padrão de
// IntegrarCargos.tsx: "a tela de Colaboradores não carrega mais a tabela
// toda — quem precisa dela busca aqui"), então funciona igual nos dois modos
// da tela (RPC ou client) e não depende do que já estiver carregado nela.
//
// Situação é filtrada NO BANCO (.in), porque é exatamente o pedido central
// do chamado: tirar de uma vez só quem está em férias + licença-maternidade
// + atestado + auxílio-doença, sem rodar o export uma vez por situação.
// Empresa e Contrato são filtrados DEPOIS de ler, com a mesma lógica da tela
// (empresaDe/contratoPorFilial) — "Empresa" é código+fallback de texto, não
// dá pra empurrar pro SQL sem duplicar essa regra.
// =========================================================================

type ColunaKey =
  | "filial" | "nome" | "cpf" | "empresa" | "contrato" | "cargo" | "setor"
  | "situacao" | "admissao" | "data_afastamento" | "pis" | "email" | "centro_custo" | "salario";

const COLUNAS: { key: ColunaKey; label: string; padrao: boolean; salario?: boolean }[] = [
  { key: "filial", label: "Filial", padrao: true },
  { key: "nome", label: "Nome do colaborador", padrao: true },
  { key: "cpf", label: "CPF", padrao: true },
  { key: "empresa", label: "Nome da empresa", padrao: true },
  { key: "admissao", label: "Data de admissão", padrao: true },
  { key: "situacao", label: "Situação atual", padrao: true },
  { key: "cargo", label: "Cargo", padrao: false },
  { key: "contrato", label: "Contrato", padrao: false },
  { key: "setor", label: "Setor", padrao: false },
  { key: "data_afastamento", label: "Data de afastamento", padrao: false },
  { key: "centro_custo", label: "Centro de custo", padrao: false },
  { key: "pis", label: "PIS/PASEP", padrao: false },
  { key: "email", label: "E-mail", padrao: false },
  { key: "salario", label: "Salário", padrao: false, salario: true },
];

// Campos do banco que cada coluna precisa ler.
const CAMPOS_POR_COLUNA: Record<ColunaKey, string[]> = {
  filial: ["Nome Filial", "Filial"],
  nome: ["Nome"],
  cpf: ["CPF"],
  empresa: ["Empresa", "Nome da Empresa"],
  contrato: ["Filial"],
  cargo: ["Título do Cargo", "Nome do Cargo"],
  setor: ["Setor_ERP"],
  situacao: ["Situação"],
  admissao: ["Admissão"],
  data_afastamento: ["Data Afastamento"],
  pis: ["PIS"],
  email: ["email"],
  centro_custo: ["C.Custo"],
  salario: ["Valor Salário"],
};

// Colunas que, se removidas do SELECT por causa de um erro de schema, ainda
// deixam a exportação sair (o resto continua). Espelha a robustez que a tela
// principal já tem contra "Empresa"/"Cargo"/"Nome do Cargo" ausentes em
// algum ambiente.
const CAMPOS_OPCIONAIS = new Set(["Empresa", "Cargo", "Nome do Cargo"]);

const valorDaColuna = (key: ColunaKey, e: any, contratoDe: (e: any) => string): string | number => {
  switch (key) {
    case "filial": return String(e["Nome Filial"] ?? "").trim() || String(e["Filial"] ?? "").trim() || "—";
    case "nome": return String(e["Nome"] ?? "").trim();
    case "cpf": return String(e["CPF"] ?? "").trim();
    case "empresa": return empresaDe(e);
    case "contrato": return contratoDe(e);
    case "cargo": return nomeCargoDe(e);
    case "setor": return String(e["Setor_ERP"] ?? "").trim() || "—";
    case "situacao": return String(e["Situação"] ?? "").trim() || "—";
    case "admissao": return fmtData(e["Admissão"]);
    case "data_afastamento": return fmtData(e["Data Afastamento"]);
    case "pis": return String(e["PIS"] ?? "").trim();
    case "email": return String(e["email"] ?? "").trim();
    case "centro_custo": return String(e["C.Custo"] ?? "").trim();
    case "salario": return parseSalario(e["Valor Salário"]);
  }
};

const CHUNK = 1000;

export default function ExportarDados() {
  const { data: verSalario } = useScreenAccess("colaboradores_ver_salario", "visualizar");

  const [open, setOpen] = useState(false);
  const [colunas, setColunas] = useState<Set<ColunaKey>>(new Set(COLUNAS.filter(c => c.padrao).map(c => c.key)));
  const [fEmpresa, setFEmpresa] = useState("");
  const [fContrato, setFContrato] = useState("");
  const [situacoesSel, setSituacoesSel] = useState<Set<string>>(new Set());

  const [fase, setFase] = useState<"idle" | "gerando" | "fim">("idle");
  const [prog, setProg] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [totalLinhas, setTotalLinhas] = useState(0);

  // Opções de filtro. Empresa é fixa (só 4 no grupo); contrato e situação
  // vêm do banco, carregados uma vez na primeira abertura.
  const EMPRESAS = ["HAGG", "SN", "CANAÃ", "NH"];
  const [contratos, setContratos] = useState<string[]>([]);
  const [situacoesDisponiveis, setSituacoesDisponiveis] = useState<string[]>([]);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);

  const abrir = async () => {
    setOpen(true); setFase("idle"); setErro(null); setProg("");
    if (contratos.length || situacoesDisponiveis.length) return;
    setCarregandoOpcoes(true);
    try {
      const [ct, st] = await Promise.all([
        (supabase as any).from("CONTRATOS").select('"NOME CONTRATO"').eq("ATIVO", "SIM").order('"NOME CONTRATO"'),
        (supabase as any).from("EMPREGADOS").select('"Situação"').limit(20000),
      ]);
      if (ct.data) setContratos([...new Set(ct.data.map((c: any) => String(c["NOME CONTRATO"] ?? "").trim()).filter(Boolean))] as string[]);
      if (st.data) setSituacoesDisponiveis(
        [...new Set(st.data.map((r: any) => String(r["Situação"] ?? "").trim()).filter(Boolean))].sort() as string[],
      );
    } finally {
      setCarregandoOpcoes(false);
    }
  };
  const fechar = () => { if (fase === "gerando") return; setOpen(false); };

  const alternarColuna = (key: ColunaKey) => setColunas(prev => {
    const nova = new Set(prev);
    if (nova.has(key)) nova.delete(key); else nova.add(key);
    return nova;
  });
  const alternarSituacao = (s: string) => setSituacoesSel(prev => {
    const nova = new Set(prev);
    if (nova.has(s)) nova.delete(s); else nova.add(s);
    return nova;
  });

  const gerar = async () => {
    if (colunas.size === 0) { setErro("Escolha pelo menos uma coluna."); return; }
    setErro(null); setFase("gerando"); setProg("Lendo contratos…");
    try {
      // Contrato do colaborador sai da CONTRATOS, casado pela Filial — igual
      // à tela principal.
      const { data: ctData, error: ctErro } = await (supabase as any)
        .from("CONTRATOS").select('"NOME CONTRATO", Filial').eq("ATIVO", "SIM");
      if (ctErro) throw new Error("Falha ao ler CONTRATOS: " + ctErro.message);
      const contratoPorFilial: Record<string, string> = {};
      for (const c of ctData ?? []) if (c.Filial != null) contratoPorFilial[String(c.Filial)] = c["NOME CONTRATO"] || "";
      const contratoDe = (e: any) => contratoPorFilial[String(e?.["Filial"] ?? "")] || "—";

      // Campos a buscar: os das colunas escolhidas + os que os filtros de
      // Empresa/Contrato precisam pra decidir depois de ler.
      const camposNecessarios = new Set<string>(["Situação"]); // sempre, p/ o filtro .in()
      for (const key of colunas) for (const c of CAMPOS_POR_COLUNA[key]) camposNecessarios.add(c);
      if (fEmpresa) { camposNecessarios.add("Empresa"); camposNecessarios.add("Nome da Empresa"); }
      if (fContrato) camposNecessarios.add("Filial");

      const selecionar = (excluir: Set<string>) =>
        [...camposNecessarios].filter(c => !excluir.has(c)).map(c => `"${c}"`).join(",");

      let cols = selecionar(new Set());
      let excluidos = new Set<string>();

      const buscarBloco = async (de: number, comCount: boolean) => {
        let q = (supabase as any).from("EMPREGADOS").select(cols, comCount ? { count: "exact" } : undefined);
        if (situacoesSel.size > 0) q = q.in("Situação", [...situacoesSel]);
        return q.order("Nome", { ascending: true }).range(de, de + CHUNK - 1);
      };

      setProg("Lendo colaboradores…");
      let primeiro = await buscarBloco(0, true);
      // Coluna ausente no schema deste ambiente: tira as opcionais e tenta de novo.
      if (primeiro.error && /column|does not exist|schema cache/i.test(primeiro.error.message || "")) {
        excluidos = new Set([...camposNecessarios].filter(c => CAMPOS_OPCIONAIS.has(c)));
        cols = selecionar(excluidos);
        primeiro = await buscarBloco(0, true);
      }
      if (primeiro.error) throw new Error("Falha ao ler EMPREGADOS: " + primeiro.error.message);

      const total = Math.min(primeiro.count ?? (primeiro.data?.length ?? 0), 200000);
      let todos: any[] = primeiro.data || [];
      for (let de = CHUNK; de < total; de += CHUNK) {
        setProg(`Lendo colaboradores… ${Math.min(de, total).toLocaleString("pt-BR")}/${total.toLocaleString("pt-BR")}`);
        const r = await buscarBloco(de, false);
        if (r.error) throw new Error("Falha ao ler EMPREGADOS: " + r.error.message);
        todos = todos.concat(r.data || []);
      }

      // Empresa/Contrato: filtrados aqui, com a mesma regra da tela (código +
      // fallback de texto pra Empresa; Filial casada em CONTRATOS pro Contrato).
      const filtrados = todos.filter(e =>
        (!fEmpresa || empresaDe(e) === fEmpresa) &&
        (!fContrato || contratoDe(e) === fContrato),
      );

      if (filtrados.length === 0) { setErro("Nenhum colaborador encontrado para esse filtro."); setFase("idle"); return; }

      setProg("Montando a planilha…");
      const ordemColunas = COLUNAS.filter(c => colunas.has(c.key));
      const linhas = filtrados.map(e => {
        const linha: Record<string, string | number> = {};
        for (const c of ordemColunas) linha[c.label] = valorDaColuna(c.key, e, contratoDe);
        return linha;
      });

      const XLSX: any = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Colaboradores");
      const hoje = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `colaboradores-${hoje}.xlsx`);

      setTotalLinhas(filtrados.length);
      setProg(`${filtrados.length.toLocaleString("pt-BR")} colaborador(es) exportado(s).`);
      setFase("fim");
    } catch (e: any) {
      setErro(e?.message || String(e)); setFase("idle");
    }
  };

  const filtrosAtivos = !!fEmpresa || !!fContrato || situacoesSel.size > 0;

  return (
    <>
      <button className="col-btn" onClick={abrir} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <Download size={15} /> Exportar Dados
      </button>

      {open && (
        <div onClick={ev => { if (ev.target === ev.currentTarget) fechar(); }}
          style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(15,23,42,.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative" }}>
            {fase !== "gerando" && (
              <button onClick={fechar} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", color: "#94a3b8", cursor: "pointer", zIndex: 1 }}><X size={20} /></button>
            )}
            <div style={{ padding: "20px 22px 12px" }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 9 }}>
                <FileSpreadsheet size={20} color="#0f3171" /> Exportar Dados
              </div>
              <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                Escolha as colunas e o filtro e baixe um Excel com exatamente os dados que você precisa.
              </div>
            </div>

            <div style={{ padding: "0 22px 4px", overflowY: "auto", flex: 1 }}>
              {erro && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, marginBottom: 12 }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{erro}</span>
                </div>
              )}

              {(fase === "idle") && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>Filtro</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                    <select className="col-fi" value={fEmpresa} onChange={e => setFEmpresa(e.target.value)}>
                      <option value="">Todas as empresas</option>
                      {EMPRESAS.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                    <select className="col-fi" style={{ maxWidth: 260 }} value={fContrato} onChange={e => setFContrato(e.target.value)} disabled={carregandoOpcoes}>
                      <option value="">Todos os contratos</option>
                      {contratos.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
                    Situação {situacoesSel.size > 0 && <span style={{ color: "#0f3171" }}>({situacoesSel.size} selecionada{situacoesSel.size > 1 ? "s" : ""})</span>}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                    {carregandoOpcoes && <span style={{ fontSize: 12, color: "#94a3b8" }}>Carregando situações…</span>}
                    {situacoesDisponiveis.map(s => {
                      const ativo = situacoesSel.has(s);
                      return (
                        <button key={s} type="button" onClick={() => alternarSituacao(s)}
                          style={{ border: ativo ? "1px solid #0f3171" : "1px solid #e2e8f0", background: ativo ? "#eef4ff" : "#fff", color: ativo ? "#0f3171" : "#475569", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          {s}{ativo ? " ✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                  {situacoesDisponiveis.length === 0 && !carregandoOpcoes && (
                    <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: -10, marginBottom: 16 }}>Nenhuma marcada = todas as situações.</div>
                  )}

                  <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>Colunas</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", marginBottom: 6 }}>
                    {COLUNAS.filter(c => !c.salario || verSalario).map(c => {
                      const marcada = colunas.has(c.key);
                      return (
                        <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155", cursor: "pointer", padding: "3px 0" }}>
                          <input type="checkbox" checked={marcada} onChange={() => alternarColuna(c.key)} style={{ width: 15, height: 15, accentColor: "#0f3171", cursor: "pointer" }} />
                          {c.label}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}

              {fase === "gerando" && (
                <div style={{ padding: "34px 0", textAlign: "center" }}>
                  <RefreshCw size={26} color="#0f3171" style={{ animation: "spin 1s linear infinite" }} />
                  <div style={{ fontSize: 13.5, color: "#334155", marginTop: 12, fontWeight: 600 }}>{prog || "Gerando…"}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Não feche esta janela.</div>
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                </div>
              )}

              {fase === "fim" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#ecfdf3", border: "1px solid #86efac", color: "#15803d", borderRadius: 10, padding: "12px 14px", fontSize: 13, fontWeight: 600, margin: "12px 0" }}>
                  <CheckCircle2 size={18} /> {prog || `${totalLinhas} colaborador(es) exportado(s).`}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px", borderTop: "1px solid #e2e8f0" }}>
              {fase === "idle" && (
                <>
                  <button className="col-btn" onClick={fechar}>Cancelar</button>
                  <button className="col-btn" onClick={gerar}
                    style={{ background: "#0f3171", color: "#fff", borderColor: "#0f3171", display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <Download size={15} /> Exportar{filtrosAtivos ? " (com filtro)" : ""}
                  </button>
                </>
              )}
              {fase === "fim" && <button className="col-btn" onClick={fechar} style={{ background: "#0f3171", color: "#fff", borderColor: "#0f3171" }}>Fechar</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
