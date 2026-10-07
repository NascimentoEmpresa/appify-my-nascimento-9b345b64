import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Info, Loader2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLoginsPainel } from "@/hooks/useLoginsSistemas";
import {
  PERIODOS, diasDesde, media, pct, rotuloDiaSemana, rotuloTela, setoresPorAcesso, type PainelLogins, type UsuarioPainel,
} from "@/lib/sistemas/loginsPainel";

// =====================================================================
// SISTEMAS › LOGINS › PAINEL DE USO (07/10/2026, mig 20261007000008)
//
// "Quais setores têm mais logins, quais setores mais acessam etc." Uma
// série por gráfico na cor principal; o único com duas séries (logins por
// setor: usaram × não usaram no período) tem legenda e a segunda em cinza.
// Acesso = abertura do ERP (sessoes_ativas) — o aviso no topo diz isso.
// Contas em src/lib/sistemas/loginsPainel.ts (com teste).
// =====================================================================

const COR = "hsl(var(--primary))";
const COR_APAGADA = "hsl(var(--muted-foreground) / 0.35)";
const fmt = (n: number) => n.toLocaleString("pt-BR");
const fmtData = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR") : "—");
const diaCurto = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };

export function LoginsPainel() {
  const [dias, setDias] = useState<number | null>(30);
  const q = useLoginsPainel(dias);
  const p = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <span><b className="text-foreground">Acesso</b> = cada vez que alguém abre o ERP (por aba/navegador). Setor = Administração › Setores; quem tem dois setores conta nos dois.</span>
        </div>
        <Select value={dias == null ? "tudo" : String(dias)} onValueChange={(v) => setDias(v === "tudo" ? null : Number(v))}>
          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIODOS.map((o) => <SelectItem key={String(o.valor)} value={o.valor == null ? "tudo" : String(o.valor)}>{o.rotulo}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o painel…</Card>
      ) : q.error || !p ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : (
        <div className={`space-y-4 ${q.isFetching ? "opacity-70 transition-opacity" : ""}`}><Conteudo p={p} /></div>
      )}
    </div>
  );
}

function Conteudo({ p }: { p: PainelLogins }) {
  const setoresLogins = useMemo(() => p.por_setor.map((s) => ({ ...s, semUso: s.logins - s.ativos })), [p]);
  const setoresAcesso = useMemo(() => setoresPorAcesso(p.por_setor), [p]);
  const diasNoPeriodo = p.por_dia.length || 1;
  const semana = p.por_semana.map((d) => ({ ...d, rotulo: rotuloDiaSemana(d.dow) }));
  const horas = p.por_hora.filter((h) => h.hora >= 5 && h.hora <= 23).map((h) => ({ ...h, rotulo: `${h.hora}h` }));
  const totalDisp = p.dispositivos.reduce((s, d) => s + d.acessos, 0);
  const altSetores = Math.max(220, p.por_setor.length * 30 + 40);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Numero titulo="Logins no ERP" valor={fmt(p.total_logins)} dica={`${fmt(p.bloqueados)} bloqueados pela situação na Senior`} />
        <Numero titulo="Usaram no período" valor={`${pct(p.ativos, p.total_logins).toLocaleString("pt-BR")}%`} dica={`${fmt(p.ativos)} de ${fmt(p.total_logins)} logins`} />
        <Numero titulo="Acessos no período" valor={fmt(p.acessos)} dica={`média de ${media(p.acessos, diasNoPeriodo).toLocaleString("pt-BR")} por dia com uso`} />
        <Numero titulo="Média por quem usou" valor={media(p.acessos, p.ativos).toLocaleString("pt-BR")} dica="acessos por usuário ativo" />
        <Numero titulo="Sem acesso há 30+ dias" valor={fmt(p.sem_acesso_30d)} dica={`${fmt(p.nunca_acessaram)} nunca entraram (sem contar bloqueados)`} alerta={p.sem_acesso_30d > 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="text-sm font-semibold">Logins por setor</p>
          <p className="text-xs text-muted-foreground">Quantos logins cada setor tem — e quantos usaram o ERP no período</p>
          <ResponsiveContainer width="100%" height={altSetores}>
            <BarChart data={setoresLogins} layout="vertical" margin={{ top: 8, right: 36, left: 8, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="setor" width={130} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number, n: string) => [fmt(v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="ativos" name="Usaram no período" stackId="s" fill={COR} stroke="hsl(var(--card))" strokeWidth={1} />
              <Bar dataKey="semUso" name="Não usaram" stackId="s" fill={COR_APAGADA} stroke="hsl(var(--card))" strokeWidth={1} radius={[0, 4, 4, 0]}>
                <LabelList dataKey="logins" position="right" fontSize={11} fill="hsl(var(--foreground))" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-semibold">Setores que mais acessam</p>
          <p className="text-xs text-muted-foreground">Acessos no período · passe o mouse para ver a média por login do setor</p>
          <ResponsiveContainer width="100%" height={altSetores}>
            <BarChart data={setoresAcesso} layout="vertical" margin={{ top: 8, right: 44, left: 8, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="setor" width={130} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number, _n, item) => [`${fmt(v)} acessos · ${item.payload.porLogin.toLocaleString("pt-BR")} por login (${item.payload.logins} logins)`, ""]} />
              <Bar dataKey="acessos" fill={COR} radius={[0, 4, 4, 0]}>
                <LabelList dataKey="acessos" position="right" fontSize={11} fill="hsl(var(--foreground))" formatter={(v: number) => fmt(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-sm font-semibold">Acessos por dia</p>
        <p className="text-xs text-muted-foreground">Passe o mouse para ver quantas pessoas entraram no dia</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={p.por_dia} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dia" tick={{ fontSize: 10 }} tickFormatter={diaCurto} minTickGap={12} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip labelFormatter={(l) => fmtData(String(l))} formatter={(v: number, _n, item) => [`${fmt(v)} acessos · ${item.payload.usuarios} pessoas`, ""]} />
            <Bar dataKey="acessos" fill={COR} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <p className="text-sm font-semibold">Horário dos acessos</p>
          <p className="text-xs text-muted-foreground">Hora de Brasília em que o ERP foi aberto (5h às 23h)</p>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={horas} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [`${fmt(v)} acessos`, ""]} />
              <Bar dataKey="acessos" fill={COR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-semibold">Dia da semana</p>
          <p className="text-xs text-muted-foreground">Acessos no período</p>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={semana} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} interval={0} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [`${fmt(v)} acessos`, ""]} />
              <Bar dataKey="acessos" fill={COR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm font-semibold">Computador × celular</p>
          <p className="mb-3 text-xs text-muted-foreground">Pelo navegador de cada acesso</p>
          <div className="space-y-2">
            {p.dispositivos.map((d) => (
              <div key={d.dispositivo} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">{d.dispositivo}</span>
                  <span className="font-semibold tabular-nums">{pct(d.acessos, totalDisp).toLocaleString("pt-BR")}% <span className="font-normal text-muted-foreground">({fmt(d.acessos)})</span></span>
                </div>
                <div className="h-2 rounded-sm bg-muted"><div className="h-full rounded-sm" style={{ width: `${pct(d.acessos, totalDisp)}%`, background: COR }} /></div>
              </div>
            ))}
            {p.dispositivos.length === 0 && <p className="text-xs text-muted-foreground">Sem acessos no período.</p>}
          </div>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <p className="text-sm font-semibold">Telas que mais negaram acesso</p>
          <p className="mb-3 text-xs text-muted-foreground">Alguém tentou abrir e não tinha liberação — pode ser permissão faltando ou link solto no menu</p>
          {p.telas_negadas.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma tentativa negada no período.</p> : (
            <div className="space-y-1.5">
              {p.telas_negadas.map((t) => {
                const max = p.telas_negadas[0].tentativas || 1;
                return (
                  <div key={t.tela} className="text-[11px]" title={t.tela}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-muted-foreground">{rotuloTela(t.tela)}</span>
                      <span className="shrink-0 tabular-nums"><b>{fmt(t.tentativas)}</b> <span className="text-muted-foreground">tentativas · {t.usuarios} pessoas</span></span>
                    </div>
                    <div className="h-1.5 rounded-sm bg-muted"><div className="h-full rounded-sm" style={{ width: `${(t.tentativas / max) * 100}%`, background: COR }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TabelaUsuarios titulo="Quem mais acessa" subtitulo="Os 15 que mais abriram o ERP no período" lista={p.top_usuarios} modo="top" />
        <TabelaUsuarios titulo="Sem acesso há 30 dias ou mais" subtitulo="Logins liberados que não entram — candidatos a revisar (bloqueados ficam de fora)" lista={p.sem_acesso} modo="parados" />
      </div>
    </>
  );
}

function Numero({ titulo, valor, dica, alerta }: { titulo: string; valor: string; dica: string; alerta?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${alerta ? "text-warning" : ""}`}>{valor}</p>
      <p className="text-[11px] text-muted-foreground">{dica}</p>
    </Card>
  );
}

function TabelaUsuarios({ titulo, subtitulo, lista, modo }: { titulo: string; subtitulo: string; lista: UsuarioPainel[]; modo: "top" | "parados" }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 pt-4">
        <p className="text-sm font-semibold">{titulo} {modo === "parados" && lista.length > 0 && <Badge variant="outline" className="ml-1 text-[10px]">{lista.length}</Badge>}</p>
        <p className="text-xs text-muted-foreground">{subtitulo}</p>
      </div>
      <div className="mt-3 max-h-[380px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 text-left text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-4 py-2 font-medium">Usuário</th>
              <th className="px-2 py-2 font-medium">Setor</th>
              {modo === "top" ? <><th className="px-2 py-2 text-right font-medium">Acessos</th><th className="px-4 py-2 text-right font-medium">Dias com uso</th></>
                : <th className="px-4 py-2 text-right font-medium">Último acesso</th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((u) => {
              const d = diasDesde(u.ultimo);
              return (
                <tr key={u.email} className="border-t">
                  <td className="px-4 py-1.5"><p className="font-medium">{u.nome}</p><p className="text-[10px] text-muted-foreground">{u.email}</p></td>
                  <td className="px-2 py-1.5 text-muted-foreground">{u.setores ?? "—"}</td>
                  {modo === "top" ? (
                    <><td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(u.acessos ?? 0)}</td><td className="px-4 py-1.5 text-right tabular-nums">{u.dias_ativos ?? 0}</td></>
                  ) : (
                    <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums">{u.ultimo ? <>{fmtData(u.ultimo)} <span className="text-muted-foreground">({d} dias)</span></> : <span className="text-warning">nunca entrou</span>}</td>
                  )}
                </tr>
              );
            })}
            {lista.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">{modo === "top" ? "Ninguém acessou no período." : "Todo mundo com login liberado entrou nos últimos 30 dias. 👍"}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
