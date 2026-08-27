import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, Loader2, Plus, Save, Send, Settings2, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useConfigReembolso, useSalvarConfigReembolso, useSalvarTipo, useTiposReembolso,
  type ConfigReembolso,
} from "@/hooks/useReembolso";
import {
  fmtBRL, normalizaHora, valorEmCentavos, type TipoReembolso,
} from "@/lib/reembolso/regras";

// =====================================================================
// REEMBOLSO — tipos, tetos e janelas.
//
// Esta tela É o diferencial em relação ao bot. Lá o catálogo era uma constante
// no código:
//
//     // --- Catálogo de ressarcimentos (sem limite de valor) ---
//     const ressarcimentos = [ { label: 'Almoço', value: 'almoco' }, ... ]
//
// Mudar um teto exigia editar o arquivo e subir o bot de novo — e como não
// havia teto nenhum, na prática ninguém mudava. Aqui é tabela, e quem mexe é
// quem tem `central_servicos_reembolso_config`: pode ser o financeiro sem que
// ele precise aprovar reembolso nenhum, ou o RH sem que ele precise pedir.
//
// As duas regras que esta tela governa:
//   TETO    — valor máximo aceito por despesa daquele tipo. Vazio = sem teto,
//             que era o comportamento do bot.
//   JANELA  — de que horas a que horas a VIAGEM precisa passar para o tipo
//             valer. Vazio = qualquer horário. É a regra do "almoço das 11 às
//             13; quem saiu às 14h não pede almoço".
// =====================================================================

/**
 * Os padrões usados para criar a despesa no Malote.
 *
 * A `malote_despesa` exige empresa e classificação, e o reembolso não tem
 * nenhum dos dois — não há como derivá-los de uma viagem. Em vez de adivinhar
 * (e criar despesa torta que alguém teria que corrigir na mão), ficam aqui,
 * numa linha só, sob a mesma permissão que governa tetos e janelas.
 *
 * Sem a empresa preenchida, o botão "Enviar ao malote" existe mas a RPC
 * recusa com essa razão dita — é melhor do que criar a despesa sem dono.
 */
function PadroesMalote() {
  const { data: cfg } = useConfigReembolso();
  const salvar = useSalvarConfigReembolso();
  const [form, setForm] = useState<ConfigReembolso>({
    empresa_id: null, classificacao_id: null, forma_pagamento: null, tipo_movimento: null,
  });

  useEffect(() => { if (cfg) setForm(cfg); }, [cfg]);

  const gravar = async () => {
    try {
      await salvar.mutateAsync(form);
      toast.success("Padrões do malote salvos.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não deu para salvar.");
    }
  };

  return (
    <Card className="mb-4 p-4">
      <p className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Send className="h-4 w-4" /> Padrões para o malote
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Com que empresa e classificação a despesa nasce no Malote quando um reembolso aprovado é
        enviado. Sem a empresa, o envio é recusado — a despesa ficaria sem dono.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Empresa (UUID) <span className="text-destructive">*</span></Label>
          <Input value={form.empresa_id ?? ""} placeholder="id da empresa"
                 onChange={(e) => setForm((f) => ({ ...f, empresa_id: e.target.value || null }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Classificação Malote (UUID)</Label>
          <Input value={form.classificacao_id ?? ""} placeholder="opcional"
                 onChange={(e) => setForm((f) => ({ ...f, classificacao_id: e.target.value || null }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Forma de pagamento</Label>
          <Input value={form.forma_pagamento ?? ""} placeholder="PIX"
                 onChange={(e) => setForm((f) => ({ ...f, forma_pagamento: e.target.value || null }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo de movimento</Label>
          <Input value={form.tipo_movimento ?? ""} placeholder="opcional"
                 onChange={(e) => setForm((f) => ({ ...f, tipo_movimento: e.target.value || null }))} />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={salvar.isPending} onClick={gravar}>
          <Save className="mr-2 h-4 w-4" /> Salvar padrões
        </Button>
      </div>
    </Card>
  );
}

/** O que fica no formulário — tudo string, porque campo de texto é string. */
interface Rascunho {
  codigo: string;
  nome: string;
  teto: string;
  inicio: string;
  fim: string;
  ativo: boolean;
  ordem: string;
  novo?: boolean;
}

const paraRascunho = (t: TipoReembolso): Rascunho => ({
  codigo: t.codigo,
  nome: t.nome,
  teto: t.valor_maximo_centavos === null ? "" : (t.valor_maximo_centavos / 100).toFixed(2).replace(".", ","),
  inicio: t.hora_inicio ?? "",
  fim: t.hora_fim ?? "",
  ativo: t.ativo,
  ordem: String(t.ordem),
});

export default function ConfiguracaoReembolso() {
  const { data: tipos = [], isLoading } = useTiposReembolso();
  const salvar = useSalvarTipo();
  const [rascunhos, setRascunhos] = useState<Rascunho[]>([]);

  // Recarrega o formulário quando o catálogo chega/muda. Sem isto, salvar um
  // tipo e ver a lista atualizada exigia recarregar a página.
  useEffect(() => {
    setRascunhos(tipos.map(paraRascunho));
  }, [tipos]);

  const alterar = (i: number, patch: Partial<Rascunho>) =>
    setRascunhos((a) => a.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const gravar = async (r: Rascunho) => {
    if (!r.codigo.trim()) return toast.error("O código do tipo é obrigatório.");
    if (!r.nome.trim()) return toast.error("O nome do tipo é obrigatório.");

    // Teto vazio = sem teto. Distinguir "vazio" de "zero" importa: zero
    // recusaria toda despesa daquele tipo em silêncio.
    let teto: number | null = null;
    if (r.teto.trim()) {
      teto = valorEmCentavos(r.teto);
      if (teto === null || teto <= 0) return toast.error(`Teto inválido em ${r.nome}.`);
    }

    // Ou os dois horários, ou nenhum — o banco tem o mesmo CHECK. Meia janela
    // é sempre erro de digitação e produziria "das 11:00 às (nada)" na tela.
    const inicio = r.inicio.trim() ? normalizaHora(r.inicio) : null;
    const fim = r.fim.trim() ? normalizaHora(r.fim) : null;
    if ((r.inicio.trim() && !inicio) || (r.fim.trim() && !fim)) {
      return toast.error(`Horário inválido em ${r.nome}. Use HH:MM.`);
    }
    if (!!inicio !== !!fim) {
      return toast.error(`Em ${r.nome}, preencha os dois horários da janela ou nenhum.`);
    }

    const ordem = Number(r.ordem);
    if (!Number.isInteger(ordem)) return toast.error(`Ordem inválida em ${r.nome}.`);

    try {
      await salvar.mutateAsync({
        codigo: r.codigo.trim(),
        nome: r.nome.trim(),
        valor_maximo_centavos: teto,
        hora_inicio: inicio,
        hora_fim: fim,
        ativo: r.ativo,
        ordem,
        novo: r.novo,
      });
      toast.success(`${r.nome} salvo.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Não deu para salvar.");
    }
  };

  const adicionar = () =>
    setRascunhos((a) => [
      ...a,
      { codigo: "", nome: "", teto: "", inicio: "", fim: "", ativo: true, ordem: "100", novo: true },
    ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Reembolso — Tipos e Limites"
        subtitle="O que pode ser reembolsado, até quanto, e em que horário a viagem precisa ter passado."
        module="Central de Serviços"
        breadcrumb={["Solicitar Reembolso", "Tipos e Limites"]}
      />

      <AcessoGate
        menu="central_servicos_reembolso_config"
        acao="alterar"
        fallback={
          <Card className="p-6 text-sm text-muted-foreground">
            <Settings2 className="mb-2 h-5 w-5" />
            Você não tem liberação para mudar as regras de reembolso. Quem tem essa permissão
            configura em Administração › Acesso por Usuário.
          </Card>
        }
      >
        <Card className="mb-4 p-4 text-sm text-muted-foreground">
          <p className="mb-1 flex items-center gap-2 font-medium text-foreground">
            <Clock className="h-4 w-4" /> Como a janela funciona
          </p>
          <p>
            A viagem precisa <strong>passar</strong> pela janela, não começar dentro dela. Almoço
            das 11:00 às 13:00 vale para quem saiu às 09:00 e voltou às 15:00 — atravessou o
            almoço na rua. Não vale para quem saiu às 14:00. Deixe os dois campos vazios para o
            tipo valer em qualquer horário.
          </p>
        </Card>

        <PadroesMalote />

        {isLoading ? (
          <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando os tipos…
          </Card>
        ) : (
          <div className="space-y-3">
            {rascunhos.map((r, i) => (
              <Card key={r.novo ? `novo-${i}` : r.codigo} className="p-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr_140px_110px_110px_90px]">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Código</Label>
                    <Input value={r.codigo} disabled={!r.novo}
                           placeholder="almoco"
                           onChange={(e) => alterar(i, { codigo: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome</Label>
                    <Input value={r.nome} onChange={(e) => alterar(i, { nome: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Teto (R$)</Label>
                    <Input inputMode="decimal" value={r.teto} placeholder="sem teto"
                           onChange={(e) => alterar(i, { teto: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Das</Label>
                    <Input value={r.inicio} placeholder="11:00"
                           onChange={(e) => alterar(i, { inicio: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Às</Label>
                    <Input value={r.fim} placeholder="13:00"
                           onChange={(e) => alterar(i, { fim: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ordem</Label>
                    <Input inputMode="numeric" value={r.ordem}
                           onChange={(e) => alterar(i, { ordem: e.target.value })} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={r.ativo} onCheckedChange={(v) => alterar(i, { ativo: v })} />
                    {r.ativo ? "Disponível para solicitação" : "Desativado"}
                  </label>
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-muted-foreground">
                      <Wallet className="mr-1 inline h-3 w-3" />
                      {r.teto.trim()
                        ? `Até ${fmtBRL(valorEmCentavos(r.teto) ?? 0)}`
                        : "Sem teto"}
                      {r.inicio.trim() && r.fim.trim() ? ` · ${r.inicio} às ${r.fim}` : " · qualquer horário"}
                    </p>
                    <Button size="sm" disabled={salvar.isPending} onClick={() => gravar(r)}>
                      <Save className="mr-2 h-4 w-4" /> Salvar
                    </Button>
                  </div>
                </div>
              </Card>
            ))}

            <AcessoGate menu="central_servicos_reembolso_config" acao="incluir">
              <Button variant="outline" onClick={adicionar}>
                <Plus className="mr-2 h-4 w-4" /> Novo tipo de despesa
              </Button>
            </AcessoGate>
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
