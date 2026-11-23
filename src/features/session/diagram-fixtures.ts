/**
 * Mermaid sources the diagram tests render through the real Pele.
 *
 * Not shipped: imported only by `*.test.ts`. One small, valid source per diagram
 * type Pele draws, plus the three the transcript sees most (flowchart, sequence,
 * state) in the form a model usually writes them.
 */
export const DIAGRAM_SOURCES: Record<string, string> = {
	flowchart: `flowchart TD
  A[Start] --> B{Is it ready?}
  B -- Yes --> C(Ship it)
  B -- No --> D[(Fix the data)]
  D --> B
  C --> E((Done))`,
	sequence: `sequenceDiagram
  participant U as User
  participant R as Relay
  participant A as Agent
  U->>R: send message
  R->>A: forward
  A-->>R: stream tokens
  R-->>U: SSE events
  Note over U,R: password required`,
	state: `stateDiagram-v2
  [*] --> Idle
  Idle --> Running: start
  Running --> Paused: pause
  Paused --> Running: resume
  Running --> [*]: finish`,
	class: `classDiagram
  class Animal {
    +String name
    +eat() void
  }
  class Dog
  Animal <|-- Dog
  Dog "1" --> "*" Toy : plays`,
	er: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains`,
	journey: `journey
  title My day
  section Work
    Make tea: 5: Me
    Do work: 1: Me, Cat
  section Home
    Sit down: 5: Me`,
	gantt: `gantt
  title Plan
  dateFormat YYYY-MM-DD
  section A
  Task1 :a1, 2024-01-01, 10d
  Task2 :after a1, 5d
  section B
  Task3 :crit, 2024-01-05, 8d`,
	pie: `pie title Pets
  "Dogs" : 386
  "Cats" : 85
  "Rats" : 15`,
	quadrant: `quadrantChart
  title Reach
  x-axis Low --> High
  y-axis Low --> High
  quadrant-1 We should expand
  Campaign A: [0.3, 0.6]`,
	mindmap: `mindmap
  root((mindmap))
    Origins
      Long history
    Tools
      Pen and paper`,
	timeline: `timeline
  title History
  2002 : LinkedIn
  2004 : Facebook : Google`,
	gitGraph: `gitGraph
  commit
  branch develop
  checkout develop
  commit
  checkout main
  merge develop`,
	xychart: `xychart-beta
  title "Sales"
  x-axis [jan, feb, mar]
  y-axis "Revenue" 0 --> 100
  bar [20, 50, 80]
  line [20, 50, 80]`,
	sankey: `sankey-beta

A,B,10
A,C,5
B,D,7`,
	block: `block-beta
  columns 2
  a["A"] b["B"]
  c["C"]:2`,
	requirement: `requirementDiagram
  requirement test_req {
    id: 1
    text: the test text.
    risk: high
    verifymethod: test
  }
  element test_entity {
    type: simulation
  }
  test_entity - satisfies -> test_req`,
	c4: `C4Context
  title Sys
  Person(a, "User", "A user")
  System(b, "System", "Does things")
  Rel(a, b, "Uses")`,
	kanban: `kanban
  todo[Todo]
    t1[Write docs]
  done[Done]
    t2[Ship]`,
	radar: `radar-beta
  axis a["A"], b["B"], c["C"]
  curve s1["S1"]{1,2,3}`,
	architecture: `architecture-beta
  group api(cloud)[API]
  service db(database)[DB] in api
  service srv(server)[Server] in api
  db:L -- R:srv`,
	packet: `packet-beta
  0-15: "Source Port"
  16-31: "Destination Port"`,
	treemap: `treemap-beta
"A"
  "B": 10
  "C": 20`,
	styled: `flowchart LR
  A[Hello] --> B((World))
  classDef big fill:#f96,stroke:#333,stroke-width:4px
  class A big
  style B fill:#bbf
  linkStyle 0 stroke:#f00
  subgraph S
   C --> D
  end`,
	sequenceFull: `sequenceDiagram
  autonumber
  actor U
  participant S
  U->>+S: hi
  S-->>-U: yo
  loop Every min
    U->>S: ping
  end
  alt ok
    S->>U: a
  else bad
    S-xU: b
  end
  rect rgb(200,150,255)
   U->>S: x
  end`,
	stateFull: `stateDiagram-v2
  state Active {
    [*] --> A
    A --> B
    --
    [*] --> C
  }
  state fork_state <<fork>>
  [*] --> fork_state
  fork_state --> Active
  note right of Active: a note`,
};

/** Sources that try to make the picture do something. Each is valid Mermaid
 *  (Pele draws it) or fails cleanly; none may reach a native view as a handler,
 *  script, link or URL. */
export const HOSTILE_SOURCES: Record<string, string> = {
	imgOnerror: `flowchart TD
  A["<img src=x onerror=alert(1)>"] --> B["<script>alert(1)</script>"]`,
	javascriptUrl: `flowchart TD
  A["javascript:alert(1)"] --> B
  click A "javascript:alert(1)"
  click B href "javascript:alert(2)" _blank`,
	clickCallback: `flowchart TD
  A --> B
  click A callback "tooltip"
  click B call alert("x")`,
	httpLink: `flowchart TD
  A --> B
  click A "https://evil.example/track"`,
	foreignObject: `flowchart TD
  A["<foreignObject><body onload=alert(1)></body></foreignObject>"] --> B`,
	quoteBreakout: `flowchart TD
  A["x #quot; onload=#quot;alert(1)"] --> B["a&quot; onmouseover=&quot;alert(1)"]`,
	/** Pele refuses a style with a URL in it, so this one is an error, not a
	 *  drawing: the fallback path is the defence. */
	styleInjection: `flowchart TD
  A --> B
  style A fill:url(javascript:alert(1)),stroke:red`,
	styleBackgroundUrl: `flowchart TD
  A --> B
  style A fill:#f00,background:url(https://evil.example/a.png)`,
	titleBreakout: `pie title </title><script>alert(1)</script>
  "a" : 1`,
	sequenceNames: `sequenceDiagram
  participant A as <b onmouseover=alert(1)>x</b>
  A->>A: <svg onload=alert(1)>`,
	initDirective: `%%{init: {"securityLevel":"loose","htmlLabels":true}}%%
flowchart TD
  A["<a href='javascript:alert(1)'>x</a>"] --> B`,
	imageLink: `flowchart TD
  A["<img src='https://evil.example/p.png'>"] --> B`,
};
