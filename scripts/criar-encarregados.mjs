// Cria as 109 contas de SIS-2026-0112/ENCARREGADOS OFICIAL.xlsx e vincula ao
// cadastro correspondente em EMPREGADOS quando possível (habilita o login por
// CPF na conta real — ver sup-ext-verificar-vinculo).
//
// A lista abaixo (nome/e-mail vindos da planilha, empregadoId/cpf/situacao
// cruzados contra EMPREGADOS por nome, via psql read-only) já resolve qual
// cadastro casa com qual pessoa — não refaz esse cruzamento em runtime.
// `vincular: false` cobre dois casos, sem tentar adivinhar:
//   - 36 pessoas só têm cadastro "Demitido" em EMPREGADOS (o próprio sistema
//     recusa vincular/logar gente desligada — admin_vincular_empregado,
//     sup_ext_casar_empregado). Conta é criada, mas fica sem login por CPF
//     até o RH regularizar o cadastro na Senior.
//   - 2 pessoas (ANDREA KRACZINSKI ROHR, EVERTON DA SILVA LOPES) não batem
//     com nenhum nome em EMPREGADOS.
//
// Uso:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/criar-encarregados.mjs
//
// Idempotente por e-mail: pula quem já existe em profiles, não tenta recriar.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente antes de rodar.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CARGO = "Encarregado Administrativa";
const SETOR = "Visitante";
const PERFIL_ENCARREGADOS_ID = "9951bb4f-b052-45ac-81d5-694f4ce0a295";

const PESSOAS = [
  { nome: "ADANCIO DOS SANTOS JUNIOR", email: "adancio.santos@gmail.com", empregadoId: 9, cpf: "070.789.019-59", situacao: "Demitido", vincular: false },
  { nome: "ANTONIO LUIS PRESSLER", email: "antonio.luis@gmail.com", empregadoId: 9423, cpf: "031.762.340-07", situacao: "Demitido", vincular: false },
  { nome: "CAMILA DOS SANTOS DE QUADROS", email: "camila.santos@gmail.com", empregadoId: 11734, cpf: "038.782.640-89", situacao: "Demitido", vincular: false },
  { nome: "CAMILA GOULART DA FONSECA", email: "camila.goulart@gmail.com", empregadoId: 9486, cpf: "029.001.770-06", situacao: "Demitido", vincular: false },
  { nome: "CAMILA SILVA DA FONTOURA", email: "camila.silva@gmail.com", empregadoId: 1200, cpf: "020.187.270-60", situacao: "Demitido", vincular: false },
  { nome: "CAROLINA TORRES CHEIS", email: "carolina.torres@gmail.com", empregadoId: 1392, cpf: "019.994.120-36", situacao: "Demitido", vincular: false },
  { nome: "CRISTINA SILVA DO CARMO", email: "cristina.silva@gmail.com", empregadoId: 1871, cpf: "821.878.860-34", situacao: "Demitido", vincular: false },
  { nome: "DANIEL DE CASTRO LEMOS", email: "daniel.castro@gmail.com", empregadoId: 11750, cpf: "822.521.060-34", situacao: "Demitido", vincular: false },
  { nome: "DIEGO SILVEIRA DOS SANTOS", email: "diego.silveira@gmail.com", empregadoId: 11759, cpf: "040.604.010-99", situacao: "Demitido", vincular: false },
  { nome: "DIERRISSON VIEIRA SANTOS", email: "dierrisson.vieira@gmail.com", empregadoId: 9790, cpf: "014.737.920-29", situacao: "Demitido", vincular: false },
  { nome: "EVA CRISTINA DE ATAIDES PRESTES", email: "eva.cristina@gmail.com", empregadoId: 2890, cpf: "612.143.020-68", situacao: "Demitido", vincular: false },
  { nome: "EVERSON LUIS PIRES DA FONSECA", email: "everson.luis@gmail.com", empregadoId: 2922, cpf: "859.587.940-00", situacao: "Demitido", vincular: false },
  { nome: "FRANCYELE LOPES TABORDA", email: "francyele.lopes@gmail.com", empregadoId: 3259, cpf: "018.938.450-60", situacao: "Demitido", vincular: false },
  { nome: "GILBERTO SAMUEL DO NASCIMENTO", email: "gilberto.samuel@gmail.com", empregadoId: 3413, cpf: "971.188.340-68", situacao: "Demitido", vincular: false },
  { nome: "GILSEIA ROSENI CASSIANA ALVES TERRIBILE", email: "gilseia.roseni@gmail.com", empregadoId: 3434, cpf: "951.057.430-91", situacao: "Demitido", vincular: false },
  { nome: "HELENA CRISTINA STHADLER DE OLIVEIRA", email: "helena.cristina@gmail.com", empregadoId: 3645, cpf: "034.020.090-13", situacao: "Demitido", vincular: false },
  { nome: "IRAJOARA SOARES CIELO", email: "irajoara.soares@gmail.com", empregadoId: 3800, cpf: "006.044.390-16", situacao: "Demitido", vincular: false },
  { nome: "JENNIFER DOS SANTOS FROIS", email: "jennifer.santos@gmail.com", empregadoId: 4144, cpf: "027.143.080-07", situacao: "Demitido", vincular: false },
  { nome: "KATIA CRISTINA DE MATTOS DUTRA", email: "katia.cristina@gmail.com", empregadoId: 4808, cpf: "008.433.950-01", situacao: "Demitido", vincular: false },
  { nome: "KATIANA PEREIRA DA COSTA", email: "katiana.pereira@gmail.com", empregadoId: 4821, cpf: "834.621.200-34", situacao: "Demitido", vincular: false },
  { nome: "LETICIA DA CUNHA FAGUNDES", email: "leticia.cunha@gmail.com", empregadoId: 11833, cpf: "015.932.370-30", situacao: "Demitido", vincular: false },
  { nome: "LUANA ROSA DA SILVA", email: "luana.rosa@gmail.com", empregadoId: 11840, cpf: "022.369.140-24", situacao: "Demitido", vincular: false },
  { nome: "LUCAS REIS FREITAS", email: "lucas.reis@gmail.com", empregadoId: 5397, cpf: "039.876.560-00", situacao: "Demitido", vincular: false },
  { nome: "MARCELO LOPES GONÇALVES", email: "marcelo.lopes@gmail.com", empregadoId: 5839, cpf: "924.690.430-34", situacao: "Demitido", vincular: false },
  { nome: "MICHELE GROTTO", email: "michele.grotto@gmail.com", empregadoId: 6593, cpf: "002.328.120-04", situacao: "Demitido", vincular: false },
  { nome: "MICHELINE MONTEIRO BARROS", email: "micheline.monteiro@gmail.com", empregadoId: 6617, cpf: "021.146.200-42", situacao: "Demitido", vincular: false },
  { nome: "MICHELLE DE CASSIA COSTA FREIRE", email: "michelle.cassia@gmail.com", empregadoId: 6620, cpf: "992.053.510-91", situacao: "Demitido", vincular: false },
  { nome: "MILENA D AVILA SALAZAR", email: "milena.avila@gmail.com", empregadoId: 12545, cpf: "841.220.560-04", situacao: "Demitido", vincular: false },
  { nome: "OSNI DE ARAUJO", email: "osni.araujo@gmail.com", empregadoId: 6997, cpf: "032.193.459-80", situacao: "Demitido", vincular: false },
  { nome: "PABLO IAGO GUAICURUS DA SILVA", email: "pablo.iago@gmail.com", empregadoId: 7021, cpf: "142.055.267-84", situacao: "Demitido", vincular: false },
  { nome: "PAULO ROBERTO RICHA MARTINS JUNIOR", email: "paulo.roberto.richa@gmail.com", empregadoId: 7237, cpf: "028.790.970-02", situacao: "Demitido", vincular: false },
  { nome: "ROSILENE CONCEICAO MUHL DA ROSA", email: "rosilene.conceicao@gmail.com", empregadoId: 11190, cpf: "577.354.920-49", situacao: "Demitido", vincular: false },
  { nome: "SANDRO DE ASSIS MARTINS", email: "sandro.assis@gmail.com", empregadoId: 8100, cpf: "000.358.810-62", situacao: "Demitido", vincular: false },
  { nome: "SEBASTIANA KELLY VIEIRA DOS SANTOS", email: "sebastiana.kelly@gmail.com", empregadoId: 11905, cpf: "014.415.972-47", situacao: "Demitido", vincular: false },
  { nome: "TATIANE REKA DE ARAUJO", email: "tatiane.reka@gmail.com", empregadoId: 8604, cpf: "846.068.190-49", situacao: "Demitido", vincular: false },
  { nome: "TIHELLY SILVEIRA BONILHA", email: "tihelly.silveira@gmail.com", empregadoId: 8754, cpf: "030.463.730-07", situacao: "Demitido", vincular: false },
  { nome: "ANDREA KRACZINSKI ROHR", email: "andrea.kraczinski@gmail.com", empregadoId: null, cpf: null, situacao: null, vincular: false },
  { nome: "EVERTON DA SILVA LOPES", email: "everton.silva@gmail.com", empregadoId: null, cpf: null, situacao: null, vincular: false },
  { nome: "ADRIANA DE SOUZA GULART", email: "adriana.souza@gmail.com", empregadoId: 73, cpf: "900.429.800-20", situacao: "Trabalhando", vincular: true },
  { nome: "ADRIANO SEIXAS DOS SANTOS", email: "adriano.seixas@gmail.com", empregadoId: 141, cpf: "013.824.000-04", situacao: "Trabalhando", vincular: true },
  { nome: "ALESSANDRA OLIVEIRA DE LACERDA", email: "alessandra.oliveira@gmail.com", empregadoId: 12109, cpf: "014.434.280-43", situacao: "Trabalhando", vincular: true },
  { nome: "ALMIR NASCIMENTO DE OLIVEIRA", email: "almir.nascimento@gmail.com", empregadoId: 394, cpf: "002.260.280-11", situacao: "Férias", vincular: true },
  { nome: "ANA PAULA PASSOS FERRAZ NOGUEIRA", email: "ana.paula@gmail.com", empregadoId: 571, cpf: "715.789.190-53", situacao: "Trabalhando", vincular: true },
  { nome: "ANDRE LOPES DA SILVA", email: "andre.lopes@gmail.com", empregadoId: 661, cpf: "819.932.930-00", situacao: "Trabalhando", vincular: true },
  { nome: "ANDRIO DA SILVA MACHADO", email: "andrio.silva@gmail.com", empregadoId: 12127, cpf: "995.128.660-72", situacao: "Trabalhando", vincular: true },
  { nome: "ANTONIO RODOLFO FERNANDES JUNIOR", email: "antonio.rodolfo@gmail.com", empregadoId: 917, cpf: "005.095.830-59", situacao: "Trabalhando", vincular: true },
  { nome: "ARISTIDES RAIMUNDO DA SILVA", email: "aristides.raimundo@gmail.com", empregadoId: 11941, cpf: "320.756.850-53", situacao: "Trabalhando", vincular: true },
  { nome: "BARBARA MARGARETE DE AZEVEDO RIBEIRO", email: "barbara.margarete@gmail.com", empregadoId: 9443, cpf: "959.009.340-04", situacao: "Trabalhando", vincular: true },
  { nome: "BARBARA PATRICIA MARQUES ACOSTA", email: "barbara.patricia@gmail.com", empregadoId: 9444, cpf: "703.031.500-68", situacao: "Trabalhando", vincular: true },
  { nome: "BIANCA BENITES CARVALHO", email: "bianca.benites@gmail.com", empregadoId: 1040, cpf: "064.632.130-71", situacao: "Trabalhando", vincular: true },
  { nome: "BRUNA COSTA RODRIGUES DA SILVA", email: "bruna.costa@gmail.com", empregadoId: 1084, cpf: "834.695.750-53", situacao: "Trabalhando", vincular: true },
  { nome: "CARLA RAMOS GOULARTE", email: "carla.ramos@gmail.com", empregadoId: 11573, cpf: "687.149.040-04", situacao: "Férias", vincular: true },
  { nome: "CARLOS AUGUSTO BRUNING STRASSBURGER", email: "carlos.augusto@gmail.com", empregadoId: 1309, cpf: "901.298.140-91", situacao: "Trabalhando", vincular: true },
  { nome: "CATIA CILENE SAN MARTIN", email: "catia.cilene@gmail.com", empregadoId: 9539, cpf: "583.937.570-53", situacao: "Férias", vincular: true },
  { nome: "CLAUDIO RENE DA SILVA BUENO", email: "claudio.rene@gmail.com", empregadoId: 9632, cpf: "639.726.110-72", situacao: "Trabalhando", vincular: true },
  { nome: "CLOVIS ISMAR FLORES GASPAR", email: "clovis.ismar@gmail.com", empregadoId: 1763, cpf: "290.431.310-91", situacao: "Férias", vincular: true },
  { nome: "CRISTINE LIMA ASSUNCAO", email: "cristine.lima@gmail.com", empregadoId: 1874, cpf: "020.267.000-79", situacao: "Trabalhando", vincular: true },
  { nome: "DAIANA AUGUSTIN", email: "daiana.augustin@gmail.com", empregadoId: 1889, cpf: "047.698.099-21", situacao: "Trabalhando", vincular: true },
  { nome: "DAIANA KLEIN DE OLIVEIRA", email: "daiana.klein@gmail.com", empregadoId: 1897, cpf: "029.501.430-08", situacao: "Trabalhando", vincular: true },
  { nome: "DANIELA GOULART KRUEL", email: "daniela.goulart@gmail.com", empregadoId: 2027, cpf: "031.409.390-78", situacao: "Férias", vincular: true },
  { nome: "DEIVID RODRIGUES MACHADO", email: "deivid.rodrigues@gmail.com", empregadoId: 2188, cpf: "811.642.970-15", situacao: "Trabalhando", vincular: true },
  { nome: "EDERSON DA SILVA HOMEM", email: "ederson.silva@gmail.com", empregadoId: 2420, cpf: "002.785.030-71", situacao: "Trabalhando", vincular: true },
  { nome: "EDISON SANTOS GARCIA", email: "edison.santos@gmail.com", empregadoId: 2450, cpf: "026.138.020-65", situacao: "Auxílio Doença", vincular: true },
  { nome: "EDUARDA DOS SANTOS", email: "eduarda.santos@gmail.com", empregadoId: 11762, cpf: "040.392.870-29", situacao: "Trabalhando", vincular: true },
  { nome: "ELAINE CRISTINA JOSEFI", email: "elaine.cristina@gmail.com", empregadoId: 2525, cpf: "064.686.879-93", situacao: "Trabalhando", vincular: true },
  { nome: "EMERSON MATHEUS SILVA DE LIMA", email: "emerson.matheus@gmail.com", empregadoId: 2804, cpf: "040.618.160-80", situacao: "Trabalhando", vincular: true },
  { nome: "FABIANA DA SILVA BENTO", email: "fabiana.silva@gmail.com", empregadoId: 2955, cpf: "911.606.000-82", situacao: "Trabalhando", vincular: true },
  { nome: "FERNANDA BANALETTI CAZAROTTO", email: "fernanda.banaletti@gmail.com", empregadoId: 3096, cpf: "029.707.090-82", situacao: "Trabalhando", vincular: true },
  { nome: "FLAVIO LUIS CASTRO ATHAYDE", email: "flavio.luis@gmail.com", empregadoId: 3191, cpf: "002.303.110-75", situacao: "Férias", vincular: true },
  { nome: "GILSON SOLEIMAR LOPES DE OLIVEIRA", email: "gilson.soleimar@gmail.com", empregadoId: 3438, cpf: "584.708.160-04", situacao: "Trabalhando", vincular: true },
  { nome: "HELENA EICHENBERG FURASTE", email: "helena.eichenberg@gmail.com", empregadoId: 3650, cpf: "002.134.870-71", situacao: "Trabalhando", vincular: true },
  { nome: "IDALECIO CARDOSO COSTA", email: "idalecio.cardoso@gmail.com", empregadoId: 3724, cpf: "195.830.442-53", situacao: "Trabalhando", vincular: true },
  { nome: "INACI DUTRA NEVES", email: "inaci.dutra@gmail.com", empregadoId: 3747, cpf: "805.885.810-20", situacao: "Trabalhando", vincular: true },
  { nome: "ITAMAR PEREIRA DA SILVA", email: "itamar.pereira@gmail.com", empregadoId: 3862, cpf: "351.880.300-04", situacao: "Trabalhando", vincular: true },
  { nome: "JANAINA BARBOSA RODRIGUES", email: "janaina.barbosa@gmail.com", empregadoId: 12721, cpf: "923.725.540-34", situacao: "Trabalhando", vincular: true },
  { nome: "JHONNY FRIEDRICH DE ALMEIDA", email: "jhonny.friedrich@gmail.com", empregadoId: 4236, cpf: "019.994.410-52", situacao: "Trabalhando", vincular: true },
  { nome: "JOHNNY HENRIQUE WEISHEIMER ARAUJO", email: "johnny.henrique@gmail.com", empregadoId: 4353, cpf: "022.414.920-27", situacao: "Trabalhando", vincular: true },
  { nome: "JORGE LEANDRO MIRANDA ROCHA", email: "jorge.leandro@gmail.com", empregadoId: 10346, cpf: "006.568.160-66", situacao: "Trabalhando", vincular: true },
  { nome: "JOSE LUIZ CARDOSO", email: "jose.luiz@gmail.com", empregadoId: 12399, cpf: "741.172.970-15", situacao: "Trabalhando", vincular: true },
  { nome: "JOSE MILTON SOARES MARTINS", email: "jose.milton@gmail.com", empregadoId: 4481, cpf: "005.458.430-22", situacao: "Trabalhando", vincular: true },
  { nome: "LAINE NIENOV KREMER", email: "laine.nienov@gmail.com", empregadoId: 4950, cpf: "036.140.790-40", situacao: "Trabalhando", vincular: true },
  { nome: "LIZIA RODRIGUES LEMOS DEL OLMO", email: "lizia.rodrigues@gmail.com", empregadoId: 5269, cpf: "000.980.380-79", situacao: "Trabalhando", vincular: true },
  { nome: "LUCIA ANDREIA SALDANHA NUNES", email: "lucia.andreia@gmail.com", empregadoId: 5418, cpf: "929.940.080-68", situacao: "Trabalhando", vincular: true },
  { nome: "LUCIANO DA SILVA ALENCASTRO", email: "luciano.silva@gmail.com", empregadoId: 5507, cpf: "036.261.980-81", situacao: "Trabalhando", vincular: true },
  { nome: "LUCIOMAR DUARTE", email: "luciomar.duarte@gmail.com", empregadoId: 5556, cpf: "764.473.240-34", situacao: "Trabalhando", vincular: true },
  { nome: "LUIDGI GIOVANE DUARTE", email: "luidgi.giovane@gmail.com", empregadoId: 5558, cpf: "014.902.400-20", situacao: "Trabalhando", vincular: true },
  { nome: "LUIS AUGUSTO DA SILVA DE OLIVEIRA", email: "luis.augusto@gmail.com", empregadoId: 5567, cpf: "841.555.070-72", situacao: "Trabalhando", vincular: true },
  { nome: "MAGDA HERMINIA SOARES PRATES", email: "magda.herminia@gmail.com", empregadoId: 5712, cpf: "553.505.340-68", situacao: "Trabalhando", vincular: true },
  { nome: "MARCELO PELISSON RODRIGUES", email: "marcelo.pelisson@gmail.com", empregadoId: 5843, cpf: "004.576.430-13", situacao: "Trabalhando", vincular: true },
  { nome: "MARILEI FALKOSKI PAWELKIEWICZ", email: "marilei.falkoski@gmail.com", empregadoId: 6295, cpf: "024.113.210-07", situacao: "Trabalhando", vincular: true },
  { nome: "MICHELE ROSA CELLAS", email: "michele.rosa@gmail.com", empregadoId: 11867, cpf: "933.458.010-00", situacao: "Trabalhando", vincular: true },
  { nome: "OSMAR DA SILVA CABRAL", email: "osmar.silva@gmail.com", empregadoId: 6990, cpf: "955.080.900-53", situacao: "Trabalhando", vincular: true },
  { nome: "PATRICIA ANDREIA DE OLIVEIRA", email: "patricia.andreia@gmail.com", empregadoId: 7067, cpf: "956.688.370-68", situacao: "Trabalhando", vincular: true },
  { nome: "PAULA JULIANA PEDROSO RAINEL", email: "paula.juliana@gmail.com", empregadoId: 7161, cpf: "008.093.470-67", situacao: "Trabalhando", vincular: true },
  { nome: "PAULA THAUANA DA SILVA", email: "paula.thauana@gmail.com", empregadoId: 7175, cpf: "850.186.350-53", situacao: "Licença Maternidade", vincular: true },
  { nome: "PAULO ROBERTO CUNHA DA SILVA", email: "paulo.roberto@gmail.com", empregadoId: 7229, cpf: "977.852.700-82", situacao: "Trabalhando", vincular: true },
  { nome: "PAULO TEXEIRA", email: "paulo.texeira@gmail.com", empregadoId: 7249, cpf: "556.006.890-04", situacao: "Trabalhando", vincular: true },
  { nome: "RAQUEL SILVA DA COSTA", email: "raquel.silva@gmail.com", empregadoId: 7468, cpf: "724.616.670-04", situacao: "Trabalhando", vincular: true },
  { nome: "ROBERTA FRANZEN PATACHO", email: "roberta.franzen@gmail.com", empregadoId: 7624, cpf: "928.535.600-15", situacao: "Trabalhando", vincular: true },
  { nome: "ROSANE TERESINHA DE OLIVEIRA", email: "rosane.teresinha@gmail.com", empregadoId: 7786, cpf: "520.717.070-87", situacao: "Trabalhando", vincular: true },
  { nome: "ROSELAINE PEREIRA DE FREITAS", email: "roselaine.pereira@gmail.com", empregadoId: 7863, cpf: "764.159.880-34", situacao: "Atestado (dias)", vincular: true },
  { nome: "SABRINA SOARES FAGUNDES", email: "sabrina.soares@gmail.com", empregadoId: 12761, cpf: "022.339.800-42", situacao: "Trabalhando", vincular: true },
  { nome: "SHARI CAMILA DOS SANTOS ALVES", email: "shari.camila@gmail.com", empregadoId: 12051, cpf: "857.695.410-91", situacao: "Trabalhando", vincular: true },
  { nome: "SHIRLEY MARTA DA SILVA", email: "shirley.marta@gmail.com", empregadoId: 8176, cpf: "872.216.910-53", situacao: "Trabalhando", vincular: true },
  { nome: "SUELEM ROCHA GONCALVES", email: "suelem.rocha@gmail.com", empregadoId: 8407, cpf: "023.818.300-90", situacao: "Trabalhando", vincular: true },
  { nome: "TALITA DA SILVA GOUVEA", email: "talita.silva@gmail.com", empregadoId: 8503, cpf: "989.848.530-20", situacao: "Trabalhando", vincular: true },
  { nome: "TANARA DA SILVA BRAGA", email: "tanara.silva@gmail.com", empregadoId: 8526, cpf: "019.402.200-50", situacao: "Trabalhando", vincular: true },
  { nome: "VINICIUS AZEREDO DOS SANTOS", email: "vinicius.azeredo@gmail.com", empregadoId: 8987, cpf: "043.961.420-13", situacao: "Trabalhando", vincular: true },
  { nome: "VOLTAIR CHIESA", email: "voltair.chiesa@gmail.com", empregadoId: 9081, cpf: "747.865.470-34", situacao: "Trabalhando", vincular: true },
];

function gerarSenha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function main() {
  const relatorio = { criados: [], jaExistiam: [], semVinculo: [], erros: [] };

  for (const pessoa of PESSOAS) {
    const email = pessoa.email.trim().toLowerCase();

    const { data: existente } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (existente) {
      relatorio.jaExistiam.push(email);
      continue;
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: gerarSenha(),
      email_confirm: true,
      user_metadata: { display_name: pessoa.nome },
    });
    if (createErr || !created?.user) {
      relatorio.erros.push({ email, erro: createErr?.message ?? "falha desconhecida" });
      continue;
    }
    const newUserId = created.user.id;

    // on_auth_user_created já criou profiles + user_roles('visitante') — isto
    // é UPDATE de verdade, mesmo padrão do admin-create-user/index.ts.
    const { error: profileErr } = await admin.from("profiles").upsert({
      id: newUserId,
      email,
      display_name: pessoa.nome,
      cargo: CARGO,
      empresa_id: null,
      must_change_password: true,
      ativo: true,
    }, { onConflict: "id" });
    if (profileErr) {
      relatorio.erros.push({ email, erro: `profiles: ${profileErr.message}` });
      continue;
    }

    await admin.from("user_roles").delete().eq("user_id", newUserId);
    await admin.from("user_roles").insert({ user_id: newUserId, role: "usuario" });

    await admin.from("user_setor").insert({ user_id: newUserId, setor: SETOR });

    await admin.from("usuario_perfil_acesso").insert({ user_id: newUserId, perfil_id: PERFIL_ENCARREGADOS_ID });

    if (pessoa.vincular && pessoa.empregadoId) {
      // Mesma escrita que admin_vincular_empregado (RPC) faz — reproduzida
      // direto porque o script já roda com service role, sem sessão de admin
      // pra satisfazer o can_access(...) que a RPC exige.
      const { error: vincErr } = await admin
        .from("EMPREGADOS")
        .update({ auth_user_id: newUserId, email })
        .eq("ID", pessoa.empregadoId)
        .is("auth_user_id", null);
      if (vincErr) {
        relatorio.erros.push({ email, erro: `vincular EMPREGADOS: ${vincErr.message}` });
      }
    } else {
      relatorio.semVinculo.push({ nome: pessoa.nome, email, motivo: pessoa.situacao ? `EMPREGADOS só com situação "${pessoa.situacao}"` : "nome não encontrado em EMPREGADOS" });
    }

    relatorio.criados.push(email);
    console.log(`✓ ${pessoa.nome} <${email}>${pessoa.vincular ? " (vinculado a EMPREGADOS)" : " (SEM vínculo)"}`);
  }

  console.log("\n=== Resumo ===");
  console.log(`Criados: ${relatorio.criados.length}`);
  console.log(`Já existiam (pulados): ${relatorio.jaExistiam.length}`);
  console.log(`Erros: ${relatorio.erros.length}`);
  if (relatorio.erros.length) console.log(JSON.stringify(relatorio.erros, null, 2));
  console.log(`\nSem vínculo automático com EMPREGADOS (${relatorio.semVinculo.length}) — login por CPF não vai funcionar até resolver:`);
  relatorio.semVinculo.forEach((p) => console.log(`  - ${p.nome} <${p.email}> — ${p.motivo}`));
}

main().catch((e) => {
  console.error("Falha geral:", e);
  process.exit(1);
});
