import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CheckCircle2, History, LayoutGrid, Lock, Search, Settings2, SquareStack, Zap } from "lucide-react";
import { ConfigurarAcessoNovoModulo } from "@/components/admin/ConfigurarAcessoNovoModulo";
import { useHistoricoNovosModulos, useNovosModulos, usePessoasParaAcesso } from "@/hooks/useNovosModulos";
import {
  ROTULO_SITUACAO, ROTULO_TIPO, contarNovosModulos, filtrarNovosModulos,
  type FiltroSituacao, type NovoModulo, type SituacaoTela,
} from "@/lib/novosModulos";

// ─── Visão "Novos Módulos" (Módulos & Menus) ──────────────────────────────
//
// SIS-2026-0931 (Iury, 17/11/2026): toda tela criada a partir de 17/11/2026
// nasce BLOQUEADA para todos e só abre quando um administrador libera aqui —
// "inclusive por acesso direto via URL". Quem segura é o banco (mig
// 20261118093100: app_menu.liberado_em + has_screen_access); esta aba é só o
// lugar de decidir. As telas criadas de 08/10 a 17/11/2026 aparecem como
// "Liberado antes do controle", para revisão — nenhuma foi fechada.

const CLASSE_SITUACAO: Readonly<Record<SituacaoTela, string>> = {
  pendente: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  liberado: "border-success/40 bg-success/10 text-success",
  liberado_antes: "border-border bg-muted text-muted-foreground",
};

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

export function NovosModulosPanel({ podeGerenciar }: { podeGerenciar: boolean }) {
  const { lista, disponivel, carregando } = useNovosModulos();
  const contagem = useMemo(() => contarNovosModulos(lista), [lista]);
  const [busca, setBusca] = useState("");
  // Sem escolha do admin: abre em "Pendentes" quando há alguma, senão em "Todas"
  // (no dia do deploy não há pendente, e a lista vazia pareceria defeito).
  const [filtroEscolhido, setFiltroEscolhido] = useState<FiltroSituacao | null>(null);
  const filtro: FiltroSituacao = filtroEscolhido ?? (contagem.pendentes > 0 ? "pendentes" : "todas");
  const linhas = useMemo(() => filtrarNovosModulos(lista, busca, filtro), [lista, busca, filtro]);
  const [aberta, setAberta] = useState<NovoModulo | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  if (!disponivel) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        A aba Novos Módulos ainda não está no banco (migration do SIS-2026-0931 pendente).
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-5 py-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar módulo ou submódulo…" className="h-9 pl-8 text-sm" />
        </div>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={filtro}
          onChange={(e) => setFiltroEscolhido(e.target.value as FiltroSituacao)}
          aria-label="Filtrar por situação"
        >
          <option value="todas">Todas as situações</option>
          <option value="pendentes">Pendentes</option>
          <option value="liberados">Liberados</option>
        </select>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 sm:ml-auto" onClick={() => setHistoricoAberto(true)}>
          <History className="h-3.5 w-3.5" /> Histórico
        </Button>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Indicador rotulo="Telas novas" valor={contagem.total} />
          <Indicador rotulo="Aguardando liberação" valor={contagem.pendentes} className={contagem.pendentes > 0 ? "text-amber-700 dark:text-amber-400" : undefined} />
          <Indicador rotulo="Com acesso liberado" valor={contagem.liberados} className="text-success" />
        </div>

        <div className="flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-semibold text-foreground">Segurança padrão: acesso negado</p>
            <p className="text-muted-foreground">
              Toda tela criada a partir de 17/11/2026 começa <b className="text-foreground">bloqueada para todos</b> — inclusive
              Administrador Geral, quem tem o perfil do módulo e quem digita o endereço direto — até ser liberada aqui. O que o
              desenvolvedor deixou preparado aparece pré-marcado, mas só vale depois de salvo.
            </p>
          </div>
        </div>

        {/* Liberar é permissão própria (administracao_novos_modulos, mig
            20261118093100): quem só vê a Administração consulta, sem botões. */}
        {!podeGerenciar && (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Você pode consultar esta aba. Liberar ou bloquear telas novas exige a permissão
            <b className="text-foreground"> Novos Módulos — liberar ou bloquear telas novas</b>, que só quem já a tem pode conceder.
          </p>
        )}

        {carregando ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="min-w-[260px] text-xs">Módulo / submódulo</TableHead>
                  <TableHead className="text-xs">Criado em</TableHead>
                  <TableHead className="min-w-[150px] text-xs">Acessos</TableHead>
                  <TableHead className="min-w-[150px] text-xs">Situação</TableHead>
                  <TableHead className="text-right text-xs">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      {filtro === "pendentes" && !busca
                        ? "Nenhuma tela aguardando liberação."
                        : "Nenhuma tela encontrada. Altere a busca ou o filtro."}
                    </TableCell>
                  </TableRow>
                )}
                {linhas.map((m) => {
                  const Icone = m.tipo === "acao" ? Zap : m.tipo === "modulo" ? LayoutGrid : SquareStack;
                  const pendente = m.situacao === "pendente";
                  return (
                    <TableRow key={m.codigo}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                            <Icone className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{m.nome}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {m.modulo_nome ?? "—"} · {ROTULO_TIPO[m.tipo]}
                              {!m.ativo && <Badge variant="secondary" className="ml-1.5 px-1 py-0 text-[9px]">desligada</Badge>}
                            </p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground/80">{m.codigo}{m.rota ? ` · ${m.rota}` : ""}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{dataCurta(m.criado_em)}</TableCell>
                      <TableCell>
                        {pendente ? (
                          <>
                            <p className="text-xs font-semibold">0 com acesso</p>
                            <p className="text-[11px] text-muted-foreground">
                              {m.pessoas_com_acesso > 0 ? `${m.pessoas_com_acesso} preparada(s)` : "nada preparado"}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs font-semibold">{m.pessoas_com_acesso} pessoa(s)</p>
                            <p className="text-[11px] text-muted-foreground">{m.pessoas_individuais} individual · {m.perfis} perfil(is)</p>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("gap-1 whitespace-nowrap text-[11px]", CLASSE_SITUACAO[m.situacao])}>
                          {pendente ? <Lock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                          {ROTULO_SITUACAO[m.situacao]}
                        </Badge>
                        {m.situacao === "liberado" && (
                          <p className="mt-1 text-[10px] text-muted-foreground">por {m.liberado_por_nome ?? "—"} em {dataCurta(m.liberado_em)}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant={pendente && podeGerenciar ? "default" : "outline"} className="h-8 gap-1.5 whitespace-nowrap" onClick={() => setAberta(m)}>
                          <Settings2 className="h-3.5 w-3.5" />
                          {!podeGerenciar ? "Ver acesso" : pendente ? "Configurar acesso" : "Editar acesso"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {aberta && (
        <ConfigurarAcessoNovoModulo key={aberta.codigo} tela={aberta} podeGerenciar={podeGerenciar} onFechar={() => setAberta(null)} />
      )}
      {historicoAberto && <HistoricoLiberacoes onFechar={() => setHistoricoAberto(false)} />}
    </div>
  );
}

function Indicador({ rotulo, valor, className }: { rotulo: string; valor: number; className?: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 font-display text-2xl font-bold", className)}>{valor}</p>
    </div>
  );
}

const ROTULO_EVENTO = { liberado: "Tela liberada", acessos_alterados: "Acessos alterados", bloqueado: "Tela bloqueada para todos" } as const;

function HistoricoLiberacoes({ onFechar }: { onFechar: () => void }) {
  const q = useHistoricoNovosModulos(true);
  const { pessoas } = usePessoasParaAcesso();
  const nomePorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p.nome] as const)), [pessoas]);
  const nomes = (ids: string[]) => ids.map((id) => nomePorId.get(id) ?? "—").join(", ");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico de liberações</DialogTitle>
          <DialogDescription>Quem liberou, alterou ou bloqueou cada tela nova, e quando — os 100 registros mais recentes.</DialogDescription>
        </DialogHeader>
        {q.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
        {q.isError && <p className="text-sm text-destructive">Não foi possível ler o histórico: {(q.error as Error)?.message}</p>}
        {q.data?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</p>}
        <div className="divide-y divide-border">
          {(q.data ?? []).map((e) => (
            <div key={e.id} className="space-y-0.5 py-2.5 text-xs">
              <p>
                <b className={cn(e.evento === "bloqueado" && "text-destructive", e.evento === "liberado" && "text-success")}>{ROTULO_EVENTO[e.evento]}</b>
                {" — "}{e.menu_nome ?? e.menu_codigo}
                <span className="text-muted-foreground"> · {e.pessoas_com_acesso} pessoa(s) com acesso depois</span>
              </p>
              <p className="text-muted-foreground">
                {new Date(e.feito_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                {" · por "}{e.feito_por ? nomePorId.get(e.feito_por) ?? "—" : "—"}
                {" · #"}{e.id}
              </p>
              {e.adicionados.length > 0 && <p><span className="text-success">+ {e.adicionados.length}:</span> {nomes(e.adicionados)}</p>}
              {e.removidos.length > 0 && <p><span className="text-destructive">− {e.removidos.length}:</span> {nomes(e.removidos)}</p>}
              {e.perfis_removidos.length > 0 && <p className="text-muted-foreground">Tirada dos perfis: {e.perfis_removidos.map((p) => p.nome).join(", ")}</p>}
              {(e.setores.length > 0 || e.cargos.length > 0) && (
                <p className="text-muted-foreground">
                  Selecionado por {[e.setores.length ? `setor ${e.setores.join(", ")}` : "", e.cargos.length ? `cargo ${e.cargos.join(", ")}` : ""].filter(Boolean).join(" e ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
