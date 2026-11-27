// Nov 27 live session: the classifier judged both answers correct, but a trailing wordless "Child: ." made
// the reader see no number, so the check vetoed them and the child had to say "seven" a third time.
export const WORDLESS_FRAGMENT_TRANSCRIPTS = [
  `Tutor: This is Rex, and he's a hungry dinosaur who loves to munch cars! How many cars can Rex eat? You can say your answer out loud to Rex. Want to tell Rex how many cars he can eat? We can count them together if you'd like.
Child: Five.
Tutor: Good try! Try counting from the first little bunch, and let’s walk on to the next ones together. Three, four, five, six
Tutor: .
Child: Five, six, seven
Tutor: You got
Child: .
Tutor: seven cars! Rex is gonna be so excited.`,
  `Tutor: This is Rex, and he's a hungry dinosaur who loves to munch cars! How many cars can Rex eat? You can say your answer out loud to Rex. Want to tell Rex how many cars he can eat? We can count them together if you'd like.
Child: Five.
Tutor: Good try! Try counting from the first little bunch, and let’s walk on to the next ones together. Three, four, five, six
Tutor: .
Child: Five, six, seven
Tutor: You got
Child: .
Tutor: seven cars! Rex is gonna be so excited. Could you say your answer one more time for Rex?
Child: Seven
Tutor: Yes
Child: .
Tutor: , seven cars! Rex is gonna be thrilled to munch them.`,
];
