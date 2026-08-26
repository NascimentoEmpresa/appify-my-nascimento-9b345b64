import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  MENU, TABELA, addMeses, contaAvanco, corDoStatus, faltaPara, fmtBRL,
  mesLegivel, mesPadrao, ordemDoStatus, pct, prazoDoMes,
  STATUS_INICIAL, type LinhaConferencia, type StatusPonto,
} from "@/lib/conferenciaPonto/conferencia";
import { cn } from "@/lib/utils";

const sb = supabase as any;

/**
 * Painel da Conferência de Ponto — a tela de acompanhamento (a "TV").
 *
 * Porte do `painel_tv_ponto.html`. O que veio junto:
 *   - as três barras de avanço, acumulativas (ver contaAvanco);
 *   - o contador até o prazo de fechamento;
 *   - os cartões de contrato coloridos por status;
 *   - recarga sozinha a cada 30s, para ficar aberto num telão.
 *
 * O que NÃO veio, e por quê:
 *   - Confete e MP3 na virada de 100%. Era diversão de telão, mas prendia
 *     áudio autoplay e um overlay pedindo clique — em tela que ninguém opera,
 *     isso vira um modal eterno pedindo interação.
 *   - O carrossel automático de slides. A lista rola e cabe; paginar de 12 em
 *     12 escondia contrato de quem estava procurando um específico.
 *   - Tema preto fixo. Aqui a tela respeita o tema do ERP como as outras.
 *
 * Os VALORES só aparecem para quem tem `ponto_informar_valor` ou
 * `ponto_marcar_pago` — no sistema antigo isso era a permissão
 * `ver_valores_painel`, e a regra continua: painel aberto num corredor não
 * pode expor a folha.
 */
export default function ConferenciaPontoPainel() {
  const { can } = usePermissoes();
  const [mes, setMes] = useState(mesPadrao());
  const [linhas, setLinhas] = useState<LinhaConferencia[]>([]);
  const [contratos, setContratos] = useState<any[]>([]);
  const [agora, setAgora] = useState(new Date());

  const pode = useCallback(
    (menu: string) => can("visualizar", undefined, menu) || can("alterar", undefined, menu),
    [can],
  );
  const podeValores = pode(MENU.valor) || pode(MENU.pagar);

  const carregar = useCallback(async () => {
    const [ct, cf] = await Promise.all([
      sb.from("CONTRATOS").select('"Empresa","Filial","NOME EMPRESA","NOME CONTRATO"').eq("ATIVO", "SIM"),
      sb.from(TABELA).select("*").eq("mes_referencia", mes),
    ]);
    setContratos(ct.data ?? []);
    setLinhas(cf.data ?? []);
  }, [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  // Telão fica aberto o dia inteiro: recarrega sozinho e mantém o relógio
  // andando para o contador não congelar.
  useEffect(() => {
    const t = setInterval(carregar, 30_000);
    const r = setInterval(() => setAgora(new Date()), 1000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [carregar]);

  const juntas = useMemo(() => {
    const idx = new Map(linhas.map(l => [`${l.contrato_empresa}__${l.contrato_filial}`, l]));
    return contratos.map(c => {
      const achada = idx.get(`${c.Empresa}__${c.Filial}`);
      return {
        chave: `${c.Empresa}__${c.Filial}`,
        nome: c["NOME CONTRATO"] as string | null,
        empresa: c["NOME EMPRESA"] as string | null,
        filial: c.Filial as number,
        status: (achada?.status ?? STATUS_INICIAL) as StatusPonto,
        valor: achada?.valor_folha ?? null,
      };
    }).sort((a, b) => ordemDoStatus(a.status) - ordemDoStatus(b.status) ||
                      String(a.nome ?? "").localeCompare(String(b.nome ?? "")));
  }, [contratos, linhas]);

  const avanco = useMemo(() => contaAvanco(juntas.map(l => l.status)), [juntas]);
  const totalPago = juntas.filter(l => l.status === "Pago").reduce((s, l) => s + Number(l.valor ?? 0), 0);
  const totalLiberado = juntas.filter(l => l.status === "Liberado Financeiro").reduce((s, l) => s + Number(l.valor ?? 0), 0);

  const prazo = useMemo(() => prazoDoMes(mes), [mes]);
  const falta = faltaPara(prazo, agora);

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Conferência de Ponto</h1>
          <p className="text-sm text-muted-foreground">
            {avanco.total} contratos · {mesLegivel(mes)}
          </p>
        </div>

        {podeValores && (
          <div className="flex flex-wrap gap-3">
            <Pill rotulo="Pago" valor={fmtBRL(totalPago)} cor="text-emerald-600" />
            <Pill rotulo="Liberado" valor={fmtBRL(totalLiberado)} cor="text-indigo-600" />
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Prazo de fechamento</p>
            <p className={cn("text-xl font-bold tabular-nums", falta ? "" : "text-destructive")}>
              {falta ?? "encerrado"}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <button onClick={() => setMes(m => addMeses(m, -1))}
                    className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted">◀ mês</button>
            <button onClick={() => setMes(m => addMeses(m, 1))}
                    className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted">mês ▶</button>
          </div>
          <p className="tabular-nums text-lg font-semibold">{agora.toLocaleTimeString("pt-BR")}</p>
        </div>
      </div>

      {/* Avanço */}
      <div className="grid gap-3 md:grid-cols-3">
        <BarraGrande titulo="Operação" sub="enviados ao RH" feito={avanco.operacional} total={avanco.total} cor="bg-orange-500" />
        <BarraGrande titulo="RH" sub="conferidos" feito={avanco.rh} total={avanco.total} cor="bg-violet-500" />
        <BarraGrande titulo="Financeiro" sub="pagos" feito={avanco.financeiro} total={avanco.total} cor="bg-emerald-500" />
      </div>

      {/* Contratos */}
      {juntas.length === 0 ? (
        <p className="py-20 text-center text-muted-foreground">Nenhum contrato ativo para este mês.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {juntas.map(c => (
            <div key={c.chave} className="rounded-xl border bg-card p-3">
              <p className="truncate font-semibold" title={c.nome ?? ""}>{c.nome || "—"}</p>
              <p className="truncate text-xs text-muted-foreground" title={c.empresa ?? ""}>
                {c.empresa || "—"} · filial {c.filial}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", corDoStatus(c.status))}>
                  {c.status}
                </span>
                {podeValores && c.valor != null && (
                  <span className="tabular-nums text-xs text-muted-foreground">{fmtBRL(c.valor)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div className="rounded-lg border px-3 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={cn("tabular-nums font-bold", cor)}>{valor}</p>
    </div>
  );
}

function BarraGrande({ titulo, sub, feito, total, cor }: {
  titulo: string; sub: string; feito: number; total: number; cor: string;
}) {
  const p = pct(feito, total);
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <span className="font-semibold">{titulo}</span>
          <span className="ml-2 text-xs text-muted-foreground">{sub}</span>
        </div>
        <span className="tabular-nums text-sm font-bold">{p}%</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-700", cor)} style={{ width: `${p}%` }} />
      </div>
      <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{feito} de {total}</p>
    </div>
  );
}
