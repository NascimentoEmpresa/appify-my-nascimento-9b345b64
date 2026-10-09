import type { Chamado } from "./types";

// Compartilhado entre o Painel do Desenvolvedor (link "Abrir PR" na fila) e a
// tela Executar Chamado (botão em "Ações rápidas") — mesma URL nos dois lugares.
export const GITHUB_REPO = "NascimentoEmpresa/appify-my-nascimento-9b345b64";

const DESCRICAO_MAX_URL = 3000; // evita estourar limite prático de tamanho de URL

// Cada dev usa 1 branch pessoal fixa (não uma branch nova por chamado) — os
// nomes exatos como aparecem no GitHub. Mesma ideia de mapeamento por
// profiles.id já usada em .github/workflows/notify_discord.yml e na edge
// function chamado-vincular-pr; atualizar aqui junto quando entrar gente nova.
const DEV_ID_PARA_BRANCH_GITHUB: Record<string, string> = {
  "97260632-2f1a-44e3-9f93-58b2b1f3702c": "eduardo", // Eduardo Jeiel
  "301bfa45-d01a-4e81-abd9-18d48bccef97": "pablo",   // Pablo Flores
  "e2c4faf6-289e-4f80-a235-628c2d674f46": "joao",    // João Victor
};

// Abre a tela de criação de PR do GitHub já com título e corpo preenchidos
// (prefixo do chamado + assunto + descrição), pra ninguém precisar copiar o
// número do chamado na mão — nem escolher a branch na tela.
//
// O GitHub só mantém o título/corpo pré-preenchidos vindos da URL quando ela
// já inclui base E branch de destino (compare/main...SUABRANCH?title=...).
// Como cada dev tem uma branch pessoal fixa e conhecida, a gente já sabe qual
// é (pelo usuário logado) e monta a URL completa de primeira — zero digitação.
// Só cai no prompt manual se o dev logado não estiver no mapa acima.
export function abrirPrGithub(
  c: Pick<Chamado, "numero" | "assunto" | "descricao">,
  e: React.MouseEvent | null,
  devId: string | undefined,
  toast: (o: { title: string; description?: string }) => void,
) {
  e?.stopPropagation();
  const titulo = `${c.numero}: ${c.assunto}`;
  const descricaoBruta = c.descricao ?? "";
  const descricao = descricaoBruta.length > DESCRICAO_MAX_URL
    ? `${descricaoBruta.slice(0, DESCRICAO_MAX_URL)}\n\n…(descrição truncada — veja o restante no chamado)`
    : descricaoBruta;
  const corpo = [
    "<!-- chamado:auto:start -->",
    `**Chamado:** ${c.numero} — ${c.assunto}`,
    "",
    `**Descrição:** ${descricao || "—"}`,
    "<!-- chamado:auto:end -->",
  ].join("\n");
  const params = `?quick_pull=1&expand=1&title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corpo)}`;

  const branchConhecida = devId ? DEV_ID_PARA_BRANCH_GITHUB[devId] : undefined;
  const branch = branchConhecida ?? window.prompt(
    "Não achei sua branch cadastrada. Digite o nome dela (ex: Eduardo) — assim o título e a descrição já vêm prontos na PR:",
    "",
  )?.trim();

  if (branch) {
    const url = `https://github.com/${GITHUB_REPO}/compare/main...${encodeURIComponent(branch)}${params}`;
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  // Sem branch (nem no mapa, nem digitada): a URL não sobrevive à escolha
  // manual da branch no GitHub, então copia título+corpo como reforço.
  navigator.clipboard?.writeText(`${titulo}\n\n${corpo}`).catch(() => {});
  toast({
    title: "Título e descrição copiados",
    description: "Cole na hora de criar a PR — sem a branch eu não consigo pré-preencher automaticamente.",
  });
  window.open(`https://github.com/${GITHUB_REPO}/compare/main`, "_blank", "noopener,noreferrer");
}
