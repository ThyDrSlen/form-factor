// Patch for packages/app/src/components/catalog/EntityPage.tsx
// Add these imports and code to wire GitHub Actions plugin

import { EntityGithubActionsContent, isGithubActionsAvailable } from '@backstage/plugin-github-actions';

// In the entity page component, add this to the cicdContent section:
const cicdContent = (
  <EntitySwitch>
    <EntitySwitch.Case if={isGithubActionsAvailable}>
      <EntityGithubActionsContent />
    </EntitySwitch.Case>
  </EntitySwitch>
);

// Make sure cicdContent is included in the page layout, typically in:
// <EntityLayout.Route path="/ci-cd" title="CI/CD">
//   {cicdContent}
// </EntityLayout.Route>
