import { buildCountingLesson } from "./counting-lesson";

export const COUNTING_HALLOWEEN_NODE_IDS = [
  "count-1-helper",
  "count-2-helpers",
  "count-3-bats",
  "count-3-pumpkins",
  "count-4-lanterns",
  "count-5-helpers",
  "count-6-ghosts",
] as const;

export const COUNTING_HALLOWEEN_LESSON = buildCountingLesson({
  id: "counting-halloween",
  initialNodeId: COUNTING_HALLOWEEN_NODE_IDS[0],
  singleItemExample: "a single helper",
  nodes: {
    "count-1-helper": {
      id: "count-1-helper",
      presentation: { sceneId: "helper-arrives", object: "helper", quantity: 1 },
      learningObjective: "Identify the total of one displayed helper.",
      tutorBrief:
        "A helper arrives: a silly helper in a pumpkin costume arrives at the moonlit porch. How many helpers do you see? Success story idea: the helper is ready to party.",
      onSuccess: { kind: "node", nodeId: "count-2-helpers" },
    },
    "count-2-helpers": {
      id: "count-2-helpers",
      presentation: { sceneId: "helper-friend", object: "helper", quantity: 2 },
      learningObjective: "Identify the total of two displayed helpers.",
      tutorBrief:
        "A friend arrives: a friend in a vampire cape joins the helper. How many helpers are here? Success story idea: the friends love their costumes.",
      onSuccess: { kind: "node", nodeId: "count-3-bats" },
    },
    "count-3-bats": {
      id: "count-3-bats",
      presentation: { sceneId: "friendly-bats", object: "bat", quantity: 3 },
      learningObjective: "Identify the total of three displayed bats.",
      tutorBrief:
        "Friendly bats: friendly bats flutter by the porch. How many bats do you see? Success story idea: the bats are excited for the party.",
      onSuccess: { kind: "node", nodeId: "count-3-pumpkins" },
    },
    "count-3-pumpkins": {
      id: "count-3-pumpkins",
      presentation: { sceneId: "pumpkin-path", object: "pumpkin", quantity: 3 },
      learningObjective: "Identify the total of three displayed pumpkins.",
      tutorBrief:
        "Pumpkin path: pumpkins line the path. How many pumpkins are there? If help is needed, invite pointing to each pumpkin one by one. Success story idea: the pumpkins light the way.",
      onSuccess: { kind: "node", nodeId: "count-4-lanterns" },
    },
    "count-4-lanterns": {
      id: "count-4-lanterns",
      presentation: { sceneId: "party-lanterns", object: "lantern", quantity: 4 },
      learningObjective: "Identify the total of four displayed lanterns.",
      tutorBrief:
        "Party lanterns: glowing lanterns are ready for the party. How many lanterns do you see? Give extra time. If the child calls them pumpkins, that is fine; only the count matters. Success story idea: the lanterns make the party glow.",
      onSuccess: { kind: "node", nodeId: "count-5-helpers" },
    },
    "count-5-helpers": {
      id: "count-5-helpers",
      presentation: { sceneId: "helpers-gather", object: "helper", quantity: 5 },
      learningObjective: "Identify the total of five displayed helpers.",
      tutorBrief:
        "Helpers gather: silly helpers gather for the party. How many helpers are here? Give extra time. If help is needed, invite pointing to each helper one by one. Success story idea: the helpers are ready to dance.",
      onSuccess: { kind: "node", nodeId: "count-6-ghosts" },
    },
    "count-6-ghosts": {
      id: "count-6-ghosts",
      presentation: { sceneId: "shy-ghosts", object: "ghost", quantity: 6 },
      learningObjective: "Identify the total of six displayed ghosts.",
      tutorBrief:
        "Shy ghosts: shy ghosts float out to join the party. How many ghosts do you see? Give extra time. If help is needed, invite pointing to each ghost one by one. Success story idea: the ghosts are happy to join their friends.",
      onSuccess: { kind: "complete" },
    },
  },
});
