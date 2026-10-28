import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHub } from "../src/lib/hub";

const sheet = `context-notepad-hub v2 thread=designer-remodeler-collab
hub: Designers and remodelers on one job | context-notepad/threads/designer-remodeler-collab/mockups/index.html

collab-1 = linked | Each company has its own project, linked
q: Who creates and owns the home project?
means: No one owns the other's project.
note: everyone owns part of the project
but they are linked

collab-5 = - | (no option chosen)
q: Who publishes an update to John and Annie?
note: I would think the clients see one place`;

test("a mockup hub's answer sheet reads as questions, choices and the owner's notes", () => {
  const hub = parseHub(sheet);
  assert.ok(hub);
  assert.equal(hub.title, "Designers and remodelers on one job");
  assert.equal(hub.path, "context-notepad/threads/designer-remodeler-collab/mockups/index.html");
  assert.deepEqual(
    hub.answers.map((a) => [a.key, a.choice, a.label, a.question]),
    [
      ["collab-1", "linked", "Each company has its own project, linked", "Who creates and owns the home project?"],
      ["collab-5", "-", "(no option chosen)", "Who publishes an update to John and Annie?"],
    ],
  );
  assert.equal(hub.answers[0].note, "everyone owns part of the project\nbut they are linked");
  assert.equal(hub.answers[1].means, "");
});

test("plain words are not a hub sheet", () => {
  assert.equal(parseHub("Make the phone screens narrower"), undefined);
  assert.equal(parseHub("context-notepad-hub v3 answers: 1a, 2c"), undefined);
});
