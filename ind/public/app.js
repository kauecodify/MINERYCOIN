(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (data) { return { status: r.status, data: data }; });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadCorrelations() {
    var params = new URLSearchParams();
    if ($('filtro-capitulo').value) params.set('chapter', $('filtro-capitulo').value);
    if ($('filtro-perfil').value) params.set('profile', $('filtro-perfil').value);
    if ($('filtro-corr').value) params.set('correspondence', $('filtro-corr').value);
    api('GET', '/api/correlations?' + params.toString()).then(function (res) {
      var alerts = res.data.records.filter(function (r) { return r.correspondence === 'parcial'; });
      var alertBox = $('alerta-correlacao');
      if (alerts.length) {
        alertBox.classList.remove('oculto');
        alertBox.innerHTML = '<strong>Alertas de correlacao parcial:</strong> ' +
          alerts.map(function (r) { return esc(r.sh6) + ' - ' + esc(r.note); }).join(' | ');
      } else {
        alertBox.classList.add('oculto');
      }
      $('tabela-correlacao').innerHTML = res.data.records.map(function (r) {
        return '<tr><td><strong>' + esc(r.sh6) + '</strong></td><td>' + esc(r.ncm) + '</td><td>' + esc(r.btki) + '</td><td>' +
          esc(r.profile) + '</td><td>' + esc(r.correspondence) + '</td><td>' + esc(r.note) + '</td></tr>';
      }).join('') || '<tr><td colspan="6">Sem registros.</td></tr>';
    });
  }

  function loadIndicators() {
    api('GET', '/api/indicators').then(function (res) {
      var panel = res.data.panel;
      $('painel-indicadores').innerHTML = Object.keys(panel).map(function (k) {
        var i = panel[k];
        var valor = i.valuePct != null ? i.valuePct + '%' : (i.value != null ? i.value : 'Aguardando dados');
        return '<div class="indicador"><h3>' + esc(i.label) + '</h3><div class="valor">' + esc(valor) + '</div>' +
          '<div class="meta">Meta: ' + esc(i.target) + '</div><div class="detalhe">' + esc(i.detail || '') + '</div></div>';
      }).join('');
    });
  }

  function loadRdList() {
    api('GET', '/api/rd/products').then(function (res) {
      $('lista-rd').classList.remove('oculto');
      $('lista-rd').innerHTML = res.data.products.length
        ? res.data.products.map(function (p) {
            return '<div class="card-produto"><strong>' + esc(p.id) + '</strong> - SH ' + esc(p.sh6) +
              ' | NCM ' + esc(p.ncm) + ' | BTKI ' + esc(p.btki) + '<br>' + esc(p.title) +
              '<br>Sugestao de REOS: ' + esc(p.suggestedProfile) + ' / ' + esc(p.suggestedReos.criteria) +
              '<br><span class="bases">Base juridica: ' + p.legalBasis.map(esc).join(', ') + ' | Status: ' + esc(p.status) + '</span></div>';
          }).join('')
        : '<p class="ajuda">Nenhum produto registrado.</p>';
    });
  }

  function operationPayload() {
    var meses = Number($('op-meses').value || 12);
    var emissao = new Date();
    var validade = new Date();
    validade.setMonth(validade.getMonth() + meses);
    var accPaises = $('op-acc-paises').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return {
      sh6: $('op-sh6').value,
      originCountry: $('op-origem').value,
      destinationCountry: $('op-destino').value,
      appliedCriteria: $('op-criterio').value,
      ctcDigits: Number($('op-ctc').value),
      rvcPercent: $('op-rvc').value === '' ? undefined : Number($('op-rvc').value),
      nonOriginatingMaterialPct: Number($('op-nom').value),
      specificProcessPerformed: $('op-sp').value,
      minimalOperations: $('op-min').value ? [$('op-min').value] : [],
      accumulation: {
        enabled: !!$('op-acc-tipo').value,
        type: $('op-acc-tipo').value,
        agreement: $('op-acc-acordo').value,
        inputCountries: accPaises,
        certifiedInputs: $('op-acc-cert').checked
      },
      proofOfOrigin: {
        type: $('op-prova').value,
        issuerRegistered: $('op-registro').value === 'sim',
        issuedAt: emissao.toISOString().slice(0, 10),
        expiresAt: validade.toISOString().slice(0, 10)
      }
    };
  }

  $('btn-validar').addEventListener('click', function () {
    api('POST', '/api/operations/validate', operationPayload()).then(function (res) {
      var box = $('resultado-operacao');
      box.classList.remove('oculto');
      var d = res.data;
      var html = '<div class="decisao ' + (d.approved ? 'aprovada' : 'reprovada') + '">' + esc(d.decision) +
        (d.operationId ? ' - ' + esc(d.operationId) : '') + '</div>';
      if (d.rule) {
        html += '<p class="ajuda">REOS aplicada: perfil ' + esc(d.rule.profile) + ' (' + esc(d.rule.label) + '), criterio ' +
          esc(d.rule.criteria) + '. ' + esc(d.rule.rationale) + '</p>';
      }
      html += '<ul class="verificacoes">' + (d.checks || []).map(function (c) {
        return '<li><span class="situacao ' + (c.passed ? 'ok' : 'falha') + '">' + esc(c.control || 'C.0') + ' - ' +
          (c.passed ? 'CUMPRIDO' : 'REPROVADO') + '</span><br>' + esc(c.reason) +
          (c.legalBasis ? '<br><span class="bases">Base juridica: ' + c.legalBasis.map(esc).join(', ') + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
      box.innerHTML = html;
      loadIndicators();
    });
  });

  $('btn-rd').addEventListener('click', function () {
    api('POST', '/api/rd/products', {
      sh6: $('rd-sh6').value,
      title: $('rd-titulo').value,
      description: $('rd-descricao').value,
      partners: ['BR', 'IDN']
    }).then(function (res) {
      var box = $('lista-rd');
      box.classList.remove('oculto');
      if (res.status !== 201) {
        box.innerHTML = '<div class="alerta">' + esc(res.data.error) + '</div>';
        return;
      }
      $('lista-rd').innerHTML = '<div class="card-produto"><strong>' + esc(res.data.id) + '</strong> registrado - SH ' + esc(res.data.sh6) +
        ' | NCM ' + esc(res.data.ncm) + ' | BTKI ' + esc(res.data.btki) +
        '<br>Sugestao de REOS: ' + esc(res.data.suggestedProfile) + ' / ' + esc(res.data.suggestedReos.criteria) + '</div>';
      loadIndicators();
    });
  });

  $('btn-rd-lista').addEventListener('click', loadRdList);
  $('btn-recarregar').addEventListener('click', loadCorrelations);
  ['filtro-capitulo', 'filtro-perfil', 'filtro-corr'].forEach(function (id) {
    $(id).addEventListener('change', loadCorrelations);
  });

  api('GET', '/api/correlations').then(function (res) {
    var capitulos = Array.from(new Set(res.data.records.map(function (r) { return r.chapter; }))).sort();
    var sel = $('filtro-capitulo');
    capitulos.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = 'Capitulo ' + c;
      sel.appendChild(opt);
    });
  });

  loadCorrelations();
  loadIndicators();
})();
