import { S, save, esc, $, $$, toast, today, addXP, copyText, modal, fmtDate } from './util.js';

const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';

/* ---------------- Europe PMC ---------------- */
async function epmcSearch(query, { pageSize = 20, sort = '' } = {}) {
  const u = `${EPMC}/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=${pageSize}${sort ? '&sort=' + encodeURIComponent(sort) : ''}`;
  const r = await fetch(u); if (!r.ok) throw new Error('Europe PMC ' + r.status);
  const j = await r.json();
  return (j.resultList?.result || []).map(toPaper);
}
function toPaper(x) {
  return {
    key: `${x.source}:${x.id}`, source: x.source, id: x.id, pmcid: x.pmcid || null, doi: x.doi || null,
    title: stripTags(x.title || '').replace(/\.$/, ''), authors: x.authorString || '', journal: x.journalInfo?.journal?.title || x.bookOrReportDetails?.publisher || x.journalTitle || '',
    year: x.pubYear || '', abstract: x.abstractText || '', oa: x.isOpenAccess === 'Y', cited: x.citedByCount || 0,
    type: (x.pubTypeList?.pubType || []).join(', '), keywords: x.keywordList?.keyword || [],
  };
}
async function getPaper(key) {
  const saved = S().papers.find(p => p.key === key);
  if (saved?.abstract) return saved;
  const [src, ...rest] = key.split(':'); const id = rest.join(':');
  const list = await epmcSearch(`EXT_ID:${id} AND SRC:${src}`, { pageSize: 1 });
  return list[0] || saved || null;
}
async function getFullText(pmcid) {
  const r = await fetch(`${EPMC}/${pmcid}/fullTextXML`); if (!r.ok) throw new Error('No full text');
  const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
  const body = xml.querySelector('body'); if (!body) throw new Error('No body');
  const sections = [];
  for (const sec of body.querySelectorAll(':scope > sec')) {
    const title = sec.querySelector(':scope > title')?.textContent?.trim() || 'Section';
    const paras = [...sec.querySelectorAll('p')].map(p => p.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (paras.length) sections.push({ title, text: paras.join('\n\n') });
  }
  if (!sections.length) { const t = [...body.querySelectorAll('p')].map(p => p.textContent.trim()).join('\n\n'); if (t) sections.push({ title: 'Full text', text: t }); }
  return sections;
}
const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

let pod = null;
export async function paperOfDay() {
  if (S().pod?.date === today() && S().pod.paper) return S().pod.paper;
  try {
    const y = new Date().getFullYear();
    const q = `(${S().profile.readingInterests || 'pharmaceutics'}) AND OPEN_ACCESS:y AND PUB_TYPE:"review" AND FIRST_PDATE:[${y - 2}-01-01 TO ${today()}]`;
    const list = await epmcSearch(q, { pageSize: 25 });
    if (!list.length) return null;
    const doy = Math.floor((Date.now() - new Date(y, 0, 0)) / 86400000);
    pod = list[doy % list.length];
    S().pod = { date: today(), paper: pod }; save();
    return pod;
  } catch (e) { return null; }
}

/* ---------------- digest engine (runs locally, no AI needed) ---------------- */
const STOP = new Set('a an the and or of to in on for with by from at as is are was were be been being this that these those it its we our their they which who whom whose what when where how than then there here also into onto over under between among within without via per not no nor can could may might must should would will shall do does did done using used use based both each such more most less least very however therefore thus while whereas although though because since after before during about above below up down out further only own same so too s t just study studies results result data patients patient group groups method methods show shows showed shown found significant significantly'.split(' '));
function sentences(text) {
  return text.replace(/\s+/g, ' ').match(/[^.!?]+(?:[.!?](?=\s+[A-Z(\[]|$)|$)/g)?.map(s => s.trim()).filter(s => s.length > 25) || [];
}
export function summarise(text, n = 3) {
  const sents = sentences(text); if (sents.length <= n) return sents;
  const freq = {};
  for (const w of text.toLowerCase().match(/[a-z][a-z-]{2,}/g) || []) if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
  const max = Math.max(...Object.values(freq), 1);
  const scored = sents.map((s, i) => {
    const words = s.toLowerCase().match(/[a-z][a-z-]{2,}/g) || [];
    let sc = words.reduce((a, w) => a + (freq[w] || 0) / max, 0) / Math.sqrt(words.length + 1);
    if (/\b(we (found|show|demonstrate|report)|results? (show|indicate|suggest)|conclu|in summary|overall|significantly|improved|reduced|increased)\b/i.test(s)) sc *= 1.5;
    if (/\d/.test(s)) sc *= 1.15;
    if (i === 0) sc *= 1.2;
    if (i === sents.length - 1) sc *= 1.3;
    return { s, i, sc };
  });
  return scored.sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map(x => x.s);
}
function keyNumbers(text) {
  const re = /(p\s*[<=>≤]\s*0?\.\d+|\b\d+(?:\.\d+)?\s?%|\b(?:IC50|EC50|MIC|Ki|Kd|AUC|Cmax|HR|OR|RR)\b[^.;,]{0,25}?\d+(?:\.\d+)?\s?(?:nM|µM|uM|mM|mg\/L|µg\/mL|ng\/mL|h)?|95%\s?CI[^;)]{0,30}|\bn\s?=\s?\d+|\b\d+(?:\.\d+)?-fold\b)/gi;
  return [...new Set((text.match(re) || []).map(s => s.trim()))].slice(0, 10);
}
function structuredAbstract(abs) {
  const clean = abs.replace(/<\/?(sup|sub|i|b|em|strong)>/gi, '');
  const parts = clean.split(/<h4>(.*?)<\/h4>/i);
  if (parts.length > 2) {
    const out = []; for (let i = 1; i < parts.length; i += 2) out.push({ h: stripTags(parts[i]), t: stripTags(parts[i + 1] || '') }); return out;
  }
  const t = stripTags(clean);
  const m = t.split(/\b(BACKGROUND|INTRODUCTION|OBJECTIVES?|AIMS?|PURPOSE|METHODS?|MATERIALS AND METHODS|RESULTS?|FINDINGS|CONCLUSIONS?|SIGNIFICANCE)\s*[:.]\s*/);
  if (m.length > 2) { const out = []; for (let i = 1; i < m.length; i += 2) out.push({ h: cap(m[i]), t: m[i + 1].trim() }); return out; }
  return [{ h: '', t }];
}
const cap = s => s.charAt(0) + s.slice(1).toLowerCase();

const GLOSSARY = {
  'bioavailability': 'Fraction of a dose reaching the systemic circulation unchanged.', 'pharmacokinetic': 'What the body does to a drug (ADME over time).', 'pharmacodynamic': 'What the drug does to the body (effect vs concentration).',
  'AUC': 'Area under the concentration–time curve: total exposure (or, in ML, area under the ROC curve).', 'Cmax': 'Peak plasma concentration.', 'Tmax': 'Time to reach Cmax.', 'half-life': 'Time for concentration to fall by half.',
  'clearance': 'Volume of plasma cleared of drug per unit time.', 'volume of distribution': 'Apparent volume a drug spreads into; links amount in body to plasma concentration.',
  'IC50': 'Concentration that inhibits a process by 50%.', 'EC50': 'Concentration giving 50% of maximal effect.', 'MIC': 'Minimum inhibitory concentration — lowest concentration that stops visible bacterial growth.',
  'agonist': 'Binds a receptor and activates it.', 'antagonist': 'Binds a receptor without activating it, blocking agonists.', 'in vitro': 'In cells or test tubes, outside a living organism.', 'in vivo': 'In a living organism.', 'ex vivo': 'In tissue taken from an organism.', 'in silico': 'By computer simulation.',
  'nanoparticle': 'Particle ~1–100s nm; used to carry and target drugs.', 'liposome': 'Spherical lipid-bilayer vesicle used to encapsulate drugs.', 'PEGylation': 'Attaching polyethylene glycol to prolong circulation and reduce immunogenicity.',
  'encapsulation efficiency': '% of drug successfully loaded into the carrier.', 'zeta potential': 'Surface charge of particles; predicts colloidal stability.', 'polydispersity index': 'How uniform particle sizes are (PDI < 0.2 is fairly uniform).', 'dynamic light scattering': 'Technique measuring particle size in suspension.',
  'HPLC': 'High-performance liquid chromatography — separates and quantifies compounds.', 'LC-MS': 'Liquid chromatography with mass spectrometry.', 'ELISA': 'Antibody-based plate assay to quantify a protein.', 'flow cytometry': 'Counts and characterises single cells with lasers and fluorescent labels.',
  'western blot': 'Detects specific proteins after gel separation.', 'qPCR': 'Quantitative PCR — measures DNA/RNA amounts.', 'RNA-seq': 'Sequencing to measure gene expression across the genome.', 'CRISPR': 'Gene-editing technology using Cas enzymes guided by RNA.',
  'monoclonal antibod': 'Identical antibodies from one clone, binding one target.', 'biosimilar': 'A biologic highly similar to an approved reference biologic.', 'excipient': 'Inactive ingredient in a formulation.', 'dissolution': 'How fast a drug dissolves from its dosage form.',
  'permeability': 'How easily a drug crosses membranes.', 'Caco-2': 'Human colon cell line used to model intestinal absorption.', 'BCS': 'Biopharmaceutics Classification System — classes drugs by solubility and permeability.',
  'cytotoxicity': 'Toxicity to cells.', 'MTT assay': 'Colorimetric assay of cell viability.', 'apoptosis': 'Programmed cell death.', 'biofilm': 'Community of microbes in a protective matrix — harder to kill.', 'antimicrobial resistance': 'Microbes surviving drugs that used to kill them.',
  'randomi[sz]ed controlled trial': 'Trial where participants are randomly allocated to treatments.', 'meta-analysis': 'Statistical pooling of results from several studies.', 'systematic review': 'Review that searches, selects and appraises studies with an explicit protocol.',
  'confidence interval': 'Range of plausible values for an estimate.', 'hazard ratio': 'Relative rate of an event over time between groups (HR < 1 = fewer events).', 'odds ratio': 'Ratio of odds of an outcome between groups.',
  'cohort study': 'Follows groups over time to compare outcomes.', 'placebo': 'Inactive comparator.', 'double-blind': 'Neither participants nor investigators know the allocation.', 'pharmacovigilance': 'Monitoring drug safety after approval.',
  'GMP': 'Good Manufacturing Practice.', 'QSAR': 'Quantitative structure–activity relationship: predicting activity from chemical structure.', 'machine learning': 'Algorithms that learn patterns from data to make predictions.',
  'fold change': 'Ratio between two conditions (log2FC = 1 means doubled).', 'false discovery rate': 'Expected share of false positives among results called significant.', 'standard deviation': 'Spread of individual values around the mean.',
  'p-value': 'Probability of data this extreme if there were no real effect.', 'cell line': 'Cells that can grow indefinitely in culture.', 'xenograft': 'Human tissue/tumour grown in an animal model.', 'adjuvant': 'Substance enhancing immune response (vaccines) or therapy given after main treatment (oncology).',
};
const GLOSS_RE = new RegExp('\\b(' + Object.keys(GLOSSARY).map(k => k.replace(/[-]/g, '[- ]?')).join('|') + ')(s|es)?\\b', 'gi');
function glossFor(match) {
  const m = match.toLowerCase();
  for (const [k, v] of Object.entries(GLOSSARY)) if (new RegExp('^' + k.replace(/[-]/g, '[- ]?') + '(s|es)?$', 'i').test(m)) return v;
  return '';
}
function annotate(text) {
  let h = esc(text);
  h = h.replace(GLOSS_RE, m => { const d = glossFor(m); return d ? `<mark class="term" title="${esc(d)}">${m}</mark>` : m; });
  return h;
}

/* ---------------- pages ---------------- */
const TABS = [['', 'Discover'], ['library', 'My library'], ['pdf', 'Upload a PDF'], ['tools', 'Best AI reading tools']];
export function renderRead(el, sub) {
  if (sub[0] === 'paper') return reader(el, sub[1]);
  const tab = sub[0] || '';
  el.innerHTML = `<div class="eyebrow">Reading room</div><h1>Read journals again — gently</h1>
  <p class="lede">Search 40+ million life-science papers (Europe PMC), get a plain digest of each, highlight jargon, and hand the paper to an AI assistant when you want to discuss it.</p>
  <div class="tabs">${TABS.map(([k, l]) => `<a href="#/read${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="readBody"></div>`;
  const body = $('#readBody', el);
  (({ '': discover, library, pdf: pdfTab, tools })[tab] || discover)(body);
}

function discover(el) {
  const presets = ['nanoparticle drug delivery', 'antimicrobial resistance new antibiotics', 'machine learning drug discovery', 'mRNA lipid nanoparticles', 'biosimilars monoclonal antibodies', 'pharmacokinetics population modelling', 'probiotics microbiome therapeutics', 'Indonesia traditional medicine pharmacology'];
  el.innerHTML = `
    <div class="card">
      <form class="searchbar" id="sf"><input type="search" id="sq" placeholder="Topic, author or title — e.g. 'chitosan nanoparticles insulin'"><button class="btn">Search</button></form>
      <div class="row" style="margin-top:10px">${presets.map(p => `<button class="chip" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px;gap:14px;font-size:13.5px">
        <label><input type="checkbox" id="oa" checked> Free full text only</label>
        <label><input type="checkbox" id="rev"> Reviews only (best to re-enter a field)</label>
        <label><input type="checkbox" id="recent" checked> Last 5 years</label>
        <select id="sort" style="width:auto"><option value="">Most relevant</option><option value="P_PDATE_D desc">Newest</option><option value="CITED desc">Most cited</option></select>
      </div>
    </div>
    <div id="results" class="card" style="margin-top:14px"><p class="muted" style="margin:0">Tip: start with a <b>review</b> on a topic you liked in your MSc. Reviews summarise a field so later papers make sense.</p></div>`;
  const go = async q => {
    if (!q) return;
    const res = $('#results', el); res.innerHTML = '<p class="muted">Searching Europe PMC…</p>';
    let query = `(${q})`;
    if ($('#oa', el).checked) query += ' AND OPEN_ACCESS:y';
    if ($('#rev', el).checked) query += ' AND PUB_TYPE:"review"';
    if ($('#recent', el).checked) query += ` AND FIRST_PDATE:[${new Date().getFullYear() - 5}-01-01 TO ${today()}]`;
    try {
      const list = await epmcSearch(query, { sort: $('#sort', el).value });
      res.innerHTML = list.length ? list.map(paperRow).join('') : '<div class="empty">No papers found. Try fewer or broader words.</div>';
      bindRows(res, list);
    } catch (e) { res.innerHTML = `<div class="notice dew">Couldn't reach Europe PMC (${esc(e.message)}). Check your connection and try again.</div>`; }
  };
  $('#sf', el).onsubmit = e => { e.preventDefault(); go($('#sq', el).value.trim()); };
  $$('[data-p]', el).forEach(b => b.onclick = () => { $('#sq', el).value = b.dataset.p; go(b.dataset.p); });
}
function paperRow(p) {
  const saved = S().papers.some(x => x.key === p.key);
  return `<div class="paper" data-key="${esc(p.key)}"><h3><a href="#/read/paper/${encodeURIComponent(p.key)}">${esc(p.title)}</a></h3>
    <div class="meta">${esc(shortAuthors(p.authors))} · <i>${esc(p.journal)}</i> ${esc(p.year)} ${p.oa ? '<span class="chip good">Free full text</span>' : ''} ${/review/i.test(p.type) ? '<span class="chip water">Review</span>' : ''} ${p.cited ? `<span class="chip">cited ${p.cited}×</span>` : ''}</div>
    <div class="row" style="margin-top:6px"><a class="btn sm" href="#/read/paper/${encodeURIComponent(p.key)}">Digest</a><button class="btn sm ghost" data-save>${saved ? '✓ Saved' : '+ Save'}</button></div></div>`;
}
const shortAuthors = a => { const parts = a.split(',').map(s => s.trim()).filter(Boolean); return parts.length > 3 ? parts.slice(0, 3).join(', ') + ' et al.' : a.replace(/\.$/, ''); };
function bindRows(root, list) {
  $$('[data-save]', root).forEach(b => b.onclick = () => {
    const p = list.find(x => x.key === b.closest('.paper').dataset.key);
    savePaper(p); b.textContent = '✓ Saved';
  });
}
function savePaper(p) {
  if (S().papers.some(x => x.key === p.key)) return;
  S().papers.unshift({ ...p, status: 'to-read', notes: '', takeaway: '', added: today() }); save(); toast('Saved to your library');
}

async function reader(el, key) {
  el.innerHTML = '<p class="muted">Opening paper…</p>';
  let p;
  try { p = await getPaper(key); } catch (e) { }
  if (!p) { el.innerHTML = `<div class="empty">Couldn't load this paper. <a href="#/read">Back</a></div>`; return; }
  const absParts = structuredAbstract(p.abstract || '');
  const absText = absParts.map(x => x.t).join(' ');
  const tldr = summarise(absText, 3);
  const nums = keyNumbers(absText);
  const saved = () => S().papers.find(x => x.key === p.key);
  el.innerHTML = `<div class="reader">
    <a href="#/read" class="muted" style="text-decoration:none">← Reading room</a>
    <div class="eyebrow" style="margin-top:10px">${esc(p.journal)} · ${esc(p.year)} ${/review/i.test(p.type) ? '· Review' : ''}</div>
    <h1 style="font-size:26px">${esc(p.title)}</h1>
    <p class="muted">${esc(shortAuthors(p.authors))}${p.doi ? ` · <a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">doi.org/${esc(p.doi)}</a>` : ''}${p.pmcid ? ` · <a href="https://europepmc.org/article/PMC/${esc(p.pmcid)}" target="_blank" rel="noopener">Europe PMC ↗</a>` : ''}</p>
    <div class="row" style="margin-bottom:16px"><button class="btn" id="saveP">${saved() ? '✓ In library' : '+ Save to library'}</button><button class="btn soft" id="aiBtn">Discuss with an AI</button><button class="btn ghost" id="focusBtn">Focus mode</button></div>
    <div class="digest"><div class="eyebrow">60-second digest · made in your browser</div>
      ${tldr.length ? `<ul>${tldr.map(s => `<li>${annotate(s)}</li>`).join('')}</ul>` : '<p class="muted">No abstract available for this record.</p>'}
      ${nums.length ? `<div class="row" style="gap:6px"><span class="muted" style="font-size:13px">Key numbers:</span>${nums.map(n => `<mark class="num">${esc(n)}</mark>`).join(' ')}</div>` : ''}
    </div>
    <div class="spacer"></div>
    <section class="card"><h2>Abstract</h2><div class="abs">${absParts.map(x => `<p>${x.h ? `<b>${esc(x.h)}.</b> ` : ''}${annotate(x.t)}</p>`).join('')}</div>
      <p class="muted" style="font-size:12.5px">Hover or tap the <mark class="term">highlighted terms</mark> for a plain-English definition.</p></section>
    <div class="spacer"></div>
    <section class="card" id="ftBox">${p.pmcid && p.oa ? '<p class="muted">Loading free full text…</p>' : `<h3>Full text</h3><p class="muted">No free full text in Europe PMC. Try the DOI link (your library login may give access), or upload the PDF in the <a href="#/read/pdf">Upload a PDF</a> tab.</p>`}</section>
    <div class="spacer"></div>
    <section class="card dew"><h2>Read it actively</h2>
      <ol class="steps"><li><b>Pass 1 (5 min)</b> — title, abstract, figures, conclusion. What question does it answer?</li><li><b>Pass 2 (30 min)</b> — read the results and look hard at each figure. What did they actually measure?</li><li><b>Pass 3 (only for key papers)</b> — methods in detail. Could you repeat it? What would you change?</li></ol>
      <label class="f">Your one-sentence takeaway (in your own words)</label><textarea id="takeaway" rows="2" placeholder="This paper shows that…">${esc(saved()?.takeaway || '')}</textarea>
      <label class="f">Notes / questions for a supervisor</label><textarea id="notes" rows="3">${esc(saved()?.notes || '')}</textarea>
      <div class="spacer"></div><button class="btn" id="doneBtn">${saved()?.status === 'done' ? '✓ Digested' : 'Mark as digested (+15 XP)'}</button>
    </section></div>`;

  $('#saveP', el).onclick = () => { savePaper(p); $('#saveP', el).textContent = '✓ In library'; };
  $('#focusBtn', el).onclick = () => { document.body.classList.toggle('focus-mode'); toast(document.body.classList.contains('focus-mode') ? 'Bigger, calmer text on' : 'Focus mode off'); };
  const persist = () => { if (!saved()) savePaper(p); const s = saved(); s.takeaway = $('#takeaway', el).value; s.notes = $('#notes', el).value; save(); };
  $('#takeaway', el).onchange = persist; $('#notes', el).onchange = persist;
  $('#doneBtn', el).onclick = () => {
    if ($('#takeaway', el).value.trim().length < 15) return toast('Write a one-sentence takeaway first — it is what makes it stick');
    persist(); const s = saved(); if (s.status !== 'done') { s.status = 'done'; s.doneAt = today(); save(); addXP(15); window.dispatchEvent(new Event('compass:stats')); }
    $('#doneBtn', el).textContent = '✓ Digested'; toast('Digested! +15 XP');
  };
  let fullSections = null;
  $('#aiBtn', el).onclick = () => aiModal(p, absText, fullSections);
  if (p.pmcid && p.oa) {
    try {
      fullSections = await getFullText(p.pmcid);
      const box = $('#ftBox', el); if (!box) return;
      box.innerHTML = `<h2>Full text, section by section</h2><p class="muted" style="font-size:13.5px">Each section opens with a 2-line digest. Open only what you need.</p>
      ${fullSections.map((s, i) => `<details ${i === 0 ? '' : ''}><summary>${esc(s.title)}</summary>
        <div class="digest" style="margin:10px 0"><ul>${summarise(s.text, 2).map(x => `<li>${annotate(x)}</li>`).join('')}</ul></div>
        <div class="section-text">${s.text.split('\n\n').map(pp => `<p>${annotate(pp)}</p>`).join('')}</div></details>`).join('')}`;
    } catch (e) { const box = $('#ftBox', el); if (box) box.innerHTML = `<h3>Full text</h3><p class="muted">Couldn't fetch the full text right now. <a href="https://europepmc.org/article/PMC/${esc(p.pmcid)}" target="_blank" rel="noopener">Read it on Europe PMC ↗</a></p>`; }
  }
}

/* ---------------- AI hand-off ---------------- */
function buildPrompt(p, absText, sections, mode) {
  const ft = sections ? sections.map(s => `## ${s.title}\n${s.text}`).join('\n\n') : '';
  const body = ft ? ft.slice(0, 60000) : absText;
  const ask = {
    explain: `Explain this paper to me as a pharmacy graduate with an MSc in biotechnology who is getting back into reading research. Give: (1) the question in one sentence, (2) what they did, (3) the main findings with the key numbers, (4) limitations, (5) three terms I should understand, each explained simply, (6) two questions I could ask the authors or a potential PhD supervisor.`,
    critique: `Critically appraise this paper: study design, sample size, controls, statistics used and whether they fit, risk of bias, and whether the conclusions follow from the data. Be specific and fair.`,
    phd: `I may want to do a PhD in this area in the UK. Based on this paper, suggest 3 open research questions a PhD could address, the methods and skills each would need (lab and computational), and what I should read next.`,
  }[mode];
  return `${ask}\n\nTitle: ${p.title}\nAuthors: ${p.authors}\nJournal: ${p.journal} (${p.year})${p.doi ? `\nDOI: ${p.doi}` : ''}\n\n${ft ? 'FULL TEXT' : 'ABSTRACT'}:\n${body}`;
}
function aiModal(p, absText, sections) {
  modal(`<div class="row between"><h2 style="margin:0">Discuss this paper with an AI</h2><button class="btn sm ghost" data-close>Close</button></div>
    <p class="muted">Cornelieur writes a good prompt with the paper inside${sections ? ' (full text included)' : ' (abstract only)'}. Copy it, then paste into any assistant you're signed into — free tiers work.</p>
    <div class="row"><span class="muted">I want to…</span>
      <div class="os-switch"><button data-m="explain" class="on">Understand it</button><button data-m="critique">Critique it</button><button data-m="phd">Find PhD ideas</button></div></div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="cp">📋 Copy prompt</button>
      <a class="btn soft" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude ↗</a>
      <a class="btn soft" href="https://chatgpt.com/" target="_blank" rel="noopener">Open ChatGPT ↗</a>
      <a class="btn soft" href="https://gemini.google.com/" target="_blank" rel="noopener">Open Gemini ↗</a>
    </div>
    <hr>
    <h3>Ask the wider literature</h3>
    <div class="row">
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.perplexity.ai/search?q=${encodeURIComponent('What do recent studies say about: ' + p.title)}">Perplexity ↗</a>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://consensus.app/results/?q=${encodeURIComponent(p.title)}">Consensus ↗</a>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.semanticscholar.org/search?q=${encodeURIComponent(p.title)}">Semantic Scholar ↗</a>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.connectedpapers.com/search?q=${encodeURIComponent(p.title)}">Connected Papers map ↗</a>
    </div>
    <hr>
    <h3>Private, on-device AI <span class="chip warn">experimental</span></h3>
    <p class="muted" style="font-size:13.5px">Runs a small AI model inside your browser — nothing leaves your laptop. Needs a recent Chrome/Edge with WebGPU and a one-time ~1 GB download. It is much less capable than Claude or ChatGPT, but fine for a plain-English summary.</p>
    <button class="btn sm ghost" id="local">Summarise on this device</button>
    <div id="localOut" class="chat" style="margin-top:10px"></div>`, m => {
    let mode = 'explain';
    $$('[data-m]', m).forEach(b => b.onclick = () => { $$('[data-m]', m).forEach(x => x.classList.remove('on')); b.classList.add('on'); mode = b.dataset.m; });
    $('#cp', m).onclick = () => copyText(buildPrompt(p, absText, sections, mode));
    $('#local', m).onclick = () => localAI(m, `Summarise this research paper in plain English for a pharmacy graduate, in 5 bullet points, then list 3 key terms with one-line definitions.\n\nTitle: ${p.title}\n\n${(sections ? sections.map(s => s.title + ': ' + s.text).join('\n') : absText).slice(0, 9000)}`);
  });
}

let engine = null;
async function localAI(m, prompt) {
  const out = $('#localOut', m);
  const say = (t, cls = 'ai') => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = t; out.appendChild(d); return d; };
  if (!('gpu' in navigator)) { say('This browser does not support WebGPU. Try the latest Chrome or Edge on a laptop — or use "Copy prompt" with Claude/ChatGPT.'); return; }
  const status = say('Preparing the on-device model…');
  try {
    if (!engine) {
      const webllm = await import('https://esm.run/@mlc-ai/web-llm');
      const models = ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f16_1-MLC'];
      let lastErr;
      for (const id of models) {
        try { engine = await webllm.CreateMLCEngine(id, { initProgressCallback: r => status.textContent = r.text }); break; } catch (e) { lastErr = e; }
      }
      if (!engine) throw lastErr;
    }
    status.textContent = 'Model ready — writing…';
    const reply = say('');
    const chunks = await engine.chat.completions.create({ messages: [{ role: 'user', content: prompt }], stream: true, temperature: 0.3 });
    for await (const c of chunks) reply.textContent += c.choices[0]?.delta?.content || '';
    status.remove();
  } catch (e) { status.textContent = 'On-device AI could not start: ' + e.message; }
}

/* ---------------- library ---------------- */
function library(el) {
  const ps = S().papers;
  const draw = filter => {
    const list = ps.filter(p => filter === 'all' || p.status === filter);
    $('#libList', el).innerHTML = list.length ? list.map(p => `<div class="paper"><h3><a href="#/read/paper/${encodeURIComponent(p.key)}">${esc(p.title)}</a></h3>
      <div class="meta">${esc(p.journal || p.source || '')} ${esc(p.year || '')} · saved ${fmtDate(p.added)} ${p.status === 'done' ? '<span class="chip good">Digested</span>' : '<span class="chip">To read</span>'}</div>
      ${p.takeaway ? `<p style="margin:6px 0 0;font-size:14px"><b>Takeaway:</b> ${esc(p.takeaway)}</p>` : ''}
      <div class="row" style="margin-top:6px"><button class="btn sm ghost" data-del="${esc(p.key)}">Remove</button></div></div>`).join('')
      : '<div class="empty">Nothing here yet. Save papers from Discover.</div>';
    $$('[data-del]', el).forEach(b => b.onclick = () => { S().papers = S().papers.filter(x => x.key !== b.dataset.del); save(); library(el); });
  };
  const done = ps.filter(p => p.status === 'done');
  el.innerHTML = `<div class="row between"><div class="row"><button class="chip on" data-f="all">All (${ps.length})</button><button class="chip" data-f="to-read">To read (${ps.length - done.length})</button><button class="chip" data-f="done">Digested (${done.length})</button></div>
    <button class="btn sm ghost" id="expTk">Copy all takeaways</button></div>
    <div class="card" style="margin-top:12px" id="libList"></div>`;
  $$('[data-f]', el).forEach(b => b.onclick = () => { $$('[data-f]', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); draw(b.dataset.f); });
  $('#expTk', el).onclick = () => copyText(done.map(p => `• ${p.title} (${p.journal} ${p.year})${p.doi ? ' doi:' + p.doi : ''}\n  → ${p.takeaway}`).join('\n\n') || 'No digested papers yet.');
  draw('all');
}

/* ---------------- PDF upload ---------------- */
let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(PDFJS + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  return pdfjs;
}
async function pdfToText(file, onMsg) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    onMsg(`Reading page ${i} of ${doc.numPages}…`);
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    for (const it of c.items) text += it.str + (it.hasEOL ? '\n' : ' ');
    text += '\n';
  }
  return { text, pages: doc.numPages };
}
function splitSections(text) {
  const H = /^\s*(?:\d+\.?\s*)?(abstract|introduction|background|materials and methods|methods?|experimental( section)?|results( and discussion)?|discussion|conclusions?|references|acknowledg(e)?ments?)\s*$/i;
  const lines = text.split('\n'); const out = []; let cur = { title: 'Start', text: '' };
  for (const ln of lines) {
    if (H.test(ln) && ln.trim().length < 40) { if (cur.text.trim()) out.push(cur); cur = { title: ln.trim().replace(/^\d+\.?\s*/, ''), text: '' }; }
    else cur.text += ln + ' ';
  }
  if (cur.text.trim()) out.push(cur);
  return out.filter(s => !/^references|^acknowledg/i.test(s.title)).map(s => ({ title: cap(s.title.toUpperCase()), text: s.text.replace(/\s+/g, ' ').replace(/-\s(?=[a-z])/g, '').trim() }));
}
function pdfTab(el) {
  el.innerHTML = `<div class="card">
    <label class="dropzone" id="dz"><input type="file" accept="application/pdf" id="pf" hidden>
      <div style="font-size:34px">📄</div><b>Drop a journal PDF here or tap to choose</b><br><small class="muted">It's read inside your browser and never uploaded anywhere.</small></label>
    <p class="muted" style="margin:10px 0 0">Want it kept (and readable on your phone as an easy Markdown page)? Add it to <a href="#/files">My files</a> instead: it is filed in your Drive automatically.</p>
    <p id="pmsg" class="muted" style="margin-top:10px"></p></div><div id="pout"></div>`;
  const dz = $('#dz', el), inp = $('#pf', el);
  const handle = async f => {
    if (!f || f.type !== 'application/pdf') return toast('Please choose a PDF');
    const msg = t => $('#pmsg', el).textContent = t;
    try {
      const { text, pages } = await pdfToText(f, msg);
      if (text.replace(/\s/g, '').length < 500) { msg('This PDF seems to be a scanned image without a text layer, so it cannot be read here. Try the publisher\'s version, or run it through an OCR tool first.'); return; }
      const secs = splitSections(text);
      const all = secs.map(s => s.text).join(' ');
      const p = { key: 'PDF:' + f.name, title: f.name.replace(/\.pdf$/i, ''), authors: '', journal: 'Uploaded PDF', year: '', abstract: '' };
      msg(`Read ${pages} pages · ${secs.length} sections found`);
      $('#pout', el).innerHTML = `<div class="spacer"></div><div class="digest"><div class="eyebrow">Whole-paper digest</div><ul>${summarise(all, 5).map(s => `<li>${annotate(s)}</li>`).join('')}</ul>
        ${keyNumbers(all).length ? `<div class="row" style="gap:6px"><span class="muted" style="font-size:13px">Key numbers:</span>${keyNumbers(all).map(n => `<mark class="num">${esc(n)}</mark>`).join(' ')}</div>` : ''}</div>
        <div class="row" style="margin:14px 0"><button class="btn soft" id="pai">Discuss with an AI</button></div>
        <div class="card">${secs.map(s => `<details><summary>${esc(s.title)}</summary><div class="digest" style="margin:10px 0"><ul>${summarise(s.text, 2).map(x => `<li>${annotate(x)}</li>`).join('')}</ul></div><div class="section-text"><p>${annotate(s.text)}</p></div></details>`).join('')}</div>`;
      $('#pai', el).onclick = () => aiModal(p, all.slice(0, 20000), secs);
    } catch (e) { msg('Could not read this PDF: ' + e.message); }
  };
  inp.onchange = () => handle(inp.files[0]);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('hover'); };
  dz.ondragleave = () => dz.classList.remove('hover');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('hover'); handle(e.dataTransfer.files[0]); };
}

/* ---------------- recommended tools ---------------- */
function tools(el) {
  const T = [
    ['N', 'NotebookLM (Google) — top pick for her', 'Upload up to dozens of PDFs into a "notebook", then ask questions and get answers that cite the exact passage. The "Audio Overview" turns papers into a podcast-style conversation — great on low-energy days or on the bus. Free with a Google account.', 'https://notebooklm.google.com/'],
    ['C', 'Claude / ChatGPT / Gemini', 'Best for a back-and-forth explanation of one paper, or checking your understanding. Use "Discuss with an AI" on any paper here to copy a ready-made prompt.', 'https://claude.ai/'],
    ['P', 'Perplexity', 'The "ask the whole web" style. Good for quick orientation questions ("What are current approaches to oral insulin delivery?") with linked sources — always open the sources it cites.', 'https://www.perplexity.ai/'],
    ['E', 'Elicit', 'Research assistant built for papers: finds studies for a question and extracts methods/results into a table. Excellent for building a literature review for a PhD proposal.', 'https://elicit.com/'],
    ['Co', 'Consensus', 'Answers yes/no research questions by pooling findings from papers, with a "consensus meter".', 'https://consensus.app/'],
    ['S', 'Semantic Scholar', 'Free search engine with one-line AI "TLDR" summaries and a reader that explains citations as you scroll.', 'https://www.semanticscholar.org/'],
    ['R', 'ResearchRabbit / Connected Papers', 'Visual maps of related papers — put in one good paper, discover the cluster around it and the key authors (= possible supervisors!).', 'https://www.researchrabbit.ai/'],
    ['Z', 'Zotero', 'Free reference manager with a browser button to save papers, highlight PDFs and cite in Word/Google Docs. Set it up before writing a PhD proposal.', 'https://www.zotero.org/'],
  ];
  el.innerHTML = `<div class="grid g2"><section class="card"><h2>What I'd use, in order</h2>${T.map(([b, t, d, u]) => `<div class="tool-reco"><span class="badge">${b}</span><a href="${u}" target="_blank" rel="noopener"><b>${t} ↗</b></a><span style="font-size:14px">${d}</span></div>`).join('')}</section>
  <section class="stack"><div class="card dark"><h2>A low-load reading routine</h2><ol class="steps" style="color:#ECE9E3"><li>Open "Paper of the day" on Today. Read only the digest. (2 min)</li><li>If it's interesting, save it. If not, stop — that's fine.</li><li>Twice a week, pick one saved paper and do Pass 1 + a one-sentence takeaway.</li><li>Every Sunday, drop that week's PDFs into NotebookLM and listen to the Audio Overview.</li><li>Monthly: copy all takeaways (My library) — that's the start of a literature review.</li></ol></div>
  <div class="card water"><h3>Paywalled paper?</h3><p style="font-size:14px">Try, in order: the "Free full text" filter here; <a href="https://unpaywall.org/" target="_blank" rel="noopener">Unpaywall</a> (browser extension finds legal free copies); the author's page or ResearchGate; or email the corresponding author — they almost always send it.</p></div>
  <div class="card"><h3>A word on AI summaries</h3><p style="font-size:14px;margin:0">They're great for orientation but can miss nuance or invent details. Treat them as a study buddy — always check the key numbers against the paper itself before quoting them in an application.</p></div></section></div>`;
}
