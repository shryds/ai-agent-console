"use client";

import { useState } from "react";
import { useAgentSession } from "@/session/useAgentSession";
import { cx } from "@/lib/classNames";
import { ChatPanel } from "./ChatPanel";
import { Composer } from "./Composer";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { TraceTimeline } from "./TraceTimeline";
import { ContextInspector } from "./ContextInspector";
import { TelemetryBar } from "./TelemetryBar";
import styles from "./Console.module.css";

type SidebarTab = "trace" | "context";

export function Console() {
  const { state, telemetry, bufferStats, sendMessage, setFocus, clear, reconnect, canSend, busy } =
    useAgentSession();
  const [tab, setTab] = useState<SidebarTab>("trace");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const contextCount = state.contextOrder.reduce(
    (n, id) => n + (state.contexts[id]?.snapshots.length ?? 0),
    0,
  );

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>◇</span> Agent Console
        </div>
        <ConnectionIndicator status={state.status} onReconnect={reconnect} />
        <div className={styles.telemetry}>
          <TelemetryBar telemetry={telemetry} />
        </div>
        <button
          className={styles.sidebarToggle}
          onClick={() => setSidebarOpen((o) => !o)}
          title={sidebarOpen ? "Hide panel" : "Show panel"}
        >
          {sidebarOpen ? "⇥" : "⇤"}
        </button>
      </header>

      <div className={styles.body}>
        <section className={styles.chatCol}>
          <ChatPanel state={state} onFocus={setFocus} />
          <Composer onSend={sendMessage} canSend={canSend} busy={busy} onClear={clear} />
        </section>

        {sidebarOpen && (
          <aside className={styles.sidebar}>
            <div className={styles.tabs}>
              <button
                className={cx(styles.tab, tab === "trace" && styles.tabActive)}
                onClick={() => setTab("trace")}
              >
                Trace <span className={styles.tabCount}>{state.trace.length}</span>
              </button>
              <button
                className={cx(styles.tab, tab === "context" && styles.tabActive)}
                onClick={() => setTab("context")}
              >
                Context <span className={styles.tabCount}>{contextCount}</span>
              </button>
            </div>
            <div className={styles.panelBody}>
              {tab === "trace" ? (
                <TraceTimeline
                  trace={state.trace}
                  focus={state.focus}
                  onFocus={setFocus}
                  bufferStats={bufferStats}
                />
              ) : (
                <ContextInspector contexts={state.contexts} contextOrder={state.contextOrder} />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
