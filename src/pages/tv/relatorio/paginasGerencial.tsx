import { AlertTriangle, CheckCircle2, CircleDashed, CircleHelp, Eye, MapPin, Target, UserCheck, type LucideIcon } from "lucide-react";
import { misturarCor } from "@/lib/tv/relatorioTv";
import {
  COR_SITUACAO, ROTULO_SITUACAO, detalhesDaPagina, formatarValor, indicadoresDaTv, placar, situacao, textoMeta,
  type IndicadorGerencial, type PainelGerencial, type Situacao,
} from "@/lib/tv/gerencial";
import { Barras, Cartao, Selo, TINTA, TINTA_SUAVE, Vazio } from "./base";

// =====================================================================
// TVs gerenciais por diretoria — as páginas (12/10/2026, mig 20261012000001)
//
// O documento (Parte IV): a TV mostra só o que exige atenção, decisão ou
// ação; cada indicador com resultado, meta, contrato/setor afetado, causa e
// responsável; fora da meta primeiro; detalhe no sistema. Duas páginas:
//   · INDICADORES — a pergunta gerencial da TV, o placar e os cartões (5 a 8)
//     na ordem de gravidade e impacto (src/lib/tv/gerencial.ts);
//   · ONDE AGIR — o "por contrato" dos que estão fora da meta (2 por página).
// Sem nome de pessoa (a TV fica em área comum): os cálculos já não trazem.
// =====================================================================

const ICONE_SITUACAO: Record<Situacao, LucideIcon> = {
  vermelho: AlertTriangle, amarelo: Eye, verde: CheckCircle2, neutro: Target, sem_dado: CircleDashed,
};

export function PaginaGerencialResumo({ p, cor }: { p: PainelGerencial; cor: string }) {
  const itens = indicadoresDaTv(p).slice(0, 8);
  const pl = placar(itens);
  const colunas = itens.length <= 3 ? itens.length || 1 : itens.length <= 6 ? 3 : 4;
  return (
    <div className="flex h-full flex-col gap-5">
      {/* A pergunta que a TV responde + o placar */}
      <div className="flex shrink-0 items-stretch gap-5">
        <div className="flex min-w-0 flex-1 items-center gap-5 rounded-[24px] bg-white px-7 py-4"
          style={{ boxShadow: "0 10px 15px -3px rgba(0,0,0,0.08)", borderLeft: `10px solid ${cor}` }}>
          <CircleHelp style={{ width: 44, height: 44, color: cor }} className="shrink-0" strokeWidth={2.4} />
          <p className="min-w-0 font-extrabold leading-snug tracking-tight" style={{ fontSize: 28 }}>
            {p.painel?.pergunta ?? "—"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {(["vermelho", "amarelo", "verde"] as const).map((s) => (
            <div key={s} className="flex h-full w-[150px] flex-col items-center justify-center rounded-[24px] bg-white"
              style={{ boxShadow: "0 10px 15px -3px rgba(0,0,0,0.08)", borderTop: `8px solid ${COR_SITUACAO[s]}` }}>
              <p className="font-black leading-none tabular-nums" style={{ fontSize: 56, color: COR_SITUACAO[s] }}>{pl[s]}</p>
              <p className="mt-1 font-bold uppercase tracking-wide" style={{ fontSize: 16, color: TINTA_SUAVE }}>{ROTULO_SITUACAO[s]}</p>
            </div>
          ))}
        </div>
      </div>

      {itens.length === 0 ? <Vazio texto="Nenhum indicador ativo nesta TV." /> : (
        <div className="grid min-h-0 flex-1 gap-5" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}>
          {itens.map((i) => <CartaoIndicador key={i.codigo} i={i} />)}
        </div>
      )}
    </div>
  );
}

function CartaoIndicador({ i }: { i: IndicadorGerencial }) {
  const s = situacao(i);
  const cor = COR_SITUACAO[s];
  const Icone = ICONE_SITUACAO[s];
  const r = i.resultado ?? { valor: null };
  const semLancamento = r.valor == null && i.fonte === "manual";
  return (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[26px] bg-white"
      style={{ padding: "22px 24px 18px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.08)",
               background: s === "vermelho" ? misturarCor(cor, "#ffffff", 0.95) : "#fff" }}>
      <span className="absolute inset-x-0 top-0 h-2.5" style={{ background: cor }} />
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 font-extrabold leading-tight tracking-tight" style={{ fontSize: 23, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {i.nome}
        </p>
        <Selo cor={cor} claro tamanho={15}><Icone style={{ width: 16, height: 16 }} strokeWidth={2.6} />{ROTULO_SITUACAO[s]}</Selo>
      </div>

      <div className="mt-2 flex items-baseline gap-3">
        <p className="truncate font-black leading-none tabular-nums" style={{ fontSize: semLancamento ? 34 : i.unidade === "brl" ? 54 : 64, color: semLancamento ? TINTA_SUAVE : cor }}>
          {semLancamento ? "Aguardando lançamento" : r.erro ? "Indisponível" : formatarValor(r.valor, i.unidade)}
        </p>
      </div>
      <p className="mt-1 font-bold" style={{ fontSize: 17, color: TINTA_SUAVE }}>{textoMeta(i)}</p>

      <div className="mt-auto flex min-h-0 flex-col gap-1.5 pt-3">
        <Linha Icone={MapPin} rotulo="Onde" texto={r.afetado} />
        <Linha Icone={AlertTriangle} rotulo="Causa" texto={r.causa} />
        <Linha Icone={UserCheck} rotulo="Resp." texto={i.responsavel} forte />
      </div>
    </div>
  );
}

function Linha({ Icone, rotulo, texto, forte = false }: { Icone: LucideIcon; rotulo: string; texto: string | null | undefined; forte?: boolean }) {
  if (!texto) return null;
  return (
    <div className="flex min-w-0 items-start gap-2" style={{ fontSize: 17, lineHeight: 1.25 }}>
      <Icone className="mt-0.5 shrink-0" style={{ width: 17, height: 17, color: TINTA_SUAVE }} />
      <span className="shrink-0 font-bold uppercase tracking-wide" style={{ color: TINTA_SUAVE, fontSize: 14, marginTop: 2 }}>{rotulo}</span>
      <span className={`min-w-0 ${forte ? "font-extrabold" : "font-semibold"}`} style={{ color: TINTA, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {texto}
      </span>
    </div>
  );
}

/** "Onde agir": o detalhamento (por contrato/cidade/faixa) dos que estão fora da meta. */
export function PaginaGerencialDetalhe({ p, chave }: { p: PainelGerencial; chave: string }) {
  const itens = detalhesDaPagina(p, chave);
  if (!itens.length) return <Vazio texto="Nenhum indicador fora da meta com detalhamento." />;
  return (
    <div className="grid h-full gap-6" style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}>
      {itens.map((i) => {
        const s = situacao(i);
        const cor = COR_SITUACAO[s];
        const linhas = (i.resultado?.detalhe ?? []).slice(0, 8);
        return (
          <Cartao key={i.codigo} titulo={i.nome} selo={formatarValor(i.resultado?.valor, i.unidade)} cor={cor} corpoClassName="flex flex-col">
            <div className="min-h-0 flex-1">
              <Barras cor={cor} itens={linhas.map((l) => ({
                nome: l.nome, valor: Math.abs(Number(l.valor) || 0),
                rotulo: l.rotulo ?? formatarValor(l.valor, i.unidade),
              }))} />
            </div>
            <div className="mt-4 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3" style={{ fontSize: 19 }}>
              {i.resultado?.causa && <p className="min-w-0 truncate font-semibold"><span className="font-bold uppercase" style={{ color: TINTA_SUAVE, fontSize: 15 }}>Causa </span>{i.resultado.causa}</p>}
              {i.responsavel && <p className="shrink-0 font-extrabold"><span className="font-bold uppercase" style={{ color: TINTA_SUAVE, fontSize: 15 }}>Responsável </span>{i.responsavel}</p>}
            </div>
          </Cartao>
        );
      })}
    </div>
  );
}
