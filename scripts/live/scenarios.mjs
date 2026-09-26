/** [secondsAfterStart, text]. `stop: "none"` lets the app or child end the lesson. */
export const SCENARIOS = {
  turn_end_experiment: {
    seconds: 115,
    lines: [
      [11, "One!"],
      [20, "Yeah."],
      [28, "One"],
      [30, "two ducks."],
      [43, "Two... no, three."],
      [55, "I don't know."],
      [65, "Five."],
      [76, "One, two, three."],
      [88, "Wait, I am still counting."],
      [97, "One, two, three."],
    ],
  },
  turn_end_debug: {
    seconds: 82,
    lines: [
      [11, "One!"],
      [20, "Yeah."],
      [28, "One"],
      [30, "two ducks."],
      [43, "Two... no, three."],
      [55, "I don't know."],
      [65, "Five."],
      [74, "One, two, three."],
    ],
  },
  quick_answer: {
    seconds: 50,
    lines: [
      [11, "One!"],
      [24, "Two!"],
      [38, "Three!"],
    ],
  },
  progression: {
    seconds: 90,
    lines: [
      [11, "One!"],
      [22, "Yes! More ducks!"],
      [35, "One, two. Two ducks!"],
      [50, "Okay!"],
      [62, "One... two... three!"],
      [75, "Three butterflies!"],
    ],
  },
  self_correction: {
    seconds: 55,
    lines: [
      [11, "Um... two? No, wait. One! One duck."],
      [26, "Yeah!"],
      [38, "Three... no. Two!"],
    ],
  },
  long_pause: {
    seconds: 75,
    lines: [
      [11, "Ummm..."],
      [50, "One?"],
    ],
  },
  off_topic: {
    seconds: 65,
    lines: [
      [11, "I have a dinosaur! His name is Rex!"],
      [28, "Can you tell me a story about space rockets?"],
      [46, "One duck."],
    ],
  },
  interruption: {
    seconds: 45,
    lines: [
      [3.5, "Wait wait! I want to tell you something! I have a duck at home!"],
      [22, "One!"],
    ],
  },
  incorrect_then_supported: {
    seconds: 60,
    lines: [
      [11, "Five!"],
      [25, "Umm... I dont know."],
      [42, "One!"],
    ],
  },
  // Scenarios below were added for the issue #3 Jev experiment.
  correct_once: {
    seconds: 45,
    lines: [[11, "One!"]],
  },
  correct_phrasing_a: { seconds: 45, lines: [[11, "One duck."]] },
  correct_phrasing_b: { seconds: 45, lines: [[11, "There's one!"]] },
  correct_phrasing_c: { seconds: 45, lines: [[11, "Just one."]] },
  correct_phrasing_d: { seconds: 45, lines: [[11, "I count one!"]] },
  incorrect_count: {
    seconds: 50,
    lines: [[11, "Five!"]],
  },
  dont_know: {
    seconds: 50,
    lines: [[11, "Umm... I dont know."]],
  },
  /** The revision arrives inside the same utterance, so only "One" is judged. */
  self_corrected_to_right: {
    seconds: 50,
    lines: [[11, "Two? No, wait. One!"]],
  },
  /** The reverse: a correct answer the child immediately takes back. */
  self_corrected_to_wrong: {
    seconds: 50,
    lines: [[11, "One! No, three."]],
  },
  explicit_stop: {
    seconds: 45,
    stop: "none",
    lines: [
      [11, "One!"],
      [22, "I am all done. I want to stop now."],
    ],
  },
  time_limit: {
    seconds: 375,
    stop: "none",
    lines: [
      [11, "One!"],
      [25, "More!"],
      [40, "One, two!"],
      [60, "Yes!"],
      [75, "One, two, three."],
      [95, "Three butterflies!"],
      [120, "Okay!"],
      [140, "One, two, three strawberries."],
      [170, "More please!"],
      [200, "One, two, three, four."],
      [240, "Yes!"],
      [268, "One, two, three, four, five!"],
      [285, "Can we count more?"],
      [305, "I want to play more!"],
      [325, "One more please!"],
    ],
  },
};
