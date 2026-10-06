import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ListPlus, RotateCcw, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useCtrlAtualizarRegistros, useCtrlRegistros, useCtrlReunioes, type Registro, type StatusRegistro } from "@/hooks/useReunioesEncarregados";
import { ROTULO_TIPO, TEMAS, type TipoRegistro } from "@/lib/controladoria/reunioes";
import { DialogAcao } from "./PlanoAcao";
import { MENU_REUNIOES, SeloStatus, SeloTipo, dataBR, semCodigo } from "./comum";

// =====================================================================
// Reuniões com Encarregados › Revisar levantamento (mig 20261006000005).
// Cada registro sugerido pela regra nasce "a revisar": aqui se corrige
// tema/tipo, valida ou exclui (um a um ou marcando vários), e se cria a
// ação do plano direto do registro. Quem revisou e quando é carimbado
// pelo banco (trg_ctrl_reuniao_registro_revisao).
// =====================================================================

const POR_PAGINA = 40;
const TODOS = "__todos";

export default function Revisar({ filtroInicial }: { filtroInicial: { reuniao: string | null; tema: string | null; status: string | null } }) {
  const { data: registros = [], isLoading } = useCtrlRegistros();
  const { data: reunioes = [] } = useCtrlReunioes();
  const atualizar = useCtrlAtualizarRegistros();
  const [reuniao, setReuniao] = useState(filtroInicial.reuniao ?? TODOS);
  const [tema, setTema] = useState(filtroInicial.tema ?? TODOS);
  const [tipo, setTipo] = useState(TODOS);
  const [status, setStatus] = useState(filtroInicial.status ?? "pendente");
  const [contrato, setContrato] = useState(TODOS);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [acaoDe, setAcaoDe] = useState<Registro | null>(null);

  // O "ver todos" do dashboard troca o filtro pela URL com a aba já aberta.
  useEffect(() => {
    setReuniao(filtroInicial.reuniao ?? TODOS); setTema(filtroInicial.tema ?? TODOS); setStatus(filtroInicial.status ?? "pendente");
  }, [filtroInicial.reuniao, filtroInicial.tema, filtroInicial.status]);

  const porId = useMemo(() => new Map(reunioes.map((r) => [r.id, r])), [reunioes]);
  const contratos = useMemo(() => [...new Set(registros.map((r) => r.contrato).filter(Boolean) as string[])].sort(), [registros]);
  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return registros
      .filter((r) => (reuniao === TODOS || r.reuniao_id === reuniao) && (tema === TODOS || r.tema === tema) && (tipo === TODOS || r.tipo === tipo)
        && (status === TODOS || r.status === status) && (contrato === TODOS || r.contrato === contrato)
        && (!b || `${r.trecho} ${r.falante ?? ""} ${r.encarregado ?? ""}`.toLowerCase().includes(b)))
      .sort((a, b2) => (porId.get(b2.reuniao_id)?.data_reuniao ?? "").localeCompare(porId.get(a.reuniao_id)?.data_reuniao ?? "") || a.ordem - b2.ordem);
  }, [registros, reuniao, tema, tipo, status, contrato, busca, porId]);
  useEffect(() => { setPagina(0); setMarcados(new Set()); }, [reuniao, tema, tipo, status, contrato, busca]);

  const pagina_ = filtrados.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const total = registros.length, revisados = registros.filter((r) => r.status !== "pendente").length;

  const mudar = async (ids: string[], campos: Partial<Pick<Registro, "tema" | "tipo" | "status">>, msg?: string) => {
    try { await atualizar.mutateAsync({ ids, campos }); if (msg) toast.success(msg); setMarcados(new Set()); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Buscar no trecho ou nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Filtro valor={status} onChange={setStatus} largura="w-36" opcoes={[["pendente", "A revisar"], ["validado", "Validados"], ["excluido", "Excluídos"]]} todos="Todos os status" />
          <Filtro valor={tipo} onChange={setTipo} largura="w-48" opcoes={Object.entries(ROTULO_TIPO)} todos="Todos os tipos" />
          <Filtro valor={tema} onChange={setTema} largura="w-56" opcoes={TEMAS.map((t) => [t, t])} todos="Todos os temas" />
          <Filtro valor={contrato} onChange={setContrato} largura="w-56" opcoes={contratos.map((c) => [c, semCodigo(c)])} todos="Todos os contratos" />
          <Filtro valor={reuniao} onChange={setReuniao} largura="w-56" opcoes={reunioes.map((r) => [r.id, `${dataBR(r.data_reuniao)} · ${r.titulo}`])} todos="Todas as reuniões" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {filtrados.length.toLocaleString("pt-BR")} registro(s) no filtro · revisão geral: <b className="text-foreground">{revisados} / {total}</b>
        </p>
      </Card>

      <AcessoGate menu={MENU_REUNIOES} acao="alterar">
        {marcados.size > 0 && (
          <Card className="flex flex-wrap items-center gap-2 border-primary/40 bg-primary/5 p-2 text-sm">
            <b className="px-2">{marcados.size} marcado(s)</b>
            <Button size="sm" variant="outline" onClick={() => mudar([...marcados], { status: "validado" }, "Registros validados.")}><Check className="mr-1 h-4 w-4" /> Validar</Button>
            <Button size="sm" variant="outline" onClick={() => mudar([...marcados], { status: "excluido" }, "Registros excluídos do levantamento.")}><X className="mr-1 h-4 w-4" /> Excluir</Button>
            <Select onValueChange={(t) => mudar([...marcados], { tema: t }, "Tema trocado.")}>
              <SelectTrigger className="h-8 w-56 bg-background"><SelectValue placeholder="Trocar tema para…" /></SelectTrigger>
              <SelectContent>{TEMAS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setMarcados(new Set())}>Desmarcar</Button>
          </Card>
        )}
      </AcessoGate>

      {isLoading ? <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card> : filtrados.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{total === 0 ? "Nenhuma reunião importada ainda — comece pela aba Importar transcrições." : "Nada neste filtro."}</Card>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Checkbox checked={pagina_.length > 0 && pagina_.every((r) => marcados.has(r.id))}
              onCheckedChange={(v) => setMarcados((s) => { const n = new Set(s); pagina_.forEach((r) => (v ? n.add(r.id) : n.delete(r.id))); return n; })} />
            Marcar a página
          </div>
          {pagina_.map((r) => {
            const reu = porId.get(r.reuniao_id);
            return (
              <Card key={r.id} className={`p-3 ${r.status === "excluido" ? "opacity-60" : ""}`}>
                <div className="flex gap-3">
                  <Checkbox className="mt-1" checked={marcados.has(r.id)} onCheckedChange={(v) => setMarcados((s) => { const n = new Set(s); v ? n.add(r.id) : n.delete(r.id); return n; })} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <SeloStatus status={r.status} /><SeloTipo tipo={r.tipo} />
                      <b>{r.encarregado ?? r.falante ?? "Sem nome"}</b>
                      {r.contrato && <span className="text-muted-foreground">· {semCodigo(r.contrato)}</span>}
                      <span className="ml-auto text-muted-foreground">{dataBR(reu?.data_reuniao)} · {reu?.titulo}</span>
                    </div>
                    <p className="text-sm leading-relaxed">“{r.trecho}”</p>
                    <AcessoGate menu={MENU_REUNIOES} acao="alterar" fallback={<p className="text-xs text-muted-foreground">Tema: {r.tema}</p>}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={r.tema} onValueChange={(t) => mudar([r.id], { tema: t })}>
                          <SelectTrigger className="h-8 w-60 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{[...new Set([r.tema, ...TEMAS])].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={r.tipo} onValueChange={(t) => mudar([r.id], { tipo: t as TipoRegistro })}>
                          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(ROTULO_TIPO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                        <div className="ml-auto flex gap-1.5">
                          {r.status !== "validado" && <Button size="sm" className="h-8" onClick={() => mudar([r.id], { status: "validado" })}><Check className="mr-1 h-3.5 w-3.5" /> Validar</Button>}
                          {r.status !== "excluido" && <Button size="sm" variant="outline" className="h-8" onClick={() => mudar([r.id], { status: "excluido" })}><X className="mr-1 h-3.5 w-3.5" /> Excluir</Button>}
                          {r.status !== "pendente" && <Button size="sm" variant="ghost" className="h-8" onClick={() => mudar([r.id], { status: "pendente" as StatusRegistro })}><RotateCcw className="mr-1 h-3.5 w-3.5" /> A revisar</Button>}
                          <Button size="sm" variant="outline" className="h-8" onClick={() => setAcaoDe(r)}><ListPlus className="mr-1 h-3.5 w-3.5" /> Ação</Button>
                        </div>
                      </div>
                    </AcessoGate>
                  </div>
                </div>
              </Card>
            );
          })}
          {filtrados.length > POR_PAGINA && (
            <div className="flex items-center justify-center gap-2 text-xs">
              <Button size="sm" variant="outline" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
              Página {pagina + 1} de {Math.ceil(filtrados.length / POR_PAGINA)}
              <Button size="sm" variant="outline" disabled={(pagina + 1) * POR_PAGINA >= filtrados.length} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
            </div>
          )}
        </>
      )}
      <DialogAcao aberto={!!acaoDe} registro={acaoDe} onClose={() => setAcaoDe(null)} />
    </div>
  );
}

function Filtro({ valor, onChange, opcoes, todos, largura }: { valor: string; onChange: (v: string) => void; opcoes: [string, string][]; todos: string; largura: string }) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger className={`h-9 ${largura}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{todos}</SelectItem>
        {opcoes.map(([v, r]) => <SelectItem key={v} value={v}>{r}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
