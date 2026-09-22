import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { Download, FileSpreadsheet, X, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { empresaDe, parseSalario, fmtData, nomeCargoDe, nomeContratoDe } from "@/lib/rh/colaboradoresUtils";
import { COLS_TIPO_CONTRATO_EMPREGADOS, ehMEI } from "@/lib/rh/mei";

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
//
// AJUSTE FINO (15/09/2026, chamado da conferência da Protege):
//   • O código de FILIAL se repete entre empresas (1064 é "TRIUNFO VIGIAS"
//     na SN; a NH tem outra 1064). O contrato era casado só pela filial, e
//     colaborador da NH saía com contrato da SN. Agora a chave é
//     (Empresa, Filial) — cada pessoa só casa com contrato da própria empresa.
//   • Filial sem contrato ativo em CONTRATOS (ex.: 1098 na SN, "CEITEC
//     LIMPEZA") saía só com o número. Agora cai no "Nome Filial" do cadastro
//     do colaborador, que já vem "1098 - CEITEC LIMPEZA - 025.2026".
//   • O filtro de contrato só lista os contratos da empresa escolhida — e a
//     opção leva a empresa junto, pra 1064 da SN não virar 1064 da NH.
//   • Coluna "Vínculo": "Contrato ativo" / "Só cadastro" / "Sem contrato",
//     pra quem confere a fatura ver de onde veio o nome.
// =========================================================================

type ColunaKey =
  | "filial" | "nome" | "cpf" | "empresa" | "contrato" | "vinculo" | "cargo" | "setor"
  | "situacao" | "admissao" | "data_afastamento" | "pis" | "email" | "centro_custo" | "salario";

const COLUNAS: { key: ColunaKey; label: string; padrao: boolean; salario?: boolean }[] = [
  { key: "filial", label: "Filial", padrao: true },
  { key: "nome", label: "Nome do colaborador", padrao: true },
  { key: "cpf", label: "CPF", padrao: true },
  { key: "empresa", label: "Nome da empresa", padrao: true },
  { key: "admissao", label: "Data de admissão", padrao: true },
  { key: "situacao", label: "Situação atual", padrao: true },
  { key: "cargo", label: "Cargo", padrao: false },
  { key: "contrato", label: "Contrato", padrao: true },
  { key: "vinculo", label: "Vínculo do contrato", padrao: false },
  { key: "setor", label: "Setor", padrao: false },
  { key: "data_afastamento", label: "Data de afastamento", padrao: false },
  { key: "centro_custo", label: "Centro de custo", padrao: false },
  { key: "pis", label: "PIS/PASEP", padrao: false },
  { key: "email", label: "E-mail", padrao: false },
  { key: "salario", label: "Salário", padrao: false, salario: true },
];

// Campos do banco que cada coluna precisa ler.
const CAMPOS_POR_COLUNA: Record<ColunaKey, string[]> = {
  filial: ["Nome Filial", "Filial", "Empresa", "Nome da Empresa"],
  nome: ["Nome"],
  cpf: ["CPF"],
  empresa: ["Empresa", "Nome da Empresa"],
  contrato: ["Empresa", "Nome da Empresa", "Filial", "Nome Filial"],
  vinculo: ["Empresa", "Nome da Empresa", "Filial", "Nome Filial"],
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
const CAMPOS_OPCIONAIS = new Set(["Empresa", "Cargo", "Nome do Cargo", ...COLS_TIPO_CONTRATO_EMPREGADOS]);

/**
 * "1107 | UFRGS INTERPRETE DE LIBRAS C. 009.2026" — código junto do nome.
 *
 * Serve às DUAS colunas que têm código: Contrato e Filial. Nos dois casos o
 * código é o que o RH usa para falar do lugar no dia a dia, e sem ele a
 * planilha obriga a ler o nome inteiro para saber de qual se trata.
 *
 * Uma função só, e não uma por coluna, porque o mesmo rótulo é montado em
 * lugares diferentes — a coluna exportada e as opções do filtro de contrato.
 * Se cada um formatasse do seu jeito, o filtro compararia um texto que a
 * coluna não produz e nunca casaria.
 */
const rotuloComCodigo = (codigo: any, nome: any): string => {
  const cod = String(codigo ?? "").trim();
  const nm = String(nome ?? "").trim();
  if (!nm) return cod || "—";
  return cod ? `${cod} | ${nm}` : nm;
};

/** Chave do contrato: EMPRESA + FILIAL — o código de filial repete entre empresas. */
const chaveEmpresaFilial = (empresa: string, filial: any) => `${empresa}|${String(filial ?? "").trim()}`;

type Vinculo = { contrato: string; origem: "Contrato ativo" | "Só cadastro" | "Sem contrato" };

const valorDaColuna = (key: ColunaKey, e: any, vinculoDe: (e: any) => Vinculo): string | number => {
  switch (key) {
    // "Nome Filial" já vem com o código na frente desde a migration
    // 20260930000089 ("1109 - POLICIA CIVIL RS LIMPEZA 066.2026") — passar
    // por rotuloComCodigo daria "1109 | 1109 - ...".
    case "filial": return nomeContratoDe(e) || "—";
    case "nome": return String(e["Nome"] ?? "").trim();
    case "cpf": return String(e["CPF"] ?? "").trim();
    case "empresa": return empresaDe(e);
    case "contrato": return vinculoDe(e).contrato;
    case "vinculo": return vinculoDe(e).origem;
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
  // Cada opção leva a empresa junto: o mesmo código de filial existe em
  // empresas diferentes, e o filtro precisa distinguir.
  const [contratos, setContratos] = useState<{ empresa: string; rotulo: string }[]>([]);
  const [situacoesDisponiveis, setSituacoesDisponiveis] = useState<string[]>([]);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);

  const abrir = async () => {
    setOpen(true); setFase("idle"); setErro(null); setProg("");
    if (contratos.length || situacoesDisponiveis.length) return;
    setCarregandoOpcoes(true);
    try {
      // listar_situacoes_empregados (20260930000201): RPC com SELECT DISTINCT
      // no banco — antes buscava 13.279 linhas de EMPREGADOS só pra deduplicar
      // no navegador (mesmo anti-padrão do listar_setores_empregados).
      const [ct, st] = await Promise.all([
        (supabase as any).from("CONTRATOS").select('"NOME CONTRATO", Filial, Empresa, "NOME EMPRESA"').eq("ATIVO", "SIM").order('"NOME CONTRATO"'),
        (supabase as any).rpc("listar_situacoes_empregados"),
      ]);
      // Mesmo rótulo da coluna exportada — o filtro compara com o que sai lá.
      if (ct.data) {
        const vistos = new Set<string>();
        const lista: { empresa: string; rotulo: string }[] = [];
        for (const c of ct.data) {
          const rotulo = rotuloComCodigo(c.Filial, c["NOME CONTRATO"]);
          const empresa = empresaDe({ Empresa: c.Empresa, "Nome da Empresa": c["NOME EMPRESA"] });
          const k = `${empresa}|${rotulo}`;
          if (!rotulo || rotulo === "—" || vistos.has(k)) continue;
          vistos.add(k); lista.push({ empresa, rotulo });
        }
        setContratos(lista);
      }
      if (st.data) setSituacoesDisponiveis(
        [...new Set(st.data.map((r: any) => String(r.situacao ?? "").trim()).filter(Boolean))].sort() as string[],
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
        .from("CONTRATOS").select('"NOME CONTRATO", Filial, Empresa, "NOME EMPRESA"').eq("ATIVO", "SIM");
      if (ctErro) throw new Error("Falha ao ler CONTRATOS: " + ctErro.message);
      // Chave (empresa, filial): 1064 da SN não é a 1064 da NH.
      const contratoPorEmpresaFilial: Record<string, string> = {};
      for (const c of ctData ?? []) {
        if (c.Filial == null) continue;
        const empresa = empresaDe({ Empresa: c.Empresa, "Nome da Empresa": c["NOME EMPRESA"] });
        contratoPorEmpresaFilial[chaveEmpresaFilial(empresa, c.Filial)] = rotuloComCodigo(c.Filial, c["NOME CONTRATO"]);
      }
      const vinculoDe = (e: any): Vinculo => {
        const emContratos = contratoPorEmpresaFilial[chaveEmpresaFilial(empresaDe(e), e?.["Filial"])];
        if (emContratos) return { contrato: emContratos, origem: "Contrato ativo" };
        // Sem contrato ativo nessa (empresa, filial): o cadastro do colaborador
        // ainda diz onde ele está ("1098 - CEITEC LIMPEZA - 025.2026").
        const doCadastro = String(e?.["Nome Filial"] ?? "").trim();
        if (doCadastro) return { contrato: doCadastro.replace(/^(\d+)\s*-\s*/, "$1 | "), origem: "Só cadastro" };
        const cod = String(e?.["Filial"] ?? "").trim();
        return { contrato: cod ? `${cod} | (sem contrato)` : "—", origem: "Sem contrato" };
      };

      // Campos a buscar: os das colunas escolhidas + os que os filtros de
      // Empresa/Contrato precisam pra decidir depois de ler.
      const camposNecessarios = new Set<string>(["Situação"]); // sempre, p/ o filtro .in()
      for (const key of colunas) for (const c of CAMPOS_POR_COLUNA[key]) camposNecessarios.add(c);
      // Empresa e Filial entram sempre: o contrato é casado por (empresa, filial).
      for (const c of ["Empresa", "Nome da Empresa", "Filial", "Nome Filial"]) camposNecessarios.add(c);
      // Tipo de contrato entra sempre: MEI fica fora do relatório (18/09/2026).
      for (const c of COLS_TIPO_CONTRATO_EMPREGADOS) camposNecessarios.add(c);

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
      // MEI não é colaborador da folha: não entra no relatório, em nenhum
      // filtro (18/09/2026) — a mesma regra que o Importar usa pra não tocar.
      const semMei = todos.filter(e => !ehMEI(e));
      const meiForaTotal = todos.length - semMei.length;
      const filtrados = semMei.filter(e =>
        (!fEmpresa || empresaDe(e) === fEmpresa) &&
        (!fContrato || vinculoDe(e).contrato === fContrato),
      );

      if (filtrados.length === 0) { setErro("Nenhum colaborador encontrado para esse filtro."); setFase("idle"); return; }

      setProg("Montando a planilha…");
      const ordemColunas = COLUNAS.filter(c => colunas.has(c.key));
      const linhas = filtrados.map(e => {
        const linha: Record<string, string | number> = {};
        for (const c of ordemColunas) linha[c.label] = valorDaColuna(c.key, e, vinculoDe);
        return linha;
      });

      const XLSX: any = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Colaboradores");
      const hoje = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `colaboradores-${hoje}.xlsx`);

      setTotalLinhas(filtrados.length);
      setProg(`${filtrados.length.toLocaleString("pt-BR")} colaborador(es) exportado(s).${meiForaTotal > 0 ? ` ${meiForaTotal} MEI ficou(aram) de fora, como manda a regra.` : ""}`);
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
                <b style={{ color: "#b45309" }}> Colaborador MEI não entra no relatório.</b>
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
                    <select className="col-fi" value={fEmpresa} onChange={e => { setFEmpresa(e.target.value); setFContrato(""); }}>
                      <option value="">Todas as empresas</option>
                      {EMPRESAS.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                    <select className="col-fi" style={{ maxWidth: 260 }} value={fContrato} onChange={e => setFContrato(e.target.value)} disabled={carregandoOpcoes}>
                      <option value="">{fEmpresa ? `Todos os contratos da ${fEmpresa}` : "Todos os contratos"}</option>
                      {contratos
                        .filter(c => !fEmpresa || c.empresa === fEmpresa)
                        .map(c => <option key={`${c.empresa}|${c.rotulo}`} value={c.rotulo}>{fEmpresa ? c.rotulo : `${c.empresa} · ${c.rotulo}`}</option>)}
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
