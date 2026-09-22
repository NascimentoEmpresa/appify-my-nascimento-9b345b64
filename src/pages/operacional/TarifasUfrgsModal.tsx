import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Campo } from "./diariaUi";
import {
  DiariaUfrgs,
  RascunhoTarifaUfrgs,
  TarifaUfrgs,
  aliquotaTotal,
  brlDeCentavos,
  fmtData,
  impactoDaTarifa,
  sindicatosUfrgs,
  validarTarifaUfrgs,
  vigenciasDoSindicato,
} from "./diariasUfrgs";

/**
 * Tarifas dos sindicatos — a tabela de valores que o bloco "4. Quantidades e
 * valores" usa para calcular a diária.
 *
 * O PEDIDO (22/09/2026): "se o valor do sindicato SINDIRODOSUL/RS mudar daqui
 * uma semana, eu não preciso pedir para vocês ajustarem — o próprio usuário
 * final com permissão vem e edita". Até aqui esses números só entravam por
 * migration (a 20260930000155 diz isso com todas as letras); agora entram por
 * aqui, pela RPC diaria_ufrgs_tarifa_salvar, para quem tiver a chave
 * "Diárias UFRGS — editar tarifas dos sindicatos" no Gerenciamento de Acesso.
 *
 * DUAS TELAS NUM MODAL SÓ, não um formulário inline em cada card: a edição
 * tem nove campos, uma data de vigência e um aviso de impacto. Inline, isso
 * empurra os outros sindicatos para fora da vista bem na hora em que a pessoa
 * quer comparar um com o outro — e some de vez num celular.
 *
 * O QUE NÃO É ÓBVIO OLHANDO A TELA:
 *
 * - Salvar não sobrescreve o passado. Grava uma linha NOVA com a data
 *   escolhida, e a tabela anterior continua valendo para as diárias dela. É
 *   por isso que existe histórico aqui embaixo, e é o que faz a diária de
 *   agosto continuar batendo com o que foi faturado em agosto.
 * - Salvar numa data que JÁ tem linha corrige aquela linha. É o caminho do
 *   erro de digitação, e a tela avisa antes.
 * - Quem já foi aprovado não muda. O recálculo pega só 'solicitada' e
 *   'em ajuste' na faixa daquela vigência; o resto continua com o valor que
 *   alguém já conferiu ou pagou.
 */

export interface TarifasUfrgsModalProps {
  aberto: boolean;
  tarifas: TarifaUfrgs[];
  /** Base do aviso de impacto — as diárias que a tela já carregou. */
  diarias: DiariaUfrgs[];
  /** Sindicato da diária de onde o modal foi aberto: começa destacado. */
  sindicatoFoco?: string;
  salvando?: boolean;
  onFechar: () => void;
  onSalvar: (r: RascunhoTarifaUfrgs & { motivo: string }) => void;
  onRemover: (id: string) => void;
}

/** Centavos → o número que o input de reais mostra (173,77 → 173.77). */
const emReais = (centavos: number) => Math.round(centavos || 0) / 100;
const emCentavos = (reais: number) => Math.round((Number(reais) || 0) * 100);
/** Fração → percentual e volta. numeric(6,4) no banco: 4 casas, nem uma a mais. */
const emPercentual = (fracao: number) => Number(((fracao || 0) * 100).toFixed(4));
const emFracao = (pct: number) => Number(((Number(pct) || 0) / 100).toFixed(4));

/**
 * Hoje no fuso de quem está olhando.
 *
 * `toISOString()` cru (o hojeIso() da exportação) devolve a data em UTC — das
 * 21h em diante no Brasil isso já é amanhã, e a tarifa nasceria vigente a
 * partir do dia seguinte sem ninguém pedir.
 */
const hojeLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

interface Rascunho {
  sindicato: string;
  /** true quando o sindicato é novo (campo de texto em vez de título fixo). */
  novoSindicato: boolean;
  vigenciaInicio: string;
  hospedagem: number;
  cafe: number;
  almoco: number;
  janta: number;
  va: number;
  pis: number;
  cofins: number;
  iss: number;
  motivo: string;
}

const rascunhoDe = (t: TarifaUfrgs, vigencia: string): Rascunho => ({
  sindicato: t.sindicato,
  novoSindicato: false,
  vigenciaInicio: vigencia,
  hospedagem: emReais(t.hospedagemCentavos),
  cafe: emReais(t.cafeCentavos),
  almoco: emReais(t.almocoCentavos),
  janta: emReais(t.jantaCentavos),
  va: emReais(t.vaCentavos),
  pis: emPercentual(t.aliquotaPis),
  cofins: emPercentual(t.aliquotaCofins),
  iss: emPercentual(t.aliquotaIss),
  motivo: "",
});

const RASCUNHO_VAZIO: Rascunho = {
  sindicato: "",
  novoSindicato: true,
  vigenciaInicio: "",
  hospedagem: 0,
  cafe: 0,
  almoco: 0,
  janta: 0,
  va: 0,
  // As três do "RESUMO DOS TRIBUTOS" do contrato: PIS 0,31% + COFINS 1,43%
  // + ISS 5% = 6,74%. Sindicato novo nasce com elas porque são do SERVIÇO,
  // não do sindicato — quem mudar, muda de propósito.
  pis: 0.31,
  cofins: 1.43,
  iss: 5,
  motivo: "",
};

const paraRascunhoValidavel = (r: Rascunho): RascunhoTarifaUfrgs => ({
  sindicato: r.sindicato,
  vigenciaInicio: r.vigenciaInicio,
  hospedagemCentavos: emCentavos(r.hospedagem),
  cafeCentavos: emCentavos(r.cafe),
  almocoCentavos: emCentavos(r.almoco),
  jantaCentavos: emCentavos(r.janta),
  vaCentavos: emCentavos(r.va),
  aliquotaPis: emFracao(r.pis),
  aliquotaCofins: emFracao(r.cofins),
  aliquotaIss: emFracao(r.iss),
});

/**
 * Campo de dinheiro/percentual. No topo do módulo pelo mesmo motivo dos
 * campos do modal da diária: componente declarado dentro do pai é um tipo
 * novo a cada render, e o input perde o foco a cada tecla.
 */
function CampoNumero({
  label,
  valor,
  set,
  sufixo,
  dica,
}: {
  label: string;
  valor: number;
  set: (n: number) => void;
  sufixo: string;
  dica?: string;
}) {
  return (
    <Campo label={`${label} (${sufixo})`} dica={dica}>
      <Input
        type="number"
        step="0.01"
        min={0}
        value={valor}
        onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
        className="h-9 text-right tabular-nums"
      />
    </Campo>
  );
}

/** Uma vigência do histórico, com os cinco valores em linha. */
function LinhaVigencia({
  t,
  atual,
  futura,
  podeRemover,
  confirmando,
  onCorrigir,
  onRemover,
  onCancelarRemocao,
}: {
  t: TarifaUfrgs;
  /** É a tabela que governa uma diária com saída HOJE. */
  atual: boolean;
  /** Já cadastrada, mas só passa a valer numa data que ainda não chegou. */
  futura: boolean;
  podeRemover: boolean;
  confirmando: boolean;
  onCorrigir: () => void;
  onRemover: () => void;
  onCancelarRemocao: () => void;
}) {
  const inativa = t.ativo === false;
  return (
    <div
      className={cn(
        "rounded-md border border-border/70 px-3 py-2",
        atual ? "bg-primary/5" : "bg-muted/20",
        inativa && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn("text-xs font-semibold", inativa && "line-through")}>
          {fmtData(t.vigenciaInicio)}
        </span>
        {atual && !inativa && (
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
            Em vigor
          </Badge>
        )}
        {futura && !inativa && (
          <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
            Passa a valer em {fmtData(t.vigenciaInicio)}
          </Badge>
        )}
        {inativa && (
          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
            Removida
          </Badge>
        )}
        <span className="text-[11px] tabular-nums text-muted-foreground">
          Hosp. {brlDeCentavos(t.hospedagemCentavos)} · Café {brlDeCentavos(t.cafeCentavos)} · Alm.{" "}
          {brlDeCentavos(t.almocoCentavos)} · Janta {brlDeCentavos(t.jantaCentavos)} · VA{" "}
          {brlDeCentavos(t.vaCentavos)} · Trib. {(aliquotaTotal(t) * 100).toFixed(2)}%
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCorrigir}>
            <Pencil className="mr-1 h-3 w-3" />
            {inativa ? "Restaurar" : "Corrigir"}
          </Button>
          {podeRemover && !inativa && !confirmando && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={onRemover}
            >
              <Trash2 className="mr-1 h-3 w-3" /> Remover
            </Button>
          )}
        </div>
      </div>

      {(t.motivo || t.atualizadoPorNome) && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t.motivo ? `${t.motivo} · ` : ""}
          {t.atualizadoPorNome
            ? `alterada por ${t.atualizadoPorNome}${t.atualizadoEm ? ` em ${t.atualizadoEm}` : ""}`
            : ""}
        </p>
      )}

      {confirmando && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="text-[11px] text-destructive">
            Remover a tabela de {fmtData(t.vigenciaInicio)}? As diárias em aberto voltam a usar a
            tabela anterior.
          </p>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancelarRemocao}>
              Cancelar
            </Button>
            <Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={onRemover}>
              Remover
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TarifasUfrgsModal({
  aberto,
  tarifas,
  diarias,
  sindicatoFoco,
  salvando = false,
  onFechar,
  onSalvar,
  onRemover,
}: TarifasUfrgsModalProps) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(null);

  // Fechar e reabrir volta para a lista: o formulário aberto de ontem não é
  // contexto de hoje, e "salvei?" é a dúvida que ele deixaria.
  useEffect(() => {
    if (!aberto) {
      setRascunho(null);
      setTentouSalvar(false);
      setConfirmandoRemocao(null);
    }
  }, [aberto]);

  // A data de hoje separa "em vigor" de "já cadastrada para depois". A tarifa
  // é escolhida pela SAÍDA da diária (tarifaVigente), então uma vigência com
  // data futura existe no cadastro e ainda não manda em nada — chamá-la de
  // "em vigor" faria a pessoa achar que o valor de hoje já mudou.
  const hoje = hojeLocal();
  const sindicatos = useMemo(() => sindicatosUfrgs(tarifas), [tarifas]);
  const ordenados = useMemo(
    () =>
      sindicatoFoco
        ? [...sindicatos].sort((a, b) =>
            a === sindicatoFoco ? -1 : b === sindicatoFoco ? 1 : 0,
          )
        : sindicatos,
    [sindicatos, sindicatoFoco],
  );

  const editar = (r: Rascunho) => {
    setRascunho(r);
    setTentouSalvar(false);
    setConfirmandoRemocao(null);
  };

  /** "Alterar valores": parte da tabela em vigor HOJE, com data de hoje. */
  const alterarValores = (sindicato: string) => {
    const ativas = vigenciasDoSindicato(tarifas, sindicato).filter((t) => t.ativo !== false);
    const base = ativas.find((t) => t.vigenciaInicio <= hoje) ?? ativas[0];
    editar(
      base
        ? rascunhoDe(base, hoje)
        : { ...RASCUNHO_VAZIO, sindicato, novoSindicato: false, vigenciaInicio: hoje },
    );
  };

  /** "Corrigir": mantém a data da linha, então a RPC atualiza aquela linha. */
  const corrigir = (t: TarifaUfrgs) => editar(rascunhoDe(t, t.vigenciaInicio));

  const validavel = rascunho ? paraRascunhoValidavel(rascunho) : null;
  const erro = validavel ? validarTarifaUfrgs(validavel) : null;

  /** A data escolhida já tem linha? Então salvar é CORRIGIR, não criar. */
  const linhaExistente = useMemo(
    () =>
      rascunho
        ? tarifas.find(
            (t) =>
              t.sindicato === rascunho.sindicato.trim() &&
              t.vigenciaInicio === rascunho.vigenciaInicio,
          ) ?? null
        : null,
    [tarifas, rascunho],
  );

  const impacto = useMemo(
    () =>
      rascunho && rascunho.sindicato.trim() && rascunho.vigenciaInicio
        ? impactoDaTarifa(diarias, tarifas, rascunho.sindicato.trim(), rascunho.vigenciaInicio)
        : null,
    [diarias, tarifas, rascunho],
  );

  const salvar = () => {
    if (!rascunho || !validavel) return;
    setTentouSalvar(true);
    if (erro) return;
    onSalvar({ ...validavel, sindicato: validavel.sindicato.trim(), motivo: rascunho.motivo.trim() });
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] w-[min(96vw,56rem)] max-w-none overflow-y-auto overflow-x-hidden p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="font-display text-xl font-bold tracking-tight">
            Tarifas dos sindicatos
          </DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            É esta tabela que o bloco “Quantidades e valores” usa para calcular a diária. Cada
            sindicato tem a sua, e cada alteração vale a partir de uma data.
          </p>
        </div>

        {/* ── Lista ── */}
        {!rascunho && (
          <div className="space-y-4 px-6 py-5">
            {ordenados.map((sindicato) => {
              const vigencias = vigenciasDoSindicato(tarifas, sindicato);
              const ativas = vigencias.filter((t) => t.ativo !== false);
              const vigente = ativas.find((t) => t.vigenciaInicio <= hoje) ?? null;
              return (
                <section
                  key={sindicato}
                  className={cn(
                    "rounded-lg border border-border/70 bg-card p-4",
                    sindicato === sindicatoFoco && "border-primary/40 ring-1 ring-primary/20",
                  )}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-primary">{sindicato}</h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {vigente
                          ? `Em vigor desde ${fmtData(vigente.vigenciaInicio)}`
                          : ativas.length > 0
                            ? `Passa a valer em ${fmtData(ativas[ativas.length - 1].vigenciaInicio)}`
                            : "Sem tabela de valores em vigor"}
                        {vigencias.length > 1 ? ` · ${vigencias.length} vigências` : ""}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => alterarValores(sindicato)}>
                      <Pencil className="mr-2 h-3.5 w-3.5" /> Alterar valores
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {vigencias.map((t) => (
                      <LinhaVigencia
                        key={t.id}
                        t={t}
                        atual={vigente?.id === t.id}
                        futura={t.vigenciaInicio > hoje}
                        // A última tabela ativa de um sindicato não sai: sem
                        // nenhuma, o banco recusa lançar diária daquele
                        // sindicato (diaria_ufrgs_validar). O botão some aqui
                        // e a RPC recusa lá — a tela só evita o caminho.
                        podeRemover={ativas.length > 1}
                        confirmando={confirmandoRemocao === t.id}
                        onCorrigir={() => corrigir(t)}
                        onRemover={() => {
                          if (confirmandoRemocao === t.id) {
                            setConfirmandoRemocao(null);
                            onRemover(t.id);
                          } else {
                            setConfirmandoRemocao(t.id);
                          }
                        }}
                        onCancelarRemocao={() => setConfirmandoRemocao(null)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">
                Alterar os valores cria uma vigência nova a partir da data que você escolher — as
                diárias já aprovadas ou pagas continuam com o valor que foi faturado.
              </p>
            </div>
          </div>
        )}

        {/* ── Formulário ── */}
        {rascunho && (
          <div className="space-y-4 px-6 py-5">
            <button
              type="button"
              onClick={() => setRascunho(null)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar para a lista
            </button>

            <div className="grid gap-4 sm:grid-cols-2">
              {rascunho.novoSindicato ? (
                <Campo
                  label="Sindicato"
                  obrigatorio
                  dica="Como aparece na planilha, ex.: SINDIRODOSUL/RS."
                >
                  <Input
                    value={rascunho.sindicato}
                    onChange={(e) => setRascunho({ ...rascunho, sindicato: e.target.value })}
                    placeholder="NOME/UF"
                  />
                </Campo>
              ) : (
                <Campo label="Sindicato">
                  <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm font-medium">
                    {rascunho.sindicato}
                  </div>
                </Campo>
              )}

              <Campo
                label="Vigente a partir de"
                obrigatorio
                dica={
                  linhaExistente
                    ? undefined
                    : "A tabela anterior continua valendo para as diárias com saída antes desta data."
                }
                erro={
                  linhaExistente
                    ? `Já existe uma tabela nesta data. Salvar vai CORRIGIR a de ${fmtData(linhaExistente.vigenciaInicio)}, não criar outra.`
                    : undefined
                }
              >
                <Input
                  type="date"
                  value={rascunho.vigenciaInicio}
                  onChange={(e) => setRascunho({ ...rascunho, vigenciaInicio: e.target.value })}
                />
              </Campo>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <CampoNumero
                label="Hospedagem"
                sufixo="R$"
                valor={rascunho.hospedagem}
                set={(n) => setRascunho({ ...rascunho, hospedagem: n })}
              />
              <CampoNumero
                label="Café"
                sufixo="R$"
                valor={rascunho.cafe}
                set={(n) => setRascunho({ ...rascunho, cafe: n })}
              />
              <CampoNumero
                label="Almoço"
                sufixo="R$"
                valor={rascunho.almoco}
                set={(n) => setRascunho({ ...rascunho, almoco: n })}
              />
              <CampoNumero
                label="Janta"
                sufixo="R$"
                valor={rascunho.janta}
                set={(n) => setRascunho({ ...rascunho, janta: n })}
              />
              <CampoNumero
                label="VA (por dia)"
                sufixo="R$"
                valor={rascunho.va}
                set={(n) => setRascunho({ ...rascunho, va: n })}
                dica="É descontado."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <CampoNumero
                label="PIS"
                sufixo="%"
                valor={rascunho.pis}
                set={(n) => setRascunho({ ...rascunho, pis: n })}
              />
              <CampoNumero
                label="COFINS"
                sufixo="%"
                valor={rascunho.cofins}
                set={(n) => setRascunho({ ...rascunho, cofins: n })}
              />
              <CampoNumero
                label="ISS"
                sufixo="%"
                valor={rascunho.iss}
                set={(n) => setRascunho({ ...rascunho, iss: n })}
                dica={`Tributos somam ${(rascunho.pis + rascunho.cofins + rascunho.iss).toFixed(2)}%.`}
              />
            </div>

            <Campo label="Por que está mudando" dica="Opcional — fica registrado na linha, ex.: “Dissídio 2026/2027”.">
              <Textarea
                value={rascunho.motivo}
                onChange={(e) => setRascunho({ ...rascunho, motivo: e.target.value })}
                rows={2}
                placeholder="Dissídio, termo aditivo, correção de digitação..."
              />
            </Campo>

            {/* O aviso de impacto. É a pergunta que qualquer um faz antes de
                clicar em salvar — "isso mexe no que já está lançado?" — e a
                resposta tem que estar ANTES do clique, não num toast depois. */}
            {impacto && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground">
                  {impacto.recalculadas.length === 0 && impacto.congeladas.length === 0 ? (
                    <>Nenhuma diária lançada usa esta faixa de datas — só as próximas.</>
                  ) : (
                    <>
                      Salvar recalcula{" "}
                      <strong className="text-foreground">
                        {impacto.recalculadas.length}{" "}
                        {impacto.recalculadas.length === 1 ? "diária em aberto" : "diárias em aberto"}
                      </strong>{" "}
                      (solicitada ou em ajuste).
                      {impacto.congeladas.length > 0 && (
                        <>
                          {" "}
                          Outras {impacto.congeladas.length} já aprovadas ou pagas continuam com o
                          valor que foi faturado.
                        </>
                      )}
                    </>
                  )}
                </p>
              </div>
            )}

            {tentouSalvar && erro && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <p className="text-[11px] font-medium text-destructive">{erro}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Rodapé ── */}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background px-6 py-4">
          {!rascunho && (
            <Button
              variant="outline"
              className="mr-auto"
              onClick={() => editar({ ...RASCUNHO_VAZIO, vigenciaInicio: hojeLocal() })}
            >
              <Plus className="mr-2 h-4 w-4" /> Adicionar sindicato
            </Button>
          )}
          {rascunho && (
            <Button variant="ghost" className="mr-auto" onClick={() => setRascunho(null)}>
              <RotateCcw className="mr-2 h-4 w-4" /> Descartar
            </Button>
          )}
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
          {rascunho && (
            <Button onClick={salvar} disabled={salvando}>
              <Pencil className="mr-2 h-4 w-4" />
              {salvando
                ? "Salvando..."
                : linhaExistente
                  ? "Corrigir esta tabela"
                  : "Salvar nova vigência"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
