// Gentle jokes for a gentle app. "Lieur" (Sundanese) = dizzy, muddled, brain-in-a-spin.
export const JOKES = [
  "Feeling lieur? Good news: every expert was once lieur about the exact same thing.",
  "A PhD application is just a very long email wearing a tiny hat.",
  "In pharmacology, the dose makes the poison. In job hunting, the inbox makes the lieur. Take small doses.",
  "R error messages are not insults. They are just very rude suggestions.",
  "Half-life of motivation: about 3 days. Solution: schedule top-ups, like any good drug.",
  "Your brain isn't broken, it's just buffering. Please hold, your next step is loading.",
  "Rejection email translation: 'Not this one.' Your plum is still on the tree.",
  "Python is named after Monty Python, so when the code makes no sense, that is technically on brand.",
  "A p-value walks into a bar. The bartender says 'significant?' It says 'only if you keep looking.'",
  "Lieur level high? Skip to a 1-minute lesson. Even a macaron is eaten one bite at a time.",
  "Reading a paper is like eating a macaron: abstract first, then the filling, then decide if you want another.",
  "Supervisors reply slowly because they are busy, not because you are a bad idea. (Mostly.)",
  "Machine learning is mostly 'I have no idea why it works' with a nicer font.",
  "If a bug fixes itself after a coffee break, that is called 'asynchronous debugging'.",
  "Sponsorship hunting rule: you only need ONE yes. The nos are just data cleaning.",
  "The cure for a lieur Monday: one tiny step, one sip of tea, one gentle win.",
  "Nobody opens a confusing paper and thinks 'ah, clearly'. Everyone reads the abstract three times.",
  "Your CV is not a verdict. It is a draft, and drafts are allowed to be lieur.",
  "In statistics, 'n = 1' is a case study. In life, it's you, trying. Both are valid.",
  "Ctrl+Z works on code. For everything else, we have tea and a short walk.",
  "Fun fact: confusion is what learning feels like from the inside. You're doing it right.",
  "A good PhD proposal is 10% brilliance and 90% 'I answered the email'.",
  "Today's goal: be 1% less lieur than yesterday. Compound interest works on brains too.",
  "Placebo effect says believing helps. So: believe in your next step. Side effects: progress."
];
export function jokeOfDay(offset = 0) {
  const d = new Date(); const n = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  return JOKES[(n + offset) % JOKES.length];
}
export const randomJoke = () => JOKES[Math.floor(Math.random() * JOKES.length)];
