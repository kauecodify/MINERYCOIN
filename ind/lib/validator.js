const correlations = require('../data/correlations.json');
const reos = require('../data/reos.json');
const legalBasis = require('../data/legal-basis.json');

const MERCOSUL = ['BR', 'AR', 'PY', 'UY', 'BOL*'];
const PARTIES = ['BR', 'AR', 'PY', 'UY', 'IDN'];
const BOLIVIA = 'BOL*';

function normParty(value) {
  const v = String(value || '').toUpperCase().trim();
  const alias = { 'BRASIL': 'BR', 'BRA': 'BR', 'INDONESIA': 'IDN', 'INDONÉSIA': 'IDN', 'INA': 'IDN', 'ARGENTINA': 'AR', 'ARG': 'AR', 'PARAGUAI': 'PY', 'PRY': 'PY', 'URUGUAI': 'UY', 'URY': 'UY', 'BOLIVIA': 'BOL*', 'BOLÍVIA': 'BOL*', 'BOL': 'BOL*' };
  return alias[v] || v;
}

function findCorrelation(sh6) {
  const key = String(sh6 || '').replace(/\D/g, '').slice(0, 6).padStart(6, '0');
  return correlations.records.find((r) => r.sh6 === key) || null;
}

function findProfile(sh6) {
  const rec = findCorrelation(sh6);
  if (!rec) return null;
  return { record: rec, rule: reos.profiles[rec.profile] || null };
}

function relatedCodes(sh6) {
  const rec = findCorrelation(sh6);
  if (!rec) return [];
  return correlations.records.filter((r) => r.chapter === rec.chapter && r.sh6 !== rec.sh6);
}

function checkCorrelation(payload) {
  const rec = findCorrelation(payload.sh6);
  if (!rec) {
    return { passed: false, control: 'C.2', legalBasis: ['B.6', 'B.7'], reason: 'Linha SH-6 sem correlacao registrada; etapa 2 (rastreabilidade) bloqueia o uso.' };
  }
  const ncmOk = payload.ncm ? rec.ncm.split('.').join('').slice(0, 8).startsWith(String(payload.ncm).replace(/\D/g, '').slice(0, 8)) : true;
  const btkiOk = payload.btki ? rec.btki.split('.').join('').slice(0, 10).startsWith(String(payload.btki).replace(/\D/g, '').slice(0, 10)) : true;
  if (!ncmOk || !btkiOk) {
    return { passed: false, control: 'C.2', legalBasis: ['B.6', 'B.7'], reason: 'Classificacao divergente da tabela SH-2022 <-> NCM <-> BTKI.' };
  }
  return {
    passed: true,
    control: 'C.2',
    legalBasis: ['B.6', 'B.7'],
    reason: rec.correspondence === 'direta'
      ? 'Correspondencia direta na tabela de correlacao.'
      : 'Correspondencia parcial aceita com nota explicativa: ' + rec.note,
    alert: rec.correspondence === 'parcial' ? rec.note : null
  };
}

function checkRuleDefined(profile) {
  if (!profile) {
    return { passed: false, control: 'C.3', legalBasis: ['B.1'], reason: 'Perfil produtivo sem REOS definida na matriz de decisao.' };
  }
  return { passed: true, control: 'C.3', legalBasis: ['B.1'], reason: 'REOS definida: ' + profile.label + '.' };
}

function checkCriterion(payload, rec, rule) {
  const applied = String(payload.appliedCriteria || '').toUpperCase().replace(/\s+/g, '');
  const accepted = [rule.criteria];
  if (rule.alternative) accepted.push(rule.alternative.criteria);
  const bases = accepted.map((c) => c.split('-')[0]);
  if (!applied) {
    return { passed: false, control: 'C.3', legalBasis: ['B.1', 'B.3'], reason: 'Criterio de origem nao declarado; exigido ' + bases.join(' ou ') + '.' };
  }
  if (!bases.includes(applied.split('-')[0])) {
    return { passed: false, control: 'C.3', legalBasis: ['B.1', 'B.3'], reason: 'Criterio ' + applied + ' nao admitido para ' + rule.label + '; exigido ' + bases.join(' ou ') + '.' };
  }
  if (rule.conjunction) {
    const conjOk = (payload.appliedConjunction || '').toUpperCase().replace(/\s+/g, '') === rule.conjunction.criteria;
    if (!conjOk) {
      return { passed: false, control: 'C.3', legalBasis: ['B.1'], reason: 'Regra conjunta exigida: ' + rule.criteria + ' + ' + rule.conjunction.criteria + '.' };
    }
  }
  if (applied === 'RVC') {
    const threshold = rule.rvcThreshold != null ? rule.rvcThreshold : (rule.alternative && rule.alternative.criteria === 'RVC' ? rule.alternative.rvcThreshold : null);
    const value = Number(payload.rvcPercent);
    if (threshold == null || Number.isNaN(value) || value < threshold) {
      return { passed: false, control: 'C.3', legalBasis: ['B.1', 'B.3'], reason: 'RVC insuficiente ou nao comprovado; minimo ' + (threshold == null ? 'a definir' : threshold + '%') + '.' };
    }
  }
  if (applied === 'CTC') {
    const digits = { 'CTC-2': 2, 'CTC-4': 4, 'CTC-6': 6 };
    const want = digits[rule.criteria] || 4;
    const declared = Number(payload.ctcDigits);
    if (!Number.isNaN(declared) && declared < want) {
      return { passed: false, control: 'C.3', legalBasis: ['B.1'], reason: 'Salto tarifario de ' + declared + ' digitos inferior ao exigido (' + want + ' digitos).' };
    }
  }
  return { passed: true, control: 'C.3', legalBasis: ['B.1', 'B.3'], reason: 'Criterio ' + applied + ' aplicado conforme a REOS de ' + rule.label + '.' };
}

function checkSpecificProcess(payload, rule) {
  if (!rule.specificProcess) return null;
  const done = String(payload.specificProcessPerformed || '').toLowerCase().replace(/\s+/g, '_');
  if (done !== rule.specificProcess) {
    return { passed: false, control: 'C.3', legalBasis: ['B.1'], reason: 'Processo especifico exigido (' + rule.specificProcess.replace(/_/g, ' ') + ') nao comprovado.' };
  }
  return { passed: true, control: 'C.3', legalBasis: ['B.1'], reason: 'Processo especifico comprovado na parte exportadora.' };
}

function checkMinimalOperations(payload, rule) {
  if (!rule.minimalOperationsForbidden) return null;
  const ops = payload.minimalOperations || [];
  if (Array.isArray(ops) && ops.some((o) => String(o).trim() !== '')) {
    return { passed: false, control: 'C.1', legalBasis: ['B.1', 'B.3'], reason: 'Operacoes minimas (lavagem, peneiramento, embalagem) nao caracterizam transformacao para mineral bruto.' };
  }
  return { passed: true, control: 'C.1', legalBasis: ['B.1', 'B.3'], reason: 'Ausencia de operacoes minimas.' };
}

function checkDeMinimis(payload, rec, rule) {
  const pct = Number(payload.nonOriginatingMaterialPct);
  if (Number.isNaN(pct)) return null;
  const excludedChapter = reos.deMinimis.excludedChapters.includes(Number(rec.chapter));
  const noDeMinimis = rule.deMinimisExclusion || excludedChapter;
  if (pct > reos.deMinimis.percent) {
    if (noDeMinimis) {
      return { passed: false, control: 'C.5', legalBasis: ['B.3'], reason: 'Materiais nao originarios (' + pct + '%) excedem o de minimis de 10% e o capitulo ' + rec.chapter + ' tem exclusao setorial.' };
    }
    return { passed: false, control: 'C.5', legalBasis: ['B.3'], reason: 'Materiais nao originarios (' + pct + '%) excedem o de minimis de 10%.' };
  }
  const partial = rec.correspondence === 'parcial';
  return { passed: true, control: 'C.5', legalBasis: ['B.3'], reason: 'De minimis respeitado (' + pct + '% <= 10%); ' + (noDeMinimis ? 'capitulo sob exclusao setorial, sem flexibilizacao.' : 'dentro do limite do Anexo 3-B.') , alert: partial ? rec.note : null };
}

function checkAccumulation(payload) {
  const acc = payload.accumulation;
  if (!acc || !acc.enabled) {
    return { passed: true, control: 'C.4', legalBasis: ['B.1'], reason: 'Acumulacao nao utilizada.' };
  }
  const type = String(acc.type || '').toLowerCase();
  const inputs = (acc.inputCountries || []).map(normParty);
  if (!inputs.length) {
    return { passed: false, control: 'C.4', legalBasis: ['B.1', 'B.4'], reason: 'Acumulacao declarada sem paises de insumo.' };
  }
  if (type === 'bilateral') {
    const allMirq = inputs.every((c) => c === BOLIVIA || MERCOSUL.includes(c) || c === 'IDN');
    if (!allMirq) {
      return { passed: false, control: 'C.4', legalBasis: ['B.1'], reason: 'Acumulacao bilateral restrita aos Estados Parte do Mercosul e a Indonesia.' };
    }
    return { passed: true, control: 'C.4', legalBasis: ['B.1'], reason: 'Acumulacao bilateral plena entre Mercosul e Indonesia.' };
  }
  if (type === 'estendida' || type === 'extended' || type === 'diagonal') {
    const framework = reos.accumulation.extended.activeAgreements.find((a) => String(acc.agreement || '').toUpperCase() === a.code);
    if (!framework) {
      return { passed: false, control: 'C.4', legalBasis: ['B.4'], reason: 'Acordo de acumulacao estendida nao identificado ou nao vigente.' };
    }
    const covered = inputs.every((c) => framework.regions.includes(c));
    if (!covered) {
      return { passed: false, control: 'C.4', legalBasis: ['B.4'], reason: 'Insumo de pais fora do perimetro do acordo ' + framework.code + '.' };
    }
    if (reos.accumulation.extended.requireCertifiedInputs && !acc.certifiedInputs) {
      return { passed: false, control: 'C.4', legalBasis: ['B.4'], reason: 'Insumos acumulados sem certificacao de origem; exigencia do controle de acumulacao.' };
    }
    return { passed: true, control: 'C.4', legalBasis: ['B.4'], reason: 'Acumulacao estendida com lastro no acordo ' + framework.code + ' e insumos certificados.' };
  }
  return { passed: false, control: 'C.4', legalBasis: ['B.1'], reason: 'Tipo de acumulacao invalido (admite-se bilateral ou estendida).' };
}

function checkProofOfOrigin(payload) {
  const proof = payload.proofOfOrigin;
  if (!proof || !proof.type) {
    return { passed: false, control: 'C.1', legalBasis: ['B.2', 'B.5'], reason: 'Prova de origem ausente.' };
  }
  const type = String(proof.type).toLowerCase();
  if (!reos.proofOfOrigin.types.includes(type)) {
    return { passed: false, control: 'C.1', legalBasis: ['B.2', 'B.5'], reason: 'Tipo de prova de origem invalido.' };
  }
  if (type === 'autodeclaracao' && !proof.issuerRegistered) {
    return { passed: false, control: 'C.1', legalBasis: ['B.2'], reason: 'Autodeclaracao exige registro previo do exportador.' };
  }
  const issuedAt = proof.issuedAt ? new Date(proof.issuedAt) : new Date();
  const expiresAt = proof.expiresAt ? new Date(proof.expiresAt) : null;
  if (Number.isNaN(issuedAt.getTime())) {
    return { passed: false, control: 'C.1', legalBasis: ['B.2', 'B.5'], reason: 'Data de emissao da prova de origem invalida.' };
  }
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return { passed: false, control: 'C.1', legalBasis: ['B.2', 'B.5'], reason: 'Prova de origem sem validade declarada (12 meses).' };
  }
  const months = (expiresAt.getFullYear() - issuedAt.getFullYear()) * 12 + (expiresAt.getMonth() - issuedAt.getMonth());
  if (months > reos.proofOfOrigin.validityMonths) {
    return { passed: false, control: 'C.1', legalBasis: ['B.2', 'B.5'], reason: 'Validade de ' + months + ' meses superior ao limite de 12 meses.' };
  }
  if (expiresAt < new Date()) {
    return { passed: false, control: 'C.1', legalBasis: ['B.2', 'B.5'], reason: 'Prova de origem vencida (validade de 12 meses).' };
  }
  return { passed: true, control: 'C.1', legalBasis: ['B.2', 'B.5'], reason: 'Prova de origem (' + type + ') valida ate ' + expiresAt.toISOString().slice(0, 10) + '.' };
}

function checkParties(payload) {
  const origin = normParty(payload.originCountry);
  const destination = normParty(payload.destinationCountry);
  const direct = (PARTIES.includes(origin) && destination === 'IDN') || (origin === 'IDN' && PARTIES.includes(destination));
  if (!direct) {
    return { passed: false, control: 'C.1', legalBasis: ['B.2'], reason: 'Fluxo fora do perimetro bilateral Mercosul-Indonesia (origem ' + origin + ', destino ' + destination + ').' };
  }
  return { passed: true, control: 'C.1', legalBasis: ['B.2'], reason: 'Operacao dentro do perimetro Mercosul-Indonesia (' + origin + ' para ' + destination + ').' };
}

function validateOperation(payload) {
  const rec = findCorrelation(payload.sh6);
  const found = findProfile(payload.sh6);
  const checks = [];
  checks.push(checkParties(payload));

  if (rec) checks.push(checkCorrelation(payload));
  else checks.push({ passed: false, control: 'C.2', legalBasis: ['B.6', 'B.7'], reason: 'Linha SH-6 inexistente na tabela de correlacao.' });

  if (found && found.rule) {
    checks.push(checkRuleDefined(found.rule));
    checks.push(checkCriterion(payload, rec, found.rule));
    const sp = checkSpecificProcess(payload, found.rule);
    if (sp) checks.push(sp);
    const mo = checkMinimalOperations(payload, found.rule);
    if (mo) checks.push(mo);
    checks.push(checkDeMinimis(payload, rec, found.rule));
  }
  checks.push(checkAccumulation(payload));
  checks.push(checkProofOfOrigin(payload));

  const approved = checks.every((c) => c.passed);
  return {
    approved,
    decision: approved ? 'OPERACAO VALIDADA' : 'OPERACAO NAO VALIDADA',
    sh6: payload.sh6,
    rule: found && found.rule ? { profile: found.record.profile, label: found.rule.label, criteria: found.rule.criteria, rationale: found.rule.rationale } : null,
    correspondence: rec ? rec.correspondence : null,
    checks
  };
}

module.exports = {
  normParty,
  findCorrelation,
  findProfile,
  relatedCodes,
  checkCorrelation,
  validateOperation,
  correlations,
  reos,
  legalBasis
};
