import type { RefObject } from "react";
import { Code2, KeyRound, ServerOff, ShieldCheck } from "lucide-react";
import { useWorkspace } from "../state/workspace";
import { Composer, type ComposerHandle } from "./Composer";
import { ModelPicker } from "./ModelPicker";

const STARTERS = [
  "How does public-key cryptography actually work?",
  "Why is the sky blue, really?",
  "Explain transformers from first principles",
  "What happens when I type a URL and press Enter?",
  "How do vaccines train the immune system?",
];

export function TrustPoints() {
  return (
    <div className="trust">
      <div className="trust-item"><ServerOff size={16} /><span><b>There is no server.</b> This page is static. Your chats are stored in this browser and nowhere else.</span></div>
      <div className="trust-item"><ShieldCheck size={16} /><span><b>Your key can only go to OpenRouter.</b> A Content-Security-Policy makes the browser block every other destination. Check it in DevTools.</span></div>
      <div className="trust-item"><Code2 size={16} /><span><b>Open source.</b> {import.meta.env.VITE_REPO_URL ? <a href={import.meta.env.VITE_REPO_URL} target="_blank" rel="noreferrer noopener">Read the code</a> : "Read the code"}, or run it yourself in one command.</span></div>
    </div>
  );
}

export function Hero({ composer }: { composer: RefObject<ComposerHandle | null> }) {
  const ws = useWorkspace();
  const vault = ws.backend.vault;
  const needsKey = !!vault && !vault.hasKey();
  const loadSample = async () => {
    const sample = await import("../sample-tree.json");
    await ws.importTrees(sample.default);
  };
  return (
    <div className="hero">
      <div className="hero-card">
        <h1>Learn by <em>branching</em>.</h1>
        <p className="lede">Every answer becomes a node. Branch from any sentence, park the questions you can't chase yet, and never lose a rabbit hole again.</p>
        <Composer ref={composer} autoFocus placeholder="What do you want to understand?" onAsk={(text) => ws.ask(text, { parentId: null })} left={<ModelPicker />} />
        <div className="starters">
          {STARTERS.map((s) => <button key={s} className="starter" onClick={() => void ws.ask(s, { parentId: null })}>{s}</button>)}
        </div>
        <div className="hero-links">
          <button onClick={() => void loadSample()}>Explore a sample tree</button>
          <button onClick={() => void ws.importTrees()}>Import a topic</button>
        </div>
        {needsKey && (
          <>
            <TrustPoints />
            <div className="hero-cta" style={{ marginTop: 16 }}>
              <button className="btn primary lg" onClick={() => ws.setDialog("connect")}><KeyRound size={16} /> Connect OpenRouter to start asking</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
