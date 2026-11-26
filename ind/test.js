const http = require('http');
const assert = require('assert');

const BASE = 'http://localhost:' + (process.env.PORT || 3000);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(BASE + path, { method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  const health = await request('GET', '/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.body.nomenclature, 'SH-2022');

  const corr = await request('GET', '/api/correlations/811212');
  assert.strictEqual(corr.status, 200);
  assert.strictEqual(corr.body.record.btki, '8112.99.10');
  assert.strictEqual(corr.body.record.correspondence, 'parcial');

  const corrFerro = await request('GET', '/api/correlations/260111');
  assert.ok(Array.isArray(corrFerro.body.related) && corrFerro.body.related.length > 0);

  const reos = await request('GET', '/api/reos/720260');
  assert.strictEqual(reos.body.rule.criteria, 'CTC-4');

  const okOp = await request('POST', '/api/operations/validate', {
    sh6: '720260',
    originCountry: 'IDN',
    destinationCountry: 'BR',
    appliedCriteria: 'CTC',
    ctcDigits: 4,
    nonOriginatingMaterialPct: 5,
    minimalOperations: [],
    proofOfOrigin: { type: 'certificado', issuedAt: new Date().toISOString().slice(0, 10), expiresAt: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) }
  });
  assert.strictEqual(okOp.status, 200);
  assert.strictEqual(okOp.body.approved, true, JSON.stringify(okOp.body.checks));

  const badRvc = await request('POST', '/api/operations/validate', {
    sh6: '720260',
    originCountry: 'IDN',
    destinationCountry: 'BR',
    appliedCriteria: 'RVC',
    rvcPercent: 20,
    proofOfOrigin: { type: 'certificado', issuedAt: new Date().toISOString().slice(0, 10), expiresAt: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) }
  });
  assert.strictEqual(badRvc.body.approved, false);
  assert.ok(badRvc.body.checks.some((c) => c.control === 'C.3' && !c.passed));

  const badMinOps = await request('POST', '/api/operations/validate', {
    sh6: '260111',
    originCountry: 'BR',
    destinationCountry: 'IDN',
    appliedCriteria: 'CTC',
    ctcDigits: 4,
    minimalOperations: ['peneiramento'],
    proofOfOrigin: { type: 'certificado', issuedAt: new Date().toISOString().slice(0, 10), expiresAt: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) }
  });
  assert.strictEqual(badMinOps.body.approved, false);
  assert.ok(badMinOps.body.checks.some((c) => c.reason.includes('Operacoes minimas')));

  const badSector = await request('POST', '/api/operations/validate', {
    sh6: '520811',
    originCountry: 'IDN',
    destinationCountry: 'BR',
    appliedCriteria: 'CTC',
    ctcDigits: 2,
    nonOriginatingMaterialPct: 12,
    proofOfOrigin: { type: 'certificado', issuedAt: new Date().toISOString().slice(0, 10), expiresAt: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) }
  });
  assert.strictEqual(badSector.body.approved, false);
  assert.ok(badSector.body.checks.some((c) => c.control === 'C.5' && !c.passed));

  const accFail = await request('POST', '/api/operations/validate', {
    sh6: '750210',
    originCountry: 'IDN',
    destinationCountry: 'BR',
    appliedCriteria: 'CTC',
    ctcDigits: 4,
    nonOriginatingMaterialPct: 8,
    accumulation: { enabled: true, type: 'estendida', agreement: 'IJEPA', inputCountries: ['JPN'], certifiedInputs: false },
    proofOfOrigin: { type: 'certificado', issuedAt: new Date().toISOString().slice(0, 10), expiresAt: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) }
  });
  assert.strictEqual(accFail.body.approved, false);
  assert.ok(accFail.body.checks.some((c) => !c.passed && c.reason.includes('certificacao')));

  const accOk = await request('POST', '/api/operations/validate', {
    sh6: '750210',
    originCountry: 'IDN',
    destinationCountry: 'BR',
    appliedCriteria: 'CTC',
    ctcDigits: 4,
    nonOriginatingMaterialPct: 8,
    accumulation: { enabled: true, type: 'estendida', agreement: 'IJEPA', inputCountries: ['JPN'], certifiedInputs: true },
    proofOfOrigin: { type: 'certificado', issuedAt: new Date().toISOString().slice(0, 10), expiresAt: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) }
  });
  assert.strictEqual(accOk.body.approved, true);

  const corrVal = await request('POST', '/api/correlations/validate', { sh6: '260111', ncm: '2601.11.00', btki: '2601.11.00' });
  assert.strictEqual(corrVal.body.validated, true);

  const corrBad = await request('POST', '/api/correlations/validate', { sh6: '260111', ncm: '9999.99.99', btki: '2601.11.00' });
  assert.strictEqual(corrBad.body.validated, false);

  const rd = await request('POST', '/api/rd/products', {
    sh6: '260400',
    title: 'Concentrado de niquel para cadeia de baterias',
    description: 'Novo produto de pesquisa e desenvolvimento entre o bloco e a Indonesia.'
  });
  assert.strictEqual(rd.status, 201);
  assert.strictEqual(rd.body.suggestedProfile, 'mineral_bruto');
  const rdList = await request('GET', '/api/rd/products');
  assert.ok(rdList.body.count >= 1);

  const verif = await request('POST', '/api/verifications', { operationId: okOp.body.operationId, trigger: 'denuncia' });
  assert.strictEqual(verif.status, 201);
  assert.strictEqual(verif.body.trigger, 'denuncia');

  const indicators = await request('GET', '/api/indicators');
  assert.strictEqual(indicators.body.panel.I1.valuePct, 100);
  assert.strictEqual(indicators.body.panel.I1.met, true);

  const missing = await request('GET', '/api/correlations/999999');
  assert.strictEqual(missing.status, 404);

  const legal = await request('GET', '/api/legal');
  assert.strictEqual(legal.body.bases.length, 7);

  console.log('Todos os testes passaram: ' + (health.body.correlations) + ' correlacoes, indicadores e validacoes operacionais.');
}

run().catch((e) => { console.error(e); process.exit(1); });
