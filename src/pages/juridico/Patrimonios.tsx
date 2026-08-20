import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  ehContratoParcelado, gerarParcelas, renumerar, somaParcelas, totalGeral, MODOS_PARCELA,
  validarParcelas, mapaValorQueFalta, numero as numParc, somaMeses,
  type LinhaParcela, type ModoParcelas,
} from "@/pages/juridico/patrimonio/parcelas";
import { useAuth } from "@/hooks/useAuth";
import { MapaPatrimonios } from "./patrimonio/MapaPatrimonios";
import { CLASSIFICACOES, ESPECIES_ESCRITURA, SITUACOES_PAGAMENTO, corSituacao } from "./patrimonio/carteira";
import { coordenadaValida } from "./patrimonio/geo";

// =====================================================================
// JURÍDICO — Gestão Patrimonial e Obrigações
// Patrimônios (imóveis, veículos...) + obrigações/contas (despesas, seguros,
// água, luz...) + acessos (portais), contatos, documentos, histórico e
// comentários do setor Jurídico.
// =====================================================================

interface Patrimonio {
  id: number; codigo?: string; tipo: string; descricao: string; localizacao?: string;
  placa?: string; cidade?: string; empresa?: string; responsavel?: string;
  centro_custo?: string; status: string; observacoes?: string; created_at?: string;
  transferida?: boolean; proprietario?: string; empresa_pagadora?: string;
  // A carteira: de onde saem as colunas de dinheiro da tabela e os KPIs.
  classificacao?: string; situacao_pagamento?: string; matricula?: string;
  possui_escritura?: boolean; especie_escritura?: string;
  valor_contrato?: number; valor_entrada?: number; valor_falta?: number;
  latitude?: number | null; longitude?: number | null;
  geo_endereco?: string | null; geo_status?: string | null;
  valor_total?: number; valor_estimado?: number; comissao?: number;
  reforcos_pagos?: number; reforcos_a_pagar?: number; valor_parcela?: number;
  qtd_parcelas?: number; parcelas_pagas?: number; parcelas_falta?: number;
  proxima_parcela?: string; anotacoes?: string; aba_origem?: string;
}
interface Obrigacao {
  id: number; patrimonio_id: number; categoria: string; descricao?: string; valor?: number;
  vencimento?: string; periodicidade?: string; forma_pagamento?: string; responsavel?: string;
  status: string; pago_em?: string; seguradora?: string; apolice?: string;
  vigencia_inicio?: string; vigencia_fim?: string; premio?: number; parcelas?: string;
  onde_pagar?: string; comprovante_path?: string; comprovante_nome?: string;
  valor_entrada?: number;
}
interface Parcela {
  id: number; patrimonio_id: number; ordem?: number; numero?: number; rotulo?: string;
  vencimento?: string; valor?: number; valor_pago?: number; situacao?: string;
  detalhes?: Record<string, any>; origem?: string;
}
interface Acesso { id: number; patrimonio_id: number; servico?: string; link?: string; usuario?: string; local_senha?: string; observacao?: string; }
interface Contato { id: number; patrimonio_id: number; tipo?: string; nome?: string; telefone?: string; email?: string; observacao?: string; }
interface Documento { id: number; patrimonio_id: number; tipo?: string; nome?: string; storage_path?: string; criado_por?: string; created_at?: string; }
interface Historico { id: number; patrimonio_id: number; acao: string; detalhe?: string; autor?: string; created_at?: string; }
interface Comentario { id: number; entidade_id?: string; texto: string; autor_nome?: string; created_at?: string; }
interface EmpJuridico { id: number; nome: string; }

const TIPOS = ["Imóvel", "Veículo", "Terreno", "Equipamento", "Outros"];
// "Energia" e "Parcela da Compra" saíram a pedido do Jurídico (ago/2026):
// energia é a mesma conta de "Luz", e a parcela da compra virou o bloco de
// parcelas do Financiamento/Consórcio. Categoria antiga já gravada continua
// aparecendo no select ao editar aquela conta (ver categoriasDoSelect), senão
// abrir para editar trocaria a categoria sozinho.
const CATEGORIAS = ["Financiamento", "Consórcio", "IPTU", "Condomínio", "Água", "Luz", "Internet", "Telefone", "Seguro", "Aluguel", "Imposto", "IPVA", "Licenciamento", "Manutenção", "Rastreamento", "Outros"];
// Financiamento e Consórcio: têm entrada E parcelas de contrato. As demais
// são conta de mês — nelas o campo de entrada nem aparece, para não sugerir
// que uma conta de luz tem valor de entrada.
const categoriasDoSelect = (atual?: string) =>
  atual && !CATEGORIAS.includes(atual) ? [atual, ...CATEGORIAS] : CATEGORIAS;
const PERIODICIDADES = ["Mensal", "Bimestral", "Trimestral", "Semestral", "Anual", "Único"];

const fmtDt = (s?: string) => { if (!s) return "—"; const d = new Date(s.length <= 10 ? s + "T12:00:00" : s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR"); };
const money = (v?: number | null) => (v == null || isNaN(Number(v))) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hoje = () => new Date().toISOString().slice(0, 10);
// Recorrência das contas: passo em meses por periodicidade + navegação por mês.
const PERIOD_STEP: Record<string, number> = { Mensal: 1, Bimestral: 2, Trimestral: 3, Semestral: 6, Anual: 12 };
const addMonthsISO = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const mesLabel = (ym: string) => { const [y, m] = String(ym).split("-"); return `${MESES_PT[+m - 1] ?? m}/${y}`; };
// Status efetivo da obrigação (deriva "Vencido" quando passou do vencimento e não foi pago).
const statusObr = (o: Obrigacao): "Pago" | "Vencido" | "Pendente" => {
  if (o.status === "Pago") return "Pago";
  if (o.vencimento && o.vencimento < hoje()) return "Vencido";
  return "Pendente";
};

const PATRIM_RESET = {
  codigo: "", tipo: "Imóvel", descricao: "", localizacao: "", placa: "", cidade: "",
  transferida: "Não", empresa: "", empresa_pagadora: "", proprietario: "", responsavel: "",
  centro_custo: "", status: "Ativo", observacoes: "",
  classificacao: "", matricula: "", possui_escritura: "", especie_escritura: "",
  situacao_pagamento: "", valor_contrato: "", valor_entrada: "",
  latitude: "", longitude: "",
};
const OBR_RESET = { categoria: "", modo_parcelas: "igual" as ModoParcelas, qtd_parcelas: "", descricao: "", valor: "", valor_entrada: "", vencimento: "", periodicidade: "Mensal", repetir: "0", onde_pagar: "", forma_pagamento: "", responsavel: "", seguradora: "", apolice: "", vigencia_inicio: "", vigencia_fim: "", premio: "", parcelas: "" };
const ehLink = (s?: string) => !!s && /^https?:\/\//i.test(s.trim());

export default function Patrimonios() {
  const { user } = useAuth();
  const nav = useNavigate();
  const autor = user?.user_metadata?.nome ?? user?.email ?? "Usuário";

  const [pats, setPats] = useState<Patrimonio[]>([]);
  const [obrAll, setObrAll] = useState<Obrigacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [fTipo, setFTipo] = useState("");
  // Os filtros da barra da carteira. Cada um recorta a MESMA lista — por isso
  // ficam juntos aqui e não espalhados por view.
  const [fSituacao, setFSituacao] = useState("");
  const [fClassificacao, setFClassificacao] = useState("");
  const [fCidade, setFCidade] = useState("");
  const [fProprietario, setFProprietario] = useState("");
  const [fEmpresaPag, setFEmpresaPag] = useState("");
  const [fEscritura, setFEscritura] = useState("");
  const [pagina, setPagina] = useState(1);
  const POR_PAGINA = 10;
  const [soPendentesTransf, setSoPendentesTransf] = useState(false);
  const [viewPag, setViewPag] = useState<"painel" | "lista" | "contas">("lista");
  const [mesContas, setMesContas] = useState<string>(hoje().slice(0, 7));
  // Cartão escolhido no Lançamento de Contas. null = "Gestão Patrimônios",
  // que é a soma de todos — é por onde a tela abre.
  const [contaPatSel, setContaPatSel] = useState<number | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  // modal patrimônio
  const [modalPat, setModalPat] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [pat, setPat] = useState({ ...PATRIM_RESET });

  // drawer
  const [sel, setSel] = useState<Patrimonio | null>(null);
  const [tab, setTab] = useState("obrigacoes");
  const [obrs, setObrs] = useState<Obrigacao[]>([]);
  const [mesObr, setMesObr] = useState<string>(""); // "" = todos os meses
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [acessos, setAcessos] = useState<Acesso[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [hist, setHist] = useState<Historico[]>([]);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [novoComentario, setNovoComentario] = useState("");

  // empregados do setor Jurídico (Trabalhando) — opções de "Responsável"
  const [empsJuridico, setEmpsJuridico] = useState<EmpJuridico[]>([]);

  // sub-modal obrigação
  const [modalObr, setModalObr] = useState(false);
  const [obrEditId, setObrEditId] = useState<number | null>(null);
  const [obr, setObr] = useState({ ...OBR_RESET });
  // Parcelas do contrato (Financiamento/Consórcio). Só existem ao CRIAR: abrir
  // uma parcela para editar mexe naquela linha, não no contrato inteiro.
  const [parcelasContrato, setParcelasContrato] = useState<LinhaParcela[]>([]);
  const [pagarAlvo, setPagarAlvo] = useState<Obrigacao | null>(null);
  const [pagarFile, setPagarFile] = useState<File | null>(null);

  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3200); };

  // ── Carregar lista + indicadores ───────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: o }] = await Promise.all([
      (supabase as any).from("JUR_PATRIMONIOS").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").select("id,patrimonio_id,categoria,descricao,valor,vencimento,status,pago_em,vigencia_fim,onde_pagar,comprovante_path,comprovante_nome"),
    ]);
    setPats(p ?? []); setObrAll(o ?? []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Empregados do setor Jurídico que estão Trabalhando (para o select de responsável).
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("EMPREGADOS")
        .select('"ID","Nome"')
        .eq("Setor_ERP", "JURIDICO")
        .eq("Situação", "Trabalhando")
        .order('"Nome"');
      setEmpsJuridico((data ?? []).map((e: any) => ({ id: e["ID"], nome: e["Nome"] ?? "" })).filter((e: EmpJuridico) => e.nome));
    })();
  }, []);

  const logHist = async (patId: number, acao: string, detalhe?: string) => {
    await (supabase as any).from("JUR_PATRIMONIO_ITENS").insert({ patrimonio_id: patId, kind: "historico", acao, detalhe, autor });
  };

  // O mapa acha a coordenada e devolve por aqui. Grava uma linha de cada vez:
  // fechar a tela no meio da busca não perde o que já foi localizado.
  const gravarCoordenada = useCallback(async (id: number, dados: any) => {
    const { error } = await (supabase as any).from("JUR_PATRIMONIOS")
      .update({ ...dados, geo_em: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    setPats(atual => atual.map(p => p.id === id ? { ...p, ...dados } : p));
  }, []);

  // Latitude sem longitude (ou coordenada fora do Brasil) é engano de
  // digitação: avisa na hora, senão o pino some ou vai parar no oceano.
  const avisoCoordenada = (() => {
    const temUm = !!String(pat.latitude ?? "").trim(), temOutro = !!String(pat.longitude ?? "").trim();
    if (temUm !== temOutro) return "Informe latitude E longitude — uma sozinha não posiciona nada.";
    if (temUm && temOutro && !coordenadaValida(pat.latitude, pat.longitude))
      return "Essa coordenada cai fora do Brasil. Confira os sinais: no Sul, latitude e longitude são negativas.";
    return null;
  })();

  // ── Patrimônio: salvar ─────────────────────────────────────────
  const proximoCodigo = () => {
    const nums = pats.map(p => parseInt(String(p.codigo || "").replace(/\D/g, ""), 10)).filter(n => !isNaN(n));
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  };
  const abrirNovoPat = () => { setEditId(null); setPat({ ...PATRIM_RESET, codigo: proximoCodigo() }); setModalPat(true); };
  // Do banco para o formulário: booleano vira o valor do select e número vira
  // texto, senão o input controlado troca de tipo no meio do caminho.
  const abrirEditarPat = (p: Patrimonio) => {
    setEditId(p.id);
    const txt = (v: unknown) => v == null ? "" : String(v);
    setPat({
      ...PATRIM_RESET, ...p,
      transferida: p.transferida ? "Sim" : "Não",
      possui_escritura: p.possui_escritura == null ? "" : p.possui_escritura ? "SIM" : "NAO",
      valor_contrato: txt(p.valor_contrato),
      valor_entrada: txt(p.valor_entrada),
      latitude: txt(p.latitude),
      longitude: txt(p.longitude),
      classificacao: txt(p.classificacao),
      matricula: txt(p.matricula),
      especie_escritura: txt(p.especie_escritura),
      situacao_pagamento: txt(p.situacao_pagamento),
    } as any);
    setModalPat(true);
  };
  const salvarPat = async () => {
    if (!pat.descricao.trim()) { toast("Informe a descrição.", "err"); return; }
    if (avisoCoordenada) { toast(avisoCoordenada, "err"); return; }
    const num = (v: string) => v === "" || v == null ? null : Number(String(v).replace(",", "."));
    const payload = {
      ...pat,
      transferida: pat.transferida === "Sim",
      // O select guarda "SIM"/"NAO"/"" e a coluna é booleana; "" vira null, que
      // é "ainda não sabemos", diferente de "não tem escritura".
      possui_escritura: pat.possui_escritura === "SIM" ? true : pat.possui_escritura === "NAO" ? false : null,
      valor_contrato: num(pat.valor_contrato),
      valor_entrada: num(pat.valor_entrada),
      // Coordenada digitada aqui é decisão de gente: entra como "manual" e o
      // botão "Localizar endereços" não passa por cima dela.
      latitude: num(pat.latitude),
      longitude: num(pat.longitude),
      ...(num(pat.latitude) != null && num(pat.longitude) != null
        ? { geo_status: "manual", geo_endereco: `${(pat.localizacao ?? "").trim()}|${(pat.cidade ?? "").trim()}`, geo_em: new Date().toISOString() }
        : {}),
      classificacao: pat.classificacao || null,
      matricula: pat.matricula || null,
      especie_escritura: pat.especie_escritura || null,
      situacao_pagamento: pat.situacao_pagamento || null,
      updated_at: new Date().toISOString(),
    };
    if (editId) {
      const { error } = await (supabase as any).from("JUR_PATRIMONIOS").update(payload).eq("id", editId);
      if (error) { toast("Erro: " + error.message, "err"); return; }
      await logHist(editId, "Patrimônio atualizado");
      toast("Patrimônio atualizado.", "ok");
    } else {
      const { data, error } = await (supabase as any).from("JUR_PATRIMONIOS").insert(payload).select("id").single();
      if (error) { toast("Erro: " + error.message, "err"); return; }
      if (data?.id) await logHist(data.id, "Patrimônio cadastrado");
      toast("Patrimônio cadastrado.", "ok");
    }
    setModalPat(false); load();
  };
  const excluirPat = async () => {
    if (!editId) return;
    if (!confirm(`Excluir o patrimônio "${pat.descricao}" e TODOS os dados vinculados (obrigações, contas, acessos, contatos, documentos, histórico e comentários)? Esta ação não pode ser desfeita.`)) return;
    // Remove os arquivos do storage (as linhas do banco somem por CASCADE, os arquivos não).
    const { data: dd } = await (supabase as any).from("JUR_PATRIMONIO_ITENS").select("storage_path").eq("kind", "documento").eq("patrimonio_id", editId);
    const paths = (dd ?? []).map((x: any) => x.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from("juridico-docs").remove(paths);
    const { error } = await (supabase as any).from("JUR_PATRIMONIOS").delete().eq("id", editId);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setModalPat(false); setSel(null); toast("Patrimônio excluído.", "ok"); load();
  };

  // ── Drawer: abrir e carregar relacionados ──────────────────────
  const abrirDrawer = async (p: Patrimonio) => {
    setSel(p); setTab("obrigacoes"); setNovoComentario("");
    setObrs([]); setParcelas([]); setAcessos([]); setContatos([]); setDocs([]); setHist([]); setComentarios([]);
    const [o, pc, a, c, d, h, cm] = await Promise.all([
      (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").select("*").eq("patrimonio_id", p.id).order("vencimento", { ascending: true }),
      // As parcelas do financiamento vêm na mesma leva; são centenas por
      // contrato, então ordena pela posição original da planilha.
      (supabase as any).from("JUR_PATRIMONIO_PARCELAS").select("*").eq("patrimonio_id", p.id).order("ordem", { ascending: true }).limit(1000),
      (supabase as any).from("JUR_PATRIMONIO_ITENS").select("*").eq("kind", "acesso").eq("patrimonio_id", p.id).order("id"),
      (supabase as any).from("JUR_PATRIMONIO_ITENS").select("*").eq("kind", "contato").eq("patrimonio_id", p.id).order("id"),
      (supabase as any).from("JUR_PATRIMONIO_ITENS").select("*").eq("kind", "documento").eq("patrimonio_id", p.id).order("created_at", { ascending: false }),
      (supabase as any).from("JUR_PATRIMONIO_ITENS").select("*").eq("kind", "historico").eq("patrimonio_id", p.id).order("created_at", { ascending: false }).limit(50),
      (supabase as any).from("SISTEMA_COMENTARIOS").select("*").eq("modulo", "patrimonio").eq("entidade_id", String(p.id)).order("created_at", { ascending: false }),
    ]);
    setObrs(o.data ?? []); setParcelas(pc.data ?? []); setAcessos(a.data ?? []); setContatos(c.data ?? []); setDocs(d.data ?? []); setHist(h.data ?? []); setComentarios(cm.data ?? []);
  };
  const recarregarObrs = async () => { if (!sel) return; const { data } = await (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").select("*").eq("patrimonio_id", sel.id).order("vencimento"); setObrs(data ?? []); load(); };
  const recarregarHist = async () => { if (!sel) return; const { data } = await (supabase as any).from("JUR_PATRIMONIO_ITENS").select("*").eq("kind", "historico").eq("patrimonio_id", sel.id).order("created_at", { ascending: false }).limit(50); setHist(data ?? []); };
  const recarregarComentarios = async () => { if (!sel) return; const { data } = await (supabase as any).from("SISTEMA_COMENTARIOS").select("*").eq("modulo", "patrimonio").eq("entidade_id", String(sel.id)).order("created_at", { ascending: false }); setComentarios(data ?? []); };

  // ── Obrigação ──────────────────────────────────────────────────
  const abrirNovaObr = () => { setObrEditId(null); setObr({ ...OBR_RESET }); setParcelasContrato([]); setModalObr(true); };

  // ── Bloco de parcelas do contrato ──────────────────────────────
  const contratoParcelado = ehContratoParcelado(obr.categoria) && !obrEditId;
  const gerar = () => {
    if (!obr.vencimento) { toast("Informe o vencimento da 1ª parcela.", "err"); return; }
    const qtd = Math.trunc(numParc(obr.qtd_parcelas));
    if (qtd <= 0) { toast("Informe quantas parcelas o contrato tem.", "err"); return; }
    if (qtd > 480) { toast("No máximo 480 parcelas (40 anos).", "err"); return; }
    if (numParc(obr.valor) <= 0) { toast("Informe o valor total do contrato.", "err"); return; }
    setParcelasContrato(gerarParcelas({
      total: obr.valor, entrada: obr.valor_entrada, quantidade: qtd,
      primeiroVencimento: obr.vencimento, periodicidade: obr.periodicidade,
    }));
  };
  const mexerParcela = (i: number, campo: "vencimento" | "valor", v: string) =>
    setParcelasContrato(ls => ls.map((l, idx) => idx === i ? { ...l, [campo]: v } : l));
  const removerParcela = (i: number) => setParcelasContrato(ls => renumerar(ls.filter((_, idx) => idx !== i)));
  const adicionarParcela = () => setParcelasContrato(ls => {
    const ultima = ls[ls.length - 1];
    const passoMes = ultima ? somaMeses(ultima.vencimento, 1) : (obr.vencimento || hoje());
    return renumerar([...ls, { numero: ls.length + 1, vencimento: passoMes, valor: ultima?.valor ?? "" }]);
  });
  // No modo "igual" o valor não se digita: vem do total menos a entrada,
  // dividido pela quantidade.
  const modoIgual = obr.modo_parcelas === "igual";
  // Modo "igual": corrigir o total (ou a entrada, a data, a periodicidade)
  // depois de gerar tem que refazer a tabela. Sem isto ela ficava mostrando os
  // valores do total ANTIGO, e a validação acusava diferença que a pessoa não
  // tinha como entender. A quantidade vem das linhas que estão na tela, para
  // que excluir uma parcela redistribua entre as que sobraram.
  useEffect(() => {
    if (!contratoParcelado || !modoIgual) return;
    setParcelasContrato(atual => {
      if (!atual.length) return atual;
      const novas = gerarParcelas({
        total: obr.valor, entrada: obr.valor_entrada, quantidade: atual.length,
        primeiroVencimento: obr.vencimento, periodicidade: obr.periodicidade,
      });
      return novas.length ? novas : atual;
    });
  }, [contratoParcelado, modoIgual, obr.valor, obr.valor_entrada, obr.vencimento, obr.periodicidade]);

  // O aviso aparece enquanto a pessoa digita, não só no Salvar.
  const avisoParcelas = parcelasContrato.length ? validarParcelas(parcelasContrato, obr.valor, obr.valor_entrada) : null;
  const abrirEditarObr = (o: Obrigacao) => {
    setObrEditId(o.id);
    // Os campos numéricos voltam do banco como number e os inputs são de texto;
    // sem converter, o React reclama de input controlado trocando de tipo.
    setObr({
      ...OBR_RESET, ...o,
      valor: o.valor != null ? String(o.valor) : "",
      premio: o.premio != null ? String(o.premio) : "",
      valor_entrada: o.valor_entrada != null ? String(o.valor_entrada) : "",
    } as any);
    setParcelasContrato([]);
    setModalObr(true);
  };
  const salvarObr = async () => {
    if (!sel) return;
    if (!obr.categoria) { toast("Selecione a categoria.", "err"); return; }
    const payload: any = {
      patrimonio_id: sel.id, categoria: obr.categoria, descricao: obr.descricao || null,
      valor: obr.valor ? Number(obr.valor) : null, vencimento: obr.vencimento || null,
      periodicidade: obr.periodicidade || null, forma_pagamento: obr.forma_pagamento || null,
      onde_pagar: obr.onde_pagar || null,
      responsavel: obr.responsavel || null, updated_at: new Date().toISOString(),
      seguradora: obr.seguradora || null, apolice: obr.apolice || null,
      vigencia_inicio: obr.vigencia_inicio || null, vigencia_fim: obr.vigencia_fim || null,
      premio: obr.premio ? Number(obr.premio) : null, parcelas: obr.parcelas || null,
      // Entrada só existe em financiamento/consórcio; nas outras vai null, senão
      // um valor digitado antes de trocar a categoria ficaria gravado escondido.
      valor_entrada: ehContratoParcelado(obr.categoria) && obr.valor_entrada ? Number(obr.valor_entrada) : null,
    };
    // 1-A) Contrato parcelado: uma LINHA POR PARCELA, amarradas por
    // contrato_uid. Cada parcela é uma conta de verdade — aparece na lista,
    // vai pro Malote e recebe comprovante — e é a soma das que não foram
    // pagas que vira o "valor que falta" do patrimônio.
    if (contratoParcelado) {
      const problema = validarParcelas(parcelasContrato, obr.valor, obr.valor_entrada);
      if (problema) { toast(problema, "err"); return; }
      const uid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      const linhas = parcelasContrato.map(l => ({
        ...payload,
        valor: numParc(l.valor),
        vencimento: l.vencimento,
        status: "Pendente",
        contrato_uid: uid,
        parcela_numero: l.numero,
        parcela_total: parcelasContrato.length,
        // A entrada é do CONTRATO, não de cada parcela: fica só na primeira,
        // senão o mesmo valor apareceria somado N vezes.
        valor_entrada: l.numero === 1 ? payload.valor_entrada : null,
      }));
      const { error } = await (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").insert(linhas);
      if (error) { toast("Erro ao gravar as parcelas: " + error.message, "err"); return; }
      await logHist(sel.id, "Contrato parcelado cadastrado",
        obr.categoria + " · " + linhas.length + "x · total " + money(totalGeral(parcelasContrato, obr.valor_entrada)));
      setMesObr(parcelasContrato[0].vencimento.slice(0, 7));
      setModalObr(false); toast(linhas.length + " parcelas lançadas.", "ok");
      recarregarObrs(); recarregarHist(); load();
      return;
    }
    const step = PERIOD_STEP[obr.periodicidade] || 0;
    const reps = parseInt(obr.repetir, 10) || 0;
    // 1) Cria ou atualiza a conta base.
    if (obrEditId) {
      const { error } = await (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").update(payload).eq("id", obrEditId);
      if (error) { toast("Erro: " + error.message, "err"); return; }
      await logHist(sel.id, "Obrigação atualizada", `${obr.categoria}`);
    } else {
      const { error } = await (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").insert({ ...payload, status: "Pendente" });
      if (error) { toast("Erro: " + error.message, "err"); return; }
      await logHist(sel.id, "Obrigação cadastrada", `${obr.categoria}${obr.vencimento ? " · venc. " + fmtDt(obr.vencimento) : ""}`);
    }
    // 2) Recorrência: cria as contas dos próximos meses (pula os que já existem).
    if (step > 0 && obr.vencimento && reps > 0) {
      const jaTem = new Set(obrs.filter(o => o.id !== obrEditId && o.categoria === obr.categoria && String(o.descricao || "") === String(obr.descricao || "")).map(o => o.vencimento));
      jaTem.add(obr.vencimento);
      const novas: any[] = [];
      for (let i = 1; i <= reps; i++) { const v = addMonthsISO(obr.vencimento, i * step); if (!jaTem.has(v)) { novas.push({ ...payload, vencimento: v, status: "Pendente" }); jaTem.add(v); } }
      if (novas.length) {
        const { error } = await (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").insert(novas);
        if (error) { toast("Erro ao gerar recorrência: " + error.message, "err"); return; }
        await logHist(sel.id, "Contas recorrentes geradas", `${obr.categoria} · ${novas.length} meses (${obr.periodicidade})`);
      }
      setMesObr(obr.vencimento.slice(0, 7));
    }
    setModalObr(false); toast("Obrigação salva.", "ok"); recarregarObrs(); recarregarHist(); load();
  };
  // Pagar (com comprovante opcional). Funciona com ou sem patrimônio aberto.
  const abrirPagar = (o: Obrigacao) => { setPagarAlvo(o); setPagarFile(null); };
  // "Pagar": se houver link cadastrado, abre o link de pagamento; em seguida pede o comprovante.
  // Pagar não é dar baixa: é abrir a despesa no MALOTE, que é por onde o
  // dinheiro sai. A conta vira despesa lá, passa pela aprovação de lá e só
  // então é paga — por isso a tela leva os dados prontos em vez de duplicar o
  // formulário do Malote aqui.
  const MESES_COMP = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const pagarConta = (o: Obrigacao) => {
    const venc = o.vencimento || hoje();
    const [ano, mes] = venc.slice(0, 10).split("-");
    const q = new URLSearchParams({
      rubrica: o.categoria || "",
      nome: `${o.categoria || "Despesa"}${sel ? " · " + sel.descricao : ""} — ${MESES_COMP[Number(mes) - 1] ?? mes}/${ano}`,
      valor: o.valor != null ? String(o.valor) : "",
      pagamento: venc.slice(0, 10),
      competencia: `${ano}-${mes}`,
      forma: o.forma_pagamento || "",
      // Onde pagar guarda ora o link, ora a linha digitável; no Malote isso é
      // "Informações de pagamento", que é onde o financeiro procura.
      info: o.onde_pagar || "",
    });
    nav(`/app/malote/criar-despesa?${q.toString()}`);
  };
  // Baixa manual: a conta foi paga por fora e o que falta é o comprovante.
  const baixarConta = (o: Obrigacao) => { if (ehLink(o.onde_pagar)) window.open(o.onde_pagar!.trim(), "_blank", "noopener"); abrirPagar(o); };
  const confirmarPagar = async () => {
    const o = pagarAlvo; if (!o) return;
    if (!pagarFile) { toast("Anexe o comprovante para registrar o pagamento.", "err"); return; }
    let cPath: string | null = null, cNome: string | null = null;
    if (pagarFile) {
      const safe = pagarFile.name.replace(/[^\w.\-]+/g, "_");
      const path = `${o.patrimonio_id}/comprovantes/${Date.now()}_${safe}`;
      const { error: up } = await supabase.storage.from("juridico-docs").upload(path, pagarFile, { upsert: false });
      if (up) { toast("Falha no upload do comprovante: " + up.message, "err"); return; }
      cPath = path; cNome = pagarFile.name;
    }
    const patch: any = { status: "Pago", pago_em: hoje() };
    if (cPath) { patch.comprovante_path = cPath; patch.comprovante_nome = cNome; }
    const { error } = await (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").update(patch).eq("id", o.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    await logHist(o.patrimonio_id, "Obrigação paga", `${o.categoria} · ${money(o.valor)}`);
    if (cNome) await logHist(o.patrimonio_id, "Comprovante anexado", `${o.categoria} · ${cNome}`);
    setPagarAlvo(null); setPagarFile(null);
    toast("Pagamento registrado.", "ok"); load(); if (sel) { recarregarObrs(); recarregarHist(); }
  };
  const verComprovante = async (o: Obrigacao) => {
    if (!o.comprovante_path) return;
    const { data, error } = await supabase.storage.from("juridico-docs").createSignedUrl(o.comprovante_path, 3600);
    if (error || !data?.signedUrl) { toast("Não foi possível abrir o comprovante.", "err"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const excluirObr = async (o: Obrigacao) => {
    if (o.status === "Pago" && o.comprovante_path) { toast("Conta paga com comprovante não pode ser excluída.", "err"); return; }
    if (!confirm("Excluir esta obrigação?")) return;
    await logHist(o.patrimonio_id, "Obrigação excluída", `${o.categoria}${o.vencimento ? " · venc. " + fmtDt(o.vencimento) : ""} · ${money(o.valor)}`);
    await (supabase as any).from("JUR_PATRIMONIO_OBRIGACOES").delete().eq("id", o.id);
    recarregarObrs(); if (sel) recarregarHist();
  };

  // ── Comentários (setor Jurídico) ───────────────────────────────
  const addComentario = async () => {
    if (!sel) return;
    const texto = novoComentario.trim();
    if (!texto) return;
    const { error } = await (supabase as any).from("SISTEMA_COMENTARIOS").insert({ modulo: "patrimonio", entidade_id: String(sel.id), texto, autor_nome: autor });
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setNovoComentario(""); toast("Comentário adicionado.", "ok"); recarregarComentarios();
  };
  const excluirComentario = async (c: Comentario) => {
    if (!confirm("Excluir este comentário?")) return;
    await (supabase as any).from("SISTEMA_COMENTARIOS").delete().eq("id", c.id);
    setComentarios(x => x.filter(i => i.id !== c.id));
  };

  // ── Acessos / Contatos (add inline) ────────────────────────────
  const addAcesso = async () => {
    if (!sel) return;
    const { data } = await (supabase as any).from("JUR_PATRIMONIO_ITENS").insert({ patrimonio_id: sel.id, kind: "acesso", servico: "", link: "", usuario: "", local_senha: "" }).select("*").single();
    if (data) setAcessos(a => [...a, data]);
  };
  const salvarAcesso = async (a: Acesso) => { await (supabase as any).from("JUR_PATRIMONIO_ITENS").update({ servico: a.servico, link: a.link, usuario: a.usuario, local_senha: a.local_senha, observacao: a.observacao }).eq("id", a.id); };
  const excluirAcesso = async (id: number) => { await (supabase as any).from("JUR_PATRIMONIO_ITENS").delete().eq("id", id); setAcessos(a => a.filter(x => x.id !== id)); };
  const addContato = async () => {
    if (!sel) return;
    const { data } = await (supabase as any).from("JUR_PATRIMONIO_ITENS").insert({ patrimonio_id: sel.id, kind: "contato", tipo: "", nome: "", telefone: "", email: "" }).select("*").single();
    if (data) setContatos(c => [...c, data]);
  };
  const salvarContato = async (c: Contato) => { await (supabase as any).from("JUR_PATRIMONIO_ITENS").update({ tipo: c.tipo, nome: c.nome, telefone: c.telefone, email: c.email, observacao: c.observacao }).eq("id", c.id); };
  const excluirContato = async (id: number) => { await (supabase as any).from("JUR_PATRIMONIO_ITENS").delete().eq("id", id); setContatos(c => c.filter(x => x.id !== id)); };

  // ── Documentos ─────────────────────────────────────────────────
  const uploadDoc = async (file: File, tipo: string) => {
    if (!sel || !file) return;
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${sel.id}/${Date.now()}_${safe}`;
    const { error: up } = await supabase.storage.from("juridico-docs").upload(path, file, { upsert: false });
    if (up) { toast("Falha no upload: " + up.message, "err"); return; }
    const { data } = await (supabase as any).from("JUR_PATRIMONIO_ITENS").insert({ patrimonio_id: sel.id, kind: "documento", tipo, nome: file.name, storage_path: path, criado_por: autor }).select("*").single();
    if (data) setDocs(d => [data, ...d]);
    await logHist(sel.id, "Documento anexado", `${tipo}: ${file.name}`); recarregarHist();
    toast("Documento anexado.", "ok");
  };
  const baixarDoc = async (d: Documento) => {
    if (!d.storage_path) return;
    const { data, error } = await supabase.storage.from("juridico-docs").createSignedUrl(d.storage_path, 3600);
    if (error || !data?.signedUrl) { toast("Não foi possível abrir.", "err"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const excluirDoc = async (d: Documento) => {
    if (!confirm("Excluir este documento?")) return;
    if (d.storage_path) await supabase.storage.from("juridico-docs").remove([d.storage_path]);
    await (supabase as any).from("JUR_PATRIMONIO_ITENS").delete().eq("id", d.id);
    setDocs(x => x.filter(i => i.id !== d.id));
  };

  // ── Indicadores ────────────────────────────────────────────────
  const ativos = pats.filter(p => p.status === "Ativo").length;
  const naoPagas = obrAll.filter(o => o.status !== "Pago");
  const vencidas = naoPagas.filter(o => o.vencimento && o.vencimento < hoje()).length;
  const mesAtual = hoje().slice(0, 7);
  const pagoMes = obrAll.filter(o => o.status === "Pago" && (o.pago_em || "").slice(0, 7) === mesAtual).reduce((s, o) => s + (Number(o.valor) || 0), 0);
  const pendentesTransf = pats.filter(p => !p.transferida).length;
  const totalPrevisto = naoPagas.reduce((s, o) => s + (Number(o.valor) || 0), 0);
  // Alerta: contas em aberto vencidas OU vencendo nos próximos 10 dias.
  const em10dias = (() => { const d = new Date(hoje() + "T00:00:00"); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10); })();
  const contasAlerta = naoPagas.filter(o => o.vencimento && o.vencimento <= em10dias).sort((a, b) => String(a.vencimento || "").localeCompare(String(b.vencimento || "")));

  // ── Dashboard: agregações ──────────────────────────────────────
  const porTipo = TIPOS.map(t => ({ tipo: t, n: pats.filter(p => p.tipo === t).length })).filter(x => x.n > 0);
  const maxTipo = Math.max(1, ...porTipo.map(x => x.n));
  const catMap: Record<string, number> = {};
  obrAll.forEach(o => { const k = o.categoria || "Outros"; catMap[k] = (catMap[k] || 0) + (Number(o.valor) || 0); });
  const porCategoria = Object.entries(catMap).map(([categoria, valor]) => ({ categoria, valor })).filter(x => x.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, 8);
  const maxCat = Math.max(1, ...porCategoria.map(x => x.valor));
  const obrPorPat = pats.map(p => {
    const os = obrAll.filter(o => o.patrimonio_id === p.id);
    const naoPg = os.filter(o => o.status !== "Pago");
    const venc = naoPg.filter(o => o.vencimento && o.vencimento < hoje()).length;
    const prev = naoPg.reduce((s, o) => s + (Number(o.valor) || 0), 0);
    const pg = os.filter(o => o.status === "Pago").reduce((s, o) => s + (Number(o.valor) || 0), 0);
    return { p, n: os.length, venc, prev, pg };
  }).filter(x => x.n > 0).sort((a, b) => b.venc - a.venc || b.prev - a.prev);

  const listaFiltrada = pats.filter(p => {
    if (fTipo && p.tipo !== fTipo) return false;
    if (fSituacao && String(p.situacao_pagamento ?? "") !== fSituacao) return false;
    if (fClassificacao && String(p.classificacao ?? "") !== fClassificacao) return false;
    if (fCidade && String(p.cidade ?? "") !== fCidade) return false;
    if (fProprietario && String(p.proprietario ?? "") !== fProprietario) return false;
    if (fEmpresaPag && String(p.empresa_pagadora ?? "") !== fEmpresaPag) return false;
    // "" = todos; a coluna é booleana e pode estar em branco no cadastro antigo.
    if (fEscritura === "SIM" && p.possui_escritura !== true) return false;
    if (fEscritura === "NAO" && p.possui_escritura !== false) return false;
    if (soPendentesTransf && p.transferida) return false;
    if (busca) { const q = busca.toLowerCase(); return [p.descricao, p.codigo, p.localizacao, p.placa, p.cidade, p.empresa, p.responsavel, p.proprietario, p.empresa_pagadora, p.matricula].some(x => (x || "").toLowerCase().includes(q)); }
    return true;
  });
  // Opções dos selects: saem do que EXISTE na carteira, não de uma lista fixa —
  // filtro que oferece valor sem resultado só faz o usuário perder viagem.
  const opcoesDe = (campo: keyof Patrimonio) =>
    [...new Set(pats.map(p => String(p[campo] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const totalPaginas = Math.max(1, Math.ceil(listaFiltrada.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const pagFatia = listaFiltrada.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  // KPIs da carteira: o quanto foi contratado e o quanto ainda falta pagar.
  // Os dois vêm da mesma régua da tabela — contrato do cadastro, falta das
  // parcelas em aberto — para o topo da tela e a coluna nunca discordarem.
  const somar = (f: (p: Patrimonio) => number | undefined) =>
    listaFiltrada.reduce((s, p) => s + (Number(f(p)) || 0), 0);
  // "Valor que falta" NÃO sai mais de JUR_PATRIMONIOS.valor_falta: aquilo veio
  // da importação e ninguém atualizava quando uma parcela era paga. Agora é a
  // soma das parcelas em aberto de Financiamento/Consórcio nas obrigações, que
  // se corrige sozinha a cada baixa.
  const faltaPorPatrimonio = useMemo(() => mapaValorQueFalta(obrAll), [obrAll]);
  const faltaDe = (id: number) => faltaPorPatrimonio.get(Number(id)) ?? 0;
  const totalContratos = somar(p => p.valor_contrato);
  const totalFalta = listaFiltrada.reduce((acc, p) => acc + faltaDe(p.id), 0);
  const qtdPagando = listaFiltrada.filter(p => String(p.situacao_pagamento ?? "").toUpperCase().startsWith("PAGANDO")).length;
  const qtdPagos = listaFiltrada.filter(p => String(p.situacao_pagamento ?? "").toUpperCase() === "PAGO").length;
  const pct = (v: number, total: number) => total > 0 ? `${(v / total * 100).toFixed(2).replace(".", ",")}% do total` : "—";

  const card = (label: string, valor: string | number, cor: string, apoio?: string) => {
    const txt = String(valor);
    const fs = txt.length > 16 ? 17 : txt.length > 12 ? 21 : 26;   // encolhe p/ valores longos (ex.: bilhões)
    return (
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 18px", flex: 1, minWidth: 150, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
        <div style={{ fontSize: fs, fontWeight: 800, color: cor, marginTop: 4, overflowWrap: "anywhere" }}>{valor}</div>
        {apoio && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{apoio}</div>}
      </div>
    );
  };
  const barRow = (label: string, val: number, max: number, cor: string, right: string) => (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, gap: 8 }}>
        <span style={{ color: "#475569", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ color: "#0f172a", fontWeight: 800, whiteSpace: "nowrap" }}>{right}</span>
      </div>
      <div style={{ height: 10, background: "#eef2f7", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(3, Math.round((val / max) * 100))}%`, height: "100%", background: cor, borderRadius: 6 }} />
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <style>{`
        .jp-fi{width:100%;height:40px;border:1px solid #cbd5e1;border-radius:9px;padding:0 11px;font-size:13px;background:#fff;box-sizing:border-box}
        textarea.jp-fi{height:auto;padding:9px 11px;resize:vertical}
        .jp-fi:focus{outline:none;border-color:#0f3171;box-shadow:0 0 0 3px rgba(15,49,113,.1)}
        .jp-fg label{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
        .jp-fg{margin-bottom:11px}
        .jp-btn{border:none;border-radius:9px;font-weight:700;cursor:pointer;font-size:12px;padding:8px 14px}
        .jp-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
        .jp-modal{background:#fff;border-radius:16px;padding:22px;width:100%;max-width:620px;max-height:92vh;overflow-y:auto;position:relative;box-shadow:0 16px 40px rgba(15,23,42,.18)}
        .jp-drawer-ov{position:fixed;inset:0;z-index:680;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;justify-content:flex-end}
        .jp-drawer{width:92%;max-width:860px;height:100%;background:#f8fafc;display:flex;flex-direction:column;box-shadow:-20px 0 50px rgba(15,23,42,.18)}
        .jp-tab{padding:9px 14px;border:none;background:none;font-size:13px;font-weight:700;color:#64748b;cursor:pointer;border-bottom:2px solid transparent}
        .jp-tab.on{color:#0f3171;border-bottom-color:#0f3171}
        .jp-row{display:flex;gap:10px}
        @media(max-width:640px){.jp-row{flex-direction:column}}
        .jp-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        @media(max-width:560px){.jp-grid2{grid-template-columns:1fr}}
      `}</style>

      {/* Topbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 16, background: "linear-gradient(135deg,#fff,#f8fbff)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f3171" }}>⚖️ Gestão Patrimonial e Obrigações</div>
        <button className="jp-btn" onClick={abrirNovoPat} style={{ background: "#0f3171", color: "#fff", boxShadow: "0 10px 22px rgba(15,49,113,.18)" }}>+ Novo Patrimônio</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 28px" }}>
        {/* Indicadores. Na aba da carteira são os números do patrimônio; na de
            contas, os do mês — a pergunta de cada aba é diferente. */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {viewPag === "contas" ? (<>
            {card("Patrimônios ativos", ativos, "#0f3171")}
            {card("Pendentes transferência", pendentesTransf, pendentesTransf > 0 ? "#ea580c" : "#16a34a")}
            {card("Obrigações vencidas", vencidas, vencidas > 0 ? "#dc2626" : "#16a34a")}
            {card("A pagar (em aberto)", money(totalPrevisto), "#0f3171")}
            {card("Pago no mês", money(pagoMes), "#15803d")}
          </>) : (<>
            {card("Total de Patrimônios", listaFiltrada.length, "#0f3171", "100% do total")}
            {card("Patrimônios Pagando", qtdPagando, "#2563eb", pct(qtdPagando, listaFiltrada.length))}
            {card("Patrimônios Quitados", qtdPagos, "#7c3aed", pct(qtdPagos, listaFiltrada.length))}
            {card("Valor Total dos Contratos", money(totalContratos), "#ea580c", "Somatório do valor de contrato cadastrado")}
            {/* Mesma conta da coluna "Valor que falta": parcelas em aberto de
                Financiamento/Consórcio. O apoio mostra quanto isso é do
                contratado, que é a leitura de quanto já foi quitado. */}
            {card("Valor Total que Falta Pagar", money(totalFalta), "#dc2626", pct(totalFalta, totalContratos))}
          </>)}
        </div>

        {/* Alerta: contas vencendo (≤10 dias) ou vencidas */}
        {contasAlerta.length > 0 && (
          <div style={{ background: "linear-gradient(135deg,#fff7ed,#ffffff)", border: "1px solid #fed7aa", borderRadius: 14, padding: "14px 16px", marginBottom: 16, boxShadow: "0 8px 24px rgba(234,88,12,.08)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18 }}>⏰</span>
              <span style={{ fontWeight: 800, color: "#9a3412" }}>{contasAlerta.length} conta(s) a vencer / vencida(s)</span>
              <span style={{ fontSize: 12, color: "#c2410c" }}>(vencidas ou vencendo nos próximos 10 dias)</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {contasAlerta.slice(0, 6).map(o => {
                const venc = o.vencimento!;
                const dias = Math.round((new Date(venc + "T00:00:00").getTime() - new Date(hoje() + "T00:00:00").getTime()) / 86400000);
                const atrasada = dias < 0;
                const patN = pats.find(p => p.id === o.patrimonio_id)?.descricao || "—";
                return (
                  <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "#fff", border: "1px solid #fee2d5", borderRadius: 10, padding: "8px 12px" }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: "#0f172a" }}>{patN}</span>
                      <span style={{ color: "#64748b" }}> · {o.categoria}{o.descricao ? ` · ${o.descricao}` : ""}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, color: "#0f172a" }}>{money(o.valor)}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 10px", borderRadius: 20, background: atrasada ? "#fee2e2" : "#ffedd5", color: atrasada ? "#dc2626" : "#ea580c" }}>{atrasada ? `Vencida há ${Math.abs(dias)}d` : dias === 0 ? "Vence hoje" : `Vence em ${dias}d`} · {fmtDt(venc)}</span>
                      <button className="jp-btn" onClick={() => pagarConta(o)} style={{ background: "#0f3171", color: "#fff", border: "1px solid #0f3171", padding: "4px 12px", fontWeight: 700 }}>Pagar</button>
                      <button className="jp-btn" title="Já foi paga por fora: anexar o comprovante e dar baixa" onClick={() => baixarConta(o)} style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", padding: "4px 10px", fontWeight: 700 }}>✓ Baixar</button>
                    </div>
                  </div>
                );
              })}
              {contasAlerta.length > 6 && <div style={{ fontSize: 12, color: "#9a3412", fontWeight: 600 }}>+{contasAlerta.length - 6} outra(s). Veja em “Listagem de Contas”.</div>}
            </div>
          </div>
        )}

        {/* Abas. "Livro de patrimônios" ainda não tem tela desenhada: aparece
            desabilitada em vez de sumir, para o desenho continuar completo e
            ninguém procurar onde ela foi parar. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button className="jp-btn" onClick={() => { setViewPag("lista"); setPagina(1); }} style={{ background: viewPag === "lista" ? "#0f3171" : "#fff", color: viewPag === "lista" ? "#fff" : "#64748b", border: "1px solid " + (viewPag === "lista" ? "#0f3171" : "#e2e8f0") }}>🏢 Patrimônios</button>
          <button className="jp-btn" disabled title="Em breve" style={{ background: "#f8fafc", color: "#cbd5e1", border: "1px solid #e2e8f0", cursor: "not-allowed" }}>📗 Livro de patrimônios</button>
          <button className="jp-btn" onClick={() => { setViewPag("contas"); setPagina(1); }} style={{ background: viewPag === "contas" ? "#0f3171" : "#fff", color: viewPag === "contas" ? "#fff" : "#64748b", border: "1px solid " + (viewPag === "contas" ? "#0f3171" : "#e2e8f0") }}>📑 Lançamento de Contas</button>
          <button className="jp-btn" onClick={() => { setViewPag("painel"); setPagina(1); }} style={{ background: viewPag === "painel" ? "#0f3171" : "#fff", color: viewPag === "painel" ? "#fff" : "#64748b", border: "1px solid " + (viewPag === "painel" ? "#0f3171" : "#e2e8f0") }}>📊 Painel</button>
        </div>

        {/* ── PAINEL (dashboard) ── */}
        {viewPag === "painel" && (<>
          <div className="jp-row" style={{ marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f3171", marginBottom: 14 }}>Patrimônios por tipo</div>
              {porTipo.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>Sem dados.</div> : porTipo.map(x => <div key={x.tipo}>{barRow(x.tipo, x.n, maxTipo, "#0f3171", String(x.n))}</div>)}
            </div>
            <div style={{ flex: 1, minWidth: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f3171", marginBottom: 14 }}>Obrigações por categoria (R$)</div>
              {porCategoria.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>Sem obrigações lançadas.</div> : porCategoria.map(x => <div key={x.categoria}>{barRow(x.categoria, x.valor, maxCat, "#7c3aed", money(x.valor))}</div>)}
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
            <div style={{ padding: "14px 18px", fontSize: 13, fontWeight: 800, color: "#0f3171", borderBottom: "1px solid #eef2f7" }}>Contas / Obrigações por patrimônio</div>
            {loading ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
              : obrPorPat.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Nenhuma conta/obrigação lançada ainda.</div>
                : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px" }}>
                        <th style={{ textAlign: "left", padding: "10px 14px" }}>Patrimônio</th>
                        <th style={{ textAlign: "left", padding: "10px 14px" }}>Tipo</th>
                        <th style={{ textAlign: "center", padding: "10px 14px" }}>Itens</th>
                        <th style={{ textAlign: "right", padding: "10px 14px" }}>A pagar</th>
                        <th style={{ textAlign: "right", padding: "10px 14px" }}>Pago</th>
                        <th style={{ textAlign: "center", padding: "10px 14px" }}>Vencidas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {obrPorPat.map(x => (
                        <tr key={x.p.id} onClick={() => abrirDrawer(x.p)} style={{ borderTop: "1px solid #eef2f7", cursor: "pointer" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fbff")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                          <td style={{ padding: "11px 14px", fontWeight: 700, color: "#0f172a" }}>{x.p.descricao}</td>
                          <td style={{ padding: "11px 14px", color: "#475569" }}>{x.p.tipo}</td>
                          <td style={{ padding: "11px 14px", color: "#475569", textAlign: "center" }}>{x.n}</td>
                          <td style={{ padding: "11px 14px", color: "#0f172a", fontWeight: 700, textAlign: "right" }}>{money(x.prev)}</td>
                          <td style={{ padding: "11px 14px", color: "#15803d", textAlign: "right" }}>{money(x.pg)}</td>
                          <td style={{ padding: "11px 14px", textAlign: "center" }}>{x.venc > 0 ? <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#fee2e2", color: "#dc2626" }}>{x.venc}</span> : <span style={{ color: "#94a3b8" }}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        </>)}

        {/* ── PATRIMÔNIOS (a carteira) ── */}
        {viewPag === "lista" && (<>
          {/* Filtros */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", marginBottom: 14, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 150, flex: 1 }}>
              <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Situação</label>
              <select className="jp-fi" value={fSituacao} onChange={e => { setFSituacao(e.target.value); setPagina(1); }}>
                <option value="">Selecione</option>
                {SITUACOES_PAGAMENTO.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 150, flex: 1 }}>
              <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Classificação</label>
              <select className="jp-fi" value={fClassificacao} onChange={e => { setFClassificacao(e.target.value); setPagina(1); }}>
                <option value="">Selecione</option>
                {[...new Set([...CLASSIFICACOES, ...opcoesDe("classificacao")])].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 150, flex: 1 }}>
              <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Cidades</label>
              <select className="jp-fi" value={fCidade} onChange={e => { setFCidade(e.target.value); setPagina(1); }}>
                <option value="">Selecione</option>
                {opcoesDe("cidade").map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 150, flex: 1 }}>
              <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Proprietário</label>
              <select className="jp-fi" value={fProprietario} onChange={e => { setFProprietario(e.target.value); setPagina(1); }}>
                <option value="">Selecione</option>
                {opcoesDe("proprietario").map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 150, flex: 1 }}>
              <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Empresa que pagará</label>
              <select className="jp-fi" value={fEmpresaPag} onChange={e => { setFEmpresaPag(e.target.value); setPagina(1); }}>
                <option value="">Selecione</option>
                {opcoesDe("empresa_pagadora").map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 150, flex: 1 }}>
              <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Escritura</label>
              <select className="jp-fi" value={fEscritura} onChange={e => { setFEscritura(e.target.value); setPagina(1); }}>
                <option value="">Selecione</option>
                <option value="SIM">Sim</option><option value="NAO">Não</option>
              </select>
            </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Buscar patrimônio</label>
                <input className="jp-fi" placeholder="Digite endereço, descrição, matrícula ou proprietário…" value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); }} />
              </div>
              <button className="jp-btn" onClick={() => setPagina(1)} style={{ background: "#0f3171", color: "#fff", height: 40 }}>🔎 Filtrar</button>
              <button className="jp-btn" onClick={() => { setFSituacao(""); setFClassificacao(""); setFCidade(""); setFProprietario(""); setFEmpresaPag(""); setFEscritura(""); setBusca(""); setPagina(1); }} style={{ background: "#fff", color: "#475569", border: "1px solid #e2e8f0", height: 40 }}>↺ Limpar</button>
            </div>
          </div>

          {/* Mapa */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", marginBottom: 14, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>Mapa dos patrimônios</div>
            <MapaPatrimonios patrimonios={listaFiltrada} onLocalizar={gravarCoordenada} />
          </div>

          {/* Carteira */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", padding: "14px 16px 10px" }}>Carteira / Obrigações por patrimônio</div>
            {loading ? (
              <div style={{ padding: 50, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
            ) : listaFiltrada.length === 0 ? (
              <div style={{ padding: 50, textAlign: "center", color: "#94a3b8" }}>Nenhum patrimônio no recorte. Clique em "+ Novo Patrimônio".</div>
            ) : (<>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", color: "#94a3b8", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".5px" }}>
                      {["#", "Situação", "Próxima parcela", "Classificação", "Descrição", "Endereço", "Cidade", "Proprietário", "Escritura", "Matrícula", "Empresa que pagará", "Valor do contrato", "Valor que falta", "Possui escritura"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontWeight: 800 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagFatia.map((p, i) => {
                      const c = corSituacao(p.situacao_pagamento);
                      return (
                        <tr key={p.id} onClick={() => abrirDrawer(p)} style={{ borderTop: "1px solid #eef2f7", cursor: "pointer" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fbff")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                          <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{(paginaAtual - 1) * POR_PAGINA + i + 1}</td>
                          <td style={{ padding: "10px 12px" }}>
                            {p.situacao_pagamento
                              ? <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: c.bg, color: c.fg }}>{p.situacao_pagamento}</span>
                              : <span style={{ color: "#cbd5e1" }}>—</span>}
                          </td>
                          <td style={{ padding: "10px 12px", color: "#475569" }}>{p.proxima_parcela ? fmtDt(p.proxima_parcela) : "—"}</td>
                          <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0f172a" }}>{p.classificacao || p.tipo || "—"}</td>
                          <td style={{ padding: "10px 12px", color: "#475569" }}>{p.descricao || "—"}</td>
                          <td style={{ padding: "10px 12px", color: "#475569", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={p.localizacao || ""}>{p.localizacao || p.placa || "—"}</td>
                          <td style={{ padding: "10px 12px", color: "#475569" }}>{p.cidade || "—"}</td>
                          <td style={{ padding: "10px 12px", color: "#475569", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={p.proprietario || ""}>{p.proprietario || "—"}</td>
                          <td style={{ padding: "10px 12px", color: "#475569" }}>{p.especie_escritura || "—"}</td>
                          <td style={{ padding: "10px 12px", color: "#475569" }}>{p.matricula || "—"}</td>
                          <td style={{ padding: "10px 12px", color: "#475569" }}>{p.empresa_pagadora || "—"}</td>
                          <td style={{ padding: "10px 12px", color: "#0f172a", fontWeight: 700 }}>{p.valor_contrato != null ? money(p.valor_contrato) : "—"}</td>
                          <td style={{ padding: "10px 12px", color: faltaDe(p.id) > 0 ? "#b45309" : "#15803d", fontWeight: 700 }}
                              title={faltaDe(p.id) > 0 ? "Soma das parcelas em aberto de Financiamento/Consórcio" : "Nenhuma parcela em aberto"}>
                            {faltaDe(p.id) > 0 ? money(faltaDe(p.id)) : "—"}</td>
                          <td style={{ padding: "10px 12px", fontWeight: 800, color: p.possui_escritura ? "#15803d" : "#94a3b8" }}>{p.possui_escritura == null ? "—" : p.possui_escritura ? "SIM" : "NÃO"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 16px", borderTop: "1px solid #eef2f7", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  {(paginaAtual - 1) * POR_PAGINA + 1}-{Math.min(paginaAtual * POR_PAGINA, listaFiltrada.length)} de {listaFiltrada.length.toLocaleString("pt-BR")} registros
                </span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button className="jp-btn" disabled={paginaAtual === 1} onClick={() => setPagina(1)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: paginaAtual === 1 ? "#cbd5e1" : "#475569" }}>«</button>
                  <button className="jp-btn" disabled={paginaAtual === 1} onClick={() => setPagina(p => Math.max(1, p - 1))} style={{ background: "#fff", border: "1px solid #e2e8f0", color: paginaAtual === 1 ? "#cbd5e1" : "#475569" }}>‹</button>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", padding: "0 6px" }}>{paginaAtual} / {totalPaginas}</span>
                  <button className="jp-btn" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} style={{ background: "#fff", border: "1px solid #e2e8f0", color: paginaAtual === totalPaginas ? "#cbd5e1" : "#475569" }}>›</button>
                  <button className="jp-btn" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(totalPaginas)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: paginaAtual === totalPaginas ? "#cbd5e1" : "#475569" }}>»</button>
                </div>
              </div>
            </>)}
          </div>
        </>)}

        {/* ── LANÇAMENTO DE CONTAS ── */}
        {viewPag === "contas" && (() => {
          const pendente = (o: Obrigacao) => statusObr(o) !== "Pago";
          // Um cartão por patrimônio COM conta, mais o cartão do todo. A
          // contagem é de pendentes: é o que faz alguém abrir a tela.
          const cartoes = pats
            .map(p => ({ p, contas: obrAll.filter(o => o.patrimonio_id === p.id) }))
            .filter(x => x.contas.length > 0)
            .map(x => ({ ...x, pendentes: x.contas.filter(pendente).length }))
            .sort((a, b) => b.pendentes - a.pendentes || a.p.descricao.localeCompare(b.p.descricao, "pt-BR"));
          const totalPendentes = obrAll.filter(pendente).length;

          const doCartao = contaPatSel == null ? obrAll : obrAll.filter(o => o.patrimonio_id === contaPatSel);
          const contasMes = mesContas ? doCartao.filter(o => (o.vencimento || "").slice(0, 7) === mesContas) : doCartao;
          const navMesC = (delta: number) => setMesContas(addMonthsISO((mesContas || hoje().slice(0, 7)) + "-01", delta).slice(0, 7));
          const patNome = (id: number) => pats.find(p => p.id === id)?.descricao || "—";
          const totalMes = contasMes.reduce((s, o) => s + (Number(o.valor) || 0), 0);

          const cartao = (chave: string, titulo: string, sub: string, ativo: boolean, aoClicar: () => void) => (
            <button key={chave} onClick={aoClicar} style={{
              textAlign: "left", cursor: "pointer", minWidth: 210, flex: "0 0 auto",
              background: ativo ? "#0f3171" : "#fff", color: ativo ? "#fff" : "#0f172a",
              border: "1px solid " + (ativo ? "#0f3171" : "#e2e8f0"), borderRadius: 14,
              padding: "13px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)", fontFamily: "inherit",
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titulo}</div>
              <div style={{ fontSize: 11.5, color: ativo ? "rgba(255,255,255,.75)" : "#94a3b8", marginTop: 3 }}>{sub}</div>
            </button>
          );

          return (<>
            {/* Cartões por patrimônio */}
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6, marginBottom: 14 }}>
              {cartao("todos", "Gestão Patrimônios", `${totalPendentes} conta(s) pendente(s)`, contaPatSel == null, () => setContaPatSel(null))}
              {cartoes.map(({ p, pendentes }) => cartao(String(p.id), p.descricao, `${pendentes} conta(s) pendente(s)`, contaPatSel === p.id, () => setContaPatSel(p.id)))}
            </div>

            {/* Mês */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <button className="jp-btn" onClick={() => navMesC(-1)} style={{ background: "#eef4ff", color: "#0f3171", padding: "8px 11px" }}>‹</button>
              <span style={{ fontWeight: 700, color: "#0f172a", minWidth: 130, textAlign: "center" }}>{mesContas ? mesLabel(mesContas) : "Todos os meses"}</span>
              <button className="jp-btn" onClick={() => navMesC(1)} style={{ background: "#eef4ff", color: "#0f3171", padding: "8px 11px" }}>›</button>
              <button className="jp-btn" onClick={() => setMesContas("")} style={{ background: mesContas ? "#fff" : "#0f3171", color: mesContas ? "#64748b" : "#fff", border: "1px solid " + (mesContas ? "#e2e8f0" : "#0f3171") }}>Todos</button>
              {contaPatSel != null && (
                <button className="jp-btn" onClick={() => { const p = pats.find(x => x.id === contaPatSel); if (p) { abrirDrawer(p); } }} style={{ background: "#fff", color: "#0f3171", border: "1px solid #dbe4f0" }}>+ Nova obrigação</button>
              )}
              <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Total: {money(totalMes)}</span>
            </div>

            {/* Contas do recorte */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
              {contasMes.length === 0 ? (
                <div style={{ padding: 46, textAlign: "center", color: "#94a3b8" }}>Nenhuma conta {mesContas ? `em ${mesLabel(mesContas)}` : "cadastrada"} neste recorte.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {[...contasMes].sort((a, b) => String(a.vencimento || "").localeCompare(String(b.vencimento || ""))).map(o => {
                      const st = statusObr(o);
                      const cor = st === "Pago" ? "#16a34a" : st === "Vencido" ? "#dc2626" : "#ea580c";
                      return (
                        <tr key={o.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px 16px" }}>
                            <div style={{ fontWeight: 700, color: "#0f172a" }}>{o.categoria}<span style={{ color: "#94a3b8", fontWeight: 500 }}> · {patNome(o.patrimonio_id)}</span></div>
                            {o.descricao && <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{o.descricao}</div>}
                            {o.onde_pagar && (ehLink(o.onde_pagar)
                              ? <a href={o.onde_pagar} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: "#0f3171", fontWeight: 700, textDecoration: "none" }}>🔗 Pagar aqui</a>
                              : <div style={{ fontSize: 11.5, color: "#94a3b8" }}>📍 {o.onde_pagar}</div>)}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#475569", whiteSpace: "nowrap" }}>{o.vencimento ? "Venc. " + fmtDt(o.vencimento) : "—"}</td>
                          <td style={{ padding: "10px 14px", color: "#64748b", whiteSpace: "nowrap" }}>{o.periodicidade || "—"}</td>
                          <td style={{ padding: "10px 14px", color: "#64748b", whiteSpace: "nowrap" }}>{o.forma_pagamento || "—"}</td>
                          <td style={{ padding: "10px 14px", color: "#64748b", whiteSpace: "nowrap" }}>{o.parcelas ? "Parcela: " + o.parcelas : ""}</td>
                          <td style={{ padding: "10px 14px", fontWeight: 700, color: "#0f172a", textAlign: "right", whiteSpace: "nowrap" }}>{money(o.valor)}</td>
                          <td style={{ padding: "10px 14px", textAlign: "center" }}><span style={{ fontSize: 11, fontWeight: 800, padding: "2px 10px", borderRadius: 20, background: cor + "20", color: cor }}>{st}</span></td>
                          <td style={{ padding: "10px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div style={{ display: "inline-flex", gap: 6 }}>
                              {o.comprovante_path && <button className="jp-btn" title="Ver comprovante" onClick={() => verComprovante(o)} style={{ background: "#eef4ff", color: "#0f3171", border: "1px solid #dbe4f0", padding: "5px 9px" }}>📎</button>}
                              {st !== "Pago" && <button className="jp-btn" title="Abre a despesa no Malote com os dados desta conta" onClick={() => pagarConta(o)} style={{ background: "#0f3171", color: "#fff", border: "1px solid #0f3171", padding: "5px 13px", fontWeight: 700 }}>Pagar</button>}
                              {st !== "Pago" && <button className="jp-btn" title="Já foi paga por fora: anexar o comprovante e dar baixa" onClick={() => baixarConta(o)} style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", padding: "5px 10px", fontWeight: 700 }}>✓</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>);
        })()}
      </div>

      {/* ── Modal Patrimônio ── */}
      {modalPat && (
        <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget) setModalPat(false); }}>
          <div className="jp-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setModalPat(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>{editId ? "Editar Patrimônio" : "Novo Patrimônio"}</div>
            {/* A ordem é a do desenho: classificação e descrição, endereço e
                cidade, proprietário e matrícula, escritura e quem paga. O que
                o cadastro tinha antes e o desenho não mostra ficou embaixo, em
                "Mais informações" — tirar significaria perder dado já gravado. */}
            <div className="jp-grid2">
              <div className="jp-fg"><label>Classificação</label>
                <select className="jp-fi" value={pat.classificacao} onChange={e => setPat(v => ({ ...v, classificacao: e.target.value }))}>
                  <option value="">Selecione</option>
                  {CLASSIFICACOES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="jp-fg"><label>Descrição *</label><input className="jp-fi" value={pat.descricao} onChange={e => setPat(v => ({ ...v, descricao: e.target.value }))} placeholder="Digite a descrição" /></div>
              <div className="jp-fg"><label>Endereço</label><input className="jp-fi" value={pat.localizacao} onChange={e => setPat(v => ({ ...v, localizacao: e.target.value }))} placeholder="Digite o endereço completo" /></div>
              <div className="jp-fg"><label>Cidade</label><input className="jp-fi" value={pat.cidade} onChange={e => setPat(v => ({ ...v, cidade: e.target.value }))} placeholder="Cidade do patrimônio" /></div>
              <div className="jp-fg"><label>Proprietário</label><input className="jp-fi" value={pat.proprietario} onChange={e => setPat(v => ({ ...v, proprietario: e.target.value }))} placeholder="Digite o nome do proprietário" /></div>
              <div className="jp-fg"><label>Matrícula</label><input className="jp-fi" value={pat.matricula} onChange={e => setPat(v => ({ ...v, matricula: e.target.value }))} placeholder="Digite a matrícula do imóvel" /></div>
              <div className="jp-fg"><label>Escritura</label>
                <select className="jp-fi" value={pat.possui_escritura} onChange={e => setPat(v => ({ ...v, possui_escritura: e.target.value }))}>
                  <option value="">Selecione</option>
                  <option value="SIM">Sim</option>
                  <option value="NAO">Não</option>
                </select>
              </div>
              <div className="jp-fg"><label>Empresa que pagará</label><input className="jp-fi" value={pat.empresa_pagadora} onChange={e => setPat(v => ({ ...v, empresa_pagadora: e.target.value }))} placeholder="Quem paga as contas do patrimônio" /></div>

              <div className="jp-fg" style={{ gridColumn: "1/-1", borderTop: "1px dashed #e2e8f0", paddingTop: 12, marginBottom: 0 }}>
                <label style={{ color: "#0f3171" }}>Mais informações</label>
              </div>
              <div className="jp-fg"><label>Espécie da escritura</label>
                <select className="jp-fi" value={pat.especie_escritura} onChange={e => setPat(v => ({ ...v, especie_escritura: e.target.value }))}>
                  <option value="">Selecione</option>
                  {ESPECIES_ESCRITURA.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="jp-fg"><label>Situação de pagamento</label>
                <select className="jp-fi" value={pat.situacao_pagamento} onChange={e => setPat(v => ({ ...v, situacao_pagamento: e.target.value }))}>
                  <option value="">Selecione</option>
                  {SITUACOES_PAGAMENTO.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="jp-fg"><label>Valor do contrato (R$)</label><input className="jp-fi" type="number" step="0.01" value={pat.valor_contrato} onChange={e => setPat(v => ({ ...v, valor_contrato: e.target.value }))} placeholder="0,00" /></div>
              <div className="jp-fg"><label>Valor de entrada (R$)</label><input className="jp-fi" type="number" step="0.01" value={pat.valor_entrada} onChange={e => setPat(v => ({ ...v, valor_entrada: e.target.value }))} placeholder="0,00" /></div>
              <div className="jp-fg"><label>Código (automático)</label><input className="jp-fi" readOnly value={pat.codigo} style={{ background: "#f8fafc", color: "#475569", cursor: "not-allowed" }} /></div>
              <div className="jp-fg"><label>Tipo</label><select className="jp-fi" value={pat.tipo} onChange={e => setPat(v => ({ ...v, tipo: e.target.value }))}>{TIPOS.map(t => <option key={t}>{t}</option>)}</select></div>
              <div className="jp-fg"><label>Status</label><select className="jp-fi" value={pat.status} onChange={e => setPat(v => ({ ...v, status: e.target.value }))}><option>Ativo</option><option>Inativo</option></select></div>
              {pat.tipo === "Veículo" && <div className="jp-fg"><label>Placa</label><input className="jp-fi" value={pat.placa} onChange={e => setPat(v => ({ ...v, placa: e.target.value }))} /></div>}
              <div className="jp-fg"><label>Já transferida pra essa empresa?</label><select className="jp-fi" value={pat.transferida} onChange={e => setPat(v => ({ ...v, transferida: e.target.value }))}><option>Não</option><option>Sim</option></select></div>
              <div className="jp-fg"><label>Empresa</label><input className="jp-fi" value={pat.empresa} onChange={e => setPat(v => ({ ...v, empresa: e.target.value }))} placeholder="HAGG, CANAÃ…" /></div>
              <div className="jp-fg"><label>Empresa que pagará</label><input className="jp-fi" value={pat.empresa_pagadora} onChange={e => setPat(v => ({ ...v, empresa_pagadora: e.target.value }))} placeholder="Quem paga as contas/obrigações" /></div>
              <div className="jp-fg"><label>Responsável interno</label><input className="jp-fi" value={pat.responsavel} onChange={e => setPat(v => ({ ...v, responsavel: e.target.value }))} /></div>
            </div>
            {/* Coordenada no mapa. A maioria dos imóveis é localizada sozinha
                pelo botão do mapa; estes campos existem para os endereços que
                nenhum serviço acha ("MURANO", "COTAS - GAV") e para corrigir um
                pino que caiu no lugar errado. Valor digitado aqui vira "manual"
                e o botão de localizar não passa por cima dele. */}
            <div style={{ borderTop: "1px dashed #e2e8f0", marginTop: 4, paddingTop: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", marginBottom: 4 }}>Posição no mapa</div>
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 8, lineHeight: 1.45 }}>
                Opcional — deixe vazio e o mapa localiza pelo endereço. Para pegar à mão: no Google Maps, clique com o botão direito no ponto e o primeiro item do menu copia as duas coordenadas.
              </div>
              <div className="jp-grid2">
                <div className="jp-fg"><label>Latitude</label><input className="jp-fi" type="number" step="0.0000001" value={pat.latitude} onChange={e => setPat(v => ({ ...v, latitude: e.target.value }))} placeholder="-29.9447" /></div>
                <div className="jp-fg"><label>Longitude</label><input className="jp-fi" type="number" step="0.0000001" value={pat.longitude} onChange={e => setPat(v => ({ ...v, longitude: e.target.value }))} placeholder="-51.7186" /></div>
              </div>
              {avisoCoordenada && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 9, padding: "7px 10px", fontSize: 11.5, fontWeight: 700 }}>{avisoCoordenada}</div>
              )}
            </div>
            <div className="jp-fg"><label>Observações</label><textarea className="jp-fi" rows={2} value={pat.observacoes} onChange={e => setPat(v => ({ ...v, observacoes: e.target.value }))} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}>
              <div>
                {editId && <button className="jp-btn" onClick={excluirPat} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>Excluir patrimônio</button>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="jp-btn" onClick={() => setModalPat(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
                <button className="jp-btn" onClick={salvarPat} style={{ background: "#0f3171", color: "#fff" }}>Salvar patrimônio</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Drawer do patrimônio ── */}
      {sel && (
        <div className="jp-drawer-ov" onClick={e => { if (e.target === e.currentTarget) setSel(null); }}>
          <div className="jp-drawer">
            <div style={{ padding: "16px 22px", borderBottom: "1px solid #e2e8f0", background: "#fff", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{sel.descricao}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{[sel.tipo, sel.codigo, [sel.localizacao, sel.cidade].filter(Boolean).join(" · ") || sel.placa, sel.empresa].filter(Boolean).join(" · ")}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="jp-btn" onClick={() => abrirEditarPat(sel)} style={{ background: "#eef4ff", color: "#0f3171", border: "1px solid #dbe4f0" }}>Editar</button>
                <button onClick={() => setSel(null)} style={{ border: "none", background: "none", fontSize: 22, color: "#94a3b8", cursor: "pointer" }}>✕</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 2, padding: "0 16px", borderBottom: "1px solid #e2e8f0", background: "#fff", flexWrap: "wrap" }}>
              {/* "Parcelas" só aparece em quem tem financiamento: numa casa
                  quitada a aba estaria sempre vazia. */}
              {[["obrigacoes", "Contas / Obrigações"], ...(parcelas.length ? [["parcelas", `Parcelas (${parcelas.length})`]] : []), ["acessos", "Acessos"], ["contatos", "Contatos"], ["documentos", "Documentos"], ["historico", "Histórico"], ["comentarios", "Comentários"]].map(([k, l]) => (
                <button key={k} className={`jp-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
              {/* OBRIGAÇÕES */}
              {tab === "obrigacoes" && (() => {
                const obrsFiltradas = mesObr ? obrs.filter(o => (o.vencimento || "").slice(0, 7) === mesObr) : obrs;
                const navMes = (delta: number) => setMesObr(addMonthsISO((mesObr || hoje().slice(0, 7)) + "-01", delta).slice(0, 7));
                return (<>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <button className="jp-btn" onClick={() => navMes(-1)} style={{ background: "#f1f5f9", color: "#475569", padding: "6px 11px" }}>‹</button>
                  <span style={{ fontWeight: 700, color: "#0f172a", minWidth: 120, textAlign: "center", fontSize: 13 }}>{mesObr ? mesLabel(mesObr) : "Todos os meses"}</span>
                  <button className="jp-btn" onClick={() => navMes(1)} style={{ background: "#f1f5f9", color: "#475569", padding: "6px 11px" }}>›</button>
                  <button className="jp-btn" onClick={() => setMesObr("")} style={{ background: mesObr ? "#f1f5f9" : "#0f3171", color: mesObr ? "#475569" : "#fff", padding: "6px 12px" }}>Todos</button>
                  <button className="jp-btn" onClick={abrirNovaObr} style={{ marginLeft: "auto", background: "#0f3171", color: "#fff" }}>+ Nova obrigação</button>
                </div>
                {obrsFiltradas.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>{mesObr ? `Nenhuma conta em ${mesLabel(mesObr)}.` : "Nenhuma obrigação cadastrada."}</div> : obrsFiltradas.map(o => {
                  const st = statusObr(o); const cor = st === "Pago" ? "#16a34a" : st === "Vencido" ? "#dc2626" : "#ea580c";
                  return (
                    <div key={o.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 11, padding: "12px 14px", marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <span style={{ fontWeight: 800, color: "#0f172a" }}>{o.categoria}</span>
                          {o.descricao && <span style={{ color: "#64748b" }}> · {o.descricao}</span>}
                          <div style={{ fontSize: 12, color: "#475569", marginTop: 3, display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                            <span><b>{money(o.valor)}</b></span>
                            {o.vencimento && <span>Venc.: {fmtDt(o.vencimento)}</span>}
                            {o.periodicidade && <span>{o.periodicidade}</span>}
                            {o.forma_pagamento && <span>{o.forma_pagamento}</span>}
                            {o.onde_pagar && (ehLink(o.onde_pagar)
                              ? <a href={o.onde_pagar} target="_blank" rel="noopener noreferrer" style={{ color: "#0f3171", fontWeight: 700, textDecoration: "none" }}>🔗 Pagar aqui</a>
                              : <span title="Local para pagar">📍 {o.onde_pagar}</span>)}
                            {o.categoria === "Seguro" && o.vigencia_fim && <span>Vigência até {fmtDt(o.vigencia_fim)}</span>}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 800, height: "fit-content", padding: "2px 10px", borderRadius: 20, background: cor + "20", color: cor }}>{st}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                        {st !== "Pago" && <button className="jp-btn" onClick={() => pagarConta(o)} style={{ background: "#0f3171", color: "#fff", border: "1px solid #0f3171", padding: "5px 11px", fontWeight: 700 }}>Pagar</button>}{st !== "Pago" && <button className="jp-btn" title="Já foi paga por fora: anexar o comprovante e dar baixa" onClick={() => baixarConta(o)} style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", padding: "5px 10px", fontWeight: 700 }}>✓</button>}
                        {o.comprovante_path && <button className="jp-btn" onClick={() => verComprovante(o)} style={{ background: "#eef4ff", color: "#0f3171", border: "1px solid #dbe4f0", padding: "5px 11px" }}>📎 Comprovante</button>}
                        <button className="jp-btn" onClick={() => abrirEditarObr(o)} style={{ background: "#f1f5f9", color: "#475569", padding: "5px 11px" }}>Editar</button>
                        {(o.status === "Pago" && o.comprovante_path)
                          ? <span title="Conta paga com comprovante não pode ser excluída — registrada no histórico." style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#94a3b8", padding: "5px 8px" }}>🔒 Bloqueada</span>
                          : <button className="jp-btn" onClick={() => excluirObr(o)} style={{ background: "none", color: "#dc2626", padding: "5px 8px" }}>Excluir</button>}
                      </div>
                    </div>
                  );
                })}
              </>); })()}

              {/* PARCELAS — a posição do financiamento, como veio do contrato */}
              {tab === "parcelas" && (() => {
                const pagas = parcelas.filter(x => String(x.situacao ?? "").toUpperCase().startsWith("PAG")).length;
                const somaPagas = parcelas.filter(x => String(x.situacao ?? "").toUpperCase().startsWith("PAG"))
                  .reduce((s, x) => s + (Number(x.valor_pago ?? x.valor) || 0), 0);
                const somaAberto = parcelas.filter(x => !String(x.situacao ?? "").toUpperCase().startsWith("PAG"))
                  .reduce((s, x) => s + (Number(x.valor) || 0), 0);
                // As colunas extras mudam de contrato para contrato (seguro, taxa,
                // INCC, juro): mostra as que ESTE contrato tem, na ordem em que
                // aparecem, em vez de uma tabela fixa cheia de coluna vazia.
                const extras = [...new Set(parcelas.flatMap(x => Object.keys(x.detalhes ?? {})))].slice(0, 4);
                return (<>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                    {card("Parcelas", `${pagas} de ${parcelas.length}`, "#0f3171")}
                    {card("Pago", money(somaPagas), "#15803d")}
                    {card("Em aberto", money(somaAberto), somaAberto > 0 ? "#b45309" : "#15803d")}
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
                    <div style={{ maxHeight: 420, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ background: "#f8fafc", color: "#94a3b8", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".5px", position: "sticky", top: 0 }}>
                            <th style={{ textAlign: "left", padding: "9px 14px" }}>Parcela</th>
                            <th style={{ textAlign: "left", padding: "9px 14px" }}>Vencimento</th>
                            <th style={{ textAlign: "right", padding: "9px 14px" }}>Valor</th>
                            {extras.map(e => <th key={e} style={{ textAlign: "right", padding: "9px 14px" }}>{e}</th>)}
                            <th style={{ textAlign: "center", padding: "9px 14px" }}>Situação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parcelas.map(x => {
                            const paga = String(x.situacao ?? "").toUpperCase().startsWith("PAG");
                            return (
                              <tr key={x.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "9px 14px", fontWeight: 700, color: "#0f172a" }}>{x.rotulo || (x.numero != null ? `${x.numero}ª` : "—")}</td>
                                <td style={{ padding: "9px 14px", color: "#475569" }}>{x.vencimento ? fmtDt(x.vencimento) : "—"}</td>
                                <td style={{ padding: "9px 14px", textAlign: "right", color: "#0f172a", fontWeight: 700 }}>{x.valor != null ? money(x.valor) : "—"}</td>
                                {extras.map(e => <td key={e} style={{ padding: "9px 14px", textAlign: "right", color: "#64748b" }}>{x.detalhes?.[e] != null && x.detalhes[e] !== "" ? (typeof x.detalhes[e] === "number" ? money(x.detalhes[e]) : String(x.detalhes[e])) : "—"}</td>)}
                                <td style={{ padding: "9px 14px", textAlign: "center" }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: paga ? "#dcfce7" : "#fff7ed", color: paga ? "#15803d" : "#c2410c" }}>{x.situacao || "EM ABERTO"}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {parcelas[0]?.origem && (
                      <div style={{ padding: "8px 14px", borderTop: "1px solid #eef2f7", fontSize: 11, color: "#94a3b8" }}>
                        Origem: {[...new Set(parcelas.map(x => x.origem).filter(Boolean))].join(" · ")} (planilha ATIVO IMOBILIZADO)
                      </div>
                    )}
                  </div>
                </>);
              })()}

              {/* ACESSOS */}
              {tab === "acessos" && (<>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>⚠️ Guarde apenas <b>onde</b> a senha está (cofre/TI), nunca a senha.</span>
                  <button className="jp-btn" onClick={addAcesso} style={{ background: "#0f3171", color: "#fff" }}>+ Acesso</button>
                </div>
                {acessos.map(a => (
                  <div key={a.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 11, padding: 12, marginBottom: 8 }}>
                    <div className="jp-grid2">
                      <input className="jp-fi" placeholder="Serviço (Energia, Condomínio…)" defaultValue={a.servico} onBlur={e => { a.servico = e.target.value; salvarAcesso(a); }} />
                      <input className="jp-fi" placeholder="Link do portal" defaultValue={a.link} onBlur={e => { a.link = e.target.value; salvarAcesso(a); }} />
                      <input className="jp-fi" placeholder="Usuário/login" defaultValue={a.usuario} onBlur={e => { a.usuario = e.target.value; salvarAcesso(a); }} />
                      <input className="jp-fi" placeholder="Local da senha (Cofre, TI…)" defaultValue={a.local_senha} onBlur={e => { a.local_senha = e.target.value; salvarAcesso(a); }} />
                    </div>
                    <div style={{ textAlign: "right", marginTop: 6 }}><button className="jp-btn" onClick={() => excluirAcesso(a.id)} style={{ background: "none", color: "#dc2626", padding: "3px 8px" }}>Excluir</button></div>
                  </div>
                ))}
                {acessos.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>Nenhum acesso cadastrado.</div>}
              </>)}

              {/* CONTATOS */}
              {tab === "contatos" && (<>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><button className="jp-btn" onClick={addContato} style={{ background: "#0f3171", color: "#fff" }}>+ Contato</button></div>
                {contatos.map(c => (
                  <div key={c.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 11, padding: 12, marginBottom: 8 }}>
                    <div className="jp-grid2">
                      <input className="jp-fi" placeholder="Tipo (Corretor, Imobiliária…)" defaultValue={c.tipo} onBlur={e => { c.tipo = e.target.value; salvarContato(c); }} />
                      <input className="jp-fi" placeholder="Nome" defaultValue={c.nome} onBlur={e => { c.nome = e.target.value; salvarContato(c); }} />
                      <input className="jp-fi" placeholder="Telefone" defaultValue={c.telefone} onBlur={e => { c.telefone = e.target.value; salvarContato(c); }} />
                      <input className="jp-fi" placeholder="E-mail" defaultValue={c.email} onBlur={e => { c.email = e.target.value; salvarContato(c); }} />
                    </div>
                    <div style={{ textAlign: "right", marginTop: 6 }}><button className="jp-btn" onClick={() => excluirContato(c.id)} style={{ background: "none", color: "#dc2626", padding: "3px 8px" }}>Excluir</button></div>
                  </div>
                ))}
                {contatos.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>Nenhum contato cadastrado.</div>}
              </>)}

              {/* DOCUMENTOS */}
              {tab === "documentos" && (<>
                <label className="jp-btn" style={{ display: "inline-block", background: "#0f3171", color: "#fff", marginBottom: 12 }}>
                  + Anexar documento
                  <input type="file" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) { const tipo = prompt("Tipo do documento (Escritura, Apólice, CRLV, IPTU…):", "Documento") || "Documento"; uploadDoc(f, tipo); } e.currentTarget.value = ""; }} />
                </label>
                {docs.map(d => (
                  <div key={d.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 11, padding: "10px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {d.nome}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{d.tipo} · {fmtDt(d.created_at)}{d.criado_por ? " · " + d.criado_por : ""}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button className="jp-btn" onClick={() => baixarDoc(d)} style={{ background: "rgba(249,115,22,.12)", color: "#f97316", border: "1px solid rgba(249,115,22,.25)", padding: "5px 11px" }}>↓ Baixar</button>
                      <button className="jp-btn" onClick={() => excluirDoc(d)} style={{ background: "none", color: "#dc2626", padding: "5px 8px" }}>Excluir</button>
                    </div>
                  </div>
                ))}
                {docs.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>Nenhum documento anexado.</div>}
              </>)}

              {/* HISTÓRICO */}
              {tab === "historico" && (
                hist.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>Sem movimentações.</div> :
                <div style={{ position: "relative", paddingLeft: 14 }}>
                  {hist.map(h => (
                    <div key={h.id} style={{ borderLeft: "2px solid #e2e8f0", paddingLeft: 16, paddingBottom: 14, position: "relative" }}>
                      <div style={{ position: "absolute", left: -5, top: 3, width: 8, height: 8, borderRadius: "50%", background: "#0f3171" }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{h.acao}</div>
                      {h.detalhe && <div style={{ fontSize: 12, color: "#475569" }}>{h.detalhe}</div>}
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDt(h.created_at)}{h.autor ? " · " + h.autor : ""}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* COMENTÁRIOS (setor Jurídico) */}
              {tab === "comentarios" && (<>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 11, padding: 12, marginBottom: 14 }}>
                  <textarea className="jp-fi" rows={3} placeholder="Escreva um comentário do Jurídico sobre este patrimônio / suas obrigações…" value={novoComentario} onChange={e => setNovoComentario(e.target.value)} />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button className="jp-btn" onClick={addComentario} disabled={!novoComentario.trim()} style={{ background: novoComentario.trim() ? "#0f3171" : "#cbd5e1", color: "#fff" }}>Comentar</button>
                  </div>
                </div>
                {comentarios.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>Nenhum comentário ainda.</div> : comentarios.map(c => (
                  <div key={c.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 11, padding: "12px 14px", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 5 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#0f3171" }}>{c.autor_nome || "Jurídico"}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDt(c.created_at)}</span>
                        <button className="jp-btn" onClick={() => excluirComentario(c)} style={{ background: "none", color: "#dc2626", padding: "2px 6px" }}>Excluir</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>{c.texto}</div>
                  </div>
                ))}
              </>)}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Obrigação ── */}
      {modalObr && (
        <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget) setModalObr(false); }}>
          <div className="jp-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setModalObr(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>{obrEditId ? "Editar obrigação" : "Nova obrigação"}</div>
            <div className="jp-grid2">
              <div className="jp-fg"><label>Categoria *</label><select className="jp-fi" value={obr.categoria} onChange={e => { const c = e.target.value; setObr(v => ({ ...v, categoria: c })); setParcelasContrato([]); }}><option value="">Selecione…</option>{categoriasDoSelect(obr.categoria).map(c => <option key={c}>{c}</option>)}</select></div>
              <div className="jp-fg"><label>{contratoParcelado ? "Valor total (R$) *" : "Valor (R$) *"}</label><input className="jp-fi" type="number" step="0.01" value={obr.valor} onChange={e => setObr(v => ({ ...v, valor: e.target.value }))} placeholder="0,00" /></div>
              {ehContratoParcelado(obr.categoria) && (
                <div className="jp-fg" style={{ gridColumn: "2" }}>
                  <label>Valor de entrada</label>
                  <input className="jp-fi" type="number" step="0.01" value={obr.valor_entrada} onChange={e => setObr(v => ({ ...v, valor_entrada: e.target.value }))} placeholder="R$ 0,00" />
                </div>
              )}
              <div className="jp-fg"><label>Vencimento *</label><input className="jp-fi" type="date" value={obr.vencimento} onChange={e => setObr(v => ({ ...v, vencimento: e.target.value }))} /></div>
              <div className="jp-fg"><label>Periodicidade</label><select className="jp-fi" value={obr.periodicidade} onChange={e => setObr(v => ({ ...v, periodicidade: e.target.value }))}>{PERIODICIDADES.map(p => <option key={p}>{p}</option>)}</select></div>
              {!!PERIOD_STEP[obr.periodicidade] && !contratoParcelado && (
                <div className="jp-fg"><label>Gerar nos próximos meses</label><input className="jp-fi" type="number" min={0} max={36} value={obr.repetir} onChange={e => setObr(v => ({ ...v, repetir: e.target.value }))} placeholder="0 = só este mês; 11 = ano todo" /><div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>“{obr.periodicidade}” é só o rótulo — informe quantos meses gerar pra criar as contas dos próximos meses (não duplica os que já existem).</div></div>
              )}
              <div className="jp-fg"><label>Forma de pagamento</label><input className="jp-fi" value={obr.forma_pagamento} onChange={e => setObr(v => ({ ...v, forma_pagamento: e.target.value }))} placeholder="Boleto, Débito em conta…" /></div>
              <div className="jp-fg"><label>Responsável (Jurídico)</label>
                <select className="jp-fi" value={obr.responsavel} onChange={e => setObr(v => ({ ...v, responsavel: e.target.value }))}>
                  <option value="">Selecione…</option>
                  {obr.responsavel && !empsJuridico.some(e => e.nome === obr.responsavel) && <option value={obr.responsavel}>{obr.responsavel}</option>}
                  {empsJuridico.map(e => <option key={e.id} value={e.nome}>{e.nome}</option>)}
                </select>
              </div>
            </div>

            {/* ── Parcelas do contrato (Financiamento/Consórcio) ── */}
            {contratoParcelado && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginTop: 4, background: "#fbfdff" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>Parcelas do contrato</div>

                <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 7 }}>Forma de cadastro das parcelas</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  {MODOS_PARCELA.map(o => {
                    const on = obr.modo_parcelas === o.v;
                    return (
                      <button key={o.v} type="button"
                        onClick={() => setObr(v => ({ ...v, modo_parcelas: o.v }))}
                        style={{ textAlign: "left", cursor: "pointer", borderRadius: 11, padding: "11px 13px", background: on ? "#f0f6ff" : "#fff", border: on ? "1.5px solid #0f3171" : "1px solid #e2e8f0", transition: "border-color .18s, background .18s" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 15, height: 15, borderRadius: "50%", flex: "none", border: on ? "4.5px solid #0f3171" : "1.5px solid #cbd5e1", background: "#fff", transition: "border .18s" }} />
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>{o.t}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.45 }}>{o.d}</div>
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                  <div className="jp-fg" style={{ margin: 0, minWidth: 150 }}>
                    <label>Quantidade de parcelas *</label>
                    <input className="jp-fi" type="number" min={1} max={480} value={obr.qtd_parcelas}
                      onChange={e => setObr(v => ({ ...v, qtd_parcelas: e.target.value }))} placeholder="60" />
                  </div>
                  <button type="button" className="jp-btn" onClick={gerar}
                    style={{ background: "#fff", border: "1.5px solid #0f3171", color: "#0f3171", fontWeight: 800 }}>
                    Gerar parcelas
                  </button>
                  <div style={{ fontSize: 11, color: "#94a3b8", flex: 1, minWidth: 180, lineHeight: 1.45 }}>
                    {modoIgual
                      ? "O valor de cada parcela sai do total menos a entrada, dividido pela quantidade."
                      : "Ajuste valores e vencimentos individualmente, se necessário."}
                  </div>
                </div>

                {parcelasContrato.length > 0 && (<>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 60px", gap: 8, padding: "8px 12px", background: "#f8fafc", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>
                      <span>Parcela</span><span>Vencimento</span><span>Valor da parcela</span><span style={{ textAlign: "center" }}>Ações</span>
                    </div>
                    <div style={{ maxHeight: 260, overflowY: "auto" }}>
                      {parcelasContrato.map((l, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 60px", gap: 8, padding: "7px 12px", alignItems: "center", borderTop: "1px solid #f1f5f9" }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#475569" }}>{l.numero}</span>
                          <input className="jp-fi" type="date" value={l.vencimento} onChange={e => mexerParcela(i, "vencimento", e.target.value)} style={{ padding: "6px 9px" }} />
                          <input className="jp-fi" type="number" step="0.01" value={l.valor} readOnly={modoIgual}
                            onChange={e => mexerParcela(i, "valor", e.target.value)}
                            title={modoIgual ? "No modo de valor igual a parcela vem do total dividido pela quantidade." : undefined}
                            style={{ padding: "6px 9px", background: modoIgual ? "#f1f5f9" : "#fff", color: modoIgual ? "#475569" : "#0f172a", cursor: modoIgual ? "not-allowed" : "text" }} />
                          <button type="button" onClick={() => removerParcela(i)} title="Excluir parcela"
                            style={{ justifySelf: "center", background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 15, lineHeight: 1 }}>&#128465;</button>
                        </div>
                      ))}
                    </div>
                    {!modoIgual && (
                      <button type="button" onClick={adicionarParcela}
                        style={{ width: "100%", padding: 9, background: "#fff", border: "none", borderTop: "1px dashed #cbd5e1", color: "#0f3171", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                        + Adicionar parcela
                      </button>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, marginTop: 10, background: "#e2e8f0", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ background: "#f8fafc", padding: "9px 13px" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Total das parcelas</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{money(somaParcelas(parcelasContrato))}</div>
                    </div>
                    <div style={{ background: "#f8fafc", padding: "9px 13px" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Total geral (entrada + parcelas)</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{money(totalGeral(parcelasContrato, obr.valor_entrada))}</div>
                    </div>
                  </div>

                  {/* Confere na hora: descobrir a diferença só no Salvar faria
                      a pessoa refazer a tabela inteira. */}
                  {avisoParcelas && (
                    <div style={{ marginTop: 9, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 9, padding: "8px 11px", fontSize: 11.5, fontWeight: 700 }}>{avisoParcelas}</div>
                  )}
                </>)}
              </div>
            )}
            <div className="jp-fg"><label>Descrição</label><input className="jp-fi" value={obr.descricao} onChange={e => setObr(v => ({ ...v, descricao: e.target.value }))} /></div>
            <div className="jp-fg"><label>Caminho para pagar (link ou local no servidor)</label><input className="jp-fi" value={obr.onde_pagar} onChange={e => setObr(v => ({ ...v, onde_pagar: e.target.value }))} placeholder="https://…  ou  \\servidor\contas\agua" /><div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>Se for um link (https://…) vira botão clicável na conta; senão fica como referência do local.</div></div>
            {obr.categoria === "Seguro" && (
              <div style={{ borderTop: "1px dashed #e2e8f0", marginTop: 6, paddingTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", marginBottom: 8 }}>Dados do seguro</div>
                <div className="jp-grid2">
                  <div className="jp-fg"><label>Seguradora</label><input className="jp-fi" value={obr.seguradora} onChange={e => setObr(v => ({ ...v, seguradora: e.target.value }))} /></div>
                  <div className="jp-fg"><label>Nº Apólice</label><input className="jp-fi" value={obr.apolice} onChange={e => setObr(v => ({ ...v, apolice: e.target.value }))} /></div>
                  <div className="jp-fg"><label>Vigência início</label><input className="jp-fi" type="date" value={obr.vigencia_inicio} onChange={e => setObr(v => ({ ...v, vigencia_inicio: e.target.value }))} /></div>
                  <div className="jp-fg"><label>Vigência fim</label><input className="jp-fi" type="date" value={obr.vigencia_fim} onChange={e => setObr(v => ({ ...v, vigencia_fim: e.target.value }))} /></div>
                  <div className="jp-fg"><label>Prêmio (R$)</label><input className="jp-fi" type="number" step="0.01" value={obr.premio} onChange={e => setObr(v => ({ ...v, premio: e.target.value }))} /></div>
                  <div className="jp-fg"><label>Parcelas</label><input className="jp-fi" value={obr.parcelas} onChange={e => setObr(v => ({ ...v, parcelas: e.target.value }))} placeholder="05/10" /></div>
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button className="jp-btn" onClick={() => setModalObr(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="jp-btn" onClick={salvarObr} style={{ background: "#0f3171", color: "#fff" }}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Registrar pagamento (com comprovante) ── */}
      {pagarAlvo && (
        <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget) setPagarAlvo(null); }}>
          <div className="jp-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <button onClick={() => setPagarAlvo(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Dar baixa na conta</div>
            <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 14 }}>{pagarAlvo.categoria}{pagarAlvo.descricao ? " · " + pagarAlvo.descricao : ""} · <b>{money(pagarAlvo.valor)}</b>{pagarAlvo.vencimento ? " · venc. " + fmtDt(pagarAlvo.vencimento) : ""}</div>
            <div className="jp-fg"><label>Comprovante (PDF ou imagem) *</label><input className="jp-fi" type="file" accept="image/*,application/pdf" onChange={e => setPagarFile(e.target.files?.[0] || null)} style={{ padding: 8 }} /><div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4 }}>Obrigatório para confirmar o pagamento. Depois de anexado, a conta fica <b>bloqueada para exclusão</b> e tudo fica no histórico.</div></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button className="jp-btn" onClick={() => setPagarAlvo(null)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="jp-btn" onClick={confirmarPagar} disabled={!pagarFile} style={{ background: pagarFile ? "#15803d" : "#cbd5e1", color: "#fff", cursor: pagarFile ? "pointer" : "not-allowed" }}>Pagar e anexar comprovante</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.12)", background: t.t === "ok" ? "#ecfdf3" : t.t === "err" ? "#fef2f2" : "#eff6ff", color: t.t === "ok" ? "#15803d" : t.t === "err" ? "#b91c1c" : "#1d4ed8", border: `1px solid ${t.t === "ok" ? "#86efac" : t.t === "err" ? "#fecaca" : "#bfdbfe"}` }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
