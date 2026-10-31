import { buildCountingLesson } from "./counting-lesson";

export const COUNTING_HALLOWEEN_NODE_IDS = [
  "count-1-ghost",
  "count-2-bats",
  "count-3-pumpkins",
  "count-3-ghosts",
  "count-4-lanterns",
  "count-5-bats",
  "count-6-ghosts",
] as const;

export const COUNTING_HALLOWEEN_LESSON = buildCountingLesson({
  id: "counting-halloween",
  initialNodeId: COUNTING_HALLOWEEN_NODE_IDS[0],
  singleItemExample: "a single ghost",
  addressLearnerByName: true,
  nodes: {
    "count-1-ghost": {
      id: "count-1-ghost",
      presentation: { sceneId: "ghost-peeks", object: "ghost", quantity: 1 },
      learningObjective: "Identify the total of one displayed ghost.",
      tutorBrief:
        "A shy ghost: a little ghost peeks out on the moonlit porch. How many ghosts do you see? Success story idea: the ghost is getting ready for a Halloween party.",
      onSuccess: { kind: "node", nodeId: "count-2-bats" },
    },
    "count-2-bats": {
      id: "count-2-bats",
      presentation: { sceneId: "bat-friends", object: "bat", quantity: 2 },
      learningObjective: "Identify the total of two displayed bats.",
      tutorBrief:
        "Bat friends: friendly bats flutter over the porch. How many bats do you see? Success story idea: the bats are excited for the party.",
      onSuccess: { kind: "node", nodeId: "count-3-pumpkins" },
    },
    "count-3-pumpkins": {
      id: "count-3-pumpkins",
      presentation: { sceneId: "pumpkin-path", object: "pumpkin", quantity: 3 },
      learningObjective: "Identify the total of three displayed pumpkins on the path.",
      tutorBrief:
        "Pumpkin path: pumpkins line the path to the party. How many pumpkins are on the path? The big glowing pumpkin by the porch steps and the little lights in the tree are decorations; if the child counts them, gently say we are counting the pumpkins on the path. If help is needed, invite pointing to each pumpkin one by one. Success story idea: the pumpkins light the way.",
      onSuccess: { kind: "node", nodeId: "count-3-ghosts" },
    },
    "count-3-ghosts": {
      id: "count-3-ghosts",
      presentation: { sceneId: "ghosts-float", object: "ghost", quantity: 3 },
      learningObjective: "Identify the total of three displayed ghosts in a new group.",
      tutorBrief:
        "Ghosts float in: more ghost friends float in for the party. How many ghosts do you see now? Success story idea: the ghosts are practising a party twirl.",
      onSuccess: { kind: "node", nodeId: "count-4-lanterns" },
    },
    "count-4-lanterns": {
      id: "count-4-lanterns",
      presentation: { sceneId: "party-lanterns", object: "lantern", quantity: 4 },
      learningObjective: "Identify the total of four displayed party lanterns.",
      tutorBrief:
        "Party lanterns: glowing party lanterns are lined up for the party. How many party lanterns do you see? Give extra time. If the child calls them pumpkins, that is fine; only the count matters. The porch lamp and the little lights in the tree are decorations; if the child counts them, gently say we are counting the party lanterns in the middle. Success story idea: the lanterns make the party glow.",
      onSuccess: { kind: "node", nodeId: "count-5-bats" },
    },
    "count-5-bats": {
      id: "count-5-bats",
      presentation: { sceneId: "bats-swoop", object: "bat", quantity: 5 },
      learningObjective: "Identify the total of five displayed bats.",
      tutorBrief:
        "Bats swoop: more bats swoop around the porch for the party. How many bats do you see? Give extra time. If help is needed, invite pointing to each bat one by one. Success story idea: the bats are doing loop-the-loops.",
      onSuccess: { kind: "node", nodeId: "count-6-ghosts" },
    },
    "count-6-ghosts": {
      id: "count-6-ghosts",
      presentation: { sceneId: "ghost-party", object: "ghost", quantity: 6 },
      learningObjective: "Identify the total of six displayed ghosts.",
      tutorBrief:
        "Ghost party: shy ghosts float out to join the party. How many ghosts do you see? Give extra time. If help is needed, invite pointing to each ghost one by one. Success story idea: the ghosts are happy to join their friends.",
      onSuccess: { kind: "complete" },
    },
  },
});
