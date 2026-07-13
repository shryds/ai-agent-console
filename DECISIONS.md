# DECISIONS

A few of the key implementation decisions, why they were made, and how they'd evolve for larger workloads.

## State management

- **Chose:** `useReducer` + a hand-written connection state machine.
- **Why not Redux/Zustand?**
  - Only one active chat session exists.
  - No cross-component subscriptions or global state synchronization.
  - Transition logic (connect, reconnect, duplicate detection, ordering) is easier to reason about as plain functions.
- **Trade-off**
  - Structural sharing has to be written manually.
  - Only the affected turn/segment is replaced instead of relying on Immer.

---

## Message ordering and deduplication

### Data structure

- `Map<seq, ServerMessage>` stores out-of-order messages.
- `lastReleasedSeq` tracks the highest contiguous message already consumed.

### Processing each incoming message

1. `seq <= lastReleasedSeq`
   - Already released.
   - Drop as duplicate.

2. `seq` already exists in the buffer.
   - Duplicate pending message.
   - Drop it.

3. Otherwise
   - Insert into the map.
   - Drain while `buffer.has(lastReleasedSeq + 1)`:
     - Release message.
     - Delete from buffer.
     - Increment cursor.

### Why this structure?

- O(1) insert and lookup.
- No sorting.
- No array shifting.
- Downstream code only ever sees ordered, deduplicated messages.

### Important invariants

- Reset the cursor every turn because the server resets sequence numbers.
- Never release past a gap on a live connection.
- Resume state is based on the last released message, not the highest sequence seen.

### Tested scenarios

- Empty stream
- Single message
- In-order delivery
- Gap held open
- Shuffled window
- Fully reversed delivery
- Duplicate after release
- Duplicate while buffered
- Duplicate during gap fill
- Mid-stream reconnect and replay
- Per-turn sequence reset

---

## Avoiding layout shift during tool calls

### Representation

A turn is stored as an ordered list of:

- Text segments
- Tool cards

Each segment has a permanent identity.

### Rules

- Tokens append only to the currently open text segment.
- Starting a tool call:
  - Freeze the current text segment.
  - Insert a tool card.
- Tool finishes:
  - Create a new text segment.
  - Never reopen the previous one.

### Why it prevents layout shift

- Frozen text nodes never change identity.
- React never remounts or rewrites them.
- Tool cards are inserted as normal sibling elements.
- Existing text remains untouched while later content moves naturally below it.

---

## Reconnection and state recovery

### Two different notions of progress

**Received**

- Everything delivered by the socket.
- May still be waiting behind a gap.

**Consumed**

- Messages actually released in order.
- Already rendered.

### Recovery

- Resume requests use the consumed cursor (`lastReleasedSeq`).
- Server replays everything after that cursor.
- Replay goes through the same ordering buffer:
  - Already-consumed messages dedupe automatically.
  - Missing messages fill gaps.
  - Rendering resumes seamlessly.

### Tool calls

- Pending tool cards remain visible during disconnect.
- Replayed tool results update the existing card in place.

---

## Scaling to 50 concurrent streams

### Changes

- One reorder buffer per stream.
- Normalized state keyed by stream ID.
- Virtualized stream list.
- Batch dispatches once per animation frame.
- Shared scheduler for fairness across streams.
- Collapse off-screen streams into summaries.

### What stays the same

- Never release past a gap.
- Resume from consumed cursor.
- Stable segment identities.

The same invariants simply run independently for each stream.

---

## Scaling to 100× longer responses

### Bottlenecks

- Memory usage
- Rendering cost
- Large state diffs

### Changes

- Windowed/virtualized rendering.
- Bounded history retention with on-demand summaries.
- Move heavy diffing/JSON processing into a Web Worker.
- Persist incremental state (e.g. IndexedDB) to avoid replaying massive histories after reload.

### What stays the same

- Append-only rendering.
- Stable segment identities.
- Ordered release from the reorder buffer.

Only the rendering and storage layers change; the streaming protocol and ordering guarantees remain identical.

