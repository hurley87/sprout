import { test, expect, type Page } from "@playwright/test";
import { transportFixture } from "../helpers/transport-browser-fixture";
import { acknowledgmentFor } from "../../lib/acknowledgment-catalog";

async function fixture(page: Page, confirm = true) {
  await transportFixture(page);
  await page.evaluate(`(async()=>{
   window.snapshots=[];window.timeline=[];window.commands=[];window.evaluations=[];
   document.body.insertAdjacentHTML('beforeend','<div id="scene"></div>');
   // The fixture has already exercised transport startup against real local RTP.
   // Attach the production controller to that connection; all later finite media,
   // source preparation/promotion, microphone fences and recording remain real.
   window.transport.start=async function(onEvent,onFailure){this.onEvent=onEvent;this.onFailure=onFailure;};
   const send=window.transport.send.bind(window.transport);
   window.transport.send=command=>{window.commands.push({source:window.transport.activeSourceId,command,at:performance.now()});send(command);};
   const recorder={create:async()=> 'synthetic',activate:async()=>{},append:async()=>{},
     appendTimeline:async(key,atMs,event)=>window.timeline.push({key,atMs,event}),
     finalize:async()=>{},markIncomplete:async()=>{},attachRecording:async()=>{}};
   window.session=new window.LessonSession(window.transport,async request=>{window.evaluations.push(request);return {status:'evaluated',probability:1,model:'synthetic',latencyMs:0};},snapshot=>{
     window.snapshots.push({...snapshot,at:performance.now()});
     const element=document.querySelector('#scene');element.dataset.scene=window.sceneAt(snapshot.sceneIndex).id;
     if(${confirm} && snapshot.status!=='ended'){
       const index=snapshot.sceneIndex,token=snapshot.displayToken;
       requestAnimationFrame(()=>requestAnimationFrame(()=>window.session.displayed(index,token)));
     }
   },undefined,recorder);
   await window.session.start();window.channel.send(JSON.stringify({type:'session.started'}));
 })()`);
  await expect.poll(() => page.evaluate("window.session.snapshot.status")).toBe("active");
  if (!confirm) await page.evaluate("window.session.displayed(0,window.session.snapshot.displayToken)");
}
async function answer(page: Page, text = "One", offset = 1000) {
  await page.evaluate(
    ({ text, offset }) => {
      const w = window as unknown as { providers: { channel: RTCDataChannel }[] };
      w.providers.at(-1)!.channel.send(
        JSON.stringify({
          type: "session.input_transcript.delta",
          delta: text,
          start_ms: offset,
          end_ms: offset + 100,
        }),
      );
    },
    { text, offset },
  );
}
async function playback(page: Page, state: string) {
  await expect
    .poll(() =>
      page.evaluate(state => {
        const w = window as unknown as { session: { events: { type: string; detail: { state?: string } }[] } };
        return w.session.events.some(event => event.type === "acknowledgment.playback" && event.detail.state === state);
      }, state),
    )
    .toBe(true);
}
async function ready(page: Page) {
  await expect.poll(() => page.evaluate("window.providers.length")).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate("window.providers.at(-1).channel?.readyState")).toBe("open");
  await page.evaluate("window.providers.at(-1).channel.send(JSON.stringify({type:'session.started'}))");
  await expect.poll(() => page.evaluate("window.session.snapshot.questionStatus")).toBe("authorized_delivery_unknown");
}
async function cleanup(page: Page) {
  await page.evaluate(
    "window.session.dispose();window.providers.forEach(source=>{source.peer.close();source.tone.stop();});window.context.close()",
  );
}

test("actual spoken asset completes on old display, output fence precedes commit, confirmed display precedes fresh-source question and recording includes the clip", async ({
  page,
}) => {
  await fixture(page);
  await answer(page);
  await playback(page, "started");
  await expect(page.locator("#scene")).toHaveAttribute("data-scene", "hello-duck");
  await playback(page, "media_ended");
  await playback(page, "completed");
  await expect(page.locator("#scene")).toHaveAttribute("data-scene", "duck-friends");
  await ready(page);
  const facts = await page.evaluate(`(()=>{
  const events=window.session.events.filter(e=>e.type==='acknowledgment.playback').map(e=>e.detail);
  const commit=window.session.events.find(e=>e.type==='advance.committed');
  const display=window.session.events.find(e=>e.type==='advance.displayed');
  const command=window.commands.find(e=>e.command.content?.includes('Ask only'));
  const all=window.session.events;
  const completedOrder=all.findIndex(e=>e.type==='acknowledgment.playback'&&e.detail.state==='completed');
  const commitOrder=all.findIndex(e=>e.type==='advance.committed');
  const displayOrder=all.findIndex(e=>e.type==='advance.displayed');
  const questionOrder=all.findIndex(e=>e.type==='command.sent'&&e.detail.content?.includes('Ask only'));
  return {events,completedOrder,commitOrder,displayOrder,questionOrder,commitAt:commit.at,displayAt:display.at,commandSource:command.source,questionCommands:window.commands.filter(e=>e.command.content?.includes('Ask only')).length,
   oldSnapshots:window.snapshots.filter(s=>s.choreographyPhase==='ack_playing'||s.choreographyPhase==='ack_draining').map(s=>s.sceneIndex)};
 })()`);
  expect(facts).toMatchObject({ commandSource: 2, questionCommands: 1 });
  const order = facts as { completedOrder: number; commitOrder: number; displayOrder: number; questionOrder: number };
  expect(order.completedOrder).toBeGreaterThanOrEqual(0);
  expect(order.completedOrder).toBeLessThan(order.commitOrder);
  expect(order.commitOrder).toBeLessThan(order.displayOrder);
  expect(order.displayOrder).toBeLessThan(order.questionOrder);
  expect((facts as { oldSnapshots: number[] }).oldSnapshots.every(index => index === 0)).toBe(true);
  const result = (
    facts as { events: { state: string; renderFence: number; outputTimestamp: { contextTime: number } }[] }
  ).events.at(-1)!;
  expect(result.state).toBe("completed");
  expect(result.outputTimestamp.contextTime).toBeGreaterThanOrEqual(result.renderFence);
  const record = await page.evaluate(`(async()=>{
  window.session.end('parent_stop');await window.session.recordingSettled();
  const recording=await window.transport.recording();const buffer=await window.context.decodeAudioData(await recording.blob.arrayBuffer());
  const pcm=buffer.getChannelData(0);return {duration:buffer.duration,rms:Math.sqrt(pcm.reduce((sum,x)=>sum+x*x,0)/pcm.length),timeline:window.timeline.filter(x=>x.event.type==='local_playback').map(x=>({atMs:x.atMs,...x.event}))};
 })()`);
  expect(record).toMatchObject({ rms: expect.any(Number) });
  expect((record as { rms: number }).rms).toBeGreaterThan(0.01);
  const clip = (
    record as { timeline: { state: string; text: string; identity: { correlationKey: string } }[] }
  ).timeline.at(-1)!;
  expect(clip).toMatchObject({ state: "completed" });
  expect(clip.text).toBe(acknowledgmentFor(0, clip.identity.correlationKey).text);
  await cleanup(page);
});

for (const phase of ["started", "media_ended"])
  test(`real finite ${phase} cancellation and retained callbacks never advance; correction owns old displayed group`, async ({
    page,
  }) => {
    await fixture(page);
    if (phase === "media_ended")
      await page.evaluate(`(() => {
  // Hold the observed output clock, while actual media and recording run.
  // A browser round trip cannot otherwise reliably hit the one-frame drain.
  const context=window.transport.context;
  window.restoreOutputClock=context.getOutputTimestamp.bind(context);
  context.getOutputTimestamp=()=>({contextTime:0,performanceTime:performance.now()});
 })()`);
    await answer(page);
    await playback(page, phase);
    await answer(page, " no two", 1100);
    await expect.poll(() => page.evaluate("window.evaluations.length")).toBe(2);
    expect(await page.evaluate("window.evaluations.at(-1).sceneIndex")).toBe(0);
    if (phase === "media_ended")
      await page.evaluate("window.transport.context.getOutputTimestamp=window.restoreOutputClock");
    expect(
      await page.evaluate(
        "window.session.events.filter(e=>e.type==='acknowledgment.playback'&&e.detail.state==='interrupted').length+window.session.events.filter(e=>e.type==='acknowledgment.playback'&&e.detail.state==='superseded').length",
      ),
    ).toBe(1);
    await cleanup(page);
  });

test("stale same-index display token cannot start B; retained transition correction waits for current confirmation and receives clarification plus one pending question", async ({
  page,
}) => {
  await fixture(page, false);
  await answer(page);
  await playback(page, "completed");
  await page.evaluate("window.session.displayed(1,'retired-attempt:same-index')");
  expect(await page.evaluate("window.providers.length")).toBe(1);
  await answer(page, "no two", 7000);
  await page.evaluate("window.session.displayed(1,window.session.snapshot.displayToken)");
  await ready(page);
  expect(await page.evaluate("window.evaluations.length")).toBe(1);
  expect(
    await page.evaluate("window.commands.filter(x=>x.command.content?.includes('Neutrally clarify')).length"),
  ).toBe(1);
  await cleanup(page);
});

test("stop during actual acknowledgment leaves one stopped terminal and no scene or question", async ({ page }) => {
  await fixture(page);
  await answer(page);
  await playback(page, "started");
  await page.evaluate("window.session.end('parent_stop')");
  expect(await page.evaluate("window.session.snapshot.sceneIndex")).toBe(0);
  expect(
    await page.evaluate(
      "window.session.events.filter(e=>e.type==='acknowledgment.playback'&&e.detail.state==='stopped').length",
    ),
  ).toBe(1);
  expect(await page.evaluate("window.providers.length")).toBe(1);
  await cleanup(page);
});
