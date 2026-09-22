import { Link } from "react-router-dom";
import { Bell, ChevronRight, Clock3, GraduationCap, History, Megaphone, UserRound, Wallet } from "lucide-react";
import { useSessaoColaborador } from "./ColaboradorShell";
import {
  ROTULO_BATIDA, fmtData, fmtHora, fmtMinutos, mesAtualISO, useCursosColaborador, usePontoColaborador,
} from "@/hooks/useColaboradorPortal";
import { Chip, Secao, tomStatus } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — Início
// Um resumo do dia: o ponto de hoje (com o próximo botão a bater), os cursos
// em andamento, avisos da plataforma e atalhos para as outras telas.
// =====================================================================

export default function InicioColaborador() {
  const { perfil, primeiroNome } = useSessaoColaborador();
  const ponto = usePontoColaborador(mesAtualISO());
  const cursos = useCursosColaborador();
  const hoje = ponto.data?.hoje;
  const naoLidas = cursos.data?.notificacoes.filter((n) => !n.lida).length ?? 0;
  const emAndamento = (cursos.data?.cursos ?? []).filter((c) => !c.bloqueado && c.pct < 100).slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-hero p-5 text-white shadow-md">
        <p className="text-xs uppercase tracking-wider text-white/60">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="mt-1 font-display text-2xl font-bold">Bom trabalho, {primeiroNome}!</h1>
        <p className="mt-1 text-sm text-white/80">{perfil.cargo ?? "Colaborador"}{perfil.posto ? ` · ${perfil.posto}` : ""}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip tom={tomStatus(perfil.situacao)}>{perfil.situacao ?? "—"}</Chip>
          {perfil.matricula && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold">Matrícula {perfil.matricula}</span>}
        </div>
      </div>

      <Secao
        titulo="Ponto de hoje"
        descricao={hoje ? fmtData(hoje.data) : undefined}
        acao={<Link to="/colaborador/ponto" className="text-xs font-semibold text-primary">Abrir</Link>}
      >
        {ponto.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {hoje && (
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Clock3 className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1">
              {hoje.entrada ? (
                <>
                  <p className="text-sm font-semibold">
                    Entrada {fmtHora(hoje.entrada)}
                    {hoje.saida ? ` · Saída ${fmtHora(hoje.saida)}` : hoje.proximo ? ` · próximo: ${ROTULO_BATIDA[hoje.proximo].toLowerCase()}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmtMinutos(hoje.minutos)} registradas hoje</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold">Você ainda não registrou a entrada</p>
                  <p className="text-xs text-muted-foreground">Toque em Abrir para bater o ponto</p>
                </>
              )}
            </div>
            <Link to="/colaborador/ponto" className="shrink-0 rounded-lg bg-gradient-accent px-3 py-2 text-xs font-semibold text-accent-foreground">
              {hoje.proximo ? ROTULO_BATIDA[hoje.proximo] : "Ver espelho"}
            </Link>
          </div>
        )}
      </Secao>

      <Secao
        titulo="Treinamentos"
        descricao={cursos.data?.aluno ? `${cursos.data.cursos.length} curso(s) disponíveis` : undefined}
        acao={<Link to="/colaborador/treinamentos" className="text-xs font-semibold text-primary">Ver todos</Link>}
      >
        {cursos.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {cursos.data && !cursos.data.aluno && (
          <p className="text-sm text-muted-foreground">Você ainda não tem cadastro na plataforma de treinamentos. Quando o RH te matricular, os cursos aparecem aqui.</p>
        )}
        {cursos.data?.aluno && emAndamento.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum curso em andamento no momento.</p>
        )}
        <ul className="divide-y divide-border">
          {emAndamento.map((c) => (
            <li key={c.id}>
              <Link to={`/colaborador/treinamentos/${c.id}`} className="flex items-center gap-3 py-2.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><GraduationCap className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.nome}</p>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${c.pct}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{c.concluidas} de {c.aulas} aulas · {c.pct}%</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Secao>

      {(cursos.data?.avisos.length ?? 0) > 0 && (
        <Secao titulo="Avisos" acao={naoLidas > 0 ? <Chip tom="info"><Bell className="mr-1 h-3 w-3" />{naoLidas} nova(s)</Chip> : undefined}>
          <ul className="space-y-2">
            {cursos.data!.avisos.slice(0, 3).map((a) => (
              <li key={a.id} className="flex gap-2 rounded-xl bg-muted/50 p-3">
                <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{a.titulo}</p>
                  {a.mensagem && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.mensagem}</p>}
                </div>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Atalho para="/colaborador/salario" icone={Wallet} titulo="Salário" texto="Valor atual e dados de pagamento" />
        <Atalho para="/colaborador/perfil" icone={UserRound} titulo="Meu perfil" texto="Ficha, cargo, escala e senha" />
        <Atalho para="/colaborador/historico" icone={History} titulo="Histórico" texto="Férias, função e ocorrências" />
        <Atalho para="/colaborador/ponto" icone={Clock3} titulo="Espelho do mês" texto={ponto.data ? `${fmtMinutos(ponto.data.total_min)} em ${ponto.data.dias_trabalhados} dia(s)` : "Suas batidas do mês"} />
      </div>
    </div>
  );
}

function Atalho({ para, icone: Icone, titulo, texto }: { para: string; icone: typeof Wallet; titulo: string; texto: string }) {
  return (
    <Link to={para} className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40">
      <Icone className="h-5 w-5 text-primary" />
      <p className="mt-2 text-sm font-semibold">{titulo}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{texto}</p>
    </Link>
  );
}
