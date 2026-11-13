// PÁGINA DO SETOR NA IMPLANTAÇÃO — /app/licitacoes/implantacao/painel/:setor
//
// O setor é o slug do "Resp. ação" das perguntas (ver painelSetores.ts). A
// página reúne as respostas desse setor (+ as comuns a todos) e é onde o
// setor confirma o recebimento. A confirmação guarda a assinatura das
// respostas: se alguém muda uma resposta depois, ela aparece desatualizada
// e o setor confirma de novo.
//
// Layout refeito em 13/11/2026 conforme o protótipo
// implantacao_contratual_apenas_setores.html: barra "Visualizar" com todos os
// setores, quatro cartões (progresso, respondidos, pendentes, status), a
// confirmação logo abaixo, as perguntas em abas por categoria e o modal
// "Ver todas as informações" com busca e filtros.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ClipboardCheck, LayoutGrid, Pencil, RotateCcw, Search, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { MENU_EDITAR_CHECKLIST, ACAO_EDITAR_CHECKLIST, MENU_RESUMO_GERAL, menuDoPainel } from "@/lib/implantacao/permissaoChecklist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUsuariosEmpresa } from "@/hooks/useUsuariosEmpresa";
import {
  useConfirmarSetor, useDesfazerConfirmacaoSetor, usePainelImplantacao,
} from "@/hooks/useImplantacaoPainel";
import {
  CATEGORIAS_SETOR, categoriasDasLinhas, filtrarLinhas, ROTULO_STATUS, setorPorSlug,
  type CategoriaSetor, type FiltroStatusLinha, type LinhaSetor,
} from "@/lib/implantacao/painelSetores";
import { cn } from "@/lib/utils";
import { BarraContrato, Vazio } from "./PainelComponentes";
import { rotaFormulario, rotaPainel, rotaSetor } from "./rotasPainel";

const MENU_CONFIRMAR = "licitacoes-implantacao-confirmar-setor";

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function contar(linhas: readonly LinhaSetor[]) {
  const feitos = linhas.filter((l) => l.respondido).length;
  return { feitos, total: linhas.length };
}

export default function PainelSetor() {
  const { setor: slug = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { contratos, contrato, itens, painel, carregando, erro } = usePainelImplantacao(params.get("contrato"));
  const contratoId = contrato?.id ?? null;
  const setor = setorPorSlug(itens, slug);
  const resumo = painel.setores.find((s) => s.setor === setor) ?? null;
  const confirmar = useConfirmarSetor();
  const desfazer = useDesfazerConfirmacaoSetor();
  const { data: usuarios = [] } = useUsuariosEmpresa();
  const nomeUsuario = useMemo(() => {
    const m = new Map(usuarios.map((u) => [u.id, u.display_name ?? u.email ?? u.id]));
    return (id: string | null) => (id ? m.get(id) ?? "usuário" : "—");
  }, [usuarios]);

  const linhas = useMemo(() => resumo?.linhas ?? [], [resumo]);
  const categorias = useMemo(() => categoriasDasLinhas(linhas), [linhas]);
  const [aba, setAba] = useState<CategoriaSetor | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<FiltroStatusLinha>("todos");
  const [modalAberto, setModalAberto] = useState(false);

  // Trocar de setor volta para a primeira aba e limpa os filtros.
  useEffect(() => { setAba(null); setBusca(""); setStatus("todos"); }, [slug]);
  const abaAtual: CategoriaSetor | null = aba && categorias.includes(aba) ? aba : categorias[0] ?? null;
  const daAba = abaAtual ? linhas.filter((l) => l.categoria === abaAtual) : [];
  const filtradas = abaAtual ? filtrarLinhas(linhas, busca, status, abaAtual) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={setor ? `Implantação contratual — ${setor}` : "Implantação contratual"}
        breadcrumb={["Implantação", "Painel por setor", setor ?? slug]}
        subtitle={contrato ? contrato.nome : "Respostas do checklist de Implantação destinadas a este setor."}
        actions={
          <>
            <AcessoGate menu={MENU_RESUMO_GERAL} acao="visualizar">
              <Button asChild variant="outline" size="sm">
                <Link to={rotaPainel(contratoId)}><ArrowLeft className="mr-1.5 h-4 w-4" /> Resumo geral</Link>
              </Button>
            </AcessoGate>
            {setor && (
              <AcessoGate menu={MENU_EDITAR_CHECKLIST} acao={ACAO_EDITAR_CHECKLIST}>
                <Button asChild size="sm">
                  <Link to={rotaFormulario(contratoId, setor)}><Pencil className="mr-1.5 h-4 w-4" /> Preencher / Atualizar</Link>
                </Button>
              </AcessoGate>
            )}
          </>
        }
      />

      {carregando ? (
        <Vazio titulo="Carregando…" />
      ) : erro ? (
        <Vazio titulo="Erro" mensagem={erro.message} tom="error" />
      ) : !setor || !resumo ? (
        <Vazio titulo="Setor não encontrado" mensagem="Nenhuma pergunta do checklist tem este setor como responsável." />
      ) : !contrato ? (
        <Vazio titulo="Nenhum contrato" />
      ) : (
        <>
          <BarraContrato
            contratos={contratos}
            contrato={contrato}
            onTrocar={(id) => setParams({ contrato: id }, { replace: true })}
          />

          {/* Visualizar: um botão por setor */}
          <nav aria-label="Navegação por setor" className="card-elevated flex flex-wrap items-center gap-2 p-3">
            <span className="mr-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">Visualizar</span>
            {painel.setores.map((s) => (
              // Cada painel tem acesso próprio: só mostra o botão do setor que a pessoa pode abrir.
              <AcessoGate key={s.setor} menu={menuDoPainel(s.slug)} acao="visualizar">
              <button
                type="button"
                onClick={() => navigate(rotaSetor(s.slug, contratoId))}
                className={cn(
                  "rounded-lg border px-3.5 py-2 text-xs font-bold transition-colors",
                  s.setor === setor
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted/30 text-foreground/80 hover:bg-muted",
                )}
              >
                {s.setor}
              </button>
              </AcessoGate>
            ))}
          </nav>

          {/* Os quatro cartões */}
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-[1.7fr_1fr_1fr_1.35fr]">
            <div className="card-elevated p-5">
              <p className="text-sm font-bold text-foreground/80">Progresso de preenchimento</p>
              <p className="my-2 text-3xl font-extrabold tabular-nums">{resumo.pct}%</p>
              <div className="mb-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${resumo.pct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{resumo.respondidos} de {resumo.total} campos respondidos</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-sm font-bold text-foreground/80">Respondidos</p>
              <p className="my-2 text-3xl font-extrabold tabular-nums text-emerald-600">{resumo.respondidos} / {resumo.total}</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-sm font-bold text-foreground/80">Pendentes</p>
              <p className="my-2 text-3xl font-extrabold tabular-nums text-amber-600">{resumo.pendentes}</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-sm font-bold text-foreground/80">Status do setor</p>
              <p className={cn(
                "my-2 text-xl font-extrabold",
                resumo.status === "concluido" ? "text-emerald-600" : resumo.status === "em_andamento" ? "text-amber-600" : "text-muted-foreground",
              )}>
                {ROTULO_STATUS[resumo.status]}
              </p>
              <p className="text-xs text-muted-foreground">
                {resumo.status === "concluido"
                  ? "Recebimento confirmado"
                  : resumo.pendentes ? "Aguardando preenchimento" : "Todos os campos respondidos"}
              </p>
            </div>
          </div>

          {/* Confirmação de recebimento */}
          <div className={cn(
            "card-elevated flex flex-wrap items-center justify-between gap-4 px-5 py-4",
            resumo.status === "concluido" && "border-emerald-300 dark:border-emerald-500/40",
            resumo.confirmacaoDesatualizada && "border-amber-300 dark:border-amber-500/40",
          )}>
            <div className="flex min-w-[220px] flex-1 items-start gap-3">
              <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="text-sm">
                <p className="font-bold">Confirmação de recebimento</p>
                {resumo.status === "concluido" && resumo.confirmacao ? (
                  <p className="text-xs text-muted-foreground">
                    Confirmado por <b className="text-foreground">{nomeUsuario(resumo.confirmacao.confirmado_por)}</b> em {dataHora(resumo.confirmacao.confirmado_em)}.
                  </p>
                ) : resumo.confirmacaoDesatualizada && resumo.confirmacao ? (
                  <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Confirmado em {dataHora(resumo.confirmacao.confirmado_em)}, mas alguma resposta mudou depois. Confira e confirme de novo.
                  </p>
                ) : resumo.prontoParaConfirmar ? (
                  <p className="text-xs text-muted-foreground">Todas as informações do setor foram preenchidas. Confira e confirme o recebimento.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Preencha os {resumo.pendentes} campo{resumo.pendentes === 1 ? "" : "s"} pendente{resumo.pendentes === 1 ? "" : "s"} para habilitar a confirmação do setor.</p>
                )}
              </div>
            </div>
            <AcessoGate menu={MENU_CONFIRMAR} acao="visualizar">
              <div className="flex gap-2">
                {resumo.confirmacao && (
                  <Button
                    size="sm" variant="outline" disabled={desfazer.isPending}
                    onClick={() => desfazer.mutate({ contratoId: contrato.id, setor })}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" /> Desfazer
                  </Button>
                )}
                <Button
                  size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={!resumo.prontoParaConfirmar || confirmar.isPending}
                  onClick={() => confirmar.mutate({ contratoId: contrato.id, setor, assinatura: resumo.assinatura })}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Confirmar recebimento
                </Button>
              </div>
            </AcessoGate>
          </div>

          {/* Informações do setor, por categoria */}
          <section className="card-elevated p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">Informações do setor</h2>
                <p className="text-xs text-muted-foreground">Selecione uma categoria para consultar as perguntas. Todas as informações originais estão disponíveis.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setModalAberto(true)}>
                <LayoutGrid className="mr-1.5 h-4 w-4" /> Ver todas as informações ({resumo.total})
              </Button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
              {categorias.map((c) => {
                const n = contar(linhas.filter((l) => l.categoria === c));
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAba(c)}
                    className={cn(
                      "min-h-[72px] rounded-lg border px-3 py-3 text-left transition-colors",
                      c === abaAtual
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted/30 hover:bg-muted",
                    )}
                  >
                    <strong className="mb-1.5 block text-[13px]">{c}</strong>
                    <small className="opacity-80">{n.feitos}/{n.total} preenchidos</small>
                  </button>
                );
              })}
            </div>

            <Filtros busca={busca} setBusca={setBusca} status={status} setStatus={setStatus} placeholder="Pesquisar pergunta ou resposta nesta categoria…" />
            <TabelaLinhas linhas={filtradas} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Exibindo {filtradas.length} de {daAba.length} registros em {abaAtual}.</span>
              <Button variant="outline" size="sm" onClick={() => setModalAberto(true)}>Ver lista completa →</Button>
            </div>
          </section>

          <ModalTodas
            aberto={modalAberto}
            onFechar={() => setModalAberto(false)}
            setor={setor}
            linhas={linhas}
            categorias={categorias}
          />
        </>
      )}
    </div>
  );
}

function Filtros({
  busca, setBusca, status, setStatus, placeholder, children,
}: {
  busca: string; setBusca: (v: string) => void;
  status: FiltroStatusLinha; setStatus: (v: FiltroStatusLinha) => void;
  placeholder: string; children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[210px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
      </div>
      {children}
      <Select value={status} onValueChange={(v) => setStatus(v as FiltroStatusLinha)}>
        <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos os status</SelectItem>
          <SelectItem value="pendentes">Somente pendentes</SelectItem>
          <SelectItem value="preenchidos">Somente preenchidos</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function TabelaLinhas({ linhas, cabecalhoFixo }: { linhas: LinhaSetor[]; cabecalhoFixo?: boolean }) {
  if (!linhas.length) {
    return <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">Nenhuma informação encontrada com estes filtros.</div>;
  }
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", cabecalhoFixo && "max-h-[60vh] overflow-y-auto")}>
      <table className="w-full min-w-[900px] text-[12.5px]">
        <thead className={cn("bg-muted/60 text-left text-xs text-muted-foreground", cabecalhoFixo && "sticky top-0 z-10")}>
          <tr>
            <th className="w-[36%] px-3 py-3 font-semibold">Pergunta</th>
            <th className="w-[30%] px-3 py-3 font-semibold">Resposta</th>
            <th className="w-[17%] px-3 py-3 font-semibold">Plano de ação</th>
            <th className="w-[7%] px-3 py-3 font-semibold">Onde</th>
            <th className="w-[10%] px-3 py-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map((l) => (
            <tr key={l.row_index} className={cn("align-top", !l.respondido && "bg-amber-50/50 dark:bg-amber-500/5")}>
              <td className="px-3 py-3">
                {l.pergunta}
                {l.comum && <span className="ml-1.5 whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">COMUM</span>}
              </td>
              <td className="px-3 py-3">
                {l.respondido ? l.valor : <span className="font-bold text-amber-600">Não preenchido</span>}
              </td>
              <td className="px-3 py-3 text-muted-foreground">{l.plano_acao ?? "—"}</td>
              <td className="px-3 py-3 text-muted-foreground">{l.onde ?? "—"}</td>
              <td className="px-3 py-3">
                <span className={cn(
                  "inline-block whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold",
                  l.respondido
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
                )}>
                  {l.respondido ? "✓ Preenchido" : "◷ Pendente"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModalTodas({
  aberto, onFechar, setor, linhas, categorias,
}: {
  aberto: boolean; onFechar: () => void; setor: string;
  linhas: LinhaSetor[]; categorias: CategoriaSetor[];
}) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<FiltroStatusLinha>("todos");
  const [categoria, setCategoria] = useState<CategoriaSetor | "todas">("todas");
  useEffect(() => {
    if (aberto) { setBusca(""); setStatus("todos"); setCategoria("todas"); }
  }, [aberto]);
  const filtradas = filtrarLinhas(linhas, busca, status, categoria);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="flex max-h-[93vh] w-[min(1350px,calc(100vw-1rem))] max-w-none flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Todas as informações — {setor}</DialogTitle>
          <DialogDescription>{linhas.length} perguntas do setor, incluindo plano de ação, origem e identificação COMUM.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <Filtros busca={busca} setBusca={setBusca} status={status} setStatus={setStatus} placeholder="Pesquisar perguntas e respostas…">
            <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaSetor | "todas")}>
              <SelectTrigger className="w-[230px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as categorias</SelectItem>
                {CATEGORIAS_SETOR.filter((c) => categorias.includes(c)).map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filtros>
          <TabelaLinhas linhas={filtradas} cabecalhoFixo />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Exibindo {filtradas.length} de {linhas.length} registros de {setor}.</span>
            <Button variant="outline" size="sm" onClick={() => { setBusca(""); setStatus("todos"); setCategoria("todas"); }}>Limpar filtros</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
