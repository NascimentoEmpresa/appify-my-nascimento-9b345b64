import { useState, useMemo } from "react";
import {
  Empregado, MapasHier, liderAcimaDe, ehSetorReal, ehPerfilEsperado, ehTrabalhando,
  normNome, normSetor,
} from "./LideresSetor";

// =====================================================================
// PAINEL GERENCIAL — aba CUMPRIMENTO
//
// Responde: quem JÁ recebeu feedback no ciclo, quem ainda está PENDENTE e o
// que passou do prazo. Diferente das outras abas, aqui o denominador NÃO são
// as respostas — é o CADASTRO:
//
//   Esperados  = quem deveria receber feedback  (Perfil_ERP ADMINISTRATIVO +
//                Situação "Trabalhando" — régua do RH, ver LideresSetor)
//   Realizados = dos esperados, quem aparece como avaliado numa resposta
//   Pendentes  = esperados − realizados
//
// O PRAZO do ciclo é o `encerra_em` do formulário: é um prazo só, igual para
// todo mundo (não existe data-limite por pessoa no cadastro). Sem ele, os
// blocos de prazo aparecem desligados e explicando o porquê, em vez de
// inventar vencimento.
// =====================================================================

export interface Resp { id: string; formulario_id?: string; enviado_em: string; setor?: string | null; itens: Record<string, any>; respondente_nome?: string | null }

const cardBox: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" };
const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "7px 13px", borderRadius: 9, border, background: bg, color: c, fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
const th: React.CSSProperties = { padding: "7px 6px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".4px", color: "#94a3b8", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid #eef2f7" };
const td: React.CSSProperties = { padding: "8px 6px", fontSize: 11.5, color: "#475569", borderTop: "1px solid #f5f7fb" };

const CSS_CUMP = `
.cp-g3{display:grid;gap:14px;grid-template-columns:1fr 1fr 1fr}
.cp-g4{display:grid;gap:14px;grid-template-columns:1.3fr 1.3fr 1fr}
@media (max-width:1250px){.cp-g3,.cp-g4{grid-template-columns:1fr 1fr}}
@media (max-width:760px){.cp-g3,.cp-g4{grid-template-columns:1fr}}
.cp-g3>*,.cp-g4>*{min-width:0}
.cp-tab{width:100%;border-collapse:collapse;table-layout:fixed}
.cp-tab td>div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

const nInt = (n: number) => n.toLocaleString("pt-BR");
const pct1 = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
const fmtD = (iso?: string | null) => { if (!iso) return "—"; const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${a}`; };
const hojeISO = () => new Date().toISOString().slice(0, 10);
const dias = (de: string, ate: string) => Math.round((+new Date(ate.slice(0, 10) + "T00:00:00") - +new Date(de.slice(0, 10) + "T00:00:00")) / 864e5);

function Kpi({ titulo, valor, sub, cor, icone }: { titulo: string; valor: string; sub: string; cor: string; icone: string }) {
  return (
    <div style={cardBox}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: cor + "18", color: cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{icone}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{titulo}</div>
          <div style={{ fontSize: 25, fontWeight: 800, color: "#0f172a", lineHeight: 1.15 }}>{valor}</div>
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: cor, fontWeight: 700, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function Painel({ titulo, children, rodape }: { titulo: string; children: React.ReactNode; rodape?: React.ReactNode }) {
  return (
    <div style={{ ...cardBox, padding: 16, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12 }}>{titulo}</div>
      <div style={{ flex: 1 }}>{children}</div>
      {rodape}
    </div>
  );
}
const Vazio = ({ msg }: { msg: string }) => <div style={{ fontSize: 12, color: "#94a3b8", padding: "18px 0", textAlign: "center" }}>{msg}</div>;

// Uma linha agregada (por liderança, setor ou diretoria).
interface Grupo { chave: string; esperados: number; realizados: number; pendentes: number; taxa: number }

function TabelaGrupo({ titulo, rotulo, dados, onVerTodos }: {
  titulo: string; rotulo: string; dados: Grupo[]; onVerTodos: () => void;
}) {
  return (
    <Painel titulo={titulo} rodape={dados.length > 5 ? (
      <button onClick={onVerTodos} style={{ marginTop: 10, background: "none", border: "none", color: "#0f3171", fontSize: 11.5, fontWeight: 800, cursor: "pointer", padding: 0, alignSelf: "flex-end" }}>
        Ver {rotulo.toLowerCase()} ({nInt(dados.length)}) →
      </button>) : undefined}>
      {dados.length === 0 ? <Vazio msg="Sem dados no recorte." /> : (
        <table className="cp-tab">
          <colgroup><col style={{ width: 20 }} /><col /><col style={{ width: 46 }} /><col style={{ width: 46 }} /><col style={{ width: 44 }} /><col style={{ width: 52 }} /></colgroup>
          <thead><tr>
            <th style={th}>#</th><th style={th}>{rotulo}</th>
            <th style={{ ...th, textAlign: "center" }} title="Esperados">Esp.</th>
            <th style={{ ...th, textAlign: "center" }} title="Realizados">Real.</th>
            <th style={{ ...th, textAlign: "center" }} title="Pendentes">Pend.</th>
            <th style={{ ...th, textAlign: "right" }}>% Real.</th>
          </tr></thead>
          <tbody>
            {dados.slice(0, 5).map((g, i) => (
              <tr key={g.chave}>
                <td style={{ ...td, color: "#94a3b8", fontWeight: 800 }}>{i + 1}</td>
                <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}><div title={g.chave}>{g.chave}</div></td>
                <td style={{ ...td, textAlign: "center" }}>{nInt(g.esperados)}</td>
                <td style={{ ...td, textAlign: "center", fontWeight: 800 }}>{nInt(g.realizados)}</td>
                <td style={{ ...td, textAlign: "center", color: g.pendentes ? "#b45309" : "#94a3b8", fontWeight: 800 }}>{nInt(g.pendentes)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 800, color: g.taxa >= 90 ? "#16a34a" : g.taxa >= 70 ? "#b45309" : "#dc2626" }}>{pct1(g.taxa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Painel>
  );
}

// ── Componente ───────────────────────────────────────────────────────
export default function PainelCumprimento({ emps, empsTodos, resps, avaliadoDaResposta, mapas, encerraEm, ultima, recorte }: {
  emps: Empregado[];                               // cadastro JÁ recortado pelos filtros da barra
  empsTodos: Empregado[];                          // cadastro inteiro — só para saber se o Perfil_ERP veio
  resps: Resp[];                                   // respostas do formulário no recorte
  avaliadoDaResposta: (r: Resp) => string;
  mapas: MapasHier;
  encerraEm: string | null;                        // prazo do ciclo (CS_FORMULARIOS.encerra_em)
  ultima: string;
  recorte: string;                                 // resumo dos filtros ativos, para os rótulos
}) {
  const [lista, setLista] = useState<{ titulo: string; linhas: Grupo[] } | null>(null);
  const [verPendentes, setVerPendentes] = useState(false);
  const hoje = hojeISO();

  // Prazo do ciclo: uma data só para todos. Sem ela, nada de atraso é inventado.
  const prazo = encerraEm ? encerraEm.slice(0, 10) : null;
  const diasDoPrazo = prazo ? dias(prazo, hoje) : null;       // >0 = venceu há N dias
  const venceu = diasDoPrazo != null && diasDoPrazo > 0;
  const proximo = diasDoPrazo != null && diasDoPrazo <= 0 && diasDoPrazo >= -7;

  // Quem é ESPERADO no ciclo: régua do RH (perfil administrativo + trabalhando),
  // só em setor de verdade. Os filtros da barra — setor, diretoria, liderança,
  // empresa, colaborador — já vieram aplicados em `emps`, para o denominador
  // andar junto com as respostas.
  const esperados = useMemo(() => emps.filter(e =>
    ehPerfilEsperado(e.perfil) && ehTrabalhando(e.situacao) && ehSetorReal(e.setor)
  ), [emps]);

  // Se NINGUÉM tem perfil, a coluna não veio do banco — avisar em vez de dizer
  // que o cumprimento é zero.
  const semPerfil = useMemo(() => empsTodos.length > 0 && empsTodos.every(e => !e.perfil), [empsTodos]);

  // Quem já foi avaliado (por nome normalizado).
  const realizadosSet = useMemo(() => {
    const s = new Set<string>();
    resps.forEach(r => { const n = normNome(avaliadoDaResposta(r)); if (n) s.add(n); });
    return s;
  }, [resps, avaliadoDaResposta]);

  // Cada esperado com seu status e a quem responde.
  const pessoas = useMemo(() => esperados.map(e => ({
    ...e,
    feito: realizadosSet.has(normNome(e.nome)),
    lider: liderAcimaDe(e.nome, e.setor, mapas) || "Sem liderança",
    diretoria: mapas.diretorPorSetor.get(normSetor(e.setor)) || "Sem diretoria",
  })), [esperados, realizadosSet, mapas]);

  const k = useMemo(() => {
    const esp = pessoas.length, real = pessoas.filter(p => p.feito).length;
    const pend = esp - real;
    return {
      esp, real, pend,
      taxa: esp ? (real / esp) * 100 : 0,
      foraPrazo: venceu ? pend : 0,
      proximos: proximo ? pend : 0,
    };
  }, [pessoas, venceu, proximo]);

  // Agrega por uma chave qualquer (liderança / setor / diretoria).
  const agrupa = (chave: (p: typeof pessoas[number]) => string): Grupo[] => {
    const m = new Map<string, { e: number; r: number }>();
    pessoas.forEach(p => {
      const c = chave(p) || "—";
      const g = m.get(c) ?? { e: 0, r: 0 }; g.e++; if (p.feito) g.r++; m.set(c, g);
    });
    return [...m.entries()].map(([chave, g]) => ({
      chave, esperados: g.e, realizados: g.r, pendentes: g.e - g.r,
      taxa: g.e ? (g.r / g.e) * 100 : 0,
    })).sort((a, b) => b.esperados - a.esperados || a.chave.localeCompare(b.chave, "pt-BR"));
  };
  const porLideranca = useMemo(() => agrupa(p => p.lider), [pessoas]);
  const porSetor = useMemo(() => agrupa(p => p.setor), [pessoas]);
  const porDiretoria = useMemo(() => agrupa(p => p.diretoria), [pessoas]);

  const pendentes = useMemo(() => pessoas.filter(p => !p.feito)
    .sort((a, b) => a.setor.localeCompare(b.setor, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR")), [pessoas]);
  const lidAbaixo = useMemo(() => porLideranca.filter(g => g.taxa < 90).length, [porLideranca]);

  const exportar = () => {
    const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const L: any[][] = [["Bloco", "Chave", "Esperados", "Realizados", "Pendentes", "% Realização"]];
    L.push(["Resumo", "Geral", k.esp, k.real, k.pend, pct1(k.taxa)]);
    porLideranca.forEach(g => L.push(["Liderança", g.chave, g.esperados, g.realizados, g.pendentes, pct1(g.taxa)]));
    porSetor.forEach(g => L.push(["Setor", g.chave, g.esperados, g.realizados, g.pendentes, pct1(g.taxa)]));
    porDiretoria.forEach(g => L.push(["Diretoria", g.chave, g.esperados, g.realizados, g.pendentes, pct1(g.taxa)]));
    pendentes.forEach(p => L.push(["Pendente", p.nome, p.setor, p.lider, p.diretoria, ""]));
    const csv = "﻿" + L.map(l => l.map(esc).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "cumprimento.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  if (semPerfil) {
    return (
      <div style={{ ...cardBox, padding: 44, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Falta o Perfil_ERP no cadastro</div>
        <div style={{ fontSize: 12.5, color: "#64748b", maxWidth: 580, margin: "0 auto", lineHeight: 1.5 }}>
          O Cumprimento precisa saber <b>quem era esperado</b> no ciclo, e isso vem do <b>Perfil_ERP</b> (administrativo)
          — que a leitura do cadastro não trouxe. Aplique a migration <code>20260724000001_rh_hierarquia_perfil.sql</code>
          no banco do app. Sem ela eu mostraria 0% de cumprimento, o que seria falso.
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{CSS_CUMP}</style>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>CUMPRIMENTO</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Acompanhe quem já realizou, quem ainda está pendente e o que está fora do prazo.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "right", lineHeight: 1.4 }}>Última atualização<br /><b style={{ color: "#475569" }}>{ultima}</b></div>
          <button onClick={exportar} style={btn("#fff", "#0f3171", "1px solid #0f3171")}>⬇ Exportar relatório</button>
        </div>
      </div>

      {/* Prazo do ciclo — a régua de "fora do prazo". */}
      <div style={{ ...cardBox, marginBottom: 14, background: prazo ? (venceu ? "#fffbeb" : "#f0f7ff") : "#f8fafc", borderColor: prazo ? (venceu ? "#fed7aa" : "#dbeafe") : "#e2e8f0", fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
        {prazo
          ? venceu
            ? <><b style={{ color: "#0f172a" }}>Prazo do ciclo encerrado em {fmtD(prazo)}</b> — há {nInt(diasDoPrazo!)} dia(s). Os {nInt(k.pend)} pendentes estão <b style={{ color: "#b45309" }}>fora do prazo</b>.</>
            : <><b style={{ color: "#0f172a" }}>Prazo do ciclo: {fmtD(prazo)}</b> — faltam {nInt(Math.abs(diasDoPrazo!))} dia(s).{proximo && <> Os pendentes já contam como <b>próximos do prazo</b>.</>}</>
          : <><b style={{ color: "#0f172a" }}>Este formulário não tem prazo de encerramento.</b> Por isso “fora do prazo” e “próximos do prazo” ficam zerados — não existe data-limite por pessoa no cadastro, e eu não invento vencimento. Defina o <b>encerra_em</b> do formulário para ativar o controle de atraso.</>}
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi titulo="Feedbacks esperados" valor={nInt(k.esp)} sub={recorte ? `Perfil administrativo, trabalhando · ${recorte}` : "Perfil administrativo, trabalhando"} cor="#2563eb" icone="👥" />
        <Kpi titulo="Feedbacks realizados" valor={nInt(k.real)} sub={`${pct1(k.taxa)} do esperado`} cor="#16a34a" icone="✅" />
        <Kpi titulo="Taxa de realização" valor={pct1(k.taxa)} sub={k.taxa >= 90 ? "Dentro da meta de 90%" : "Abaixo da meta de 90%"} cor={k.taxa >= 90 ? "#16a34a" : "#dc2626"} icone="％" />
        <Kpi titulo="Feedbacks pendentes" valor={nInt(k.pend)} sub={`${pct1(k.esp ? (k.pend / k.esp) * 100 : 0)} do esperado`} cor="#f59e0b" icone="⏳" />
        <Kpi titulo="Fora do prazo" valor={nInt(k.foraPrazo)} sub={prazo ? (venceu ? `Prazo venceu em ${fmtD(prazo)}` : "Prazo ainda aberto") : "Sem prazo definido"} cor="#dc2626" icone="⚠️" />
        <Kpi titulo="Próximos do prazo" valor={nInt(k.proximos)} sub={prazo ? (proximo ? "Vence em até 7 dias" : "Fora da janela de 7 dias") : "Sem prazo definido"} cor="#0891b2" icone="🕓" />
        <Kpi titulo="Dias desde o prazo" valor={venceu ? nInt(diasDoPrazo!) : "—"} sub={venceu ? "Ciclo encerrado" : "Prazo não venceu"} cor="#7c3aed" icone="📆" />
      </div>

      {/* Realização por liderança / setor / diretoria */}
      <div className="cp-g3" style={{ marginBottom: 14 }}>
        <TabelaGrupo titulo="Realização por liderança" rotulo="Liderança" dados={porLideranca}
          onVerTodos={() => setLista({ titulo: "Realização por liderança", linhas: porLideranca })} />
        <TabelaGrupo titulo="Realização por setor" rotulo="Setor" dados={porSetor}
          onVerTodos={() => setLista({ titulo: "Realização por setor", linhas: porSetor })} />
        <TabelaGrupo titulo="Realização por diretoria" rotulo="Diretoria" dados={porDiretoria}
          onVerTodos={() => setLista({ titulo: "Realização por diretoria", linhas: porDiretoria })} />
      </div>

      {/* Pendentes + ações */}
      <div className="cp-g4" style={{ marginBottom: 14 }}>
        <Painel titulo={venceu ? "Pendentes — fora do prazo" : "Colaboradores pendentes"}
          rodape={pendentes.length > 6 ? (
            <button onClick={() => setVerPendentes(true)} style={{ marginTop: 10, background: "none", border: "none", color: "#0f3171", fontSize: 11.5, fontWeight: 800, cursor: "pointer", padding: 0, alignSelf: "flex-end" }}>
              Ver todos os pendentes ({nInt(pendentes.length)}) →
            </button>) : undefined}>
          {pendentes.length === 0 ? <Vazio msg="Todo mundo com feedback no ciclo. 🎉" /> : (
            <table className="cp-tab">
              <colgroup><col /><col style={{ width: 92 }} /><col style={{ width: 100 }} /></colgroup>
              <thead><tr><th style={th}>Colaborador</th><th style={th}>Setor</th><th style={th}>Liderança</th></tr></thead>
              <tbody>
                {pendentes.slice(0, 6).map(p => (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 600, color: "#0f172a" }}><div title={p.nome}>{p.nome}</div></td>
                    <td style={td}><div title={p.setor}>{p.setor}</div></td>
                    <td style={td}><div title={p.lider}>{p.lider}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="Lideranças abaixo da meta">
          {porLideranca.filter(g => g.taxa < 90).length === 0 ? <Vazio msg="Todas as lideranças em 90% ou mais. 🎉" /> : (
            <table className="cp-tab">
              <colgroup><col /><col style={{ width: 46 }} /><col style={{ width: 52 }} /></colgroup>
              <thead><tr><th style={th}>Liderança</th><th style={{ ...th, textAlign: "center" }}>Pend.</th><th style={{ ...th, textAlign: "right" }}>% Real.</th></tr></thead>
              <tbody>
                {porLideranca.filter(g => g.taxa < 90).sort((a, b) => a.taxa - b.taxa).slice(0, 6).map(g => (
                  <tr key={g.chave}>
                    <td style={{ ...td, fontWeight: 600, color: "#0f172a" }}><div title={g.chave}>{g.chave}</div></td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 800, color: "#b45309" }}>{nInt(g.pendentes)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800, color: g.taxa >= 70 ? "#b45309" : "#dc2626" }}>{pct1(g.taxa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>

        <Painel titulo="⚠ Ações recomendadas">
          <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12, color: "#475569" }}>
            {[
              k.pend > 0 && { i: "🔔", c: "#dc2626", t: `Cobrar ${nInt(k.pend)} feedback(s) pendente(s)${venceu ? " — o prazo já venceu" : ""}.` },
              lidAbaixo > 0 && { i: "👥", c: "#f59e0b", t: `${nInt(lidAbaixo)} liderança(s) abaixo de 90% de realização.` },
              !prazo && { i: "📆", c: "#7c3aed", t: "Definir o prazo de encerramento do formulário para ativar o controle de atraso." },
              porSetor.filter(g => g.taxa < 70).length > 0 && { i: "🏢", c: "#dc2626", t: `${nInt(porSetor.filter(g => g.taxa < 70).length)} setor(es) abaixo de 70%.` },
              k.taxa >= 90 && { i: "✅", c: "#16a34a", t: "Cumprimento dentro da meta — manter o acompanhamento." },
            ].filter(Boolean).slice(0, 5).map((x: any, i) => (
              <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: x.c + "18", color: x.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, flexShrink: 0 }}>{x.i}</span>
                <span style={{ lineHeight: 1.45 }}>{x.t}</span>
              </div>
            ))}
          </div>
        </Painel>
      </div>

      {/* Insights */}
      <div style={{ ...cardBox, padding: 16 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12 }}>Insights automáticos</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 14 }}>
          {[
            porDiretoria[0] && { i: "📈", c: "#2563eb", t: `A diretoria ${porDiretoria[0].chave} concentra ${nInt(porDiretoria[0].esperados)} esperado(s), com ${pct1(porDiretoria[0].taxa)} de realização.` },
            [...porSetor].sort((a, b) => a.taxa - b.taxa)[0] && { i: "⚠️", c: "#dc2626", t: `O setor ${[...porSetor].sort((a, b) => a.taxa - b.taxa)[0].chave} tem a menor taxa (${pct1([...porSetor].sort((a, b) => a.taxa - b.taxa)[0].taxa)}).` },
            k.pend > 0 && { i: "👤", c: "#f59e0b", t: `${nInt(k.pend)} colaborador(es) ainda não receberam feedback neste ciclo.` },
            [...porLideranca].sort((a, b) => b.taxa - a.taxa)[0] && { i: "🏅", c: "#16a34a", t: `${[...porLideranca].sort((a, b) => b.taxa - a.taxa)[0].chave} lidera o cumprimento (${pct1([...porLideranca].sort((a, b) => b.taxa - a.taxa)[0].taxa)}).` },
            venceu && { i: "🔔", c: "#dc2626", t: `O ciclo encerrou há ${nInt(diasDoPrazo!)} dia(s) — todo pendente já está fora do prazo.` },
          ].filter(Boolean).slice(0, 5).map((x: any, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: x.c + "18", color: x.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{x.i}</span>
              <span style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.45 }}>{x.t}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 12, lineHeight: 1.5 }}>
        ⓘ “Esperados” sai do cadastro (Perfil_ERP administrativo + Situação trabalhando), não das respostas — por isso o
        cumprimento mede quem <b>faltou</b>, e não só quem apareceu. A liderança de cada pessoa vem da hierarquia
        (líder do setor → diretor → CEO), nunca ela mesma.
      </div>

      {/* Ver todos — grupos */}
      {lista && (
        <div onClick={e => { if (e.target === e.currentTarget) setLista(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 940, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: 760, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #eef2f7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f3171" }}>{lista.titulo} ({nInt(lista.linhas.length)})</div>
              <button onClick={() => setLista(null)} style={{ border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ overflowY: "auto", padding: "6px 20px 18px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>#</th><th style={th}>Nome</th>
                  <th style={{ ...th, textAlign: "center" }}>Esperados</th>
                  <th style={{ ...th, textAlign: "center" }}>Realizados</th>
                  <th style={{ ...th, textAlign: "center" }}>Pendentes</th>
                  <th style={{ ...th, textAlign: "right" }}>% Realização</th>
                </tr></thead>
                <tbody>
                  {lista.linhas.map((g, i) => (
                    <tr key={g.chave}>
                      <td style={{ ...td, color: "#94a3b8", fontWeight: 800 }}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{g.chave}</td>
                      <td style={{ ...td, textAlign: "center" }}>{nInt(g.esperados)}</td>
                      <td style={{ ...td, textAlign: "center", fontWeight: 800 }}>{nInt(g.realizados)}</td>
                      <td style={{ ...td, textAlign: "center", fontWeight: 800, color: g.pendentes ? "#b45309" : "#94a3b8" }}>{nInt(g.pendentes)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, color: g.taxa >= 90 ? "#16a34a" : g.taxa >= 70 ? "#b45309" : "#dc2626" }}>{pct1(g.taxa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Ver todos — pendentes */}
      {verPendentes && (
        <div onClick={e => { if (e.target === e.currentTarget) setVerPendentes(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 940, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: 820, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #eef2f7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f3171" }}>Colaboradores pendentes ({nInt(pendentes.length)})</div>
              <button onClick={() => setVerPendentes(false)} style={{ border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ overflowY: "auto", padding: "6px 20px 18px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Colaborador</th><th style={th}>Cargo</th><th style={th}>Setor</th><th style={th}>Liderança</th><th style={th}>Diretoria</th></tr></thead>
                <tbody>
                  {pendentes.map(p => (
                    <tr key={p.id}>
                      <td style={{ ...td, fontWeight: 600, color: "#0f172a" }}>{p.nome}</td>
                      <td style={td}>{p.cargo || "—"}</td>
                      <td style={td}>{p.setor}</td>
                      <td style={td}>{p.lider}</td>
                      <td style={td}>{p.diretoria}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
