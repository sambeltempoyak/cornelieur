// Lesson content. Step types:
//  learn {title, body}           — short explainer card (HTML)
//  mcq   {q, options, a, why}    — multiple choice (a = index of the right option)
//  fill  {q, answers, why}       — type a short answer (any of answers, case-insensitive)
//  order {q, items, why}         — tap items into the right order (items given in correct order)
//  code  {lang:'r'|'py', task, starter, setup, check, hint, solution, packages}
//        check = R/Python expression that is TRUE when the task is done (null = just run without error)

const PK_SETUP = `pk <- data.frame(
  time = c(0.5, 1, 2, 4, 6, 8, 12, 24),
  conc = c(4.1, 6.8, 8.9, 7.2, 5.4, 4.0, 2.3, 0.45)
)`;

const ML_SETUP = `import numpy as np, pandas as pd
rng = np.random.default_rng(0)
n = 400
X = pd.DataFrame({'MW': rng.normal(380, 90, n), 'logP': rng.normal(2.5, 1.3, n), 'HBD': rng.integers(0, 7, n), 'TPSA': rng.normal(85, 30, n)})
logit = 0.9*(X.logP-2.5) - 0.025*(X.TPSA-85) - 0.004*(X.MW-380) - 0.25*(X.HBD-3)
y = (rng.random(n) < 1/(1+np.exp(-2*logit))).astype(int)`;
const ML_MODEL = ML_SETUP + `
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=1)
model = LogisticRegression(max_iter=1000).fit(X_tr, y_tr)`;

export const UNITS = [
  {
    id: 'u1', title: 'Pharmacy refresher', icon: '💊',
    blurb: 'Warm up with what you already know — pharmacokinetics, pharmacodynamics and how drugs reach patients.',
    lessons: [
      {
        id: 'u1l1', title: 'ADME in one breath', blurb: 'Absorption, distribution, metabolism, excretion', steps: [
          { t: 'learn', title: 'Where does a dose go?', body: `<p>Every drug's journey has four stages — <b>ADME</b>:</p><ul><li><b>Absorption</b> — from the site of administration into the blood.</li><li><b>Distribution</b> — out of the blood into tissues. Protein binding and lipophilicity shape this.</li><li><b>Metabolism</b> — mostly in the liver (CYP450 enzymes), turning drugs into more polar metabolites.</li><li><b>Excretion</b> — mainly via kidneys (urine) or bile (faeces).</li></ul><div class="callout"><b>Bioavailability (F)</b> is the fraction of a dose that reaches the systemic circulation unchanged. IV dosing has F = 1 by definition.</div>` },
          { t: 'order', q: 'Put the ADME stages in order for an oral tablet.', items: ['Absorption', 'Distribution', 'Metabolism', 'Excretion'], why: 'A — D — M — E. (In reality they overlap in time, but this is the logical sequence.)' },
          { t: 'mcq', q: 'First-pass metabolism mostly reduces which parameter of an oral drug?', options: ['Volume of distribution', 'Bioavailability', 'Renal clearance', 'Elimination half-life'], a: 1, why: 'Drug absorbed from the gut passes through the liver before reaching the systemic circulation, so less arrives unchanged — lower F.' },
          { t: 'fill', q: 'The fraction of an oral dose reaching the systemic circulation unchanged is called its ______.', answers: ['bioavailability', 'F', 'oral bioavailability'], why: 'Bioavailability (F).' },
          { t: 'mcq', q: 'A drug is 99% bound to plasma albumin. A second drug displaces it to 98% bound. What happens to the FREE fraction?', options: ['Falls by about 1%', 'Roughly doubles (1% → 2%)', 'Stays the same', 'Becomes zero'], a: 1, why: 'Free fraction goes from 1% to 2% — doubled. This is why displacement matters most for highly bound, narrow-therapeutic-index drugs (though clearance often compensates in practice).' },
        ]
      },
      {
        id: 'u1l2', title: 'Half-life, clearance & volume', blurb: 'The three numbers that drive dosing', steps: [
          { t: 'learn', title: 'One equation to remember', body: `<p><b>Clearance (CL)</b> is the volume of plasma cleared of drug per unit time (L/h). <b>Volume of distribution (Vd)</b> links the amount in the body to plasma concentration. Together they set the <b>half-life</b>:</p><p style="font-size:20px;text-align:center"><b>t½ = 0.693 × Vd / CL</b></p><ul><li>About <b>5 half-lives</b> to reach steady state on repeated dosing — or to (almost) wash out.</li><li><b>AUC = F × Dose / CL</b> — total exposure.</li></ul>` },
          { t: 'mcq', q: 'Vd = 50 L and CL = 5 L/h. What is the half-life?', options: ['0.1 h', 'About 6.9 h', '10 h', '250 h'], a: 1, why: '0.693 × 50 / 5 = 6.93 h.' },
          { t: 'mcq', q: 'Roughly how many half-lives until about 97% of a drug has been eliminated?', options: ['1', '2', '5', '20'], a: 2, why: 'After 5 half-lives, 1/2⁵ ≈ 3% remains.' },
          { t: 'mcq', q: 'For a drug with linear kinetics, you double the dose. What happens?', options: ['AUC doubles, half-life unchanged', 'Half-life doubles', 'AUC quadruples', 'Clearance halves'], a: 0, why: 'In linear PK, exposure scales with dose; CL, Vd and t½ do not change.' },
          { t: 'mcq', q: 'Kidney function falls in a patient taking a renally cleared drug. Which is most likely?', options: ['CL rises, t½ falls', 'CL falls, t½ rises', 'Vd falls, nothing else', 'Bioavailability falls'], a: 1, why: 'Lower renal clearance → slower elimination → longer half-life, and drug can accumulate.' },
        ]
      },
      {
        id: 'u1l3', title: 'Pharmacodynamics', blurb: 'Potency, efficacy and the therapeutic window', steps: [
          { t: 'learn', title: 'What the drug does to the body', body: `<ul><li><b>Emax</b> — maximum effect a drug can produce (efficacy).</li><li><b>EC50</b> — concentration giving 50% of Emax. Lower EC50 = more <b>potent</b>.</li><li><b>Full agonist</b> reaches the system's maximum; <b>partial agonist</b> can't, even at high doses; <b>antagonist</b> binds without activating.</li><li><b>Therapeutic index</b> — ratio of toxic to effective dose. Narrow TI drugs (warfarin, digoxin, lithium) need monitoring.</li></ul>` },
          { t: 'mcq', q: 'Drug A has EC50 = 2 nM, drug B has EC50 = 20 nM, same Emax. Which is true?', options: ['A is more efficacious', 'A is more potent', 'B is more potent', 'They are identical'], a: 1, why: 'Same maximum effect (efficacy) but A needs a tenfold lower concentration — more potent.' },
          { t: 'mcq', q: 'Buprenorphine at the mu-opioid receptor is a classic example of…', options: ['A full agonist', 'A partial agonist', 'An inverse agonist', 'A competitive antagonist'], a: 1, why: 'Buprenorphine is a partial agonist — part of why it has a ceiling on respiratory depression.' },
          { t: 'fill', q: 'A drug with a small gap between effective and toxic doses has a narrow therapeutic ______.', answers: ['index', 'window', 'range'], why: 'Narrow therapeutic index (or window).' },
        ]
      },
      {
        id: 'u1l4', title: 'From lab to patient', blurb: 'Clinical phases & UK regulation', steps: [
          { t: 'learn', title: 'The pipeline', body: `<table><tr><th>Stage</th><th>Main question</th></tr><tr><td>Preclinical</td><td>Is it active and safe enough in cells and animals?</td></tr><tr><td>Phase I</td><td>Safety, tolerability and PK — often healthy volunteers</td></tr><tr><td>Phase II</td><td>Does it work? Which dose?</td></tr><tr><td>Phase III</td><td>Large confirmatory trials vs standard care</td></tr><tr><td>Phase IV</td><td>Post-marketing safety (pharmacovigilance)</td></tr></table><p>In the UK the regulator is the <b>MHRA</b>. Global technical standards come from <b>ICH</b> guidelines — e.g. <b>E6</b> Good Clinical Practice and the <b>Q</b> (quality) series. "<b>GxP</b>" is the umbrella for GMP, GLP, GCP…</p>` },
          { t: 'order', q: 'Order these stages of drug development.', items: ['Preclinical studies', 'Phase I', 'Phase II', 'Phase III', 'Phase IV'], why: 'Preclinical → I → II → III → (approval) → IV.' },
          { t: 'mcq', q: "The UK's Yellow Card scheme, run by the MHRA, is part of…", options: ['GMP inspections', 'Pharmacovigilance', 'Clinical trial randomisation', 'Patent law'], a: 1, why: 'Yellow Card collects suspected adverse drug reactions — a pharmacovigilance tool. Pharmacovigilance is a big employer of pharmacy graduates.' },
          { t: 'mcq', q: 'ICH Q2 deals with…', options: ['Validation of analytical procedures', 'Clinical trial ethics', 'Drug pricing', 'Animal welfare'], a: 0, why: 'ICH Q2(R2) covers analytical method validation — accuracy, precision, specificity, linearity… Core knowledge for QC and analytical roles.' },
          { t: 'mcq', q: 'Which job title is mostly about compiling dossiers for the MHRA/EMA?', options: ['Formulation scientist', 'Regulatory affairs officer', 'QC analyst', 'Medical science liaison'], a: 1, why: 'Regulatory affairs prepares and maintains marketing authorisation submissions.' },
        ]
      },
    ]
  },
  {
    id: 'u2', title: 'Thinking in data', icon: '📊',
    blurb: 'Statistics intuition before any code — the part employers and PhD panels actually test.',
    lessons: [
      {
        id: 'u2l1', title: 'Variables & summaries', blurb: 'Mean, median, spread', steps: [
          { t: 'learn', title: 'Know your variable', body: `<ul><li><b>Continuous</b> — concentration, weight, blood pressure.</li><li><b>Categorical</b> — treatment arm, sex, responder yes/no.</li><li><b>Ordinal</b> — categories with order, like pain score 0–10 or mild/moderate/severe.</li></ul><p>For skewed data the <b>median</b> is more honest than the mean. PK parameters like Cmax and AUC are usually <b>log-normally</b> distributed, so they're summarised with the <b>geometric mean</b>.</p><div class="callout">Spread: <b>SD</b> describes the data; <b>SE</b> (= SD/√n) describes how precisely you estimated the mean.</div>` },
          { t: 'mcq', q: 'Cmax values across 30 volunteers are strongly right-skewed. Best summary?', options: ['Arithmetic mean ± SD', 'Geometric mean (or median)', 'Mode', 'Maximum value'], a: 1, why: 'Log-normal PK data → geometric mean. Bioequivalence studies compare geometric mean ratios.' },
          { t: 'mcq', q: 'Pain on a 0–10 scale is…', options: ['Continuous', 'Nominal categorical', 'Ordinal', 'Binary'], a: 2, why: 'Ordered categories without guaranteed equal spacing — ordinal.' },
          { t: 'mcq', q: 'You quadruple the sample size. The standard error of the mean…', options: ['Halves', 'Quarters', 'Doubles', 'Stays the same'], a: 0, why: 'SE = SD/√n, and √4 = 2.' },
        ]
      },
      {
        id: 'u2l2', title: 'Study design', blurb: 'Randomisation, blinding, crossover', steps: [
          { t: 'learn', title: 'Why trials look the way they do', body: `<ul><li><b>Randomisation</b> balances known and unknown confounders between arms.</li><li><b>Blinding</b> stops expectations (patients' and assessors') from biasing outcomes.</li><li><b>Placebo/active control</b> gives a fair comparison.</li><li><b>Crossover</b> designs give each subject both treatments in sequence, with a washout — each person is their own control. Standard for bioequivalence.</li></ul>` },
          { t: 'mcq', q: 'The main purpose of randomisation is to…', options: ['Make the trial cheaper', 'Balance confounders between groups', 'Hide the treatment from patients', 'Increase the effect size'], a: 1, why: 'Hiding treatment is blinding; randomisation is about comparable groups.' },
          { t: 'mcq', q: 'A generic vs brand bioequivalence study is most often…', options: ['A parallel-group efficacy trial', 'A two-period crossover in healthy volunteers', 'A case–control study', 'An open-label Phase III'], a: 1, why: 'Two-way crossover with PK sampling (AUC, Cmax) is the classic design.' },
          { t: 'mcq', q: 'Neither the patients nor the outcome assessors know the allocation. That is…', options: ['Open-label', 'Single-blind', 'Double-blind', 'Allocation concealment only'], a: 2, why: 'Double-blind (commonly patient + investigator/assessor).' },
        ]
      },
      {
        id: 'u2l3', title: 'p-values & confidence intervals', blurb: 'What they really mean', steps: [
          { t: 'learn', title: 'Two tools, one idea', body: `<p>A <b>p-value</b> is the probability of seeing data at least this extreme <i>if the null hypothesis were true</i>. It is <u>not</u> the probability that the null is true.</p><p>A <b>95% confidence interval</b> is a range produced by a method that captures the true value in 95% of repeated studies. If a 95% CI for a <i>difference</i> excludes 0 (or for a <i>ratio</i> excludes 1), p &lt; 0.05.</p><div class="callout">Bioequivalence: the <b>90% CI</b> of the test/reference geometric mean ratio must lie within <b>80–125%</b>.</div>` },
          { t: 'mcq', q: 'p = 0.03. Which statement is correct?', options: ['There is a 3% chance the drug does nothing', 'If the drug truly did nothing, data this extreme would occur about 3% of the time', 'The drug works in 97% of patients', 'The effect is large'], a: 1, why: 'p is about the data assuming the null — not about the hypothesis itself, nor the size of the effect.' },
          { t: 'mcq', q: 'Mean difference in blood pressure: −4 mmHg, 95% CI −9 to +1. Conclusion at 5%?', options: ['Significant reduction', 'Not statistically significant', 'Significant increase', 'Cannot tell'], a: 1, why: 'The interval includes 0.' },
          { t: 'mcq', q: 'A bioequivalence 90% CI for the AUC ratio is 84–118%. Verdict?', options: ['Bioequivalent for AUC', 'Not bioequivalent', 'Superior', 'Need p-value'], a: 0, why: 'Entirely inside 80–125%.' },
        ]
      },
      {
        id: 'u2l4', title: 'Choosing the right test', blurb: 'A decision map you will use forever', steps: [
          { t: 'learn', title: 'The cheat-sheet', body: `<table><tr><th>Question</th><th>Typical test</th></tr><tr><td>2 independent groups, continuous, ~normal</td><td>t-test (Welch)</td></tr><tr><td>Same subjects measured twice</td><td>Paired t-test</td></tr><tr><td>2 groups, skewed/ordinal</td><td>Mann–Whitney U</td></tr><tr><td>3+ groups</td><td>ANOVA (or Kruskal–Wallis)</td></tr><tr><td>Two categorical variables</td><td>Chi-square / Fisher's exact</td></tr><tr><td>Relationship between two continuous</td><td>Correlation / linear regression</td></tr><tr><td>Time until an event</td><td>Kaplan–Meier, log-rank, Cox</td></tr></table>` },
          { t: 'mcq', q: 'HbA1c before and after 12 weeks in the same 40 patients.', options: ['Independent t-test', 'Paired t-test', 'Chi-square', 'Log-rank'], a: 1, why: 'Same subjects twice → paired.' },
          { t: 'mcq', q: 'Proportion of responders (yes/no) in drug vs placebo.', options: ['Chi-square or Fisher\'s exact', 'ANOVA', 'Pearson correlation', 'Paired t-test'], a: 0, why: 'Two categorical variables (arm × response).' },
          { t: 'mcq', q: 'Time to relapse in two arms, some patients never relapse during follow-up.', options: ['t-test on time', 'Kaplan–Meier + log-rank', 'Chi-square', 'Linear regression'], a: 1, why: 'Censored time-to-event data → survival methods.' },
          { t: 'mcq', q: 'Tablet dissolution (%) for 4 formulations.', options: ['Paired t-test', 'One-way ANOVA', 'Fisher\'s exact', 'Log-rank'], a: 1, why: 'One continuous outcome, more than two groups.' },
        ]
      },
    ]
  },
  {
    id: 'u3', title: 'First steps in R', icon: '🅡',
    blurb: 'R runs right here in your browser. Nothing to install — type, press Run, see the answer.',
    lessons: [
      {
        id: 'u3l1', title: 'R as a calculator', blurb: 'Objects and assignment', steps: [
          { t: 'learn', title: 'Meet R', body: `<p>R is the language most used for statistics in academia and, increasingly, in pharma (the FDA accepts R-based submissions). The first exercise below will download R into this page — it takes ~20 seconds the first time.</p><ul><li>Type maths directly: <code>0.693 * 50 / 5</code></li><li>Store a value with the arrow: <code>vd &lt;- 50</code> (read it as "vd gets 50")</li><li>Type a name to see its value: <code>vd</code></li><li><code>#</code> starts a comment — R ignores it.</li></ul>` },
          { t: 'code', lang: 'r', task: 'Store Vd = 50 and CL = 5 in objects called <code>vd</code> and <code>cl</code>, then compute the half-life into an object called <code>t_half</code>.', starter: `vd <- 50\ncl <- 5\n# t½ = 0.693 × Vd / CL\nt_half <- \nt_half`, check: 'abs(t_half - 0.693*50/5) < 0.05', hint: 'Use the objects: t_half <- 0.693 * vd / cl', solution: `vd <- 50\ncl <- 5\nt_half <- 0.693 * vd / cl\nt_half` },
          { t: 'mcq', q: 'What does <code>dose &lt;- 250</code> do?', options: ['Prints 250', 'Checks if dose is less than −250', 'Stores 250 in an object called dose', 'Nothing'], a: 2, why: '<- is assignment.' },
          { t: 'code', lang: 'r', task: 'Use <code>log()</code> (natural log) to compute the elimination rate constant <code>k</code> from the half-life: k = ln(2) / t½, with t½ = 6.93.', starter: `t_half <- 6.93\nk <- \nk`, check: 'abs(k - log(2)/6.93) < 0.001', hint: 'k <- log(2) / t_half', solution: `t_half <- 6.93\nk <- log(2) / t_half\nk` },
        ]
      },
      {
        id: 'u3l2', title: 'Vectors', blurb: 'Many numbers at once', steps: [
          { t: 'learn', title: 'c() combines values', body: `<p>A <b>vector</b> holds several values of the same type: <code>conc &lt;- c(4.1, 6.8, 8.9)</code></p><p>Functions then work on the whole vector: <code>mean(conc)</code>, <code>max(conc)</code>, <code>length(conc)</code>, <code>sd(conc)</code>. Maths is element-wise: <code>conc * 1000</code> converts every value.</p><p>Pick elements with square brackets: <code>conc[2]</code> is the second value (R counts from 1).</p>` },
          { t: 'code', lang: 'r', task: 'Plasma concentrations (mg/L) were 4.1, 6.8, 8.9, 7.2, 5.4. Put them in a vector <code>conc</code>, then store the peak in <code>cmax</code> and the average in <code>avg</code>.', starter: `conc <- c(4.1, 6.8, 8.9, 7.2, 5.4)\ncmax <- \navg <- \ncmax; avg`, check: 'isTRUE(all.equal(cmax, 8.9)) && abs(avg - mean(c(4.1,6.8,8.9,7.2,5.4))) < 1e-6', hint: 'max(conc) and mean(conc)', solution: `conc <- c(4.1, 6.8, 8.9, 7.2, 5.4)\ncmax <- max(conc)\navg <- mean(conc)\ncmax; avg` },
          { t: 'mcq', q: 'With <code>conc &lt;- c(4.1, 6.8, 8.9)</code>, what is <code>conc[2]</code>?', options: ['4.1', '6.8', '8.9', 'Error'], a: 1, why: 'R indexes from 1.' },
          { t: 'code', lang: 'r', task: 'Convert the vector to µg/L (×1000) and store it in <code>conc_ug</code>. Then use <code>which.max()</code> to find the POSITION of the peak, stored in <code>peak_at</code>.', starter: `conc <- c(4.1, 6.8, 8.9, 7.2, 5.4)\nconc_ug <- \npeak_at <- \nconc_ug; peak_at`, check: 'isTRUE(all.equal(conc_ug, c(4.1,6.8,8.9,7.2,5.4)*1000)) && peak_at == 3', hint: 'conc * 1000 and which.max(conc)', solution: `conc <- c(4.1, 6.8, 8.9, 7.2, 5.4)\nconc_ug <- conc * 1000\npeak_at <- which.max(conc)\nconc_ug; peak_at` },
        ]
      },
      {
        id: 'u3l3', title: 'Data frames', blurb: 'Your spreadsheet inside R', steps: [
          { t: 'learn', title: 'Rows are observations, columns are variables', body: `<p>A <b>data frame</b> is a table. A PK profile is already loaded for you as <code>pk</code> with columns <code>time</code> (h) and <code>conc</code> (mg/L).</p><ul><li><code>head(pk)</code> — first rows</li><li><code>pk$conc</code> — one column as a vector</li><li><code>nrow(pk)</code> — number of rows</li><li><code>pk[pk$time &gt;= 8, ]</code> — rows where time ≥ 8 (note the comma: <i>rows, columns</i>)</li><li><code>summary(pk)</code> — quick overview</li></ul>` },
          { t: 'code', lang: 'r', setup: PK_SETUP, task: 'Look at <code>pk</code> with <code>head()</code>. Then store the number of samples in <code>n</code> and the concentration at 24 h in <code>c24</code>.', starter: `head(pk)\nn <- nrow(pk)\nc24 <- pk$conc[pk$time == 24]\nn; c24`, check: 'n == 8 && isTRUE(all.equal(c24, 0.45))', hint: 'The starter already works — press Run, then read what each line does.', solution: `head(pk)\nn <- nrow(pk)\nc24 <- pk$conc[pk$time == 24]\nn; c24` },
          { t: 'code', lang: 'r', setup: PK_SETUP, task: 'Make a new data frame <code>late</code> with only the samples from 6 h onwards (the elimination phase).', starter: `late <- pk[ , ]\nlate`, check: 'is.data.frame(late) && nrow(late) == 4 && all(late$time >= 6)', hint: 'Put the condition before the comma: pk[pk$time >= 6, ]', solution: `late <- pk[pk$time >= 6, ]\nlate` },
          { t: 'mcq', q: 'In <code>df[1:3, 2]</code>, what do you get?', options: ['Rows 1–3, column 2', 'Columns 1–3, row 2', 'The first 3 data frames', 'An error'], a: 0, why: 'Always [rows, columns].' },
        ]
      },
      {
        id: 'u3l4', title: 'Your own functions', blurb: 'Write once, reuse forever', steps: [
          { t: 'learn', title: 'function(inputs) { body }', body: `<pre><code>bmi &lt;- function(kg, m) {\n  kg / m^2\n}\nbmi(60, 1.65)</code></pre><p>The last line inside the braces is returned. Functions make analysis reproducible: the same calculation, always done the same way.</p>` },
          { t: 'code', lang: 'r', task: 'Write a function <code>half_life(vd, cl)</code> that returns 0.693 × vd / cl. Then try it with 50 and 5.', starter: `half_life <- function(vd, cl) {\n  \n}\nhalf_life(50, 5)`, check: 'is.function(half_life) && abs(half_life(50,5) - 6.93) < 0.01 && abs(half_life(100,10) - 6.93) < 0.01', hint: 'Inside the braces: 0.693 * vd / cl', solution: `half_life <- function(vd, cl) {\n  0.693 * vd / cl\n}\nhalf_life(50, 5)` },
          { t: 'code', lang: 'r', task: 'Write <code>crcl(age, weight, scr, female)</code> for Cockcroft–Gault creatinine clearance (mL/min) with serum creatinine in µmol/L: ((140 − age) × weight × 1.23) / scr, multiplied by 0.85 if female is TRUE. (1.23 is the usual UK constant for males; ×0.85 for females.)', starter: `crcl <- function(age, weight, scr, female = FALSE) {\n  value <- ((140 - age) * weight * 1.23) / scr\n  if (female) {\n    value <- \n  }\n  value\n}\ncrcl(70, 60, 90, female = TRUE)`, check: 'abs(crcl(70,60,90,TRUE) - ((140-70)*60*1.23/90*0.85)) < 0.01 && abs(crcl(70,60,90,FALSE) - (140-70)*60*1.23/90) < 0.01', hint: 'value <- value * 0.85', solution: `crcl <- function(age, weight, scr, female = FALSE) {\n  value <- ((140 - age) * weight * 1.23) / scr\n  if (female) {\n    value <- value * 0.85\n  }\n  value\n}\ncrcl(70, 60, 90, female = TRUE)` },
        ]
      },
    ]
  },
  {
    id: 'u4', title: 'R for pharma analysis', icon: '📈',
    blurb: 'Real tasks: concentration–time plots, AUC, half-life, t-tests and dose–response curves.',
    lessons: [
      {
        id: 'u4l1', title: 'Plot a PK profile', blurb: 'Your first scientific figure', steps: [
          { t: 'learn', title: 'Plots in one line', body: `<p><code>plot(x, y)</code> draws a scatter plot. Useful extras:</p><ul><li><code>type = "b"</code> — points joined by lines</li><li><code>log = "y"</code> — log y-axis (elimination becomes a straight line!)</li><li><code>xlab</code>, <code>ylab</code>, <code>main</code> — labels and title</li></ul><p>Professionals often use the <b>ggplot2</b> package; base plots are perfect to start.</p>` },
          { t: 'code', lang: 'r', setup: PK_SETUP, task: 'Plot concentration against time with points and lines, and label the axes. Press Run and look at the figure below the code.', starter: `plot(pk$time, pk$conc, type = "b",\n     xlab = "Time (h)", ylab = "Concentration (mg/L)",\n     main = "Plasma concentration after an oral dose")`, check: null, hint: 'Just press Run.', solution: `plot(pk$time, pk$conc, type = "b",\n     xlab = "Time (h)", ylab = "Concentration (mg/L)")` },
          { t: 'code', lang: 'r', setup: PK_SETUP, task: 'Now draw it with a <b>log y-axis</b>. Notice the late points fall on a straight line — that\'s first-order elimination.', starter: `plot(pk$time, pk$conc, type = "b", log = "",\n     xlab = "Time (h)", ylab = "Concentration (mg/L, log scale)")`, check: null, hint: 'log = "y"', solution: `plot(pk$time, pk$conc, type = "b", log = "y",\n     xlab = "Time (h)", ylab = "Concentration (mg/L, log scale)")` },
          { t: 'mcq', q: 'Why does the terminal phase look straight on a log-y plot?', options: ['Because the drug is zero-order', 'Because concentration falls by a constant FRACTION per unit time (first-order)', 'Because R draws straight lines', 'Because absorption is complete'], a: 1, why: 'First-order: C = C₀·e^(−kt) → ln C = ln C₀ − kt, a straight line with slope −k.' },
        ]
      },
      {
        id: 'u4l2', title: 'AUC by the trapezoidal rule', blurb: 'Total exposure from samples', steps: [
          { t: 'learn', title: 'Slice it into trapezoids', body: `<p>Between two samples the area is roughly a trapezoid: (t₂ − t₁) × (C₁ + C₂) / 2. Add them all up and you get <b>AUC₀–t</b>.</p><p>In R, <code>diff(pk$time)</code> gives all the time gaps; <code>head(x, -1)</code> drops the last value and <code>tail(x, -1)</code> drops the first — so they line up C₁ with C₂.</p>` },
          { t: 'code', lang: 'r', setup: PK_SETUP, task: 'Compute AUC from the first to the last sample with the linear trapezoidal rule. Store it in <code>auc</code>.', starter: `dt   <- diff(pk$time)\nmeanC <- (head(pk$conc, -1) + tail(pk$conc, -1)) / 2\nauc  <- \nauc`, check: 'abs(auc - sum(diff(pk$time) * (head(pk$conc,-1) + tail(pk$conc,-1))/2)) < 1e-6', hint: 'auc <- sum(dt * meanC)', solution: `dt   <- diff(pk$time)\nmeanC <- (head(pk$conc, -1) + tail(pk$conc, -1)) / 2\nauc  <- sum(dt * meanC)\nauc` },
          { t: 'mcq', q: 'The first sample is at 0.5 h, not 0 h. What does our AUC miss?', options: ['Nothing', 'The area from 0 to 0.5 h (and beyond 24 h)', 'Only the area after 24 h', 'The peak'], a: 1, why: 'Strictly this is AUC₀.₅–₂₄. Analysts add a 0 h point (C = 0 for oral) and extrapolate to infinity with C_last / k.' },
        ]
      },
      {
        id: 'u4l3', title: 'Half-life from data', blurb: 'Your first regression', steps: [
          { t: 'learn', title: 'lm() fits straight lines', body: `<p>Take the log of the terminal concentrations and fit a line against time: <code>fit &lt;- lm(log(conc) ~ time, data = late)</code>.</p><p><code>coef(fit)</code> returns the intercept and slope. The elimination rate constant is <b>k = −slope</b>, and <b>t½ = ln 2 / k</b>.</p><p><code>~</code> reads as "is modelled by". This formula style is used everywhere in R.</p>` },
          { t: 'code', lang: 'r', setup: PK_SETUP, task: 'Using samples from 6 h onwards, fit the log-linear model, then compute <code>k</code> and <code>t_half</code>.', starter: `late <- pk[pk$time >= 6, ]\nfit <- lm(log(conc) ~ time, data = late)\nslope <- coef(fit)[2]\nk <- \nt_half <- \nk; t_half`, check: 'abs(t_half - log(2)/(-coef(lm(log(conc)~time, data=pk[pk$time>=6,]))[2])) < 1e-6', hint: 'k <- -slope ; t_half <- log(2) / k', solution: `late <- pk[pk$time >= 6, ]\nfit <- lm(log(conc) ~ time, data = late)\nslope <- coef(fit)[2]\nk <- -slope\nt_half <- log(2) / k\nk; t_half` },
          { t: 'code', lang: 'r', setup: PK_SETUP + `\nlate <- pk[pk$time >= 6, ]\nfit <- lm(log(conc) ~ time, data = late)`, task: 'Run <code>summary(fit)</code>. Find the R-squared — how well does a straight line fit the log data?', starter: `summary(fit)`, check: null, hint: 'Look for "Multiple R-squared" near the bottom.', solution: `summary(fit)` },
          { t: 'mcq', q: 'If the fitted slope of ln(conc) vs time is −0.115 per hour, t½ is about…', options: ['0.115 h', '6 h', '8.7 h', '115 h'], a: 1, why: '0.693 / 0.115 ≈ 6.0 h.' },
        ]
      },
      {
        id: 'u4l4', title: 'Comparing two treatments', blurb: 't-test on trial data', steps: [
          { t: 'learn', title: 't.test(outcome ~ group)', body: `<p>A small trial dataset <code>trial</code> is loaded: <code>arm</code> ("placebo" or "drug") and <code>sbp_change</code> (change in systolic BP, mmHg).</p><ul><li><code>aggregate(sbp_change ~ arm, data = trial, FUN = mean)</code> — mean by group</li><li><code>boxplot(sbp_change ~ arm, data = trial)</code> — compare visually</li><li><code>t.test(sbp_change ~ arm, data = trial)</code> — Welch two-sample t-test</li></ul><p>Store a test result and pull pieces out: <code>res$p.value</code>, <code>res$conf.int</code>.</p>` },
          { t: 'code', lang: 'r', setup: `set.seed(42)\ntrial <- data.frame(arm = rep(c("placebo","drug"), each = 30), sbp_change = c(rnorm(30, -2, 8), rnorm(30, -9, 8)))`, task: 'Show the mean change per arm and a boxplot, then run the t-test and store its p-value in <code>p</code>.', starter: `aggregate(sbp_change ~ arm, data = trial, FUN = mean)\nboxplot(sbp_change ~ arm, data = trial, ylab = "Change in SBP (mmHg)")\nres <- t.test(sbp_change ~ arm, data = trial)\nres\np <- `, check: 'abs(p - t.test(sbp_change ~ arm, data = trial)$p.value) < 1e-12', hint: 'p <- res$p.value', solution: `aggregate(sbp_change ~ arm, data = trial, FUN = mean)\nboxplot(sbp_change ~ arm, data = trial)\nres <- t.test(sbp_change ~ arm, data = trial)\nres\np <- res$p.value\np` },
          { t: 'mcq', q: 'Why does R default to the Welch t-test rather than the classic Student t-test?', options: ['It is faster', 'It does not assume the two groups have equal variances', 'It works for paired data', 'It needs fewer patients'], a: 1, why: 'Welch is robust to unequal variances and loses little when they are equal.' },
        ]
      },
      {
        id: 'u4l5', title: 'Dose–response curves', blurb: 'Estimating EC50 with nls()', steps: [
          { t: 'learn', title: 'The Emax model', body: `<p>Effect = Emax × C / (EC50 + C). <code>nls()</code> (non-linear least squares) finds the Emax and EC50 that best fit your data. You must give sensible starting guesses.</p><p>Real labs often use a 4-parameter logistic (Hill) model, e.g. in GraphPad Prism or the R package <b>drc</b> — same idea, one more shape parameter.</p>` },
          { t: 'code', lang: 'r', setup: `set.seed(7)\ndr <- data.frame(conc = c(0.1, 0.3, 1, 3, 10, 30, 100))\ndr$effect <- 100 * dr$conc / (4 + dr$conc) + rnorm(7, 0, 2)`, task: 'Fit the Emax model to <code>dr</code> and store the estimated EC50 in <code>ec50</code>. Then plot the data with a log x-axis.', starter: `fit <- nls(effect ~ Emax * conc / (EC50 + conc), data = dr,\n           start = list(Emax = 100, EC50 = 5))\ncoef(fit)\nec50 <- coef(fit)[""]\nplot(dr$conc, dr$effect, log = "x", xlab = "Concentration (µM)", ylab = "% effect")\ncurve(coef(fit)[1] * x / (coef(fit)[2] + x), add = TRUE)`, check: 'abs(ec50 - 4) < 1.5', hint: 'Index by name: coef(fit)["EC50"]', solution: `fit <- nls(effect ~ Emax * conc / (EC50 + conc), data = dr,\n           start = list(Emax = 100, EC50 = 5))\nec50 <- coef(fit)["EC50"]\nplot(dr$conc, dr$effect, log = "x")\ncurve(coef(fit)[1] * x / (coef(fit)[2] + x), add = TRUE)\nec50` },
          { t: 'mcq', q: 'Your fitted EC50 is 4 µM. What does that mean?', options: ['The drug is toxic above 4 µM', 'Half of the maximum effect is reached at 4 µM', '4% of receptors are occupied', 'Effect is 4 at maximum'], a: 1, why: 'EC50 = concentration giving 50% of Emax.' },
        ]
      },
    ]
  },
  {
    id: 'u5', title: 'Python & machine learning', icon: '🐍',
    blurb: 'Python runs in your browser too. From lists to a real classifier for "active vs inactive" compounds.',
    lessons: [
      {
        id: 'u5l1', title: 'Python in 5 minutes', blurb: 'Variables, lists, loops', steps: [
          { t: 'learn', title: 'Same ideas, new spelling', body: `<table><tr><th>R</th><th>Python</th></tr><tr><td><code>x &lt;- 5</code></td><td><code>x = 5</code></td></tr><tr><td><code>c(1, 2, 3)</code></td><td><code>[1, 2, 3]</code> (a list)</td></tr><tr><td><code>x[1]</code> (first)</td><td><code>x[0]</code> (Python counts from 0!)</td></tr><tr><td><code>mean(x)</code></td><td><code>sum(x) / len(x)</code></td></tr></table><p>Indentation matters in Python — it marks blocks:</p><pre><code>for d in doses:\n    print(d * 2)</code></pre>` },
          { t: 'code', lang: 'py', task: 'Make a list <code>doses</code> of 250, 500, 750 and 1000 (mg). Store their average in <code>avg</code> and print it.', starter: `doses = [250, 500, 750, 1000]\navg = \nprint(avg)`, check: 'abs(avg - 625) < 1e-9', hint: 'avg = sum(doses) / len(doses)', solution: `doses = [250, 500, 750, 1000]\navg = sum(doses) / len(doses)\nprint(avg)` },
          { t: 'mcq', q: 'In Python, <code>doses[0]</code> is…', options: ['The last element', 'The first element', 'An error', 'Zero'], a: 1, why: 'Python is zero-indexed.' },
          { t: 'code', lang: 'py', task: 'Loop over <code>doses</code> and build a new list <code>in_grams</code> with each dose in grams.', starter: `doses = [250, 500, 750, 1000]\nin_grams = []\nfor d in doses:\n    in_grams.append(  )\nprint(in_grams)`, check: 'in_grams == [0.25, 0.5, 0.75, 1.0]', hint: 'in_grams.append(d / 1000)', solution: `doses = [250, 500, 750, 1000]\nin_grams = []\nfor d in doses:\n    in_grams.append(d / 1000)\nprint(in_grams)` },
        ]
      },
      {
        id: 'u5l2', title: 'pandas & Lipinski', blurb: 'Tables in Python', steps: [
          { t: 'learn', title: 'pandas DataFrame', body: `<p><b>pandas</b> is Python's table library (like an R data frame). A small compound table <code>df</code> is loaded with molecular weight <code>MW</code>, <code>logP</code>, H-bond donors <code>HBD</code> and acceptors <code>HBA</code>.</p><p>Filter rows with conditions in brackets; combine with <code>&amp;</code> (and), wrapping each condition in parentheses:</p><pre><code>df[(df.MW &lt;= 500) &amp; (df.logP &lt;= 5)]</code></pre><div class="callout"><b>Lipinski's rule of five</b> (oral drug-likeness): MW ≤ 500, logP ≤ 5, HBD ≤ 5, HBA ≤ 10.</div>` },
          { t: 'code', lang: 'py', packages: ['pandas'], setup: `import pandas as pd\ndf = pd.DataFrame({\n 'name': ['paracetamol','ibuprofen','atorvastatin','cyclosporin','metformin','vancomycin','imatinib','aspirin'],\n 'MW':   [151.2, 206.3, 558.6, 1202.6, 129.2, 1449.3, 493.6, 180.2],\n 'logP': [0.5, 3.97, 5.7, 2.9, -1.4, -3.1, 3.5, 1.2],\n 'HBD':  [2, 1, 4, 5, 3, 19, 2, 1],\n 'HBA':  [2, 2, 6, 12, 2, 24, 7, 4]})`, task: 'Make <code>passes</code>: the rows that satisfy ALL four Lipinski rules. Print their names.', starter: `passes = df[(df.MW <= 500) & (df.logP <= 5)]   # add the HBD and HBA rules\nprint(passes['name'].tolist())`, check: "sorted(passes['name']) == sorted(['paracetamol','ibuprofen','metformin','imatinib','aspirin'])", hint: 'Add & (df.HBD <= 5) & (df.HBA <= 10)', solution: `passes = df[(df.MW <= 500) & (df.logP <= 5) & (df.HBD <= 5) & (df.HBA <= 10)]\nprint(passes['name'].tolist())` },
          { t: 'mcq', q: 'Cyclosporin breaks Lipinski\'s rules yet is given orally. What does that tell you?', options: ['Lipinski is a guideline, not a law — natural products and transporter substrates often break it', 'Cyclosporin is not absorbed at all', 'The rule is about IV drugs', 'logP was measured wrongly'], a: 0, why: 'Rule-of-five is a filter for screening libraries, with famous exceptions.' },
        ]
      },
      {
        id: 'u5l3', title: 'What machine learning is', blurb: 'The ideas before the code', steps: [
          { t: 'learn', title: 'Learning from examples', body: `<ul><li><b>Supervised learning</b> — you have labels (active/inactive, toxic/non-toxic, a measured IC50) and the model learns to predict them from <b>features</b> (descriptors, gene expression, patient covariates).</li><li><b>Classification</b> predicts a category; <b>regression</b> predicts a number.</li><li><b>Unsupervised learning</b> — no labels; find structure (clustering patients, PCA of omics data).</li><li>Always hold back a <b>test set</b>. A model that is perfect on training data but poor on new data is <b>overfitting</b>.</li></ul><p>In pharma: QSAR/activity prediction, ADMET prediction, image analysis, patient stratification, pharmacovigilance signal detection.</p>` },
          { t: 'mcq', q: 'Predicting a compound\'s IC50 value (a number) from its descriptors is…', options: ['Classification', 'Regression', 'Clustering', 'Dimensionality reduction'], a: 1, why: 'A continuous target → regression.' },
          { t: 'mcq', q: 'A model scores 99% accuracy on training data and 62% on the test set. Most likely…', options: ['It is underfitting', 'It is overfitting', 'The test set is too easy', 'Accuracy is the wrong word'], a: 1, why: 'Memorised training data; generalises poorly.' },
          { t: 'mcq', q: 'Grouping patients by gene-expression profile without any outcome labels is…', options: ['Supervised', 'Unsupervised', 'Reinforcement learning', 'A t-test'], a: 1, why: 'No labels → unsupervised (e.g. k-means, hierarchical clustering).' },
          { t: 'order', q: 'Order a basic ML workflow.', items: ['Define the question & collect data', 'Clean data and choose features', 'Split into training and test sets', 'Train the model', 'Evaluate on the test set'], why: 'Splitting BEFORE training is what keeps the evaluation honest.' },
        ]
      },
      {
        id: 'u5l4', title: 'Train your first classifier', blurb: 'scikit-learn logistic regression', steps: [
          { t: 'learn', title: 'scikit-learn: fit, predict, score', body: `<p>A simulated screening dataset is loaded: 400 compounds with 4 descriptors in <code>X</code> and labels in <code>y</code> (1 = active).</p><pre><code>from sklearn.model_selection import train_test_split\nfrom sklearn.linear_model import LogisticRegression\nX_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=1)\nmodel = LogisticRegression().fit(X_tr, y_tr)\nmodel.score(X_te, y_te)   # accuracy on unseen compounds</code></pre><p>The first run loads scikit-learn (~1 minute).</p>` },
          { t: 'code', lang: 'py', packages: ['numpy', 'pandas', 'scikit-learn'], setup: ML_SETUP, task: 'Split the data (25% test, random_state=1), train a LogisticRegression, and store the test accuracy in <code>acc</code>.', starter: `from sklearn.model_selection import train_test_split\nfrom sklearn.linear_model import LogisticRegression\n\nX_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=1)\nmodel = LogisticRegression(max_iter=1000)\n# fit the model on the TRAINING data, then score on the TEST data\nacc = \nprint(f"Test accuracy: {acc:.2f}")`, check: '0.6 < acc <= 1 and len(y_te) == 100', hint: 'model.fit(X_tr, y_tr) then acc = model.score(X_te, y_te)', solution: `from sklearn.model_selection import train_test_split\nfrom sklearn.linear_model import LogisticRegression\nX_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=1)\nmodel = LogisticRegression(max_iter=1000)\nmodel.fit(X_tr, y_tr)\nacc = model.score(X_te, y_te)\nprint(f"Test accuracy: {acc:.2f}")` },
          { t: 'code', lang: 'py', packages: ['numpy', 'pandas', 'scikit-learn'], task: 'Which descriptors matter? Print each feature with its coefficient (positive = pushes towards "active").', starter: `for name, coef in zip(X.columns, model.coef_[0]):\n    print(f"{name:5s} {coef:+.3f}")`, check: null, hint: 'Just run it. Which sign does logP have?', solution: `for name, coef in zip(X.columns, model.coef_[0]):\n    print(f"{name:5s} {coef:+.3f}")` },
          { t: 'mcq', q: 'Descriptors are on very different scales (MW ~400, HBD ~3). Before comparing coefficients you should…', options: ['Delete MW', 'Standardise features (e.g. StandardScaler)', 'Use a bigger test set', 'Nothing — scale never matters'], a: 1, why: 'Coefficients depend on units; standardising puts them on a comparable footing.' },
        ]
      },
      {
        id: 'u5l5', title: 'Judge a model honestly', blurb: 'Confusion matrix, precision, recall, ROC AUC', steps: [
          { t: 'learn', title: 'Accuracy is not enough', body: `<p>If only 5% of compounds are active, a model that always says "inactive" is 95% accurate — and useless.</p><ul><li><b>Precision</b> — of the compounds predicted active, how many truly are?</li><li><b>Recall (sensitivity)</b> — of the truly active, how many did we catch?</li><li><b>ROC AUC</b> — how well the model ranks actives above inactives (0.5 = coin flip, 1 = perfect).</li></ul>` },
          { t: 'code', lang: 'py', packages: ['numpy', 'pandas', 'scikit-learn'], setup: ML_MODEL, task: 'Compute the confusion matrix and the ROC AUC on the test set. Store the AUC in <code>auc</code>.', starter: `from sklearn.metrics import confusion_matrix, roc_auc_score, classification_report\npred = model.predict(X_te)\nprob = model.predict_proba(X_te)[:, 1]\nprint(confusion_matrix(y_te, pred))\nprint(classification_report(y_te, pred))\nauc = \nprint("ROC AUC:", round(auc, 3))`, check: '0.5 < auc <= 1', hint: 'auc = roc_auc_score(y_te, prob)  — use probabilities, not 0/1 predictions', solution: `from sklearn.metrics import confusion_matrix, roc_auc_score, classification_report\npred = model.predict(X_te)\nprob = model.predict_proba(X_te)[:, 1]\nprint(confusion_matrix(y_te, pred))\nprint(classification_report(y_te, pred))\nauc = roc_auc_score(y_te, prob)\nprint("ROC AUC:", round(auc, 3))` },
          { t: 'mcq', q: 'Screening for a rare toxic effect, you most want to avoid missing toxic compounds. Prioritise…', options: ['Precision', 'Recall', 'Accuracy', 'Training speed'], a: 1, why: 'Missing true positives = low recall.' },
        ]
      },
    ]
  },
  {
    id: 'u6', title: 'Biotech & omics taste', icon: '🧬',
    blurb: 'Sequences, fold changes and multiple testing — the vocabulary of bioinformatics.',
    lessons: [
      {
        id: 'u6l1', title: 'DNA as text', blurb: 'GC content in R', steps: [
          { t: 'learn', title: 'Strings in R', body: `<ul><li><code>nchar(s)</code> — length of a string</li><li><code>strsplit(s, "")[[1]]</code> — split into single letters</li><li><code>table(x)</code> — count each value</li><li><code>toupper()</code>, <code>substr(s, 1, 10)</code>, <code>gsub("T", "U", s)</code> — DNA → RNA</li></ul><p>Serious work uses <b>Bioconductor</b> packages such as Biostrings, but the logic is the same.</p>` },
          { t: 'code', lang: 'r', setup: `s <- "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG"`, task: 'For the sequence <code>s</code>, compute the GC content (fraction of bases that are G or C) into <code>gc</code>.', starter: `bases <- strsplit(s, "")[[1]]\ntable(bases)\ngc <- mean(bases %in% c("G", "C"))\ngc`, check: 'abs(gc - mean(strsplit("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG","")[[1]] %in% c("G","C"))) < 1e-9', hint: 'It already works — %in% tests membership and mean() of TRUE/FALSE gives a proportion.', solution: `bases <- strsplit(s, "")[[1]]\ngc <- mean(bases %in% c("G", "C"))\ngc` },
          { t: 'code', lang: 'r', setup: `s <- "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG"`, task: 'Transcribe <code>s</code> to RNA (replace T with U) and store it in <code>rna</code>.', starter: `rna <- gsub("", "", s)\nrna`, check: 'rna == gsub("T","U","ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG")', hint: 'gsub("T", "U", s)', solution: `rna <- gsub("T", "U", s)\nrna` },
        ]
      },
      {
        id: 'u6l2', title: 'Fold change & false discoveries', blurb: 'Reading omics results', steps: [
          { t: 'learn', title: 'Thousands of tests at once', body: `<p>In RNA-seq you test ~20,000 genes. With p &lt; 0.05 you'd expect ~1,000 "hits" by chance alone! So results report <b>adjusted p-values</b> (Benjamini–Hochberg FDR) and <b>log2 fold change</b> (log2FC = 1 means doubled, −1 means halved).</p><p>A <b>volcano plot</b> shows log2FC (x) vs −log10(p) (y).</p>` },
          { t: 'code', lang: 'r', setup: `set.seed(3)\ngenes <- data.frame(gene = paste0("G", 1:500), log2fc = c(rnorm(30, 2, 0.6), rnorm(470, 0, 0.5)))\ngenes$p <- c(runif(30, 0, 0.001), runif(470))`, task: 'Adjust the p-values with Benjamini–Hochberg into a new column <code>genes$padj</code>, then count genes with padj &lt; 0.05 AND |log2fc| &gt; 1 into <code>n_sig</code>.', starter: `genes$padj <- p.adjust(genes$p, method = "BH")\nn_sig <- sum(genes$padj < 0.05 & abs(genes$log2fc) > 1)\nn_sig\nplot(genes$log2fc, -log10(genes$p), pch = 20, xlab = "log2 fold change", ylab = "-log10 p")`, check: 'n_sig == sum(p.adjust(genes$p, "BH") < 0.05 & abs(genes$log2fc) > 1)', hint: 'Press Run — then try changing the thresholds.', solution: `genes$padj <- p.adjust(genes$p, method = "BH")\nn_sig <- sum(genes$padj < 0.05 & abs(genes$log2fc) > 1)\nn_sig` },
          { t: 'mcq', q: 'A gene has log2FC = −2. Its expression in treated vs control is…', options: ['2× higher', '4× lower (a quarter)', '2 units lower', 'Unchanged'], a: 1, why: '2^−2 = 0.25.' },
        ]
      },
    ]
  },
  {
    id: 'u7', title: 'The professional toolkit', icon: '🧰',
    blurb: 'What pharma and PhD labs actually use — and how to show your new skills.',
    lessons: [
      {
        id: 'u7l1', title: 'Tools of the trade', blurb: 'Who uses what', steps: [
          { t: 'learn', title: 'A map of the software', body: `<table><tr><th>Area</th><th>Common tools</th></tr><tr><td>Clinical trial programming</td><td>SAS (still dominant), R increasingly; data standards <b>CDISC SDTM/ADaM</b></td></tr><tr><td>Stats in academia</td><td>R (tidyverse, ggplot2), Python, SPSS, Stata</td></tr><tr><td>Lab data & curves</td><td>GraphPad Prism, Excel, R (drc)</td></tr><tr><td>Pharmacometrics (PK/PD)</td><td>NONMEM, Monolix, Phoenix WinNonlin, R (nlmixr2, PKNCA)</td></tr><tr><td>Bioinformatics</td><td>R/Bioconductor, Python, command line</td></tr><tr><td>Cheminformatics / ML</td><td>Python (RDKit, scikit-learn, PyTorch)</td></tr><tr><td>Point-and-click stats</td><td>jamovi, JASP (free, built on R)</td></tr><tr><td>Reproducibility</td><td>Git/GitHub, Quarto/R Markdown, Jupyter</td></tr></table>` },
          { t: 'mcq', q: 'An advert asks for "experience with SDTM and ADaM". It is most likely a…', options: ['Formulation role', 'Clinical data / statistical programming role', 'Microbiology QC role', 'Sales role'], a: 1, why: 'CDISC SDTM/ADaM are clinical-trial data standards.' },
          { t: 'mcq', q: 'For population PK modelling in industry, the classic tool is…', options: ['NONMEM', 'Photoshop', 'SPSS', 'Excel only'], a: 0, why: 'NONMEM (and Monolix); R packages like nlmixr2 are rising.' },
          { t: 'mcq', q: 'Free, point-and-click software that feels like SPSS but is built on R:', options: ['jamovi', 'SAS', 'MATLAB', 'Prism'], a: 0, why: 'jamovi (and JASP) — great for learning statistics without code.' },
        ]
      },
      {
        id: 'u7l2', title: 'Show what you can do', blurb: 'Portfolio over certificates', steps: [
          { t: 'learn', title: 'Proof beats claims', body: `<p>A short, real project tells a PhD panel or hiring manager more than a list of courses:</p><ul><li>Pick a public dataset (e.g. a published PK dataset, ChEMBL bioactivity, a GEO expression set).</li><li>Answer one question in a <b>Quarto</b> or <b>R Markdown</b> report with 2–3 figures.</li><li>Put the code on <b>GitHub</b> with a clear README.</li><li>Add one line to your CV: "Analysed X with R (lm, nls, ggplot2) — github.com/…"</li></ul>` },
          { t: 'order', q: 'Order a mini portfolio project.', items: ['Choose one clear question', 'Find a public dataset', 'Analyse it in R or Python', 'Write a short report with figures', 'Publish code + report on GitHub', 'Add it to your CV and LinkedIn'], why: 'Small and finished beats big and unfinished.' },
          { t: 'mcq', q: 'Which CV line is strongest?', options: ['"Proficient in R"', '"Completed an online R course"', '"Estimated EC50s for 12 compounds with nls() in R; code on GitHub"', '"Interested in data"'], a: 2, why: 'Specific task + tool + evidence.' },
        ]
      },
    ]
  },
];

export const ALL_LESSONS = UNITS.flatMap(u => u.lessons.map(l => ({ ...l, unit: u })));
