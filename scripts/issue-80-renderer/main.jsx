// Disposable browser experiment. No application imports, microphone, or provider credentials.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BaseBoxShapeUtil, HTMLContainer, T, Tldraw, createShapeId } from "tldraw";
import katex from "katex";
import "tldraw/tldraw.css";
import "katex/dist/katex.min.css";
const examples = [
  ["power", "f(x)=x^3-4x", "f of x equals x cubed minus four x"],
  ["product", "f(x)=x^2\\sin(x)", "f of x equals x squared times sine x"],
  ["chain", "f(x)=(3x^2+1)^5", "f of x equals the quantity three x squared plus one to the fifth"],
  [
    "wrong",
    "f'(x)=2x\\sin(x)-x^2\\cos(x)",
    "f prime of x equals two x sine x MINUS x squared cosine x; incorrect attempt",
  ],
  [
    "long",
    "f'(x)=2x\\sin(x)+x^2\\cos(x)+5(3x^2+1)^4\\cdot6x",
    "long layout stress case: two x sine x plus x squared cosine x plus five times the quantity three x squared plus one to the fourth times six x",
  ],
];
const corrected = [
  "wrong",
  "f'(x)=2x\\sin(x)+x^2\\cos(x)",
  "f prime of x equals two x sine x PLUS x squared cosine x; replacement",
];
function Equation({ latex, label }) {
  let html;
  try {
    html = katex.renderToString(latex, {
      throwOnError: true,
      trust: false,
      strict: "error",
      maxExpand: 100,
      output: "htmlAndMathml",
    });
  } catch {
    return <span role="alert">Equation unavailable: {latex}</span>;
  }
  return (
    <div className="equation">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <span className="readable">{label}</span>
    </div>
  );
}
class EquationShape extends BaseBoxShapeUtil {
  static type = "equation";
  static props = { w: T.number, h: T.number, latex: T.string, label: T.string };
  getDefaultProps() {
    return { w: 900, h: 100, latex: "x", label: "x" };
  }
  canResize() {
    return false;
  }
  component(shape) {
    return (
      <HTMLContainer>
        <Equation latex={shape.props.latex} label={shape.props.label} />
      </HTMLContainer>
    );
  }
  getIndicatorPath(shape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
const shapeUtils = [EquationShape];
function Canvas({ steps }) {
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    if (!editor) return;
    // Logical history lives outside tldraw; canvas undo is intentionally not authoritative.
    editor.run(
      () => {
        editor.updateInstanceState({ isReadonly: false });
        const wanted = new Set(steps.map(step => createShapeId(step[0])));
        editor.deleteShapes(
          editor
            .getCurrentPageShapes()
            .filter(shape => !wanted.has(shape.id))
            .map(shape => shape.id),
        );
        steps.forEach(([id, latex, label], index) => {
          const shapeId = createShapeId(id);
          const shape = {
            id: shapeId,
            type: "equation",
            x: 20,
            y: 20 + index * 110,
            props: { w: 900, h: 100, latex, label },
          };
          if (editor.getShape(shapeId)) editor.updateShape(shape);
          else editor.createShape(shape);
        });
        editor.updateInstanceState({ isReadonly: true });
      },
      { ignoreShapeLock: true, history: "ignore" },
    );
    const fit = () => {
      editor.updateViewportScreenBounds(editor.getContainer());
      editor.zoomToFit({ animation: { duration: 0 } });
    };
    fit();
    window.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [editor, steps]);
  return (
    <div className="canvas">
      <Tldraw hideUi shapeUtils={shapeUtils} onMount={setEditor} />
    </div>
  );
}
function App() {
  const [surface, setSurface] = useState("list");
  const [steps, setSteps] = useState(examples.slice(0, 3));
  const [history, setHistory] = useState([]);
  const apply = next => {
    setHistory([...history, steps]);
    setSteps(next);
  };
  const undo = () => {
    if (history.length) {
      setSteps(history.at(-1));
      setHistory(history.slice(0, -1));
    }
  };
  return (
    <main style={new URLSearchParams(window.location.search).has("narrow") ? { maxWidth: 350 } : undefined}>
      <h1>Equation renderer comparison</h1>
      <p>Synthetic display experiment. No voice integration. Revision {history.length}.</p>
      <nav aria-label="Experiment controls">
        <button onClick={() => setSurface("list")}>Show list</button>
        <button onClick={() => setSurface("canvas")}>Show tldraw</button>
        <button onClick={() => apply([...steps.filter(step => step[0] !== "wrong"), examples[3]])}>
          Append wrong sign
        </button>
        <button
          disabled={!steps.some(step => step[0] === "wrong")}
          onClick={() => apply(steps.map(step => (step[0] === "wrong" ? corrected : step)))}
        >
          Replace sign
        </button>
        <button disabled={!history.length} onClick={undo}>
          Undo
        </button>
        <button onClick={() => apply([...steps.filter(step => step[0] !== "long"), examples[4]])}>
          Append long line
        </button>
        <button
          onClick={() =>
            apply([
              ...steps.filter(step => step[0] !== "error"),
              ["error", "\\notacommand{x}", "intentional unsupported command"],
            ])
          }
        >
          Render failure
        </button>
      </nav>
      {surface === "list" ? (
        <section aria-label="Equation list">
          <h2>Ordered equation list · KaTeX</h2>
          <ol aria-live="polite">
            {steps.map(([id, latex, label]) => (
              <li key={id} data-step={id}>
                <Equation latex={latex} label={label} />
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section aria-label="Tldraw candidate">
          <h2>tldraw custom equation shapes · KaTeX</h2>
          <Canvas steps={steps} />
        </section>
      )}
      <p>
        Undo reverses the latest effective board edit, including replacements. Canvas navigation does not edit logical
        history.
      </p>
    </main>
  );
}
const style = document.createElement("style");
style.textContent = `body{margin:0;background:#f2f4f5;color:#17252a;font:16px system-ui}main{max-width:1100px;margin:auto;padding:20px}h1{font-size:26px}h2{font-size:18px}nav{display:flex;gap:8px;flex-wrap:wrap}button{padding:10px;border:1px solid #42616c;background:white;border-radius:5px}button:focus-visible{outline:3px solid #bb5200}section{margin-top:20px;background:white;padding:14px;border:1px solid #adbfc4;border-radius:8px}li{padding:12px 0;border-bottom:1px solid #ddd}ol{padding-left:28px}.equation{padding:8px;font-size:22px;overflow-x:auto;max-width:100%;box-sizing:border-box}.readable{display:block;font:12px system-ui;color:#40535b;margin-top:6px}.canvas{position:relative;height:460px;width:100%}.tl-html-container .equation{width:900px;height:100px;background:white}.katex{white-space:nowrap}`;
document.head.append(style);
createRoot(document.getElementById("root")).render(<App />);
