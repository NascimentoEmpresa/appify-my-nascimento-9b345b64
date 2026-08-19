import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Formulario, Pergunta, normalizaPerguntas } from "./Formularios";
import PainelPlanosAcao, { SITUACOES, PRIORIDADES, ORIGENS, usePlanosAcao } from "./PainelPlanosAcao";
import HistoricoIndividual from "./HistoricoIndividual";
import IndicadoresCalculos from "./IndicadoresCalculos";
import { carregaCadastro, normSetor, normNome, ehSetorReal, liderAcimaDe, MapasHier, Empregado } from "./LideresSetor";
import PainelCumprimento from "./PainelCumprimento";
import VisaoExecutiva from "./VisaoExecutiva";
import { useFormPerms } from "@/hooks/useFormPerms";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { useAuth } from "@/hooks/useAuth";
import { ItemDist, Mapa, Resp, Viz } from "./painel/tipos";
import { CAMPOS_MAPA, CHART_TIPOS, IND, IND_ALIN, IND_EXEC, IND_PLANO, autoMapa } from "./painel/mapeamento";
import {
  agrupaMedia, deltaSerie, distrib, faixa, listaQuem, mediaNota, nota, pctPrimeiraOpcao,
  respValor, serieTrimestre, setorDe, trimestre, SEM_SETOR,
} from "./painel/calculos";
import { CAT_CORES, Chart, EvolucaoChart, FiltroFuturo, Kpi, MultiSelectEmpresa, Painel, Vazio, btn, inp, lbl, pct } from "./painel/ui";
import PainelLideranca from "./painel/AbaLideranca";
import PainelAlinhamento from "./painel/AbaAlinhamento";
import { insightForte, insightNec, insightSit } from "./painel/insights";

// =====================================================================
// PAINEL GERENCIAL — Nascimento Formulários (feedbacks)
//
// Painel de BI sobre UM formulário de feedback. Este arquivo é a PÁGINA: ele
// carrega os dados, aplica os filtros da barra e escolhe a aba. O resto mora
// em ./painel:
//
//   tipos.ts        os tipos que todo mundo aqui fala
//   mapeamento.ts   de qual pergunta sai cada indicador (auto + ajuste na tela)
//   calculos.ts     as contas, em funções puras
//   ui.tsx          cartões, tabelas e gráficos
//   Aba*.tsx        uma aba por arquivo
//   insights.tsx    as frases de leitura rápida da aba Desenvolvimento
//
// O mapeamento pergunta→indicador fica salvo por formulário no navegador
// (localStorage) — sem tocar no banco.
// =====================================================================

const TABS = ["Visão Executiva", "Cumprimento", "Desenvolvimento", "Liderança", "Alinhamento e Entrega", "Planos de Ação", "Histórico Individual", "Indicadores e Cálculos"];
// Abas já implementadas — as demais aparecem marcadas "em breve" na barra.
const TABS_PRONTAS = ["Visão Executiva", "Cumprimento", "Desenvolvimento", "Liderança", "Alinhamento e Entrega", "Planos de Ação", "Histórico Individual", "Indicadores e Cálculos"];

// Diretoria = atalho para um conjunto FIXO de setores (definição de negócio, não
// do cadastro). Selecionar uma diretoria recorta as respostas para esses setores.
// Chaves já na forma que normSetor devolve (sem acento, caixa alta).
const DIRETORIAS: Record<string, string[]> = {
  "Diretor Operacional":    ["LICITACAO", "COMPRAS", "OPERACIONAL"],
  "Diretor Administrativo": ["RH", "TREINAMENTOS", "FINANCEIRO", "JURIDICO"],
};

export default function PainelGerencial() {
  const nav = useNavigate();
  const [forms, setForms] = useState<Formulario[]>([]);
  const [resps, setResps] = useState<Resp[]>([]);
  const [liderSetor, setLiderSetor] = useState<Map<string, string>>(new Map());  // setor(norm) → nome do líder
  const [diretorSetor, setDiretorSetor] = useState<Map<string, string>>(new Map());  // setor(norm) → nome do diretor
  const [ceo, setCeo] = useState("");   // topo da hierarquia, último degrau do líder
  const [emps, setEmps] = useState<Empregado[]>([]);   // cadastro: denominador da Visão Executiva
  // Empresa do usuário (profiles.empresa_id → empresas). Fonte do filtro/dropdown
  // de empresa: liga a resposta a quem respondeu por uid (criado_por) e, como
  // fallback, pelo nome (respondente_nome → display_name).
  const [empresaPorUid, setEmpresaPorUid] = useState<Map<string, string>>(new Map());
  const [empresaPorNome, setEmpresaPorNome] = useState<Map<string, string>>(new Map());
  const [cadastroCarregando, setCadastroCarregando] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("Desenvolvimento");
  const [formSel, setFormSel] = useState("");
  const [mapa, setMapa] = useState<Mapa>({});
  const [mostrarMapa, setMostrarMapa] = useState(false);
  // O painel de mapeamento abre lá no topo; quando o clique vem de um botão
  // "Ajustar mapeamento" que está no fim de uma página longa, rolamos o painel
  // pra dentro da tela senão parece que nada aconteceu.
  const mapaRef = useRef<HTMLDivElement>(null);
  const abrirMapa = useCallback(() => {
    setMostrarMapa(true);
    setTimeout(() => mapaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, []);
  const [viz, setViz] = useState<Record<string, Viz>>({ necessidades: "barras", distribuicao: "rosca", fortes: "barras", melhoria: "barras", evolucao: "linha" });
  // filtros
  const [periodo, setPeriodo] = useState<"todos" | "90" | "180" | "365">("todos");
  const [fSetor, setFSetor] = useState("");
  const [fResp, setFResp] = useState("");
  const [fSituacao, setFSituacao] = useState("");
  const [fNecessidade, setFNecessidade] = useState("");
  const [fEmpresas, setFEmpresas] = useState<string[]>([]);  // empresa do respondente (multi), da "Empresa padrão (de cadastro)" do usuário
  const [fDiretoria, setFDiretoria] = useState("");          // Diretor Operacional | Diretor Administrativo → conjunto de setores
  const [fLider, setFLider] = useState("");                  // nome do líder → recorta pelos setores que ele lidera
  // filtros exclusivos da aba Planos de Ação
  const [fSitPlano, setFSitPlano] = useState("");
  const [fPrioridade, setFPrioridade] = useState("");
  const [fOrigem, setFOrigem] = useState("");

  // Permissões do usuário logado (espelha a RLS dos formulários). Quem NÃO tem
  // 'ver_tudo' fica preso aos setores que pode ver — o Painel trava o filtro.
  const { can: canForm, setoresVer, setoresCriar, loading: permsLoading } = useFormPerms();
  const { empregado: meuEmpregado } = useVinculoEmpregado();  // p/ saber os setores que EU lidero
  const { user: authUser } = useAuth();                        // p/ casar "minhas respostas" (criado_por)

  const load = useCallback(async () => {
    setLoading(true);
    const [fRes, rRes] = await Promise.all([
      (supabase as any).from("CS_FORMULARIOS").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      (supabase as any).from("CS_FORM_RESPOSTAS").select("id, formulario_id, enviado_em, respondente_nome, criado_por, setor, respondente_cadastro, itens").order("enviado_em", { ascending: false }).limit(10000),
    ]);
    const fs: Formulario[] = fRes.data ?? [];
    setForms(fs);
    setResps((rRes.data ?? []).map((r: any) => ({ ...r, itens: r.itens ?? {} })));
    // formulário padrão: o que tiver "feedback" no título, senão o primeiro.
    const padrao = fs.find(f => /feedback/i.test(f.titulo)) ?? fs[0];
    if (padrao) setFormSel(prev => prev || padrao.id);
    setLoading(false);
    // Cadastro em paralelo (não segura a tela: se a tabela ainda não existir no
    // banco, o fallback fica vazio e o resto funciona igual). Só a Visão
    // Executiva depende dele — as outras abas leem apenas as respostas.
    setCadastroCarregando(true);
    carregaCadastro()
      .then(c => { setEmps(c.emps); setLiderSetor(c.liderPorSetor); setDiretorSetor(c.diretorPorSetor); setCeo(c.ceo); })
      .catch(() => { setEmps([]); setLiderSetor(new Map()); setDiretorSetor(new Map()); setCeo(""); })
      .finally(() => setCadastroCarregando(false));
    // Empresa por usuário: "Empresa padrão (de cadastro)" (profiles.empresa_id →
    // empresas). Vira dois mapas — por uid (criado_por) e por nome — usados pelo
    // filtro/dropdown de empresa. Em paralelo, não segura a tela.
    Promise.all([
      (supabase as any).from("profiles").select("id, display_name, empresa_id"),
      (supabase as any).from("empresas").select("id, codigo, razao_social"),
    ]).then(([pRes, eRes]: any[]) => {
      const empById = new Map<string, string>();
      (eRes.data ?? []).forEach((e: any) => empById.set(e.id, String(e.razao_social ?? e.codigo ?? "").trim()));
      const porUid = new Map<string, string>(), porNome = new Map<string, string>();
      (pRes.data ?? []).forEach((p: any) => {
        const label = p.empresa_id ? (empById.get(p.empresa_id) ?? "") : "";
        if (!label) return;
        if (p.id) porUid.set(String(p.id), label);
        const n = normNome(p.display_name); if (n && !porNome.has(n)) porNome.set(n, label);
      });
      setEmpresaPorUid(porUid); setEmpresaPorNome(porNome);
    }).catch(() => { setEmpresaPorUid(new Map()); setEmpresaPorNome(new Map()); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const form = useMemo(() => forms.find(f => f.id === formSel) ?? null, [forms, formSel]);
  const pergs = useMemo(() => form ? normalizaPerguntas(form.perguntas) : [], [form]);

  // carrega/gera o mapeamento ao trocar de formulário (localStorage por form).
  useEffect(() => {
    if (!form) return;
    let salvo: Mapa = {};
    try { salvo = JSON.parse(localStorage.getItem("painel_map_" + form.id) || "{}"); } catch { salvo = {}; }
    const auto = autoMapa(pergs);
    setMapa({ ...auto, ...salvo });
  }, [form, pergs]);
  const salvarMapa = (m: Mapa) => { setMapa(m); if (form) try { localStorage.setItem("painel_map_" + form.id, JSON.stringify(m)); } catch { /* ignore */ } };
  const pq = (key: string) => pergs.find(p => p.id === mapa[key]);

  // Setores que EU lidero/dirijo (toggles "Gerente de X" / "Diretor de X"),
  // lidos dos mapas do cadastro cruzando com o meu nome. Chaves já normalizadas.
  const meuNome = normNome(meuEmpregado?.nome);
  const setoresQueLidero = useMemo(() => {
    const s = new Set<string>();
    if (!meuNome) return s;
    liderSetor.forEach((nome, setorK) => { if (normNome(nome) === meuNome) s.add(setorK); });
    diretorSetor.forEach((nome, setorK) => { if (normNome(nome) === meuNome) s.add(setorK); });
    return s;
  }, [liderSetor, diretorSetor, meuNome]);

  // Escopo de setores do usuário. null = vê tudo (papel 'ver_tudo') OU nenhum
  // setor concedido (ex.: só 'ver_proprias'). Base SÓ nas permissões concedidas
  // + setores que lidera — NUNCA no que o servidor devolveu. Ao carregar, não trava.
  const escopoSetores = useMemo(() => {
    if (permsLoading || canForm("ver_tudo")) return null;
    const s = new Set<string>();
    [...setoresVer, ...setoresCriar].forEach(x => { const k = normSetor(x); if (k) s.add(k); });
    setoresQueLidero.forEach(k => s.add(k));
    return s.size ? s : null;
  }, [permsLoading, canForm, setoresVer, setoresCriar, setoresQueLidero]);

  // Visibilidade por resposta — espelha a RLS cs_form_resp_select, como defesa
  // em profundidade (a RLS é a autoridade; a tela mostra só o permitido mesmo
  // que a RLS devolva mais). ver_tudo → tudo; senão UNE "minhas" (ver_proprias:
  // criado_por meu OU eu sou o respondente pelo nome) com os setores do escopo
  // (ver_setor/criar_setor/liderança). Enquanto carrega, não restringe.
  const podeVer = useCallback((r: Resp) => {
    if (permsLoading || canForm("ver_tudo")) return true;
    const ehMinha = canForm("ver_proprias") && (
      (!!r.criado_por && r.criado_por === authUser?.id) ||
      (!!meuNome && normNome(r.respondente_nome) === meuNome)
    );
    const noSetor = !!escopoSetores && escopoSetores.has(normSetor(r.setor));
    return ehMinha || noSetor;
  }, [permsLoading, canForm, authUser, meuNome, escopoSetores]);

  // respostas do formulário que o usuário PODE ver — fonte ÚNICA já recortada
  // pela permissão (podeVer), então TODAS as abas herdam (dashboards, planos,
  // opções de filtro). Os filtros de tela (setor/período/etc.) vêm depois.
  const respsForm = useMemo(() => resps.filter(r => r.formulario_id === formSel && podeVer(r)), [resps, formSel, podeVer]);
  // Nomes que já responderam este formulário — alimentam o autocomplete de
  // colaborador/liderança ao cadastrar um plano (um por pessoa, não por resposta).
  const pessoasForm = useMemo(() => {
    const m = new Map<string, { id: string; nome: string; setor: string }>();
    respsForm.forEach(r => {
      const nome = (r.respondente_nome ?? "").trim();
      if (nome && !m.has(nome)) m.set(nome, { id: r.id, nome, setor: r.setor ?? "" });
    });
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [respsForm]);

  // Quem a resposta AVALIA (o dono do feedback).
  const avaliadoDaResposta = useCallback((r: Resp) =>
    (respValor(r, mapa.avaliado) || respValor(r, mapa.lider) || r.respondente_nome || "").trim(),
    [mapa.avaliado, mapa.lider]);

  // Líder de uma resposta = quem responde POR essa pessoa, pela HIERARQUIA —
  // nunca ela mesma. O formulário tem uma pergunta de colaborador só, então
  // usá-la como "liderança" fazia todo mundo aparecer como líder de si próprio
  // (a Caroline dando feedback pra Caroline). Sobe um degrau de cada vez:
  //   líder do setor → se for a própria pessoa, o diretor do setor → senão CEO.
  const mapasHier = useMemo<MapasHier>(() => ({ liderPorSetor: liderSetor, diretorPorSetor: diretorSetor, ceo }), [liderSetor, diretorSetor, ceo]);
  const liderDaResposta = useCallback((r: Resp) =>
    liderAcimaDe(avaliadoDaResposta(r), r.setor, mapasHier), [avaliadoDaResposta, mapasHier]);

  // Fontes dos planos de ação: cada resposta que preencheu a pergunta da ação
  // é um plano. Sem texto de ação não há plano — só uma resposta em branco.
  const fontesPlano = useMemo(() => {
    if (!mapa.acaoPlano) return [];
    // Mesma pergunta para ação e prazo é mapeamento errado: o texto da ação
    // nunca vira data, e todo plano cairia em "sem prazo" sem explicação.
    const pPrazo = mapa.prazoPlano === mapa.acaoPlano ? undefined : mapa.prazoPlano;
    return respsForm
      .map(r => ({
        resposta_id: r.id,
        acao: respValor(r, mapa.acaoPlano).trim(),
        prazoBruto: respValor(r, pPrazo).trim(),
        // O avaliado é o dono do plano. Só cai em respondente_nome se o
        // formulário não tiver a pergunta de quem foi avaliado.
        colaborador: (respValor(r, mapa.avaliado) || (r.respondente_nome ?? "")).trim(),
        setor: (r.setor ?? "").trim(),
        lideranca: liderDaResposta(r),
        enviado_em: r.enviado_em,
      }))
      .filter(f => f.acao.length > 0);
  }, [respsForm, mapa.acaoPlano, mapa.prazoPlano, mapa.avaliado, liderDaResposta]);

  const planosAcao = usePlanosAcao(formSel, fontesPlano);

  // Empresa de quem respondeu: a "Empresa padrão (de cadastro)" do usuário. Liga
  // pelo uid (criado_por, envio logado) e, se anônimo/sem uid, pelo nome.
  const empresaDe = useCallback((r: Resp) => {
    if (r.criado_por && empresaPorUid.has(r.criado_por)) return empresaPorUid.get(r.criado_por)!;
    return empresaPorNome.get(normNome(r.respondente_nome)) ?? "";
  }, [empresaPorUid, empresaPorNome]);

  // Cadastro recortado pelos MESMOS filtros da barra — é o denominador de
  // "feedbacks esperados" (Visão Executiva e Cumprimento). Antes só o setor
  // chegava lá: filtrar por diretoria, liderança, empresa ou colaborador mexia
  // só no numerador (as respostas) e a taxa de realização saía errada.
  // Período fica de fora de propósito: o cadastro é a foto de HOJE, não guarda
  // histórico — quem está no quadro agora é esperado no ciclo inteiro.
  const empsFiltrados = useMemo(() => {
    const q = normNome(fResp);
    const alvoDir = fDiretoria ? new Set(DIRETORIAS[fDiretoria] ?? []) : null;
    const alvoEmp = fEmpresas.length ? new Set(fEmpresas) : null;
    return emps.filter(e => {
      const k = normSetor(e.setor);
      if (escopoSetores && !escopoSetores.has(k)) return false;   // permissão do usuário
      if (fSetor && k !== normSetor(fSetor)) return false;
      if (alvoDir && !alvoDir.has(k)) return false;
      if (fLider && liderSetor.get(k) !== fLider) return false;
      if (q && !normNome(e.nome).includes(q)) return false;
      // Empresa não existe no cadastro do Senior: vem da "Empresa padrão" do
      // login (profiles), casada pelo nome — a mesma regra usada nas respostas.
      // Quem não tem login com empresa fica de fora do recorte por empresa.
      if (alvoEmp && !alvoEmp.has(empresaPorNome.get(normNome(e.nome)) ?? "")) return false;
      return true;
    });
  }, [emps, escopoSetores, fSetor, fDiretoria, fLider, fResp, fEmpresas, liderSetor, empresaPorNome]);

  // Resumo do recorte, para o número grande de "esperados" sempre dizer de que
  // recorte ele é.
  const filtrosResumo = useMemo(() => [
    fSetor && `Setor: ${fSetor}`,
    fDiretoria && `Diretoria: ${fDiretoria}`,
    fLider && `Liderança: ${fLider}`,
    fEmpresas.length === 1 ? `Empresa: ${fEmpresas[0]}` : fEmpresas.length > 1 ? `${fEmpresas.length} empresas` : "",
    fResp.trim() && `Colaborador: ${fResp.trim()}`,
  ].filter(Boolean).join(" · "), [fSetor, fDiretoria, fLider, fEmpresas, fResp]);

  const base = useMemo(() => {
    let rs = respsForm;
    const dias = periodo === "todos" ? 0 : Number(periodo);
    if (dias) { const corte = Date.now() - dias * 86400000; rs = rs.filter(r => +new Date(r.enviado_em) >= corte); }
    if (fSetor) rs = rs.filter(r => normSetor(r.setor) === normSetor(fSetor));
    // Diretoria: recorta para o conjunto de setores da diretoria (via normSetor,
    // sem acento/caixa). Setor + Diretoria juntos são AND — pode zerar de propósito.
    if (fDiretoria) { const alvo = new Set(DIRETORIAS[fDiretoria] ?? []); rs = rs.filter(r => alvo.has(normSetor(r.setor))); }
    // Liderança: recorta pelos setores que aquele líder lidera (mesma coisa que
    // escolher o(s) setor(es) dele), lendo o mapa setor→líder do cadastro.
    if (fLider) rs = rs.filter(r => liderSetor.get(normSetor(r.setor)) === fLider);
    // Empresa (multi): "Empresa padrão (de cadastro)" do usuário que respondeu (empresaDe).
    if (fEmpresas.length) { const set = new Set(fEmpresas); rs = rs.filter(r => set.has(empresaDe(r))); }
    // Colaborador: busca pelo AVALIADO (dono do feedback), com fallback ao
    // respondente. Antes só olhava respondente_nome — que nos feedbacks vem
    // vazio/é o líder que respondeu —, por isso qualquer nome zerava.
    const q = fResp.trim().toLowerCase();
    if (q) rs = rs.filter(r => avaliadoDaResposta(r).toLowerCase().includes(q) || (r.respondente_nome ?? "").toLowerCase().includes(q));
    return rs;
  }, [respsForm, periodo, fSetor, fDiretoria, fLider, fEmpresas, fResp, liderSetor, avaliadoDaResposta, empresaDe]);
  // recorte final também respeita situação/necessidade (filtros específicos)
  const filtradas = useMemo(() => {
    let rs = base;
    if (fSituacao) rs = rs.filter(r => respValor(r, mapa.situacao) === fSituacao);
    if (fNecessidade) rs = rs.filter(r => { const v = r.itens[mapa.necessidades ?? ""]; return (Array.isArray(v) ? v : [v]).map(String).includes(fNecessidade); });
    return rs;
  }, [base, fSituacao, fNecessidade, mapa]);

  // Opções de setor. Sem escopo: os setores presentes nas respostas. Com escopo:
  // TODOS os setores permitidos (mesmo sem resposta ainda) — assim um setor
  // concedido aparece selecionável em vez de sumir por falta de dados. O rótulo
  // de exibição vem dos dados quando existe, senão do próprio grant.
  const setores = useMemo(() => {
    const dataLabels = [...new Set(respsForm.map(r => (r.setor ?? "").trim()).filter(Boolean))];
    if (!escopoSetores) return dataLabels.sort((a, b) => a.localeCompare(b, "pt-BR"));
    const porNorm = new Map<string, string>();
    dataLabels.forEach(l => { const k = normSetor(l); if (escopoSetores.has(k) && !porNorm.has(k)) porNorm.set(k, l); });
    [...setoresVer, ...setoresCriar].forEach(l => { const k = normSetor(l); if (escopoSetores.has(k) && !porNorm.has(k)) porNorm.set(k, l.trim()); });
    escopoSetores.forEach(k => { if (!porNorm.has(k)) porNorm.set(k, k); });
    return [...porNorm.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [respsForm, escopoSetores, setoresVer, setoresCriar]);

  // Ao MUDAR o escopo: 1 setor → fixa nele (o select fica travado); vários ou
  // liberado → volta p/ "Todos (permitidos)". Roda só na transição (ref), então
  // não atropela a escolha manual do usuário depois.
  const escopoKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = escopoSetores ? [...escopoSetores].sort().join("|") : "";
    if (key === escopoKeyRef.current) return;
    escopoKeyRef.current = key;
    if (escopoSetores && escopoSetores.size === 1) setFSetor(setores[0] ?? "");
    else setFSetor("");
  }, [escopoSetores, setores]);
  // Empresas presentes nas respostas: a empresa de cadastro de cada respondente
  // (empresaDe) — só entram as que aparecem em quem respondeu.
  const empresasOpc = useMemo(() => [...new Set(respsForm.map(empresaDe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [respsForm, empresaDe]);
  // Líderes dos setores que aparecem nas respostas (um por pessoa). Selecionar um
  // recorta pelos setores dele — por isso a lista sai do mapa setor→líder.
  const lideresOpc = useMemo(() => {
    const s = new Set<string>();
    setores.forEach(setor => { const l = liderSetor.get(normSetor(setor)); if (l) s.add(l); });
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [setores, liderSetor]);
  // `avaliadoDaResposta` entra aqui para o tooltip do gráfico poder dizer QUEM
  // está em cada fatia — o número sozinho não deixava chegar na pessoa.
  const distSituacao = useMemo(() => distrib(pq("situacao"), filtradas, avaliadoDaResposta), [pergs, mapa, filtradas, avaliadoDaResposta]);
  // categorias sem ordem intrínseca: mostrar sempre da mais citada p/ a menos
  const distNecess = useMemo(() => distrib(pq("necessidades"), filtradas, avaliadoDaResposta).sort((a, b) => b.n - a.n), [pergs, mapa, filtradas, avaliadoDaResposta]);
  const distFortes = useMemo(() => distrib(pq("fortes"), filtradas, avaliadoDaResposta).sort((a, b) => b.n - a.n), [pergs, mapa, filtradas, avaliadoDaResposta]);
  const distMelhoria = useMemo(() => distrib(pq("melhoria"), filtradas, avaliadoDaResposta).sort((a, b) => b.n - a.n), [pergs, mapa, filtradas, avaliadoDaResposta]);

  // evolução da situação por trimestre (usa base, sem o filtro de situação)
  const evolucao = useMemo(() => {
    const sitP = pq("situacao"); if (!sitP) return { data: [] as any[], cats: [] as string[] };
    const cats = (sitP.opcoes.length ? sitP.opcoes : [...new Set(base.map(r => respValor(r, sitP.id)).filter(Boolean))]).slice(0, 5);
    const porTri: Record<string, any> = {};
    base.forEach(r => { const t = trimestre(r.enviado_em); const v = respValor(r, sitP.id); if (!v) return; (porTri[t] ??= { tri: t, _ord: +new Date(r.enviado_em) }); porTri[t][v] = (porTri[t][v] || 0) + 1; });
    const data = Object.values(porTri).sort((a: any, b: any) => a._ord - b._ord).slice(-6);
    return { data, cats };
  }, [pergs, mapa, base]);

  const totalMenc = (d: { n: number }[]) => d.reduce((s, x) => s + x.n, 0);
  const topNecessPorSetor = useMemo(() => {
    const nP = pq("necessidades"); if (!nP) return [] as { setor: string; nec: string; n: number }[];
    const porSetor: Record<string, Record<string, number>> = {};
    filtradas.forEach(r => { const s = setorDe(r); const v = r.itens[nP.id]; (Array.isArray(v) ? v : [v]).forEach((x: any) => { if (x == null || x === "") return; (porSetor[s] ??= {}); porSetor[s][String(x)] = (porSetor[s][String(x)] || 0) + 1; }); });
    return Object.entries(porSetor).map(([setor, cont]) => { const top = Object.entries(cont).sort((a, b) => b[1] - a[1])[0]; return { setor, nec: top?.[0] ?? "—", n: top?.[1] ?? 0 }; }).sort((a, b) => b.n - a.n).slice(0, 6);
  }, [pergs, mapa, filtradas]);

  // ── LIDERANÇA ────────────────────────────────────────────────────────
  const dimsPergs = useMemo(() => ((mapa.dimensoes ?? []) as string[])
    .map(id => pergs.find(p => p.id === id)).filter(Boolean) as Pergunta[], [pergs, mapa]);
  // nota de uma resposta = média das dimensões que ela respondeu (1..5)
  const notaResp = useCallback((r: Resp) => {
    const ns = dimsPergs.map(p => nota(p, respValor(r, p.id))).filter((x): x is number => x != null);
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
  }, [dimsPergs]);

  const indiceGeral = useMemo(() => {
    const ns = filtradas.map(notaResp).filter((x): x is number => x != null);
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
  }, [filtradas, notaResp]);

  const porDimensao = useMemo(() => dimsPergs.map(p => {
    const ns = filtradas.map(r => nota(p, respValor(r, p.id))).filter((x): x is number => x != null);
    const t = p.titulo || "—";
    return { nome: t.length > 34 ? t.slice(0, 34) + "…" : t, completo: t, valor: ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0, n: ns.length };
  }).sort((a, b) => b.valor - a.valor), [dimsPergs, filtradas]);

  const porLideranca = useMemo(() => {
    // Antes exigia a pergunta de liderança mapeada; agora o líder do setor
    // cobre os feedbacks sem autor, então basta ter como resolver algum líder.
    const grupos: Record<string, { soma: number; n: number }> = {};
    const tris: Record<string, Record<string, { soma: number; n: number }>> = {};
    filtradas.forEach(r => {
      const quem = liderDaResposta(r); if (!quem) return;
      const nt = notaResp(r); if (nt == null) return;
      (grupos[quem] ??= { soma: 0, n: 0 }); grupos[quem].soma += nt; grupos[quem].n++;
      const t = trimestre(r.enviado_em);
      ((tris[quem] ??= {})[t] ??= { soma: 0, n: 0 }); tris[quem][t].soma += nt; tris[quem][t].n++;
    });
    const ordemTri = [...new Set(filtradas.map(r => ({ t: trimestre(r.enviado_em), o: +new Date(r.enviado_em) }))
      .sort((a, b) => a.o - b.o).map(x => x.t))];
    return Object.entries(grupos).map(([lider, g]) => {
      const ts = tris[lider] ?? {};
      const pres = ordemTri.filter(t => ts[t]);
      const ult = pres[pres.length - 1], ant = pres[pres.length - 2];
      const evol = ult && ant ? (ts[ult].soma / ts[ult].n) - (ts[ant].soma / ts[ant].n) : null;
      return { lider, indice: g.soma / g.n, n: g.n, evol };
    }).sort((a, b) => b.indice - a.indice);
  }, [filtradas, notaResp, liderDaResposta]);

  const distLideranca = useMemo(() => {
    const c: Record<string, string[]> = { destaque: [], atencao: [], critica: [] };
    porLideranca.forEach(l => { c[faixa(l.indice)].push(l.lider); });
    const item = (rot: string, ns: string[]): ItemDist => ({ nome: rot, completo: rot, n: ns.length, quem: listaQuem(ns) });
    return [
      item("Acima de 4,0", c.destaque),
      item("Entre 3,0 e 4,0", c.atencao),
      item("Abaixo de 3,0", c.critica),
    ];
  }, [porLideranca]);

  const evolIndice = useMemo(() => {
    const porTri: Record<string, { soma: number; n: number; o: number }> = {};
    filtradas.forEach(r => { const nt = notaResp(r); if (nt == null) return; const t = trimestre(r.enviado_em); (porTri[t] ??= { soma: 0, n: 0, o: +new Date(r.enviado_em) }); porTri[t].soma += nt; porTri[t].n++; });
    return Object.entries(porTri).map(([t, v]) => ({ tri: t, indice: +(v.soma / v.n).toFixed(2), _o: v.o })).sort((a, b) => a._o - b._o).slice(-6);
  }, [filtradas, notaResp]);
  const deltaIndice = evolIndice.length > 1 ? evolIndice[evolIndice.length - 1].indice - evolIndice[evolIndice.length - 2].indice : null;
  const avaliados = useMemo(() => filtradas.filter(r => notaResp(r) != null).length, [filtradas, notaResp]);

  // ── ALINHAMENTO E ENTREGA ────────────────────────────────────────────
  const alinP = pq("alinhamento"), entP = pq("entrega"), contP = pq("contribuicao");
  const indiceAlin = useCallback((r: Resp) => {
    const ns = [alinP, entP, contP].map(p => p ? nota(p, respValor(r, p.id)) : null).filter((x): x is number => x != null);
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
  }, [alinP, entP, contP]);

  const alinKpis = useMemo(() => {
    const sAlin = serieTrimestre(filtradas, r => alinP ? nota(alinP, respValor(r, alinP.id)) : null);
    const sEnt = serieTrimestre(filtradas, r => entP ? nota(entP, respValor(r, entP.id)) : null);
    const sCon = serieTrimestre(filtradas, r => contP ? nota(contP, respValor(r, contP.id)) : null);
    const sGer = serieTrimestre(filtradas, indiceAlin);
    return {
      alin: mediaNota(alinP, filtradas), dAlin: deltaSerie(sAlin),
      ent: mediaNota(entP, filtradas), dEnt: deltaSerie(sEnt),
      con: mediaNota(contP, filtradas), dCon: deltaSerie(sCon),
      geral: (() => { const ns = filtradas.map(indiceAlin).filter((x): x is number => x != null); return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null; })(),
      dGeral: deltaSerie(sGer), serieGeral: sGer,
      metasConcl: pctPrimeiraOpcao(pq("metasConcluidas"), filtradas),
      metasPrazo: pctPrimeiraOpcao(pq("metasPrazo"), filtradas),
    };
  }, [filtradas, alinP, entP, contP, indiceAlin, pergs, mapa]);

  const distAlin = useMemo(() => {
    const c: Record<string, string[]> = { alto: [], medio: [], baixo: [] };
    filtradas.forEach(r => {
      const v = indiceAlin(r); if (v == null) return;
      (v >= 4 ? c.alto : v >= 3 ? c.medio : c.baixo).push(avaliadoDaResposta(r));
    });
    const item = (rot: string, ns: string[]): ItemDist => ({ nome: rot, completo: rot, n: ns.length, quem: listaQuem(ns) });
    return [
      item("Alto (4,0 a 5,0)", c.alto),
      item("Médio (3,0 a 3,9)", c.medio),
      item("Baixo (0 a 2,9)", c.baixo),
    ];
  }, [filtradas, indiceAlin, avaliadoDaResposta]);

  // Só setor de verdade: fora "Sem setor" e os pseudo-setores de cargo
  // ("DIRETOR ADMINISTRATIVO" é quem responde por setores, não um setor).
  const alinPorSetor = useMemo(() => agrupaMedia(filtradas, setorDe, indiceAlin)
    .filter(x => x.chave !== SEM_SETOR && ehSetorReal(x.chave)), [filtradas, indiceAlin]);
  const topLidAlin = useMemo(() => agrupaMedia(filtradas, liderDaResposta, indiceAlin), [filtradas, liderDaResposta, indiceAlin]);
  // Rankings comparam times reais: "Sem setor" fica de fora.
  const topSetorEntrega = useMemo(() => agrupaMedia(filtradas, setorDe, r => entP ? nota(entP, respValor(r, entP.id)) : null)
    .filter(x => x.chave !== SEM_SETOR && ehSetorReal(x.chave)), [filtradas, entP]);
  const topLidContrib = useMemo(() => agrupaMedia(filtradas, liderDaResposta, r => contP ? nota(contP, respValor(r, contP.id)) : null), [filtradas, liderDaResposta, contP]);

  const exportarCsvAlin = () => {
    const l: string[][] = [["Bloco", "Item", "Valor"]];
    l.push(["Índice", "Alinhamento às metas", alinKpis.alin != null ? alinKpis.alin.toFixed(2) : "—"]);
    l.push(["Índice", "Qualidade da entrega", alinKpis.ent != null ? alinKpis.ent.toFixed(2) : "—"]);
    l.push(["Índice", "Contribuição para resultados", alinKpis.con != null ? alinKpis.con.toFixed(2) : "—"]);
    l.push(["Índice", "Geral de alinhamento", alinKpis.geral != null ? alinKpis.geral.toFixed(2) : "—"]);
    distAlin.forEach(d => l.push(["Distribuição", d.completo, String(d.n)]));
    alinPorSetor.forEach(s => l.push(["Alinhamento por setor", s.chave, s.media.toFixed(2)]));
    topLidAlin.forEach(x => l.push(["Líder — alinhamento", x.chave, x.media.toFixed(2)]));
    topSetorEntrega.forEach(x => l.push(["Setor — entrega", x.chave, x.media.toFixed(2)]));
    const csv = l.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `alinhamento-entrega-${(form?.titulo ?? "painel").replace(/[^\w-]+/g, "_")}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const ultimaAtualizacao = useMemo(() => {
    const ts = respsForm.reduce((m, r) => Math.max(m, +new Date(r.enviado_em)), 0);
    return ts ? new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
  }, [respsForm]);

  // categoria de "risco": a que parecer risco/ruim, senão a última opção da pergunta.
  const catRisco = useMemo(() => {
    const sitP = pq("situacao"); if (!sitP) return "";
    const ops = sitP.opcoes ?? [];
    return ops.find(o => /risco|ruim|insatisf|cr[íi]tic/i.test(o)) ?? ops[ops.length - 1] ?? "";
  }, [pergs, mapa]);

  const riscoPorNecessidade = useMemo(() => {
    const nP = pq("necessidades"), sP = pq("situacao");
    if (!nP || !sP || !catRisco) return [] as { nec: string; n: number }[];
    const emRisco = filtradas.filter(r => respValor(r, sP.id) === catRisco);
    const cont: Record<string, number> = {};
    emRisco.forEach(r => { const v = r.itens[nP.id]; (Array.isArray(v) ? v : [v]).forEach((x: any) => { if (x == null || x === "") return; cont[String(x)] = (cont[String(x)] || 0) + 1; }); });
    return Object.entries(cont).map(([nec, n]) => ({ nec, n })).sort((a, b) => b.n - a.n).slice(0, 6);
  }, [pergs, mapa, filtradas, catRisco]);

  const exportarCsv = () => {
    const linhas: string[][] = [["Indicador", "Item", "Quantidade"]];
    const push = (ind: string, d: { completo: string; n: number }[]) => d.forEach(x => linhas.push([ind, x.completo, String(x.n)]));
    push("Situação profissional", distSituacao);
    push("Necessidades de desenvolvimento", distNecess);
    push("Pontos fortes", distFortes);
    push("Pontos de melhoria", distMelhoria);
    const csv = linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `desenvolvimento-${(form?.titulo ?? "painel").replace(/[^\w-]+/g, "_")}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const exportarCsvLid = () => {
    const linhas: string[][] = [["Bloco", "Item", "Valor"]];
    linhas.push(["Índice geral", "Média (1-5)", indiceGeral != null ? indiceGeral.toFixed(2) : "—"]);
    porDimensao.forEach(d => linhas.push(["Índice por dimensão", d.completo, d.valor.toFixed(2)]));
    distLideranca.forEach(d => linhas.push(["Distribuição", d.completo, String(d.n)]));
    porLideranca.forEach(l => linhas.push(["Liderança", l.lider, `${l.indice.toFixed(2)} (${l.n} avaliações)`]));
    const csv = linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lideranca-${(form?.titulo ?? "painel").replace(/[^\w-]+/g, "_")}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>;

  const mudaViz = (k: string, v: Viz) => setViz(x => ({ ...x, [k]: v }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      {/* Cabeçalho + abas */}
      <div style={{ margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px 10px", flexWrap: "wrap" }}>
          <button onClick={() => nav("/app/central-servicos/formularios")} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>← Voltar</button>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>📈 Painel Gerencial</div>
            <div style={{ fontSize: 11.5, color: "#94a3b8" }}>Indicadores dos feedbacks — apoio à gestão.</div>
          </div>
          {/* "Líderes por setor" foi centralizado na Administração → Módulos & Menus →
              Acesso por Usuário (regra geral por setor). */}
          <div style={{ minWidth: 240 }}>
            <label style={lbl}>Formulário (fonte)</label>
            <select value={formSel} onChange={e => setFormSel(e.target.value)} style={inp}>
              {forms.map(f => <option key={f.id} value={f.id}>{f.titulo}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, padding: "0 12px", borderTop: "1px solid #f1f5f9", overflowX: "auto" }}>
          {TABS.map(t => {
            const on = t === tab;
            const pronto = TABS_PRONTAS.includes(t);
            return (
              <button key={t} onClick={() => setTab(t)} style={{ padding: "11px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: on ? 800 : 600, color: on ? "#0f3171" : "#94a3b8", borderBottom: on ? "3px solid #0f3171" : "3px solid transparent", whiteSpace: "nowrap" }}>
                {t}{!pronto && <span style={{ fontSize: 9, marginLeft: 5, color: "#cbd5e1" }}>em breve</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Barra de filtros */}
      <div style={{ margin: "12px 24px 0", padding: "12px 16px", border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0 }}>
        {/* Em "Indicadores e Cálculos" não há número para filtrar — é o dicionário
            do painel. Some com os filtros e sobra só o mapeamento, que é o que
            se conserta a partir dali. */}
        <div style={{ display: tab === "Indicadores e Cálculos" ? "none" : "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <div><label style={lbl}>Período</label>
            <select value={periodo} onChange={e => setPeriodo(e.target.value as any)} style={inp}>
              <option value="todos">Todo o período</option><option value="90">Últimos 90 dias</option><option value="180">Últimos 180 dias</option><option value="365">Último ano</option>
            </select></div>
          <MultiSelectEmpresa opcoes={empresasOpc} sel={fEmpresas} setSel={setFEmpresas} />
          <div><label style={lbl}>Diretoria</label>
            <select value={fDiretoria} onChange={e => setFDiretoria(e.target.value)} style={inp}>
              <option value="">Todas</option>{Object.keys(DIRETORIAS).map(d => <option key={d} value={d}>{d}</option>)}
            </select></div>
          <div><label style={lbl}>Setor</label>
            {escopoSetores && escopoSetores.size === 1 ? (
              <select value={setores[0] ?? ""} disabled title="Você só tem acesso a este setor" style={{ ...inp, background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }}>
                <option value={setores[0] ?? ""}>{setores[0] ?? "—"}</option>
              </select>
            ) : (
              <select value={fSetor} onChange={e => setFSetor(e.target.value)} style={inp}><option value="">{escopoSetores ? "Todos (permitidos)" : "Todos"}</option>{setores.map(s => <option key={s} value={s}>{s}</option>)}</select>
            )}</div>
          <div><label style={lbl}>Liderança</label>
            <select value={fLider} onChange={e => setFLider(e.target.value)} style={inp} disabled={!lideresOpc.length}>
              <option value="">{lideresOpc.length ? "Todas" : "Sem líder definido"}</option>{lideresOpc.map(l => <option key={l} value={l}>{l}</option>)}
            </select></div>
          <div><label style={lbl}>Colaborador</label><input value={fResp} onChange={e => setFResp(e.target.value)} placeholder="Nome…" style={inp} /></div>
          <FiltroFuturo label="Situação do feedback" />
          {/* Na aba Planos de Ação os filtros do feedback não se aplicam — quem
              manda ali é situação/prioridade/origem do próprio plano. */}
          {tab === "Planos de Ação" ? (
            <>
              <div><label style={lbl}>Situação do plano</label>
                <select value={fSitPlano} onChange={e => setFSitPlano(e.target.value)} style={inp}>
                  <option value="">Todas</option>{SITUACOES.map(o => <option key={o} value={o}>{o}</option>)}
                </select></div>
              <div><label style={lbl}>Prioridade</label>
                <select value={fPrioridade} onChange={e => setFPrioridade(e.target.value)} style={inp}>
                  <option value="">Todas</option>{PRIORIDADES.map(o => <option key={o} value={o}>{o}</option>)}
                </select></div>
              <div><label style={lbl}>Origem do plano</label>
                <select value={fOrigem} onChange={e => setFOrigem(e.target.value)} style={inp}>
                  <option value="">Todas</option>{ORIGENS.map(o => <option key={o} value={o}>{o}</option>)}
                </select></div>
            </>
          ) : (
            <>
              <div><label style={lbl}>Situação profissional</label>
                <select value={fSituacao} onChange={e => setFSituacao(e.target.value)} style={inp}><option value="">Todas</option>{(pq("situacao")?.opcoes ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select></div>
              <div><label style={lbl}>Necessidade</label>
                <select value={fNecessidade} onChange={e => setFNecessidade(e.target.value)} style={inp}><option value="">Todas</option>{(pq("necessidades")?.opcoes ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select></div>
              <FiltroFuturo label="Situação do plano de ação" />
            </>
          )}
        </div>
        <div ref={mapaRef} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8, flexWrap: "wrap", scrollMarginTop: 12 }}>
          <button onClick={() => setMostrarMapa(v => !v)} style={{ background: "none", border: "none", color: "#0f3171", fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>⚙ Mapeamento de perguntas {mostrarMapa ? "▴" : "▾"}</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {tab !== "Indicadores e Cálculos" && <button onClick={() => { setPeriodo("todos"); setFSetor(""); setFResp(""); setFSituacao(""); setFNecessidade(""); setFSitPlano(""); setFPrioridade(""); setFOrigem(""); setFEmpresas([]); setFDiretoria(""); setFLider(""); }} style={btn("#f1f5f9", "#475569", "1px solid #e2e8f0")}>Limpar filtros</button>}
            {mostrarMapa && <button onClick={() => setMostrarMapa(false)} style={btn("#f1f5f9", "#475569", "1px solid #e2e8f0")}>✕ Fechar mapeamento</button>}
          </div>
        </div>
        {mostrarMapa && (
          <div style={{ marginTop: 10, borderTop: "1px dashed #e2e8f0", paddingTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            {tab === "Liderança" || tab === "Indicadores e Cálculos" ? (
              <>
                {tab === "Indicadores e Cálculos" && CAMPOS_MAPA.filter(c => c.key !== "lider").map(c => (
                  <div key={c.key}><label style={lbl}>{c.label}</label>
                    <select value={mapa[c.key] ?? ""} onChange={e => salvarMapa({ ...mapa, [c.key]: e.target.value || undefined })} style={inp}>
                      <option value="">— nenhuma —</option>
                      {pergs.filter(p => !c.tipos || c.tipos.includes(p.tipo)).map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                    </select>
                  </div>
                ))}
                <div><label style={lbl}>Quem é a liderança avaliada</label>
                  <select value={mapa.lider ?? ""} onChange={e => salvarMapa({ ...mapa, lider: e.target.value || undefined })} style={inp}>
                    <option value="">— nenhuma —</option>
                    {pergs.map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: "1/-1" }}>
                  <label style={lbl}>Dimensões avaliadas (viram o índice 1–5)</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {pergs.filter(p => ["escala", "multipla_escolha", "lista_suspensa"].includes(p.tipo)).map(p => {
                      const on = ((mapa.dimensoes ?? []) as string[]).includes(p.id);
                      return (
                        <span key={p.id} onClick={() => {
                          const atual = (mapa.dimensoes ?? []) as string[];
                          salvarMapa({ ...mapa, dimensoes: on ? atual.filter(x => x !== p.id) : [...atual, p.id] });
                        }} title={p.titulo}
                          style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: on ? "1px solid #0f3171" : "1px solid #e2e8f0", background: on ? "#0f3171" : "#fff", color: on ? "#fff" : "#64748b" }}>
                          {p.titulo || "(sem título)"}
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                    Escalas viram nota direto. Em perguntas de opção, assume-se a <b>1ª opção como a melhor</b> (5) e a última como a pior (1).
                  </div>
                </div>
              </>
            ) : tab === "Histórico Individual" ? (
              <>
                <div><label style={lbl}>Colaborador avaliado</label>
                  <select value={mapa.avaliado ?? ""} onChange={e => salvarMapa({ ...mapa, avaliado: e.target.value || undefined })} style={inp}>
                    <option value="">— nenhuma —</option>
                    {pergs.map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>Pontos fortes</label>
                  <select value={mapa.fortes ?? ""} onChange={e => salvarMapa({ ...mapa, fortes: e.target.value || undefined })} style={inp}>
                    <option value="">— nenhuma —</option>
                    {pergs.map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>Pontos de melhoria</label>
                  <select value={mapa.melhoria ?? ""} onChange={e => salvarMapa({ ...mapa, melhoria: e.target.value || undefined })} style={inp}>
                    <option value="">— nenhuma —</option>
                    {pergs.map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: "1/-1", fontSize: 11, color: "#94a3b8" }}>
                  O <b>colaborador avaliado</b> é o sujeito do histórico. Quem preenche o feedback é o líder,
                  então o nome de quem foi avaliado está numa pergunta — não no respondente.
                  A nota 1–5 vem das <b>dimensões</b> (aba Liderança).
                </div>
              </>
            ) : tab === "Planos de Ação" ? (
              <>
                {IND_PLANO.map(ind => (
                  <div key={ind.key}><label style={lbl}>{ind.label}</label>
                    <select value={mapa[ind.key] ?? ""} onChange={e => salvarMapa({ ...mapa, [ind.key]: e.target.value || undefined })} style={inp}>
                      <option value="">— nenhuma —</option>
                      {pergs.map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                    </select>
                  </div>
                ))}
                <div style={{ gridColumn: "1/-1", fontSize: 11, color: "#94a3b8" }}>
                  Cada resposta que preencher a <b>ação definida</b> vira um plano de ação nesta tela.
                  O <b>prazo</b> alimenta vencimento e dias em atraso — respostas sem prazo legível entram como “sem prazo”.
                </div>
              </>
            ) : tab === "Visão Executiva" ? (
              <>
                {/* Só o que ESTA aba consome: quem foi avaliado (o denominador da
                    taxa), a situação profissional e os dois rankings. */}
                {[{ key: "avaliado", label: "Colaborador avaliado (define quem já recebeu feedback)", tipos: undefined as string[] | undefined },
                  ...IND.filter(i => ["situacao", "necessidades"].includes(i.key)).map(i => ({ key: i.key, label: i.label, tipos: CHART_TIPOS })),
                  ...IND_EXEC.map(i => ({ key: i.key, label: i.label, tipos: CHART_TIPOS }))].map(c => (
                  <div key={c.key}><label style={lbl}>{c.label}</label>
                    <select value={mapa[c.key] ?? ""} onChange={e => salvarMapa({ ...mapa, [c.key]: e.target.value || undefined })} style={inp}>
                      <option value="">— nenhuma —</option>
                      {pergs.filter(p => !c.tipos || c.tipos.includes(p.tipo)).map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                    </select>
                  </div>
                ))}
                <div style={{ gridColumn: "1/-1", fontSize: 11, color: "#94a3b8" }}>
                  O <b>colaborador avaliado</b> é o que liga a resposta a uma pessoa do cadastro — é dele que saem
                  realizados, pendentes e a taxa de realização. Sem ele a aba não tem denominador.
                </div>
              </>
            ) : tab === "Alinhamento e Entrega" ? IND_ALIN.map(ind => (
              <div key={ind.key}><label style={lbl}>{ind.label}</label>
                <select value={mapa[ind.key] ?? ""} onChange={e => salvarMapa({ ...mapa, [ind.key]: e.target.value || undefined })} style={inp}>
                  <option value="">— nenhuma —</option>
                  {pergs.filter(p => ["escala", "multipla_escolha", "lista_suspensa"].includes(p.tipo)).map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                </select>
              </div>
            )) : IND.map(ind => (
              <div key={ind.key}><label style={lbl}>{ind.label}</label>
                <select value={mapa[ind.key] ?? ""} onChange={e => salvarMapa({ ...mapa, [ind.key]: e.target.value || undefined })} style={inp}>
                  <option value="">— nenhuma —</option>
                  {pergs.filter(p => CHART_TIPOS.includes(p.tipo)).map(p => <option key={p.id} value={p.id}>{p.titulo || "(sem título)"}</option>)}
                </select>
              </div>
            ))}
            <div style={{ gridColumn: "1/-1", fontSize: 11, color: "#94a3b8" }}>Escolha qual pergunta alimenta cada indicador. Fica salvo neste navegador por formulário.</div>
            <div style={{ gridColumn: "1/-1", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setMostrarMapa(false)} style={btn("#0f3171")}>✕ Fechar mapeamento</button>
            </div>
          </div>
        )}
      </div>

      {/* Conteúdo */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 40px" }}>
        {/* Antes do "selecione um formulário": o dicionário de indicadores vale
            mesmo sem formulário escolhido — só a coluna de mapeamento fica vazia. */}
        {tab === "Indicadores e Cálculos" ? (
          <IndicadoresCalculos
            pergs={pergs} mapa={mapa} ultima={ultimaAtualizacao} temForm={!!form}
            onAbrirMapa={abrirMapa} onIrTab={t => TABS.includes(t) && setTab(t)} />
        ) : !form ? (
          <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Selecione um formulário.</div>
        ) : tab === "Visão Executiva" ? (
          <VisaoExecutiva
            resps={filtradas} emps={empsFiltrados} empsTodos={emps} pergs={pergs} mapa={mapa} planos={planosAcao.planos}
            diretorPorSetor={diretorSetor} recorte={filtrosResumo}
            distSituacao={distSituacao} distNecess={distNecess}
            ultima={ultimaAtualizacao} cadastroCarregando={cadastroCarregando}
            onAbrirMapa={abrirMapa} onIrTab={t => TABS.includes(t) && setTab(t)} />
        ) : tab === "Cumprimento" ? (
          <PainelCumprimento
            emps={empsFiltrados} empsTodos={emps} resps={filtradas} avaliadoDaResposta={avaliadoDaResposta}
            mapas={mapasHier} encerraEm={form?.encerra_em ?? null}
            ultima={ultimaAtualizacao} recorte={filtrosResumo} />
        ) : tab === "Liderança" ? (
          <PainelLideranca
            indice={indiceGeral} dist={distLideranca} porDim={porDimensao} evol={evolIndice}
            delta={deltaIndice} avaliados={avaliados} lideres={porLideranca}
            temMapa={(!!pq("lider") || liderSetor.size > 0) && dimsPergs.length > 0}
            ultima={ultimaAtualizacao} onExport={exportarCsvLid}
            viz={viz} onViz={mudaViz} onAbrirMapa={abrirMapa} />
        ) : tab === "Alinhamento e Entrega" ? (
          <PainelAlinhamento
            k={alinKpis} dist={distAlin} porSetor={alinPorSetor}
            topLidAlin={topLidAlin} topSetorEntrega={topSetorEntrega} topLidContrib={topLidContrib}
            temMapa={!!(alinP || entP || contP)} ultima={ultimaAtualizacao} onExport={exportarCsvAlin}
            viz={viz} onViz={mudaViz} onAbrirMapa={abrirMapa} />
        ) : tab === "Planos de Ação" ? (
          <PainelPlanosAcao
            formId={formSel} ultima={ultimaAtualizacao} respostas={pessoasForm}
            fontes={fontesPlano} temMapa={!!mapa.acaoPlano} onAbrirMapa={abrirMapa}
            temPrazoMapeado={!!mapa.prazoPlano && mapa.prazoPlano !== mapa.acaoPlano}
            planos={planosAcao.planos} carregando={planosAcao.carregando}
            erro={planosAcao.erro} recarregar={planosAcao.recarregar}
            filtros={{ periodo, setor: fSetor, colaborador: fResp, situacao: fSitPlano, prioridade: fPrioridade, origem: fOrigem }} />
        ) : tab === "Histórico Individual" ? (
          <HistoricoIndividual
            resps={respsForm} pergs={pergs} mapa={mapa} planos={planosAcao.planos}
            ultima={ultimaAtualizacao} periodo={periodo} setor={fSetor}
            onAbrirMapa={abrirMapa} />
        ) : tab !== "Desenvolvimento" ? (
          <div style={{ padding: 70, textAlign: "center", color: "#94a3b8", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14 }}>
            A aba <b>{tab}</b> entra em breve.
          </div>
        ) : (
          <>
            {/* Título da seção + exportar */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>DESENVOLVIMENTO</div>
                <div style={{ fontSize: 12.5, color: "#64748b" }}>Entenda as necessidades de desenvolvimento da equipe e onde concentrar esforços.</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "right", lineHeight: 1.4 }}>
                  Última atualização<br /><b style={{ color: "#475569" }}>{ultimaAtualizacao}</b>
                </div>
                <button onClick={exportarCsv} style={btn("#fff", "#0f3171", "1px solid #0f3171")}>⬇ Exportar relatório</button>
              </div>
            </div>

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 16 }}>
              {distSituacao.slice(0, 4).map((d, i) => (
                <Kpi key={d.completo} titulo={d.completo} valor={d.n} cor={CAT_CORES[i]} icone={["🧭", "🚀", "🤝", "⚠️"][i] ?? "•"} sub={`${pct(d.n, totalMenc(distSituacao))} do total`} />
              ))}
              <Kpi titulo="Pontos fortes citados" valor={totalMenc(distFortes)} cor="#7c3aed" icone="⭐" sub="Menções no período" />
              <Kpi titulo="Pontos de melhoria citados" valor={totalMenc(distMelhoria)} cor="#0891b2" icone="🎯" sub="Menções no período" />
            </div>

            {filtradas.length === 0 ? (
              <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14 }}>Sem respostas no recorte atual.</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginBottom: 14 }}>
                  <Painel titulo="Evolução da situação profissional" viz={viz.evolucao} onViz={v => mudaViz("evolucao", v)} vizOpts={["linha", "area", "colunas"]} perg={pq("situacao")}>
                    <EvolucaoChart data={evolucao.data} cats={evolucao.cats} viz={viz.evolucao} />
                  </Painel>
                  <Painel titulo="Necessidades de desenvolvimento" viz={viz.necessidades} onViz={v => mudaViz("necessidades", v)} perg={pq("necessidades")}>
                    <Chart dados={distNecess} viz={viz.necessidades} cor="#2563eb" />
                  </Painel>
                  <Painel titulo="Distribuição por necessidade" viz={viz.distribuicao} onViz={v => mudaViz("distribuicao", v)} perg={pq("necessidades")}>
                    <Chart dados={distNecess} viz={viz.distribuicao} cor="#2563eb" />
                  </Painel>
                  <Painel titulo="Top necessidades por setor" semViz>
                    {topNecessPorSetor.length === 0 ? <Vazio /> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {topNecessPorSetor.map((x, i) => (
                          <div key={x.setor} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "baseline", borderTop: i ? "1px solid #f1f5f9" : "none", paddingTop: i ? 6 : 0 }}>
                            <span style={{ fontWeight: 800, color: "#94a3b8", width: 16 }}>{i + 1}</span>
                            <span style={{ fontWeight: 700, color: "#0f172a", minWidth: 90 }}>{x.setor}</span>
                            <span style={{ flex: 1, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.nec}</span>
                            <span style={{ fontWeight: 800, color: "#0f172a" }}>{x.n}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Painel>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginBottom: 14 }}>
                  <Painel titulo="Pontos fortes mais citados" viz={viz.fortes} onViz={v => mudaViz("fortes", v)} perg={pq("fortes")}>
                    <Chart dados={distFortes} viz={viz.fortes} cor="#16a34a" />
                  </Painel>
                  <Painel titulo="Pontos de melhoria mais citados" viz={viz.melhoria} onViz={v => mudaViz("melhoria", v)} perg={pq("melhoria")}>
                    <Chart dados={distMelhoria} viz={viz.melhoria} cor="#dc2626" />
                  </Painel>
                  <Painel titulo={`Em ${catRisco || "risco"} por principal necessidade`} semViz>
                    {riscoPorNecessidade.length === 0 ? <Vazio /> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {riscoPorNecessidade.map((x, i) => {
                          const tot = riscoPorNecessidade.reduce((s, y) => s + y.n, 0);
                          return (
                            <div key={x.nec} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "baseline", borderTop: i ? "1px solid #f1f5f9" : "none", paddingTop: i ? 6 : 0 }}>
                              <span style={{ flex: 1, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.nec}>{x.nec}</span>
                              <span style={{ fontWeight: 800, color: "#dc2626" }}>{x.n}</span>
                              <span style={{ fontSize: 11, color: "#94a3b8", width: 42, textAlign: "right" }}>{pct(x.n, tot)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Painel>
                  <Painel titulo="Insights principais" semViz>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: "#334155" }}>
                      {insightNec(distNecess)}
                      {insightSit(distSituacao)}
                      {insightForte(distFortes)}
                    </div>
                  </Painel>
                </div>

                {/* Detalhamento por situação — clique filtra o painel inteiro */}
                <div style={{ fontSize: 12, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".5px", margin: "4px 0 8px" }}>Detalhamento por situação</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
                  {distSituacao.slice(0, 4).map((d, i) => {
                    const ativo = fSituacao === d.completo;
                    return (
                      <button key={d.completo} onClick={() => setFSituacao(ativo ? "" : d.completo)} title="Clique para filtrar por esta situação"
                        style={{ textAlign: "left", cursor: "pointer", background: "#fff", border: ativo ? `2px solid ${CAT_CORES[i]}` : "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: CAT_CORES[i], textTransform: "uppercase", letterSpacing: ".4px" }}>{d.completo}{ativo ? " ✓" : ""}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{d.n}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>colaborador(es) · {pct(d.n, totalMenc(distSituacao))}</div>
                        <div style={{ fontSize: 10.5, color: "#cbd5e1", marginTop: 4 }}>{ativo ? "filtrando — clique p/ limpar" : "clique para filtrar"}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 18, borderTop: "1px solid #eef2f7", paddingTop: 10 }}>
          ⓘ Os indicadores são baseados nas respostas dos feedbacks e têm caráter de apoio à gestão, não devendo ser usados isoladamente para decisões de promoção, punição ou desligamento.
        </div>
      </div>
    </div>
  );
}
