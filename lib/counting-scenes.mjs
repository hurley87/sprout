// @ts-check
// Shared counting fixture for production and the plain-Node live harness.
/** @type {readonly import("./lesson").Scene[]} */
export const COUNTING_SCENES = [
  { id: "hello-duck", object: "duck", quantity: 1 },
  { id: "duck-friends", object: "duck", quantity: 2 },
  { id: "butterfly-garden", object: "butterfly", quantity: 3 },
  { id: "picnic", object: "strawberry", quantity: 3 },
  { id: "pond", object: "duck", quantity: 4 },
  { id: "garden", object: "butterfly", quantity: 5 },
];
