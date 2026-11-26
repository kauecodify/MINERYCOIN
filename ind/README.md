# MINERYCOIN - Operacao `ind/`

Implementacao tecnica do memorando MTC/ORIGEM/001/2026: API de interoperabilidade
entre Mercosul (NCM, SH-2022) e Indonesia (BTKI/AHTN), com validacao juridica de
operacoes de mineracao, controle de acumulacao de origem e registro de produtos
de pesquisa e desenvolvimento.

## Estrutura

```
ind/
  server.js              API HTTP (Node puro, sem dependencias externas)
  lib/validator.js       Motor de validacao juridica e de origem
  data/correlations.json Tabela SH-2022 <-> NCM <-> BTKI (Etapa 2)
  data/reos.json         Matriz de decisao e flexibilidades (Etapas 3 e 4)
  data/legal-basis.json  Base normativa B.1 a B.7 e controles C.1 a C.7
  public/                Sistema operacional (front-end formal, sem emoji)
  test.js                Testes de integracao da API
```

## Uso

```bash
cd ind
npm start        # ou: node server.js
npm test
```

A API escuta na porta `3000` (variavel `PORT`). Apresentacao do projeto em
`http://localhost:3000/` e sistema operacional em `http://localhost:3000/ind/`.

## Endpoints

| Metodo | Rota | Funcao |
|---|---|---|
| GET | `/api/health` | Estado do servico e da nomenclatura |
| GET | `/api/legal` | Base normativa (B.1 a B.7) e controles (C.1 a C.7) |
| GET | `/api/correlations` | Tabela de correlacao, com filtros `profile`, `chapter`, `correspondence` |
| GET | `/api/correlations/:sh6` | Correlacao, REOS aplicavel e linhas relacionadas |
| POST | `/api/correlations/validate` | Teste de rastreabilidade da Etapa 2 |
| GET | `/api/reos` | Matriz de decisao, de minimis, acumulacao e prova de origem |
| GET | `/api/reos/:sh6` | REOS da linha |
| POST | `/api/operations/validate` | Validacao juridica da operacao de mineracao |
| POST | `/api/verifications` | Abertura de verificacao a posteriori (3 anos) |
| GET/POST | `/api/rd/products` | Registro de produtos de pesquisa e desenvolvimento |
| GET | `/api/indicators` | Painel de indicadores (secao 8 do memorando) |

## Motor de validacao

Cada operacao passa pelos controles do memorando, com referencia juridica em
cada verificacao:

- C.1: prova de origem valida, tipos admitidos, registro previo do exportador,
  validade maxima de 12 meses.
- C.2: conferencia contra a tabela SH-2022 <-> NCM <-> BTKI, com alerta para
  correspondencia parcial.
- C.3: criterio de origem (CTC com digitos minimos, RVC com percentual, SP),
  conforme a matriz de decisao por perfil produtivo.
- C.4: acumulacao bilateral (Mercosul e Indonesia) e estendida condicionada a
  acordo vigente (RCEP, ATIGA, IJEPA, IK-CEPA, ACFTA) e insumos certificados.
- C.5: de minimis de 10%, com exclusao setorial dos capitulos 50 a 64.

Operacoes minimas (lavagem, peneiramento, embalagem) reprovam mineral bruto,
conforme a camada 2 do memorando.

## Exemplos

```bash
curl -s localhost:3000/api/correlations/720260
curl -s -X POST localhost:3000/api/operations/validate \
  -H 'Content-Type: application/json' \
  -d '{"sh6":"720260","originCountry":"IDN","destinationCountry":"BR",
       "appliedCriteria":"CTC","ctcDigits":4,"nonOriginatingMaterialPct":5,
       "proofOfOrigin":{"type":"certificado","issuedAt":"2026-11-26",
       "expiresAt":"2027-06-26"}}'
```
