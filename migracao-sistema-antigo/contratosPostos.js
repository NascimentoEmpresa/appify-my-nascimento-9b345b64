// Copiado do repositório do sistema antigo (Render/Vercel) em 17/08/2026.
// É a ÚNICA origem dos contratos e postos reais: eles não existem em tabela
// nenhuma do banco antigo — `pedidos_site_externo.contrato` e `.posto` são
// texto livre digitado a partir desta lista.
const CONTRATOS_POSTOS = [
  {
    "contrato": "ADMINISTRATIVO ESCRITÓRIO",
    "postos": [
      "ADM"
    ]
  },
  {
    "contrato": "UFRGS - ASB - 033 2021",
    "postos": [
      "UFRGS - AUXILIAR DE SAUDE BUCAL"
    ]
  },
  {
    "contrato": "UFRGS CARREGADORES - 095.2024",
    "postos": [
      "UFRGS-CARREGADORES-CAMPUS CENTRO-095",
      "UFRGS-CARREGADORES-CAMPUS VALE-095",
      "UFRGS-CARREGADORES-LITORAL-095",
      "UFRGS-CARREGADORES-SAUDE-095"
    ]
  },
  {
    "contrato": "UFRGS - JARDINAGEM - 062 2025",
    "postos": [
      "UFRGS-AGRONOMIA-062",
      "UFRGS-CAMPUS SAUDE-062",
      "UFRGS-CAMPUS VALE-062",
      "UFRGS-CENTRO-062",
      "UFRGS-ELDORADO-062",
      "UFRGS-ESEFID-062",
      "UFRGS-LITORAL-062"
    ]
  },
  {
    "contrato": "UFRGS - MOTORISTAS - 034 2022",
    "postos": [
      "UFRGS-DITRAN-MOTORISTAS -034",
      "UFRGS-ELDORADO-MOTORISTAS-034",
      "UFRGS-FROTA-MOTORISTAS -034",
      "UFRGS-LITORAL-MOTORISTAS-034",
      "UFRGS-SUINFRA-MOTORISTAS -034"
    ]
  },
  {
    "contrato": "UFRGS-LIMPEZA -020 2022",
    "postos": [
      "HCVET-020",
      "LIMPEZA HOSPITALAR ODONTO-020"
    ]
  },
  {
    "contrato": "UFRGS-LIMPEZA GERAL- 047 2022",
    "postos": [
      "UFRGS-AGRONOMIA-047",
      "UFRGS-CAMPUS SAUDE-047",
      "UFRGS-CAMPUS VALE/IPH-047",
      "UFRGS-CENTRO- 1-047",
      "UFRGS-CENTRO-2-047",
      "UFRGS-ELDORADO-047",
      "UFRGS-ESEFID-047",
      "UFRGS-LITORAL-047",
      "UFRGS-SETOR-4-047",
      "UFRGS-VALE/PREFEITURA-047",
      "UFRGS-VALE/VETERINARIA-047"
    ]
  },
  {
    "contrato": "UFRGS-COPA E COZINHA - 025 2025",
    "postos": [
      "UFRGS-CENTRO-025",
      "UFRGS-ELDORADO-025",
      "UFRGS-LITORAL-025",
      "UFRGS-VALE-025"
    ]
  },
  {
    "contrato": "UFFS - 041.2021",
    "postos": [
      "UFFS - CERRO LARGO 041 2021",
      "UFFS - CHAPECÓ 041 2021",
      "UFFS - ERECHIM 041 2021",
      "UFFS - LARANJEIRAS 041 2021",
      "UFFS - PASSO FUNDO 041 2021",
      "UFFS - REALEZA 041 2021"
    ]
  },
  {
    "contrato": "CAMARA DE RIO GRANDE - PORTARIA - 002.2023",
    "postos": [
      "CAMARA DE VEREADORES DE RIO GRANDE"
    ]
  },
  {
    "contrato": "FURG PORTARIA - 55 2023",
    "postos": [
      "FURG RIO GRANDE"
    ]
  },
  {
    "contrato": "DMAE 895",
    "postos": [
      "PORTARIA DA DIREÇÃO GERAL DG 1",
      "PORTARIA DA DIREÇÃO GERAL DG 2",
      "PORTARIA DA DIRETORIA ADMINISTRATIVA DA",
      "PORTARIA DO PROTOCOLO",
      "TORRE (APOIO)",
      "GALERIA DE ARTES",
      "PORTARIA DE EQ-SAUDE",
      "PORTARIA DA GLIC",
      "PORTARIA DA GMAN",
      "PORTARIA DA GMAN-2(APOIO 1)",
      "PORTARIA DA C-MERCADO (APOIO 2)",
      "PORTARIA DA GDCE",
      "PORTARIA DA GCON/C-LEITURA",
      "PORTARIA DA GEPO",
      "PORTARIA DA CENTRAL DE VEICULOS",
      "PORTARIA DE GCON / C-MICROM",
      "PORTARIA DA GDCO",
      "PORTARIA DA GSUP",
      "PORTARIA DA GTAG",
      "PORTARIA DA GDLE",
      "PORTARIA DO POSTO ATEND. AO CLIENTE CENTRO 1",
      "PORTARIA DO POSTO ATEND. AO CLIENTE CENTRO 2",
      "PORTARIA DO POSTO ATEND. AO CLIENTE CENTRO 3",
      "PORTARIA DO POSTO ATEND. AO CLIENTE PARTENON",
      "PORTARIA DO MIRANTE / EBE C-2"
    ]
  },
  {
    "contrato": "HOSPITAL SÃO CAMILO - 50163.2025",
    "postos": [
      "HOSPITAL SÃO CAMILO"
    ]
  },
  {
    "contrato": "PREF POA SMS RECEPÇÃO - 98672.2025",
    "postos": [
      "SAE IAPI",
      "PRONTO ATENDIMENTO CRUZEIRO DO SUL",
      "DIRETORIA GERAL DE VIGILÂNCIA EM SAÚDE",
      "HPS",
      "AE IAPI",
      "US MODELO",
      "US IAPI E CEO ODONTO IAPI",
      "HOSPITAL MATERNO INFANTIL PRESIDENTE VARGAS",
      "AE SANTA MARTA",
      "US BELÉM NOVO",
      "Prédio Sede",
      "EESCA Santa Marta",
      "CEO BOM JESUS",
      "SAE SANTA MARTA",
      "US CAMAQUÃ",
      "Clinica da familia IPAI",
      "ESMA Altos da Glória",
      "AE VILA DOS COMERCIARIOS",
      "SAE PLP",
      "EESCA Assis Brasil",
      "CELME",
      "CS OESTE",
      "AE Murialdo",
      "EESCA Vila Jardim",
      "SAE Vila dos comerciários",
      "US BANANEIRAS",
      "Farmácia Distrital Bom jesus",
      "ESMA Camaquã",
      "ESMA RESTINGA",
      "CAPSi Harmonia",
      "CAPS A CENTRO",
      "ESMA IAPI",
      "Farmácia Distrital Murialdo",
      "CAPS AD GCC",
      "Farmácia Distrital Modelo",
      "FARMÁCIA DISTRITAL CAMAQUÃ",
      "ESMA Morro Santana",
      "CAPSA Flor de Maio",
      "EESCA NAVEGANTES",
      "FARMÁCIA DISTRITAL IAPI",
      "EESCA CAMAQUA",
      "ESMA TOBIAS BARRETO",
      "CS LESTE",
      "CRTB CENTRO e CRAIP",
      "ESMA ASSIS BRASIL",
      "Farmácia Distrital Santa Marta",
      "Farmácia Distrital Sarandi"
    ]
  },
  {
    "contrato": "SEC CULT POA - PORT-88123 2024",
    "postos": [
      "SECRETARIA DE CULTURA DE PORTO ALEGRE"
    ]
  },
  {
    "contrato": "BENTO GONÇALVES A.ADM 002 2021",
    "postos": [
      "UPA"
    ]
  },
  {
    "contrato": "BENTO GONÇALVES LIMPEZA 0672019",
    "postos": [
      "ESF APARECIDA",
      "ESF BARRACÃO",
      "ESF LICORSUL",
      "ESF VILA NOVA - VILA NOVA II",
      "ESF ZATT",
      "ESF PROGRESSO II/CVI",
      "UBS ZONA SUL",
      "US COHAB",
      "CEO/SAMU/ALMOX",
      "TRANSP/VIGIL/SAD/MANUT",
      "CAPS II",
      "CAPS AD",
      "CAPS I",
      "BLOCO CIRURGICO",
      "ESF OURO VERDE",
      "RX/FARMACIA",
      "LAVANDERIA",
      "PA ZONA NORTE",
      "UPA 24 H",
      "SAMU - LABORATÓRIO - RADIOLOGIA",
      "SAE/CTA",
      "ESPECIALIDADES",
      "FERISTA SEG/SEX",
      "FERISTA 12X36 NOITE"
    ]
  },
  {
    "contrato": "TRIUNFO VIGIAS - 33 2024",
    "postos": [
      "ABRIGO",
      "ADM",
      "CAMBOATA",
      "CANIL",
      "CRAS",
      "DISTRITO",
      "DOCE MEL",
      "E.M.E.F ALMIRANTE",
      "E.M.E.F CANDIDO",
      "E.M.E.F CORPO SANTO",
      "E.M.E.F FARROPILHA",
      "E.M.E.F GENEROSO",
      "E.M.E.F GONCALVES DIAS",
      "E.M.E.F JOSUE",
      "E.M.E.F LIBERATO",
      "E.M.E.F MANOEL KUHN",
      "E.M.E.F MEIRELES",
      "E.M.E.F OSVALDO",
      "E.M.E.F RAMBOR",
      "E.M.E.F SERAFIM",
      "E.M.E.F TRISTÃO",
      "E.M.E.I ALY POETA",
      "E.M.E.I AMOR PERFEITO",
      "E.M.E.I CRIANÇA FELIZ",
      "E.M.E.I ENCANTADO",
      "E.M.E.I FANTASIA",
      "E.M.E.I MARIA TEREZINHA",
      "E.M.E.I MUNDO ENCANTADO",
      "E.M.E.I MUNDO FANTASIA",
      "E.M.E.I OTAVIO QUADROS",
      "E.M.E.I PINGO DE GENTE",
      "E.M.E.I TERESINHA",
      "ESTUFA/AGRICULTURA",
      "GARAGEM COXILHA",
      "GARAGEM PASSO RASO",
      "GINASIO BARRETO",
      "GINASIO CENTRO",
      "GINASIO COXILHA",
      "GINASIO PORTO",
      "POSTÃO",
      "QUADRA SERAFIM",
      "SEC OBRAS",
      "SECRETARIA EDUCAÇÃO",
      "UBS CATUPI",
      "VIAÇÃO"
    ]
  },
  {
    "contrato": "FURG JARDINAGEM 049 2022",
    "postos": [
      "FURG RIO GRANDE"
    ]
  },
  {
    "contrato": "SEMAE - 3038.2020",
    "postos": [
      "SEMAE - CENTRO ADM - 3038 2020",
      "SEMAE - DIV. OBRAS - 3038 2020",
      "SEMAE - ETA 1 - 3038 2020",
      "SEMAE - ETA 2 - 3038 2020",
      "SEMAE - ETE VICENT. - 3038 2020",
      "SEMAE - RESERV R1 - 3038 2020",
      "SEMAE - ZONA LESTE - 3038 2020"
    ]
  },
  {
    "contrato": "IPAM - 012 2022",
    "postos": [
      "IPAM"
    ]
  },
  {
    "contrato": "IPASEM - 13 2022",
    "postos": [
      "IPASEM - PREDIO ANTIGO",
      "IPASEM - PREDIO NOVO"
    ]
  },
  {
    "contrato": "FURG HU - 006 2023",
    "postos": [
      "FURG HU RIO GRANDE"
    ]
  },
  {
    "contrato": "CANAÃ",
    "postos": [
      "ESCOLA CANAÃ"
    ]
  },
  {
    "contrato": "TRIUNFO MOTORISTAS 213 2025",
    "postos": [
      "SECRETARIA DE SAUDE",
      "PREFEITURA"
    ]
  },
  {
    "contrato": "TRIUNFO OP.MÁQUINAS 19 2026",
    "postos": [
      "SECRETARIA VENDINHA",
      "SECRATRIA VIAÇÃO",
      "SECRETARIA DE OBRAS"
    ]
  },
  {
    "contrato": "CHARQUEADAS - 005 2021",
    "postos": [
      "PREFEITURA",
      "SEC OBRAS",
      "CRAS",
      "SERVIÇOS URBANOS",
      "SAUDE"
    ]
  },
  {
    "contrato": "CHARQUEADAS - 168 2021",
    "postos": [
      "EMEI MARIA DO CARMO",
      "ESCOLA PIO",
      "ESCOLA SÃO MIGUEL",
      "EMEI CRIANÇA FELIZ",
      "ESCOLA MARIA DE LOURDES",
      "EMEI TIA FILO",
      "EMEI SANTA BARBARA",
      "ESCOLA OTAVIO LAZARO",
      "ESCOLA NEI BERBIGIER",
      "ESCOLA OTAVIO REIS",
      "ESCOLA GUAIBA CITY",
      "EMEI FLORA"
    ]
  },
  {
    "contrato": "CHARQUEADAS - 249 2020",
    "postos": [
      "PREFEITURA",
      "AGRICULTURA",
      "SERVIÇOS URBANOS",
      "ASSISTENCIA SOCIAL",
      "BIBLIOTECA",
      "VIGILANCIA SANITARIA",
      "UBS SUL AMERICA",
      "UBS PIRATINI 1",
      "UBS PIRATINI",
      "UBS BEIRA RIO",
      "UBS VILA OTILIA",
      "UBS CRUZ DE MALTA",
      "UBS SÃO MIGUEL",
      "SECRETARIA DE SAUDE",
      "UBS OSMAR WIENK",
      "CAPS",
      "UBS SÃO FRANCISCO",
      "UBS VICENTE PINTO"
    ]
  },
  {
    "contrato": "CANOINHAS - EMBRAPA",
    "postos": [
      "CANOINHAS - EMBRAPA"
    ]
  },
  {
    "contrato": "EMBRAPA - 93 2021",
    "postos": [
      "EMBRAPA PELOTAS"
    ]
  },
  {
    "contrato": "HCPA MENSAGEIROS - 1249781.2024",
    "postos": [
      "HOSPITAL DE CLINICAS"
    ]
  },
  {
    "contrato": "SAMU TELEFONISTAS- 96397.2025",
    "postos": [
      "SAMU PORTO ALEGRE"
    ]
  },
  {
    "contrato": "PENHA LIMPEZA - 039.2025",
    "postos": [
      "SECRETARIA DE SAÚDE",
      "ALMOXARIFADO DA SAUDE",
      "UNIDADE BASICA DE SAUDE",
      "CEFIR CENTRO DE FISIOTERAPIA E REABILITAÇÃO",
      "UNIDADE BASICA DE SAÚDE DO MARISCAL",
      "UNIDADE BASICA DE SAÚDE DA COAHB",
      "UNIDADE BASICA DE SAÚDE NOSSA SRA DE FATIMA",
      "UNIDADE BASICA DE SAÚDE DE ARMAÇÃO",
      "UNIDADE BASICA DE SAÚDE DE GRAVATÁ",
      "UNIDADE BASICA DE SAÚDE DE SANTA LIDIA",
      "UNIDADE BASICA DE SAÚDE DE SÃO CRISTOVÃO",
      "POLICLINICA MUNICIPAL",
      "CAPS LEILA ANTÃO",
      "PRONTO ATENDIMENTO 24 HORAS",
      "FARMÁCIA MUNICIPAL",
      "FARMÁCIA POLO 2 (ANEXO Á POLICLINICA MUNICIPAL)"
    ]
  },
  {
    "contrato": "TJRS - 023.2025",
    "postos": [
      "TJRS - 1",
      "TJRS - 2"
    ]
  },
  {
    "contrato": "C.RIO GRANDE-LIMPEZA 001 2023",
    "postos": [
      "CAMARA DE VEREADORES DE RIO GRANDE"
    ]
  },
  {
    "contrato": "VERANÓPOLIS - 001 2021",
    "postos": [
      "SECRETARIA DESENVOLVIMENTO SOCIAL E DEPÓSITO, CRAS",
      "CENTRO DE CONVIVÊNCIA IVO ZANELLA",
      "SALA DO CREAS (CENTRO REFERÊNCIA ESPECIALIZADA EM ASSISTÊNCIA)",
      "CONSELHO TUTELAR, COMDICA",
      "SEC. DESENVOLVIMENTO ECONÔMICO - CASA DA CIDADANIA, COMPREENDENDO: CENTRO DE INCLUSÃO SOCIAL E RENDA (SINE), JUNTA DE SERVIÇO MILITAR E POSTO DE IDENTIFICAÇÃO",
      "PRÉDIO DA EMATER",
      "SERVIÇO NACIONAL DE APRENDIZAGEM INDUSTRIAL (SENAI)",
      "EMEF FELIPE DOS SANTOS",
      "EMEF SENADOR ALBERTO PASQUALINI",
      "EMEF IRMÃO ARTUR FRANCISCO",
      "EMEF IRMÃO JERÔNIMO",
      "EMEF ADRIANO FARINA",
      "EMEF IRMÃ JOANA AIMÉ",
      "EMEI IRMÃ LAURA",
      "EMEI IRMÃ CARMELITA",
      "EMEI ANITA DALL'AGNOL AMANTINO",
      "EMEI HILDA HOFFMANN PERUFFO",
      "SECRETARIA MUNICIPAL DE EDUCAÇÃO, ESPORTES, LAZER E JUVENTUDE, NUTRA E PRADIES",
      "UNIDADE CENTRAL DE SAÚDE E SECRETARIA MUNICIPAL DE SAÚDE",
      "UNIDADE DO POSTO DE ESTRATÉGIA DE SAÚDE DA FAMÍLIA DO BAIRRO SANTO ANTÔNIO",
      "UNIDADE DO POSTO DE ESTRATÉGIA DE SAÚDE DA FAMÍLIA DO BAIRRO SÃO FRANCISCO",
      "UNIDADE DO POSTO DE ESTRATÉGIA DE SAÚDE DA FAMÍLIA DO BAIRRO MEDIANEIRA",
      "UNIDADE DO POSTO DE ESTRATÉGIA DE SAÚDE DA FAMÍLIA DO BAIRRO RENOVAÇÃO",
      "UNIDADE DO POSTO DE ESTRATÉGIA DE SAÚDE DA FAMÍLIA DO BAIRRO UNIVERSAL",
      "CAPS (CENTRO DE ATENÇÃO PSICOSSOCIAL)",
      "FARMÁCIA BÁSICA CENTRAL",
      "CASA DA CULTURA, SALAS DE OFICINAS, SALÃO NOBRE, PALCO E CAMAROTES",
      "CASA SARETTA",
      "SALA DA ORQUESTRA E TEATRO",
      "PONTOS TURÍSTICOS",
      "BIBLIOTECA PÚBLICA MUNICIPAL MANSUETO BERNARDI E SALA DE PEQUENOS EVENTOS",
      "POSTO DA RECEITA FEDERAL",
      "CÂMARA MUNICIPAL DE VEREADORES",
      "OFICINA DA MUNICIPALIDADE",
      "PRAÇA XV DE NOVEMBRO",
      "PRAÇA DA GRUTA",
      "CORPO DE BOMBEIROS",
      "CENTRO ADMINISTRATIVO PREFEITO SAUL IRINEU FARINA",
      "SECRETARIA DE EDUCAÇÃO, ESPORTES, LAZER E JUVENTUDE",
      "GINÁSIO MUNICIPAL LEONIR ANTÔNIO FARINA E A FEMAÇÃ",
      "PARQUE MUNICIPAL DE ESPORTES E EXPOSIÇÕES JOSÉ BIN (GINÁSIO MUNICIPAL LEONIR ANTÔNIO FARINA E A FEMAÇÃ)"
    ]
  },
  {
    "contrato": "CAXIAS DO SUL - 162 2025",
    "postos": [
      "ALÔ CAXIAS",
      "CENTRAL TELEFONICA",
      "RECEPÇÃO",
      "CANCELAS",
      "SEDE",
      "CAT PRAÇAS",
      "CAT AEROPORTO"
    ]
  },
  {
    "contrato": "FUNARBE PELOTAS - 58164.2025",
    "postos": [
      "FUNARBE PELOTAS"
    ]
  },
  {
    "contrato": "SALTO DO JACUI - 722 2021",
    "postos": [
      "SECRETARIA DE TRABALHO E AÇÃO SOCIAL",
      "SECRETARIA DE TURISMO",
      "SECRETARIA DE OBRAS",
      "SECRETARIA DE EDUCAÇÃO",
      "SECRETARIA DE SAUDE",
      "SECRETARIA DE ADMINISTRAÇÃO"
    ]
  },
  {
    "contrato": "HUSM - LAVANDERIA - 20 2021",
    "postos": [
      "HUSM - RIO GRANDE"
    ]
  },
  {
    "contrato": "POLÍCIA CIVIL RS LIMPEZA - 066/2026",
    "postos": [
      "PALÁCIO DA POLÍCIA",
      "CHEFIA DE POLÍCIA",
      "2º DEAM",
      "COGEPOL",
      "DENARC",
      "DERCC",
      "DEIC/SED",
      "CORE/HANGAR",
      "ACADEPOL/LINHA DE TIRO",
      "DECA",
      "DECA 3ª DPCA",
      "SEMAT/DMP/DAP",
      "DEPÓSITO//DMP/DAP",
      "DPTUR",
      "DRTC",
      "DPCI",
      "ACADEPOL/DAP",
      "CIDADE DA POLÍCIA",
      "2ª DPRM CANOAS",
      "DPPA CANOAS",
      "1ª DP CANOAS",
      "2ª DP CANOAS",
      "3ª DP CANOAS",
      "4ª DP CANOAS/DPCA",
      "DEAM CANOAS",
      "DRACO CANOAS",
      "DP ESTEIO",
      "DEAM ESTEIO",
      "DP NOVA SANTA RITA",
      "1ª DP SAPUCAIA DO SUL",
      "2ª DP SAPUCAIA DO SUL",
      "DPRPA - 1ª DP",
      "DPRPA - 2ª DP",
      "DPRPA - 3ª DP",
      "DPRPA - 4ª DP",
      "DPRPA - 5ª DP",
      "DPRPA - 6ª DP",
      "DPRPA - 7ª DP",
      "DPRPA - 8ª DP",
      "DPRPA - 9ª DP",
      "DPRPA - 10ª DP",
      "DPRPA - 11ª DP",
      "DPRPA - 12ª DP",
      "DPRPA - 13ª DP",
      "DPRPA - 14ª DP",
      "DPRPA - 15ª DP",
      "DPRPA - 16ª DP",
      "DPRPA - 17ª DP",
      "DPRPA - 18ª DP",
      "DPRPA - 19ª DP",
      "DPRPA - 20ª DP",
      "1ª DPPA/DJO/DPM",
      "2ª DPPA/DJO/DPM",
      "3ª DPPA/DJO/DPM",
      "1ª DPRM",
      "1ª DP GRAVATAÍ",
      "DEAM GRAVATAÍ",
      "DPPA GRAVATAÍ",
      "2ª DP GRAVATAÍ",
      "DPPA ALVORADA",
      "DEAM ALVORADA",
      "1ª DP ALVORADA",
      "2ª DP ALVORADA",
      "1ª DP CACHOEIRINHA",
      "2ª DP CACHOEIRINHA",
      "DP GLORINHA",
      "1ª DP VIAMÃO",
      "DEAM VIAMÃO",
      "DPPA VIAMÃO",
      "2ª DP VIAMÃO",
      "DRACO VIAMÃO",
      "3ª DPRM/DEAM SÃO LEOPOLDO",
      "DPPA SÃO LEOPOLDO",
      "1ª DP SÃO LEOPOLDO",
      "2ª DP SÃO LEOPOLDO",
      "DRACO SÃO LEOPOLDO",
      "DP CAMPO BOM",
      "DP CAPELA DE SANTANA",
      "DP DOIS IRMÃOS",
      "DP ESTÂNCIA VELHA",
      "DP IVOTI",
      "DP SAPIRANGA",
      "DP PORTÃO",
      "DP PAROBÉ",
      "DPPA NOVO HAMBURGO",
      "1ª DP NOVO HAMBURGO",
      "DEAM NOVO HAMBURGO",
      "2ª DP NOVO HAMBURGO"
    ]
  },
  {
    "contrato": "TRIUNFO COLETA DE LIXO",
    "postos": [
      "Escritório"
    ]
  }
];

export default CONTRATOS_POSTOS;
