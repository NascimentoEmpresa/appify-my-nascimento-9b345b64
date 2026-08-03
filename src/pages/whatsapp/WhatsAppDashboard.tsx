import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { ShieldAlert, Users, MessageSquare, Bot, UserCheck, CheckCircle2, Clock, AlertTriangle, FolderTree } from "lucide-react";
import { fmtMinutos } from "./types";

interface Metricas {
  pessoas: number; conversas: number; concluidas: number;
  recebidas: number; enviadas_bot: number; enviadas_humano: number; falhas: number;
  tempo_medio_min: number | null; primeira_resposta_min: number | null; atendidas_por_humano: number;
  por_pasta: Array<{ codigo: string; nome: string; conversas: number; concluidas: number; tempo_medio_min: number | null }>;
  por_dia: Array<{ dia: string; recebidas: number; enviadas: number }>;
  por_hora: Array<{ hora: number; mensagens: number }>;
}

const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function Indicador({ icone: Icone, rotulo, valor, detalhe, tom = "primary" }: {
  icone: any; rotulo: string; valor: string | number; detalhe?: string; tom?: string;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-${tom}/10`}>
        <Icone className={`h-5 w-5 text-${tom}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-none">{valor}</p>
        <p className="truncate text-xs font-medium text-muted-foreground">{rotulo}</p>
        {detalhe && <p className="truncate text-[11px] text-muted-foreground">{detalhe}</p>}
      </div>
    </Card>
  );
}

export default function WhatsAppDashboard() {
  const { data: access } = useAccessibleMenus("visualizar");
  const podeVer = (access?.codes.has("whatsapp_dashboard") ?? false) || (access?.codes.has("whatsapp") ?? false);

  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(hoje());

  const { data: m, isLoading } = useQuery({
    queryKey: ["wa-dashboard", de, ate],
    enabled: podeVer,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wa_dashboard_metricas", { _de: de, _ate: ate });
      if (error) throw error;
      return data as Metricas;
    },
  });

  // Todas as 24 horas, para o gráfico não "pular" as horas sem mensagem e dar
  // a impressão de que o dia tem menos horas do que tem.
  const horas = useMemo(() => {
    const mapa = new Map((m?.por_hora ?? []).map((h) => [h.hora, h.mensagens]));
    return Array.from({ length: 24 }, (_, h) => ({ hora: `${String(h).padStart(2, "0")}h`, mensagens: mapa.get(h) ?? 0 }));
  }, [m]);

  const dias = useMemo(
    () => (m?.por_dia ?? []).map((d) => ({ ...d, dia: d.dia.slice(8, 10) + "/" + d.dia.slice(5, 7) })),
    [m]);

  if (!podeVer) {
    return (
      <div>
        <PageHeader title="WhatsApp — Dashboard" module="Central de Serviços" breadcrumb={["WhatsApp", "Dashboard"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>WhatsApp — Dashboard</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="WhatsApp — Dashboard" module="Central de Serviços" breadcrumb={["WhatsApp", "Dashboard"]} />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <div>
          <Label className="mb-1 block text-xs font-semibold">De</Label>
          <Input type="date" className="h-8 w-40 text-xs" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold">Até</Label>
          <Input type="date" className="h-8 w-40 text-xs" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <p className="ml-auto text-[11px] text-muted-foreground">
          O período filtra pelas mensagens; uma conversa entra na conta se teve mensagem no intervalo.
        </p>
      </Card>

      {isLoading && <Card className="p-6 text-center text-sm text-muted-foreground">Carregando…</Card>}

      {m && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador icone={Users} rotulo="Pessoas que chamaram" valor={m.pessoas} detalhe={`${m.conversas} conversas`} />
            <Indicador icone={MessageSquare} rotulo="Mensagens recebidas" valor={m.recebidas} tom="info" />
            <Indicador icone={Bot} rotulo="Respostas do bot" valor={m.enviadas_bot} tom="success"
              detalhe={`${m.enviadas_humano} de atendentes`} />
            <Indicador icone={UserCheck} rotulo="Chegaram a um atendente" valor={m.atendidas_por_humano} tom="warning"
              detalhe={m.conversas ? `${Math.round((m.atendidas_por_humano / m.conversas) * 100)}% das conversas` : undefined} />
            <Indicador icone={CheckCircle2} rotulo="Atendimentos concluídos" valor={m.concluidas} tom="success"
              detalhe="conversas na pasta Atendimento Concluído" />
            <Indicador icone={Clock} rotulo="Tempo médio de atendimento"
              valor={m.tempo_medio_min != null ? fmtMinutos(m.tempo_medio_min) : "—"}
              detalhe="da 1ª mensagem até a conclusão" />
            <Indicador icone={Clock} rotulo="Espera até um humano" tom="info"
              valor={m.primeira_resposta_min != null ? fmtMinutos(m.primeira_resposta_min) : "—"}
              detalhe="o bot responde na hora" />
            <Indicador icone={AlertTriangle} rotulo="Falhas de envio" valor={m.falhas} tom="destructive"
              detalhe="quase sempre janela de 24h" />
          </div>

          <Card className="mt-4 p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
              <FolderTree className="h-4 w-4 text-primary" /> Atendimentos por pasta (setor)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-2 py-2 text-left font-medium">Pasta</th>
                    <th className="px-2 py-2 text-center font-medium">Conversas</th>
                    <th className="px-2 py-2 text-center font-medium">Concluídas</th>
                    <th className="px-2 py-2 text-right font-medium">Tempo médio</th>
                  </tr>
                </thead>
                <tbody>
                  {m.por_pasta.map((p) => (
                    <tr key={p.codigo} className="border-b border-border/50 last:border-0">
                      <td className="px-2 py-2">{p.nome}</td>
                      <td className="px-2 py-2 text-center">{p.conversas}</td>
                      <td className="px-2 py-2 text-center">{p.concluidas}</td>
                      <td className="px-2 py-2 text-right">{p.tempo_medio_min != null ? fmtMinutos(p.tempo_medio_min) : "—"}</td>
                    </tr>
                  ))}
                  {m.por_pasta.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">Nenhuma conversa no período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <p className="mb-3 text-sm font-bold">Mensagens por dia</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dias}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="dia" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="recebidas" name="Recebidas" fill="hsl(var(--info))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="enviadas" name="Enviadas" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-4">
              <p className="mb-1 text-sm font-bold">Horário em que as pessoas escrevem</p>
              <p className="mb-2 text-[11px] text-muted-foreground">Serve pra dimensionar o plantão de atendimento.</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={horas}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="hora" fontSize={10} interval={1} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="mensagens" name="Recebidas" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
