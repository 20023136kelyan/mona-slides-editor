# Mona web application

`apps/web` is the sole production frontend. It is a React 19, TypeScript 7,
Vite 8 client application containing the desktop editor, mobile editor and
preview, slideshow/presenter surfaces, settings, and import/export workflows.
The drawing workspace and agent dock are lazy-loaded from the editor; hosted
provider credentials and managed assets remain behind `apps/agent-server`.

Use the repository-root commands so workspace checks run consistently:

```sh
npm run dev
npm run type-check
npm run lint
npm run test:react
npm run e2e:react
npm run build
```

Development-only deterministic decks are selected by the application tests
through `developmentFixture`. The fixture loader and fixture decks are excluded
from production builds.
