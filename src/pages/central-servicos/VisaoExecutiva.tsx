import { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";
import { Pergunta } from "./Formularios";
import { Plano, situacaoDe } from "./PainelPlanosAcao";
import { Empregado, normSetor, PERFIL_ESPERADO, ehPerfilEsperado, ehTrabalhando } from "./LideresSetor";
import { listaQuem } from "./painel/calculos";
import { ItemDist } from "./painel/tipos";
import { TipQuem } from "./painel/ui";

// =====================================================================
// PAINEL GERENCIAL — aba VISÃO EXECUTIVA
//
// A única aba que responde "e quem NÃO respondeu?". As outras leem só as
// respostas que chegaram; aqui o cadastro entra como denominador:
//
//   esperados  = colaboradores ativos no recorte (vem de EMPREGADOS)
//   realizados = quantos deles têm feedback no período
//   pendentes  = a diferença — e a lista com nome, que é o que o RH cobra
//
// Por isso a aba depende de duas coisas que as outras não exigem: o cadastro
// carregado e a pergunta "colaborador avaliado" mapeada. Sem o mapeamento não
// dá para saber DE QUEM é o feedback (quem preenche é o líder), e a taxa de
// realização viraria chute — então a tela avisa em vez de inventar número.
//
// Nada aqui é gravado: todo indicador é derivado na hora, das respostas e do
// cadastro vivos.
// =====================================================================

// Meta de cobertura do período. Fixa no código até o RH definir política por
// ciclo — nomeada para ser fácil de virar configuração.
const META_REALIZACAO = 100;

const CORES = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#64748b"];

const cardBox: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" };
const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "7px 13px", borderRadius: 9, border, background: bg, color: c, fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
const th: React.CSSProperties = { padding: "7px 6px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".4px", color: "#94a3b8", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid #eef2f7" };
const td: React.CSSProperties = { padding: "8px 6px", fontSize: 11.5, color: "#475569", borderTop: "1px solid #f5f7fb" };

// auto-fit em vez de nº fixo de colunas: quando falta o mapeamento do avaliado,
// os cards de cobertura somem e a linha se reorganiza sozinha — com colunas
// fixas sobrava buraco no lugar do que não pôde ser calculado.
const CSS_VE = `
.ve-g4{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(288px,1fr))}
.ve-g3{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
`;

const nInt = (n: number) => n.toLocaleString("pt-BR");
const n1 = (n: number) => n.toFixed(1).replace(".", ",");
const pctTxt = (n: number, d: number) => d ? `${n1(n / d * 100)}%` : "—";
// Nome comparável entre cadastro e resposta: sem acento, sem caixa, sem espaço
// duplicado. É a chave que casa "José  da Silva" com "JOSE DA SILVA".
const chaveNome = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const trimestreDe = (iso: string) => { const d = new Date(iso); return `${Math.floor(d.getMonth() / 3) + 1}º Tri/${String(d.getFullYear()).slice(2)}`; };

interface Resp { id: string; formulario_id: string; enviado_em: string; respondente_nome?: string | null; setor?: string | null; itens: Record<string, any> }

function Kpi({ titulo, valor, sub, cor, icone }: { titulo: string; valor: string; sub: string; cor: string; icone: string }) {
  return (
    <div style={{ ...cardBox, display: "flex", gap: 11, alignItems: "flex-start" }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, background: cor + "18", color: cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{icone}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{titulo}</div>
        <div style={{ fontSize: 25, fontWeight: 800, color: "#0f172a", lineHeight: 1.15 }}>{valor}</div>
        <div style={{ fontSize: 10.5, color: cor, fontWeight: 700 }}>{sub}</div>
      </div>
    </div>
  );
}

function Painel({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ ...cardBox, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>{titulo}</div>
        {extra}
      </div>
      {children}
    </div>
  );
}

const Vazio = ({ msg }: { msg: string }) => (
  <div style={{ padding: "28px 8px", textAlign: "center", color: "#94a3b8", fontSize: 11.5, lineHeight: 1.5 }}>{msg}</div>
);

export default function VisaoExecutiva({
  resps, emps, empsTodos, pergs, mapa, planos, diretorPorSetor, recorte,
  distSituacao, distNecess, ultima, cadastroCarregando, onAbrirMapa, onIrTab,
}: {
  resps: Resp[];                       // já filtradas (período, setor, colaborador)
  emps: Empregado[];                   // cadastro JÁ recortado pelos filtros da barra
  empsTodos: Empregado[];              // cadastro inteiro — só para explicar o "fora do quadro"
  pergs: Pergunta[];
  mapa: Record<string, any>;
  planos: Plano[];
  diretorPorSetor: Map<string, string>;
  recorte: string;                     // resumo dos filtros ativos, para os rótulos
  distSituacao: ItemDist[];
  distNecess: ItemDist[];
  ultima: string;
  cadastroCarregando: boolean;
  onAbrirMapa: () => void;
  onIrTab: (t: string) => void;
}) {
  const [porDiretoria, setPorDiretoria] = useState(true);
  const [verFora, setVerFora] = useState(false);

  const pergAvaliado = pergs.find(p => p.id === mapa.avaliado);
  const pergNecLid = pergs.find(p => p.id === mapa.necLideranca);
  // Quem era esperado responder: perfil ADMINISTRATIVO e situação Trabalhando
  // (régua do RH). O recorte dos filtros da barra — setor, diretoria, liderança,
  // empresa, colaborador — já veio aplicado em `emps`, para o denominador andar
  // junto com as respostas. O resto do quadro não participa do ciclo.
  const esperados = useMemo(() => emps.filter(e =>
    ehPerfilEsperado(e.perfil) && ehTrabalhando(e.situacao)
  ), [emps]);
  // A RPC do cadastro passou a devolver o Perfil_ERP na migration 20260724000001.
  // Sem ela, TODO mundo vem com perfil vazio e o esperado daria zero — melhor
  // dizer o que falta do que exibir uma taxa impossível.
  const temPerfil = useMemo(() => empsTodos.some(e => e.perfil), [empsTodos]);

  // A COBERTURA (esperados/realizados/pendentes/taxa) é a única parte que precisa
  // do cadastro, do Perfil_ERP e da pergunta do avaliado. Todo o resto — situação
  // profissional, necessidades, planos, alertas — sai só das respostas. Por isso
  // o que falta some do lugar dele em vez de derrubar a aba: quem abre a Visão
  // Executiva quer o panorama, não um aviso em tela cheia.
  const temCobertura = empsTodos.length > 0 && temPerfil && !!pergAvaliado;

  // Quem respondeu: o COLABORADOR AVALIADO de cada resposta (não o respondente —
  // quem preenche o feedback é o líder). Uma pessoa com três feedbacks no
  // período conta uma vez.
  const feitos = useMemo(() => {
    const m = new Map<string, { nome: string; setor: string; qtd: number; ultimo: string }>();
    resps.forEach(r => {
      const bruto = (pergAvaliado ? String(r.itens[pergAvaliado.id] ?? "") : "") || (r.respondente_nome ?? "");
      const k = chaveNome(bruto); if (!k) return;
      const cur = m.get(k);
      if (cur) { cur.qtd++; if (r.enviado_em > cur.ultimo) cur.ultimo = r.enviado_em; }
      else m.set(k, { nome: String(bruto).trim(), setor: (r.setor ?? "").trim(), qtd: 1, ultimo: r.enviado_em });
    });
    return m;
  }, [resps, pergAvaliado]);

  const cob = useMemo(() => {
    const chavesEsperadas = new Set(esperados.map(e => chaveNome(e.nome)));
    const realizados = esperados.filter(e => feitos.has(chaveNome(e.nome)));
    const pendentes = esperados.filter(e => !feitos.has(chaveNome(e.nome)))
      .sort((a, b) => a.setor.localeCompare(b.setor, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
    // Feedback de quem não está (mais) no cadastro ativo: desligado depois do
    // feedback, nome digitado diferente, ou setor fora do filtro. Não vira
    // "realizado" — apareceria taxa acima de 100%.
    const foraCadastro = [...feitos.entries()].filter(([k]) => !chavesEsperadas.has(k)).map(([, v]) => v);
    return { realizados, pendentes, foraCadastro, taxa: esperados.length ? realizados.length / esperados.length * 100 : 0 };
  }, [esperados, feitos]);

  // "Fora do quadro" com o MOTIVO de cada um — sem isso a barra vermelha era um
  // número sem explicação. O cadastro inteiro (empsTodos) é que separa "não
  // existe no cadastro" de "existe, mas está fora da régua ou do recorte".
  const foraDetalhe = useMemo(() => {
    const porNome = new Map<string, Empregado>();
    empsTodos.forEach(e => { const k = chaveNome(e.nome); if (k && !porNome.has(k)) porNome.set(k, e); });
    const noRecorte = new Set(emps.map(e => chaveNome(e.nome)));
    return cob.foraCadastro.map(f => {
      const k = chaveNome(f.nome);
      const e = porNome.get(k);
      const motivo =
        !e ? "Não está no cadastro — nome digitado diferente ou pessoa de fora"
        : !ehTrabalhando(e.situacao) ? `Situação no cadastro: ${e.situacao || "—"}`
        : !ehPerfilEsperado(e.perfil) ? `Perfil ${e.perfil || "—"} — fora da régua do ciclo (${PERFIL_ESPERADO})`
        : !noRecorte.has(k) ? `Fora do recorte dos filtros — setor ${e.setor || "—"}`
        : "Não bateu com o quadro esperado";
      return { ...f, motivo };
    }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [cob.foraCadastro, empsTodos, emps]);

  // Evolução da cobertura: pessoas distintas com feedback em cada trimestre.
  // A base é o quadro ATUAL (o cadastro não guarda foto histórica), então a
  // série mostra tendência — não é auditoria de trimestre fechado.
  const evolTaxa = useMemo(() => {
    const porTri = new Map<string, { pessoas: Set<string>; o: number }>();
    resps.forEach(r => {
      const bruto = (pergAvaliado ? String(r.itens[pergAvaliado.id] ?? "") : "") || (r.respondente_nome ?? "");
      const k = chaveNome(bruto); if (!k) return;
      const t = trimestreDe(r.enviado_em);
      const cur = porTri.get(t) ?? { pessoas: new Set<string>(), o: +new Date(r.enviado_em) };
      cur.pessoas.add(k); porTri.set(t, cur);
    });
    return [...porTri.entries()].sort((a, b) => a[1].o - b[1].o).slice(-6).map(([t, v]) => ({
      tri: t, taxa: esperados.length ? +(v.pessoas.size / esperados.length * 100).toFixed(1) : 0, meta: META_REALIZACAO,
    }));
  }, [resps, pergAvaliado, esperados.length]);

  // Evolução da situação profissional: quantos em cada categoria por trimestre.
  const evolSituacao = useMemo(() => {
    const pSit = pergs.find(p => p.id === mapa.situacao);
    if (!pSit) return { dados: [] as any[], cats: [] as string[] };
    const cats = (pSit.opcoes.length ? pSit.opcoes : [...new Set(resps.map(r => String(r.itens[pSit.id] ?? "")).filter(Boolean))]).slice(0, 5);
    const porTri = new Map<string, { linha: Record<string, any>; o: number }>();
    resps.forEach(r => {
      const v = String(r.itens[pSit.id] ?? ""); if (!v || !cats.includes(v)) return;
      const t = trimestreDe(r.enviado_em);
      const cur = porTri.get(t) ?? { linha: { tri: t }, o: +new Date(r.enviado_em) };
      cur.linha[v] = (cur.linha[v] ?? 0) + 1; porTri.set(t, cur);
    });
    const dados = [...porTri.entries()].sort((a, b) => a[1].o - b[1].o).slice(-6)
      .map(([, v]) => { cats.forEach(c => { v.linha[c] ??= 0; }); return v.linha; });
    return { dados, cats };
  }, [resps, pergs, mapa.situacao]);

  // Cobertura por diretoria (RH_SETOR_DIRETOR) ou por setor. Setor sem diretor
  // designado vira uma faixa própria — some do gráfico seria esconder trabalho
  // por fazer.
  const porGrupo = useMemo(() => {
    const g = new Map<string, { esp: number; real: number }>();
    esperados.forEach(e => {
      const chave = porDiretoria
        ? (diretorPorSetor.get(normSetor(e.setor)) || "Sem diretor definido")
        : (e.setor || "Sem setor");
      const cur = g.get(chave) ?? { esp: 0, real: 0 };
      cur.esp++; if (feitos.has(chaveNome(e.nome))) cur.real++;
      g.set(chave, cur);
    });
    return [...g.entries()].map(([nome, v]) => ({
      nome: nome.length > 18 ? nome.slice(0, 18) + "…" : nome, completo: nome,
      taxa: v.esp ? +(v.real / v.esp * 100).toFixed(1) : 0, esp: v.esp, real: v.real,
    })).sort((a, b) => b.taxa - a.taxa);
  }, [esperados, feitos, porDiretoria, diretorPorSetor]);

  const vencidos = useMemo(() => planos.filter(p => situacaoDe(p) === "Vencido / Atrasado"), [planos]);

  // Volume de respostas por setor — o panorama que não depende de cadastro nem
  // de mapeamento nenhum.
  const respostasPorSetor = useMemo(() => {
    const m = new Map<string, { n: number; quem: string[] }>();
    resps.forEach(r => {
      const s = (r.setor ?? "").trim() || "Sem setor";
      const g = m.get(s) ?? { n: 0, quem: [] };
      g.n++;
      const nome = ((pergAvaliado ? String(r.itens[pergAvaliado.id] ?? "") : "") || (r.respondente_nome ?? "")).trim();
      if (nome) g.quem.push(nome);
      m.set(s, g);
    });
    return [...m.entries()].map(([completo, g]) => ({ completo, nome: completo.length > 16 ? completo.slice(0, 16) + "…" : completo, n: g.n, quem: listaQuem(g.quem) }))
      .sort((a, b) => b.n - a.n);
  }, [resps, pergAvaliado]);

  const topNecess = useMemo(() => [...distNecess].sort((a, b) => b.n - a.n).filter(d => d.n > 0).slice(0, 5), [distNecess]);
  const totalNecess = useMemo(() => distNecess.reduce((s, d) => s + d.n, 0), [distNecess]);

  const topNecLid = useMemo(() => {
    if (!pergNecLid) return [];
    const cont: Record<string, number> = {};
    resps.forEach(r => {
      const v = r.itens[pergNecLid.id]; if (v == null || v === "") return;
      (Array.isArray(v) ? v : [v]).forEach(x => { cont[String(x)] = (cont[String(x)] || 0) + 1; });
    });
    const tot = Object.values(cont).reduce((a, b) => a + b, 0);
    return Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nome, n]) => ({ nome, n, pct: tot ? n / tot * 100 : 0 }));
  }, [resps, pergNecLid]);

  const sitOrdenada = useMemo(() => distSituacao.filter(d => d.n > 0), [distSituacao]);
  const totalSit = sitOrdenada.reduce((s, d) => s + d.n, 0);
  // Última alternativa da pergunta = a pior (convenção do painel: opções escritas
  // da melhor para a pior). É a que vira "em risco" nos alertas.
  const pior = distSituacao.length ? distSituacao[distSituacao.length - 1] : null;

  const deltaTaxa = evolTaxa.length > 1 ? evolTaxa[evolTaxa.length - 1].taxa - evolTaxa[evolTaxa.length - 2].taxa : null;
  const semDiretor = useMemo(() => new Set(esperados.filter(e => !diretorPorSetor.get(normSetor(e.setor))).map(e => e.setor || "—")).size, [esperados, diretorPorSetor]);

  const alertas = useMemo(() => {
    const a: { cor: string; icone: string; titulo: string; sub: string; tab?: string }[] = [];
    // Alertas de cobertura só quando ela pôde ser calculada — sem o avaliado
    // mapeado, "todo mundo pendente" seria um alerta falso.
    if (temCobertura) {
      if (cob.pendentes.length) a.push({ cor: "#dc2626", icone: "👥", titulo: `${nInt(cob.pendentes.length)} colaborador(es) sem feedback no período`, sub: `${pctTxt(cob.pendentes.length, esperados.length)} do quadro ativo`, tab: "Cumprimento" });
      const piorGrupo = porGrupo.filter(g => g.esp >= 3).slice(-1)[0];
      if (piorGrupo && piorGrupo.taxa < META_REALIZACAO) a.push({ cor: "#f59e0b", icone: "📉", titulo: `${piorGrupo.completo}: ${n1(piorGrupo.taxa)}% de realização`, sub: `Menor cobertura entre ${porDiretoria ? "as diretorias" : "os setores"}`, tab: "Cumprimento" });
      if (cob.foraCadastro.length) a.push({ cor: "#0891b2", icone: "❓", titulo: `${nInt(cob.foraCadastro.length)} feedback(s) de pessoa fora do quadro ativo`, sub: "Desligado após o feedback ou nome digitado diferente" });
      if (semDiretor) a.push({ cor: "#7c3aed", icone: "🧭", titulo: `${nInt(semDiretor)} setor(es) sem diretor definido`, sub: "A visão por diretoria fica incompleta" });
    }
    if (vencidos.length) a.push({ cor: "#dc2626", icone: "⏰", titulo: `${nInt(vencidos.length)} plano(s) de ação vencido(s)`, sub: "Impacto direto no desenvolvimento", tab: "Planos de Ação" });
    if (pior && pior.n > 0) a.push({ cor: "#f59e0b", icone: "⚠️", titulo: `${nInt(pior.n)} em “${pior.completo}”`, sub: "Acompanhamento prioritário", tab: "Desenvolvimento" });
    return a;
  }, [cob, vencidos, pior, porGrupo, porDiretoria, esperados.length, semDiretor, temCobertura]);

  const insights = useMemo(() => {
    const i: { icone: string; texto: string }[] = [];
    if (temCobertura) {
      const diff = cob.taxa - META_REALIZACAO;
      i.push({ icone: diff >= 0 ? "✅" : "🎯", texto: `A taxa de realização está ${n1(Math.abs(diff))} pontos ${diff >= 0 ? "acima" : "abaixo"} da meta de ${META_REALIZACAO}% do período.` });
      if (deltaTaxa != null) i.push({ icone: deltaTaxa >= 0 ? "📈" : "📉", texto: `A cobertura ${deltaTaxa >= 0 ? "subiu" : "caiu"} ${n1(Math.abs(deltaTaxa))} ponto(s) em relação ao trimestre anterior.` });
    } else {
      i.push({ icone: "📥", texto: `${nInt(resps.length)} resposta(s) no recorte atual, de ${nInt(feitos.size)} pessoa(s) diferente(s).` });
    }
    if (topNecess[0]) i.push({ icone: "🎓", texto: `A necessidade mais citada é “${topNecess[0].completo}” (${pctTxt(topNecess[0].n, totalNecess)} das menções).` });
    if (topNecLid[0]) i.push({ icone: "🤝", texto: `Da liderança, o que mais se pede é “${topNecLid[0].nome}” (${n1(topNecLid[0].pct)}%).` });
    const maior = sitOrdenada.slice().sort((a, b) => b.n - a.n)[0];
    if (maior) i.push({ icone: "🧭", texto: `A situação profissional mais representativa é “${maior.completo}” (${pctTxt(maior.n, totalSit)}).` });
    if (vencidos.length) i.push({ icone: "⏰", texto: `${nInt(vencidos.length)} plano(s) vencido(s) representam ${pctTxt(vencidos.length, planos.length)} do total de planos.` });
    return i;
  }, [cob.taxa, deltaTaxa, topNecess, totalNecess, topNecLid, sitOrdenada, totalSit, vencidos, planos.length, temCobertura, resps.length, feitos.size]);

  const exportarPendentes = () => {
    const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const L = [["Nome", "Setor", "Cargo", "Situação no cadastro"]];
    cob.pendentes.forEach(p => L.push([p.nome, p.setor, p.cargo, p.situacao]));
    const csv = "﻿" + L.map(l => l.map(esc).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "feedbacks-pendentes.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  const cabecalho = (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>VISÃO EXECUTIVA</div>
        <div style={{ fontSize: 12.5, color: "#64748b" }}>
          O retrato do ciclo: quanto do quadro foi coberto, como as pessoas estão e o que exige ação.
          <br /><span style={{ fontSize: 11.5, color: "#94a3b8" }}>
            Esperado responder: perfil <b>{PERFIL_ESPERADO}</b> com situação <b>Trabalhando</b> no cadastro. Os demais não entram na conta.
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "right", lineHeight: 1.4 }}>
          Última atualização<br /><b style={{ color: "#475569" }}>{ultima}</b>
        </div>
        {cob.pendentes.length > 0 && <button onClick={exportarPendentes} style={btn("#fff", "#0f3171", "1px solid #0f3171")}>⬇ Exportar pendentes</button>}
      </div>
    </div>
  );

  if (cadastroCarregando) return <>{cabecalho}<Vazio msg="Lendo o cadastro de colaboradores…" /></>;

  return (
    <>
      <style>{CSS_VE}</style>
      {cabecalho}

      {!temCobertura && (
        <div style={{ ...cardBox, borderColor: "#fed7aa", background: "#fffbeb", marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 260, fontSize: 11.5, color: "#78350f", lineHeight: 1.55 }}>
            <b>Cobertura do quadro indisponível.</b>{" "}
            {!empsTodos.length
              ? "Não consegui ler o cadastro de colaboradores, então não há denominador para a taxa de realização. Recarregue a página; se persistir, confira o acesso ao módulo de RH."
              : !temPerfil
              ? <>O cadastro veio <b>sem o Perfil_ERP</b>, que é o que define quem precisa responder. Falta aplicar a migration <b>20260724000001_rh_hierarquia_perfil</b> no banco do app (e o <code>NOTIFY pgrst, 'reload schema'</code> que vem nela).</>
              : <>Falta apontar qual pergunta traz o <b>colaborador avaliado</b>. Quem preenche o feedback é o líder, então o nome de quem foi avaliado está numa pergunta do formulário — sem isso não dá para saber quem já recebeu feedback, e a taxa de realização seria um chute.</>}
            {" "}Os demais indicadores abaixo continuam valendo.
          </div>
          {!!empsTodos.length && temPerfil && !pergAvaliado && <button onClick={onAbrirMapa} style={btn("#0f3171")}>⚙ Abrir mapeamento</button>}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(184px,1fr))", gap: 12, marginBottom: 14 }}>
        <Kpi titulo="Respostas no período" valor={nInt(resps.length)} cor="#0f3171" icone="📥" sub={`${nInt(feitos.size)} pessoa(s) avaliada(s)`} />
        {empsTodos.length > 0 && temPerfil && <Kpi titulo="Feedbacks esperados" valor={nInt(esperados.length)} cor="#2563eb" icone="👥"
          sub={recorte ? `${PERFIL_ESPERADO} · Trabalhando · ${recorte}` : `${PERFIL_ESPERADO} · Trabalhando`} />}
        {temCobertura && <>
          <Kpi titulo="Feedbacks realizados" valor={nInt(cob.realizados.length)} cor="#16a34a" icone="✅" sub={`${pctTxt(cob.realizados.length, esperados.length)} do esperado`} />
          <Kpi titulo="Taxa de realização" valor={`${n1(cob.taxa)}%`} cor={cob.taxa >= META_REALIZACAO ? "#16a34a" : cob.taxa >= 70 ? "#f59e0b" : "#dc2626"} icone="％"
            sub={deltaTaxa == null ? `Meta: ${META_REALIZACAO}%` : `${deltaTaxa >= 0 ? "▲" : "▼"} ${n1(Math.abs(deltaTaxa))} pts vs. trimestre anterior`} />
          <Kpi titulo="Pendentes" valor={nInt(cob.pendentes.length)} cor="#dc2626" icone="⏳" sub="Sem feedback no período" />
        </>}
        {sitOrdenada.slice(0, 2).map((d, i) => (
          <Kpi key={d.completo} titulo={d.completo} valor={nInt(d.n)} cor={CORES[i + 4]} icone={["🚀", "🤝"][i]} sub={`${pctTxt(d.n, totalSit)} das respostas`} />
        ))}
        <Kpi titulo="Planos de ação vencidos" valor={nInt(vencidos.length)} cor="#0891b2" icone="⏰" sub="Ações atrasadas" />
      </div>

      {/* Linha 1: evolução, situação, cobertura, grupo */}
      <div className="ve-g4" style={{ marginBottom: 14 }}>
        {temCobertura && <Painel titulo="Evolução da taxa de realização">
          {evolTaxa.length < 2 ? <Vazio msg="É preciso pelo menos dois trimestres com respostas para desenhar a tendência." /> : (
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={evolTaxa} margin={{ top: 14, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="tri" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} unit="%" />
                <Tooltip formatter={(v: any, n: any) => [`${n1(Number(v))}%`, n === "taxa" ? "Taxa de realização" : "Meta"]} />
                <Line type="monotone" dataKey="meta" stroke="#cbd5e1" strokeDasharray="5 4" dot={false} name="Meta" />
                <Line type="monotone" dataKey="taxa" stroke="#2563eb" strokeWidth={2.4} dot={{ r: 3.5 }} name="Taxa de realização">
                  <LabelList dataKey="taxa" position="top" formatter={(v: any) => `${n1(Number(v))}%`} style={{ fontSize: 9.5, fill: "#64748b", fontWeight: 700 }} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          )}
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, lineHeight: 1.45 }}>
            ⓘ A base de cada trimestre é o quadro ativo de <b>hoje</b> — o cadastro não guarda foto histórica. Serve para tendência, não para auditoria de ciclo fechado.
          </div>
        </Painel>}

        <Painel titulo="Distribuição da situação profissional">
          {totalSit === 0 ? <Vazio msg="Sem respostas na pergunta de situação profissional no recorte atual." /> : (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={sitOrdenada} dataKey="n" nameKey="completo" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2}>
                    {sitOrdenada.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Pie>
                  <Tooltip content={<TipQuem rotulo="resposta(s)" />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                {sitOrdenada.map((d, i) => (
                  <div key={d.completo} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#475569" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: CORES[i % CORES.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.completo}>{d.completo}</span>
                    <b style={{ color: "#0f172a" }}>{nInt(d.n)}</b>
                    <span style={{ color: "#94a3b8" }}>{pctTxt(d.n, totalSit)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Painel>

        {temCobertura && <Painel titulo="Cobertura do quadro">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart layout="vertical" data={[
              { nome: "Realizados", completo: "Realizados", n: cob.realizados.length, quem: listaQuem(cob.realizados.map(e => e.nome)) },
              { nome: "Pendentes", completo: "Pendentes", n: cob.pendentes.length, quem: listaQuem(cob.pendentes.map(e => e.nome)) },
              { nome: "Fora do quadro", completo: "Fora do quadro", n: cob.foraCadastro.length, quem: listaQuem(cob.foraCadastro.map(f => f.nome)) },
            ]} margin={{ top: 4, right: 44, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis type="category" dataKey="nome" width={84} tick={{ fontSize: 10.5, fill: "#475569" }} />
              <Tooltip content={<TipQuem rotulo="pessoa(s)" />} />
              <Bar dataKey="n" radius={[0, 6, 6, 0]} barSize={20}>
                {["#16a34a", "#f59e0b", "#dc2626"].map((c, i) => <Cell key={i} fill={c} />)}
                <LabelList dataKey="n" position="right" formatter={(v: any) => `${nInt(Number(v))} (${pctTxt(Number(v), esperados.length)})`} style={{ fontSize: 9.5, fill: "#64748b", fontWeight: 700 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, lineHeight: 1.45 }}>
            ⓘ <b>Fora do quadro</b> = feedback de alguém que não está no quadro esperado deste recorte: perfil diferente de {PERFIL_ESPERADO},
            situação diferente de Trabalhando, nome digitado diferente do cadastro, ou setor fora dos filtros. Não entram na taxa — senão ela passaria de 100%.
          </div>
          {foraDetalhe.length > 0 && (
            <>
              <button onClick={() => setVerFora(v => !v)} style={{ background: "none", border: "none", color: "#0f3171", fontSize: 11, fontWeight: 800, cursor: "pointer", padding: 0, marginTop: 4, alignSelf: "flex-start" }}>
                {verFora ? "▴ Ocultar" : `▾ Ver quem está fora do quadro (${nInt(foraDetalhe.length)})`}
              </button>
              {verFora && (
                <div style={{ marginTop: 6, maxHeight: 190, overflowY: "auto", border: "1px solid #eef2f7", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr><th style={th}>Pessoa</th><th style={th}>Feedbacks</th><th style={th}>Por que está fora</th></tr></thead>
                    <tbody>
                      {foraDetalhe.map(f => (
                        <tr key={f.nome}>
                          <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{f.nome}</td>
                          <td style={{ ...td, textAlign: "center" }}>{nInt(f.qtd)}</td>
                          <td style={td}>{f.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Painel>}

        {/* Sempre disponível: sai só das respostas, não depende de cadastro nem
            de mapeamento — é o gráfico geral que sobra quando falta cobertura. */}
        <Painel titulo="Respostas por setor">
          {respostasPorSetor.length === 0 ? <Vazio msg="Sem respostas no recorte atual." /> : (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart layout="vertical" data={respostasPorSetor.slice(0, 8)} margin={{ top: 4, right: 34, left: 6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis type="category" dataKey="nome" width={96} tick={{ fontSize: 9.5, fill: "#475569" }} />
                <Tooltip content={<TipQuem rotulo="resposta(s)" />} />
                <Bar dataKey="n" fill="#2563eb" radius={[0, 6, 6, 0]} barSize={15}>
                  <LabelList dataKey="n" position="right" formatter={(v: any) => nInt(Number(v))} style={{ fontSize: 9.5, fill: "#64748b", fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {respostasPorSetor.length > 8 && (
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>Mostrando os 8 maiores de {respostasPorSetor.length} setores.</div>
          )}
        </Painel>

        {temCobertura && <Painel titulo={`Realização por ${porDiretoria ? "diretoria" : "setor"}`}
          extra={
            <button onClick={() => setPorDiretoria(v => !v)} style={btn("#f1f5f9", "#475569", "1px solid #e2e8f0")}>
              {porDiretoria ? "Ver por setor" : "Ver por diretoria"}
            </button>
          }>
          {porGrupo.length === 0 ? <Vazio msg="Sem colaboradores no recorte atual." /> : (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={porGrupo.slice(0, 8)} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="nome" tick={{ fontSize: 9, fill: "#94a3b8" }} interval={0} angle={-16} textAnchor="end" height={46} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} unit="%" />
                <Tooltip formatter={(v: any, _n: any, p: any) => [`${n1(Number(v))}% — ${p.payload.real} de ${p.payload.esp}`, p.payload.completo]} />
                <Bar dataKey="taxa" radius={[6, 6, 0, 0]} barSize={30}>
                  {porGrupo.slice(0, 8).map((g, i) => <Cell key={i} fill={g.taxa >= META_REALIZACAO ? "#16a34a" : g.taxa >= 70 ? "#f59e0b" : "#dc2626"} />)}
                  <LabelList dataKey="taxa" position="top" formatter={(v: any) => `${n1(Number(v))}%`} style={{ fontSize: 9, fill: "#64748b", fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {porDiretoria && semDiretor > 0 && (
            <div style={{ fontSize: 10, color: "#b45309", marginTop: 6, lineHeight: 1.45 }}>
              ⚠ {semDiretor} setor(es) ainda sem diretor definido — ajuste em <b>Líderes por setor</b>.
            </div>
          )}
        </Painel>}
      </div>

      {/* Linha 2: tops + alertas */}
      <div className="ve-g3" style={{ marginBottom: 14 }}>
        <Painel titulo="Top 5 — necessidades de desenvolvimento">
          {topNecess.length === 0 ? <Vazio msg="Sem menções no recorte atual." /> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>#</th><th style={th}>Necessidade</th><th style={{ ...th, textAlign: "right" }}>Citações</th><th style={{ ...th, textAlign: "right" }}>%</th></tr></thead>
              <tbody>
                {topNecess.map((d, i) => (
                  <tr key={d.completo}>
                    <td style={{ ...td, color: "#94a3b8", width: 18 }}>{i + 1}</td>
                    <td style={td}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }} title={d.completo}>{d.completo}</div>
                      <div style={{ height: 5, background: "#eef2f7", borderRadius: 20, marginTop: 3, overflow: "hidden" }}>
                        <div style={{ width: `${totalNecess ? d.n / topNecess[0].n * 100 : 0}%`, height: "100%", background: "#2563eb", borderRadius: 20 }} />
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{nInt(d.n)}</td>
                    <td style={{ ...td, textAlign: "right", color: "#94a3b8" }}>{pctTxt(d.n, totalNecess)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button onClick={() => onIrTab("Desenvolvimento")} style={{ ...btn("none", "#0f3171", "none"), alignSelf: "flex-end", marginTop: 6, padding: 0, fontSize: 11 }}>Ver todas →</button>
        </Painel>

        <Painel titulo="Top 5 — o que se pede da liderança">
          {!pergNecLid ? (
            <Vazio msg="Aponte no mapeamento a pergunta sobre o que o colaborador precisa da liderança para este ranking aparecer." />
          ) : topNecLid.length === 0 ? <Vazio msg="Sem menções no recorte atual." /> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>#</th><th style={th}>Necessidade</th><th style={{ ...th, textAlign: "right" }}>Citações</th><th style={{ ...th, textAlign: "right" }}>%</th></tr></thead>
              <tbody>
                {topNecLid.map((d, i) => (
                  <tr key={d.nome}>
                    <td style={{ ...td, color: "#94a3b8", width: 18 }}>{i + 1}</td>
                    <td style={td}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }} title={d.nome}>{d.nome}</div>
                      <div style={{ height: 5, background: "#eef2f7", borderRadius: 20, marginTop: 3, overflow: "hidden" }}>
                        <div style={{ width: `${d.n / topNecLid[0].n * 100}%`, height: "100%", background: "#7c3aed", borderRadius: 20 }} />
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{nInt(d.n)}</td>
                    <td style={{ ...td, textAlign: "right", color: "#94a3b8" }}>{n1(d.pct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!pergNecLid && <button onClick={onAbrirMapa} style={{ ...btn("#f8fbff", "#0f3171", "1px solid #dbeafe"), alignSelf: "center" }}>⚙ Abrir mapeamento</button>}
        </Painel>

        <Painel titulo="⚠ Alertas críticos">
          {alertas.length === 0 ? <Vazio msg="Nenhum alerta no recorte atual. 🎉" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {alertas.map((a, i) => (
                <div key={i} onClick={() => a.tab && onIrTab(a.tab)}
                  style={{ display: "flex", gap: 9, alignItems: "center", border: "1px solid #f1f5f9", borderLeft: `3px solid ${a.cor}`, borderRadius: 9, padding: "8px 10px", cursor: a.tab ? "pointer" : "default" }}>
                  <span style={{ width: 28, height: 28, borderRadius: 9, background: a.cor + "18", color: a.cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{a.icone}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "#0f172a", lineHeight: 1.35 }}>{a.titulo}</div>
                    <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{a.sub}</div>
                  </div>
                  {a.tab && <span style={{ color: "#cbd5e1", fontSize: 15 }}>›</span>}
                </div>
              ))}
            </div>
          )}
        </Painel>
      </div>

      {/* Linha 3: evolução da situação + pendentes nominais */}
      {/* sem gridTemplateColumns inline: a classe é quem sabe se reorganizar
          quando o card de pendentes não existe */}
      <div className="ve-g3" style={{ marginBottom: 14 }}>
        <Painel titulo="Evolução da situação profissional">
          {evolSituacao.dados.length < 2 ? <Vazio msg="É preciso pelo menos dois trimestres com respostas para comparar a evolução." /> : (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={evolSituacao.dados} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="tri" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <Tooltip />
                {evolSituacao.cats.map((c, i) => (
                  <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={CORES[i % CORES.length]} fill={CORES[i % CORES.length]} fillOpacity={.75} name={c} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            {evolSituacao.cats.map((c, i) => (
              <span key={c} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#64748b" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: CORES[i % CORES.length] }} />{c}
              </span>
            ))}
          </div>
        </Painel>

        {temCobertura && <Painel titulo={`Pendentes — quem ainda não recebeu (${nInt(cob.pendentes.length)})`}
          extra={cob.pendentes.length > 0 ? <button onClick={exportarPendentes} style={btn("#f1f5f9", "#475569", "1px solid #e2e8f0")}>⬇ CSV</button> : undefined}>
          {cob.pendentes.length === 0 ? <Vazio msg="Todo o quadro ativo recebeu feedback no recorte. 🎉" /> : (
            <>
              <div style={{ overflowY: "auto", maxHeight: 210 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th}>Colaborador</th><th style={th}>Setor</th><th style={th}>Cargo</th></tr></thead>
                  <tbody>
                    {cob.pendentes.slice(0, 40).map(p => (
                      <tr key={p.id}>
                        <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{p.nome}</td>
                        <td style={td}>{p.setor || "—"}</td>
                        <td style={{ ...td, color: "#94a3b8" }}>{p.cargo || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cob.pendentes.length > 40 && (
                <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6 }}>
                  Mostrando 40 de {nInt(cob.pendentes.length)} — o CSV traz a lista completa.
                </div>
              )}
            </>
          )}
        </Painel>}
      </div>

      {/* Insights */}
      <div style={cardBox}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>Insights automáticos</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
          {insights.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: 9, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{s.icone}</span>
              <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5 }}>{s.texto}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
        ⓘ Os indicadores apoiam a gestão e não devem ser usados isoladamente para decisões de promoção, punição ou desligamento.
      </div>
    </>
  );
}
