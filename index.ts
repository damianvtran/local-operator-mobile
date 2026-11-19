// The app's bundle entry (`package.json` `main`).
//
// WHY NOT `expo-router/entry` DIRECTLY. A silent push can relaunch a terminated
// app in the background, where `modules/lop-background-launch` starts React
// Native WITHOUT a view (expo/expo#52878, agent review R1 M1). With no view,
// nothing renders, so expo-router never loads `app/_layout.tsx` — whose import
// is otherwise what defines the background notification task. expo-task-manager
// then finds the task undefined, drops the push and UNREGISTERS the task
// (`expo-task-manager` `build/TaskManager.js`), which would silence every later
// background push too. Importing the task here evaluates its module-scope
// `defineTask` on every launch, viewed or headless.
//
// ORDER. `expo-router/entry` stays first: it imports `@expo/metro-runtime`
// before anything else, which web Fast Refresh requires. Both run synchronously
// while the bundle evaluates, before native can dispatch a queued task event.
// `app/_layout.tsx` keeps its own import; the module evaluates once either way.
//
// The CI proof harnesses wrap this file by requiring `package.json` `main`
// (`scripts/ci/signin-app-proof/prepare-entry.ts`), so it must stay a path
// Metro resolves from the project root.
import "expo-router/entry";
import "./src/notifications/background-task";
