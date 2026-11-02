/* A small sample deck that shows off LaTeX, chemistry, tables and an image. */
(function (root) {
  'use strict';
  const TEXT = String.raw`# Sample – Math & Science Basics

Q: What is Euler's identity?
A: $$e^{i\pi} + 1 = 0$$
It links the five constants $0$, $1$, $e$, $i$ and $\pi$.

Q: State the quadratic formula for $ax^2 + bx + c = 0$ (with $a \neq 0$).
A: $$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$

Q: On the unit circle, what are the coordinates of the point at angle $\theta$?
![Unit circle with a point at angle theta](unit-circle.svg)
A: $(\cos\theta,\ \sin\theta)$, which is why $\cos^2\theta + \sin^2\theta = 1$.

Q: What is the determinant of $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$?
A: $ad - bc$

Q: Write the balanced equation for the complete combustion of methane.
A: $\ce{CH4 + 2O2 -> CO2 + 2H2O}$

Q: State Bayes' theorem and name each term.
A: $$P(A \mid B) = \frac{P(B \mid A)\,P(A)}{P(B)}$$
- $P(A)$: prior
- $P(B \mid A)$: likelihood
- $P(A \mid B)$: posterior

Q: Compare the average and worst-case running times of common sorting algorithms.
A:
| Algorithm | Average | Worst |
|---|---|---|
| Merge sort | $O(n \log n)$ | $O(n \log n)$ |
| Quicksort | $O(n \log n)$ | $O(n^2)$ |
| Insertion sort | $O(n^2)$ | $O(n^2)$ |
`;

  const UNIT_CIRCLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-130 -130 260 260" width="520" height="520" font-family="Georgia, serif">
  <rect x="-130" y="-130" width="260" height="260" fill="#fff"/>
  <line x1="-120" y1="0" x2="120" y2="0" stroke="#888" stroke-width="1.5"/>
  <line x1="0" y1="120" x2="0" y2="-120" stroke="#888" stroke-width="1.5"/>
  <circle r="100" fill="none" stroke="#2b59c3" stroke-width="3"/>
  <line x1="0" y1="0" x2="70.7" y2="-70.7" stroke="#d1495b" stroke-width="3"/>
  <line x1="70.7" y1="-70.7" x2="70.7" y2="0" stroke="#d1495b" stroke-width="2" stroke-dasharray="5 4"/>
  <path d="M 28 0 A 28 28 0 0 0 19.8 -19.8" fill="none" stroke="#333" stroke-width="2"/>
  <circle cx="70.7" cy="-70.7" r="5" fill="#d1495b"/>
  <text x="34" y="-10" font-size="16" font-style="italic">θ</text>
  <text x="78" y="-78" font-size="15">(cos θ, sin θ)</text>
  <text x="104" y="18" font-size="14">1</text>
  <text x="-8" y="-106" font-size="14" text-anchor="end">1</text>
</svg>`;

  (root.FC = root.FC || {}).sample = {
    TEXT,
    images: () => [
      {
        name: 'unit-circle.svg',
        key: 'unit-circle.svg',
        blob: new Blob([UNIT_CIRCLE_SVG], { type: 'image/svg+xml' }),
        width: 520,
        height: 520,
      },
    ],
  };
})(self);
