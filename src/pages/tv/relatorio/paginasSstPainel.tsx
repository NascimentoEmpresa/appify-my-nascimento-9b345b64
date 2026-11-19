import { useEffect, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, BarChart3, CalendarClock, CheckCircle2, GraduationCap, HardHat, HeartPulse, Siren, Stethoscope } from "lucide-react";
import {
  alertas, PAGINAS_SST, pctDe, SEGUNDOS_POR_PAGINA_SST, serieAcidentes, serieAsos, serieAtestados, serieTurmas, tomContagem, tomPct,
  totalPendentesAso, variacao, type DadosSstPainelTv, type PaginaSst, type Tom,
} from "@/lib/tv/sstPainelTv";
import { Anel, FONTE, GraficoMensal, LogoTv, TINTA, TINTA_SUAVE, Vazio } from "./base";

// =====================================================================
// TV › SST — painel gerencial (SIS-2026-0816, mig 20261121110000).
// Quatro blocos, 20 s cada, sem depender da duração do item: Treinamentos,
// ASOs, Afastamentos e atestados, Acidentes. Sem nome de colaborador.
// Regras e séries: src/lib/tv/sstPainelTv.ts.
// Sem setInterval: a troca de bloco e o relógio andam por setTimeout.
// =====================================================================

const VERDE_SST = "#047857";
const COR_TOM: Record<Tom, string> = { bom: "#16a34a", atencao: "#d97706", critico: "#dc2626", neutro: VERDE_SST };
const sombra = "0 10px 30px -14px rgba(15,23,42,.28)";
const COR_TIPO = { admissional: "#0ea5e9", periodico: "#16a34a", retorno: "#a855f7", troca_funcao: "#f59e0b", demissional: "#64748b" };
const COR_MOTIVO = ["#ef4444", "#ec4899", "#f59e0b", "#3b82f6", "#94a3b8", "#14b8a6"];
const ICONE: Record<PaginaSst, ReactNode> = {
  treinamentos: <GraduationCap style={{ width: 34, height: 34 }} />,
  asos: <Stethoscope style={{ width: 34, height: 34 }} />,
  afastamentos: <HeartPulse style={{ width: 34, height: 34 }} />,
  acidentes: <Siren style={{ width: 34, height: 34 }} />,
};
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR");

function Kpi({ titulo, valor, sub, tom = "neutro" }: { titulo: string; valor: string; sub?: string; tom?: Tom }) {
  const cor = COR_TOM[tom];
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[24px] bg-white px-7 py-4" style={{ boxShadow: sombra, borderTop: `8px solid ${cor}` }}>
      <p className="font-extrabold leading-tight" style={{ fontSize: 21, color: TINTA }}>{titulo}</p>
      <p className="mt-1 font-black leading-none tabular-nums" style={{ fontSize: 58, color: cor }}>{valor}</p>
      {sub && <p className="mt-1 truncate font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{sub}</p>}
    </div>
  );
}

function Painel({ icone, titulo, sub, children, className = "" }: { icone: ReactNode; titulo: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-[26px] bg-white px-8 py-5 ${className}`} style={{ boxShadow: sombra }}>
      <div className="mb-3 flex items-center gap-4">
        <span className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-2xl" style={{ background: "#ecfdf5", color: VERDE_SST }}>{icone}</span>
        <div className="min-w-0">
          <p className="truncate font-extrabold leading-tight" style={{ fontSize: 25, color: TINTA }}>{titulo}</p>
          {sub && <p className="truncate font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{sub}</p>}
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Barras horizontais (contrato/curso): duas medidas por linha. */
function BarrasDuplas({ itens, a, b }: { itens: { nome: string; a: number; b: number }[]; a: { nome: string; cor: string }; b: { nome: string; cor: string } }) {
  if (!itens.length) return <Vazio texto="Nada pendente." />;
  const max = Math.max(1, ...itens.map((i) => Math.max(i.a, i.b)));
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex gap-6 font-bold" style={{ fontSize: 18, color: TINTA_SUAVE }}>
        {[a, b].map((s) => <span key={s.nome} className="flex items-center gap-2"><i className="inline-block h-4 w-4 rounded" style={{ background: s.cor }} />{s.nome}</span>)}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-around">
        {itens.map((i, k) => (
          <div key={i.nome} className="grid grid-cols-[330px_1fr] items-center gap-4" style={{ animation: `sst-entra 500ms ease-out ${k * 80}ms backwards` }}>
            <p className="truncate text-right font-bold" style={{ fontSize: 19, color: TINTA }} title={i.nome}>{i.nome}</p>
            <div className="space-y-1">
              {[{ v: i.a, cor: a.cor }, { v: i.b, cor: b.cor }].map((x, j) => (
                <div key={j} className="flex items-center gap-3">
                  <div className="h-[14px] rounded-r-full" style={{ width: `${Math.max(1, (x.v / max) * 86)}%`, background: x.cor, animation: "sst-cresce 900ms cubic-bezier(.2,.8,.2,1)", transformOrigin: "left" }} />
                  <span className="font-black tabular-nums" style={{ fontSize: 19 }}>{n(x.v)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaginaTreinamentos({ d, agir }: { d: DadosSstPainelTv; agir: { texto: string; valor: number }[] }) {
  const t = d.treinamentos;
  const pOnline = pctDe(t.online.concluidos, t.online.obrigatorios);
  return (
    <>
      <div className="grid shrink-0 grid-cols-6 gap-5" style={{ height: 176 }}>
        <Kpi titulo="Obrigatórios NR (contrato × função)" valor={n(t.nr.total)} sub={`${n(t.nr.contratos)} contratos`} />
        <Kpi titulo="Em dia" valor={n(t.nr.em_dia)} sub={`${pctDe(t.nr.em_dia, t.nr.total) ?? 0}% da matriz`} tom={tomPct(pctDe(t.nr.em_dia, t.nr.total))} />
        <Kpi titulo="Vencidos" valor={n(t.nr.vencidos)} sub="reciclagem atrasada" tom={tomContagem(t.nr.vencidos)} />
        <Kpi titulo="Próximos do vencimento" valor={n(t.nr.proximos)} sub="vencem em até 30 dias" tom={tomContagem(t.nr.proximos, 5)} />
        <Kpi titulo="Pendentes (sem registro)" valor={n(t.nr.pendentes)} sub="nunca registrados" tom={tomContagem(t.nr.pendentes)} />
        <Kpi titulo="Online obrigatório concluído" valor={pOnline == null ? "—" : `${pOnline}%`} sub={`${n(t.online.concluidos)} de ${n(t.online.obrigatorios)} (pessoa × curso)`} tom={tomPct(pOnline)} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.25fr_1fr] gap-6">
        <Painel icone={<BarChart3 style={{ width: 28, height: 28 }} />} titulo="Contratos com treinamento NR a regularizar" sub="obrigatórios vencidos e sem registro, por contrato">
          <BarrasDuplas itens={t.nr.por_contrato.slice(0, 7).map((c) => ({ nome: c.contrato, a: c.vencidos, b: c.pendentes }))}
            a={{ nome: "Vencidos", cor: "#dc2626" }} b={{ nome: "Sem registro", cor: "#94a3b8" }} />
        </Painel>
        <div className="grid min-h-0 grid-rows-2 gap-6">
          <Painel icone={<GraduationCap style={{ width: 28, height: 28 }} />} titulo="Cursos online liberados por contrato"
            sub={`${n(t.online.pendentes)} pendentes · ${n(t.online.pessoas)} pessoas com curso obrigatório`}>
            <BarrasDuplas itens={t.online.por_curso.slice(0, 3).map((c) => ({ nome: c.curso, a: c.obrigatorios, b: c.concluidos }))}
              a={{ nome: "Obrigatórios", cor: "#a7f3d0" }} b={{ nome: "Concluídos", cor: VERDE_SST }} />
          </Painel>
          <Painel icone={<CalendarClock style={{ width: 28, height: 28 }} />} titulo="Turmas presenciais por mês"
            sub={`${n(t.turmas.realizadas_ano)} no ano · ${n(t.turmas.participantes_ano)} participantes${t.turmas.proxima ? ` · próxima ${t.turmas.proxima.data.split("-").reverse().slice(0, 2).join("/")} ${t.turmas.proxima.contrato}` : ""}`}>
            <GraficoMensal dados={serieTurmas(t.turmas.mensal)} series={[{ chave: "turmas", nome: "Turmas", cor: VERDE_SST }]}
              linha={{ chave: "participantes", nome: "Participantes", cor: "#f59e0b" }} />
          </Painel>
        </div>
      </div>
      <AgirRodape itens={agir} />
    </>
  );
}

function PaginaAsos({ d, agir }: { d: DadosSstPainelTv; agir: { texto: string; valor: number }[] }) {
  const a = d.asos;
  const v = variacao(a.mes, a.mes_anterior);
  const pend = totalPendentesAso(a.pendentes);
  return (
    <>
      <div className="grid shrink-0 grid-cols-6 gap-5" style={{ height: 176 }}>
        <Kpi titulo="ASOs realizados no ano" valor={n(a.ano.total)} sub="todos os tipos" />
        <Kpi titulo="Realizados no mês" valor={n(a.mes)} sub={v == null ? `mês anterior: ${n(a.mes_anterior)}` : `${v >= 0 ? "+" : ""}${v}% contra o mês anterior`} />
        <Kpi titulo="Pendentes" valor={n(pend)} sub="admissional, demissional, função, retorno, periódico" tom={tomContagem(pend, 30)} />
        <Kpi titulo="Periódicos realizados no ano" valor={n(a.periodicos.realizados_ano)} sub={`${n(a.periodicos.em_dia)} colaboradores em dia`} />
        <Kpi titulo="Periódicos vencidos" valor={n(a.periodicos.vencidos)} sub={`+ ${n(a.periodicos.aguardando)} aguardando agendamento`} tom={tomContagem(a.periodicos.vencidos, 20)} />
        <Kpi titulo="Periódicos próximos" valor={n(a.periodicos.proximos)} sub={`vencem em ${a.periodicos.dias_aviso} dias · ${n(a.periodicos.agendados)} agendados`} tom={tomContagem(a.periodicos.proximos, 40)} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-6">
        <Painel icone={<BarChart3 style={{ width: 28, height: 28 }} />} titulo="ASOs realizados por mês e tipo" sub="últimos 12 meses — ERP + planilha importada, sem repetir o mesmo exame">
          <GraficoMensal empilhado dados={serieAsos(a.mensal)} series={[
            { chave: "admissional", nome: "Admissional", cor: COR_TIPO.admissional }, { chave: "periodico", nome: "Periódico", cor: COR_TIPO.periodico },
            { chave: "retorno", nome: "Retorno", cor: COR_TIPO.retorno }, { chave: "troca_funcao", nome: "Mudança de função", cor: COR_TIPO.troca_funcao },
            { chave: "demissional", nome: "Demissional", cor: COR_TIPO.demissional }]} />
        </Painel>
        <Painel icone={<Stethoscope style={{ width: 28, height: 28 }} />} titulo="Realizados no ano, por tipo">
          <Anel centro={n(a.ano.total)} sub="no ano" fatias={[
            { nome: "Admissional", n: a.ano.por_tipo.admissional ?? 0, cor: COR_TIPO.admissional },
            { nome: "Periódico", n: a.ano.por_tipo.periodico ?? 0, cor: COR_TIPO.periodico },
            { nome: "Retorno", n: a.ano.por_tipo.retorno ?? 0, cor: COR_TIPO.retorno },
            { nome: "Mudança de função", n: a.ano.por_tipo.troca_funcao ?? 0, cor: COR_TIPO.troca_funcao },
            { nome: "Demissional", n: a.ano.por_tipo.demissional ?? 0, cor: COR_TIPO.demissional }]} />
        </Painel>
      </div>
      <AgirRodape itens={agir} />
    </>
  );
}

function PaginaAfastamentos({ d, agir }: { d: DadosSstPainelTv; agir: { texto: string; valor: number }[] }) {
  const f = d.afastamentos;
  const at = f.atestados;
  const v = variacao(at.mes.dias, at.mes_anterior.dias);
  const media = at.ano.qtd ? Math.round((10 * at.ano.dias) / at.ano.qtd) / 10 : null;
  return (
    <>
      <div className="grid shrink-0 grid-cols-6 gap-5" style={{ height: 176 }}>
        <Kpi titulo="Afastados hoje" valor={n(f.ativos)} sub="Controle de Afastamentos" />
        <Kpi titulo="Auxílio-doença" valor={n(f.auxilio_doenca)} sub={f.acidente_trabalho ? `+ ${n(f.acidente_trabalho)} por acidente de trabalho` : "INSS"} />
        <Kpi titulo="Licença-maternidade" valor={n(f.licenca_maternidade)} />
        <Kpi titulo="Retornos previstos" valor={n(f.retornos_30d)} sub={f.retorno_atrasado ? `próximos 30 dias · ${n(f.retorno_atrasado)} com previsão vencida` : "próximos 30 dias"} tom={f.retorno_atrasado ? "atencao" : "neutro"} />
        <Kpi titulo="Atestados no mês" valor={n(at.mes.qtd)} sub={`${n(at.mes.dias)} dias · mês anterior ${n(at.mes_anterior.qtd)} (${n(at.mes_anterior.dias)} dias)`}
          tom={v != null && v > 20 ? "atencao" : "neutro"} />
        <Kpi titulo="Dias por atestado" valor={media == null ? "—" : media.toLocaleString("pt-BR")} sub={`média no ano · ${n(at.ano.qtd)} atestados, ${n(at.ano.dias)} dias`} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-6">
        <Painel icone={<BarChart3 style={{ width: 28, height: 28 }} />} titulo="Atestados por mês — comparativo" sub="quantidade de atestados (barras) e dias de afastamento (linha), últimos 12 meses">
          <GraficoMensal dados={serieAtestados(at.mensal)} series={[{ chave: "qtd", nome: "Atestados", cor: "#ec4899" }]}
            linha={{ chave: "dias", nome: "Dias de afastamento", cor: "#0f766e" }} />
        </Painel>
        <Painel icone={<HeartPulse style={{ width: 28, height: 28 }} />} titulo="Afastados hoje, por motivo">
          {f.ativos ? (
            <Anel centro={n(f.ativos)} sub="afastados" fatias={f.por_motivo.map((m, i) => ({ nome: m.motivo, n: m.qtd, cor: COR_MOTIVO[i % COR_MOTIVO.length] }))} />
          ) : <Vazio texto="Ninguém afastado." />}
        </Painel>
      </div>
      <AgirRodape itens={agir} />
    </>
  );
}

function PaginaAcidentes({ d, agir }: { d: DadosSstPainelTv; agir: { texto: string; valor: number }[] }) {
  const a = d.acidentes;
  const ano = new Date().getFullYear();
  const v = variacao(a.ano.total, a.ano_anterior);
  return (
    <>
      <div className="grid shrink-0 grid-cols-6 gap-5" style={{ height: 176 }}>
        <Kpi titulo={`Acidentes em ${ano}`} valor={n(a.ano.total)} sub={v == null ? `mesmo período de ${ano - 1}: ${n(a.ano_anterior)}` : `${v >= 0 ? "+" : ""}${v}% contra ${ano - 1} (mesmo período)`} tom={tomContagem(a.ano.total, 10)} />
        <Kpi titulo="Típicos" valor={n(a.ano.tipicos)} sub="no trabalho" />
        <Kpi titulo="De trajeto" valor={n(a.ano.trajeto)} sub={a.ano.nao_informado ? `${n(a.ano.nao_informado)} sem tipo informado` : "casa ↔ trabalho"} />
        <Kpi titulo="Com afastamento" valor={n(a.ano.com_afastamento)} sub={`${n(a.ano.dias_afastamento)} dias afastados · ${n(a.ano.com_cat)} com CAT`} />
        <Kpi titulo="Acidentes no mês" valor={n(a.mes)} tom={tomContagem(a.mes)} />
        <Kpi titulo="Dias sem acidente" valor={a.dias_sem_acidente == null ? "—" : n(a.dias_sem_acidente)} sub="desde o último registrado"
          tom={a.dias_sem_acidente == null ? "neutro" : a.dias_sem_acidente >= 30 ? "bom" : a.dias_sem_acidente >= 7 ? "atencao" : "critico"} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-6">
        <Painel icone={<Activity style={{ width: 28, height: 28 }} />} titulo="Indicador mensal e acumulado do ano" sub="barras: acidentes no mês por tipo · linha: acumulado">
          <GraficoMensal empilhado dados={serieAcidentes(a.mensal)} series={[
            { chave: "tipicos", nome: "Típico", cor: "#dc2626" }, { chave: "trajeto", nome: "Trajeto", cor: "#f59e0b" },
            { chave: "nao_informado", nome: "Sem tipo", cor: "#94a3b8" }]}
            linha={{ chave: "acumulado", nome: "Acumulado", cor: "#1e3a8a" }} />
        </Painel>
        <Painel icone={<Siren style={{ width: 28, height: 28 }} />} titulo="No ano, por tipo">
          <Anel centro={n(a.ano.total)} sub="acidentes" fatias={[
            { nome: "Típico", n: a.ano.tipicos, cor: "#dc2626" }, { nome: "Trajeto", n: a.ano.trajeto, cor: "#f59e0b" },
            { nome: "Sem tipo", n: a.ano.nao_informado, cor: "#94a3b8" }]} />
        </Painel>
      </div>
      <AgirRodape itens={agir} />
    </>
  );
}

function AgirRodape({ itens }: { itens: { texto: string; valor: number }[] }) {
  return (
    <div className="shrink-0" style={{ height: 128 }}>
      <div className="flex h-full items-center gap-5 rounded-[26px] bg-white px-8" style={{ boxShadow: sombra }}>
        <span className="flex shrink-0 items-center gap-3 font-extrabold" style={{ fontSize: 24, color: itens.length ? "#dc2626" : "#16a34a" }}>
          {itens.length ? <AlertTriangle style={{ width: 32, height: 32 }} /> : <CheckCircle2 style={{ width: 32, height: 32 }} />} Onde agir
        </span>
        <div className="grid min-w-0 flex-1 gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(itens.length, 1)}, minmax(0, 1fr))` }}>
          {itens.length ? itens.slice(0, 4).map((a, i) => (
            <div key={a.texto} className="flex min-w-0 items-center justify-between gap-3 rounded-2xl px-5 py-3" style={{ background: "#fef2f2", animation: `sst-entra 500ms ease-out ${i * 100}ms backwards` }}>
              <p className="truncate font-bold" style={{ fontSize: 20 }}>{a.texto}</p>
              <p className="font-black tabular-nums" style={{ fontSize: 32, color: "#dc2626" }}>{n(a.valor)}</p>
            </div>
          )) : <p className="font-bold" style={{ fontSize: 24, color: "#16a34a" }}>Nada pendente neste bloco.</p>}
        </div>
      </div>
    </div>
  );
}

/** Página mostrada por último (segue dela quando a playlist volta, enquanto a TV não recarrega). */
let ultimaPagina = -1;

export function TelaSstPainel({ d, atualizado }: { d: DadosSstPainelTv; atualizado: string | null }) {
  const [pagina, setPagina] = useState(() => (ultimaPagina + 1) % PAGINAS_SST.length);
  useEffect(() => { ultimaPagina = pagina; }, [pagina]);
  useEffect(() => {
    const id = window.setTimeout(() => setPagina((p) => (p + 1) % PAGINAS_SST.length), SEGUNDOS_POR_PAGINA_SST * 1000);
    return () => window.clearTimeout(id);
  }, [pagina]);
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const id = window.setTimeout(() => setAgora(new Date()), 15_000); return () => window.clearTimeout(id); }, [agora]);

  const atual = PAGINAS_SST[pagina];
  const agir = alertas(d)[atual.chave];
  const corpo = atual.chave === "treinamentos" ? <PaginaTreinamentos d={d} agir={agir} />
    : atual.chave === "asos" ? <PaginaAsos d={d} agir={agir} />
    : atual.chave === "afastamentos" ? <PaginaAfastamentos d={d} agir={agir} />
    : <PaginaAcidentes d={d} agir={agir} />;

  return (
    <div className="flex h-full w-full flex-col gap-6 px-10 pb-6 pt-6" style={{ fontFamily: FONTE, background: "linear-gradient(180deg,#ecfdf5 0%,#f8fafc 100%)" }}>
      <style>{"@keyframes sst-entra { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } } @keyframes sst-cresce { from { transform: scaleX(0) } to { transform: scaleX(1) } } @keyframes sst-progresso { from { width: 0% } to { width: 100% } }"}</style>
      <div className="relative flex shrink-0 items-center gap-6 overflow-hidden rounded-[28px] px-12 text-white" style={{ height: 130, background: "linear-gradient(110deg,#064e3b 0%,#047857 60%,#059669 100%)" }}>
        <div className="pointer-events-none absolute -right-20 -top-24 h-[360px] w-[360px] rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
        <span className="relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-2xl" style={{ background: "rgba(255,255,255,0.16)" }}><HardHat style={{ width: 42, height: 42 }} /></span>
        <div className="relative min-w-0 flex-1">
          <p className="font-bold uppercase tracking-widest opacity-85" style={{ fontSize: 20 }}>TV SST • Saúde e Segurança do Trabalho</p>
          <p className="flex items-center gap-4 font-black leading-tight tracking-tight" style={{ fontSize: 50 }}>{ICONE[atual.chave]} {atual.titulo}</p>
          <div className="mt-1 flex gap-2">
            {PAGINAS_SST.map((p, i) => (
              <span key={p.chave} className="relative h-2 w-24 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.25)" }}>
                {i < pagina && <i className="absolute inset-0 bg-white" />}
                {i === pagina && <i key={pagina} className="absolute inset-y-0 left-0 bg-white" style={{ animation: `sst-progresso ${SEGUNDOS_POR_PAGINA_SST}s linear forwards` }} />}
              </span>
            ))}
          </div>
        </div>
        <div className="relative shrink-0 text-right">
          <p className="font-black leading-none tabular-nums" style={{ fontSize: 76 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
          <p className="mt-1 font-semibold opacity-90" style={{ fontSize: 20 }}>
            {agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).replace(/^./, (c) => c.toUpperCase())}
            {atualizado && <span className="block opacity-80" style={{ fontSize: 16 }}>dados de {atualizado}</span>}
          </p>
        </div>
        <LogoTv />
      </div>
      <div key={pagina} className="flex min-h-0 flex-1 flex-col gap-6" style={{ animation: "sst-entra 600ms ease-out" }}>
        {corpo}
      </div>
    </div>
  );
}
