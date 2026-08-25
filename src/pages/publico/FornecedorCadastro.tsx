import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FORMAS_PAGAMENTO, type ContaBancariaPendente } from "@/hooks/useFornecedorCadastro";
import {
  Building2, Mail, MapPin, Landmark, Plus, Trash2, CheckCircle2, XCircle, Loader2, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cadastro de fornecedor — a página que o PRÓPRIO fornecedor preenche
 * (SIS-2026-0209). Pública, sem login.
 *
 * Nasceu de um pedido do gerente de Suprimentos: hoje quem digita o cadastro é
 * o comprador, com o que o vendedor mandou no WhatsApp, e sempre falta alguma
 * coisa — o e-mail que recebe a nota, o banco, o prazo. A ideia dele:
 *
 *   "Ele pega o link, manda para a empresa: preciso que tu preenches esses
 *    dados que é o cadastro que eu tenho que fazer aqui pra eu poder gerar o
 *    teu pedido."
 *
 * A credencial é o token da URL. Não há sessão, e o navegador não carrega
 * chave nenhuma: tudo passa pela Edge Function fornecedor-cadastro-publico.
 *
 * NADA daqui vira fornecedor direto — o cadastro fica pendente até alguém do
 * Suprimentos aprovar, que foi condição explícita dele: "a gente recebe e
 * aprova o cadastro dele".
 */

type Estado = "checando" | "valido" | "invalido" | "enviado";

const CONTA_VAZIA: ContaBancariaPendente = {
  banco_codigo: "", banco_nome: "", agencia: "", conta: "",
  tipo: "corrente", titular_nome: "", pix_tipo: "", pix_chave: "", principal: true,
};

const MOTIVO_TEXTO: Record<string, string> = {
  inexistente: "Este link não existe. Confira se copiou o endereço inteiro.",
  ja_usado: "Este link já foi usado para enviar um cadastro.",
  expirado: "Este link expirou. Peça um novo ao seu contato na Nascimento.",
};

export default function FornecedorCadastro() {
  const { token = "" } = useParams<{ token: string }>();
  const [estado, setEstado] = useState<Estado>("checando");
  const [motivo, setMotivo] = useState<string>("inexistente");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [f, setF] = useState<Record<string, any>>({
    cnpj_cpf: "", razao_social: "", nome_fantasia: "", inscricao_estadual: "", cnae_principal: "",
    email: "", email_financeiro: "", email_nota_fiscal: "",
    contato: "", telefone: "", telefone_vendedor: "",
    cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "",
    formas_pagamento: [] as string[],
    condicao_pagamento: "", prazo_entrega_dias: "",
    devolucao_prazo_dias: "", devolucao_procedimento: "", observacoes: "",
  });
  const [contas, setContas] = useState<ContaBancariaPendente[]>([{ ...CONTA_VAZIA }]);

  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  const chamar = async (body: any) => {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/fornecedor-cadastro-publico`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return resp.json();
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await chamar({ token, acao: "validar" });
        if (!vivo) return;
        if (r?.valido) setEstado("valido");
        else { setMotivo(r?.motivo ?? "inexistente"); setEstado("invalido"); }
      } catch {
        if (vivo) { setMotivo("inexistente"); setEstado("invalido"); }
      }
    })();
    return () => { vivo = false; };
  }, [token]);

  const enviar = async () => {
    setErro(null);
    if (!f.cnpj_cpf.trim() || !f.razao_social.trim()) {
      setErro("Informe pelo menos o CNPJ e a razão social.");
      return;
    }
    setEnviando(true);
    try {
      const dados = {
        ...f,
        prazo_entrega_dias: f.prazo_entrega_dias === "" ? null : f.prazo_entrega_dias,
        devolucao_prazo_dias: f.devolucao_prazo_dias === "" ? null : f.devolucao_prazo_dias,
        // Conta em branco não vai: o fornecedor pode só trabalhar com boleto.
        contas_bancarias: contas.filter((c) => (c.banco_codigo ?? "").trim() || (c.pix_chave ?? "").trim()),
      };
      const r = await chamar({ token, acao: "enviar", dados });
      if (r?.error) setErro(r.error);
      else setEstado("enviado");
    } catch {
      setErro("Não foi possível enviar agora. Tente novamente em instantes.");
    } finally {
      setEnviando(false);
    }
  };

  if (estado === "checando") {
    return (
      <Moldura>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Conferindo o link…</p>
        </div>
      </Moldura>
    );
  }

  if (estado === "invalido") {
    return (
      <Moldura>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <XCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-lg font-semibold">Link indisponível</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {MOTIVO_TEXTO[motivo] ?? MOTIVO_TEXTO.inexistente}
          </p>
        </div>
      </Moldura>
    );
  }

  if (estado === "enviado") {
    return (
      <Moldura>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-600" />
          <h2 className="text-lg font-semibold">Cadastro enviado</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Recebemos os seus dados. Eles passam por uma conferência da nossa
            equipe de Suprimentos antes de o cadastro ser liberado — se faltar
            algo, o seu contato na Nascimento fala com você.
          </p>
          <p className="text-xs text-muted-foreground">Você já pode fechar esta página.</p>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="space-y-6 pb-16">
        <p className="text-sm text-muted-foreground">
          Preencha os dados da sua empresa. Eles são usados para emitir pedidos
          de compra, receber a nota fiscal e efetuar o pagamento — por isso vale
          conferir os e-mails e os dados bancários com atenção.
        </p>

        <Secao icone={Building2} titulo="Dados da empresa">
          <Grade>
            <Campo rotulo="CNPJ ou CPF *" valor={f.cnpj_cpf} onChange={(v) => set("cnpj_cpf", v)} placeholder="00.000.000/0000-00" />
            <Campo rotulo="Razão social *" valor={f.razao_social} onChange={(v) => set("razao_social", v)} />
            <Campo rotulo="Nome fantasia" valor={f.nome_fantasia} onChange={(v) => set("nome_fantasia", v)} />
            <Campo rotulo="Inscrição estadual" valor={f.inscricao_estadual} onChange={(v) => set("inscricao_estadual", v)} />
            <Campo rotulo="CNAE principal" valor={f.cnae_principal} onChange={(v) => set("cnae_principal", v)} placeholder="0000-0/00" />
          </Grade>
        </Secao>

        <Secao icone={Mail} titulo="Contatos" descricao="Separe os e-mails: o financeiro e o da nota fiscal costumam ser diferentes do comercial.">
          <Grade>
            <Campo rotulo="E-mail comercial" valor={f.email} onChange={(v) => set("email", v)} tipo="email" />
            <Campo rotulo="E-mail do financeiro" valor={f.email_financeiro} onChange={(v) => set("email_financeiro", v)} tipo="email" />
            <Campo rotulo="E-mail para a nota fiscal" valor={f.email_nota_fiscal} onChange={(v) => set("email_nota_fiscal", v)} tipo="email" />
            <Campo rotulo="Pessoa de contato" valor={f.contato} onChange={(v) => set("contato", v)} />
            <Campo rotulo="Telefone" valor={f.telefone} onChange={(v) => set("telefone", v)} />
            <Campo rotulo="Telefone do vendedor" valor={f.telefone_vendedor} onChange={(v) => set("telefone_vendedor", v)} />
          </Grade>
        </Secao>

        <Secao icone={MapPin} titulo="Endereço">
          <Grade>
            <Campo rotulo="CEP" valor={f.cep} onChange={(v) => set("cep", v)} />
            <Campo rotulo="Logradouro" valor={f.logradouro} onChange={(v) => set("logradouro", v)} />
            <Campo rotulo="Número" valor={f.numero} onChange={(v) => set("numero", v)} />
            <Campo rotulo="Complemento" valor={f.complemento} onChange={(v) => set("complemento", v)} />
            <Campo rotulo="Bairro" valor={f.bairro} onChange={(v) => set("bairro", v)} />
            <Campo rotulo="Cidade" valor={f.cidade} onChange={(v) => set("cidade", v)} />
            <Campo rotulo="UF" valor={f.uf} onChange={(v) => set("uf", v.toUpperCase().slice(0, 2))} placeholder="RS" />
          </Grade>
        </Secao>

        <Secao icone={ShieldCheck} titulo="Comercial" descricao="Como você recebe e em quanto tempo entrega.">
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Formas de pagamento que você aceita</Label>
              <div className="mt-2 flex flex-wrap gap-4">
                {FORMAS_PAGAMENTO.map((fp) => (
                  <label key={fp.valor} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={f.formas_pagamento.includes(fp.valor)}
                      onCheckedChange={(c) =>
                        set("formas_pagamento", c
                          ? [...f.formas_pagamento, fp.valor]
                          : f.formas_pagamento.filter((x: string) => x !== fp.valor))
                      }
                    />
                    {fp.rotulo}
                  </label>
                ))}
              </div>
            </div>
            <Grade>
              <Campo rotulo="Condição de pagamento" valor={f.condicao_pagamento} onChange={(v) => set("condicao_pagamento", v)} placeholder="Ex.: 30/60/90 dias" />
              <Campo rotulo="Prazo de entrega após o pedido (dias)" valor={f.prazo_entrega_dias} onChange={(v) => set("prazo_entrega_dias", v.replace(/\D/g, ""))} />
            </Grade>
          </div>
        </Secao>

        <Secao icone={Landmark} titulo="Dados bancários" descricao="Preencha se trabalha com PIX ou transferência. Só boleto? Pode deixar em branco.">
          <div className="space-y-4">
            {contas.map((c, i) => (
              <div key={i} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Conta {i + 1}</span>
                  {contas.length > 1 && (
                    <Button type="button" variant="ghost" size="sm"
                            onClick={() => setContas(contas.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Grade>
                  <Campo rotulo="Banco (código)" valor={c.banco_codigo ?? ""} onChange={(v) => trocaConta(setContas, i, "banco_codigo", v)} placeholder="001" />
                  <Campo rotulo="Banco (nome)" valor={c.banco_nome ?? ""} onChange={(v) => trocaConta(setContas, i, "banco_nome", v)} />
                  <Campo rotulo="Agência" valor={c.agencia ?? ""} onChange={(v) => trocaConta(setContas, i, "agencia", v)} />
                  <Campo rotulo="Conta" valor={c.conta ?? ""} onChange={(v) => trocaConta(setContas, i, "conta", v)} />
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Select value={c.tipo || "corrente"} onValueChange={(v) => trocaConta(setContas, i, "tipo", v)}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="corrente">Corrente</SelectItem>
                        <SelectItem value="poupanca">Poupança</SelectItem>
                        <SelectItem value="pagamento">Pagamento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Campo rotulo="Titular" valor={c.titular_nome ?? ""} onChange={(v) => trocaConta(setContas, i, "titular_nome", v)} />
                  <div>
                    <Label className="text-xs">Tipo da chave PIX</Label>
                    <Select value={c.pix_tipo || "__nenhum__"} onValueChange={(v) => trocaConta(setContas, i, "pix_tipo", v === "__nenhum__" ? "" : v)}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__nenhum__">Não usa PIX</SelectItem>
                        <SelectItem value="cpf">CPF</SelectItem>
                        <SelectItem value="cnpj">CNPJ</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                        <SelectItem value="telefone">Telefone</SelectItem>
                        <SelectItem value="aleatoria">Aleatória</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Campo rotulo="Chave PIX" valor={c.pix_chave ?? ""} onChange={(v) => trocaConta(setContas, i, "pix_chave", v)} />
                </Grade>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setContas([...contas, { ...CONTA_VAZIA, principal: false }])}>
              <Plus className="mr-2 h-4 w-4" /> Outra conta
            </Button>
          </div>
        </Secao>

        <Secao icone={ShieldCheck} titulo="Devolução" descricao="Como funciona se precisarmos devolver um produto. Isso evita uma ligação depois.">
          <Grade>
            <Campo rotulo="Prazo para devolução (dias)" valor={f.devolucao_prazo_dias} onChange={(v) => set("devolucao_prazo_dias", v.replace(/\D/g, ""))} />
          </Grade>
          <div className="mt-4">
            <Label className="text-xs">Como proceder</Label>
            <Textarea className="mt-1" rows={3} value={f.devolucao_procedimento}
                      onChange={(e) => set("devolucao_procedimento", e.target.value)}
                      placeholder="Ex.: avisar o vendedor por e-mail, com nota fiscal e descrição do motivo." />
          </div>
        </Secao>

        <div>
          <Label className="text-xs">Observações</Label>
          <Textarea className="mt-1" rows={3} value={f.observacoes}
                    onChange={(e) => set("observacoes", e.target.value)}
                    placeholder="Algo que a gente precise saber para comprar de você." />
        </div>

        {erro && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {erro}
          </div>
        )}

        <Button className="w-full" size="lg" onClick={enviar} disabled={enviando}>
          {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</> : "Enviar cadastro"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Ao enviar, os dados vão para conferência da equipe de Suprimentos.
        </p>
      </div>
    </Moldura>
  );
}

function trocaConta(
  setContas: React.Dispatch<React.SetStateAction<ContaBancariaPendente[]>>,
  i: number, campo: keyof ContaBancariaPendente, valor: string,
) {
  setContas((cs) => cs.map((c, j) => (j === i ? { ...c, [campo]: valor } : c)));
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 py-8">
      <div className="mx-auto w-full max-w-3xl px-4">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">Cadastro de fornecedor</h1>
          <p className="text-sm text-muted-foreground">Nascimento — soluções em serviços</p>
        </header>
        <Card><CardContent className="p-5 sm:p-6">{children}</CardContent></Card>
      </div>
    </div>
  );
}

function Secao({
  icone: Icone, titulo, descricao, children,
}: { icone: any; titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icone className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold leading-tight">{titulo}</h3>
          {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Grade({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

function Campo({
  rotulo, valor, onChange, placeholder, tipo,
}: { rotulo: string; valor: string; onChange: (v: string) => void; placeholder?: string; tipo?: string }) {
  return (
    <div>
      <Label className="text-xs">{rotulo}</Label>
      <Input className={cn("mt-1 h-9")} type={tipo} value={valor} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
