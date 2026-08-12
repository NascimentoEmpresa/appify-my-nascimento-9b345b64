// =====================================================================
// CREDENCIAIS DO SUPABASE — um lugar só, vindo do .env
//
// URL e chave anon saem de VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY em vez
// de literal no código. Ganho real: credencial fora do versionamento e
// rotação num arquivo só, em vez de caçar a string em cada cliente.
//
// O QUE ISSO NÃO FAZ — para não gerar falsa sensação de segurança:
// o Vite embute qualquer VITE_* no JavaScript final. A chave anon continua
// indo para o navegador de quem abre o ERP, porque é assim que um cliente
// Supabase funciona. Quem protege os dados é a RLS e os grants (o
// CANAL_DENUNCIA, por exemplo, tem o grant revogado do anon), nunca o sigilo
// desta chave. Se a intenção for tirar de circulação uma chave que já rodou,
// o caminho é rotacionar no painel do Supabase — trocar de lugar não basta.
//
// Faltando no ambiente, o build para (ver vite.config.ts). O erro abaixo é a
// segunda linha de defesa, para quem importar isto por fora do build.
// =====================================================================
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não estão definidas. " +
      "Copie o .env.example para .env e preencha antes de rodar o build.",
  );
}

export const SUPABASE_URL: string = url;
export const SUPABASE_ANON_KEY: string = anonKey;
