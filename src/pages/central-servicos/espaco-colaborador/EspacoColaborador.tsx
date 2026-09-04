import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase, Building2, ChevronRight, FolderOpen, GitBranch, HelpCircle, Loader2,
  MapPin, Search, ShieldCheck, UserCog, UserRound, Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ehEncarregado, ehSupervisor, montarPostos, useArvoreContratos,
  useBuscaColaboradores, useColaboradoresDoContrato, useColaboradoresSemContrato,
  type ArvoreCompleta, type ColaboradorLinha, type NoContrato, type NoPosto,
} from "@/hooks/useEspacoColaborador";

// =====================================================================
// ESPAÇO DO COLABORADOR — a árvore
//
// Abre a operação inteira em dois desenhos da MESMA estrutura:
//
//   • Fluxograma — cartões encadeados, para entender a hierarquia;
//   • Árvore de pastas — recuo e linha-guia, como um explorador de arquivos,
//     para varrer muitos nós rápido.
//
// Os dois renderizadores leem o mesmo modelo de dados e o mesmo estado de
// expansão. Trocar de modo não perde o que já estava aberto — o modo é
// aparência, não navegação, e recolher tudo a cada clique no botão seria
// punir quem só queria olhar de outro jeito.
//
// A ORDEM EM QUE AS COISAS PASSAM A EXISTIR
//
//   Licitação cria o CONTRATO e, junto, os POSTOS dele (planilha_custo) com
//   as informações financeiras e administrativas. Só depois RH e
//   Recrutamento fazem as ADMISSÕES — e é a admissão que cria a matrícula e
//   faz a pessoa aparecer em EMPREGADOS.
//
//   Por isso a árvore mostra posto SEM ninguém dentro como um estado normal,
//   não como erro: é um contrato novo esperando as contratações, e a
//   comparação "vagas × pessoas" é justamente o que interessa a quem
//   acompanha a implantação.
//
// SUPERVISOR E ENCARREGADO
//
//   O fluxo futuro é a Operação preencher, para cada contrato, quem é o
//   supervisor e quais postos cada encarregado cuida. Dessas duas, hoje só
//   existe RH_CONTRATO_ENCARREGADO — encarregado por CONTRATO, não por
//   posto. Então a árvore mostra a designação quando ela existe e, ao lado,
//   quem tem o NÍVEL de supervisor/encarregado no cadastro, marcado como
//   derivado. Nada aqui finge um vínculo que ninguém cadastrou.
// =====================================================================

type Modo = "fluxograma" | "pastas";

const ROTA_FICHA = "/app/central-servicos/espaco-colaborador";

/** Chave de expansão do nó dos órfãos — não é um uuid de contrato. */
const CHAVE_SEM_CONTRATO = "__sem_contrato__";

/** O link da pessoa usa a MATRÍCULA quando existe — é o mesmo identificador
 *  que o QR Code do crachá carrega, então URL colada de um lado abre igual
 *  do outro. Cai no id só para quem ainda não tem matrícula (admissão). */
const linkDaPessoa = (c: { empregado_id: number; matricula: string | null }) =>
  `${ROTA_FICHA}/${encodeURIComponent(c.matricula || String(c.empregado_id))}`;

export default function EspacoColaborador() {
  return (
    <AcessoGate
      menu="central_servicos_espaco_colaborador"
      acao="visualizar"
      fallback={
        <div className="p-6">
          <PageHeader
            title="Espaço do Colaborador"
            module="Central de Serviços"
            breadcrumb={["Espaço do Colaborador"]}
          />
          <Card className="p-6 text-sm text-muted-foreground">
            Você não tem acesso ao Espaço do Colaborador. Peça a liberação em
            Administração → Acesso por Usuário.
          </Card>
        </div>
      }
    >
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const [modo, setModo] = useState<Modo>("fluxograma");
  const [termo, setTermo] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const { data: arvore, isLoading, error } = useArvoreContratos();
  const contratos = arvore?.contratos ?? [];
  const { data: achados = [], isFetching: buscando } = useBuscaColaboradores(termo);

  const buscaAtiva = termo.trim().length >= 2;

  const alternar = (chave: string) =>
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });

  return (
    <div className="p-6">
      <PageHeader
        title="Espaço do Colaborador"
        subtitle="A operação de ponta a ponta: contrato, posto, função e as pessoas."
        module="Central de Serviços"
        breadcrumb={["Espaço do Colaborador"]}
        actions={
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
            <BotaoModo atual={modo} valor="fluxograma" onClick={setModo} icone={GitBranch}>
              Fluxograma
            </BotaoModo>
            <BotaoModo atual={modo} valor="pastas" onClick={setModo} icone={FolderOpen}>
              Árvore de pastas
            </BotaoModo>
          </div>
        }
      />

      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar colaborador pelo nome (2 letras ou mais)…"
          className="pl-9"
        />
        {buscando && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {buscaAtiva ? (
        <ResultadoBusca termo={termo} pessoas={achados} carregando={buscando} />
      ) : isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando a árvore…
        </Card>
      ) : error ? (
        <Card className="p-6 text-sm text-destructive">
          Não foi possível carregar a árvore: {(error as Error).message}
        </Card>
      ) : contratos.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum contrato ativo para mostrar.
        </Card>
      ) : (
        <>
          <Conferencia arvore={arvore!} />
          <div className={cn(modo === "fluxograma" ? "space-y-4" : "space-y-1")}>
            {contratos.map((c) => (
              <NoDeContrato
                key={c.id}
                contrato={c}
                modo={modo}
                aberto={abertos.has(c.id)}
                abertos={abertos}
                onAlternar={alternar}
              />
            ))}
            {arvore!.sem_contrato > 0 && (
              <NoSemContrato
                total={arvore!.sem_contrato}
                modo={modo}
                aberto={abertos.has(CHAVE_SEM_CONTRATO)}
                onAlternar={alternar}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A conta, à vista.
 *
 * Somar os nós à mão não fecha com o efetivo — quem não casa com contrato não
 * pende de nó nenhum. Antes essa diferença era invisível: a tela mostrava
 * 2.066 e o RH mostrava 2.501, e não havia como saber de onde vinha o buraco
 * sem ir no banco. Agora a decomposição está escrita.
 */
function Conferencia({ arvore }: { arvore: ArvoreCompleta }) {
  const emContrato = arvore.total_ativos - arvore.sem_contrato;
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-xs">
      <span>
        <strong className="text-sm">{arvore.total_ativos.toLocaleString("pt-BR")}</strong>{" "}
        <span className="text-muted-foreground">ativos na folha</span>
      </span>
      <span className="text-muted-foreground">=</span>
      <span>
        <strong className="text-sm">{emContrato.toLocaleString("pt-BR")}</strong>{" "}
        <span className="text-muted-foreground">em contrato</span>
      </span>
      <span className="text-muted-foreground">+</span>
      <span>
        <strong className={cn("text-sm", arvore.sem_contrato > 0 && "text-amber-600")}>
          {arvore.sem_contrato.toLocaleString("pt-BR")}
        </strong>{" "}
        <span className="text-muted-foreground">sem contrato identificado</span>
      </span>
      {arvore.encerrados_com_gente > 0 && (
        <Badge variant="outline" className="border-amber-500/40 text-amber-600">
          {arvore.encerrados_com_gente} contrato(s) encerrado(s) ainda com gente
        </Badge>
      )}
      {/* O card do RH conta PRESENÇA NO MÊS (por data de admissão/afastamento);
          aqui é o quadro de HOJE (por situação). Os dois números são certos e
          respondem perguntas diferentes — dizer isso evita a próxima rodada de
          "qual das telas está errada?". */}
      <span className="ml-auto text-[11px] text-muted-foreground">
        Quadro de hoje, por situação. O card “Ativos no mês” do RH conta presença
        no mês, por data — os dois não batem de propósito.
      </span>
    </Card>
  );
}

/**
 * O nó de quem a árvore não conseguiu pendurar em contrato nenhum.
 *
 * Fica por último e é expansível como qualquer outro: a graça é conseguir
 * ABRIR e ver quem são, porque é a coluna "local no cadastro" dessas pessoas
 * que o RH precisa corrigir.
 */
function NoSemContrato({
  total, modo, aberto, onAlternar,
}: {
  total: number; modo: Modo; aberto: boolean; onAlternar: (c: string) => void;
}) {
  const { data: pessoas = [], isFetching } = useColaboradoresSemContrato(aberto);

  const cabecalho = (
    <button
      type="button"
      onClick={() => onAlternar(CHAVE_SEM_CONTRATO)}
      className="flex w-full items-center gap-2 text-left"
    >
      <ChevronRight
        className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform",
          aberto && "rotate-90")}
      />
      <HelpCircle className="h-4 w-4 shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1 truncate font-semibold">Sem contrato identificado</span>
      <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/40 text-amber-600">
        <Users className="h-3 w-3" />
        {total}
      </Badge>
      {isFetching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
    </button>
  );

  const corpo = aberto && (
    <div className="mt-2">
      <p className="mb-2 px-2 text-xs text-muted-foreground">
        O contrato da pessoa sai de <code>“Descrição do Local”</code> (e, como
        alternativa, da filial). Quando nenhum dos dois casa com um contrato
        cadastrado, ela cai aqui — quase sempre é diferença de grafia entre a
        folha e o cadastro de contratos, e a correção é no cadastro.
      </p>
      {isFetching && pessoas.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">Carregando…</p>
      ) : (
        <div className="divide-y">
          {pessoas.map((p) => (
            <Link
              key={p.empregado_id}
              to={linkDaPessoa(p)}
              className="flex items-center gap-3 px-2 py-1.5 text-sm hover:bg-muted/50"
            >
              <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{p.nome}</span>
              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
                {p.local || "(sem local)"}
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block">
                {p.filial || "(sem filial)"}
              </span>
              {p.matricula && (
                <Badge variant="outline" className="shrink-0 text-[10px]">#{p.matricula}</Badge>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  if (modo === "pastas") {
    return (
      <div className="text-sm">
        <div className="rounded px-2 py-1.5 hover:bg-muted/50">{cabecalho}</div>
        {corpo && <div className="ml-4 border-l pl-3">{corpo}</div>}
      </div>
    );
  }

  return (
    <Card className="border-amber-500/40 p-4">
      {cabecalho}
      {corpo}
    </Card>
  );
}

function BotaoModo({
  atual, valor, onClick, icone: Icone, children,
}: {
  atual: Modo; valor: Modo; onClick: (m: Modo) => void;
  icone: typeof GitBranch; children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={atual === valor ? "default" : "ghost"}
      className="h-8 gap-1.5 px-3"
      onClick={() => onClick(valor)}
    >
      <Icone className="h-3.5 w-3.5" />
      {children}
    </Button>
  );
}

// ── Contrato ─────────────────────────────────────────────────────────

function NoDeContrato({
  contrato, modo, aberto, abertos, onAlternar,
}: {
  contrato: NoContrato; modo: Modo; aberto: boolean;
  abertos: Set<string>; onAlternar: (chave: string) => void;
}) {
  // `aberto` é o gatilho da consulta: as pessoas do contrato só saem do banco
  // depois do primeiro clique. React Query guarda o resultado, então recolher
  // e reabrir não vai ao banco de novo.
  const { data: pessoas = [], isFetching } = useColaboradoresDoContrato(contrato.id, aberto);

  const { supervisores, encarregados, postos } = useMemo(() => {
    // Pelo CARGO, não pela coluna "LIDER" — ver o comentário em ehSupervisor:
    // no banco real ela é "não"/vazio em 97% das linhas.
    const supervisores = pessoas.filter(ehSupervisor);
    const encarregados = pessoas.filter(ehEncarregado);
    // Chefia sai do agrupamento por posto para não aparecer duas vezes na
    // mesma árvore — quem lê contaria a mesma pessoa em dois lugares.
    const chefia = new Set([...supervisores, ...encarregados].map((p) => p.empregado_id));
    return {
      supervisores,
      encarregados,
      postos: montarPostos(contrato.postos, pessoas.filter((p) => !chefia.has(p.empregado_id))),
    };
  }, [pessoas, contrato.postos]);

  const cabecalho = (
    <button
      type="button"
      onClick={() => onAlternar(contrato.id)}
      className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left"
    >
      <ChevronRight
        className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform",
          aberto && "rotate-90")}
      />
      <Building2 className="h-4 w-4 shrink-0 text-primary" />

      {/* NO CELULAR O NOME FICA COM A LINHA INTEIRA, e os contadores descem
          para a linha de baixo.
          Truncar não servia: "BENTO GONÇALVES - AUX ADM - 002/2021" e "BENTO
          GONÇALVES LIMPEZA - 048/2026" viravam os dois "BENTO GONÇ…" — dois
          nós idênticos, e ninguém sabe em qual está clicando. Quebrar em duas
          linhas também não bastou, porque os badges comem a largura e o corte
          continuava caindo antes da parte que distingue um do outro.
          Numa árvore de NAVEGAÇÃO isso não é detalhe estético: é a função da
          tela. Em telas largas nada muda — volta a ser uma linha só. */}
      <span className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] font-semibold leading-tight sm:basis-auto sm:truncate">
        {contrato.nome}
      </span>

      <span className="flex w-full items-center gap-2 pl-7 sm:w-auto sm:flex-1 sm:justify-end sm:pl-0">
        {contrato.encerrado && (
          <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600">
            encerrado
          </Badge>
        )}
        {contrato.cliente && (
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
            {contrato.cliente}
          </span>
        )}
        <Badge variant="secondary" className="shrink-0 gap-1">
          <Users className="h-3 w-3" />
          {contrato.colaboradores}
          {contrato.vagas > 0 && (
            <span className="text-muted-foreground">/ {contrato.vagas}</span>
          )}
        </Badge>
        {contrato.qtd_postos > 0 && (
          <Badge variant="outline" className="shrink-0">
            {contrato.qtd_postos} {contrato.qtd_postos === 1 ? "posto" : "postos"}
          </Badge>
        )}
        {isFetching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </span>
    </button>
  );

  const corpo = aberto && (
    <div className={cn(modo === "fluxograma" ? "mt-3 space-y-3" : "mt-1")}>
      {contrato.qtd_postos === 0 && (
        <p className="px-2 text-xs text-muted-foreground">
          Este contrato ainda não tem posto na planilha de custo. Os postos são
          cadastrados na Licitação, junto com o contrato.
        </p>
      )}

      <RamoDeChefia
        titulo="Supervisores"
        icone={ShieldCheck}
        pessoas={supervisores}
        modo={modo}
        vazio="Nenhum cargo de supervisão neste contrato."
      />

      <RamoDeChefia
        titulo="Encarregados"
        icone={UserCog}
        pessoas={encarregados}
        modo={modo}
        vazio="Nenhum cargo de encarregado neste contrato."
        designado={contrato.encarregado_designado}
      />

      {isFetching && pessoas.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">Carregando colaboradores…</p>
      ) : (
        postos.map((g) => (
          <NoDePosto
            key={g.chave}
            chave={`${contrato.id}:${g.chave}`}
            posto={g}
            modo={modo}
            abertos={abertos}
            onAlternar={onAlternar}
          />
        ))
      )}
    </div>
  );

  if (modo === "pastas") {
    return (
      <div className="text-sm">
        <div className="rounded px-2 py-1.5 hover:bg-muted/50">{cabecalho}</div>
        {corpo && <div className="ml-4 border-l pl-3">{corpo}</div>}
      </div>
    );
  }

  return (
    <Card className="p-4">
      {cabecalho}
      {corpo}
    </Card>
  );
}

// ── Supervisores / Encarregados ──────────────────────────────────────

function RamoDeChefia({
  titulo, icone: Icone, pessoas, modo, vazio, designado,
}: {
  titulo: string; icone: typeof ShieldCheck; pessoas: ColaboradorLinha[];
  modo: Modo; vazio: string;
  designado?: { id: number; nome: string | null } | null;
}) {
  return (
    <div className={cn(modo === "fluxograma" && "rounded-lg border bg-muted/30 p-3")}>
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        {titulo}
        <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
          {pessoas.length}
        </Badge>
      </div>

      {/* A designação da Operação vem de RH_CONTRATO_ENCARREGADO e é a
          resposta OFICIAL de quem responde pelo contrato. Fica separada de
          quem apenas tem o nível no cadastro, que é dedução. */}
      {designado?.nome && (
        <div className="mx-2 mb-1 flex items-center gap-2 rounded border border-primary/30 bg-primary/5 px-2 py-1 text-xs">
          <UserCog className="h-3.5 w-3.5 shrink-0 text-primary" />
          <Link
            to={`${ROTA_FICHA}/${designado.id}`}
            className="truncate font-medium hover:underline"
          >
            {designado.nome}
          </Link>
          <Badge variant="secondary" className="ml-auto h-4 shrink-0 px-1.5 text-[10px]">
            designado
          </Badge>
        </div>
      )}

      {pessoas.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <div className={cn(modo === "fluxograma" ? "flex flex-wrap gap-2 px-2 pt-1" : "ml-4 border-l pl-3")}>
          {pessoas.map((p) => (
            <PessoaLink key={p.empregado_id} pessoa={p} modo={modo} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Posto → Função → Pessoas ─────────────────────────────────────────

function NoDePosto({
  chave, posto, modo, abertos, onAlternar,
}: {
  chave: string; posto: NoPosto; modo: Modo;
  abertos: Set<string>; onAlternar: (chave: string) => void;
}) {
  const aberto = abertos.has(chave);
  const vagas = posto.vagas ?? 0;
  // Posto contratado com mais gente do que vaga é achado de conferência, não
  // detalhe visual — por isso ganha destaque em vez de só um número.
  const excedido = posto.origem === "contratado" && vagas > 0 && posto.total > vagas;

  return (
    <div className={cn(modo === "fluxograma" && "rounded-lg border p-3",
      modo === "fluxograma" && posto.origem === "cadastro" && "border-dashed")}>
      <button
        type="button"
        onClick={() => onAlternar(chave)}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted/50"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            aberto && "rotate-90")}
        />
        <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{posto.nome}</span>

        {posto.origem === "cadastro" && (
          <Badge variant="outline" className="hidden shrink-0 border-dashed text-[10px] sm:inline-flex">
            só no cadastro
          </Badge>
        )}
        {posto.servico && (
          <span className="hidden truncate text-xs text-muted-foreground lg:block">
            {posto.servico}
          </span>
        )}
        <Badge
          variant={excedido ? "destructive" : "secondary"}
          className="shrink-0 h-5 px-1.5 text-[10px]"
        >
          {posto.total}{vagas > 0 ? ` / ${vagas}` : ""}
        </Badge>
      </button>

      {aberto && (
        <div className={cn(modo === "fluxograma" ? "mt-2 space-y-2 pl-6" : "ml-4 border-l pl-3")}>
          {posto.locais.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2">
              {posto.locais.map((l) => (
                <span
                  key={l.id}
                  className="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <MapPin className="h-3 w-3 shrink-0" />
                  {l.nome || "Local sem nome"}
                  {l.municipio && ` · ${l.municipio}${l.uf ? `/${l.uf}` : ""}`}
                  {l.orcadas > 0 && ` · ${l.executadas}/${l.orcadas}`}
                </span>
              ))}
            </div>
          )}

          {posto.funcoes.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">
              {posto.origem === "contratado"
                ? "Posto contratado, ainda sem ninguém alocado — as pessoas aparecem aqui depois da admissão."
                : "Sem colaboradores."}
            </p>
          ) : (
            posto.funcoes.map((f) => (
              <div key={f.funcao}>
                <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                  <span className="truncate font-medium">{f.funcao}</span>
                  <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
                    {f.pessoas.length}
                  </Badge>
                </div>
                <div className={cn(modo === "fluxograma" ? "flex flex-wrap gap-2 px-2" : "ml-4 border-l pl-3")}>
                  {f.pessoas.map((p) => (
                    <PessoaLink key={p.empregado_id} pessoa={p} modo={modo} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── A folha da árvore: a pessoa ──────────────────────────────────────

function PessoaLink({ pessoa, modo }: { pessoa: ColaboradorLinha; modo: Modo }) {
  if (modo === "pastas") {
    return (
      <Link
        to={linkDaPessoa(pessoa)}
        className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60 hover:underline"
      >
        <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{pessoa.nome}</span>
        {pessoa.matricula && (
          <span className="shrink-0 text-[11px] text-muted-foreground">#{pessoa.matricula}</span>
        )}
      </Link>
    );
  }

  return (
    <Link
      to={linkDaPessoa(pessoa)}
      className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs transition-colors hover:border-primary hover:bg-primary/5"
    >
      <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{pessoa.nome}</span>
      {pessoa.matricula && (
        <span className="shrink-0 text-[10px] text-muted-foreground">#{pessoa.matricula}</span>
      )}
    </Link>
  );
}

// ── Busca ────────────────────────────────────────────────────────────

function ResultadoBusca({
  termo, pessoas, carregando,
}: {
  termo: string; pessoas: ColaboradorLinha[]; carregando: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs text-muted-foreground">
        {carregando
          ? "Buscando…"
          : `${pessoas.length} resultado(s) para “${termo.trim()}”`}
      </p>
      {pessoas.length === 0 && !carregando ? (
        <p className="text-sm text-muted-foreground">Ninguém encontrado com esse nome.</p>
      ) : (
        <div className="divide-y">
          {pessoas.map((p) => (
            <Link
              key={p.empregado_id}
              to={linkDaPessoa(p)}
              className="flex items-center gap-3 px-1 py-2 text-sm hover:bg-muted/50"
            >
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{p.nome}</span>
              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
                {p.cargo ?? "—"}
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block">
                {p.local || p.filial || "—"}
              </span>
              {p.matricula && (
                <Badge variant="outline" className="shrink-0">#{p.matricula}</Badge>
              )}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
