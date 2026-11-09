import { ReactNode, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import type { LinkCard, PainelFluxoExtrato, PontePainelFluxo, EntradasSaidas, SituacaoComparacao } from "./regras";
import { conciliacoesDuplicadas, explicarFluxoXExtrato, registrosAtuais, ultimoDiaDoMes } from "@/lib/conciliacaoDashboard";
import { useFluxoCaixaCombinado } from "@/hooks/useFluxoCaixaMalote";
import { useConciliacoesFluxoCaixaSalvas } from "@/hooks/useConciliacaoFluxoCaixa";
import { useContasBanco, useContasDosLancamentos } from "@/hooks/useContasBanco";
import { comContaBanco, rotuloConta } from "@/lib/contaBanco";
import { useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { hojeISO } from "@/pages/financeiro/fluxo-caixa/abasFluxo";
import { TabelaConferenciaPorConta } from "@/pages/financeiro/conciliacao-dashboard/TabelaConferenciaPorConta";

// SIS-2026-0833: tudo o que explica a diferença do card 2 (Fluxo × Extrato) num lugar só, para o card ficar limpo.
const mesParaBR = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pctTxt = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;

export function DialogEntenderDiferenca({
  aberto, onFechar, p, mes, empresaId, situacao, linkFluxo, linkBanco,
}: {
  aberto: boolean;
  onFechar: () => void;
  p: PainelFluxoExtrato;
  mes: string;
  empresaId: string | null;
  situacao: SituacaoComparacao | null;
  linkFluxo: LinkCard;
  linkBanco: LinkCard;
}) {
  const ponte = p.ponte;
  const saldoAnt = ponte?.saldoAnterior.saldo ?? 0;
  const transferencia = !!ponte && p.difSaidas > 0 && ponte.semConciliacao.entradas > 0 && Math.abs(p.difSaidas - ponte.semConciliacao.entradas) <= Math.max(1, ponte.semConciliacao.entradas * 0.01);
  const pct = p.cobertura === null ? null : pctTxt(p.cobertura);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] w-[96vw] max-w-[1400px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Entender a diferença — {mesParaBR(mes)}</DialogTitle>
          <DialogDescription>Por que o Fluxo de Caixa e o extrato têm valores diferentes, e o que ainda precisa ser resolvido.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          {/* 1. Resumo */}
          <div className={cn("flex gap-2 rounded-md border p-3", situacao === "confere" ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30")}>
            {situacao === "confere" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
            <p>
              {situacao === "confere"
                ? "Nos bancos conciliados, o Fluxo e o extrato conferem (entradas e saídas)."
                : <>Nos bancos conciliados, ainda há diferença de <strong>{fmtMoney(p.difEntradas)}</strong> nas entradas e de <strong>{fmtMoney(p.difSaidas)}</strong> nas saídas.</>}
              {" "}O valor total do Fluxo é maior que o do extrato por motivos que não são erro (abaixo). O que precisa de ação aparece em “O que ainda precisa ser resolvido”.
            </p>
          </div>

          {/* 2. Por que Fluxo e extrato têm valores diferentes */}
          {ponte && (
            <section className="space-y-2">
              <h3 className="font-semibold">1. Por que o Fluxo tem mais do que o extrato</h3>
              <p className="text-xs text-muted-foreground">
                O Fluxo de Caixa soma tudo; o extrato só existe nos bancos com conciliação salva e não traz saldo de abertura. Do total do Fluxo, sai o que não se compara:
              </p>
              <PonteFluxo ponte={ponte} recorte={p.fluxo} />
            </section>
          )}

          {/* 3. Saldo gerado */}
          {ponte && (
            <section className="space-y-2">
              <h3 className="font-semibold">2. Por que o saldo gerado é diferente</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-xs font-semibold">Fluxo de Caixa</p>
                  <table className="mt-1 w-full text-xs">
                    <tbody>
                      <tr><td className="py-0.5">Saldo gerado (entradas − saídas)</td><td className="text-right tabular-nums">{fmtMoney(ponte.total.saldo)}</td></tr>
                      {Math.abs(saldoAnt) >= 0.005 && <tr className="text-muted-foreground"><td className="py-0.5">(−) Saldo anterior (abertura das contas, lançado como entrada)</td><td className="text-right tabular-nums">{fmtMoney(saldoAnt)}</td></tr>}
                      <tr className="border-t font-semibold"><td className="py-0.5">Saldo gerado só com o movimento do mês</td><td className="text-right tabular-nums">{fmtMoney(r2(ponte.total.saldo - saldoAnt))}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs font-semibold">Extrato bancário</p>
                  <table className="mt-1 w-full text-xs">
                    <tbody>
                      <tr><td className="py-0.5">Saldo gerado (entradas − saídas)</td><td className="text-right tabular-nums">{fmtMoney(p.extrato.saldo)}</td></tr>
                      <tr className="text-muted-foreground"><td className="py-0.5" colSpan={2}>O extrato não traz o saldo de abertura como movimento.</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
              {Math.abs(saldoAnt) >= 0.005 && (
                <p className="text-xs text-muted-foreground">
                  O saldo anterior de <strong>{fmtMoney(saldoAnt)}</strong> é o que as contas já tinham na abertura do mês. Entra no Fluxo como entrada para o saldo de caixa fechar, mas não é dinheiro que entrou no mês nem aparece em extrato.
                </p>
              )}
            </section>
          )}

          {/* 4 e 5. Causas e tabela por banco (só carrega os dados pesados com o modal aberto) */}
          {aberto && <CausasETabela p={p} mes={mes} empresaId={empresaId} transferencia={transferencia} linkBanco={linkBanco} />}

          {/* 6. Cobertura */}
          <section className="space-y-1 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">Cobertura:</span> {p.conciliacoes} conta(s)/empresa(s) conciliada(s){p.bancos.length > 0 ? ` (${p.bancos.join(", ")})` : ""}
              {pct !== null ? ` — ${pct} das saídas do Fluxo do mês` : ""}.
            </p>
            <p>Fluxo do mês inteiro (todos os bancos, sem saldo anterior): entradas {fmtMoney(p.fluxoMes.entradas)} · saídas {fmtMoney(p.fluxoMes.saidas)}. Bancos sem conciliação salva ficam fora da comparação.</p>
            {p.semTotais > 0 && <p className="text-amber-700 dark:text-amber-400">{p.semTotais} conciliação(ões) sem o total do extrato registrado — aplique a migration 20261014000006.</p>}
            <p>
              Confira o total no <Link to={linkFluxo.to} className="text-primary hover:underline">Fluxo de Caixa</Link> e os detalhes na <Link to={linkBanco.to} className="text-primary hover:underline">Conciliação Bancária</Link>.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Do total que a tela do Fluxo de Caixa mostra até o recorte que se compara com o extrato, parte a parte.
function PonteFluxo({ ponte, recorte }: { ponte: PontePainelFluxo; recorte: EntradasSaidas }) {
  const linhas: { rotulo: string; v: EntradasSaidas; sinal: -1 | 1; dica?: string }[] = [
    { rotulo: "Fluxo de Caixa (igual à tela do Fluxo)", v: ponte.total, sinal: 1 },
    { rotulo: "Saldo anterior (abertura do mês)", v: ponte.saldoAnterior, sinal: -1, dica: "Passagem de saldo: o extrato não traz isto como movimento." },
    { rotulo: "Bancos sem conciliação salva", v: ponte.semConciliacao, sinal: -1, dica: "Contas cujo extrato ainda não foi conciliado no mês." },
    { rotulo: "Ignorados na conciliação", v: ponte.ignorados, sinal: -1, dica: "Conta vinculada e resgates de conta vinculada (BB e Caixa): não aparecem no extrato." },
  ];
  return (
    <div className="rounded-md border p-2.5 text-xs">
      <table className="w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-normal">Parte</th>
            <th className="pb-1 text-right font-normal">Entradas</th>
            <th className="pb-1 text-right font-normal">Saídas</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-t" title={l.dica}>
              <td className="py-1">{l.sinal === -1 ? "(−) " : ""}{l.rotulo}</td>
              <td className="py-1 text-right tabular-nums">{fmtMoney(l.v.entradas)}</td>
              <td className="py-1 text-right tabular-nums">{fmtMoney(l.v.saidas)}</td>
            </tr>
          ))}
          <tr className="border-t font-semibold">
            <td className="py-1">(=) Fluxo dos bancos conciliados (o que vai contra o extrato)</td>
            <td className="py-1 text-right tabular-nums">{fmtMoney(recorte.entradas)}</td>
            <td className="py-1 text-right tabular-nums">{fmtMoney(recorte.saidas)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CausasETabela({ p, mes, empresaId, transferencia, linkBanco }: { p: PainelFluxoExtrato; mes: string; empresaId: string | null; transferencia: boolean; linkBanco: LinkCard }) {
  const navigate = useNavigate();
  const { data: linhasFluxo = [] } = useFluxoCaixaCombinado();
  const { data: salvas = [] } = useConciliacoesFluxoCaixaSalvas();
  const { data: contasBanco = [] } = useContasBanco();
  const { data: contasDosLancamentos } = useContasDosLancamentos();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: empresas = [] } = useEmpresasGrupo();

  const linhasComConta = useMemo(() => comContaBanco(linhasFluxo, contasDosLancamentos ?? new Map()), [linhasFluxo, contasDosLancamentos]);
  const rotulos = useMemo(() => new Map(contasBanco.map((c) => [c.id, rotuloConta(c)] as [string, string])), [contasBanco]);
  const bancoNome = (id: string | null) => (id ? bancos.find((b) => b.id === id)?.nome ?? "—" : "—");
  const empresaNome = (id: string) => empresas.find((e) => e.id === id)?.nome ?? "—";

  const atuais = useMemo(
    () => registrosAtuais(salvas).filter((c) => c.data_fim.slice(0, 7) === mes && (!empresaId || c.todas_empresas || c.empresa_ids.includes(empresaId))),
    [salvas, mes, empresaId],
  );
  const conferencia = useMemo(
    () => explicarFluxoXExtrato(linhasComConta, atuais, { dataDe: `${mes}-01`, dataAte: ultimoDiaDoMes(mes), empresaId, bancoId: null, mesDe: mes, mesAte: mes }, hojeISO()),
    [linhasComConta, atuais, mes, empresaId],
  );
  const duplicadas = useMemo(() => conciliacoesDuplicadas(atuais), [atuais]);
  const mudouDepois = conferencia.linhas.filter(
    (r) => r.conciliacaoId && ((r.gravadoE != null && Math.abs(r.fluxoE - r.gravadoE) >= 0.005) || (r.gravadoS != null && Math.abs(r.fluxoS - r.gravadoS) >= 0.005)),
  );
  const semConc = conferencia.linhas.filter((r) => !r.conciliacaoId);

  const itens: { chave: string; titulo: string; texto: ReactNode }[] = [];
  if (transferencia) {
    itens.push({
      chave: "transferencia",
      titulo: "Transferência entre contas (ex.: aplicação Rende Fácil)",
      texto: <>A diferença de saídas ({fmtMoney(p.difSaidas)}) é praticamente o valor das entradas de bancos sem conciliação ({fmtMoney(p.ponte!.semConciliacao.entradas)}). A <strong>saída</strong> está no banco já conciliado e não consta no extrato dele; a <strong>entrada</strong> está no banco ainda sem conciliação. Concilie o banco de destino e confira o extrato do banco de origem.</>,
    });
  }
  for (const d of duplicadas) {
    itens.push({
      chave: `dup-${d.ids.join("")}`,
      titulo: "Conciliação duplicada",
      texto: <>A conta <strong>{d.contaExtrato}</strong> ({d.empresaIds.map(empresaNome).join(", ")}) foi conciliada mais de uma vez em {mesParaBR(d.mes)}, nos bancos {d.bancoIds.map(bancoNome).join(" e ")}. O extrato dessa conta é contado em dobro. Exclua a conciliação antiga em Conciliações Salvas.</>,
    });
  }
  for (const r of mudouDepois) {
    const dE = r2(r.fluxoE - (r.gravadoE ?? r.fluxoE));
    const dS = r2(r.fluxoS - (r.gravadoS ?? r.fluxoS));
    itens.push({
      chave: `mudou-${r.chave}`,
      titulo: "O Fluxo mudou depois de a conciliação ser salva",
      texto: <>{bancoNome(r.bancoId)}{r.contaExtrato ? ` · ${r.contaExtrato}` : ""}: o Fluxo gravado na conciliação era entradas {fmtMoney(r.gravadoE ?? 0)} / saídas {fmtMoney(r.gravadoS ?? 0)} e hoje é {fmtMoney(r.fluxoE)} / {fmtMoney(r.fluxoS)} (variação {fmtMoney(dE)} nas entradas, {fmtMoney(dS)} nas saídas). Pode ser lançamento feito ou editado depois, ou ajuste criado pela própria conciliação. Refaça a conciliação se o extrato não tem esse valor.</>,
    });
  }
  if (semConc.length > 0) {
    itens.push({
      chave: "sem-conciliacao",
      titulo: `${semConc.length} banco(s)/conta(s) sem conciliação salva`,
      texto: <>{semConc.map((r) => `${bancoNome(r.bancoId)} (entradas ${fmtMoney(r.fluxoE)}, saídas ${fmtMoney(r.fluxoS)})`).join("; ")}. Estão em amarelo na tabela abaixo.</>,
    });
  }

  return (
    <>
      <section className="space-y-2">
        <h3 className="font-semibold">3. O que ainda precisa ser resolvido</h3>
        {itens.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Nada detectado para este mês.</p>
        ) : (
          <ul className="space-y-2">
            {itens.map((i) => (
              <li key={i.chave} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div><p className="font-semibold">{i.titulo}</p><p>{i.texto}</p></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">4. Por banco e conta</h3>
        <TabelaConferenciaPorConta
          linhas={conferencia.linhas}
          bancoNome={bancoNome}
          empresaNome={empresaNome}
          rotuloConta={(id) => rotulos.get(id)}
          onVerDetalhes={() => navigate(linkBanco.to)}
          altura={320}
        />
      </section>
    </>
  );
}
