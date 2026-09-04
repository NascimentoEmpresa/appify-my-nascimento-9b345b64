import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CalendarClock,
  Cpu,
  MapPinOff,
  ShieldCheck,
  Wallet,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TiAtivo } from "@/hooks/useTiMapa";
import { STATUS_ATIVO, statusAtivo, tipoAtivo } from "./catalogo";

/**
 * Painel do parque — as perguntas que o gestor de T.I faz sem abrir o mapa:
 * quanto temos, o que está parado, o que sai da garantia e o que ninguém
 * assumiu. Tudo derivado da mesma lista já carregada; nenhuma query extra.
 */

interface Props {
  ativos: TiAtivo[];
  onAbrir: (id: string) => void;
}

const DIAS_ALERTA_GARANTIA = 90;

export function PainelTi({ ativos, onAbrir }: Props) {
  const dados = useMemo(() => {
    const vivos = ativos.filter((a) => a.status !== "descartado");
    const hoje = new Date();
    const limite = new Date(hoje.getTime() + DIAS_ALERTA_GARANTIA * 86400000);

    const porTipo = new Map<string, number>();
    const porStatus = new Map<string, number>();
    const porSetor = new Map<string, number>();
    let valor = 0;

    for (const a of vivos) {
      porTipo.set(a.tipo, (porTipo.get(a.tipo) ?? 0) + 1);
      porStatus.set(a.status, (porStatus.get(a.status) ?? 0) + 1);
      const setor = a.setor?.trim() || "Sem setor";
      porSetor.set(setor, (porSetor.get(setor) ?? 0) + 1);
      valor += Number(a.valor_aquisicao ?? 0);
    }

    const garantiaVencendo = vivos.filter((a) => {
      if (!a.garantia_ate) return false;
      const d = new Date(a.garantia_ate);
      return d >= hoje && d <= limite;
    });
    const garantiaVencida = vivos.filter((a) => a.garantia_ate && new Date(a.garantia_ate) < hoje);
    const emManutencao = vivos.filter((a) => a.status === "manutencao");
    const semResponsavel = vivos.filter((a) => a.status === "em_uso" && !a.responsavel_nome);
    const foraDoMapa = vivos.filter((a) => !a.planta_id || a.pos_x == null);

    return {
      total: vivos.length,
      valor,
      emManutencao,
      semResponsavel,
      foraDoMapa,
      garantiaVencendo,
      garantiaVencida,
      tipos: [...porTipo.entries()]
        .map(([tipo, qtd]) => ({ nome: tipoAtivo(tipo).label, qtd, cor: tipoAtivo(tipo).cor }))
        .sort((a, b) => b.qtd - a.qtd)
        .slice(0, 10),
      status: STATUS_ATIVO.map((s) => ({ nome: s.label, qtd: porStatus.get(s.valor) ?? 0, cor: s.cor })).filter(
        (s) => s.qtd > 0,
      ),
      setores: [...porSetor.entries()]
        .map(([nome, qtd]) => ({ nome, qtd }))
        .sort((a, b) => b.qtd - a.qtd)
        .slice(0, 8),
    };
  }, [ativos]);

  const brl = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Indicador icone={Cpu} tom="primary" label="Equipamentos" valor={String(dados.total)} />
        <Indicador icone={Wallet} tom="success" label="Valor do parque" valor={brl(dados.valor)} />
        <Indicador icone={Wrench} tom="warning" label="Em manutenção" valor={String(dados.emManutencao.length)} />
        <Indicador icone={ShieldCheck} tom="muted" label="Sem responsável" valor={String(dados.semResponsavel.length)} />
        <Indicador icone={MapPinOff} tom="muted" label="Fora do mapa" valor={String(dados.foraDoMapa.length)} />
        <Indicador icone={CalendarClock} tom="danger" label="Garantia vencendo" valor={String(dados.garantiaVencendo.length)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <p className="mb-3 text-sm font-semibold">Equipamentos por tipo</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dados.tipos} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={54} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip
                  cursor={{ fill: "rgba(148,163,184,0.15)" }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v: number) => [`${v} equipamento(s)`, ""]}
                />
                <Bar dataKey="qtd" radius={[6, 6, 0, 0]}>
                  {dados.tipos.map((t) => (
                    <Cell key={t.nome} fill={t.cor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Situação do parque</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dados.status} dataKey="qtd" nameKey="nome" innerRadius={44} outerRadius={72} paddingAngle={2}>
                  {dados.status.map((s) => (
                    <Cell key={s.nome} fill={s.cor} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1">
            {dados.status.map((s) => (
              <li key={s.nome} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.cor }} />
                <span className="flex-1">{s.nome}</span>
                <span className="font-semibold tabular-nums">{s.qtd}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Por setor</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dados.setores} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: "rgba(148,163,184,0.15)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="qtd" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Precisa de atenção
          </p>
          <ListaAtencao
            titulo="Em manutenção"
            itens={dados.emManutencao}
            onAbrir={onAbrir}
            detalhe={(a) => a.responsavel_nome ?? a.setor ?? "—"}
          />
          <ListaAtencao
            titulo={`Garantia vence em até ${DIAS_ALERTA_GARANTIA} dias`}
            itens={dados.garantiaVencendo}
            onAbrir={onAbrir}
            detalhe={(a) => (a.garantia_ate ? new Date(a.garantia_ate).toLocaleDateString("pt-BR") : "—")}
          />
          <ListaAtencao
            titulo="Garantia já vencida"
            itens={dados.garantiaVencida}
            onAbrir={onAbrir}
            detalhe={(a) => (a.garantia_ate ? new Date(a.garantia_ate).toLocaleDateString("pt-BR") : "—")}
          />
          <ListaAtencao
            titulo="Em uso sem responsável"
            itens={dados.semResponsavel}
            onAbrir={onAbrir}
            detalhe={(a) => a.setor ?? "—"}
          />
          {dados.emManutencao.length === 0 &&
            dados.garantiaVencendo.length === 0 &&
            dados.garantiaVencida.length === 0 &&
            dados.semResponsavel.length === 0 && (
              <p className="text-xs text-muted-foreground">Nada pendente. Parque em dia.</p>
            )}
        </Card>
      </div>
    </div>
  );
}

function Indicador({
  icone: Icone,
  label,
  valor,
  tom,
}: {
  icone: typeof Cpu;
  label: string;
  valor: string;
  tom: "primary" | "success" | "warning" | "danger" | "muted";
}) {
  const tons = {
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="flex items-center gap-3 p-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tons[tom]}`}>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-bold leading-tight">{valor}</p>
      </div>
    </Card>
  );
}

function ListaAtencao({
  titulo,
  itens,
  detalhe,
  onAbrir,
}: {
  titulo: string;
  itens: TiAtivo[];
  detalhe: (a: TiAtivo) => string;
  onAbrir: (id: string) => void;
}) {
  if (itens.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo} <Badge variant="secondary" className="ml-1">{itens.length}</Badge>
      </p>
      <ul className="space-y-1">
        {itens.slice(0, 5).map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onAbrir(a.id)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusAtivo(a.status).cor }} />
              <span className="min-w-0 flex-1 truncate font-medium">{a.nome}</span>
              <span className="shrink-0 text-muted-foreground">{detalhe(a)}</span>
            </button>
          </li>
        ))}
        {itens.length > 5 && (
          <li className="px-1.5 text-[11px] text-muted-foreground">+{itens.length - 5} outros</li>
        )}
      </ul>
    </div>
  );
}
