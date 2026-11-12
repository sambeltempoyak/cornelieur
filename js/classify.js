// Decides what a document is (CV, transcript, draft, paper...) and where it should be filed.
// Pure functions: filename + opening text -> category, topic, folder, nice title.
import { DIR_MAP } from './folders.js';

const has = (re, s) => re.test(s);
export const CATS = {
  cv: { label: 'CV & application letters', icon: '🧾' },
  cert: { label: 'Transcripts & certificates', icon: '🎓' },
  draft: { label: 'Drafts & proposals', icon: '✍️' },
  ref: { label: 'References & letters', icon: '✉️' },
  paper: { label: 'Papers', icon: '📚' },
  other: { label: 'Other', icon: '📎' },
};
export const TOPICS = [
  ['Drug delivery & formulation', /(nanoparticle|liposom|drug delivery|formulation|excipient|encapsulat|controlled release|transdermal|micelle|hydrogel|dissolution)/gi],
  ['Pharmacokinetics & pharmacology', /(pharmacokinetic|pharmacodynamic|bioavailab|clearance|half-life|dose[- ]response|receptor|ADME|pharmacolog)/gi],
  ['Antimicrobial & microbiology', /(antimicrobial|antibiotic|resistan|bacteri|biofilm|microbio|antifungal|pathogen)/gi],
  ['Biotech & bioprocess', /(bioprocess|fermentation|recombinant|CRISPR|cell culture|monoclonal|biologic|biosimilar|protein expression|gene therapy|mRNA|vaccine)/gi],
  ['Clinical & regulatory', /(clinical trial|regulatory|MHRA|\bEMA\b|\bFDA\b|\bGMP\b|pharmacovigilance|marketing authori|randomi[sz]ed|patients? (were|was)|adverse (event|reaction))/gi],
  ['Data science & statistics', /(machine learning|random forest|neural network|regression|statistical|bayesian|deep learning|R package|python|cheminformatics|QSAR)/gi],
];

export function pickTopic(text) {
  let best = null, bn = 1;
  for (const [name, re] of TOPICS) { const n = (text.match(re) || []).length; if (n > bn) { bn = n; best = name; } }
  return best || 'General';
}

/**
 * @param name   original file name
 * @param text   extracted text (first ~6000 chars is enough)
 * @param pages  page count (0 if unknown)
 */
export function classify(name, text, pages = 0) {
  const fn = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
  const head = (text || '').slice(0, 6000);
  const low = head.toLowerCase();
  const reasons = []; let cat = 'other', conf = 0.4;
  const rule = (c, ok, why, strength) => { if (ok && strength > conf) { cat = c; conf = strength; reasons.length = 0; reasons.push(why); } };

  // filename hints (strong)
  rule('cv', has(/\b(cv|curriculum vitae|resume|résumé)\b/i, fn), 'file name says CV', 0.9);
  rule('cv', has(/\b(cover letter|motivation(al)? letter|personal statement|statement of purpose|letter of motivation|surat lamaran)\b/i, fn), 'file name says cover letter / statement', 0.9);
  rule('cert', has(/\b(transcript|transkrip|\btor\b|ijazah|certificate|sertifikat|degree cert|ielts|toefl|score report|mark ?sheet|academic record|grade report|diploma)\b/i, fn), 'file name says transcript / certificate', 0.9);
  rule('ref', has(/\b(reference|recommendation|referee|testimonial|surat rekomendasi)\b/i, fn), 'file name says reference letter', 0.85);
  rule('draft', has(/\b(proposal|draft|thesis|dissertation|manuscript|chapter|protocol|essay|report|outline|skripsi|tesis)\b/i, fn), 'file name says draft / proposal', 0.7);

  // content hints
  const cvHeads = (low.match(/\b(work experience|professional experience|employment history|education|skills|languages|publications|references available|key skills|technical skills|volunteer)\b/g) || []).length;
  rule('cv', cvHeads >= 3 && !has(/\babstract\b/, low) && pages <= 4, 'has CV-style sections (experience, education, skills)', 0.8);
  rule('cv', has(/\bdear (sir|madam|hiring|dr|prof|mr|ms|mrs)\b/, low) && has(/\b(yours (sincerely|faithfully)|kind regards|i am writing to apply|i am applying)\b/, low), 'reads like a cover letter', 0.8);
  rule('cert', has(/\b(transcript of records|academic transcript|this is to certify|has been awarded|degree of|grade point average|\bgpa\b|credits? earned|cumulative)\b/, low) && !has(/\babstract\b/, low), 'reads like a transcript / certificate', 0.78);
  rule('ref', has(/\b(i am pleased to recommend|i have known|recommend (her|him|them|the candidate)|to whom it may concern)\b/, low), 'reads like a reference letter', 0.8);
  const paperSig = (has(/\babstract\b/, low) ? 1 : 0) + (has(/\b(doi|10\.\d{4,9}\/)/i, head) ? 1 : 0) + (has(/\b(et al\.|keywords?:|introduction|materials and methods|methods|results and discussion)\b/i, head) ? 1 : 0) + (has(/\b(journal|elsevier|springer|wiley|nature|plos|frontiers|mdpi|taylor|acs |received:|accepted:)\b/i, head) ? 1 : 0) + (pages >= 5 ? 1 : 0);
  rule('paper', paperSig >= 3, 'looks like a journal article (abstract, DOI, methods…)', 0.55 + paperSig * 0.08);
  rule('draft', has(/\b(research proposal|proposed research|research questions?|aims and objectives|work plan|timeline)\b/, low) && !has(/\bdoi\b/, low) && cat !== 'paper', 'reads like a proposal / plan', 0.65);

  const topic = cat === 'paper' ? pickTopic(text || '') : '';
  const folder = cat === 'paper' ? `${DIR_MAP.papers}/${topic}` : DIR_MAP[cat];
  return { cat, topic, folder, conf, reasons: reasons[0] || 'no clear signal: filed under Other' };
}

export function niceTitle(name, mdTitle, cat) {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cat === 'paper' && mdTitle && mdTitle.length > 12) return mdTitle.replace(/\s+/g, ' ').trim().slice(0, 110);
  return base || 'Untitled';
}
