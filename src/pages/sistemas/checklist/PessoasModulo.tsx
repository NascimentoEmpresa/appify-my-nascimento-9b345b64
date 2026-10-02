import { useMemo, useState } from "react";
import { CheckCircle2, GraduationCap, Loader2, Search, Undo2, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useDesmarcarTreinado, useMarcarTreinado, useTreinamentosModulo, useUsoModulo,
} from "@/hooks/useChecklistModulos";
import { Etiqueta, fmtData, haQuanto } from "./ui";

// Uso de um módulo PESSOA A PESSOA (medição) + quem foi treinado nele.
// "Tem acesso" = permissão individual de ver alguma tela do módulo. A
// medição conta tela aberta com acesso (RouteGuard → sis_registrar_uso).

const hojeIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export function PessoasModulo({ moduloId, moduloNome, podeAlterar }: { moduloId: string; moduloNome: string; podeAlterar: boolean }) {
  const [dias, setDias] = useState(30);
  const uso = useUsoModulo(moduloId, dias);
  const trein = useTreinamentosModulo(moduloId);
  const marcar = useMarcarTreinado();
  const desmarcar = useDesmarcarTreinado();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "sem_uso" | "nao_treinados" | "usam">("todos");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState(false);

  const treinoPorPessoa = useMemo(() => new Map((trein.data ?? []).filter((t) => !t.menu_id).map((t) => [t.user_id, t])), [trein.data]);
  const pessoas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (uso.data ?? []).filter((p) =>
      (!q || String(p.nome ?? "").toLowerCase().includes(q))
      && (filtro === "todos"
        || (filtro === "sem_uso" && p.tem_acesso && p.acessos === 0)
        || (filtro === "usam" && p.acessos > 0)
        || (filtro === "nao_treinados" && p.tem_acesso && !treinoPorPessoa.has(p.user_id))));
  }, [uso.data, busca, filtro, treinoPorPessoa]);

  const resumo = useMemo(() => {
    const l = uso.data ?? [];
    const comAcesso = l.filter((p) => p.tem_acesso);
    return {
      comAcesso: comAcesso.length,
      usam: l.filter((p) => p.acessos > 0).length,
      semUso: comAcesso.filter((p) => p.acessos === 0).length,
      treinados: comAcesso.filter((p) => treinoPorPessoa.has(p.user_id)).length,
    };
  }, [uso.data, treinoPorPessoa]);

  const alternar = (id: string) => setSelecionados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Resumo rotulo="Com acesso" valor={resumo.comAcesso} />
        <Resumo rotulo={`Usaram (${dias} dias)`} valor={resumo.usam} detalhe={resumo.comAcesso ? `${Math.round((resumo.usam / resumo.comAcesso) * 100)}% de adoção` : undefined} />
        <Resumo rotulo="Com acesso e sem uso" valor={resumo.semUso} alerta={resumo.semUso > 0} />
        <Resumo rotulo="Treinados" valor={resumo.treinados} detalhe={resumo.comAcesso ? `de ${resumo.comAcesso} com acesso` : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-52 pl-8" placeholder="Buscar pessoa…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
          <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as pessoas</SelectItem>
            <SelectItem value="usam">Que usaram no período</SelectItem>
            <SelectItem value="sem_uso">Com acesso e sem uso</SelectItem>
            <SelectItem value="nao_treinados">Com acesso e não treinadas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
        {podeAlterar && (
          <Button size="sm" className="ml-auto h-9 gap-1.5" disabled={!selecionados.size} onClick={() => setDialogo(true)}>
            <GraduationCap className="h-4 w-4" /> Registrar treinamento{selecionados.size ? ` (${selecionados.size})` : ""}
          </Button>
        )}
      </div>

      {uso.isLoading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Medindo o uso…</p>
      ) : pessoas.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Ninguém neste filtro.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  {podeAlterar && <th className="w-8 px-3 py-2.5" />}
                  <th className="px-3 py-2.5">Pessoa</th>
                  <th className="px-3 py-2.5 text-right">Acessos</th>
                  <th className="px-3 py-2.5 text-right">Dias</th>
                  <th className="px-3 py-2.5">Último acesso</th>
                  <th className="px-3 py-2.5">Telas usadas</th>
                  <th className="px-3 py-2.5">Treinamento</th>
                </tr>
              </thead>
              <tbody>
                {pessoas.map((p) => {
                  const t = treinoPorPessoa.get(p.user_id);
                  return (
                    <tr key={p.user_id} className="border-t border-border">
                      {podeAlterar && (
                        <td className="px-3 py-2">
                          {!t && <Checkbox checked={selecionados.has(p.user_id)} onCheckedChange={() => alternar(p.user_id)} aria-label={`Selecionar ${p.nome}`} />}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <p className="font-semibold text-foreground">{p.nome ?? "—"}</p>
                        {!p.tem_acesso && <p className="text-[11px] text-muted-foreground">sem acesso individual hoje</p>}
                      </td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{p.acessos}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.dias}</td>
                      <td className="px-3 py-2 text-xs">
                        {p.ultimo ? haQuanto(p.ultimo) : p.tem_acesso
                          ? <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400"><UserX className="h-3.5 w-3.5" /> nunca usou</span>
                          : "—"}
                      </td>
                      <td className="max-w-[240px] px-3 py-2 text-xs text-muted-foreground"><span className="line-clamp-2">{p.telas.join(" · ") || "—"}</span></td>
                      <td className="px-3 py-2">
                        {t ? (
                          <div className="flex items-center gap-1.5">
                            <Etiqueta tom="ok"><CheckCircle2 className="h-3 w-3" /> {fmtData(t.treinado_em)}</Etiqueta>
                            {podeAlterar && (
                              <button type="button" title="Desfazer" className="text-muted-foreground hover:text-destructive"
                                onClick={() => { if (confirm(`Remover o treinamento de ${p.nome}?`)) desmarcar.mutate(t.id); }}>
                                <Undo2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ) : podeAlterar ? (
                          <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                            onClick={() => { setSelecionados(new Set([p.user_id])); setDialogo(true); }}>
                            <UserCheck className="h-3.5 w-3.5" /> Marcar treinado
                          </button>
                        ) : <span className="text-xs text-muted-foreground">não treinado</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {dialogo && (
        <DialogoTreinamento moduloNome={moduloNome} qtd={selecionados.size} salvando={marcar.isPending}
          onFechar={() => setDialogo(false)}
          onSalvar={async (data, instrutor, observacao) => {
            await marcar.mutateAsync({ moduloId, userIds: [...selecionados], data, instrutor, observacao });
            setSelecionados(new Set()); setDialogo(false);
          }} />
      )}
    </div>
  );
}

function Resumo({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: number; detalhe?: string; alerta?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3", alerta ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20" : "border-border bg-card")}>
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="text-xl font-extrabold tabular-nums">{valor}</p>
      {detalhe && <p className="text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function DialogoTreinamento({ moduloNome, qtd, salvando, onFechar, onSalvar }: {
  moduloNome: string; qtd: number; salvando: boolean; onFechar: () => void;
  onSalvar: (data: string, instrutor: string, observacao: string) => Promise<void>;
}) {
  const [data, setData] = useState(hojeIso());
  const [instrutor, setInstrutor] = useState("");
  const [obs, setObs] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && !salvando && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-primary" /> Registrar treinamento</DialogTitle>
          <DialogDescription>{qtd === 1 ? "1 pessoa" : `${qtd} pessoas`} treinada{qtd === 1 ? "" : "s"} em {moduloNome}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Data do treinamento</Label><Input type="date" value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Quem treinou</Label><Input value={instrutor} onChange={(e) => setInstrutor(e.target.value)} placeholder="Ex.: Pablo (Sistemas)" /></div>
          <div className="space-y-1.5"><Label>Observação</Label><Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Turma, formato (presencial/online)…" /></div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => onSalvar(data, instrutor, obs)} disabled={!data || salvando}>{salvando ? "Salvando…" : "Registrar"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
