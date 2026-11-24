# Unicorn Picnic: Counting Game

Nov 14, 2026 · @David Hurley

## Overview

She is the picnic host. Unicorns arrive, treats roll in on a little trolley, and she makes sure there is exactly one treat for every guest.

Sprout does not ask her to catch a counting mistake or count to move a character. It gives her a reason to make an amount: everyone needs a snack, and nobody needs two. She can ask for another treat, take one away, or tell Sprout how many there should be altogether.

When she says "Picnic time!", the treats float over to the unicorns, one each. An empty plate or a leftover treat shows her what still needs changing. She can fix it and try again.

- **Proposed route:** `/unicorn-picnic`
- **Proposed lesson id:** `counting-unicorn-picnic`
- **Length:** six picnic rounds and a finale
- **Counts:** 2 to 4 guests, with one treat per guest
- **Interaction:** voice-only, with visible guests and treats throughout
- **Learning:** matching one to one, making equal amounts, and understanding one more and one fewer

## Picnic rounds

The first three rounds introduce too few, just right, and too many. The next two change a picnic that was ready. The last round lets her supply the whole amount herself.

| Order | Guests | Treats at the decision point | What happens | Her task |
| --- | --- | --- | --- | --- |
| 1 | 2 unicorns | 1 cupcake | The trolley arrives short | Bring one more |
| 2 | 3 unicorns | 3 strawberries | There is already enough | Notice it is ready |
| 3 | 3 unicorns | 4 cookies | The trolley brings an extra | Take one away |
| 4 | 4 unicorns | 3 cupcakes | Three guests have a ready picnic, then a fourth arrives before serving | Add a treat for the new guest |
| 5 | 3 unicorns | 4 strawberries | Four guests have a ready picnic, then one leaves for a nap before serving | Remove the spare treat |
| 6 | 4 unicorns | 0 cookies | The guests arrive with an empty trolley | Tell Sprout how many to bring, or build the amount one at a time |
| 7 | Finale | Nothing counted | Everyone gathers for a picnic party | Enjoy the party |

- **Fixed first version:** use these quantities and this order so the changing rule is easy to follow. Random quantities can come later.
- **No automatic serving:** even a correct trolley waits for her to declare the picnic ready. Round 2 teaches that she does not always need to change something.
- **Arrival and departure:** in rounds 4 and 5, show the original matching quantities briefly, then complete the guest change before her turn begins. No treat has been eaten or served yet.
- **No hidden guests:** every guest who needs a treat remains visible. The departing unicorn clearly leaves the picnic area.

## How a round goes

Sprout explains once: "You're our picnic host! Let's give every unicorn one treat. Tell me what we need, then say 'Picnic time!' when you're ready."

The first round demonstrates the trolley and the serving action. Later rounds use short prompts such as "Is our picnic ready?" or "A new friend! Do we have enough?"

| She says | What happens |
| --- | --- |
| "One more", "another", or "bring one" | One treat arrives on the trolley |
| "Take one away" or "one less" | One treat returns to the basket |
| "We need three" or "three altogether" | Sprout makes the trolley hold three treats total |
| "Bring two more" | Two treats are added to the current amount |
| "No" or "not enough" | Sprout asks a short follow-up: "Should we bring another, or take one away?" |
| "Too many" | Sprout asks, "Shall we take one away?" |
| "Picnic time", "ready", or "that's enough" | The game tries serving one treat to each unicorn |
| Counts aloud without asking for a change | The trolley stays still so she can inspect and count |
| Says something unclear | Sprout asks her to say it another way; the quantities stay as they are |

"Three altogether" and "two more" mean different things. If her wording does not make the intended change clear, Sprout asks instead of guessing. A bare number in response to "How many altogether?" sets the total; an unprompted number can simply be counting aloud.

Sprout briefly acknowledges a change, such as "One more cupcake!", then gives her room to look and count. It does not announce whether the trolley is correct before she tries serving.

## The picnic-time check

Serving is the answer reveal. It pairs treats with guests so the reason is visible, rather than just telling her "right" or "wrong."

| Trolley amount | What she sees | What happens next |
| --- | --- | --- |
| Exactly one per guest | Each unicorn gets one treat | Happy munching, little rainbow burps, and the next round |
| Too few | Some unicorns have treats and at least one has an empty plate | Sprout says "Someone's plate is empty." She gets another turn |
| Too many | Every unicorn gets one, with treats left on the trolley | Sprout says "There's some left on the trolley." She gets another turn |

On an unsuccessful check, nobody eats. Hold the matching picture long enough to see the problem, then return all treats to the trolley before accepting her next change. This keeps one consistent place to count and edit the amount.

- **Same problem, another try:** keep the guests and treat quantity from her attempt. Do not reset to the round's starting amount.
- **Gentle feedback:** hungry unicorns are patient and funny, never sad or upset with her.
- **No failure counter:** she can change the amount and try as often as she needs.
- **No timer or speed reward:** taking time to count is part of the game.

## Help when she gets stuck

Sprout helps her compare the two groups before supplying the answer.

1. Invite her to look: "Does every friend have one?"
2. Offer a choice: "Do we need more treats, or fewer?"
3. Count the guests and treats with her, then ask what to change.
4. If she is still stuck, model one change: "This friend needs a cupcake. Let's bring one more." Show that change, then let her call "Picnic time!"

There is no requirement to use words such as "fewer" herself. "Take one away" is enough. A spoken "yes" or "no" answers Sprout's current question; it is not a global command to change or serve the trolley.

## What she sees

One pink meadow picnic setting carries the game, with a small castle in the distance and cotton-candy clouds overhead.

- **Guests:** white unicorns with different pink, purple, and gold mane details. Each sits beside one empty plate in a clear row.
- **Trolley:** a separate row of large, easy-to-count treats below the guests. Nothing overlaps or hides another treat.
- **Treats:** original cupcake, strawberry, and cookie SVGs. Every treat in a round is the same kind and counts as one item.
- **Basket:** the source and return point for treats. Its contents are hidden so they do not look like another group to count.
- **Serving:** treats travel to plates one at a time, in a consistent left-to-right order. Each guest receives at most one.
- **Mismatch:** an empty plate gets a gentle glow; leftover treats give a small wiggle. These cues appear after she tries serving.
- **Arrival:** a new unicorn trots in and sits beside a newly appearing plate.
- **Departure:** a unicorn yawns, waves, and leaves with its plate before the next decision.
- **Glow cue:** the same glowing unicorn horn as the other outlines, with screen-reader status text retained.
- **Finale:** all the friends enjoy a picnic under a rainbow. Gentle confetti and rainbow burps celebrate her hosting. Nothing is counted.
- **Reduced motion:** replace travel, wiggles, and confetti with static state changes. Keep the completed matching arrangement visible.

Background decorations are never counted. Tutor prompts refer specifically to the picnic guests and the treats on the trolley.

## Runtime notes

These are proposed behaviors, not verified claims about the current code. Check the lesson definition types, voice-turn handling, and scene state before choosing the implementation boundary.

**Round state**

Use one logical round per picnic, followed by the finale. Each round needs the guest count, treat kind, starting treat count, current treat count, and any scripted arrival or departure. Unlike a still-picture counting question, her actions change the quantity she is looking at.

The main phases are setup, editing the trolley, checking the match, and success. A round succeeds only after she requests serving and the trolley count equals the current guest count. Merely reaching the correct amount does not advance it.

**Understanding her turn**

Interpret completed child turns as proposed actions: add, remove, set a total, request serving, answer a pending clarification, or no change. The app validates and applies an action; the tutor's spoken reply is not authority to alter the quantity.

- Keep incremental requests separate from total requests: "two more" adds two; "two altogether" sets two.
- Interpret short answers using the current prompt and any pending clarification.
- Do not treat a counting sequence as a series of commands.
- If one utterance contains conflicting requests, clarify before changing the scene.
- Handle one action per turn in the first version. If she says "one more, then picnic time," add the treat and ask whether she is ready to serve.
- Apply each accepted action once. A repeated transcript or delayed response must not duplicate a treat or affect the next round.

**Bounds and timing**

- The proposed trolley range is 0 to 6 treats, leaving room for visible mistakes above the guest count without crowding the scene.
- Never create negative quantities or silently clamp a request. If a request would exceed the range, leave the trolley unchanged and explain that it is empty or can hold only six treats.
- Complete and show each quantity change before inviting the next answer.
- Do not accept quantity changes during setup or serving animations. Preserve the existing voice-turn contract where it supports this behavior.
- Check equality and one-to-one pairing deterministically from scene state; the semantic interpretation of her speech does not decide whether the amounts match.

**Tutor behavior**

Keep prompts short and praise her helping the guests: "Everyone has one! Thank you, picnic host!" Avoid turning every change into another "How many?" question. She should have space to inspect, count, decide, and call the picnic herself.

## What to test with her

The first question is whether she understands the one-treat-each rule and uses the matching picture to decide what to change.

- [ ] **The rule makes sense:** she understands why a spare treat matters even when everyone already has one.
- [ ] **She feels like the host:** she chooses changes and calls "Picnic time!" without an adult directing each step.
- [ ] **Already right:** round 2 does not make her add something just because the first round did.
- [ ] **More versus total:** "one more" and "we need three" produce the change she intended.
- [ ] **Counting stays safe:** counting the treats aloud does not accidentally add, remove, or serve them.
- [ ] **The reveal teaches:** she notices empty plates and leftovers and uses them to adjust her next attempt.
- [ ] **Returning treats is clear:** the move back to the trolley after an unsuccessful check does not look like treats disappearing or the problem restarting.
- [ ] **Guest changes are understood:** she notices who arrived or left and understands that the needed amount changed.
- [ ] **Short speech works:** "more", "ready", "yes", and "no" are heard and interpreted in context.
- [ ] **Help leaves her a turn:** Sprout supports her without solving and serving the whole picnic on its own.
- [ ] **Visual counting is easy:** guests, plates, trolley treats, and background decorations remain distinct on a phone.
- [ ] **Length:** six rounds stay fun. If interest drops, try a shorter session using rounds 1, 2, 3, and 6 before the finale.
