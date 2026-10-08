import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Dashboard } from "@/pages/treinamentos/plataforma/tipos";
import { semCodigo, semMesesVaziosNoInicio } from "@/lib/tv/relatorioTv";
import { Anel, Barras, Cartao, CartaoKpi, GraficoMensal, TINTA_SUAVE, Vazio } from "./base";

// =====================================================================
// TV — Treinamentos (mig 20261008000007). O Dashboard do módulo
// (/app/treinamentos, Dashboard.tsx) na linguagem dos relatórios da TV: a
// TV recebe o MESMO trn_dashboard (pela trn_dashboard_dados, a base toda,
// como a tela abre sem filtro). Três páginas:
//   · VISÃO GERAL: alunos, quem já entrou, quem nunca entrou, quem entrou
//     agora, certificados + situação dos alunos e a evolução no ano;
//   · ENGAJAMENTO: aulas concluídas, notas, provas, comentários, os
//     primeiros acessos dos últimos 30 dias e as aulas mais concluídas;
//   · CURSOS E CONTRATOS: desempenho por curso e acesso por contrato (é
//     onde o RH cobra).
// Nenhum nome de pessoa (a TV fica em área comum).
// =====================================================================

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
// Paleta do módulo: laranja é "fez" (acessou, concluiu), azul é contexto.
const COR = { ativo: "#f26522", inativo: "#cbd5e1", bloqueado: "#ef4444", azul: "#1d4ed8", estrela: "#f59e0b" };
const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("pt-BR");
const plural = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`;

/** Igual ao normaliza do Dashboard: banco sem a mig 237 devolve outro formato — zeros em vez de tela quebrada. */
function normaliza(d: Partial<Dashboard>): Dashboard {
  return {
    alunos: 0, alunos_ativos: 0, alunos_inativos: 0, alunos_bloqueados: 0, alunos_afastados: 0,
    alunos_demitidos: 0, acessaram_7d: 0, acessaram_30d: 0, primeiros_acessos_periodo: 0,
    aulas_concluidas: 0, avaliacao_media: null, avaliacoes: 0, comentarios: 0, comentarios_pendentes: 0,
    cursos_publicados: 0, cursos_total: 0, certificados: 0, provas_enviadas: 0, provas_aprovadas: 0,
    interacao_real: 0, concluidos: 0, ano: new Date().getFullYear(),
    ...d,
    avaliacoes_por_nota: d.avaliacoes_por_nota ?? [0, 0, 0, 0, 0],
    primeiros_acessos_por_mes: d.primeiros_acessos_por_mes ?? Array(12).fill(0),
    conclusoes_por_mes: d.conclusoes_por_mes ?? Array(12).fill(0),
    primeiros_acessos_30d: d.primeiros_acessos_30d ?? [],
    por_curso: d.por_curso ?? [],
    por_contrato: d.por_contrato ?? [],
    top_aulas: d.top_aulas ?? [],
  };
}
const useDashboard = (p: Dashboard) => useMemo(() => normaliza(p ?? {}), [p]);

export function PaginaTrnGeral({ p, cor }: { p: Dashboard; cor: string }) {
  const d = useDashboard(p);
  const taxa = pct(d.alunos_ativos, d.alunos);
  const evolucao = useMemo(() => {
    const hoje = new Date();
    // No ano corrente, os meses que ainda não chegaram ficam de fora (barras zeradas só espremem).
    const ate = d.ano === hoje.getFullYear() ? hoje.getMonth() + 1 : 12;
    const meses = MESES.slice(0, ate).map((rotulo, i) => ({ rotulo, acessos: d.primeiros_acessos_por_mes[i] ?? 0, conclusoes: d.conclusoes_por_mes[i] ?? 0 }));
    return semMesesVaziosNoInicio(meses, ["acessos", "conclusoes"]);
  }, [d]);
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid shrink-0 grid-cols-5 gap-6" style={{ height: 214 }}>
        <CartaoKpi rotulo="Número de alunos" valor={num(d.alunos)} cor={COR.azul}
          dica={d.alunos_afastados ? `${plural(d.alunos_afastados, "afastado", "afastados")}` : "podem acessar"} />
        <CartaoKpi rotulo="Já acessaram" valor={num(d.alunos_ativos)} cor={cor} selo={{ texto: `${taxa}% da base`, cor }} />
        <CartaoKpi rotulo="Nunca acessaram" valor={num(d.alunos_inativos)} cor="#64748b"
          dica={d.alunos_bloqueados ? `${plural(d.alunos_bloqueados, "bloqueado", "bloqueados")} à parte` : "ainda não entraram"} />
        <CartaoKpi rotulo="Acessaram em 7 dias" valor={num(d.acessaram_7d)} cor="#0284c7" dica={`${num(d.acessaram_30d)} em 30 dias`} />
        <CartaoKpi rotulo="Certificados emitidos" valor={num(d.certificados)} cor="#16a34a"
          dica={`${d.cursos_publicados} de ${d.cursos_total} cursos publicados`} />
      </div>
      <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: "1fr 1.55fr" }}>
        <Cartao titulo="Situação dos alunos" cor={cor} selo={d.alunos_demitidos ? `${num(d.alunos_demitidos)} demitidos fora da conta` : null}>
          {d.alunos ? (
            <Anel centro={`${taxa}%`} sub="já acessaram" fatias={[
              { nome: "Já acessaram", n: d.alunos_ativos, cor: COR.ativo },
              { nome: "Nunca acessaram", n: d.alunos_inativos, cor: COR.inativo },
              ...(d.alunos_bloqueados ? [{ nome: "Bloqueados", n: d.alunos_bloqueados, cor: COR.bloqueado }] : []),
            ]} />
          ) : <Vazio texto="Nenhum aluno na base." />}
        </Cartao>
        <Cartao titulo={`Evolução em ${d.ano}`} cor={cor} selo="mês a mês">
          <GraficoMensal dados={evolucao} series={[{ chave: "acessos", nome: "Primeiros acessos", cor: COR.ativo }]}
            linha={{ chave: "conclusoes", nome: "Aulas concluídas", cor: COR.azul }} />
        </Cartao>
      </div>
    </div>
  );
}

const EIXO = { fill: TINTA_SUAVE, fontSize: 19, fontWeight: 600 } as const;

export function PaginaTrnEngajamento({ p, cor }: { p: Dashboard; cor: string }) {
  const d = useDashboard(p);
  const taxaProva = pct(d.provas_aprovadas, d.provas_enviadas);
  const ultimos30 = d.primeiros_acessos_30d.map((x) => ({ dia: `${x.dia.slice(8, 10)}/${x.dia.slice(5, 7)}`, n: x.n }));
  const total30 = ultimos30.reduce((s, x) => s + x.n, 0);
  const aulas = d.top_aulas.slice(0, 6);
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid shrink-0 grid-cols-4 gap-6" style={{ height: 214 }}>
        <CartaoKpi rotulo="Aulas concluídas" valor={num(d.aulas_concluidas)} cor={cor} dica={`${plural(d.concluidos, "aluno concluiu", "alunos concluíram")}`} />
        <CartaoKpi rotulo="Avaliação das aulas" valor={d.avaliacao_media != null ? `★ ${Number(d.avaliacao_media).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : "—"}
          cor={COR.estrela} dica={plural(d.avaliacoes, "avaliação", "avaliações")} />
        <CartaoKpi rotulo="Provas aprovadas" valor={d.provas_enviadas ? `${taxaProva}%` : "—"} cor={taxaProva >= 70 || !d.provas_enviadas ? "#16a34a" : "#dc2626"}
          dica={`${num(d.provas_aprovadas)} de ${plural(d.provas_enviadas, "enviada", "enviadas")}`} />
        <CartaoKpi rotulo="Comentários nas aulas" valor={num(d.comentarios)} cor="#7c3aed"
          selo={d.comentarios_pendentes ? { texto: `${d.comentarios_pendentes} aguardando moderação`, cor: "#d97706" } : null}
          dica={d.comentarios_pendentes ? null : "nenhum pendente"} />
      </div>
      <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: "1.5fr 0.85fr 1.05fr" }}>
        <Cartao titulo="Primeiros acessos — últimos 30 dias" cor={cor} selo={`${num(total30)} alunos`}>
          {ultimos30.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ultimos30} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="tvTrnAcessos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COR.ativo} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={COR.ativo} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="dia" tick={EIXO} interval={4} axisLine={false} tickLine={false} />
                <YAxis tick={EIXO} allowDecimals={false} axisLine={false} tickLine={false} width={56} />
                <Area dataKey="n" type="monotone" stroke={COR.ativo} strokeWidth={5} fill="url(#tvTrnAcessos)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Vazio texto="Nenhum primeiro acesso nos últimos 30 dias." />}
        </Cartao>
        <Cartao titulo="Notas das aulas" cor={cor}>
          {d.avaliacoes ? (
            <Barras cor={COR.estrela} itens={[5, 4, 3, 2, 1].map((n) => ({
              nome: `${"★".repeat(n)}`, valor: d.avaliacoes_por_nota[n - 1] ?? 0,
              dica: `${pct(d.avaliacoes_por_nota[n - 1] ?? 0, d.avaliacoes)}%`,
            }))} />
          ) : <Vazio texto="Nenhuma avaliação ainda." />}
        </Cartao>
        <Cartao titulo="Aulas mais concluídas" cor={cor}>
          {aulas.length ? (
            <div className="flex h-full flex-col justify-around">
              {aulas.map((a, i) => (
                <div key={`${a.curso}-${a.nome}`} className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-black" style={{ fontSize: 22, background: "#fff1e8", color: COR.ativo }}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold" style={{ fontSize: 22 }}>{a.nome}</p>
                    {/* Curso de uma aula só costuma ter o mesmo nome dela: não repete. */}
                    {a.curso.trim().toLowerCase() !== a.nome.trim().toLowerCase() && (
                      <p className="truncate font-semibold" style={{ fontSize: 17, color: TINTA_SUAVE }}>{a.curso}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-black tabular-nums" style={{ fontSize: 26 }}>{num(a.n)}</span>
                </div>
              ))}
            </div>
          ) : <Vazio texto="Nenhuma aula concluída ainda." />}
        </Cartao>
      </div>
    </div>
  );
}

export function PaginaTrnCursos({ p, cor }: { p: Dashboard; cor: string }) {
  const d = useDashboard(p);
  // Publicados primeiro, depois quem alcança mais gente — rascunho quase não tem o que mostrar.
  const ordenados = [...d.por_curso].sort((a, b) => Number(b.publicado) - Number(a.publicado) || b.alcance - a.alcance);
  const cursos = ordenados.slice(0, 6);
  const contratos = [...d.por_contrato].sort((a, b) => b.alunos - a.alunos).slice(0, 8);
  return (
    <div className="grid h-full gap-6" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
      <Cartao titulo="Desempenho por curso" cor={cor} selo={ordenados.length > cursos.length ? `${cursos.length} de ${ordenados.length} cursos` : `${ordenados.length} cursos`}>
        {cursos.length ? (
          <div className="flex h-full flex-col">
            <div className="grid shrink-0 items-end gap-5 border-b border-zinc-100 pb-2 font-bold uppercase tracking-wide"
              style={{ gridTemplateColumns: "1fr 110px 190px 190px 110px", fontSize: 16, color: TINTA_SUAVE }}>
              <span>Curso</span><span className="text-right">Alcance</span><span>Começaram</span><span>Concluíram</span><span className="text-right">Nota</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col justify-around">
              {cursos.map((c) => (
                <div key={c.id} className="grid items-center gap-5" style={{ gridTemplateColumns: "1fr 110px 190px 190px 110px" }}>
                  <div className="min-w-0">
                    <p className="truncate font-extrabold" style={{ fontSize: 22 }}>{c.nome}</p>
                    <p className="truncate font-semibold" style={{ fontSize: 16, color: TINTA_SUAVE }}>
                      {plural(c.aulas, "aula", "aulas")}{c.publicado ? "" : " · rascunho"}{c.certificados ? ` · ${plural(c.certificados, "certificado", "certificados")}` : ""}
                    </p>
                  </div>
                  <p className="text-right font-black tabular-nums" style={{ fontSize: 26 }}>{num(c.alcance)}</p>
                  <Progresso valor={c.iniciaram} total={c.alcance} cor={COR.azul} />
                  <Progresso valor={c.concluiram} total={c.alcance} cor={COR.ativo} />
                  <p className="text-right font-black tabular-nums" style={{ fontSize: 24, color: c.avaliacoes ? COR.estrela : "#a1a1aa" }}>
                    {c.avaliacoes ? `★ ${Number(c.avaliacao_media ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : <Vazio texto="Nenhum curso cadastrado." />}
      </Cartao>
      <Cartao titulo="Acesso por contrato" cor={cor} selo="já entraram">
        {contratos.length ? (
          <div className="flex h-full flex-col justify-around gap-2">
            {contratos.map((c) => {
              const t = pct(c.ativos, c.alunos);
              return (
                <div key={c.nome} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="min-w-0 truncate font-semibold" style={{ fontSize: 21 }}>{semCodigo(c.nome)}</p>
                    <p className="shrink-0 font-black tabular-nums" style={{ fontSize: 24, color: COR.ativo }}>
                      {t}%<span className="ml-2 font-semibold" style={{ fontSize: 17, color: TINTA_SUAVE }}>{num(c.ativos)} de {num(c.alunos)}</span>
                    </p>
                  </div>
                  <div className="mt-1.5 h-3.5 overflow-hidden rounded-full" style={{ background: "#e8edf3" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(c.ativos ? 2 : 0, t)}%`, background: COR.ativo }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Vazio texto="Sem contratos na base." />}
      </Cartao>
    </div>
  );
}

/** Barra com número e % — a mesma ideia da tabela do Dashboard, no tamanho da TV. */
function Progresso({ valor, total, cor }: { valor: number; total: number; cor: string }) {
  const p = pct(valor, total);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between">
        <b className="tabular-nums" style={{ fontSize: 22 }}>{num(valor)}</b>
        <span className="font-semibold tabular-nums" style={{ fontSize: 17, color: TINTA_SUAVE }}>{p}%</span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full" style={{ background: "#f1f1f3" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, background: cor }} />
      </div>
    </div>
  );
}
