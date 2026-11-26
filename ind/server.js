const http = require('http');
const fs = require('fs');
const path = require('path');

const v = require('./lib/validator.js');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, '..');
const IND_DIR = __dirname;

const stats = {
  operationsValidated: 0,
  operationsApproved: 0,
  operationsRejected: 0,
  correlationsValidated: 0,
  correlationsAccepted: 0,
  rdProducts: 0,
  verificationsOpened: 0
};

const rdProducts = [];
let rdSeq = 1;
const verifications = [];
let verifSeq = 1;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('JSON invalido')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendFile(res, filePath, type) {
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: 'Recurso nao encontrado' });
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
    res.end(buf);
  });
}

function serveStatic(res, urlPath) {
  const map = [
    { prefix: '/ind/', root: IND_DIR, index: 'public/index.html' },
    { prefix: '/', root: ROOT, index: 'index.html' }
  ];
  for (const m of map) {
    if (urlPath === m.prefix || urlPath.startsWith(m.prefix)) {
      let rel = urlPath.slice(m.prefix.length);
      if (urlPath === m.prefix || rel === '') rel = m.index;
      const abs = path.join(m.root, rel);
      if (!abs.startsWith(path.resolve(m.root))) return send(res, 404, { error: 'Recurso nao encontrado' });
      const ext = path.extname(abs).toLowerCase();
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      if (!types[ext]) return false;
      sendFile(res, abs, types[ext]);
      return true;
    }
  }
  return false;
}

function coverage() {
  const total = v.correlations.records.length;
  const covered = v.correlations.records.filter((r) => v.reos.profiles[r.profile]).length;
  const partial = v.correlations.records.filter((r) => r.correspondence === 'parcial').length;
  return {
    I1: {
      label: 'Cobertura de REOS',
      target: '100%',
      valuePct: Math.round((covered / total) * 1000) / 10,
      met: covered === total,
      detail: covered + ' de ' + total + ' linhas com regra definida; ' + partial + ' com correlacao parcial (nota explicativa exigida).'
    },
    C1: {
      label: 'Conformidade documental',
      target: '>= 95%',
      valuePct: stats.operationsValidated ? Math.round((stats.operationsApproved / stats.operationsValidated) * 1000) / 10 : null,
      met: null,
      detail: stats.operationsValidated + ' operacoes validadas; ' + stats.operationsRejected + ' reprovadas.'
    },
    C4: {
      label: 'Acumulacoes sem lastro',
      target: '<= 1%',
      detail: 'Acao C4 do comite de controle, conforme secao 6 do memorando.'
    },
    I4: {
      label: 'Indice de erro de origem',
      target: '<= 3%',
      valuePct: stats.operationsValidated ? Math.round((stats.operationsRejected / stats.operationsValidated) * 1000) / 10 : null,
      met: null,
      detail: 'Proxy pela taxa de reprovacao em validacoes de operacao.'
    },
    C6: {
      label: 'Verificacoes a posteriori abertas',
      target: 'Conclusao em ate 3 anos, prazo >= 85%',
      value: stats.verificationsOpened,
      detail: 'Pedidos de verificacao registrados pela API (amostragem ou denuncia).'
    },
    RD: {
      label: 'Produtos de pesquisa e desenvolvimento registrados',
      target: 'Registro com REOS sugerida',
      value: rdProducts.length,
      detail: 'Propostas de novos produtos geradas a partir da base de correlacao.'
    }
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  if (method === 'GET') {
    if (p === '/api/health') {
      return send(res, 200, {
        status: 'operacional',
        service: 'API de Interoperabilidade de Origem Mercosul-Indonesia',
        project: 'MINERYCOIN - MTC/ORIGEM/001/2026',
        nomenclature: v.correlations.version,
        correlations: v.correlations.records.length,
        legalBases: v.legalBasis.bases.length,
        segments: { nomenclatura: 'Camada 1', regras: 'Camada 2', flexibilidades: 'Camada 3', prova: 'Camada 4', controle: 'Camada 5' }
      });
    }
    if (p === '/api/legal') {
      return send(res, 200, v.legalBasis);
    }
    if (p === '/api/correlations') {
      let rows = v.correlations.records;
      const { profile, chapter, correspondence } = url.searchParams;
      if (profile) rows = rows.filter((r) => r.profile === profile);
      if (chapter) rows = rows.filter((r) => r.chapter === chapter);
      if (correspondence) rows = rows.filter((r) => r.correspondence === correspondence);
      return send(res, 200, { version: v.correlations.version, count: rows.length, records: rows });
    }
    const mCorr = p.match(/^\/api\/correlations\/(\d{6})$/);
    if (mCorr) {
      const rec = v.findCorrelation(mCorr[1]);
      if (!rec) return send(res, 404, { error: 'Linha sem correlacao; acionar consulta as autoridades aduaneiras (R.1).' });
      const found = v.findProfile(mCorr[1]);
      return send(res, 200, {
        record: rec,
        reos: found.rule,
        related: v.relatedCodes(mCorr[1])
      });
    }
    if (p === '/api/reos') {
      return send(res, 200, { reference: v.reos.reference, profiles: v.reos.profiles, deMinimis: v.reos.deMinimis, accumulation: v.reos.accumulation, proofOfOrigin: v.reos.proofOfOrigin, verification: v.reos.verification });
    }
    const mReos = p.match(/^\/api\/reos\/(\d{6})$/);
    if (mReos) {
      const found = v.findProfile(mReos[1]);
      if (!found) return send(res, 404, { error: 'Perfil sem REOS definida' });
      return send(res, 200, { sh6: found.record.sh6, profile: found.record.profile, rule: found.rule });
    }
    if (p === '/api/indicators') {
      return send(res, 200, { panel: coverage(), memorando: 'MTC/ORIGEM/001/2026', secao: '8. Indicadores de eficacia' });
    }
    const mRd = p.match(/^\/api\/rd\/products\/([A-Za-z0-9-]+)$/);
    if (mRd) {
      const item = rdProducts.find((x) => x.id === mRd[1]);
      return item ? send(res, 200, item) : send(res, 404, { error: 'Produto de P&D nao encontrado' });
    }
    if (p === '/api/rd/products') {
      return send(res, 200, { count: rdProducts.length, products: rdProducts });
    }
    if (p === '/api/verifications') {
      return send(res, 200, { count: verifications.length, verifications });
    }
  }

  if (method === 'POST') {
    if (p === '/api/correlations/validate') {
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: 'JSON invalido' }); }
      const check = v.checkCorrelation(body);
      stats.correlationsValidated += 1;
      if (check.passed) stats.correlationsAccepted += 1;
      return send(res, 200, { validated: check.passed, test: 'rastreabilidade da etapa 2', check });
    }
    if (p === '/api/operations/validate') {
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: 'JSON invalido' }); }
      if (!body.sh6) return send(res, 400, { error: 'Campo sh6 obrigatorio' });
      const result = v.validateOperation(body);
      result.operationId = 'OP-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(stats.operationsValidated + 1).padStart(4, '0');
      result.validatedAt = new Date().toISOString();
      stats.operationsValidated += 1;
      if (result.approved) stats.operationsApproved += 1; else stats.operationsRejected += 1;
      return send(res, 200, result);
    }
    if (p === '/api/verifications') {
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: 'JSON invalido' }); }
      if (!body.operationId) return send(res, 400, { error: 'Campo operationId obrigatorio' });
      const trig = ['amostragem', 'denuncia'].includes(String(body.trigger || '').toLowerCase()) ? String(body.trigger).toLowerCase() : 'amostragem';
      const openedAt = new Date();
      const due = new Date(openedAt);
      due.setFullYear(due.getFullYear() + v.reos.verification.aPosterioriYears);
      const item = {
        id: 'VER-' + String(verifSeq).padStart(4, '0'),
        operationId: body.operationId,
        trigger: trig,
        openedAt: openedAt.toISOString(),
        dueAt: due.toISOString(),
        authority: body.authority || 'Receita Federal / DGCE',
        status: 'aberta',
        indicator: 'Auditorias concluidas no prazo >= 85%'
      };
      verifSeq += 1;
      verifications.push(item);
      stats.verificationsOpened += 1;
      return send(res, 201, item);
    }
    if (p === '/api/rd/products') {
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: 'JSON invalido' }); }
      if (!body.sh6 || !body.title) return send(res, 400, { error: 'Campos obrigatorios: sh6 e title' });
      const found = v.findProfile(body.sh6);
      if (!found) return send(res, 404, { error: 'Linha SH-6 sem correlacao; novo produto exige registro previo na tabela (etapa 2).' });
      const item = {
        id: 'RD-' + String(rdSeq).padStart(4, '0'),
        sh6: found.record.sh6,
        ncm: found.record.ncm,
        btki: found.record.btki,
        title: body.title,
        description: body.description || '',
        partners: body.partners || ['BR', 'IDN'],
        suggestedProfile: found.record.profile,
        suggestedReos: { criteria: found.rule.criteria, specificProcess: found.rule.specificProcess || null, rationale: found.rule.rationale },
        correspondenceConfirmed: found.record.correspondence === 'direta',
        status: 'proposta',
        legalBasis: ['B.1', 'B.6', 'B.7'],
        registeredAt: new Date().toISOString()
      };
      rdSeq += 1;
      rdProducts.push(item);
      stats.rdProducts = rdProducts.length;
      return send(res, 201, item);
    }
  }

  if (method === 'GET' && serveStatic(res, url.pathname)) return;
  return send(res, 404, { error: 'Rota nao encontrada', docs: ['/api/health', '/api/legal', '/api/correlations', '/api/correlations/:sh6', '/api/correlations/validate', '/api/reos', '/api/reos/:sh6', '/api/operations/validate', '/api/verifications', '/api/rd/products', '/api/indicators'] });
});

server.listen(PORT, () => {
  console.log('API de Interoperabilidade de Origem Mercosul-Indonesia (MINERYCOIN) em http://localhost:' + PORT);
});
