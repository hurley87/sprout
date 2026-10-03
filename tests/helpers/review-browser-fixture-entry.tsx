import { createRoot } from "react-dom/client";
import { SessionInspector } from "../../app/session-inspector";
import { ConvexSessionRecorder } from "../../lib/convex-session-recorder";
import { readBrowserSessionReference } from "../../lib/durable-session-reference";

const ref = readBrowserSessionReference();
createRoot(document.getElementById("root")!).render(
  <SessionInspector
    sessionRef={ref.status === "available" ? ref.ref : undefined}
    reader={new ConvexSessionRecorder()}
    onRetry={() => {}}
  />,
);
