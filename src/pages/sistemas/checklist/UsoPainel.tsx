import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, EyeOff, Info, MousePointerClick, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUsoPorDia } from "@/hooks/useChecklistModulos";
import { pct, type DadosChecklist, type LinhaModulo } from "@/lib/sistemas/checklistModulos";
import { BarraEfetividade, Tile, fmtData, haQuanto } from "./ui";
import { PessoasModulo } from "./PessoasModulo";
import { UsoPorUsuario } from "./UsoPorUsuario";

// "Uso do ERP" — a medição: acessos por dia, adoção por módulo (pessoas que
// usaram ÷ pessoas com acesso), telas mais usadas, telas que ninguém abre e
// o detalhe por pessoa de um módulo. Desde 02/10/2026 também o histórico
// de cada usuário (UsoPorUsuario: o que cada pessoa mais acessa). Conta a
// partir do dia em que a medição entrou no ar (mig 291) — antes disso não
// existe registro.

const COR = "#2a78d6";
const EIXO = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const TOOLTIP = {
  contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12, color: "hsl(var(--popover-foreground))" },
  cursor: { fill: "hsl(var(--muted))", opacity: 0.55 },
};

export function UsoPainel({ dados, modulos, podeAlterar }: { dados: DadosChecklist; modulos: LinhaModulo[]; podeAlterar: boolean }) {
  const porDia = useUsoPorDia(null, 30);
  const [moduloSel, setModuloSel] = useState<string>("");
  const ativos = modulos.filter((m) => m.modulo.ativo && m.ativas > 0);
  const sel = ativos.find((m) => m.modulo.id === moduloSel) ?? null;

  const adocao = useMemo(() => ativos
    .map((m) => ({ m, taxa: m.comAcesso > 0 ? Math.min(1, m.ativos30d / m.comAcesso) : null }))
    .sort((a, b) => (b.taxa ?? -1) - (a.taxa ?? -1) || b.m.ativos30d - a.m.ativos30d), [ativos]);
  const telas = useMemo(() => ativos.flatMap((m) => m.telas.filter((t) => t.tela.ativo).map((t) => ({ ...t, moduloNome: m.modulo.nome }))), [ativos]);
  const maisUsadas = useMemo(() => [...telas].filter((t) => t.tela.acessos_30d > 0).sort((a, b) => b.tela.acessos_30d - a.tela.acessos_30d).slice(0, 10), [telas]);
  const semUso = useMemo(() => telas.filter((t) => t.tela.com_acesso > 0 && t.tela.ativos_30d === 0).sort((a, b) => b.tela.com_acesso - a.tela.com_acesso), [telas]);
  const telasUsadas = telas.filter((t) => t.tela.ativos_30d > 0).length;
  const serie = (porDia.data ?? []).map((d) => ({ ...d, rotulo: fmtData(d.dia).slice(0, 5) }));

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Cada tela aberta com acesso conta um acesso para a pessoa (a mesma tela reaberta em menos de 10 minutos não conta de novo).
          {dados.uso_desde ? <> A medição começou em <b>{fmtData(dados.uso_desde)}</b>.</> : <> A medição começa a partir de hoje — os números enchem com o uso.</>}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icone={<Users className="h-5 w-5" />} rotulo="Pessoas ativas (30 dias)" valor={String(dados.uso_total_30d?.usuarios ?? 0)} sub={`de ${dados.usuarios.length} usuários ativos no ERP`} />
        <Tile icone={<MousePointerClick className="h-5 w-5" />} rotulo="Acessos (30 dias)" valor={(dados.uso_total_30d?.acessos ?? 0).toLocaleString("pt-BR")} />
        <Tile icone={<Activity className="h-5 w-5" />} rotulo="Telas usadas (30 dias)" valor={String(telasUsadas)} sub={`de ${telas.length} telas ativas`} />
        <Tile icone={<EyeOff className="h-5 w-5" />} rotulo="Com acesso e sem uso" valor={String(semUso.length)} sub="telas que ninguém com acesso abriu" cor="#b45309" />
      </div>

      <Card className="p-4">
        <p className="text-sm font-bold">Pessoas ativas por dia</p>
        <p className="mb-2 text-xs text-muted-foreground">Últimos 30 dias · passe o mouse para ver os acessos do dia</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={serie} margin={{ top: 16, right: 8, bottom: 0, left: -18 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} interval={2} />
            <YAxis tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TOOLTIP} formatter={(v: number, _n, p) => [`${v} pessoa(s) · ${(p?.payload as { acessos: number }).acessos} acesso(s)`, "Ativas"]} />
            <Bar dataKey="usuarios" fill={COR} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <UsoPorUsuario />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="text-sm font-bold">Adoção por módulo</p>
          <p className="mb-3 text-xs text-muted-foreground">Pessoas que usaram em 30 dias ÷ pessoas com acesso a alguma tela do módulo</p>
          <div className="max-h-[360px] space-y-1.5 overflow-auto pr-1">
            {adocao.map(({ m, taxa }) => (
              <button key={m.modulo.id} type="button" onClick={() => setModuloSel(m.modulo.id)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60">
                <span className="truncate text-sm font-medium">{m.modulo.nome}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{m.ativos30d}/{m.comAcesso}</span>
                <BarraEfetividade valor={taxa ?? 0} vazio={taxa == null} largura="w-24" />
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-bold">Telas mais usadas</p>
          <p className="mb-2 text-xs text-muted-foreground">Acessos nos últimos 30 dias</p>
          {maisUsadas.length === 0 ? (
            <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">Ainda sem acessos medidos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={maisUsadas.length * 28 + 16}>
              <BarChart data={maisUsadas.map((t) => ({ nome: t.tela.nome, qtd: t.tela.acessos_30d, modulo: t.moduloNome }))} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap={5}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="nome" width={170} tickLine={false} axisLine={false}
                  tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
                    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="hsl(var(--foreground))">
                      <title>{payload.value}</title>{payload.value.length > 26 ? `${payload.value.slice(0, 25)}…` : payload.value}
                    </text>
                  )} />
                <Tooltip {...TOOLTIP} formatter={(v: number, _n, p) => [`${v} acesso(s)`, (p?.payload as { modulo: string }).modulo]} />
                <Bar dataKey="qtd" fill={COR} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                  <LabelList dataKey="qtd" position="right" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {semUso.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-bold">Telas com acesso e sem uso nos últimos 30 dias</p>
          <p className="mb-3 text-xs text-muted-foreground">Candidatas a treinamento, revisão de acesso ou desativação</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {semUso.slice(0, 30).map((t) => (
              <div key={t.tela.id} className="rounded-lg border border-border px-3 py-2">
                <p className="truncate text-sm font-semibold">{t.tela.nome}</p>
                <p className="truncate text-[11px] text-muted-foreground">{t.moduloNome} · {t.tela.com_acesso} com acesso · último uso: {haQuanto(t.tela.ultimo_uso)}</p>
              </div>
            ))}
          </div>
          {semUso.length > 30 && <p className="mt-2 text-xs text-muted-foreground">+ {semUso.length - 30} telas</p>}
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold">Uso por pessoa em um módulo</p>
            <p className="text-xs text-muted-foreground">Escolha um módulo para ver quem usa, quem nunca abriu e quem foi treinado</p>
          </div>
          <Select value={moduloSel} onValueChange={setModuloSel}>
            <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Escolha o módulo" /></SelectTrigger>
            <SelectContent className="max-h-80">
              {ativos.map((m) => <SelectItem key={m.modulo.id} value={m.modulo.id}>{m.modulo.nome} · {pct(m.comAcesso ? m.ativos30d / m.comAcesso : null)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {sel ? <PessoasModulo moduloId={sel.modulo.id} moduloNome={sel.modulo.nome} podeAlterar={podeAlterar} />
          : <p className="py-8 text-center text-sm text-muted-foreground">Nenhum módulo escolhido.</p>}
      </Card>
    </div>
  );
}
