import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Loader2, MapPin, MapPinOff } from "lucide-react";
import { toast } from "sonner";
import {
  ROTULO_BATIDA, fmtData, fmtHora, fmtMinutos, mesAtualISO, rotuloMes, useBaterPonto, usePontoColaborador,
  type DiaPonto, type TipoBatida,
} from "@/hooks/useColaboradorPortal";
import { Carregando, Chip, Dado, EmDesenvolvimento, Erro, GradeDados, Secao, Vazio, tomStatus } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — Ponto
//
// Aqui o colaborador REGISTRA o ponto (entrada, saída p/ intervalo, retorno,
// saída) e vê o espelho do mês. A hora é a do servidor (col_bater_ponto usa
// now()), nunca a do celular; o GPS é opcional — se a pessoa negar, a
// batida vai sem localização e o RH vê que foi sem.
//
// A ordem das batidas é cobrada no banco (col_bater_ponto): o botão daqui só
// mostra o próximo passo que a RPC aceitaria. "Saída" direta (sem intervalo)
// é permitida quando não houve saída para intervalo — escala sem pausa.
// =====================================================================

const ORDEM: TipoBatida[] = ["entrada", "saida_intervalo", "retorno_intervalo", "saida"];

// Em desenvolvimento (22/09/2026): a tela abaixo fica pronta, mas desligada —
// o colaborador vê só o aviso e nada chama col_ponto. Pra liberar: true.
export const PONTO_LIBERADO = false;

export default function PontoColaborador() {
  if (!PONTO_LIBERADO) {
    return (
      <EmDesenvolvimento
        icone={<Clock3 className="h-8 w-8" />}
        titulo="Ponto pelo portal"
        texto="Em breve você vai registrar a entrada, o intervalo e a saída por aqui, e acompanhar o espelho do mês. Por enquanto, continue batendo o ponto pela Senior ou no relógio Nexti."
      />
    );
  }
  return <PontoCompleto />;
}

function PontoCompleto() {
  const [mes, setMes] = useState(mesAtualISO());
  const ehMesAtual = mes === mesAtualISO();
  const ponto = usePontoColaborador(mes);
  const hojeQ = usePontoColaborador(mesAtualISO());
  const hoje = hojeQ.data?.hoje;

  const mudarMes = (delta: number) => {
    const [a, m] = mes.split("-").map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="space-y-4">
      <CartaoHoje hoje={hoje} carregando={hojeQ.isLoading} />

      {ponto.data?.escala && (ponto.data.escala.nome || ponto.data.escala.horario) && (
        <Secao titulo="Sua escala">
          <GradeDados>
            <Dado rotulo="Escala" valor={ponto.data.escala.nome} sempre />
            <Dado rotulo="Jornada" valor={ponto.data.escala.horario?.descricao} />
          </GradeDados>
        </Secao>
      )}

      <Secao
        titulo="Espelho do mês"
        acao={
          <div className="flex items-center gap-1">
            <button onClick={() => mudarMes(-1)} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[7.5rem] text-center text-xs font-semibold">{rotuloMes(mes)}</span>
            <button onClick={() => mudarMes(1)} disabled={ehMesAtual} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted disabled:opacity-40" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
          </div>
        }
      >
        {ponto.isLoading && <Carregando />}
        {ponto.isError && <Erro erro={ponto.error} />}
        {ponto.data && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Resumo rotulo="Horas registradas" valor={fmtMinutos(ponto.data.total_min)} />
              <Resumo rotulo="Dias com registro" valor={String(ponto.data.dias_trabalhados)} />
            </div>
            {ponto.data.dias.length === 0 ? (
              <Vazio>Nenhuma batida registrada em {rotuloMes(mes).toLowerCase()}.</Vazio>
            ) : (
              <ul className="divide-y divide-border">
                {ponto.data.dias.map((d) => <LinhaDia key={d.data} dia={d} />)}
              </ul>
            )}
          </>
        )}
      </Secao>

      {ponto.data?.fechamento && (
        <Secao titulo="Fechamento do ponto do contrato" descricao={ponto.data.fechamento.contrato ?? undefined}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Situação em {rotuloMes(mes).toLowerCase()}</p>
            <Chip tom={tomStatus(ponto.data.fechamento.status)}>{ponto.data.fechamento.status}</Chip>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            O fechamento do mês passa pela Operação, pelo RH e pelo Financeiro. "Pago" significa que a folha do contrato foi liquidada.
          </p>
        </Secao>
      )}

      {(ponto.data?.horas_extras.length ?? 0) > 0 && (
        <Secao titulo="Horas extras autorizadas">
          <ul className="divide-y divide-border">
            {ponto.data!.horas_extras.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{fmtData(h.data)} · {h.inicio.slice(0, 5)}–{h.fim.slice(0, 5)}</p>
                  <p className="truncate text-xs text-muted-foreground">{h.justificativa}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{fmtMinutos(h.real_min ?? h.previsto_min)}</p>
                  <Chip tom={tomStatus(h.status)}>{h.status.replace(/_/g, " ")}</Chip>
                </div>
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
}

function CartaoHoje({ hoje, carregando }: { hoje: DiaPonto | undefined; carregando: boolean }) {
  const bater = useBaterPonto();
  const [agora, setAgora] = useState(() => new Date());
  const [usarGps, setUsarGps] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Tempo correndo desde a entrada (descontando o intervalo em andamento).
  const minutosAgora = useMemo(() => {
    if (!hoje?.entrada) return 0;
    if (hoje.saida) return hoje.minutos;
    const fim = hoje.saida_intervalo && !hoje.retorno_intervalo ? new Date(hoje.saida_intervalo) : agora;
    let min = (fim.getTime() - new Date(hoje.entrada).getTime()) / 60000;
    if (hoje.saida_intervalo && hoje.retorno_intervalo) {
      min -= (new Date(hoje.retorno_intervalo).getTime() - new Date(hoje.saida_intervalo).getTime()) / 60000;
    }
    return Math.max(0, Math.floor(min));
  }, [hoje, agora]);

  const registrar = async (tipo: TipoBatida) => {
    let pos: { latitude: number; longitude: number; precisao: number } | null = null;
    if (usarGps && "geolocation" in navigator) {
      pos = await new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, precisao: p.coords.accuracy }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
        ));
    }
    try {
      await bater.mutateAsync({ tipo, ...(pos ?? {}) });
      toast.success(`${ROTULO_BATIDA[tipo]} registrada às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${pos ? "" : " (sem localização)"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar.");
    }
  };

  const proximo = hoje?.proximo ?? null;
  const podeSairDireto = !!hoje?.pode_sair && proximo !== "saida" && proximo !== null;

  return (
    <div className="rounded-2xl bg-gradient-hero p-5 text-white shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-white/60">{agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/60">Hoje</p>
          <p className="font-display text-xl font-bold tabular-nums">{fmtMinutos(minutosAgora)}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-1.5">
        {ORDEM.map((t) => {
          const v = hoje?.[t];
          return (
            <div key={t} className={"rounded-lg px-2 py-2 text-center " + (v ? "bg-white/15" : "bg-white/5")}>
              <p className="text-[10px] leading-tight text-white/60">{ROTULO_BATIDA[t]}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{v ? fmtHora(v) : "--:--"}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {carregando && <p className="text-sm text-white/70">Carregando…</p>}
        {!carregando && proximo && (
          <button
            type="button"
            disabled={bater.isPending}
            onClick={() => registrar(proximo)}
            className="btn-relief flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-accent text-base font-semibold text-accent-foreground disabled:opacity-60"
          >
            {bater.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Clock3 className="h-5 w-5" />}
            Registrar {ROTULO_BATIDA[proximo].toLowerCase()}
          </button>
        )}
        {!carregando && podeSairDireto && proximo === "saida_intervalo" && (
          <button
            type="button"
            disabled={bater.isPending}
            onClick={() => registrar("saida")}
            className="h-10 w-full rounded-xl bg-white/10 text-sm font-semibold ring-1 ring-white/20 disabled:opacity-60"
          >
            Registrar saída (sem intervalo)
          </button>
        )}
        {!carregando && hoje && !proximo && (
          <p className="rounded-xl bg-white/10 px-3 py-2.5 text-center text-sm">Jornada de hoje encerrada. Até amanhã!</p>
        )}
        <button
          type="button"
          onClick={() => setUsarGps((v) => !v)}
          className="inline-flex items-center justify-center gap-1.5 self-center text-[11px] text-white/70"
        >
          {usarGps ? <MapPin className="h-3.5 w-3.5" /> : <MapPinOff className="h-3.5 w-3.5" />}
          {usarGps ? "Enviando localização junto com a batida" : "Batida sem localização"}
        </button>
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-0.5 font-display text-lg font-bold tabular-nums">{valor}</p>
    </div>
  );
}

function LinhaDia({ dia }: { dia: DiaPonto }) {
  const d = new Date(dia.data + "T12:00:00");
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {ORDEM.map((t) => (dia[t] ? fmtHora(dia[t]) : "--:--")).join("  ·  ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">{fmtMinutos(dia.minutos)}</p>
          {dia.incompleto && <Chip tom="alerta">sem saída</Chip>}
        </div>
      </div>
    </li>
  );
}
