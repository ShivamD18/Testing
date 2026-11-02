# Prompt for Claude

Give this prompt to Claude along with your lecture notes or slides. The app also has it on the **Claude prompt** page, with a copy button.

**Tips**
- Export PowerPoint or Keynote slides as **PDF** before attaching them. Claude can then refer to slide pictures by page number, and you add the same PDF when importing.
- Add a line at the end if you want, such as “about 40 cards”, “focus on the definitions and proofs” or “skip the history section”.
- For a long lecture, ask for one section at a time and use **Add cards** on the deck page for each batch.

<!-- prompt:start -->
`````text
Turn the lecture material I've attached (notes and/or slides) into flashcards for my study app. Follow this format exactly.

FORMAT
- First line: "# " and a short deck name, e.g. "# MATH 201 – Lecture 5: Eigenvalues".
- Then the cards. Each card is a line starting with "Q:" (the question) followed by a line starting with "A:" (the answer). Put a blank line between cards.
- Both sides may span several lines. A card ends only where the next "Q:" line starts, so never begin any other line with "Q:" or "A:". Write multiple-choice options as (a), (b), (c).
- Markdown works: **bold**, *italics*, bullet and numbered lists, tables, `inline code`, fenced code blocks.
- Math is LaTeX (rendered with KaTeX): $...$ for inline math and $$...$$ on its own line for display math. Environments such as aligned, cases, pmatrix and bmatrix work, and \ce{...} works for chemistry. Write a literal dollar sign as \$ (e.g. \$5).
- Images: add one only when a picture is genuinely needed (a diagram, graph, circuit, structure, or a figure the question is about). Put it on its own line on the side of the card where it belongs: the question side if the question is about the figure.
  - For a page of an attached PDF: ![short description](FILENAME.pdf#page=N). Use the PDF's exact file name, and N is the page's position in the PDF file (1 = first page), not the number printed on the slide.
  - For an attached image file: ![short description](exact-file-name.png).
  - Never invent image file names or URLs.

CARD QUALITY
- One idea per card, with a short, precise answer. Split long lists into several cards; if a card has to ask for a list, keep it to 5 items or fewer.
- Every question must make sense on its own, without the slides. Put the needed context in the question, and never write "according to the slide".
- Cover every definition, theorem or result (with its conditions), key formula (and what each symbol means), important derivation step, the method behind each worked example, and the pitfalls the lecturer stresses.
- Ask "why", "how" and "when" questions rather than yes/no ones. Where it helps, also ask in reverse (formula → name, term → definition).
- Use only what's in the material. Skip anything that is unclear rather than guessing.
- Keep the cards in the order the topics appear in the lecture.

OUTPUT
- Output only the flashcards, with no commentary before or after.
- If you can create files, put the flashcards in a downloadable .txt file. Otherwise put everything in ONE code block that opens with ````text and closes with ```` (four backticks), so the chat doesn't render the LaTeX and I can copy it exactly.

EXAMPLE
````text
# Example – Calculus Review

Q: What is the derivative of $\sin x$?
A: $\cos x$

Q: State the Fundamental Theorem of Calculus (part 2).
A: If $f$ is continuous on $[a,b]$ and $F' = f$ on $[a,b]$, then
$$\int_a^b f(x)\,dx = F(b) - F(a)$$

Q: What feature of $f$ does this graph show at $x = 1$?
![Graph of f with a dashed vertical line at x = 1](lecture2.pdf#page=7)
A: A **vertical asymptote**: $\lim_{x \to 1^{+}} f(x) = \infty$.
````

Now make the flashcards from the attached material.
`````
<!-- prompt:end -->
