const fs = require('fs');
const path = require('path');

describe('apple-targets EAS target name', () => {
  it('uses the display name for targetName', () => {
    const filePath = require.resolve('@bacons/apple-targets/build/with-widget.js');

    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).toContain('targetName: targetDisplayName');
  });
});
