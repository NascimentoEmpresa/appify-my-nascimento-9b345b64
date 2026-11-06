/**
 * Caixa de e-mail de Fornecedores — o que é só desta caixa. As regras gerais
 * (endereços, sugestões, conferência antes de enviar) estão em
 * src/lib/email/caixa.ts e são reexportadas aqui para quem já importava
 * deste arquivo.
 */
import { emailValido, separarEnderecos, type SugestaoEndereco } from "@/lib/email/caixa";

export * from "@/lib/email/caixa";
export { donosDosEnderecos as fornecedoresDosEnderecos } from "@/lib/email/caixa";

export interface FornecedorComEmails {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  contato?: string | null;
  email: string | null;
  email_financeiro?: string | null;
  email_nota_fiscal?: string | null;
  cnpj_cpf?: string | null;
}

/** Todos os endereços cadastrados dos fornecedores, sem repetir. */
export function enderecosDosFornecedores(lista: FornecedorComEmails[]): SugestaoEndereco[] {
  const vistos = new Set<string>();
  const saida: SugestaoEndereco[] = [];
  for (const f of lista) {
    const nome = f.nome_fantasia || f.razao_social;
    const campos: [string | null | undefined, string][] = [
      [f.email, "Principal"],
      [f.email_financeiro, "Financeiro"],
      [f.email_nota_fiscal, "Nota fiscal"],
    ];
    for (const [valor, rotulo] of campos) {
      for (const e of separarEnderecos(valor ?? "")) {
        if (!emailValido(e)) continue;
        const chave = `${f.id}|${e}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        saida.push({ email: e, donoId: f.id, donoNome: nome, rotulo });
      }
    }
  }
  return saida;
}
