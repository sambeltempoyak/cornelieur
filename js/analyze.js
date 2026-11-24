// Reads a job / PhD advert (page text or feed summary) and extracts what matters:
// deadline, start, money, who may apply, what they ask for, red flags — then ranks it for Ocha.
// Pure functions (no DOM) so they can be tested in Node.
import { fmQuote } from './md.js';

const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const mnum = s => MN[s.slice(0, 3).toLowerCase()];
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCMonth() === m - 1 && d >= 1 ? `${y}-${pad(m)}-${pad(d)}` : null; };

export function findDates(text) {
  const out = [];
  const push = (i, len, v) => { if (v) out.push({ i, len, iso: v }); };
  let m;
  const d1 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\.?,?\\s+(\\d{4})\\b`, 'gi');
  while ((m = d1.exec(text))) push(m.index, m[0].length, iso(+m[3], mnum(m[2]), +m[1]));
  const d2 = new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi');
  while ((m = d2.exec(text))) push(m.index, m[0].length, iso(+m[3], mnum(m[1]), +m[2]));
  const d3 = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g;
  while ((m = d3.exec(text))) push(m.index, m[0].length, iso(+m[3], +m[2], +m[1]));
  const d4 = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = d4.exec(text))) push(m.index, m[0].length, iso(+m[1], +m[2], +m[3]));
  return out.sort((a, b) => a.i - b.i);
}

const DL_KEY = /(closing date|closes?\b|close on|deadline|apply by|applications? (?:must be received|should be received|received) by|applications? (?:close|will close|are open until|accepted until)|to apply by|submit(?:ted)? (?:your )?application by|last date|due date|application due)/gi;
const START_KEY = /(start(?:ing)? date|starting|commenc(?:e|ing)|begin(?:s|ning)?|intake|expected start|to start|start in|start:)/gi;

export function htmlToText(html) {
  let h = String(html || '');
  const h1 = (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h) || [])[1] || '';
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) || [])[1] || '';
  h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|nav|footer|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const main = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(h);
  if (main && main[2].length > 800) h = main[2];
  h = h.replace(/<(br|\/p|\/div|\/h[1-6]|\/tr|\/section|\/ul|\/ol|\/table|\/dd|\/dt)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '\n• ').replace(/<\/(td|th)>/gi, ' | ').replace(/<[^>]+>/g, ' ');
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
  h = h.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (s, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n ? String.fromCodePoint(n) : ' '; }
    return ent[e.toLowerCase()] ?? ' ';
  });
  const text = h.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
  return { text, title: clean(h1) || clean(title) };
}
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const sentences = text => text.split(/\n+|(?<=[.!?])\s+(?=[A-Z•])/).map(s => s.replace(/^[•\-–*]\s*/, '').trim()).filter(s => s.length >= 25 && s.length <= 420);
const uniq = (arr, n = 6) => { const seen = new Set(), out = []; for (const s of arr) { const k = s.toLowerCase().slice(0, 45); if (!seen.has(k)) { seen.add(k); out.push(s.length > 260 ? s.slice(0, 257).replace(/\s+\S*$/, '') + '…' : s); } if (out.length >= n) break; } return out; };

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function pickDeadline(text, fallback, today) {
  const dates = findDates(text); let best = null;
  for (const m of text.matchAll(DL_KEY)) {
    const after = dates.find(d => d.i >= m.index && d.i - m.index <= 150);
    const before = dates.find(d => d.i < m.index && m.index - d.i - d.len <= 25);
    const d = after || before; if (!d) continue;
    const cand = { iso: d.iso, text: text.slice(Math.max(0, m.index - 5), Math.min(text.length, d.i + d.len + 12)).replace(/\s+/g, ' ').trim() };
    if (!best) best = cand;
    else if (daysBetween(today, cand.iso) >= -1 && (daysBetween(today, best.iso) < -1 || cand.iso < best.iso)) best = cand;
  }
  if (best) return best;
  if (fallback) return { iso: fallback, text: '' };
  return null;
}
function pickStart(text) {
  for (const m of text.matchAll(START_KEY)) {
    const seg = text.slice(m.index, m.index + 110);
    const d = findDates(seg)[0]; if (d) return { iso: d.iso, label: seg.slice(d.i, d.i + d.len) };
    const my = new RegExp(`${MON}\\.?\\s+(20\\d{2})`, 'i').exec(seg); if (my) return { iso: iso(+my[2], mnum(my[1]), 1), label: my[0] };
    const sea = /(autumn|fall|spring|summer|winter)\s+(20\d{2})/i.exec(seg); if (sea) return { iso: null, label: sea[0] };
  }
  return null;
}

const RULES = [
  // ---- who may apply: hard blockers
  { id: 'own-students', sev: 'high', text: "Looks restricted to that university's own current students/staff.", res: [
    /\b(only|exclusively|solely)\b[^.\n]{0,45}\b(current|existing|enrolled|registered)\b[^.\n]{0,30}\b(students?|undergraduates?|postgraduates?)\b/i,
    /\b(open|available|restricted|limited|reserved)\s+(only\s+|exclusively\s+)?(to|for)\s+(current|existing|enrolled|registered)\b[^.\n]{0,40}\b(students?|undergraduates?|postgraduates?|staff)\b/i,
    /\b(open|available|restricted|limited|reserved)\s+(only\s+|exclusively\s+)?(to|for)\s+(University of [A-Z]\w+|[A-Z]\w+ (University|College)|[A-Z]{2,5})\s+(students?|undergraduates?|postgraduates?|staff)\b/,
    /\b(must|need to) be (currently )?(a )?(registered|enrolled)\b[^.\n]{0,25}\b(student|at the university|on a (degree|course|programme))/i,
    /\binternal (candidates|applicants) only\b|\b(staff|employees) only\b|\bopen to (current )?(university )?(staff|employees) only\b/i] },
  { id: 'student-job', sev: 'high', text: 'This is a student-employment role (for currently enrolled students).', title: true, res: [/\bstudent (ambassador|helper|assistant|mentor|rep(resentative)?|tutor|demonstrator|champion|intern)\b/i, /\bcasual student\b|\bstudent (job|employment) (service|vacanc)/i] },
  { id: 'home-only', sev: 'high', text: 'Appears open to UK/home students only (not international).', res: [
    /\b(UK|home)\b[^.\n]{0,30}\b(students?|applicants?|candidates?|nationals?|citizens?|residents?)\b[^.\n]{0,25}\bonly\b/i,
    /\bonly\b[^.\n]{0,30}\b(available|open|eligible)\b[^.\n]{0,25}\b(UK|home|British|EU)\b/i,
    /\b(UK|British) (nationals?|citizens?) only\b/i, /\bunavailable to international\b|\bnot (open|available) to international\b|\binternational (students|applicants)\b[^.\n]{0,30}\b(not eligible|cannot apply|are not)\b/i,
    /\bhome[- ]fee status\b(?![^.\n]{0,60}international)/i] },
  { id: 'no-sponsor', sev: 'high', text: 'States they cannot sponsor a visa.', res: [
    /\b(not|n['’]t|unable to|cannot|can['’]t|will not|won['’]t|do not|does not)\b\s*(be able to\s+)?(offer|provide|support|sponsor|consider)[^.\n]{0,30}(visa|sponsorship|applicants? who require)/i,
    /\b(no|without)\s+(visa\s+)?sponsorship\b/i, /\bsponsorship\b[^.\n]{0,20}\b(is not|isn['’]t|will not be|not) (available|offered|provided)\b/i] },
  { id: 'registration', sev: 'high', text: 'Needs a professional registration (e.g. GPhC pharmacist).', res: [/\b(GPhC|HCPC|NMC|GMC)\b[^.\n]{0,30}\b(registration|registered)\b/i, /\b(must|need to) be (a )?(currently )?registered (pharmacist|with the (General Pharmaceutical Council|GPhC))/i, /\bregistered pharmacist\b[^.\n]{0,30}\b(essential|required)\b/i] },
  { id: 'needs-phd', sev: 'med', text: 'Asks for a PhD already (a research post, not a studentship).', notPhd: true, res: [/\b(PhD|doctorate|doctoral degree)\b[^.\n]{0,45}\b(essential|required|must|needed)\b/i, /\b(essential)\b[^.\n]{0,45}\b(PhD|doctorate)\b/i] },
  { id: 'right-to-work', sev: 'med', text: 'Asks for existing right to work in the UK. Check if sponsorship is possible.', res: [/\b(must|need to|should|will need to)\b[^.\n]{0,25}\b(have|hold|provide|show|prove)\b[^.\n]{0,25}\bright to work\b/i, /\bright to work in the UK\b[^.\n]{0,20}\b(is )?(essential|required|necessary)\b/i] },
  { id: 'unfunded', sev: 'med', text: 'Not funded, or you must find your own funding.', phd: true, res: [/\b(self[- ]funded|unfunded|no funding (is )?available|fees? (are )?not covered|secure your own funding|find your own funding|competition funding)\b/i] },
  { id: 'phd-prereq', sev: 'med', text: 'Needs an existing PhD proposal / supervisor agreement first.', phd: true, res: [/\b(agreed|identify|find|secure)\b[^.\n]{0,30}\b(a )?supervisor\b[^.\n]{0,30}\bbefore (applying|you apply)\b/i] },
];
const INTL_OK = /(international (students|applicants|candidates)[^.\n]{0,50}(welcome|eligible|encouraged|can apply|may apply)|open to (all|international)|all nationalities|regardless of (nationality|immigration)|international fee|overseas (students|applicants)[^.\n]{0,40}(eligible|welcome))/i;
const SPONSOR_OK = /(visa )?sponsorship (is )?(available|offered|provided)|(we|the university|company) (can|will|are able to|may) sponsor|skilled worker (visa|sponsor)|licensed sponsor|sponsor (a|your) (skilled worker )?visa/i;
const FUNDED_FULL = /fully[- ]funded|full (funding|scholarship)|funded (phd|studentship)|studentship (covers|includes|provides|is funded)|tax[- ]free stipend|covers? (tuition )?fees? and (a )?(living|stipend)/i;

function money(text) {
  const out = {};
  let m = /(?:stipend|salary|bursary|living (?:allowance|costs?)|annual (?:tax[- ]free )?(?:stipend|salary))[^£\n]{0,70}(£\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|£\s?\d{2,3}k)([^\n]{0,40}?)(?=[.;]\s|\n|$)/i.exec(text);
  if (m) out.pay = (m[1] + m[2]).replace(/\s+/g, ' ').trim().replace(/[,;:\s]+$/, '');
  else { m = /(£\s?\d{2},\d{3}(?:\s?(?:to|-|–)\s?£?\s?\d{2},\d{3})?)\s*(?:per (?:year|annum)|a year|p\.?a\.?|annually)/i.exec(text); if (m) out.pay = m[1].replace(/\s+/g, ' '); }
  m = /(tuition fees?|course fees?|fees? (?:will be )?(?:paid|covered|waived))[^\n]{0,110}?(?=[.;]\s|\n|$)/i.exec(text); if (m) out.fees = m[0].replace(/\s+/g, ' ').trim();
  out.funded = FUNDED_FULL.test(text) ? 'full' : /self[- ]funded|unfunded|no funding/i.test(text) ? 'none' : 'unknown';
  return out;
}

/**
 * @param o       feed item {id,title,org,link,summary,type,deadline,location,published,curated,why,steps}
 * @param ctx     {html?, text?, profile:{keywords,avoid}, today?}
 */
export function analyse(o, ctx = {}) {
  const today = ctx.today || todayISO();
  const profile = ctx.profile || { keywords: [], avoid: [] };
  let text = '', pageTitle = '', source = 'feed';
  if (ctx.html) { const r = htmlToText(ctx.html); text = r.text; pageTitle = r.title; source = text.length > 500 ? 'page' : 'feed'; }
  else if (ctx.text) { text = ctx.text; source = 'page'; }
  const feedText = [o.title, o.org, o.summary].filter(Boolean).join('\n');
  const full = source === 'page' ? (o.title || pageTitle) + '\n' + text + '\n' + feedText : feedText;
  const lower = full.toLowerCase();
  const isPhd = o.type === 'phd' || /\b(phd|studentship|doctoral|dphil)\b/i.test(o.title || '');
  const level = isPhd ? 'PhD / studentship' : /\b(research (assistant|associate|technician)|technician)\b/i.test(o.title || '') ? 'Research assistant / technician' : o.type === 'job' ? 'Job' : (o.type || 'Opportunity');

  const dl = pickDeadline(full, o.deadline, today);
  const start = pickStart(full);
  const pay = money(full);
  const days = dl ? daysBetween(today, dl.iso) : null;

  const blockers = [], positives = [], notes = [];
  for (const r of RULES) {
    if (r.phd && !isPhd) continue; if (r.notPhd && isPhd) continue;
    const hay = r.title ? (o.title || '') : full;
    const hit = r.res.map(re => re.exec(hay)).find(Boolean);
    if (hit) {
      let sev = r.sev;
      if (r.id === 'needs-phd' && /\b(postdoc|post-doc|research fellow|lecturer|professor|senior)\b/i.test(o.title || '')) sev = 'high';
      blockers.push({ id: r.id, sev, text: r.text, quote: snippet(hay, hit.index, hit[0].length) });
    }
  }
  if (blockers.some(b => b.id === 'no-sponsor')) { const i = blockers.findIndex(b => b.id === 'right-to-work'); if (i >= 0) blockers.splice(i, 1); }
  const yrs = /(\d+)\+?\s*(?:years?|yrs)['’]?\s*(?:of\s+)?(?:relevant\s+|proven\s+|industry\s+|professional\s+|post-?(?:graduate|qualification)\s+|laboratory\s+|research\s+)?experience/i.exec(full);
  if (yrs && +yrs[1] >= 2 && !isPhd) blockers.push({ id: 'experience', sev: +yrs[1] >= 4 ? 'high' : 'med', text: `Asks for ${yrs[1]}+ years of experience.`, quote: snippet(full, yrs.index, yrs[0].length) });
  if (days != null && days < 0) blockers.unshift({ id: 'closed', sev: 'high', text: `Deadline has passed (${dl.iso}).`, quote: dl.text });
  else if (days != null && days <= 7) blockers.push({ id: 'tight', sev: 'med', text: days === 0 ? 'Closes today.' : `Closes in ${days} day${days === 1 ? '' : 's'}: very tight.`, quote: dl.text });

  const intlOk = INTL_OK.exec(full), spOk = SPONSOR_OK.exec(full);
  // The weekly scout opened the advert and confirmed international eligibility: trust that over a loose regex hit.
  const scoutIntl = o.intl === true && o.curated;
  if (scoutIntl) { const i = blockers.findIndex(b => b.id === 'home-only'); if (i >= 0) blockers.splice(i, 1); }
  if (intlOk) positives.push({ id: 'intl', text: 'International applicants are welcome / eligible.', quote: snippet(full, intlOk.index, intlOk[0].length) });
  else if (scoutIntl) positives.push({ id: 'intl', text: 'International applicants are eligible (checked by the weekly scout).' });
  if (spOk) positives.push({ id: 'sponsor', text: 'Visa sponsorship is mentioned as possible.', quote: snippet(full, spOk.index, spOk[0].length) });
  if (pay.funded === 'full') positives.push({ id: 'funded', text: 'Funded (fees and/or stipend mentioned).' });
  if (/\b(master'?s|msc|m\.sc)\b/i.test(full) && isPhd) positives.push({ id: 'msc', text: "A master's degree is mentioned: yours counts." });
  if (/london/i.test(full)) positives.push({ id: 'london', text: 'Based in or near London.' });
  const deg = /(2[:.]1|upper[- ]second|first[- ]class|first class honours|1st class)/i.exec(full);
  if (deg) notes.push(`Degree class mentioned: ${deg[0]}. Check your transcript against it.`);
  const ielts = /IELTS[^\n]{0,45}?(?=\)|;|\.\s|\n|$)/i.exec(full); if (ielts) notes.push('English test: ' + ielts[0].replace(/\s+/g, ' ').trim());

  // requirements & how to apply (best from the full page, otherwise the feed summary)
  const S_ = sentences(source === 'page' ? text : feedText);
  const cue = /\b(must|should|required|requires?|essential|desirable|minimum|hold|holds|ideally|expected|need to|equivalent|will have|have a|have an)\b/i;
  const req = { degree: [], skills: [], english: [], eligibility: [] };
  for (const s of S_) {
    if (/\b(english|ielts|toefl|language (test|requirement|proficiency))\b/i.test(s) && cue.test(s)) req.english.push(s);
    else if (/\b(eligib|nationality|right to work|residen|fee status|visa|funding is (open|available))/i.test(s) && !/^(about|read more)/i.test(s)) req.eligibility.push(s);
    else if (/\b(degree|bachelor|master|msc|bsc|honours|first class|2[:.]1|qualification|undergraduate|postgraduate|doctorate|phd)\b/i.test(s) && cue.test(s)) req.degree.push(s);
    else if (/\b(experience|knowledge|skills?|familiar|proficien|ability|competen|understanding|laboratory|hplc|cell culture|python|statistic|gmp|gcp|analytical)\b/i.test(s) && cue.test(s)) req.skills.push(s);
  }
  const used = new Set(Object.values(req).flat());
  const apply = S_.filter(s => !used.has(s) && /\b(apply|application|submit|send|e-?mail|cover letter|personal statement|research proposal|referees?|references|curriculum vitae|\bCV\b)\b/i.test(s) && /\b(please|should|must|to apply|by|via|online|through|include|attach|submit|send|enclose|complete)\b/i.test(s) && !/cookie|privacy|subscribe/i.test(s));
  const contacts = [...new Set((full.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter(e => !/noreply|no-reply|example|sentry|wix/i.test(e)))].slice(0, 3);

  // fit to Ocha's profile
  const titleLow = (o.title || '').toLowerCase(); const hits = new Set(); let titleHits = 0, bodyHits = 0;
  for (const k of profile.keywords || []) { const kk = k.toLowerCase().trim(); if (!kk) continue; if (titleLow.includes(kk)) { titleHits++; hits.add(k); } else if (lower.includes(kk)) { bodyHits++; hits.add(k); } }
  for (const a of profile.avoid || []) if (a && lower.includes(a.toLowerCase())) blockers.push({ id: 'avoid', sev: 'med', text: `Mentions "${a}", which you wanted to avoid.` });

  // priority 1..99 (one shared formula, so "Explain the number" always matches)
  const { pr, nHigh } = scorePriority({ titleHits, bodyHits, intl: !!intlOk || scoutIntl, sponsor: !!spOk, funded: pay.funded === 'full', pay: !!pay.pay, blockers, days, london: /london/i.test(full), isPhd, curated: !!o.curated });
  const verdict = nHigh ? 'skip' : pr >= 68 ? 'top' : pr >= 50 ? 'good' : pr >= 34 ? 'maybe' : 'low';
  const firstHigh = blockers.find(b => b.sev === 'high'), firstMed = blockers.find(b => b.sev === 'med');
  const verdictText = {
    top: `Strong match: it fits your field${positives[0] ? ' and ' + positives[0].text.toLowerCase().replace(/\.$/, '') : ''}, and nothing blocks you so far.`,
    good: `Worth a proper look.${firstMed ? ' Check first: ' + firstMed.text : ' Nothing blocks you so far.'}`,
    maybe: `A possible long shot.${firstMed ? ' ' + firstMed.text : ' The fit with your profile is moderate.'}`,
    low: 'Weak match for your profile: only apply if nothing better comes up.',
    skip: `Probably not for you: ${firstHigh ? firstHigh.text : 'a hard requirement does not fit.'}`,
  }[verdict];
  const nextStep = verdict === 'skip' ? 'Flag it as not relevant to clear it from your list.' : isPhd
    ? (contacts.length ? `Email the contact (${contacts[0]}) with your CV before applying: supervisors often answer within a week.` : 'Check the supervisor or project page, then email them your CV and a 3-line interest message before applying.')
    : 'Tailor your CV to the person specification and apply while the advert is open.';

  return {
    id: o.id, title: o.title || pageTitle, org: o.org || '', link: o.link, level, source,
    deadline: dl ? dl.iso : null, deadlineText: dl ? dl.text : '', daysLeft: days,
    start: start ? start.label : '', pay: pay.pay || '', fees: pay.fees || '', funded: pay.funded,
    location: o.location || (/london/i.test(full) ? 'London' : ''), contacts,
    blockers, positives, notes, requirements: Object.fromEntries(Object.entries(req).map(([k, v]) => [k, uniq(v, 5)])),
    howToApply: uniq(apply, 5), hits: [...hits].slice(0, 8),
    priority: pr, verdict, verdictText, nextStep,
    analysedAt: today, expires: dl ? addDays(dl.iso, 3) : addDays(today, 30),
  };
}
// The priority formula, step by step. Returns the total and every part that moved it.
export function scorePriority(f) {
  const parts = [{ key: 'base', pts: 25, label: 'Starting point for every advert' }];
  const add = (key, pts, label) => { if (pts) parts.push({ key, pts, label }); };
  add('fit', Math.min(32, f.titleHits * 12 + Math.min(18, f.bodyHits * 3)), 'Matches your field');
  if (f.intl) add('intl', 14, 'Says international applicants are welcome');
  if (f.sponsor) add('sponsor', 8, 'Mentions visa sponsorship');
  if (f.funded) add('funded', f.isPhd ? 8 : 3, f.isPhd ? 'Fully funded PhD' : 'Funding mentioned');
  if (f.pay) add('pay', 3, 'States the pay or stipend');
  const nHigh = f.blockers.filter(b => b.sev === 'high').length, nMed = f.blockers.filter(b => b.sev === 'med').length;
  add('high', -Math.min(60, nHigh * 40), nHigh === 1 ? 'A hard blocker' : `${nHigh} hard blockers`);
  add('med', -Math.min(25, nMed * 10), nMed === 1 ? 'Something to check first' : `${nMed} things to check first`);
  if (f.days != null && f.days >= 7 && f.days <= 75) add('time', 8, 'Deadline is comfortably ahead (1 week to 2.5 months)');
  else if (f.days != null && f.days > 75) add('time', 3, 'Deadline is far off');
  if (f.london) add('london', 3, 'In or near London');
  if (f.isPhd) add('phd', 4, 'A PhD: your first goal');
  if (f.curated) add('curated', 8, 'Hand-picked by the weekly AI scout');
  const raw = parts.reduce((t, p) => t + p.pts, 0);
  return { pr: Math.max(1, Math.min(99, Math.round(raw))), raw, parts, nHigh, nMed };
}

// Rebuild the breakdown from a finished analysis (works for cached full reads too).
export function explainPriority(a, o = {}) {
  const tl = (o.title || a.title || '').toLowerCase();
  const hits = a.hits || [];
  const titleHits = hits.filter(k => tl.includes(k.toLowerCase())).length;
  const has = id => a.positives.some(p => p.id === id);
  const isPhd = /^PhD/.test(a.level || '');
  const r = scorePriority({ titleHits, bodyHits: hits.length - titleHits, intl: has('intl'), sponsor: has('sponsor'), funded: a.funded === 'full', pay: !!a.pay, blockers: a.blockers, days: a.daysLeft, london: has('london'), isPhd, curated: !!o.curated });
  return { ...r, hits, titleHits, isPhd, matches: r.pr === a.priority };
}

function snippet(s, i, len) { const a = Math.max(0, i - 60), b = Math.min(s.length, i + len + 60); return (a ? '…' : '') + s.slice(a, b).replace(/\s+/g, ' ').trim() + (b < s.length ? '…' : ''); }
function addDays(isoStr, n) { const d = new Date(Date.parse(isoStr) + n * 86400000); return d.toISOString().slice(0, 10); }

export const VERDICT = {
  top: { label: 'Start here', icon: '🌟', cls: 'v-top' }, good: { label: 'Worth a look', icon: '👍', cls: 'v-good' },
  maybe: { label: 'Long shot', icon: '🤔', cls: 'v-maybe' }, low: { label: 'Low priority', icon: '💤', cls: 'v-low' },
  skip: { label: 'Probably not for you', icon: '🚫', cls: 'v-skip' },
};

export function toMarkdown(a) {
  const L = [];
  L.push('---', `type: opportunity-analysis`, `id: ${a.id}`, `title: ${fmQuote(a.title)}`, `url: ${a.link}`, `deadline: ${a.deadline || ''}`, `priority: ${a.priority}`, `verdict: ${a.verdict}`,
    `read-from: ${a.source === 'page' ? 'full advert' : 'feed summary only'}`, `analysed: ${a.analysedAt}`, `expires: ${a.expires}`, '---', '');
  L.push(`# ${a.title}`, '', `**${VERDICT[a.verdict].icon} ${VERDICT[a.verdict].label}** (priority ${a.priority}/99). ${a.verdictText}`, '', `**Next step:** ${a.nextStep}`, '');
  L.push('## Key facts', '', '| | |', '|---|---|');
  const row = (k, v) => v && L.push(`| ${k} | ${String(v).replace(/\|/g, '/')} |`);
  row('Type', a.level); row('Organisation', a.org); row('Deadline', a.deadline ? `${a.deadline}${a.daysLeft != null ? ` (${a.daysLeft < 0 ? 'passed' : a.daysLeft + ' days left'})` : ''}` : 'Not found: check the advert');
  row('Starts', a.start); row('Pay / stipend', a.pay); row('Fees', a.fees); row('Funding', { full: 'Funded', none: 'Not funded', unknown: '' }[a.funded]); row('Location', a.location); row('Contact', a.contacts.join(', '));
  L.push('');
  if (a.blockers.length) { L.push('## Check before you apply', ''); a.blockers.forEach(b => L.push(`- ${b.sev === 'high' ? '🚩' : '⚠️'} **${b.text}**${b.quote ? ` — "${b.quote}"` : ''}`)); L.push(''); }
  if (a.positives.length) { L.push('## In your favour', ''); a.positives.forEach(b => L.push(`- ✅ ${b.text}`)); L.push(''); }
  const R = a.requirements, rs = [['Degree / qualifications', R.degree], ['Skills & experience', R.skills], ['English', R.english], ['Eligibility', R.eligibility]].filter(([, v]) => v && v.length);
  if (rs.length) { L.push('## What they ask for', ''); rs.forEach(([k, v]) => { L.push(`**${k}**`, ''); v.forEach(x => L.push(`- ${x}`)); L.push(''); }); }
  if (a.notes.length) { L.push('## Notes', ''); a.notes.forEach(n => L.push(`- ${n}`)); L.push(''); }
  if (a.howToApply.length) { L.push('## How to apply', ''); a.howToApply.forEach(x => L.push(`- ${x}`)); L.push(''); }
  if (a.hits.length) L.push('## Fit with your profile', '', `Matches: ${a.hits.join(', ')}.`, '');
  L.push('---', '', `[Open the original advert](${a.link}). ${a.source === 'page' ? 'Read from the full advert' : 'Quick read from the feed summary only (open the advert to confirm details)'} on ${a.analysedAt}. This summary is automatic: always confirm deadlines and eligibility on the advert itself.`);
  return L.join('\n');
}
