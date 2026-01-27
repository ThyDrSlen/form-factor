const config = require('../../../targets/watch-app/expo-target.config.js');

describe('watch target config', () => {
  it('uses the Xcode watch target name', () => {
    expect(config.name).toBe('Form Factor Watch Watch App');
  });
});
